import { describe, expect, it, vi } from 'vitest';
import {
  consecutiveDays,
  copyInvestmentIssue,
  dueStreakMilestone,
  mirrorAction,
  mirrorsOn,
  previousUtcDay,
  sameUser,
} from '../src/server/follow-rules';
import { buildFollowEmail } from '../src/mail/follow-mail';
import { runMirrors, type MirrorEngine } from '../src/server/follows';
import type { QueryExecutor } from '../src/database/postgres';

describe('follow rules', () => {
  it('refuses following yourself', () => {
    expect(sameUser('a', 'a')).toBe(true);
    expect(sameUser('a', 'b')).toBe(false);
  });

  it('requires a copy amount of at least 50 when enabling auto copy', () => {
    expect(copyInvestmentIssue(undefined)).toBe('investment_invalid');
    expect(copyInvestmentIssue(10)).toBe('investment_min');
    expect(copyInvestmentIssue(50)).toBeNull();
  });

  it('mirrors only a start, and only creates or resumes a paused copy', () => {
    expect(mirrorsOn('bot_started')).toBe(true);
    expect(mirrorsOn('bot_paused')).toBe(false);
    expect(mirrorsOn('bot_closed')).toBe(false);
    expect(mirrorsOn('bot_created')).toBe(false);
    expect(mirrorAction(null)).toBe('create');
    expect(mirrorAction('paused')).toBe('start');
    expect(mirrorAction('running')).toBe('skip');
    expect(mirrorAction('stopped')).toBe('closed');
  });

  it('emails each streak milestone once', () => {
    expect(dueStreakMilestone(6, [])).toBeNull();
    expect(dueStreakMilestone(7, [])).toBe(7);
    expect(dueStreakMilestone(14, [7])).toBe(14);
    expect(dueStreakMilestone(14, [7, 14])).toBeNull();
    expect(dueStreakMilestone(30, [])).toBe(7);
  });

  it('counts consecutive utc days ending today', () => {
    expect(previousUtcDay('2026-03-01')).toBe('2026-02-28');
    expect(consecutiveDays(['2026-09-22', '2026-09-23', '2026-09-24'], '2026-09-24')).toBe(3);
    expect(consecutiveDays(['2026-09-22', '2026-09-24'], '2026-09-24')).toBe(1);
    expect(consecutiveDays(['2026-09-23'], '2026-09-24')).toBe(0);
  });
});

describe('follow mail', () => {
  it('names the trader and the bot event in spanish by default', () => {
    const mail = buildFollowEmail({
      to: 'ana@example.com',
      traderName: 'Lau',
      kind: 'bot_closed',
      pair: 'ETH_USDT_Perp',
    });
    expect(mail.subject).toContain('Lau cerró un bot');
    expect(mail.text).toContain('ETH_USDT_Perp');
    expect(mail.text).toContain('ana@example.com');
  });
});

describe('auto copy', () => {
  it('does not throw when one follower cannot start, and still starts the next', async () => {
    const started: string[] = [];
    const engine: MirrorEngine = {
      createBot: vi.fn(async (config) => {
        if (config.userId === 'follower-a') throw new Error('sin claves');
        return 77;
      }),
      startBot: vi.fn(async (botId) => {
        started.push(String(botId));
      }),
    };
    const db = fakeDb();
    await expect(runMirrors(db, engine, 4)).resolves.toBeUndefined();
    expect(started).toEqual(['77']);
    expect(engine.createBot).toHaveBeenCalledTimes(2);
    const created = vi.mocked(engine.createBot).mock.calls[1]?.[0];
    expect(created?.copiedFromBotId).toBeNull();
    expect(created?.investmentUSDT).toBe(80);
  });
});

function fakeDb(): QueryExecutor {
  const mirrors: Array<{ leader: number; follower: string; bot: number }> = [];
  return {
    async get(sql) {
      if (sql.includes('FROM grid_bots WHERE id')) {
        return {
          id: 4,
          user_id: 'leader',
          pair: 'ETH_USDT_Perp',
          direction: 'long',
          leverage: 5,
          lower_price: 100,
          upper_price: 200,
          num_grids: 10,
          virtual_enabled: 0,
          active_window_size: null,
          safeguard_enabled: 0,
          safeguard_threshold_pct: null,
          safeguard_action: null,
          sl_pct: null,
          tp_pct: null,
          auto_shift_enabled: 0,
          auto_shift_pct: null,
          compound_pct: null,
          compound_threshold_usdt: null,
          compound_interval_hours: null,
        };
      }
      if (sql.includes('FROM users WHERE id')) return undefined;
      if (sql.includes('bot_mirrors')) return undefined;
      if (sql.includes("status IN ('running', 'paused')")) return undefined;
      if (sql.includes('RETURNING id')) return { id: 1 };
      return undefined;
    },
    async all(sql) {
      if (sql.includes('FROM user_follows') && sql.includes('auto_copy = 1')) {
        return [
          { follower_id: 'follower-a', copy_investment_usdt: 100 },
          { follower_id: 'follower-b', copy_investment_usdt: 80 },
        ];
      }
      if (sql.includes('FROM user_follows')) return [];
      return [];
    },
    async run(sql, params) {
      if (sql.includes('INSERT INTO bot_mirrors')) {
        mirrors.push({
          leader: Number(params?.[0]),
          follower: String(params?.[1]),
          bot: Number(params?.[2]),
        });
      }
      return { changes: 1 };
    },
    async transaction(work) {
      return work(this);
    },
  };
}
