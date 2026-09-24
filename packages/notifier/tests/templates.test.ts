import { describe, it, expect } from 'vitest';
import {
  fillsTemplate,
  drawdownTemplate,
  statusChangeTemplate,
  liqProximityTemplate,
  dailySummaryTemplate,
  profitMilestoneTemplate,
} from '../src/templates';
import type { BotRow, DailySnapshotRow, RoundtripRow } from '../src/db';

function rt(overrides: Partial<RoundtripRow> = {}): RoundtripRow {
  return {
    id: 1,
    bot_id: 3,
    user_id: 'user-1',
    buy_price: 2743.2,
    sell_price: 2747.8,
    size: 0.03,
    profit: 0.14,
    created_at: '2026-09-21T22:00:00Z',
    ...overrides,
  };
}

function bot(overrides: Partial<BotRow> = {}): BotRow {
  return {
    id: 3,
    pair: 'ETH_USDT_Perp',
    status: 'running',
    direction: 'short',
    leverage: 10,
    investment_usdt: 100,
    total_pnl_usdt: 24.69,
    grid_profit_usdt: 0.61,
    trend_pnl_usdt: 24.08,
    avg_entry_price: 2768,
    liquidation_price: 3759,
    ...overrides,
  };
}

describe('fillsTemplate', () => {
  it('returns empty text when no roundtrips', () => {
    expect(fillsTemplate([]).text).toBe('');
  });

  it('renders singular wording for exactly 1 round-trip', () => {
    const out = fillsTemplate([rt({ profit: 1.5 })]);
    expect(out.text).toContain('Se cerró 1 round-trip');
    expect(out.text).toContain('+$1.50');
    expect(out.subject).toContain('bot 3');
  });

  it('uses plural wording for 2+ round-trips', () => {
    const out = fillsTemplate([rt(), rt(), rt()]);
    expect(out.text).toContain('Se cerraron 3 round-trips');
  });
});

describe('profitMilestoneTemplate', () => {
  it('names the bot and shows total PnL against investment', () => {
    const out = profitMilestoneTemplate({
      bot: bot(),
      milestonePct: 20,
    });
    expect(out.text).toContain('Bot: 3');
    expect(out.text).toContain('ETH_USDT_Perp');
    expect(out.text).toContain('corto (SHORT)');
    expect(out.text).toContain('PnL total (GRVT)');
    expect(out.text).toContain('+$24.69');
    expect(out.text).toContain('+24.69%');
    expect(out.text).toContain('$100.00');
    expect(out.text).toContain('+20.00%');
    expect(out.html).toContain('#0a0a0a');
    expect(out.html).toContain('#dc2626');
    expect(out.html).not.toContain('#e8b84a');
    expect(out.html).not.toContain('#ef4444');
  });
});

describe('drawdownTemplate', () => {
  it('renders equity / HWM / drop / threshold', () => {
    const out = drawdownTemplate(8000, 10000, 15);
    expect(out.text).toContain('$8,000.00');
    expect(out.text).toContain('$10,000.00');
    expect(out.text).toContain('15%');
  });
});

describe('statusChangeTemplate', () => {
  it('names the bot and the new status', () => {
    const out = statusChangeTemplate(bot(), 'running', 'stopped');
    expect(out.text).toContain('Bot: 3');
    expect(out.text).toContain('ETH_USDT_Perp');
    expect(out.text).toContain('STOPPED');
  });

  it('appends last_error when present', () => {
    const out = statusChangeTemplate(
      bot({ last_error: 'GRVT timeout' }),
      'running',
      'error'
    );
    expect(out.text).toContain('GRVT timeout');
  });
});

describe('liqProximityTemplate', () => {
  it('escalates when distance is under 5%', () => {
    const out = liqProximityTemplate(bot(), 1750, 1700, 2.5);
    expect(out.text).toContain('menor a 5%');
    expect(out.text).toContain('pausar');
    expect(out.text).toContain('2.5%');
  });
});

function snap(overrides: Partial<DailySnapshotRow> = {}): DailySnapshotRow {
  return {
    id: 1,
    bot_id: 42,
    date: '2026-05-08',
    equity: 1100,
    grid_profit_net: 80,
    trend_pnl: 20,
    total_pnl: 100,
    round_trips: 12,
    ...overrides,
  };
}

describe('dailySummaryTemplate', () => {
  it('computes equity = investment + total_pnl and percent vs investment', () => {
    const out = dailySummaryTemplate(
      bot({
        id: 42,
        investment_usdt: 1000,
        total_pnl_usdt: 100,
        pair: 'ETH_USDT_Perp',
      }),
      snap(),
      null
    );
    expect(out.text).toContain('$1,100.00');
    expect(out.text).toContain('+10.00%');
  });
});
