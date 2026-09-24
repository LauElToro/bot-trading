import type { QueryExecutor } from '../database/postgres.js';
import type { UserId } from '../auth/user-id.js';
import { childLogger } from './logger.js';
import { publicName } from './community.js';
import { livePnlSql, liveRealizedSql } from './live-pnl.js';
import { sendNotificationEmail } from '../mail/mailer.js';
import { buildFollowEmail } from '../mail/follow-mail.js';
import {
  consecutiveDays,
  copyInvestmentIssue,
  dueStreakMilestone,
  mirrorAction,
  sameUser,
  utcDay,
  type FollowAction,
} from './follow-rules.js';

const log = childLogger('follows');

export interface FollowState {
  following: boolean;
  autoCopy: boolean;
  copyInvestmentUsdt: number | null;
}

export interface FollowingRow {
  id: string;
  name: string;
  hasAvatar: boolean;
  avatarUpdatedAt: number | null;
  autoCopy: boolean;
  copyInvestmentUsdt: number | null;
}

export interface MirrorEngine {
  createBot(config: {
    userId: UserId;
    pair: string;
    direction: 'long' | 'short';
    leverage: number;
    lowerPrice: number;
    upperPrice: number;
    numGrids: number;
    investmentUSDT: number;
    virtualEnabled?: boolean;
    activeWindowSize?: number;
    grvtSubAccountId?: number | null;
    copiedFromBotId?: number | null;
  }): Promise<number>;
  startBot(botId: number): Promise<void>;
}

interface LeaderBotRow {
  id: number;
  user_id: string;
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  lower_price: number;
  upper_price: number;
  num_grids: number;
  virtual_enabled: number | null;
  active_window_size: number | null;
  safeguard_enabled: number | null;
  safeguard_threshold_pct: number | null;
  safeguard_action: string | null;
  sl_pct: number | null;
  tp_pct: number | null;
  auto_shift_enabled: number | null;
  auto_shift_pct: number | null;
  compound_pct: number | null;
  compound_threshold_usdt: number | null;
  compound_interval_hours: number | null;
}

export async function followUser(
  db: QueryExecutor,
  followerId: string,
  followeeId: string,
): Promise<{ error: 'self' | 'missing' } | { ok: true }> {
  if (sameUser(followerId, followeeId)) return { error: 'self' };
  const target = await db.get<{ id: string }>(`SELECT id FROM users WHERE id = ?`, [followeeId]);
  if (!target) return { error: 'missing' };
  const now = Date.now();
  await db.run(
    `INSERT INTO user_follows (follower_id, followee_id, auto_copy, copy_investment_usdt, created_at, updated_at)
     VALUES (?, ?, 0, NULL, ?, ?)
     ON CONFLICT (follower_id, followee_id) DO NOTHING`,
    [followerId, followeeId, now, now],
  );
  return { ok: true };
}

export async function unfollowUser(db: QueryExecutor, followerId: string, followeeId: string): Promise<void> {
  await db.run(
    `DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?`,
    [followerId, followeeId],
  );
}

export async function setAutoCopy(
  db: QueryExecutor,
  followerId: string,
  followeeId: string,
  autoCopy: boolean,
  investmentUsdt: unknown,
): Promise<{ error: 'missing' | 'investment_invalid' | 'investment_min' } | { ok: true; state: FollowState }> {
  const row = await db.get<{ follower_id: string }>(
    `SELECT follower_id FROM user_follows WHERE follower_id = ? AND followee_id = ?`,
    [followerId, followeeId],
  );
  if (!row) return { error: 'missing' };
  let amount: number | null = null;
  if (autoCopy) {
    const issue = copyInvestmentIssue(investmentUsdt);
    if (issue) return { error: issue };
    amount = Number(investmentUsdt);
  }
  await db.run(
    `UPDATE user_follows
        SET auto_copy = ?, copy_investment_usdt = ?, updated_at = ?
      WHERE follower_id = ? AND followee_id = ?`,
    [autoCopy ? 1 : 0, amount, Date.now(), followerId, followeeId],
  );
  return { ok: true, state: { following: true, autoCopy, copyInvestmentUsdt: amount } };
}

