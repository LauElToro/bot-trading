import type { QueryExecutor } from '../database/postgres.js';
import type { UserId } from '../auth/user-id.js';
import type { GridBotDB } from '../database/db.js';
import { getGrvtClientForBot } from '../api/grvt-client-factory.js';
import { cache } from './cache.js';

export interface AccountSlice {
  equity: number;
  unrealized: number;
  realized: number;
  funding: number;
}

export interface AccountPerformance {
  connected: boolean;
  live: boolean;
  equityUsdt: number;
  unrealizedUsdt: number;
  realizedUsdt: number;
  fundingUsdt: number;
  totalPnlUsdt: number;
  points: Array<{ date: string; equity: number }>;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

/** Read one GRVT account_summary. Account unrealized wins over the position sum. */
export function readAccountSlice(summary: unknown): AccountSlice {
  const row = asRecord(summary) ?? {};
  const positions = Array.isArray(row.positions) ? row.positions : [];
  let realized = 0;
  let positionUnrealized = 0;
  let funding = 0;
  for (const item of positions) {
    const pos = asRecord(item);
    if (!pos) continue;
    realized += num(pos.realized_pnl ?? pos.realized_pnl_usdt);
    positionUnrealized += num(pos.unrealized_pnl ?? pos.unrealized_pnl_usdt);
    funding += num(pos.cumulative_realized_funding_payment ?? pos.funding_payment);
  }
  const reported = row.unrealized_pnl;
  const hasAccountUnrealized = reported != null && String(reported) !== '';
  return {
    equity: num(row.total_equity ?? row.total_cross_equity),
    unrealized: hasAccountUnrealized ? num(reported) : positionUnrealized,
    realized,
    funding,
  };
}

export function combineAccountSlices(slices: AccountSlice[]): Omit<AccountPerformance, 'connected' | 'live' | 'points'> {
  const equity = slices.reduce((sum, slice) => sum + slice.equity, 0);
  const unrealized = slices.reduce((sum, slice) => sum + slice.unrealized, 0);
  const realized = slices.reduce((sum, slice) => sum + slice.realized, 0);
  const funding = slices.reduce((sum, slice) => sum + slice.funding, 0);
  return {
    equityUsdt: money(equity),
    unrealizedUsdt: money(unrealized),
    realizedUsdt: money(realized),
    fundingUsdt: money(funding),
    totalPnlUsdt: money(realized + unrealized),
  };
}

interface SnapshotRow {
  date: string;
  equity: number;
  unrealized: number;
  realized: number;
  funding: number;
}

async function readSnapshots(db: QueryExecutor, userId: string): Promise<SnapshotRow[]> {
  const rows = await db.all<SnapshotRow>(`
    SELECT date, equity, unrealized, realized, funding
    FROM account_equity_daily
    WHERE user_id = ?
    ORDER BY date DESC
    LIMIT 90
  `, [userId]);
  return rows.slice().reverse();
}

function fromSnapshot(row: SnapshotRow | undefined, connected: boolean, points: Array<{ date: string; equity: number }>): AccountPerformance {
  const realized = num(row?.realized);
  const unrealized = num(row?.unrealized);
  return {
    connected,
    live: false,
    equityUsdt: money(num(row?.equity)),
    unrealizedUsdt: money(unrealized),
    realizedUsdt: money(realized),
    fundingUsdt: money(num(row?.funding)),
    totalPnlUsdt: money(realized + unrealized),
    points,
  };
}

export async function loadAccountPerformance(
  db: QueryExecutor,
  userId: string,
  fetchSlices: () => Promise<AccountSlice[] | null>,
): Promise<AccountPerformance> {
  const cacheKey = `account-perf:${userId}`;
  const hit = cache.get<AccountPerformance>(cacheKey);
  if (hit) return hit;

  let slices: AccountSlice[] | null = null;
  let failed = false;
  try {
    slices = await fetchSlices();
  } catch {
    failed = true;
  }

  if (slices && slices.length > 0) {
    const combined = combineAccountSlices(slices);
    const today = new Date().toISOString().slice(0, 10);
    await db.run(`
      INSERT INTO account_equity_daily (user_id, date, equity, unrealized, realized, funding)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, date) DO UPDATE SET
        equity = EXCLUDED.equity,
        unrealized = EXCLUDED.unrealized,
        realized = EXCLUDED.realized,
        funding = EXCLUDED.funding
    `, [userId, today, combined.equityUsdt, combined.unrealizedUsdt, combined.realizedUsdt, combined.fundingUsdt]);
    const snapshots = await readSnapshots(db, userId);
    const view: AccountPerformance = {
      connected: true,
      live: true,
      ...combined,
      points: snapshots.map((row) => ({ date: String(row.date).slice(0, 10), equity: num(row.equity) })),
    };
    cache.set(cacheKey, view, 15_000);
    return view;
  }

  const snapshots = await readSnapshots(db, userId).catch(() => [] as SnapshotRow[]);
  const last = snapshots[snapshots.length - 1];
  const points = snapshots.map((row) => ({ date: String(row.date).slice(0, 10), equity: num(row.equity) }));
  const connected = failed || slices !== null;
  const view = fromSnapshot(last, connected, points);
  cache.set(cacheKey, view, 15_000);
  return view;
}

/** null = no GRVT credentials. [] = credentials exist but every account read failed. */
export async function fetchUserAccountSlices(
  userId: UserId,
  gridBotDb: GridBotDB,
): Promise<AccountSlice[] | null> {
  const has = await gridBotDb.hasGrvtCredentials(userId);
  if (!has) return null;
  const subs = await gridBotDb.listGrvtSubAccounts(userId);
  const targets: Array<number | null> = [null, ...subs.map((row) => row.id)];
  const slices: AccountSlice[] = [];
  for (const subAccountId of targets) {
    try {
      const client = await getGrvtClientForBot(userId, subAccountId, gridBotDb);
      slices.push(readAccountSlice(await client.getAccountSummary()));
    } catch {
      // One sub-account can fail without hiding the rest of the account.
    }
  }
  return slices;
}
