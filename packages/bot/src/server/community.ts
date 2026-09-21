import type { QueryExecutor } from '../database/postgres.js';
import type { UserId } from '../auth/user-id.js';

export interface PublishedBotRow {
  id: number;
  user_id: string;
  source_bot_id: number | null;
  title: string;
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  lower_price: number;
  upper_price: number;
  num_grids: number;
  investment_usdt: number;
  virtual_enabled: number;
  active_window_size: number | null;
  sl_pct: number | null;
  tp_pct: number | null;
  auto_shift_enabled: number;
  auto_shift_pct: number | null;
  compound_pct: number | null;
  safeguard_enabled: number;
  safeguard_threshold_pct: number | null;
  safeguard_action: string | null;
  pnl_usdt: number;
  pnl_pct: number;
  copies_count: number;
  published_at: number;
  updated_at: number;
  seed_key?: string | null;
  author_name: string | null;
  author_email: string;
  author_has_avatar: number;
}

const AUTHOR_TOTAL_SEED = 'featured-author-total';
const HIDDEN_FEATURED_SEED = 'featured-bnb-10x-80';

function publicName(displayName: string | null | undefined, email: string): string {
  const trimmed = displayName?.trim();
  if (trimmed) return trimmed;
  const local = email.split('@')[0] ?? 'trader';
  return local.slice(0, 24);
}

export function rangeWidthPct(lower: number, upper: number): number {
  const mid = (lower + upper) / 2;
  return mid > 0 ? ((upper - lower) / mid) * 100 : 0;
}

function roundPrice(value: number, mark: number): number {
  if (mark >= 1000) return Math.round(value * 100) / 100;
  if (mark >= 10) return Math.round(value * 100) / 100;
  return Math.round(value * 10_000) / 10_000;
}

/** Keep the original band width and recenter it on the current mark. */
export function recenterRange(
  lower: number,
  upper: number,
  mark: number,
): { lower: number; upper: number } {
  const mid = (lower + upper) / 2;
  if (!(mid > 0) || !(mark > 0) || !(upper > lower)) return { lower, upper };
  const half = (upper - lower) / 2 / mid;
  return {
    lower: roundPrice(mark * (1 - half), mark),
    upper: roundPrice(mark * (1 + half), mark),
  };
}

export function parseMarkPrice(ticker: unknown): number | null {
  const raw = ticker as { last_price?: string | number; mark_price?: string | number };
  const mark = parseFloat(String(raw.mark_price ?? raw.last_price ?? ''));
  return Number.isFinite(mark) && mark > 0 ? mark : null;
}

export function toLeaderCard(row: PublishedBotRow, rank: number) {
  return {
    id: row.id,
    rank,
    title: row.title,
    pair: row.pair,
    direction: row.direction,
    leverage: row.leverage,
    lowerPrice: row.lower_price,
    upperPrice: row.upper_price,
    rangeWidthPct: rangeWidthPct(row.lower_price, row.upper_price),
    numGrids: row.num_grids,
    investmentUsdt: row.investment_usdt,
    virtualEnabled: row.virtual_enabled === 1,
    activeWindowSize: row.active_window_size,
    slPct: row.sl_pct,
    tpPct: row.tp_pct,
    autoShiftEnabled: row.auto_shift_enabled === 1,
    autoShiftPct: row.auto_shift_pct,
    compoundPct: row.compound_pct,
    pnlUsdt: row.pnl_usdt,
    pnlPct: row.pnl_pct,
    copiesCount: row.copies_count,
    publishedAt: row.published_at,
    isAuthorTotal: row.seed_key === AUTHOR_TOTAL_SEED,
    author: {
      id: row.user_id,
      name: publicName(row.author_name, row.author_email),
      hasAvatar: row.author_has_avatar === 1,
    },
  };
}

const LEADER_SELECT = `
  SELECT
    pb.id, pb.user_id, pb.source_bot_id, pb.title, pb.pair, pb.direction,
    pb.leverage, pb.lower_price, pb.upper_price, pb.num_grids, pb.investment_usdt,
    pb.virtual_enabled, pb.active_window_size, pb.sl_pct, pb.tp_pct,
    pb.auto_shift_enabled, pb.auto_shift_pct, pb.compound_pct,
    pb.safeguard_enabled, pb.safeguard_threshold_pct, pb.safeguard_action,
    pb.pnl_usdt, pb.pnl_pct, pb.copies_count, pb.published_at, pb.updated_at,
    pb.seed_key,
    u.display_name AS author_name,
    u.email AS author_email,
    CASE WHEN u.avatar_url IS NOT NULL AND u.avatar_url <> '' THEN 1 ELSE 0 END AS author_has_avatar
  FROM published_bots pb
  JOIN users u ON u.id = pb.user_id
`;