export async function getFollowState(
  db: QueryExecutor,
  followerId: string,
  followeeId: string,
): Promise<FollowState> {
  const row = await db.get<{ auto_copy: number; copy_investment_usdt: number | null }>(
    `SELECT auto_copy, copy_investment_usdt FROM user_follows WHERE follower_id = ? AND followee_id = ?`,
    [followerId, followeeId],
  );
  if (!row) return { following: false, autoCopy: false, copyInvestmentUsdt: null };
  return {
    following: true,
    autoCopy: row.auto_copy === 1,
    copyInvestmentUsdt: row.copy_investment_usdt,
  };
}

export interface AutoCopierBot {
  botId: number;
  pair: string;
  direction: 'long' | 'short';
  status: string;
  investmentUsdt: number;
  pnlUsdt: number;
  pnlPct: number;
  leaderPair: string;
}

export interface AutoCopierRow {
  id: string;
  name: string;
  hasAvatar: boolean;
  avatarUpdatedAt: number | null;
  copyInvestmentUsdt: number;
  copies: number;
  investedUsdt: number;
  pnlUsdt: number;
  pnlPct: number;
  bots: AutoCopierBot[];
}

export interface AutoCopierSummary {
  people: number;
  copies: number;
  running: number;
  paused: number;
  closed: number;
  investedUsdt: number;
  pnlUsdt: number;
  pnlPct: number;
  realizedUsdt: number;
  unrealizedUsdt: number;
}

const AUTO_COPIER_PAGE = 8;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Podium copies (copied_from_bot_id) and automatic mirrors, once each. */
function copyBotsSql(): string {
  const pnl = livePnlSql('b');
  const realized = liveRealizedSql('b');
  const cols = `b.id, b.user_id, b.pair, b.direction, b.status, b.investment_usdt,
           ${pnl} AS pnl_usdt, ${realized} AS realized_usdt, b.trend_pnl_usdt AS unrealized_usdt,
           leader.pair AS leader_pair`;
  return `
    SELECT ${cols}
      FROM grid_bots b
      JOIN grid_bots leader ON leader.id = b.copied_from_bot_id
     WHERE leader.user_id = ?
    UNION
    SELECT ${cols}
      FROM bot_mirrors m
      JOIN grid_bots b ON b.id = m.follower_bot_id
      JOIN grid_bots leader ON leader.id = m.leader_bot_id
     WHERE leader.user_id = ?
  `;
}

