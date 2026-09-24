export type AlertType =
  | 'profit_milestone'
  | 'fills'
  | 'drawdown'
  | 'liq_proximity'
  | 'status_change'
  | 'daily_summary';

export interface NotificationPrefs {
  emailsEnabled: boolean;
  profitMilestones: boolean;
  drawdown: boolean;
  liqProximity: boolean;
  statusChanges: boolean;
  dailySummary: boolean;
  profitMilestonePct: number;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  emailsEnabled: true,
  profitMilestones: true,
  drawdown: true,
  liqProximity: true,
  statusChanges: true,
  dailySummary: false,
  profitMilestonePct: 5,
};

export function clampProfitMilestonePct(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return DEFAULT_NOTIFICATION_PREFS.profitMilestonePct;
  return Math.min(25, Math.max(1, Math.round(n * 10) / 10));
}

export function profitPct(totalPnl: number, investment: number): number {
  if (!Number.isFinite(investment) || investment <= 0) return 0;
  if (!Number.isFinite(totalPnl)) return 0;
  return (totalPnl / investment) * 100;
}

export function milestoneBucket(pct: number, step: number): number {
  const s = step > 0 ? step : DEFAULT_NOTIFICATION_PREFS.profitMilestonePct;
  return Math.trunc(pct / s);
}

export type LatchAction = 'send' | 'hold' | 'release';

/**
 * One email while a condition stays true. The next email waits until the
 * condition clears and comes back.
 */
/** Same alert, same day: one email. A later day can send again if it is still true. */
export function alreadySentToday(sentOn: string | undefined, today: string): boolean {
  return sentOn === today;
}

export function latchAction(active: boolean, alreadySent: boolean): LatchAction {
  if (!active) return 'release';
  if (alreadySent) return 'hold';
  return 'send';
}

export function shouldNotifyMilestone(
  currentPct: number,
  lastBucket: number,
  step: number,
): boolean {
  const bucket = milestoneBucket(currentPct, step);
  if (bucket === lastBucket || bucket === 0) return false;
  if (bucket > 0 && bucket > lastBucket) return true;
  if (bucket < 0 && bucket < lastBucket) return true;
  return false;
}

export function isImportantStatus(toStatus: string): boolean {
  return toStatus === 'stopped' || toStatus === 'error';
}

export function allowsEmail(prefs: NotificationPrefs, type: string): boolean {
  if (!prefs.emailsEnabled) return false;
  switch (type) {
    case 'profit_milestone':
    case 'fills':
      return prefs.profitMilestones;
    case 'drawdown':
      return prefs.drawdown;
    case 'liq_proximity':
      return prefs.liqProximity;
    case 'status_change':
    case 'status':
      return prefs.statusChanges;
    case 'daily_summary':
      return prefs.dailySummary;
    default:
      return true;
  }
}
