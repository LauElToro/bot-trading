import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sqlite3 from 'sqlite3';
import { PostgresExecutor } from '../src/database/postgres.js';
import { isUserId } from '../src/auth/user-id.js';

const { Pool } = pg;

interface Options {
  source: string;
  databaseUrl: string;
  batchSize: number;
  dryRun: boolean;
  verifyOnly: boolean;
  schemaOnly: boolean;
  table?: string;
}

interface TableSpec {
  name: string;
  cursor?: string;
  sequence?: boolean;
}

const TABLES: TableSpec[] = [
  { name: 'users' },
  { name: 'grvt_credentials' },
  { name: 'grvt_sub_accounts', cursor: 'id', sequence: true },
  { name: 'refresh_tokens', cursor: 'id', sequence: true },
  { name: 'terms_acceptances', cursor: 'id', sequence: true },
  { name: 'password_reset_tokens', cursor: 'id', sequence: true },
  { name: 'grid_bots', cursor: 'id', sequence: true },
  { name: 'grid_levels', cursor: 'id', sequence: true },
  { name: 'bot_cash_movements', cursor: 'id', sequence: true },
  { name: 'orders', cursor: 'id', sequence: true },
  { name: 'trades', cursor: 'id', sequence: true },
  { name: 'funding_history', cursor: 'id', sequence: true },
  { name: 'daily_snapshots', cursor: 'id', sequence: true },
  { name: 'fills_archive', cursor: 'id', sequence: true },
  { name: 'paired_roundtrips', cursor: 'id', sequence: true },
];

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Options {
  const value = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  };
  const source = value('source') ?? env.SQLITE_PATH ?? path.resolve(process.cwd(), 'data/grid_bot.db');
  const databaseUrl = value('database-url') ?? env.DATABASE_URL ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL or --database-url is required');
  const batchSize = Number(value('batch-size') ?? 1000);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error('--batch-size must be an integer between 1 and 10000');
  }
  const modes = ['--dry-run', '--verify-only', '--schema-only'].filter((flag) => argv.includes(flag));
  if (modes.length > 1) throw new Error('choose only one of --dry-run, --verify-only or --schema-only');
  return {
    source,
    databaseUrl,
    batchSize,
    dryRun: argv.includes('--dry-run'),
    verifyOnly: argv.includes('--verify-only'),
    schemaOnly: argv.includes('--schema-only'),
    table: value('table'),
  };
}

class SqliteReader {
  private readonly db: sqlite3.Database;

  constructor(file: string) {
    this.db = new sqlite3.Database(file, sqlite3.OPEN_READONLY);
  }

  all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (error, rows) => {
        if (error) reject(error);
        else resolve((rows as T[]) ?? []);
      });
    });
  }

  get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (error, row) => {
        if (error) reject(error);
        else resolve(row as T | undefined);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((error) => error ? reject(error) : resolve());
    });
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function canonicalRow(row: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(row)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
    ),
  );
}

export function checksumRows(rows: Array<Record<string, unknown>>): string {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(canonicalRow(row)).update('\n');
  return hash.digest('hex');
}

async function sourceTables(source: SqliteReader): Promise<Set<string>> {
  const rows = await source.all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  );
  return new Set(rows.map((row) => row.name));
}

async function sourceColumns(source: SqliteReader, table: string): Promise<string[]> {
  const rows = await source.all<{ name: string }>(`PRAGMA table_info(${quoteIdentifier(table)})`);
  return rows.map((row) => row.name);
}

