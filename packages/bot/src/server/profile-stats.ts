import type { QueryExecutor } from '../database/postgres.js';
import type { UserId } from '../auth/user-id.js';
import { linkUnlinkedCopies, publicName as traderPublicName } from './community.js';
import { livePnlSql, liveRealizedSql } from './live-pnl.js';
import { parseTagList } from './profile-tags.js';

export type ProfileBotStatus = 'running' | 'paused' | 'stopped' | 'error';

export interface ProfileOwnBot {
  id: number;
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  status: ProfileBotStatus;
  investmentUsdt: number;
  realizedUsdt: number;
  unrealizedUsdt: number;
  pnlUsdt: number;
  pnlPct: number;
  createdAt: string;
  copiedFromBotId: number | null;
  copiedFromName: string | null;
  published: boolean;
  publishedId: number | null;
}

export interface ProfileStrategy {
  id: number;
  title: string;
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  liveStatus: ProfileBotStatus | 'closed';
  ownPnlUsdt: number;
  ownPnlPct: number;
  copiesCount: number;
  copiesCreated: number;
  uniqueCopiers: number;
  copiesRunning: number;
  copiesPaused: number;
  copiesClosed: number;
  copierInvestedUsdt: number;
  copierPnlUsdt: number;
  copierPnlPct: number;
  publishedAt: number;
  sourceBotId: number | null;
}

export interface ProfileCopier {
  id: string;
  name: string;
  tags: string[];
  hasAvatar: boolean;
  botId: number | null;
  pair: string | null;
  status: 'running' | 'paused' | 'stopped' | null;
  investmentUsdt: number | null;
  pnlUsdt: number | null;
  pnlPct: number | null;
}

export interface TraderProfile {
  bots: {
    created: number;
    running: number;
    paused: number;
    closed: number;
    published: number;
    copiedFromOthers: number;
    roundtrips: number;
  };
  earnings: {
    investedUsdt: number;
    originalInvestedUsdt: number;
    realizedUsdt: number;
    unrealizedUsdt: number;
    totalPnlUsdt: number;
    totalPnlPct: number;
    pnlRunningUsdt: number;
    pnlPausedUsdt: number;
    pnlClosedUsdt: number;
    investedRunningUsdt: number;
    reinvestedUsdt: number;
    pairedProfitUsdt: number;
    feesUsdt: number;
    fundingUsdt: number;
  };
  audience: {
    uniqueCopiers: number;
    copyInterests: number;
    uniqueInterestPeople: number;
    copiesCreated: number;
    copiesRunning: number;
    copiesPaused: number;
    copiesClosed: number;
    investedUsdt: number;
    realizedUsdt: number;
    unrealizedUsdt: number;
    pnlUsdt: number;
    pnlPct: number;
  };
  copiers: ProfileCopier[];
  strategies: ProfileStrategy[];
  ownBots: ProfileOwnBot[];
  bestBotId: number | null;
  worstBotId: number | null;
}

interface OwnAggRow {
  created: number;
  running: number;
  paused: number;
  closed: number;
  copied_from_others: number;
  invested: number;
  original_invested: number;
  realized: number;
  unrealized: number;
  reinvested: number;
  pnl_running: number;
  pnl_paused: number;
  pnl_closed: number;
  invested_running: number;
}

interface LedgerRow {
  roundtrips: number;
  paired_profit: number;
  fees: number;
  funding: number;
}

interface AudienceRow {
  unique_copiers: number;
  copies_created: number;
  copies_running: number;
  copies_paused: number;
  copies_closed: number;
  invested: number;
  realized: number;
  unrealized: number;
}

interface InterestRow {
  copy_interests: number;
  unique_interest_people: number;
}

