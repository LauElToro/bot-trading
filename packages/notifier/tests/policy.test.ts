import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFS,
  allowsEmail,
  clampProfitMilestonePct,
  alreadySentToday,
  isImportantStatus,
  latchAction,
  milestoneBucket,
  profitPct,
  shouldNotifyMilestone,
} from '../src/policy';

describe('profitPct', () => {
  it('returns percent of investment', () => {
    expect(profitPct(12.5, 100)).toBeCloseTo(12.5);
  });

  it('returns 0 when investment is missing', () => {
    expect(profitPct(10, 0)).toBe(0);
  });
});

describe('latchAction', () => {
  it('sends the first time a condition is active', () => {
    expect(latchAction(true, false)).toBe('send');
  });

  it('holds while the same condition stays active', () => {
    expect(latchAction(true, true)).toBe('hold');
  });

  it('blocks a second drawdown email on the same day', () => {
    expect(alreadySentToday('2026-09-24', '2026-09-24')).toBe(true);
    expect(alreadySentToday('2026-09-23', '2026-09-24')).toBe(false);
    expect(alreadySentToday(undefined, '2026-09-24')).toBe(false);
  });

  it('releases after the condition clears so a later episode can send again', () => {
    expect(latchAction(false, true)).toBe('release');
    expect(latchAction(false, false)).toBe('release');
  });
});

describe('shouldNotifyMilestone', () => {
  it('fires at the first +5% bucket', () => {
    expect(shouldNotifyMilestone(5.1, 0, 5)).toBe(true);
  });

  it('does not fire for leftover cents under the next bucket', () => {
    expect(shouldNotifyMilestone(9.9, 1, 5)).toBe(false);
  });

  it('fires again at +10%', () => {
    expect(shouldNotifyMilestone(10, 1, 5)).toBe(true);
  });

  it('fires on a -5% loss from a seeded 0 bucket', () => {
    expect(shouldNotifyMilestone(-6, 0, 5)).toBe(true);
  });

  it('does not re-fire the same bucket', () => {
    expect(shouldNotifyMilestone(24.7, 4, 5)).toBe(false);
  });
});

describe('milestoneBucket', () => {
  it('truncates toward zero', () => {
    expect(milestoneBucket(24.7, 5)).toBe(4);
    expect(milestoneBucket(-6.2, 5)).toBe(-1);
  });
});

describe('allowsEmail', () => {
  it('blocks everything when the master switch is off', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, emailsEnabled: false };
    expect(allowsEmail(prefs, 'profit_milestone')).toBe(false);
    expect(allowsEmail(prefs, 'drawdown')).toBe(false);
  });

  it('honors per-type flags', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, dailySummary: false, profitMilestones: true };
    expect(allowsEmail(prefs, 'daily_summary')).toBe(false);
    expect(allowsEmail(prefs, 'profit_milestone')).toBe(true);
  });
});

describe('isImportantStatus', () => {
  it('only treats stop and error as mail-worthy', () => {
    expect(isImportantStatus('stopped')).toBe(true);
    expect(isImportantStatus('error')).toBe(true);
    expect(isImportantStatus('paused')).toBe(false);
    expect(isImportantStatus('running')).toBe(false);
  });
});

describe('clampProfitMilestonePct', () => {
  it('keeps values inside 1–25', () => {
    expect(clampProfitMilestonePct(0)).toBe(1);
    expect(clampProfitMilestonePct(80)).toBe(25);
    expect(clampProfitMilestonePct('7')).toBe(7);
  });
});