export async function refreshPublishedStats(db: QueryExecutor): Promise<void> {
  await db.run(`
    UPDATE published_bots pb
    SET
      pnl_usdt = gb.total_pnl_usdt,
      pnl_pct = CASE
        WHEN gb.investment_usdt > 0 THEN (gb.total_pnl_usdt / gb.investment_usdt) * 100
        ELSE 0
      END,
      updated_at = ?
    FROM grid_bots gb
    WHERE pb.source_bot_id = gb.id
  `, [Date.now()]);
}

export async function listLeaders(db: QueryExecutor, limit = 10): Promise<PublishedBotRow[]> {
  await refreshPublishedStats(db);
  await refreshAuthorTotals(db);
  return db.all<PublishedBotRow>(`
    ${LEADER_SELECT}
    WHERE pb.seed_key IS NULL OR pb.seed_key <> ?
    ORDER BY
      CASE WHEN pb.seed_key = ? THEN 1 ELSE 0 END ASC,
      pb.pnl_pct DESC, pb.copies_count DESC, pb.published_at DESC
    LIMIT ?
  `, [HIDDEN_FEATURED_SEED, AUTHOR_TOTAL_SEED, limit]);
}

export async function getPublishedBot(
  db: QueryExecutor,
  id: number,
): Promise<PublishedBotRow | undefined> {
  return db.get<PublishedBotRow>(`
    ${LEADER_SELECT}
    WHERE pb.id = ?
  `, [id]);
}

export async function getPublishedBySource(
  db: QueryExecutor,
  userId: UserId,
  sourceBotId: number,
): Promise<{ id: number } | undefined> {
  return db.get<{ id: number }>(
    `SELECT id FROM published_bots WHERE user_id = ? AND source_bot_id = ?`,
    [userId, sourceBotId],
  );
}

export async function recordCopy(
  db: QueryExecutor,
  publishedId: number,
  copierId: UserId,
): Promise<{ copiesCount: number; alreadyCopied: boolean }> {
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM published_bot_copies WHERE published_id = ? AND copier_id = ?`,
    [publishedId, copierId],
  );
  if (existing) {
    const row = await db.get<{ copies_count: number }>(
      `SELECT copies_count FROM published_bots WHERE id = ?`,
      [publishedId],
    );
    return { copiesCount: row?.copies_count ?? 0, alreadyCopied: true };
  }
  await db.run(
    `INSERT INTO published_bot_copies (published_id, copier_id, created_at) VALUES (?, ?, ?)`,
    [publishedId, copierId, Date.now()],
  );
  await db.run(
    `UPDATE published_bots SET copies_count = copies_count + 1 WHERE id = ?`,
    [publishedId],
  );
  const row = await db.get<{ copies_count: number }>(
    `SELECT copies_count FROM published_bots WHERE id = ?`,
    [publishedId],
  );
  return { copiesCount: row?.copies_count ?? 1, alreadyCopied: false };
}

const FEATURED_AUTHOR_EMAIL = 'lautyfigueroalau@gmail.com';

const FEATURED_LEADERS = [
  {
    seedKey: 'featured-eth-10x-50',
    title: 'ETH long 10x · 50 niveles',
    pair: 'ETH_USDT_Perp',
    direction: 'long' as const,
    leverage: 10,
    lower: 2386,
    upper: 2665,
    grids: 50,
    investment: 100,
    pnlUsdt: 43.09,
    pnlPct: 43.09,
  },
  {
    seedKey: 'featured-bnb-10x-90',
    title: 'BNB long 10x · 90 niveles',
    pair: 'BNB_USDT_Perp',
    direction: 'long' as const,
    leverage: 10,
    lower: 707,
    upper: 740,
    grids: 90,
    investment: 70,
    pnlUsdt: 9.92,
    pnlPct: 14.17,
  },
  {
    seedKey: 'featured-sol-10x-90',
    title: 'SOL long 10x · 90 niveles',
    pair: 'SOL_USDT_Perp',
    direction: 'long' as const,
    leverage: 10,
    lower: 96,
    upper: 105,
    grids: 90,
    investment: 100,
    pnlUsdt: 4,
    pnlPct: 4,
  },
  {
    seedKey: HIDDEN_FEATURED_SEED,
    title: 'BNB long 10x · 80 niveles',
    pair: 'BNB_USDT_Perp',
    direction: 'long' as const,
    leverage: 10,
    lower: 742,
    upper: 780,
    grids: 80,
    investment: 150,
    pnlUsdt: 0.58,
    pnlPct: 0.38,
  },
  {
    seedKey: AUTHOR_TOTAL_SEED,
    title: 'Total de todos sus bots',
    pair: 'PORTFOLIO',
    direction: 'long' as const,
    leverage: 10,
    lower: 1,
    upper: 2,
    grids: 2,
    investment: 420,
    pnlUsdt: 57.59,
    pnlPct: 61.64,
  },
];

async function authorBotPctTotal(db: QueryExecutor, userId: string): Promise<{ pct: number; usdt: number; investment: number }> {
  const live = await db.get<{ pct: number; usdt: number; investment: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN investment_usdt > 0 THEN (total_pnl_usdt / investment_usdt) * 100 ELSE 0 END), 0) AS pct,
       COALESCE(SUM(total_pnl_usdt), 0) AS usdt,
       COALESCE(SUM(investment_usdt), 0) AS investment
     FROM grid_bots
     WHERE user_id = ?`,
    [userId],
  );
  if (live && live.investment > 0) {
    return { pct: live.pct, usdt: live.usdt, investment: live.investment };
  }
  const published = await db.get<{ pct: number; usdt: number; investment: number }>(
    `SELECT
       COALESCE(SUM(pnl_pct), 0) AS pct,
       COALESCE(SUM(pnl_usdt), 0) AS usdt,
       COALESCE(SUM(investment_usdt), 0) AS investment
     FROM published_bots
     WHERE user_id = ?
       AND (seed_key IS NULL OR seed_key <> ?)`,
    [userId, AUTHOR_TOTAL_SEED],
  );
  return {
    pct: published?.pct ?? 0,
    usdt: published?.usdt ?? 0,
    investment: published?.investment ?? 0,
  };
}