interface StrategyRow {
  id: number;
  title: string;
  pair: string;
  direction: string;
  leverage: number;
  pnl_usdt: number;
  pnl_pct: number;
  copies_count: number;
  published_at: number;
  source_bot_id: number | null;
  live_status: string | null;
  copies_created: number;
  unique_copiers: number;
  copies_running: number;
  copies_paused: number;
  copies_closed: number;
  copier_invested: number;
  copier_realized: number;
  copier_unrealized: number;
}

interface BotRow {
  id: number;
  pair: string;
  direction: string;
  leverage: number;
  status: string;
  investment_usdt: number;
  grid_profit_usdt: number;
  trend_pnl_usdt: number;
  created_at: string;
  copied_from_bot_id: number | null;
  published: number | boolean;
  published_id?: number | null;
  copied_from_name: string | null;
}

interface CopierRow {
  user_id: string;
  display_name: string | null;
  email: string;
  tags: unknown;
  has_avatar: boolean | number | null;
  bot_id: number | null;
  pair: string | null;
  status: string | null;
  investment_usdt: number | null;
  grid_profit_usdt: number | null;
  trend_pnl_usdt: number | null;
}

export interface ProfileParts {
  own: OwnAggRow;
  ledger: LedgerRow;
  audience: AudienceRow;
  interest: InterestRow;
  strategies: StrategyRow[];
  bots: BotRow[];
  copiers?: CopierRow[];
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function pct(pnl: number, invested: number): number {
  if (!(invested > 0)) return 0;
  return money((pnl / invested) * 100);
}

function asDirection(value: string): 'long' | 'short' {
  return value === 'short' ? 'short' : 'long';
}

function asStatus(value: string | null | undefined): ProfileBotStatus {
  if (value === 'running' || value === 'paused' || value === 'stopped' || value === 'error') {
    return value;
  }
  return 'stopped';
}

function publicName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 24);
}

