import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GridBotDB } from '../src/database/db.js';
import { PostgresExecutor } from '../src/database/postgres.js';

const { Pool } = pg;
const baseUrl = process.env.TEST_DATABASE_URL;
const suite = baseUrl ? describe : describe.skip;
const schema = `grvt_test_${process.pid}_${Date.now()}`;
let admin: InstanceType<typeof Pool>;
let db: GridBotDB;
let databaseUrl = '';

suite('PostgreSQL integration', () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(baseUrl!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    databaseUrl = url.toString();
    db = new GridBotDB(databaseUrl);
    await db.initialize();
  });

  afterAll(async () => {
    await db?.close();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('applies migrations idempotently', async () => {
    await expect(db.initialize()).resolves.toBeUndefined();
    const row = await db.getExecutor().get<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM schema_migrations`,
    );
    expect(row?.count).toBeGreaterThan(0);
  });

  it('preserves UUID ownership and idempotent fill inserts', async () => {
    const userId = await db.createUser({
      email: `pg-${Date.now()}@example.com`,
      password_hash: 'test-hash',
      is_admin: true,
    });
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);

    const botId = await db.createBot({
      user_id: userId,
      pair: 'ETH_USDT_Perp',
      direction: 'long',
      leverage: 2,
      lower_price: 1800,
      upper_price: 2400,
      num_grids: 10,
      investment_usdt: 500,
      grid_profit_usdt: 0,
      trend_pnl_usdt: 0,
      total_pnl_usdt: 0,
      status: 'paused',
      position_size: 0,
      avg_entry_price: 0,
      liquidation_price: 0,
      params_json: '{}',
    });
    expect(botId).toBeGreaterThan(0);
    await expect(db.getBot(botId)).resolves.toMatchObject({ user_id: userId });

    const fill = {
      fill_id: `fill-${Date.now()}`,
      event_time: '1700000000000000000',
      is_buyer: 1,
      price: 2000,
      size: 0.1,
      fee: -0.01,
      created_at: new Date().toISOString(),
      bot_id: botId,
      instrument: 'ETH_USDT_Perp',
    };
    await expect(db.insertFillArchive(fill)).resolves.toBe(true);
    await expect(db.insertFillArchive(fill)).resolves.toBe(false);
  });

  it('rolls back failed transactions', async () => {
    const executor = new PostgresExecutor(databaseUrl);
    await expect(executor.transaction(async (tx) => {
      await tx.run(`INSERT INTO users
        (id, email, password_hash, created_at)
        VALUES (?, ?, ?, ?)`, [
        '22222222-2222-4222-8222-222222222222',
        'rollback@example.com',
        'hash',
        Date.now(),
      ]);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');

    const row = await executor.get(
      `SELECT id FROM users WHERE email = ?`,
      ['rollback@example.com'],
    );
    expect(row).toBeUndefined();
    await executor.close();
  });
});
