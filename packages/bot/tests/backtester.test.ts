import { describe, it, expect } from 'vitest';
import { runBacktest, type BacktestCandle } from '../src/bot/backtester';

const BASE = {
  pair: 'TEST_USDT_Perp',
  direction: 'long' as const,
  leverage: 1,
  lowerPrice: 100,
  upperPrice: 110,
  numGrids: 10,
  investmentUSDT: 1000,
  feePct: 0,
};

function sweepCandle(low: number, high: number, time: number): BacktestCandle {
  return { time, open: low, close: high, low, high };
}

function anchor(price: number, time: number): BacktestCandle {
  return { time, open: price, close: price, low: price, high: price };
}

describe('runBacktest', () => {
  it('returns zero result on empty candles', () => {
    const r = runBacktest(BASE, []);
    expect(r.candlesProcessed).toBe(0);
    expect(r.roundTrips).toBe(0);
    expect(r.totalProfit).toBe(0);
    expect(r.netProfit).toBe(0);
    expect(r.equityCurve).toEqual([]);
    expect(r.stoppedBy).toBe('none');
  });

  it('stops when the first price is outside the range', () => {
    const r = runBacktest(BASE, [anchor(50, 0)]);
    expect(r.stoppedBy).toBe('outside_range');
    expect(r.roundTrips).toBe(0);
    expect(r.candlesProcessed).toBe(0);
    expect(r.startPrice).toBe(50);
  });

  it('starts at the first candle inside the range', () => {
    const candles: BacktestCandle[] = [
      anchor(50, 0),
      anchor(105, 3600),
      sweepCandle(99, 111, 7200),
    ];
    const r = runBacktest(BASE, candles);
    expect(r.stoppedBy).not.toBe('outside_range');
    expect(r.candlesProcessed).toBe(2);
    expect(r.roundTrips).toBeGreaterThan(0);
  });

  it('records round trips only when inventory is closed', () => {
    const candles: BacktestCandle[] = [
      anchor(105, 0),
      sweepCandle(99, 111, 3600),
    ];
    const r = runBacktest(BASE, candles);
    expect(r.roundTrips).toBeGreaterThan(0);
    expect(r.totalProfit).toBeGreaterThan(0);
    expect(r.endingEquity).toBeCloseTo(BASE.investmentUSDT + r.netProfit, 2);
  });

  it('does not book profit on a short sell that never covers', () => {
    const candles: BacktestCandle[] = [
      anchor(105, 0),
      { time: 3600, open: 105, high: 109, low: 105, close: 109 },
    ];
    const r = runBacktest({ ...BASE, direction: 'short' }, candles);
    expect(r.roundTrips).toBe(0);
    expect(r.totalProfit).toBe(0);
    expect(r.unrealizedPnl).not.toBe(0);
  });

  it('profits a short grid when price rises and comes back down', () => {
    const candles: BacktestCandle[] = [
      anchor(105, 0),
      { time: 3600, open: 105, high: 109, low: 100, close: 102 },
    ];
    const r = runBacktest({ ...BASE, direction: 'short', feePct: 0 }, candles);
    expect(r.roundTrips).toBeGreaterThan(0);
    expect(r.totalProfit).toBeGreaterThan(0);
    expect(r.netProfit).toBeGreaterThan(0);
  });

  it('charges fees on fills and funding on the open position', () => {
    const candles: BacktestCandle[] = [
      anchor(105, 0),
      anchor(105, 8 * 3600),
    ];
    const noFee = runBacktest({ ...BASE, feePct: 0, fundingRatePct: 0 }, candles);
    const withFee = runBacktest({ ...BASE, feePct: 0.05, fundingRatePct: 0.01 }, candles);
    expect(withFee.totalFees).toBeGreaterThan(0);
    expect(withFee.fundingPaid).toBeGreaterThan(0);
    expect(withFee.netProfit).toBeLessThan(noFee.netProfit);
    expect(withFee.totalProfit).toBeCloseTo(noFee.totalProfit, 2);
  });

  it('tracks max drawdown when price falls below the range', () => {
    const candles: BacktestCandle[] = [
      anchor(105, 0),
      { time: 3600, open: 105, high: 105, low: 90, close: 90 },
    ];
    const r = runBacktest(BASE, candles);
    expect(r.maxDrawdownPct).toBeGreaterThan(0);
    expect(r.stoppedBy).toBe('none');
  });

  it('stops at liquidation when a crash crosses the liq price', () => {
    const candles: BacktestCandle[] = [
      anchor(105, 0),
      { time: 3600, open: 105, high: 105, low: 50, close: 50 },
      anchor(50, 7200),
    ];
    const r = runBacktest({ ...BASE, leverage: 20, feePct: 0 }, candles);
    expect(r.liquidated).toBe(true);
    expect(r.stoppedBy).toBe('liquidation');
    expect(r.candlesProcessed).toBe(2);
    expect(r.endingEquity).toBeCloseTo(BASE.investmentUSDT + r.netProfit, 2);
  });

  it('stops on stop-loss and take-profit', () => {
    const drop: BacktestCandle[] = [
      anchor(105, 0),
      { time: 3600, open: 105, high: 105, low: 90, close: 90 },
      anchor(90, 7200),
    ];
    const sl = runBacktest({ ...BASE, leverage: 5, slPct: 5, feePct: 0 }, drop);
    expect(sl.stoppedBy).toBe('stop_loss');
    expect(sl.candlesProcessed).toBeLessThan(drop.length);

    const rally: BacktestCandle[] = [
      anchor(105, 0),
      sweepCandle(105, 111, 3600),
      anchor(110, 7200),
    ];
    const tp = runBacktest({ ...BASE, tpPct: 1, feePct: 0 }, rally);
    expect(tp.stoppedBy).toBe('take_profit');
    expect(tp.candlesProcessed).toBeLessThan(rally.length);
  });

  it('recenters the range on auto-shift and compounds realized profit', () => {
    const shifted: BacktestCandle[] = [
      anchor(105, 0),
      { time: 3600, open: 105, high: 112, low: 105, close: 112 },
    ];
    const shift = runBacktest({
      ...BASE,
      autoShiftEnabled: true,
      autoShiftPct: 10,
      feePct: 0,
    }, shifted);
    expect(shift.shifts).toBe(1);
    expect(shift.stoppedBy).toBe('none');

    const compounded: BacktestCandle[] = [
      anchor(105, 0),
      sweepCandle(100, 111, 3600),
    ];
    const compound = runBacktest({
      ...BASE,
      investmentUSDT: 10000,
      leverage: 5,
      compoundPct: 50,
      feePct: 0,
    }, compounded);
    expect(compound.compounds).toBeGreaterThan(0);
    expect(compound.endingEquity).toBeCloseTo(10000 + compound.netProfit, 2);
  });

  it('does not grow a short past initial margin when the range keeps shifting', () => {
    const candles: BacktestCandle[] = [];
    for (let i = 0; i < 20; i++) {
      const price = 105 + i * 3;
      candles.push({ time: i * 7200, open: price - 3, high: price, low: price - 3, close: price });
    }
    const r = runBacktest({
      ...BASE,
      direction: 'short',
      leverage: 5,
      autoShiftEnabled: true,
      autoShiftPct: 1,
      feePct: 0,
    }, candles);
    const last = r.frames[r.frames.length - 1]!;
    expect(Math.abs(last.position) * last.price).toBeLessThanOrEqual(BASE.investmentUSDT * 5 + 1);
  });

  it('reports daysInMarket from first to last candle time', () => {
    const oneDay = 86400;
    const candles: BacktestCandle[] = [
      anchor(105, 0),
      anchor(105, oneDay * 7),
    ];
    const r = runBacktest(BASE, candles);
    expect(r.daysInMarket).toBe(7);
  });
});
