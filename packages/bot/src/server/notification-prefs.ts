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

function asBool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return fallback;
}

export function prefsFromUserRow(row: {
  notify_emails_enabled?: number | null;
  notify_profit?: number | null;
  notify_drawdown?: number | null;
  notify_liq?: number | null;
  notify_status?: number | null;
  notify_daily?: number | null;
  notify_profit_pct?: number | null;
} | null | undefined): NotificationPrefs {
  const d = DEFAULT_NOTIFICATION_PREFS;
  if (!row) return { ...d };
  return {
    emailsEnabled: asBool(row.notify_emails_enabled, d.emailsEnabled),
    profitMilestones: asBool(row.notify_profit, d.profitMilestones),
    drawdown: asBool(row.notify_drawdown, d.drawdown),
    liqProximity: asBool(row.notify_liq, d.liqProximity),
    statusChanges: asBool(row.notify_status, d.statusChanges),
    dailySummary: asBool(row.notify_daily, d.dailySummary),
    profitMilestonePct: clampProfitMilestonePct(row.notify_profit_pct ?? d.profitMilestonePct),
  };
}

export function parseNotificationPatch(body: unknown): NotificationPrefs {
  const src = (body ?? {}) as Record<string, unknown>;
  const d = DEFAULT_NOTIFICATION_PREFS;
  return {
    emailsEnabled: asBool(src.emailsEnabled, d.emailsEnabled),
    profitMilestones: asBool(src.profitMilestones, d.profitMilestones),
    drawdown: asBool(src.drawdown, d.drawdown),
    liqProximity: asBool(src.liqProximity, d.liqProximity),
    statusChanges: asBool(src.statusChanges, d.statusChanges),
    dailySummary: asBool(src.dailySummary, d.dailySummary),
    profitMilestonePct: clampProfitMilestonePct(src.profitMilestonePct),
  };
}
