import { describe, expect, it } from 'vitest';
import { cache } from '../src/server/cache';
import {
  combineAccountSlices,
  loadAccountPerformance,
  readAccountSlice,
  type AccountSlice,
} from '../src/server/account-performance';
import type { QueryExecutor } from '../src/database/postgres';

function memoryDb() {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    rows,
    async run(sql: string, params: readonly unknown[] = []) {
      if (sql.includes('INSERT INTO account_equity_daily')) {
        const [user_id, date, equity, unrealized, realized, funding] = params;
        const next = { user_id, date, equity, unrealized, realized, funding };
        const index = rows.findIndex((row) => row.user_id === user_id && row.date === date);
        if (index >= 0) rows[index] = next;
        else rows.push(next);
      }
      return { changes: 1 };
    },
    async get() {
      return undefined;
    },
    async all(sql: string, params: readonly unknown[] = []) {
      if (!sql.includes('account_equity_daily')) return [];
      return rows
        .filter((row) => row.user_id === params[0])
        .slice()
        .reverse();
    },
    async transaction<T>(work: (executor: QueryExecutor) => Promise<T>) {
      return work(db);
    },
  };
  return db;
}

describe('account performance', () => {
  it('reads equity and position pnl from a GRVT account summary', () => {
    const slice = readAccountSlice({
      total_equity: '1050.5',
      unrealized_pnl: '12.25',
      positions: [
        { realized_pnl: '30', unrealized_pnl: '99', cumulative_realized_funding_payment: '-1.5' },
        { realized_pnl: '4.5', cumulative_realized_funding_payment: '0.25' },
      ],
    });
    expect(slice).toEqual({
      equity: 1050.5,
      unrealized: 12.25,
      realized: 34.5,
      funding: -1.25,
    });
  });

  it('falls back to the position unrealized when the account field is missing', () => {
    const slice = readAccountSlice({
      total_cross_equity: '800',
      positions: [{ unrealized_pnl: '3', realized_pnl: '1' }],
    });
    expect(slice.equity).toBe(800);
    expect(slice.unrealized).toBe(3);
    expect(slice.realized).toBe(1);
  });

  it('adds every connected sub-account', () => {
    const slices: AccountSlice[] = [
      { equity: 1000, unrealized: 10, realized: 20, funding: -1 },
      { equity: 250.456, unrealized: -4, realized: 1.2, funding: 0.4 },
    ];
    expect(combineAccountSlices(slices)).toEqual({
      equityUsdt: 1250.46,
      unrealizedUsdt: 6,
      realizedUsdt: 21.2,
      fundingUsdt: -0.6,
      totalPnlUsdt: 27.2,
    });
  });

  it('stores today and reports the account, not a bot ledger', async () => {
    cache.clear();
    const db = memoryDb();
    const view = await loadAccountPerformance(db as unknown as QueryExecutor, 'user-1', async () => [
      { equity: 1500, unrealized: 8, realized: 40, funding: -2 },
    ]);
    expect(view.connected).toBe(true);
    expect(view.live).toBe(true);
    expect(view.totalPnlUsdt).toBe(48);
    expect(view.equityUsdt).toBe(1500);
    expect(view.points).toHaveLength(1);
    expect(db.rows).toHaveLength(1);
  });

  it('says the account is disconnected when there are no credentials', async () => {
    cache.clear();
    const db = memoryDb();
    const view = await loadAccountPerformance(db as unknown as QueryExecutor, 'user-2', async () => null);
    expect(view.connected).toBe(false);
    expect(view.live).toBe(false);
    expect(view.totalPnlUsdt).toBe(0);
  });
});