export function assembleTraderProfile(parts: ProfileParts): TraderProfile {
  const realized = num(parts.own.realized);
  const unrealized = num(parts.own.unrealized);
  const totalPnl = realized + unrealized;
  const invested = num(parts.own.invested);
  const copierRealized = num(parts.audience.realized);
  const copierUnrealized = num(parts.audience.unrealized);
  const copierPnl = copierRealized + copierUnrealized;
  const copierInvested = num(parts.audience.invested);

  const ownBots: ProfileOwnBot[] = parts.bots.map((row) => {
    const botRealized = num(row.grid_profit_usdt);
    const botUnrealized = num(row.trend_pnl_usdt);
    const botPnl = botRealized + botUnrealized;
    const botInvested = num(row.investment_usdt);
    return {
      id: num(row.id),
      pair: row.pair,
      direction: asDirection(row.direction),
      leverage: num(row.leverage),
      status: asStatus(row.status),
      investmentUsdt: money(botInvested),
      realizedUsdt: money(botRealized),
      unrealizedUsdt: money(botUnrealized),
      pnlUsdt: money(botPnl),
      pnlPct: pct(botPnl, botInvested),
      createdAt: String(row.created_at ?? ''),
      copiedFromBotId: row.copied_from_bot_id == null ? null : num(row.copied_from_bot_id),
      copiedFromName: publicName(row.copied_from_name),
      published: row.published === true || num(row.published) === 1,
      publishedId: row.published_id == null ? null : num(row.published_id),
    };
  });

  let bestBotId: number | null = null;
  let worstBotId: number | null = null;
  let bestPnl = -Infinity;
  let worstPnl = Infinity;
  for (const bot of ownBots) {
    if (bot.pnlUsdt > bestPnl) {
      bestPnl = bot.pnlUsdt;
      bestBotId = bot.id;
    }
    if (bot.pnlUsdt < worstPnl) {
      worstPnl = bot.pnlUsdt;
      worstBotId = bot.id;
    }
  }

  const strategies: ProfileStrategy[] = parts.strategies.map((row) => {
    const strategyInvested = num(row.copier_invested);
    const strategyPnl = num(row.copier_realized) + num(row.copier_unrealized);
    const live = row.live_status;
    return {
      id: num(row.id),
      title: row.title,
      pair: row.pair,
      direction: asDirection(row.direction),
      leverage: num(row.leverage),
      liveStatus: live === 'closed' ? 'closed' : asStatus(live),
      ownPnlUsdt: money(num(row.pnl_usdt)),
      ownPnlPct: money(num(row.pnl_pct)),
      copiesCount: num(row.copies_count),
      copiesCreated: num(row.copies_created),
      uniqueCopiers: num(row.unique_copiers),
      copiesRunning: num(row.copies_running),
      copiesPaused: num(row.copies_paused),
      copiesClosed: num(row.copies_closed),
      copierInvestedUsdt: money(strategyInvested),
      copierPnlUsdt: money(strategyPnl),
      copierPnlPct: pct(strategyPnl, strategyInvested),
      publishedAt: num(row.published_at),
      sourceBotId: row.source_bot_id == null ? null : num(row.source_bot_id),
    };
  });

  return {
    bots: {
      created: num(parts.own.created),
      running: num(parts.own.running),
      paused: num(parts.own.paused),
      closed: num(parts.own.closed),
      published: strategies.length,
      copiedFromOthers: num(parts.own.copied_from_others),
      roundtrips: num(parts.ledger.roundtrips),
    },
    earnings: {
      investedUsdt: money(invested),
      originalInvestedUsdt: money(num(parts.own.original_invested)),
      realizedUsdt: money(realized),
      unrealizedUsdt: money(unrealized),
      totalPnlUsdt: money(totalPnl),
      totalPnlPct: pct(totalPnl, invested),
      pnlRunningUsdt: money(num(parts.own.pnl_running)),
      pnlPausedUsdt: money(num(parts.own.pnl_paused)),
      pnlClosedUsdt: money(num(parts.own.pnl_closed)),
      investedRunningUsdt: money(num(parts.own.invested_running)),
      reinvestedUsdt: money(num(parts.own.reinvested)),
      pairedProfitUsdt: money(num(parts.ledger.paired_profit)),
      feesUsdt: money(num(parts.ledger.fees)),
      fundingUsdt: money(num(parts.ledger.funding)),
    },
    audience: {
      uniqueCopiers: num(parts.audience.unique_copiers),
      copyInterests: num(parts.interest.copy_interests),
      uniqueInterestPeople: num(parts.interest.unique_interest_people),
      copiesCreated: num(parts.audience.copies_created),
      copiesRunning: num(parts.audience.copies_running),
      copiesPaused: num(parts.audience.copies_paused),
      copiesClosed: num(parts.audience.copies_closed),
      investedUsdt: money(copierInvested),
      realizedUsdt: money(copierRealized),
      unrealizedUsdt: money(copierUnrealized),
      pnlUsdt: money(copierPnl),
      pnlPct: pct(copierPnl, copierInvested),
    },
    strategies,
    ownBots,
    bestBotId,
    worstBotId,
    copiers: (parts.copiers ?? []).map((row) => {
      const invested = row.investment_usdt == null ? null : num(row.investment_usdt);
      const pnl = row.bot_id == null
        ? null
        : num(row.grid_profit_usdt) + num(row.trend_pnl_usdt);
      const status = row.status === 'running' || row.status === 'paused' || row.status === 'stopped'
        ? row.status
        : null;
      return {
        id: row.user_id,
        name: traderPublicName(row.display_name, row.email),
        tags: parseTagList(row.tags),
        hasAvatar: Boolean(row.has_avatar),
        botId: row.bot_id == null ? null : num(row.bot_id),
        pair: row.pair,
        status,
        investmentUsdt: invested == null ? null : money(invested),
        pnlUsdt: pnl == null ? null : money(pnl),
        pnlPct: pnl == null || invested == null ? null : pct(pnl, invested),
      };
    }),
  };
}

