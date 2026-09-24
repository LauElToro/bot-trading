// D.1 — Bot lifecycle integration test.
// Exercises the full state machine through the v2 router:
//   create (paused) → start (running) → pause (paused) → close (stopped)
// Verifies routing, ownership enforcement, status transitions, and that
// the right engineOps method gets invoked at each step.
//
// engineOps is mocked because we don't want a real GRVT order to fly out
// during tests — but the API contract (auth, ownership, mutation order,
// status flags) is exercised end to end.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createV2Router } from '../src/server/v2-router.js';

// ── In-memory DB with stateful bot rows ──────────────────────────────
// Lighter than a real PostgreSQL instance for these tests — we only need to track
// bot rows so requireBotOwnership() and the duplicate-instrument guard
// can read them, and the cache invalidation has something to invalidate.

interface BotRow {
  id: number;
  user_id: string | null;
  pair: string;
  direction?: 'long' | 'short';
  status: 'paused' | 'running' | 'stopped';
}

function makeMockDb() {
  const bots: BotRow[] = [];
  let nextId = 1;
  return {
    async all(sql: string, params: unknown[] = []) {
      // Duplicate-instrument guard (POST /bots)
      if (sql.includes('COUNT(*)') && sql.includes('pair')) {
        const pair = params[1];
        const direction = sql.includes('direction = ?') || sql.includes('direction <>')
          ? params[2]
          : undefined;
        const c = bots.filter((b) => {
          if (b.pair !== pair || b.status === 'stopped') return false;
          if (sql.includes('direction <>')) {
            return b.status === 'running' && !!b.direction && b.direction !== direction;
          }
          if (direction && b.direction && b.direction !== direction) return false;
          return true;
        }).length;
        return [{ c }];
      }
      // GET /bots
      if (sql.includes('SELECT') && sql.includes('grid_bots') && sql.includes('ORDER BY')) {
        return [...bots];
      }
      return [];
    },
    async get(sql: string, params: unknown[] = []) {
      if (sql.includes('COUNT(*)') && sql.includes('pair')) {
        const pair = params[1];
        const direction = sql.includes('direction = ?') || sql.includes('direction <>')
          ? params[2]
          : undefined;
        const c = bots.filter((b) => {
          if (b.pair !== pair || b.status === 'stopped') return false;
          if (sql.includes('direction <>')) {
            return b.status === 'running' && !!b.direction && b.direction !== direction;
          }
          if (direction && b.direction && b.direction !== direction) return false;
          return true;
        }).length;
        return { c };
      }
      if (sql.includes('COUNT(*)') && sql.includes('running')) {
        return { c: bots.filter((b) => b.status === 'running').length };
      }
      // Bot ownership lookup: SELECT id, user_id, pair, status FROM grid_bots WHERE id = ?
      if (sql.includes('SELECT') && sql.includes('user_id') && sql.includes('id = ?')) {
        const id = params[0] as number;
        return bots.find((b) => b.id === id);
      }
      return undefined;
    },
    async run(_sql: string, _params: unknown[] = []) {
      return { changes: 1, lastID: 99 };
    },
    _bots: bots,
    _addBot(pair: string, status: BotRow['status'] = 'paused', userId = '00000000-0000-4000-8000-000000000001'): BotRow {
      const row: BotRow = { id: nextId++, user_id: userId, pair, status };
      bots.push(row);
      return row;
    },
    _setStatus(id: number, status: BotRow['status']) {
      const b = bots.find((x) => x.id === id);
      if (b) b.status = status;
    },
  };
}

function makeMockGrvtClient() {
  return {
    getInstruments: vi.fn().mockResolvedValue([]),
    getBalance: vi.fn().mockResolvedValue({ total_equity: '10000', available_balance: '5000' }),
    getTicker: vi.fn().mockResolvedValue({ last_price: '2100' }),
    getPosition: vi.fn().mockResolvedValue(null),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getKlines: vi.fn().mockResolvedValue([]),
    getFillHistory: vi.fn().mockResolvedValue([]),
  };
}

function makeMockGridBotDb() {
  return {
    upsertGrvtCredentials: vi.fn().mockResolvedValue(undefined),
    getGrvtCredentialsRaw: vi.fn().mockResolvedValue(null),
    deleteGrvtCredentials: vi.fn().mockResolvedValue(undefined),
    countActiveBotsForUser: vi.fn().mockResolvedValue(0),
    insertTermsAcceptance: vi.fn().mockResolvedValue(undefined),
    touchGrvtCredentialsLastUsed: vi.fn().mockResolvedValue(undefined),
    getFirstAdminUserId: vi.fn().mockResolvedValue('00000000-0000-4000-8000-000000000001'),
  };
}

const API_KEY = 'test-api-key-32-chars-long-xxxx';
const VALID_BOT = {
  pair: 'ETH_USDT_Perp',
  direction: 'long' as const,
  lower_price: 1800,
  upper_price: 2400,
  num_grids: 10,
  investment_usdt: 500,
  leverage: 2,
};