export async function listAutoCopiers(
  db: QueryExecutor,
  followeeId: string,
  page: number,
): Promise<{ page: number; pageSize: number; total: number; summary: AutoCopierSummary; rows: AutoCopierRow[] }> {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const totalRow = await db.get<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM (
       SELECT follower_id AS user_id
         FROM user_follows
        WHERE followee_id = ? AND auto_copy = 1
       UNION
       SELECT user_id FROM (${copyBotsSql()}) copies
     ) people`,
    [followeeId, followeeId, followeeId],
  );
  const total = totalRow?.c ?? 0;
  const offset = (safePage - 1) * AUTO_COPIER_PAGE;
  const rows = await db.all<{
    id: string;
    display_name: string | null;
    email: string;
    avatar_url: string | null;
    avatar_updated_at: number | null;
    copy_investment_usdt: number | null;
    copies: number;
    invested_usdt: number;
    pnl_usdt: number;
  }>(
    `SELECT u.id, u.display_name, u.email, u.avatar_url, u.avatar_updated_at,
            f.copy_investment_usdt,
            COALESCE(stats.copies, 0) AS copies,
            COALESCE(stats.invested_usdt, 0) AS invested_usdt,
            COALESCE(stats.pnl_usdt, 0) AS pnl_usdt
       FROM (
         SELECT DISTINCT ON (raw.user_id) raw.user_id, raw.sort_at
           FROM (
             SELECT follower_id AS user_id, created_at AS sort_at
               FROM user_follows
              WHERE followee_id = ? AND auto_copy = 1
             UNION ALL
             SELECT user_id, 0::bigint FROM (${copyBotsSql()}) listed
           ) raw
          ORDER BY raw.user_id, raw.sort_at DESC
       ) people
       JOIN users u ON u.id = people.user_id
       LEFT JOIN user_follows f
         ON f.follower_id = people.user_id AND f.followee_id = ? AND f.auto_copy = 1
       LEFT JOIN (
         SELECT copies.user_id AS follower_id,
                COUNT(*)::int AS copies,
                COALESCE(SUM(copies.investment_usdt), 0) AS invested_usdt,
                COALESCE(SUM(copies.pnl_usdt), 0) AS pnl_usdt
           FROM (${copyBotsSql()}) copies
          GROUP BY copies.user_id
       ) stats ON stats.follower_id = people.user_id
      ORDER BY people.sort_at DESC, u.id
      LIMIT ? OFFSET ?`,
    [followeeId, followeeId, followeeId, followeeId, followeeId, followeeId, AUTO_COPIER_PAGE, offset],
  );
  const ids = rows.map((row) => row.id);
  const bots = ids.length === 0 ? [] : await db.all<{
    follower_id: string;
    bot_id: number;
    pair: string;
    direction: 'long' | 'short';
    status: string;
    investment_usdt: number;
    pnl_usdt: number;
    leader_pair: string;
  }>(
    `SELECT copies.user_id AS follower_id, copies.id AS bot_id, copies.pair, copies.direction,
            copies.status, copies.investment_usdt, copies.pnl_usdt, copies.leader_pair
       FROM (${copyBotsSql()}) copies
      WHERE copies.user_id IN (${ids.map(() => '?').join(', ')})
      ORDER BY CASE copies.status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, copies.id DESC`,
    [followeeId, followeeId, ...ids],
  );
  const botsByFollower = new Map<string, AutoCopierBot[]>();
  for (const bot of bots) {
    const investment = Number(bot.investment_usdt) || 0;
    const pnl = Number(bot.pnl_usdt) || 0;
    const list = botsByFollower.get(bot.follower_id) ?? [];
    list.push({
      botId: bot.bot_id,
      pair: bot.pair,
      direction: bot.direction,
      status: bot.status,
      investmentUsdt: investment,
      pnlUsdt: pnl,
      pnlPct: investment > 0 ? (pnl / investment) * 100 : 0,
      leaderPair: bot.leader_pair,
    });
    botsByFollower.set(bot.follower_id, list);
  }
  const summaryRow = await db.get<{
    people: number;
    copies: number;
    running: number;
    paused: number;
    closed: number;
    invested_usdt: number;
    pnl_usdt: number;
    realized_usdt: number;
    unrealized_usdt: number;
  }>(
    `SELECT COUNT(DISTINCT b.user_id)::int AS people,
            COUNT(*)::int AS copies,
            COUNT(*) FILTER (WHERE b.status = 'running')::int AS running,
            COUNT(*) FILTER (WHERE b.status = 'paused')::int AS paused,
            COUNT(*) FILTER (WHERE b.status NOT IN ('running', 'paused'))::int AS closed,
            COALESCE(SUM(b.investment_usdt), 0) AS invested_usdt,
            COALESCE(SUM(b.pnl_usdt), 0) AS pnl_usdt,
            COALESCE(SUM(b.realized_usdt), 0) AS realized_usdt,
            COALESCE(SUM(b.unrealized_usdt), 0) AS unrealized_usdt
       FROM (${copyBotsSql()}) b`,
    [followeeId, followeeId],
  );
  const investedAll = roundMoney(Number(summaryRow?.invested_usdt) || 0);
  const pnlAll = roundMoney(Number(summaryRow?.pnl_usdt) || 0);
  const realizedAll = roundMoney(Number(summaryRow?.realized_usdt) || 0);
  const unrealizedAll = roundMoney(Number(summaryRow?.unrealized_usdt) || 0);
  return {
    page: safePage,
    pageSize: AUTO_COPIER_PAGE,
    total,
    summary: {
      people: Number(summaryRow?.people) || 0,
      copies: Number(summaryRow?.copies) || 0,
      running: Number(summaryRow?.running) || 0,
      paused: Number(summaryRow?.paused) || 0,
      closed: Number(summaryRow?.closed) || 0,
      investedUsdt: investedAll,
      pnlUsdt: pnlAll,
      pnlPct: investedAll > 0 ? roundMoney((pnlAll / investedAll) * 100) : 0,
      realizedUsdt: realizedAll,
      unrealizedUsdt: unrealizedAll,
    },
    rows: rows.map((row) => {
      const invested = roundMoney(Number(row.invested_usdt) || 0);
      const pnl = roundMoney(Number(row.pnl_usdt) || 0);
      return {
        id: row.id,
        name: publicName(row.display_name, row.id),
        hasAvatar: Boolean(row.avatar_url),
        avatarUpdatedAt: row.avatar_updated_at,
        copyInvestmentUsdt: Number(row.copy_investment_usdt) || 0,
        copies: Number(row.copies) || 0,
        investedUsdt: invested,
        pnlUsdt: pnl,
        pnlPct: invested > 0 ? (pnl / invested) * 100 : 0,
        bots: botsByFollower.get(row.id) ?? [],
      };
    }),
  };
}

export async function listFollowing(db: QueryExecutor, followerId: string): Promise<FollowingRow[]> {
  const rows = await db.all<{
    id: string;
    display_name: string | null;
    email: string;
    avatar_url: string | null;
    avatar_updated_at: number | null;
    auto_copy: number;
    copy_investment_usdt: number | null;
  }>(
    `SELECT u.id, u.display_name, u.email, u.avatar_url, u.avatar_updated_at,
            f.auto_copy, f.copy_investment_usdt
       FROM user_follows f
       JOIN users u ON u.id = f.followee_id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC`,
    [followerId],
  );
  return rows.map(toFollowRow);
}

function toFollowRow(row: {
  id: string;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
  avatar_updated_at: number | null;
  auto_copy: number;
  copy_investment_usdt: number | null;
}): FollowingRow {
  return {
    id: row.id,
    name: publicName(row.display_name, row.id),
    hasAvatar: Boolean(row.avatar_url),
    avatarUpdatedAt: row.avatar_updated_at,
    autoCopy: row.auto_copy === 1,
    copyInvestmentUsdt: row.copy_investment_usdt,
  };
}

export function notifyFollowers(
  db: QueryExecutor,
  followeeId: string,
  kind: FollowAction,
  ref: string,
  detail?: { pair?: string | null; detail?: string | null },
): void {
  void deliverFollowMail(db, followeeId, kind, ref, detail).catch((err) => {
    log.error({ err: (err as Error).message, followeeId, kind }, 'follow mail failed');
  });
}

export function mirrorLeaderStart(db: QueryExecutor, engine: MirrorEngine, leaderBotId: number): void {
  void runMirrors(db, engine, leaderBotId).catch((err) => {
    log.error({ err: (err as Error).message, leaderBotId }, 'auto copy failed');
  });
}

export async function tickOperationalStreaks(db: QueryExecutor, now: Date = new Date()): Promise<number> {
  const today = utcDay(now);
  const running = await db.all<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM grid_bots WHERE status = 'running' AND user_id IS NOT NULL`,
  );
  for (const row of running) {
    await db.run(
      `INSERT INTO follow_streak_days (user_id, day) VALUES (?, ?) ON CONFLICT (user_id, day) DO NOTHING`,
      [row.user_id, today],
    );
  }
  let sent = 0;
  for (const row of running) {
    const days = await db.all<{ day: string }>(
      `SELECT day FROM follow_streak_days WHERE user_id = ?`,
      [row.user_id],
    );
    const streak = consecutiveDays(days.map((item) => item.day), today);
    const sentRows = await db.all<{ ref: string }>(
      `SELECT DISTINCT ref FROM follow_notifications WHERE followee_id = ? AND kind = 'streak'`,
      [row.user_id],
    );
    const already = sentRows
      .map((item) => Number(item.ref))
      .filter((value) => Number.isFinite(value));
    const milestone = dueStreakMilestone(streak, already);
    if (milestone == null) continue;
    sent += await deliverFollowMail(db, row.user_id, 'streak', String(milestone), { streakDays: milestone });
  }
  return sent;
}