const EMPTY_OWN: OwnAggRow = {
  created: 0,
  running: 0,
  paused: 0,
  closed: 0,
  copied_from_others: 0,
  invested: 0,
  original_invested: 0,
  realized: 0,
  unrealized: 0,
  reinvested: 0,
  pnl_running: 0,
  pnl_paused: 0,
  pnl_closed: 0,
  invested_running: 0,
};

const EMPTY_LEDGER: LedgerRow = {
  roundtrips: 0,
  paired_profit: 0,
  fees: 0,
  funding: 0,
};

const EMPTY_AUDIENCE: AudienceRow = {
  unique_copiers: 0,
  copies_created: 0,
  copies_running: 0,
  copies_paused: 0,
  copies_closed: 0,
  invested: 0,
  realized: 0,
  unrealized: 0,
};

const EMPTY_INTEREST: InterestRow = {
  copy_interests: 0,
  unique_interest_people: 0,
};

export async function loadTraderProfile(db: QueryExecutor, userId: UserId): Promise<TraderProfile> {
  await linkUnlinkedCopies(db);
  const [own, ledger, audience, interest, strategies, bots, copiers] = await Promise.all([
    db.get<OwnAggRow>(`
      SELECT
        COUNT(*) AS created,
        COUNT(*) FILTER (WHERE status = 'running') AS running,
        COUNT(*) FILTER (WHERE status = 'paused') AS paused,
        COUNT(*) FILTER (WHERE status NOT IN ('running', 'paused')) AS closed,
        COUNT(*) FILTER (WHERE copied_from_bot_id IS NOT NULL) AS copied_from_others,
        COALESCE(SUM(investment_usdt), 0) AS invested,
        COALESCE(SUM(original_investment_usdt), 0) AS original_invested,
        COALESCE(SUM(${liveRealizedSql()}), 0) AS realized,
        COALESCE(SUM(trend_pnl_usdt), 0) AS unrealized,
        COALESCE(SUM(total_reinvested), 0) AS reinvested,
        COALESCE(SUM(CASE WHEN status = 'running' THEN ${livePnlSql()} ELSE 0 END), 0) AS pnl_running,
        COALESCE(SUM(CASE WHEN status = 'paused' THEN ${livePnlSql()} ELSE 0 END), 0) AS pnl_paused,
        COALESCE(SUM(CASE WHEN status NOT IN ('running', 'paused') THEN ${livePnlSql()} ELSE 0 END), 0) AS pnl_closed,
        COALESCE(SUM(CASE WHEN status = 'running' THEN investment_usdt ELSE 0 END), 0) AS invested_running
      FROM grid_bots
      WHERE user_id = ?
    `, [userId]),
    db.get<LedgerRow>(`
      SELECT
        (SELECT COUNT(*)
           FROM paired_roundtrips pr
           JOIN grid_bots b ON b.id = pr.bot_id
          WHERE b.user_id = ?) AS roundtrips,
        (SELECT COALESCE(SUM(pr.profit), 0)
           FROM paired_roundtrips pr
           JOIN grid_bots b ON b.id = pr.bot_id
          WHERE b.user_id = ?) AS paired_profit,
        (SELECT COALESCE(SUM(fa.fee), 0)
           FROM fills_archive fa
           JOIN grid_bots b ON b.id = fa.bot_id
          WHERE b.user_id = ?) AS fees,
        (SELECT COALESCE(SUM(fh.payment_usdt), 0)
           FROM funding_history fh
           JOIN grid_bots b ON b.id = fh.bot_id
          WHERE b.user_id = ?) AS funding
    `, [userId, userId, userId, userId]),
    db.get<AudienceRow>(`
      SELECT
        COUNT(DISTINCT c.user_id) AS unique_copiers,
        COUNT(*) AS copies_created,
        COUNT(*) FILTER (WHERE c.status = 'running') AS copies_running,
        COUNT(*) FILTER (WHERE c.status = 'paused') AS copies_paused,
        COUNT(*) FILTER (WHERE c.status NOT IN ('running', 'paused')) AS copies_closed,
        COALESCE(SUM(c.investment_usdt), 0) AS invested,
        COALESCE(SUM(${liveRealizedSql('c')}), 0) AS realized,
        COALESCE(SUM(c.trend_pnl_usdt), 0) AS unrealized
      FROM grid_bots c
      JOIN grid_bots owner ON owner.id = c.copied_from_bot_id
      WHERE owner.user_id = ?
    `, [userId]),
    db.get<InterestRow>(`
      SELECT
        COUNT(*) AS copy_interests,
        COUNT(DISTINCT c.copier_id) AS unique_interest_people
      FROM published_bot_copies c
      JOIN published_bots pb ON pb.id = c.published_id
      WHERE pb.user_id = ?
        AND pb.seed_key IS NULL
    `, [userId]),
    db.all<StrategyRow>(`
      SELECT
        pb.id,
        pb.title,
        pb.pair,
        pb.direction,
        pb.leverage,
        CASE
          WHEN gb.id IS NULL THEN pb.pnl_usdt
          ELSE ${livePnlSql('gb')}
        END AS pnl_usdt,
        CASE
          WHEN gb.id IS NULL THEN pb.pnl_pct
          WHEN COALESCE(gb.investment_usdt, 0) > 0 THEN (${livePnlSql('gb')} / gb.investment_usdt) * 100
          ELSE 0
        END AS pnl_pct,
        pb.copies_count,
        pb.published_at,
        pb.source_bot_id,
        COALESCE(gb.status, 'closed') AS live_status,
        COALESCE(stats.copies_created, 0) AS copies_created,
        COALESCE(stats.unique_copiers, 0) AS unique_copiers,
        COALESCE(stats.copies_running, 0) AS copies_running,
        COALESCE(stats.copies_paused, 0) AS copies_paused,
        COALESCE(stats.copies_closed, 0) AS copies_closed,
        COALESCE(stats.invested, 0) AS copier_invested,
        COALESCE(stats.realized, 0) AS copier_realized,
        COALESCE(stats.unrealized, 0) AS copier_unrealized
      FROM published_bots pb
      LEFT JOIN grid_bots gb ON gb.id = pb.source_bot_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS copies_created,
          COUNT(DISTINCT user_id) AS unique_copiers,
          COUNT(*) FILTER (WHERE status = 'running') AS copies_running,
          COUNT(*) FILTER (WHERE status = 'paused') AS copies_paused,
          COUNT(*) FILTER (WHERE status NOT IN ('running', 'paused')) AS copies_closed,
          COALESCE(SUM(investment_usdt), 0) AS invested,
          COALESCE(SUM(${liveRealizedSql()}), 0) AS realized,
          COALESCE(SUM(trend_pnl_usdt), 0) AS unrealized
        FROM grid_bots
        WHERE copied_from_bot_id = pb.source_bot_id
      ) stats ON TRUE
      WHERE pb.user_id = ?
        AND pb.seed_key IS NULL
      ORDER BY pb.published_at DESC
    `, [userId]),
    db.all<BotRow>(`
      SELECT
        gb.id,
        gb.pair,
        gb.direction,
        gb.leverage,
        gb.status,
        gb.investment_usdt,
        ${liveRealizedSql('gb')} AS grid_profit_usdt,
        gb.trend_pnl_usdt,
        gb.created_at,
        gb.copied_from_bot_id,
        CASE WHEN pb.id IS NOT NULL THEN 1 ELSE 0 END AS published,
        pb.id AS published_id,
        COALESCE(
          NULLIF(BTRIM(author.display_name), ''),
          NULLIF(SPLIT_PART(author.email, '@', 1), '')
        ) AS copied_from_name
      FROM grid_bots gb
      LEFT JOIN published_bots pb
        ON pb.source_bot_id = gb.id
       AND pb.user_id = gb.user_id
       AND pb.seed_key IS NULL
      LEFT JOIN grid_bots src ON src.id = gb.copied_from_bot_id
      LEFT JOIN users author ON author.id = src.user_id
      WHERE gb.user_id = ?
      ORDER BY
        CASE gb.status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
        ${livePnlSql('gb')} DESC,
        gb.id DESC
    `, [userId]),
    db.all<CopierRow>(`
      SELECT
        cu.id AS user_id,
        cu.display_name,
        cu.email,
        COALESCE((
          SELECT json_agg(ut.tag ORDER BY ut.position)
          FROM user_tags ut
          WHERE ut.user_id = cu.id
        ), '[]'::json) AS tags,
        (cu.avatar_url IS NOT NULL) AS has_avatar,
        c.id AS bot_id,
        c.pair,
        c.status,
        c.investment_usdt,
        ${liveRealizedSql('c')} AS grid_profit_usdt,
        c.trend_pnl_usdt
      FROM published_bot_copies pbc
      JOIN published_bots pb ON pb.id = pbc.published_id
      JOIN users cu ON cu.id = pbc.copier_id
      LEFT JOIN grid_bots c
        ON c.user_id = pbc.copier_id
       AND c.copied_from_bot_id = pb.source_bot_id
      WHERE pb.user_id = ?
        AND pb.seed_key IS NULL
        AND pbc.copier_id <> pb.user_id
        AND c.status = 'running'
      ORDER BY (COALESCE(c.grid_profit_usdt, 0) + COALESCE(c.trend_pnl_usdt, 0)) DESC, cu.id
    `, [userId]),
  ]);

  return assembleTraderProfile({
    own: own ?? EMPTY_OWN,
    ledger: ledger ?? EMPTY_LEDGER,
    audience: audience ?? EMPTY_AUDIENCE,
    interest: interest ?? EMPTY_INTEREST,
    strategies,
    bots,
    copiers,
  });
}

