import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFS,
  parseNotificationPatch,
  prefsFromUserRow,
} from '../src/server/notification-prefs';

describe('prefsFromUserRow', () => {
  it('uses defaults when the row is empty', () => {
    expect(prefsFromUserRow(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('maps integer flags from the users row', () => {
    const prefs = prefsFromUserRow({
      notify_emails_enabled: 0,
      notify_profit: 1,
      notify_drawdown: 0,
      notify_liq: 1,
      notify_status: 1,
      notify_daily: 1,
      notify_profit_pct: 10,
    });
    expect(prefs.emailsEnabled).toBe(false);
    expect(prefs.dailySummary).toBe(true);
    expect(prefs.profitMilestonePct).toBe(10);
  });
});

describe('parseNotificationPatch', () => {
  it('clamps the milestone percent', () => {
    expect(parseNotificationPatch({ profitMilestonePct: 99 }).profitMilestonePct).toBe(25);
  });
});