async function deliverFollowMail(
  db: QueryExecutor,
  followeeId: string,
  kind: FollowAction | 'streak' | 'copy_failed',
  ref: string,
  detail?: { pair?: string | null; detail?: string | null; streakDays?: number | null },
): Promise<number> {
  const followee = await db.get<{ display_name: string | null; email: string }>(
    `SELECT display_name, email FROM users WHERE id = ?`,
    [followeeId],
  );
  if (!followee) return 0;
  const name = publicName(followee.display_name, followeeId);
  const followers = await db.all<{ follower_id: string; email: string; notify_emails_enabled: number }>(
    `SELECT f.follower_id, u.email, u.notify_emails_enabled
       FROM user_follows f
       JOIN users u ON u.id = f.follower_id
      WHERE f.followee_id = ?`,
    [followeeId],
  );
  let sent = 0;
  for (const follower of followers) {
    if (follower.notify_emails_enabled === 0) continue;
    const claimed = await db.get<{ id: number }>(
      `INSERT INTO follow_notifications (followee_id, follower_id, kind, ref, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (followee_id, follower_id, kind, ref) DO NOTHING
       RETURNING id`,
      [followeeId, follower.follower_id, kind, ref, Date.now()],
    );
    if (!claimed) continue;
    const profileUrl = profileLink(followeeId);
    const mail = buildFollowEmail({
      to: follower.email,
      traderName: name,
      kind,
      pair: detail?.pair,
      detail: detail?.detail,
      streakDays: detail?.streakDays,
      profileUrl,
    });
    await sendNotificationEmail({ to: follower.email, ...mail });
    sent += 1;
  }
  return sent;
}

