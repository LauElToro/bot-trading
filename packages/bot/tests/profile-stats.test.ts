import { describe, expect, it } from 'vitest';
import { assembleTraderProfile, stampLiveEquity, type ProfileParts } from '../src/server/profile-stats';

function parts(overrides: Partial<ProfileParts> = {}): ProfileParts {
  return {
    own: {
      created: 3,
      running: 1,
      paused: 1,
      closed: 1,
      copied_from_others: 1,
      invested: 230,
      original_invested: 200,
      realized: 18,
      unrealized: -5,
      reinvested: 30,
      pnl_running: 10,
      pnl_paused: -2,
      pnl_closed: 5,
      invested_running: 100,
    },
    ledger: {
      roundtrips: 14,
      paired_profit: 18.4,
      fees: -1.25,
      funding: 0.4,
    },
    audience: {
      unique_copiers: 2,
      copies_created: 4,
      copies_running: 2,
      copies_paused: 1,
      copies_closed: 1,
      invested: 400,
      realized: 32,
      unrealized: 8,
    },
    interest: {
      copy_interests: 5,
      unique_interest_people: 3,
    },
    strategies: [
      {
        id: 9,
        title: 'ETH long',
        pair: 'ETH_USDT_Perp',
        direction: 'long',
        leverage: 10,
        pnl_usdt: 12.5,
        pnl_pct: 12.5,
        copies_count: 5,
        published_at: 1_700_000_000_000,
        source_bot_id: 4,
        live_status: 'running',
        copies_created: 4,
        unique_copiers: 2,
        copies_running: 2,
        copies_paused: 1,
        copies_closed: 1,
        copier_invested: 400,
        copier_realized: 32,
        copier_unrealized: 8,
      },
    ],
    bots: [
      {
        id: 4,
        pair: 'ETH_USDT_Perp',
        direction: 'long',
        leverage: 10,
        status: 'running',
        investment_usdt: 100,
        grid_profit_usdt: 12,
        trend_pnl_usdt: -2,
        created_at: '2026-09-01T00:00:00.000Z',
        copied_from_bot_id: null,
        published: 1,
        copied_from_name: null,
      },
      {
        id: 5,
        pair: 'BTC_USDT_Perp',
        direction: 'short',
        leverage: 3,
        status: 'stopped',
        investment_usdt: 80,
        grid_profit_usdt: 1,
        trend_pnl_usdt: -6,
        created_at: '2026-09-02T00:00:00.000Z',
        copied_from_bot_id: 20,
        published: 0,
        copied_from_name: '  Ana Figueroa extra largo  ',
      },
    ],
    ...overrides,
  };
}

describe('assembleTraderProfile', () => {
  it('sums lifetime pnl and copier profitability', () => {
    const profile = assembleTraderProfile(parts());
    expect(profile.bots).toMatchObject({
      created: 3,
      running: 1,
      paused: 1,
      closed: 1,
      published: 1,
      copiedFromOthers: 1,
      roundtrips: 14,
    });
    expect(profile.earnings.totalPnlUsdt).toBe(13);
    expect(profile.earnings.totalPnlPct).toBe(5.65);
    expect(profile.earnings.feesUsdt).toBe(-1.25);
    expect(profile.audience).toMatchObject({
      uniqueCopiers: 2,
      copyInterests: 5,
      uniqueInterestPeople: 3,
      copiesCreated: 4,
      pnlUsdt: 40,
      pnlPct: 10,
    });
    expect(profile.strategies[0]).toMatchObject({
      copierPnlUsdt: 40,
      copierPnlPct: 10,
      liveStatus: 'running',
    });
    expect(profile.bestBotId).toBe(4);
    expect(profile.worstBotId).toBe(5);
    expect(profile.ownBots[1]?.copiedFromName).toBe('Ana Figueroa extra largo');
    expect(profile.ownBots[1]?.pnlUsdt).toBe(-5);
    expect(profile.ownBots[1]?.pnlPct).toBe(-6.25);
  });

  it('returns zero profitability when there is no capital', () => {
    const profile = assembleTraderProfile(parts({
      own: {
        ...parts().own,
        created: 0,
        invested: 0,
        realized: 0,
        unrealized: 0,
      },
      audience: {
        ...parts().audience,
        invested: 0,
        realized: 12,
        unrealized: 0,
        copies_created: 0,
        unique_copiers: 0,
      },
      strategies: [],
      bots: [],
    }));
    expect(profile.earnings.totalPnlPct).toBe(0);
    expect(profile.audience.pnlPct).toBe(0);
    expect(profile.audience.pnlUsdt).toBe(12);
    expect(profile.bestBotId).toBeNull();
    expect(profile.worstBotId).toBeNull();
    expect(profile.bots.published).toBe(0);
  });
});

describe('stampLiveEquity', () => {
  it('replaces a stale boot snapshot with the live positive equity', () => {
    const points = stampLiveEquity(
      [
        { date: '2026-09-21', equity: 100 },
        { date: '2026-09-22', equity: 96 },
      ],
      138.39,
      '2026-09-22',
    );
    expect(points).toEqual([
      { date: '2026-09-21', equity: 100 },
      { date: '2026-09-22', equity: 138.39 },
    ]);
    expect(points[1]!.equity).toBeGreaterThan(points[0]!.equity);
  });
});
