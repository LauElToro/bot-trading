// Grid backtest. Walks historical candles the way the live bot trades:
// inventory, per-fill fees, funding, liquidation, SL/TP, auto-shift,
// compound, and the virtual window. No GRVT calls and no DB writes.

import { getInstrumentSpec } from '../api/client.js';
import type { GridBot } from '../database/db.js';
import {
  buyWouldFlipShort,
  computeLiqPriceLocal,
  computeQtyPerLevel,
  decideCompound,
  wouldCloseAtLossWithoutStopLoss,
} from './grid-engine.js';

export interface BacktestConfig {
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  lowerPrice: number;
  upperPrice: number;
  numGrids: number;
  investmentUSDT: number;
  // Per-side fee in percent. 0.05 means 5 bps (GRVT maker default).
  feePct?: number;
  slPct?: number | null;
  tpPct?: number | null;
  autoShiftEnabled?: boolean;
  autoShiftPct?: number;
  compoundPct?: number;
  virtualEnabled?: boolean;
  activeWindowSize?: number;
  // Signed funding rate, percent of notional per 8h. Positive: longs pay.
  fundingRatePct?: number;
}

export interface BacktestCandle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export type BacktestStop =
  | 'none'
  | 'outside_range'
  | 'liquidation'
  | 'stop_loss'
  | 'take_profit';

export interface BacktestFrame {
  time: number;
  price: number;
  equity: number;
  position: number;
  lower: number;
  upper: number;
}

export interface BacktestResult {
  totalProfit: number;
  totalFees: number;
  netProfit: number;
  maxDrawdownPct: number;
  roundTrips: number;
  avgProfitPerTrip: number;
  equityCurve: Array<{ time: number; equity: number }>;
  daysInMarket: number;
  profitFactor: number;
  candlesProcessed: number;
  endingEquity: number;
  roiPct: number;
  fundingPaid: number;
  unrealizedPnl: number;
  buyHoldPct: number;
  timeInRangePct: number;
  stoppedBy: BacktestStop;
  shifts: number;
  compounds: number;
  liquidated: boolean;
  frames: BacktestFrame[];
  startPrice: number;
}

interface SimLevel {
  index: number;
  price: number;
  side: 'buy' | 'sell';
  quantity: number;
  isFilled: boolean;
}

const FUNDING_SEC = 8 * 3600;
const SHIFT_COOLDOWN_SEC = 3600;
const EPS = 1e-8;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): BacktestResult {
  return {
    totalProfit: 0,
    totalFees: 0,
    netProfit: 0,
    maxDrawdownPct: 0,
    roundTrips: 0,
    avgProfitPerTrip: 0,
    equityCurve: [],
    daysInMarket: 0,
    profitFactor: 0,
    candlesProcessed: 0,
    endingEquity: 0,
    roiPct: 0,
    fundingPaid: 0,
    unrealizedPnl: 0,
    buyHoldPct: 0,
    timeInRangePct: 0,
    stoppedBy: 'none',
    shifts: 0,
    compounds: 0,
    liquidated: false,
    frames: [],
    startPrice: 0,
  };
}

function levelPrice(lower: number, spacing: number, index: number): number {
  return Math.round((lower + index * spacing) * 100) / 100;
}

function sideFor(direction: 'long' | 'short', price: number, mark: number): 'buy' | 'sell' {
  if (direction === 'long') return price < mark ? 'buy' : 'sell';
  return price > mark ? 'sell' : 'buy';
}

function buildLevels(
  lower: number,
  upper: number,
  numGrids: number,
  qty: number,
  direction: 'long' | 'short',
  mark: number,
): SimLevel[] {
  const spacing = (upper - lower) / numGrids;
  const levels: SimLevel[] = [];
  for (let i = 0; i <= numGrids; i++) {
    const price = levelPrice(lower, spacing, i);
    levels.push({
      index: i,
      price,
      side: sideFor(direction, price, mark),
      quantity: qty,
      isFilled: false,
    });
  }
  let gap = 0;
  let best = Infinity;
  for (const level of levels) {
    const dist = Math.abs(level.price - mark);
    if (dist < best) {
      best = dist;
      gap = level.index;
    }
  }
  const gapLevel = levels[gap];
  if (gapLevel) gapLevel.isFilled = true;
  return levels;
}

function canonicalQty(
  investment: number,
  leverage: number,
  numGrids: number,
  lower: number,
  upper: number,
  pair: string,
): number {
  const mid = (lower + upper) / 2;
  let qty = computeQtyPerLevel(investment, leverage, numGrids, mid, pair);
  const { min_size: minSize, min_notional: minNotional } = getInstrumentSpec(pair);
  while (qty * lower < minNotional) qty += minSize;
  return Math.round(qty * 100) / 100;
}