/** Today's point tracks live equity, not the snapshot taken at process boot. */
export function stampLiveEquity(
  points: Array<{ date: string; equity: number }>,
  liveEquity: number,
  today = new Date().toISOString().slice(0, 10),
): Array<{ date: string; equity: number }> {
  const next = points.map((point) => ({
    date: String(point.date).slice(0, 10),
    equity: num(point.equity),
  }));
  const equity = money(liveEquity);
  const last = next[next.length - 1];
  if (last?.date === today) {
    last.equity = equity;
    return next;
  }
  next.push({ date: today, equity });
  return next;
}

export async function loadLiveEquity(db: QueryExecutor, userId: UserId): Promise<number> {
  const row = await db.get<{ equity: number }>(`
    SELECT COALESCE(SUM(investment_usdt + ${livePnlSql()}), 0) AS equity
    FROM grid_bots
    WHERE user_id = ? AND status != 'stopped'
  `, [userId]);
  return num(row?.equity);
}

export async function loadTraderEquityCurve(
  db: QueryExecutor,
  userId: UserId,
  days = 90,
): Promise<Array<{ date: string; equity: number }>> {
  const span = Math.min(Math.max(days, 1), 365);
  const rows = await db.all<{ date: string; equity: number }>(`
    SELECT s.date, SUM(s.equity) AS equity
    FROM daily_snapshots s
    JOIN grid_bots b ON b.id = s.bot_id
    WHERE b.user_id = ?
      AND b.status != 'stopped'
      AND s.date >= TO_CHAR(CURRENT_DATE - (?::integer * INTERVAL '1 day'), 'YYYY-MM-DD')
    GROUP BY s.date
    ORDER BY s.date ASC
  `, [userId, span]);
  const points = rows.map((row) => ({
    date: String(row.date).slice(0, 10),
    equity: num(row.equity),
  }));
  return stampLiveEquity(points, await loadLiveEquity(db, userId));
}
