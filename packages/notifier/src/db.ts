// Read-only query surface over the bot's PostgreSQL database.

import pg, { type QueryResultRow } from 'pg';
import { childLogger } from './logger.js';

const { Pool, types } = pg;
const log = childLogger('db');

// Preserve the value shapes previously returned by SQLite.
types.setTypeParser(20, Number); // int8
types.setTypeParser(1700, Number); // numeric
types.setTypeParser(1114, (value) => value); // timestamp
types.setTypeParser(1184, (value) => value); // timestamptz

export interface DbPool {
  query<T extends QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

export interface BotRow {
  id: number;
  pair: string;
  status: 'running' | 'paused' | 'stopped' | 'error';
  direction: 'long' | 'short';
  leverage: number;
  investment_usdt: number;
  total_pnl_usdt: number;
  grid_profit_usdt: number;
  trend_pnl_usdt: number;
  avg_entry_price: number;
  liquidation_price: number;
  last_error?: string | null;
  // F.1: per-bot alert config (nullable — uses global defaults when null)
  alert_drawdown_pct?: number | null;
  alert_fill_batch?: number | null;
  alert_liq_proximity_pct?: number | null;
  user_id?: string | null;
}

export interface RoundtripRow {
  id: number;
  bot_id: number;
  // user_id of the bot that produced this roundtrip — joined in so
  // per-user fill batching can be done without an extra lookup.
  user_id: string | null;
  buy_price: number;
  sell_price: number;
  size: number;
  profit: number;
  created_at: string;
}

export interface DailySnapshotRow {
  id: number;
  bot_id: number;
  date: string;
  equity: number;
  grid_profit_net: number;
  trend_pnl: number;
  total_pnl: number;
  round_trips: number;
}

export class NotifierDb {
  private readonly pool: DbPool;

  constructor(databaseUrl: string, pool?: DbPool) {
    if (!databaseUrl && !pool) {
      throw new Error('NOTIFIER_DATABASE_URL or DATABASE_URL is required');
    }
    log.info('opening PostgreSQL pool');
    this.pool = pool ?? new Pool({ connectionString: databaseUrl });
  }

  private async all<T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }

  private async get<T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    return (await this.pool.query<T>(sql, params)).rows[0];
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1', []);
  }

  /**
   * All bots, fresh on every poll. Cheap (single row in v0).
   */
  getAllBots(): Promise<BotRow[]> {
    return this.all<BotRow>(
      `SELECT id, pair, status, direction, leverage, investment_usdt,
              total_pnl_usdt, grid_profit_usdt, trend_pnl_usdt,
              avg_entry_price, liquidation_price,
              alert_drawdown_pct, alert_fill_batch, alert_liq_proximity_pct,
              user_id
       FROM grid_bots`
    );
  }

  /**
   * F.2: Get the latest fill price for a bot's instrument as a proxy
   * for mark price. The notifier is read-only on the DB and has no
   * GRVT API access, so the last fill is the best we have.
   */
  async getLastFillPrice(botId: number): Promise<number | null> {
    const row = await this.get<{ price: number }>(
      `SELECT price FROM fills_archive
       WHERE bot_id = $1
       ORDER BY event_time DESC
       LIMIT 1`,
      [botId]
    );
    return row?.price ?? null;
  }

  /**
   * Roundtrips with id > sinceId. Used to detect new fills/profits.
   * Joins grid_bots so the caller can batch + attribute by owner without
   * a second query — important for the multi-tenant fill notifier path.
   */
  getRoundtripsSince(sinceId: number, limit: number = 100): Promise<RoundtripRow[]> {
    return this.all<RoundtripRow>(
      `SELECT pr.id, pr.bot_id, b.user_id, pr.buy_price, pr.sell_price,
              pr.size, pr.profit, pr.created_at
       FROM paired_roundtrips pr
       LEFT JOIN grid_bots b ON b.id = pr.bot_id
       WHERE pr.id > $1
       ORDER BY pr.id ASC
       LIMIT $2`,
      [sinceId, limit]
    );
  }

  /**
   * Latest snapshot for the daily summary.
   */
  getLatestSnapshot(botId: number): Promise<DailySnapshotRow | undefined> {
    return this.get<DailySnapshotRow>(
      `SELECT id, bot_id, date, equity, grid_profit_net, trend_pnl,
              total_pnl, round_trips
       FROM daily_snapshots
       WHERE bot_id = $1
       ORDER BY date DESC
       LIMIT 1`,
      [botId]
    );
  }

  /**
   * Compute the current aggregate equity across all bots.
   * Equity = investment + total_pnl per bot, summed.
   */
  async getCurrentEquity(): Promise<number> {
    const row = await this.get<{ eq: number }>(
      `SELECT COALESCE(SUM(investment_usdt + total_pnl_usdt), 0) as eq
       FROM grid_bots`
    );
    return row?.eq ?? 0;
  }

  async getUserEmail(userId: string): Promise<string | null> {
    const row = await this.get<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [userId]
    );
    return row?.email ?? null;
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