export function runBacktest(
  config: BacktestConfig,
  candles: BacktestCandle[],
): BacktestResult {
  if (candles.length === 0) return emptyResult();

  const startIdx = candles.findIndex(
    (candle) => candle.close > config.lowerPrice && candle.close < config.upperPrice,
  );
  if (startIdx < 0) {
    return {
      ...emptyResult(),
      stoppedBy: 'outside_range',
      startPrice: candles[candles.length - 1]!.close,
    };
  }
  const series = candles.slice(startIdx);

  const feeRate = (config.feePct ?? 0.05) / 100;
  const fundingRate = (config.fundingRatePct ?? 0) / 100;
  const originalInvestment = config.investmentUSDT;
  const first = series[0]!;
  const firstPrice = first.close;

  let lower = config.lowerPrice;
  let upper = config.upperPrice;
  let investment = originalInvestment;
  let qty = canonicalQty(investment, config.leverage, config.numGrids, lower, upper, config.pair);
  let levels = buildLevels(lower, upper, config.numGrids, qty, config.direction, firstPrice);

  let position = 0;
  let avgEntry = 0;
  let realized = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalFees = 0;
  let fundingPaid = 0;
  let roundTrips = 0;
  let shifts = 0;
  let compounds = 0;
  let alreadyCompounded = 0;
  let lastCompoundAt: string | undefined;
  let lastShiftAt = -Infinity;
  let lastFunding = first.time;
  let stoppedBy: BacktestStop = 'none';
  let liquidated = false;
  let inRange = 0;
  let maxDrawdownPct = 0;
  let hwm = originalInvestment;
  const equityCurve: Array<{ time: number; equity: number }> = [];

  const slPct = config.slPct != null && config.slPct > 0 ? config.slPct : null;
  const tpPct = config.tpPct != null && config.tpPct > 0 ? config.tpPct : null;

  if (config.direction === 'long') {
    const seeded = levels
      .filter((level) => level.side === 'sell' && !level.isFilled && level.price > firstPrice)
      .reduce((sum, level) => sum + level.quantity, 0);
    if (seeded > EPS) {
      const maxQty = (originalInvestment * config.leverage) / firstPrice;
      const qtyOpen = Math.min(seeded, maxQty);
      position = qtyOpen;
      avgEntry = firstPrice;
      totalFees += qtyOpen * firstPrice * feeRate;
    }
  }

  const unrealizedAt = (mark: number): number => {
    if (Math.abs(position) < EPS || avgEntry <= 0) return 0;
    return position * (mark - avgEntry);
  };

  const equityAt = (mark: number): number =>
    originalInvestment + realized - totalFees - fundingPaid + unrealizedAt(mark);

  const liqPrice = (): number | null => {
    if (Math.abs(position) < EPS || avgEntry <= 0) return null;
    return computeLiqPriceLocal({
      avg_entry_price: avgEntry,
      leverage: config.leverage,
      direction: config.direction,
    } as GridBot);
  };

  function withinMargin(nextAbs: number, price: number): boolean {
    const maxNotional = investment * config.leverage;
    return nextAbs * price <= maxNotional + 1;
  }

  function chargeFee(notional: number) {
    totalFees += notional * feeRate;
  }

  function openLong(level: SimLevel, price: number) {
    const next = position + level.quantity;
    avgEntry = position > EPS ? (avgEntry * position + price * level.quantity) / next : price;
    position = next;
    chargeFee(price * level.quantity);
  }

  function openShort(level: SimLevel, price: number) {
    const prevAbs = Math.abs(position);
    const nextAbs = prevAbs + level.quantity;
    avgEntry = prevAbs > EPS ? (avgEntry * prevAbs + price * level.quantity) / nextAbs : price;
    position = -nextAbs;
    chargeFee(price * level.quantity);
  }

  function closeQty(price: number, qtyClose: number, pnl: number) {
    if (qtyClose <= EPS) return;
    realized += pnl;
    if (pnl > 0) grossProfit += pnl;
    else grossLoss += Math.abs(pnl);
    roundTrips += 1;
    chargeFee(price * qtyClose);
    if (position > 0) position = Math.max(0, position - qtyClose);
    else position = Math.min(0, position + qtyClose);
    if (Math.abs(position) < EPS) {
      position = 0;
      avgEntry = 0;
    }
  }

  function flatten(price: number) {
    if (Math.abs(position) < EPS) return;
    const qtyClose = Math.abs(position);
    const pnl = position > 0 ? (price - avgEntry) * qtyClose : (avgEntry - price) * qtyClose;
    closeQty(price, qtyClose, pnl);
  }

  function rearm(level: SimLevel) {
    level.isFilled = true;
    const neighbor = level.side === 'buy' ? level.index + 1 : level.index - 1;
    const other = levels[neighbor];
    if (!other) return;
    other.isFilled = false;
    other.side = level.side === 'buy' ? 'sell' : 'buy';
  }

  function activeIndexes(mark: number): Set<number> {
    const open = levels.filter((level) => !level.isFilled);
    if (!config.virtualEnabled) return new Set(open.map((level) => level.index));
    const windowSize = Math.max(1, config.activeWindowSize ?? 70);
    open.sort((a, b) => Math.abs(a.price - mark) - Math.abs(b.price - mark));
    return new Set(open.slice(0, windowSize).map((level) => level.index));
  }

  function tryFill(level: SimLevel, price: number): boolean {
    if (level.isFilled) return false;
    const guardBot = {
      direction: config.direction,
      sl_pct: slPct,
      position_size: position,
      avg_entry_price: avgEntry,
    };
    if (wouldCloseAtLossWithoutStopLoss(guardBot, level.side, price)) return false;

    if (config.direction === 'long') {
      if (level.side === 'buy') {
        if (!withinMargin(position + level.quantity, price)) return false;
        openLong(level, price);
        rearm(level);
        return true;
      }
      const qtyClose = Math.min(level.quantity, Math.max(0, position));
      if (qtyClose <= EPS) return false;
      closeQty(price, qtyClose, (price - avgEntry) * qtyClose);
      rearm(level);
      return true;
    }

    if (level.side === 'sell') {
      if (!withinMargin(Math.abs(position) + level.quantity, price)) return false;
      openShort(level, price);
      rearm(level);
      return true;
    }
    const cover = Math.min(level.quantity, Math.abs(Math.min(0, position)));
    if (cover <= EPS) return false;
    if (buyWouldFlipShort(config.direction, position, 'buy', cover)) return false;
    closeQty(price, cover, (avgEntry - price) * cover);
    rearm(level);
    return true;
  }

  function fillsOnSegment(from: number, to: number): boolean {
    if (Math.abs(to - from) < EPS) return false;
    const down = to < from;
    const liq = liqPrice();
    let end = to;
    let hitLiq = false;
    if (liq != null && config.direction === 'long' && down && from > liq && to <= liq) {
      end = liq;
      hitLiq = true;
    }
    if (liq != null && config.direction === 'short' && !down && from < liq && to >= liq) {
      end = liq;
      hitLiq = true;
    }

    const active = activeIndexes(from);
    const hits = levels.filter((level) => {
      if (level.isFilled || !active.has(level.index)) return false;
      if (down) return level.side === 'buy' && level.price < from && level.price >= end;
      return level.side === 'sell' && level.price > from && level.price <= end;
    });
    hits.sort((a, b) => (down ? b.price - a.price : a.price - b.price));
    for (const level of hits) {
      if (level.isFilled || !activeIndexes(level.price).has(level.index)) continue;
      tryFill(level, level.price);
    }

    if (hitLiq && liq != null) {
      flatten(liq);
      liquidated = true;
      stoppedBy = 'liquidation';
      return true;
    }
    return false;
  }

  function applyFunding(time: number, mark: number) {
    if (fundingRate === 0 || Math.abs(position) < EPS) {
      if (time - lastFunding >= FUNDING_SEC) {
        const steps = Math.floor((time - lastFunding) / FUNDING_SEC);
        lastFunding += steps * FUNDING_SEC;
      }
      return;
    }
    while (time - lastFunding >= FUNDING_SEC) {
      lastFunding += FUNDING_SEC;
      const notional = Math.abs(position) * mark;
      const payment = config.direction === 'long' ? notional * fundingRate : -notional * fundingRate;
      fundingPaid += payment;
    }
  }

  function maybeShift(time: number, mark: number) {
    if (!config.autoShiftEnabled || !(config.autoShiftPct && config.autoShiftPct > 0)) return;
    if (time - lastShiftAt < SHIFT_COOLDOWN_SEC) return;
    const width = upper - lower;
    if (width <= 0) return;
    const above = mark > upper;
    const below = mark < lower;
    if (!above && !below) return;
    const exitDist = above ? ((mark - upper) / width) * 100 : ((lower - mark) / width) * 100;
    if (exitDist < config.autoShiftPct) return;
    const nextLower = Math.round((mark - width / 2) * 100) / 100;
    const nextUpper = Math.round((mark + width / 2) * 100) / 100;
    if (nextLower <= 0 || nextLower >= nextUpper) return;
    lower = nextLower;
    upper = nextUpper;
    levels = buildLevels(lower, upper, config.numGrids, qty, config.direction, mark);
    lastShiftAt = time;
    shifts += 1;
  }

  function maybeCompound(time: number) {
    if (!(config.compoundPct && config.compoundPct > 0)) return;
    const decision = decideCompound(
      {
        pair: config.pair,
        investment_usdt: investment,
        leverage: config.leverage,
        num_grids: config.numGrids,
        lower_price: lower,
        upper_price: upper,
        grid_profit_usdt: realized - totalFees,
        compound_pct: config.compoundPct,
        compound_threshold_usdt: 50,
        compound_interval_hours: 24,
        last_compound_at: lastCompoundAt,
      },
      alreadyCompounded,
      new Date(time * 1000),
    );
    if (!decision.compound) return;
    investment = decision.newInvestment;
    alreadyCompounded += decision.compoundAmount;
    qty = decision.newQty;
    for (const level of levels) level.quantity = qty;
    lastCompoundAt = new Date(time * 1000).toISOString();
    compounds += 1;
  }

  const frames: BacktestFrame[] = [];
  let processed = 0;
  for (const candle of series) {
    const path = candle.close >= candle.open
      ? [candle.open, candle.low, candle.high, candle.close]
      : [candle.open, candle.high, candle.low, candle.close];
    let halted = false;
    for (let i = 0; i < path.length - 1; i++) {
      if (fillsOnSegment(path[i]!, path[i + 1]!)) {
        halted = true;
        break;
      }
    }
    const exitMark = candle.close;
    applyFunding(candle.time, exitMark);
    if (exitMark >= lower && exitMark <= upper) inRange += 1;
    const equity = equityAt(exitMark);
    if (equity > hwm) hwm = equity;
    const dd = hwm > 0 ? ((hwm - equity) / hwm) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    equityCurve.push({ time: candle.time, equity });
    frames.push({
      time: candle.time,
      price: exitMark,
      equity,
      position,
      lower,
      upper,
    });
    processed += 1;
    if (halted) break;

    const totalPnl = equity - originalInvestment;
    if (slPct != null && totalPnl < 0 && investment > 0) {
      const lossPct = (totalPnl / investment) * -100;
      if (lossPct >= slPct) {
        flatten(candle.close);
        stoppedBy = 'stop_loss';
        equityCurve[equityCurve.length - 1] = { time: candle.time, equity: equityAt(candle.close) };
        break;
      }
    }
    if (tpPct != null && totalPnl > 0 && investment > 0) {
      const gainPct = (totalPnl / investment) * 100;
      if (gainPct >= tpPct) {
        flatten(candle.close);
        stoppedBy = 'take_profit';
        equityCurve[equityCurve.length - 1] = { time: candle.time, equity: equityAt(candle.close) };
        break;
      }
    }

    maybeShift(candle.time, candle.close);
    maybeCompound(candle.time);
  }

  const lastCandle = series[Math.max(0, processed - 1)]!;
  const unrealizedPnl = liquidated || stoppedBy === 'stop_loss' || stoppedBy === 'take_profit'
    ? 0
    : unrealizedAt(lastCandle.close);
  const endingRaw = originalInvestment + realized - totalFees - fundingPaid + unrealizedPnl;
  const netProfit = round2(endingRaw - originalInvestment);
  const endingEquity = round2(originalInvestment + netProfit);
  const firstClose = first.close;
  const lastClose = lastCandle.close;
  const buyHoldPct = firstClose > 0
    ? ((config.direction === 'long' ? lastClose - firstClose : firstClose - lastClose) / firstClose) * 100
    : 0;

  return {
    totalProfit: round2(grossProfit),
    totalFees: round2(totalFees),
    netProfit,
    maxDrawdownPct: round2(maxDrawdownPct),
    roundTrips,
    avgProfitPerTrip: roundTrips > 0 ? round2(netProfit / roundTrips) : 0,
    equityCurve,
    daysInMarket: Math.max(1, Math.round((lastCandle.time - first.time) / 86400)),
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : grossProfit > 0 ? Infinity : 0,
    candlesProcessed: processed,
    endingEquity,
    roiPct: originalInvestment > 0 ? round2((netProfit / originalInvestment) * 100) : 0,
    fundingPaid: round2(fundingPaid),
    unrealizedPnl: round2(unrealizedPnl),
    buyHoldPct: round2(buyHoldPct),
    timeInRangePct: processed > 0 ? round2((inRange / processed) * 100) : 0,
    stoppedBy,
    shifts,
    compounds,
    liquidated,
    frames,
    startPrice: firstPrice,
  };
}