export async function runMirrors(db: QueryExecutor, engine: MirrorEngine, leaderBotId: number): Promise<void> {
  const leader = await db.get<LeaderBotRow>(
    `SELECT id, user_id, pair, direction, leverage, lower_price, upper_price, num_grids,
            virtual_enabled, active_window_size, safeguard_enabled, safeguard_threshold_pct,
            safeguard_action, sl_pct, tp_pct, auto_shift_enabled, auto_shift_pct,
            compound_pct, compound_threshold_usdt, compound_interval_hours
       FROM grid_bots WHERE id = ?`,
    [leaderBotId],
  );
  if (!leader?.user_id) return;
  const followers = await db.all<{ follower_id: string; copy_investment_usdt: number }>(
    `SELECT follower_id, copy_investment_usdt
       FROM user_follows
      WHERE followee_id = ? AND auto_copy = 1 AND copy_investment_usdt IS NOT NULL`,
    [leader.user_id],
  );
  for (const follower of followers) {
    try {
      await mirrorOne(db, engine, leader, follower.follower_id, Number(follower.copy_investment_usdt));
    } catch (err) {
      const message = (err as Error).message;
      log.error({ err: message, leaderBotId, followerId: follower.follower_id }, 'mirror failed');
      await deliverFollowMail(db, leader.user_id, 'copy_failed', `bot:${leaderBotId}`, {
        pair: leader.pair,
        detail: message,
      }).catch((mailErr) => {
        log.error({ err: (mailErr as Error).message }, 'copy failure mail failed');
      });
    }
  }
}

