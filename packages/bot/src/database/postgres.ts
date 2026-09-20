import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import pg, { type PoolClient, type QueryResultRow } from 'pg';

const { Pool, types } = pg;

// Keep the shapes expected by the existing bot: numeric values are numbers
// and timestamps are ISO strings rather than Date instances.
types.setTypeParser(20, Number); // int8
types.setTypeParser(1700, Number); // numeric
types.setTypeParser(1114, (value) => value);
types.setTypeParser(1184, (value) => value);

export interface RunResult {
  lastID?: number;
  changes: number;
}

type SqlParams = readonly unknown[];

export interface QueryExecutor {
  run(sql: string, params?: SqlParams): Promise<RunResult>;
  get<T extends QueryResultRow = QueryResultRow>(sql: string, params?: SqlParams): Promise<T | undefined>;
  all<T extends QueryResultRow = QueryResultRow>(sql: string, params?: SqlParams): Promise<T[]>;
  transaction<T>(work: (executor: QueryExecutor) => Promise<T>): Promise<T>;
}

function pgSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export class PostgresExecutor implements QueryExecutor {
  private pool?: InstanceType<typeof Pool>;

  constructor(
    private readonly databaseUrl: string | undefined = process.env.DATABASE_URL,
    private readonly client?: PoolClient,
  ) {}

  private getPool(): InstanceType<typeof Pool> {
    if (!this.databaseUrl) {
      throw new Error('DATABASE_URL is required');
    }
    return (this.pool ??= new Pool({ connectionString: this.databaseUrl }));
  }

  private async query<T extends QueryResultRow>(sql: string, params: SqlParams = []) {
    const target = this.client ?? this.getPool();
    return target.query<T>(pgSql(sql), [...params]);
  }

  async run(sql: string, params: SqlParams = []): Promise<RunResult> {
    const result = await this.query<{ id?: number }>(sql, params);
    if (Array.isArray(result)) {
      return { changes: result.reduce((sum, item) => sum + (item.rowCount ?? 0), 0) };
    }
    return {
      changes: result.rowCount ?? 0,
      lastID: result.rows[0]?.id,
    };
  }

  async get<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: SqlParams = [],
  ): Promise<T | undefined> {
    return (await this.query<T>(sql, params)).rows[0];
  }

  async all<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: SqlParams = [],
  ): Promise<T[]> {
    return (await this.query<T>(sql, params)).rows;
  }

  async transaction<T>(work: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    if (this.client) return work(this);
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      const value = await work(new PostgresExecutor(this.databaseUrl, client));
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async migrate(
    directory = process.env.DB_MIGRATIONS_DIR
      ?? path.resolve(process.cwd(), 'src/database/migrations'),
  ): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const files = (await readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
    for (const file of files) {
      const applied = await this.get('SELECT 1 FROM schema_migrations WHERE version = ?', [file]);
      if (applied) continue;
      const sql = await readFile(path.join(directory, file), 'utf8');
      await this.transaction(async (tx) => {
        await tx.run(sql);
        await tx.run('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
      });
    }
  }

  async close(): Promise<void> {
    if (!this.client && this.pool) await this.pool.end();
  }
}