async function destinationColumns(
  pool: InstanceType<typeof Pool>,
  table: string,
): Promise<string[]> {
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function ensureControlTables(pool: InstanceType<typeof Pool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sqlite_migration_checkpoints (
      table_name TEXT PRIMARY KEY,
      last_pk BIGINT NOT NULL DEFAULT 0,
      rows_migrated BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      checksum TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS sqlite_user_id_map (
      sqlite_id TEXT PRIMARY KEY,
      postgres_id UUID NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS sqlite_migration_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

async function loadUserMap(
  source: SqliteReader,
  pool: InstanceType<typeof Pool>,
  dryRun: boolean,
): Promise<Map<string, string>> {
  const users = await source.all<{ id: unknown }>('SELECT id FROM users ORDER BY id');
  const map = new Map<string, string>();
  for (const user of users) {
    const sourceId = String(user.id);
    const existing = dryRun
      ? { rows: [] as Array<{ postgres_id: string }> }
      : await pool.query<{ postgres_id: string }>(
          'SELECT postgres_id FROM sqlite_user_id_map WHERE sqlite_id = $1',
          [sourceId],
        );
    const postgresId = existing.rows[0]?.postgres_id
      ?? (isUserId(user.id) ? user.id : randomUUID());
    map.set(sourceId, postgresId);
    if (!dryRun && !existing.rows[0]) {
      await pool.query(
        `INSERT INTO sqlite_user_id_map (sqlite_id, postgres_id)
         VALUES ($1, $2) ON CONFLICT (sqlite_id) DO NOTHING`,
        [sourceId, postgresId],
      );
    }
  }
  return map;
}

export function normalizeRow(
  table: string,
  row: Record<string, unknown>,
  userMap: Map<string, string>,
): Record<string, unknown> {
  const normalized = { ...row };
  if (table === 'users') {
    normalized.id = userMap.get(String(row.id)) ?? row.id;
  }
  if ('user_id' in normalized && normalized.user_id != null) {
    normalized.user_id = userMap.get(String(normalized.user_id)) ?? normalized.user_id;
  }
  return normalized;
}

async function insertBatch(
  pool: InstanceType<typeof Pool>,
  table: string,
  rows: Array<Record<string, unknown>>,
  columns: string[],
): Promise<void> {
  if (rows.length === 0 || columns.length === 0) return;
  const identifiers = columns.map(quoteIdentifier).join(', ');
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = columns.map((column) => {
      values.push(row[column] ?? null);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  await pool.query(
    `INSERT INTO ${quoteIdentifier(table)} (${identifiers})
     VALUES ${tuples.join(', ')}
     ON CONFLICT DO NOTHING`,
    values,
  );
}

async function checkpoint(
  pool: InstanceType<typeof Pool>,
  table: string,
): Promise<{ last_pk: number; rows_migrated: number; status: string }> {
  const result = await pool.query<{
    last_pk: number;
    rows_migrated: number;
    status: string;
  }>('SELECT last_pk, rows_migrated, status FROM sqlite_migration_checkpoints WHERE table_name = $1', [table]);
  return result.rows[0] ?? { last_pk: 0, rows_migrated: 0, status: 'pending' };
}

async function migrateTable(
  source: SqliteReader,
  pool: InstanceType<typeof Pool>,
  spec: TableSpec,
  options: Options,
  userMap: Map<string, string>,
): Promise<void> {
  const sourceCols = await sourceColumns(source, spec.name);
  const destinationCols = await destinationColumns(pool, spec.name);
  const columns = sourceCols.filter((column) => destinationCols.includes(column));
  const state = options.dryRun
    ? { last_pk: 0, rows_migrated: 0, status: 'pending' }
    : await checkpoint(pool, spec.name);
  if (state.status === 'done') {
    console.log(`[skip] ${spec.name}: checkpoint complete`);
    return;
  }

  let cursor = spec.cursor ? Number(state.last_pk) : 0;
  let migrated = Number(state.rows_migrated);
  let finalChecksum = '';
  for (;;) {
    const order = spec.cursor ? `WHERE ${quoteIdentifier(spec.cursor)} > ? ORDER BY ${quoteIdentifier(spec.cursor)}` : '';
    const params = spec.cursor ? [cursor, options.batchSize] : [options.batchSize];
    const rows = await source.all<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(spec.name)} ${order} LIMIT ?`,
      params,
    );
    if (rows.length === 0) break;
    const normalized = rows.map((row) => normalizeRow(spec.name, row, userMap));
    finalChecksum = checksumRows(normalized);

    if (!options.dryRun) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await insertBatch(client as unknown as InstanceType<typeof Pool>, spec.name, normalized, columns);
        const lastPk = spec.cursor ? Number(rows.at(-1)?.[spec.cursor]) : rows.length;
        await client.query(
          `INSERT INTO sqlite_migration_checkpoints
             (table_name, last_pk, rows_migrated, status, checksum, error)
           VALUES ($1, $2, $3, 'running', $4, NULL)
           ON CONFLICT (table_name) DO UPDATE SET
             last_pk = EXCLUDED.last_pk,
             rows_migrated = EXCLUDED.rows_migrated,
             status = EXCLUDED.status,
             checksum = EXCLUDED.checksum,
             error = NULL,
             updated_at = CURRENT_TIMESTAMP`,
          [spec.name, lastPk, migrated + rows.length, finalChecksum],
        );
        await client.query('COMMIT');
        cursor = lastPk;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else if (spec.cursor) {
      cursor = Number(rows.at(-1)?.[spec.cursor]);
    }
    migrated += rows.length;
    console.log(`[${options.dryRun ? 'dry-run' : 'copy'}] ${spec.name}: ${migrated}`);
    if (!spec.cursor) break;
  }

  if (!options.dryRun) {
    await pool.query(
      `INSERT INTO sqlite_migration_checkpoints
         (table_name, last_pk, rows_migrated, status, checksum, error)
       VALUES ($1, $2, $3, 'done', $4, NULL)
       ON CONFLICT (table_name) DO UPDATE SET
         status = 'done', checksum = EXCLUDED.checksum, error = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [spec.name, cursor, migrated, finalChecksum || null],
    );
  }
}

async function resetSequence(pool: InstanceType<typeof Pool>, table: string): Promise<void> {
  await pool.query(
    `SELECT setval(
       pg_get_serial_sequence($1, 'id'),
       GREATEST(COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(table)}), 1), 1),
       EXISTS (SELECT 1 FROM ${quoteIdentifier(table)})
     )`,
    [table],
  );
}

async function verify(
  source: SqliteReader,
  pool: InstanceType<typeof Pool>,
  specs: TableSpec[],
): Promise<void> {
  let failed = false;
  for (const spec of specs) {
    const sourceCount = Number((await source.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(spec.name)}`,
    ))?.count ?? 0);
    const destinationCount = Number((await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(spec.name)}`,
    )).rows[0]?.count ?? 0);
    const ok = sourceCount === destinationCount;
    failed ||= !ok;
    console.log(`[verify] ${spec.name}: sqlite=${sourceCount} postgres=${destinationCount} ${ok ? 'OK' : 'MISMATCH'}`);
    if (spec.cursor) {
      const sourceMax = Number((await source.get<{ max: number | null }>(
        `SELECT MAX(${quoteIdentifier(spec.cursor)}) AS max FROM ${quoteIdentifier(spec.name)}`,
      ))?.max ?? 0);
      const destinationMax = Number((await pool.query<{ max: string | null }>(
        `SELECT MAX(${quoteIdentifier(spec.cursor)}) AS max FROM ${quoteIdentifier(spec.name)}`,
      )).rows[0]?.max ?? 0);
      failed ||= sourceMax !== destinationMax;
      console.log(
        `[verify] ${spec.name}.${spec.cursor} max: sqlite=${sourceMax} postgres=${destinationMax}`
      );
    }
  }

  const aggregates = [
    ['grid_bots', 'investment_usdt'],
    ['grid_bots', 'total_pnl_usdt'],
    ['paired_roundtrips', 'profit'],
  ] as const;
  for (const [table, column] of aggregates) {
    if (!specs.some((spec) => spec.name === table)) continue;
    const sourceValue = Number((await source.get<{ value: number }>(
      `SELECT COALESCE(SUM(${quoteIdentifier(column)}), 0) AS value FROM ${quoteIdentifier(table)}`,
    ))?.value ?? 0);
    const destinationValue = Number((await pool.query<{ value: string }>(
      `SELECT COALESCE(SUM(${quoteIdentifier(column)}), 0) AS value FROM ${quoteIdentifier(table)}`,
    )).rows[0]?.value ?? 0);
    const tolerance = Math.max(1e-9, Math.abs(sourceValue) * 1e-9);
    failed ||= Math.abs(sourceValue - destinationValue) > tolerance;
    console.log(
      `[verify] ${table}.${column} sum: sqlite=${sourceValue} postgres=${destinationValue}`
    );
  }

  const orphanChecks = [
    ['grid_levels', 'bot_id'], ['orders', 'bot_id'], ['trades', 'bot_id'],
    ['funding_history', 'bot_id'], ['daily_snapshots', 'bot_id'],
    ['bot_cash_movements', 'bot_id'], ['fills_archive', 'bot_id'],
    ['paired_roundtrips', 'bot_id'],
  ] as const;
  for (const [table, column] of orphanChecks) {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM ${quoteIdentifier(table)} child
         LEFT JOIN grid_bots parent ON parent.id = child.${quoteIdentifier(column)}
        WHERE child.${quoteIdentifier(column)} IS NOT NULL AND parent.id IS NULL`,
    );
    const count = Number(result.rows[0]?.count ?? 0);
    failed ||= count > 0;
    console.log(`[verify] ${table} orphan rows: ${count}`);
  }
  if (failed) throw new Error('migration verification failed');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), process.env);
  if (options.schemaOnly) {
    const executor = new PostgresExecutor(options.databaseUrl);
    try {
      await executor.migrate();
    } finally {
      await executor.close();
    }
    console.log('PostgreSQL schema is up to date');
    return;
  }
  await stat(options.source);
  const source = new SqliteReader(options.source);
  const pool = new Pool({ connectionString: options.databaseUrl });
  try {
    const available = await sourceTables(source);
    const specs = TABLES.filter((spec) => available.has(spec.name))
      .filter((spec) => !options.table || spec.name === options.table);
    if (options.table && specs.length === 0) throw new Error(`unknown or missing source table: ${options.table}`);

    if (!options.dryRun && !options.verifyOnly) {
      const executor = new PostgresExecutor(options.databaseUrl);
      await executor.migrate();
      await executor.close();
      await ensureControlTables(pool);
    }

    const userMap = available.has('users')
      ? await loadUserMap(source, pool, options.dryRun || options.verifyOnly)
      : new Map<string, string>();

    if (!options.verifyOnly) {
      for (const spec of specs) {
        try {
          await migrateTable(source, pool, spec, options, userMap);
          if (spec.sequence && !options.dryRun) await resetSequence(pool, spec.name);
        } catch (error) {
          if (!options.dryRun) {
            await pool.query(
              `INSERT INTO sqlite_migration_checkpoints (table_name, status, error)
               VALUES ($1, 'failed', $2)
               ON CONFLICT (table_name) DO UPDATE SET
                 status = 'failed', error = EXCLUDED.error, updated_at = CURRENT_TIMESTAMP`,
              [spec.name, error instanceof Error ? error.message : String(error)],
            );
          }
          throw error;
        }
      }
    }

    if (!options.dryRun) await verify(source, pool, specs);
    if (!options.dryRun && !options.verifyOnly) {
      await pool.query(
        `INSERT INTO sqlite_migration_meta (key, value)
         VALUES ('completed_at', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [new Date().toISOString()],
      );
    }
  } finally {
    await source.close();
    await pool.end();
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
