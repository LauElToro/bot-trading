import type { QueryExecutor } from '../database/postgres.js';
import type { UserId } from '../auth/user-id.js';
import { childLogger } from './logger.js';
import { publicName } from './community.js';
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
  return rows.map((row) => ({
    id: row.id,
    name: publicName(row.display_name, row.email),
    hasAvatar: Boolean(row.avatar_url),
    avatarUpdatedAt: row.avatar_updated_at,
    autoCopy: row.auto_copy === 1,
    copyInvestmentUsdt: row.copy_investment_usdt,
  }));
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
  const name = publicName(followee.display_name, followee.email);
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