async function refreshAuthorTotals(db: QueryExecutor): Promise<void> {
  const totals = await db.all<{ id: number; user_id: string }>(
    `SELECT id, user_id FROM published_bots WHERE seed_key = ?`,
    [AUTHOR_TOTAL_SEED],
  );
  const now = Date.now();
  for (const row of totals) {
    const stats = await authorBotPctTotal(db, row.user_id);
    await db.run(
      `UPDATE published_bots
       SET pnl_pct = ?, pnl_usdt = ?, investment_usdt = ?, updated_at = ?
       WHERE id = ?`,
      [stats.pct, stats.usdt, stats.investment || 420, now, row.id],
    );
  }
}

export async function seedFeaturedLeaders(db: QueryExecutor): Promise<void> {
  const author = await db.get<{ id: string }>(
    `SELECT id FROM users WHERE email = ?`,
    [FEATURED_AUTHOR_EMAIL],
  );
  if (!author) return;
  const now = Date.now();
  for (const bot of FEATURED_LEADERS) {
    const existing = await db.get<{ id: number }>(
      `SELECT id FROM published_bots WHERE seed_key = ?`,
      [bot.seedKey],
    );
    if (existing) {
      await db.run(
        `UPDATE published_bots SET
           title = ?, pair = ?, direction = ?, leverage = ?,
           lower_price = ?, upper_price = ?, num_grids = ?, investment_usdt = ?,
           pnl_usdt = ?, pnl_pct = ?, updated_at = ?
         WHERE id = ?`,
        [
          bot.title, bot.pair, bot.direction, bot.leverage,
          bot.lower, bot.upper, bot.grids, bot.investment,
          bot.pnlUsdt, bot.pnlPct, now, existing.id,
        ],
      );
      continue;
    }
    await db.run(
      `INSERT INTO published_bots (
         user_id, source_bot_id, title, pair, direction, leverage,
         lower_price, upper_price, num_grids, investment_usdt,
         virtual_enabled, copies_count, pnl_usdt, pnl_pct,
         published_at, updated_at, seed_key
       ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
      [
        author.id, bot.title, bot.pair, bot.direction, bot.leverage,
        bot.lower, bot.upper, bot.grids, bot.investment,
        bot.pnlUsdt, bot.pnlPct, now, now, bot.seedKey,
      ],
    );
  }
}
