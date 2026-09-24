export const STREAK_MILESTONES = [7, 14, 30, 60, 90] as const;

export const MIN_COPY_INVESTMENT_USDT = 50;

export type FollowAction =
  | 'bot_created'
  | 'bot_started'
  | 'bot_paused'
  | 'bot_closed'
  | 'bot_action';

export type MirrorAction = 'create' | 'start' | 'skip' | 'closed';

export function mirrorsOn(kind: FollowAction): boolean {
  return kind === 'bot_started';
}

export function mirrorAction(existingStatus: string | null): MirrorAction {
  if (existingStatus == null) return 'create';
  if (existingStatus === 'paused') return 'start';
  if (existingStatus === 'stopped') return 'closed';
  return 'skip';
}

export function copyInvestmentIssue(amount: unknown): 'investment_invalid' | 'investment_min' | null {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 'investment_invalid';
  if (n < MIN_COPY_INVESTMENT_USDT) return 'investment_min';
  return null;
}

export function sameUser(followerId: string, followeeId: string): boolean {
  return followerId === followeeId;
}

/** Smallest milestone reached that has not been emailed yet. */
export function dueStreakMilestone(streakDays: number, alreadySent: readonly number[]): number | null {
  for (const milestone of STREAK_MILESTONES) {
    if (streakDays >= milestone && !alreadySent.includes(milestone)) return milestone;
  }
  return null;
}

/** Consecutive YYYY-MM-DD days ending at `today`, walking backward. */
export function consecutiveDays(days: readonly string[], today: string): number {
  const set = new Set(days);
  if (!set.has(today)) return 0;
  let count = 0;
  let cursor = today;
  while (set.has(cursor)) {
    count += 1;
    cursor = previousUtcDay(cursor);
  }
  return count;
}

export function previousUtcDay(day: string): string {
  const parts = day.split('-').map((part) => Number(part));
  const year = parts[0];
  const month = parts[1];
  const date = parts[2];
  if (!year || !month || !date) return day;
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