function createTestApp() {
  const db = makeMockDb();
  const grvtClient = makeMockGrvtClient();
  const gridBotDb = makeMockGridBotDb();
  // engineOps mutate the DB row's status so subsequent ownership reads
  // see the post-transition state. This mirrors what the real engine
  // does, just without the GRVT side effects.
  const engineOps = {
    createBot: vi.fn(async (input: { pair: string }) => {
      const row = db._addBot(input.pair, 'paused');
      return row.id;
    }),
    startBot: vi.fn(async (id: number) => {
      db._setStatus(id, 'running');
    }),
    pauseBot: vi.fn(async (id: number) => {
      db._setStatus(id, 'paused');
    }),
    closeBot: vi.fn(async (id: number) => {
      db._setStatus(id, 'stopped');
    }),
    updateBotRange: vi.fn().mockResolvedValue(undefined),
    previewBotRangeUpdate: vi.fn().mockResolvedValue({}),
    rebindGrvtClient: vi.fn().mockResolvedValue(undefined),
  };

  const router = createV2Router({
    db: db as never,
    gridBotDb: gridBotDb as never,
    grvtClient: grvtClient as never,
    engineOps,
    apiKey: API_KEY,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/v2', router);

  return { app, db, engineOps, grvtClient };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Bot lifecycle (D.1)', () => {
  it('happy path: create → start → pause → close', async () => {
    const { app, db, engineOps } = createTestApp();

    // 1. Create. Bots ship in 'paused' so a misclick on Create doesn't
    //    immediately spend money on GRVT.
    const created = await request(app)
      .post('/api/v2/bots')
      .set('X-Api-Key', API_KEY)
      .send(VALID_BOT);
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    expect(engineOps.createBot).toHaveBeenCalledTimes(1);
    expect(db._bots.find((b) => b.id === id)?.status).toBe('paused');

    // 2. Start: routes to engineOps.startBot, status flips to running.
    const started = await request(app)
      .post(`/api/v2/bots/${id}/start`)
      .set('X-Api-Key', API_KEY);
    expect(started.status).toBe(200);
    expect(started.body).toEqual({ id, status: 'running' });
    expect(engineOps.startBot).toHaveBeenCalledWith(id);
    expect(db._bots.find((b) => b.id === id)?.status).toBe('running');

    // 3. Pause: routes to engineOps.pauseBot, status returns to paused.
    //    Pause is reversible — orders cancelled, position kept.
    const paused = await request(app)
      .post(`/api/v2/bots/${id}/pause`)
      .set('X-Api-Key', API_KEY);
    expect(paused.status).toBe(200);
    expect(paused.body).toEqual({ id, status: 'paused' });
    expect(engineOps.pauseBot).toHaveBeenCalledWith(id);
    expect(db._bots.find((b) => b.id === id)?.status).toBe('paused');

    // 4. Close: terminal state. Position market-closed, status stopped.
    const closed = await request(app)
      .post(`/api/v2/bots/${id}/close`)
      .set('X-Api-Key', API_KEY);
    expect(closed.status).toBe(200);
    expect(closed.body).toEqual({ id, status: 'stopped', closedCopies: 0 });
    expect(engineOps.closeBot).toHaveBeenCalledWith(id);
    expect(db._bots.find((b) => b.id === id)?.status).toBe('stopped');
  });

  it('returns 401 when no auth header is sent', async () => {
    const { app, db } = createTestApp();
    const bot = db._addBot('ETH_USDT_Perp', 'paused');

    const noAuth = await request(app).post(`/api/v2/bots/${bot.id}/start`);
    expect(noAuth.status).toBe(401);
  });

  it('returns 404 for an unknown bot id', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/api/v2/bots/9999/start')
      .set('X-Api-Key', API_KEY);
    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric id', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/api/v2/bots/abc/start')
      .set('X-Api-Key', API_KEY);
    expect(res.status).toBe(400);
  });

  it('forwards engineOps errors as 500 with the original message', async () => {
    const { app, db, engineOps } = createTestApp();
    const bot = db._addBot('ETH_USDT_Perp', 'paused');
    engineOps.startBot.mockRejectedValueOnce(new Error('GRVT credentials missing'));

    const res = await request(app)
      .post(`/api/v2/bots/${bot.id}/start`)
      .set('X-Api-Key', API_KEY);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('start_failed');
    expect(res.body.message).toContain('GRVT credentials missing');
    // Status didn't flip — the engine threw before mutating the DB.
    expect(db._bots.find((b) => b.id === bot.id)?.status).toBe('paused');
  });

  it('rejects starting a bot whose pair already has another active bot', async () => {
    // C.9 guard runs at create time — once a paused bot exists on a pair,
    // creating another for the same pair must 409 even if both could
    // theoretically be /start'd from paused.
    const { app, db } = createTestApp();
    db._addBot('ETH_USDT_Perp', 'running');

    const res = await request(app)
      .post('/api/v2/bots')
      .set('X-Api-Key', API_KEY)
      .send(VALID_BOT);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate_instrument');
  });
});