async function mirrorOne(
  db: QueryExecutor,
  engine: MirrorEngine,
  leader: LeaderBotRow,
  followerId: string,
  investmentUsdt: number,
): Promise<void> {
  const linked = await db.get<{ id: number; status: string }>(
    `SELECT id, status FROM grid_bots
      WHERE user_id = ? AND copied_from_bot_id = ? AND status IN ('running', 'paused')
      ORDER BY id DESC
      LIMIT 1`,
    [followerId, leader.id],
  );
  if (linked) {
    await db.run(
      `INSERT INTO bot_mirrors (leader_bot_id, follower_id, follower_bot_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (leader_bot_id, follower_id) DO NOTHING`,
      [leader.id, followerId, linked.id, Date.now()],
    );
    if (linked.status === 'paused') await engine.startBot(linked.id);
    return;
  }
  const existing = await db.get<{ follower_bot_id: number; status: string }>(
    `SELECT m.follower_bot_id, b.status
       FROM bot_mirrors m
       JOIN grid_bots b ON b.id = m.follower_bot_id
      WHERE m.leader_bot_id = ? AND m.follower_id = ?`,
    [leader.id, followerId],
  );
  const action = mirrorAction(existing?.status ?? null);
  if (action === 'start' && existing) {
    await engine.startBot(existing.follower_bot_id);
    return;
  }
  if (action === 'skip') return;
  if (action === 'closed') throw new Error('La copia anterior ya está cerrada');

  const duplicate = await db.get<{ id: number }>(
    `SELECT id FROM grid_bots
      WHERE user_id = ?
        AND pair = ?
        AND direction = ?
        AND COALESCE(grvt_sub_account_id, -1) = -1
        AND status IN ('running', 'paused')`,
    [followerId, leader.pair, leader.direction],
  );
  if (duplicate) throw new Error('Ya tenés un bot activo en ese par y dirección');

  const virtualEnabled = leader.virtual_enabled === 1;
  const botId = await engine.createBot({
    userId: followerId as UserId,
    pair: leader.pair,
    direction: leader.direction,
    leverage: leader.leverage,
    lowerPrice: leader.lower_price,
    upperPrice: leader.upper_price,
    numGrids: leader.num_grids,
    investmentUSDT: investmentUsdt,
    virtualEnabled,
    activeWindowSize: virtualEnabled ? leader.active_window_size ?? undefined : undefined,
    grvtSubAccountId: null,
    copiedFromBotId: null,
  });
  await db.run(
    `UPDATE grid_bots SET
        safeguard_enabled = ?,
        safeguard_threshold_pct = ?,
        safeguard_action = ?,
        sl_pct = ?,
        tp_pct = ?,
        auto_shift_enabled = ?,
        auto_shift_pct = ?,
        compound_pct = ?,
        compound_threshold_usdt = ?,
        compound_interval_hours = ?,
        copied_from_bot_id = NULL
      WHERE id = ?`,
    [
      leader.safeguard_enabled ? 1 : 0,
      leader.safeguard_threshold_pct,
      leader.safeguard_action,
      leader.sl_pct,
      leader.tp_pct,
      leader.auto_shift_enabled ? 1 : 0,
      leader.auto_shift_pct,
      leader.compound_pct,
      leader.compound_threshold_usdt,
      leader.compound_interval_hours,
      botId,
    ],
  );
  await db.run(
    `INSERT INTO bot_mirrors (leader_bot_id, follower_id, follower_bot_id, created_at)
     VALUES (?, ?, ?, ?)`,
    [leader.id, followerId, botId, Date.now()],
  );
  await engine.startBot(botId);
}

function profileLink(userId: string): string | null {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
  if (!base || !/^https?:\/\//.test(base)) return null;
  return `${base}/dashboard/perfil/${userId}`;
}
