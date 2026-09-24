import { describe, expect, it } from 'vitest';
import { pnlFromExchangePosition } from '../src/bot/exchange-pnl';

describe('pnlFromExchangePosition', () => {
  it('uses GRVT realized + unrealized + total', () => {
    expect(pnlFromExchangePosition({
      unrealized_pnl: '19.44172',
      realized_pnl: '8.5946',
      total_pnl: '28.03646',
    })).toEqual({
      unrealized: 19.44172,
      realized: 8.5946,
      total: 28.03646,
    });
  });

  it('falls back to the sum when total is missing', () => {
    expect(pnlFromExchangePosition({
      unrealized_pnl: 10,
      realized_pnl: 5,
    })).toEqual({ unrealized: 10, realized: 5, total: 15 });
  });

  it('returns zeros without a position', () => {
    expect(pnlFromExchangePosition(null)).toEqual({
      unrealized: 0,
      realized: 0,
      total: 0,
    });
  });
});
