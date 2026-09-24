// Type definitions for the v2 REST API responses.
// Mirrors packages/bot/src/server/v2-router.ts. Hand-written for now;
// promote to autogen (zod schema or openapi) when the API stabilizes.

export type BotStatus = 'running' | 'paused' | 'stopped' | 'error';

export interface BotSummary {
  id: number;
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  lower_price: number;
  upper_price: number;
  num_grids: number;
  investment_usdt: number;
  grid_profit_usdt: number;
  trend_pnl_usdt: number;
  total_pnl_usdt: number;
  status: BotStatus;
  position_size: number;
  avg_entry_price: number;
  liquidation_price: number | null;
  created_at: string;
  updated_at: string;
  // Compound rebalance (optional — 0 or absent = disabled)
  compound_pct?: number;
  compound_threshold_usdt?: number;
  compound_interval_hours?: number;
  last_compound_at?: string | null;
  total_reinvested?: number;
  original_investment_usdt?: number;
  quantity_per_level?: number;
  // H.2: dynamic grid auto-shift
  auto_shift_enabled?: 0 | 1;
  auto_shift_pct?: number | null;
  last_auto_shift_at?: number | null;
  // H.3: stop-loss / take-profit (% of investment_usdt)
  sl_pct?: number | null;
  tp_pct?: number | null;
  // H.8: virtual grids
  virtual_enabled?: 0 | 1;
  active_window_size?: number | null;
  // H.5: optional sub-account this bot routes through. NULL = default creds.
  grvt_sub_account_id?: number | null;
}

export interface GridLevel {
  id: number;
  level_index: number;
  price: number;
  side: 'buy' | 'sell';
  quantity: number;
  is_filled: 0 | 1;
  pending_replace: 0 | 1;
  order_id: string | null;
  // H.8 virtual grids: level outside the active rotation window has no
  // GRVT order and is rendered muted in the chart.
  state?: 'active' | 'virtual' | 'filled';
}

export interface GridState {
  botId: number;
  pair: string;
  status: BotStatus;
  levels: GridLevel[];
  ticker: unknown;
  position: unknown;
  openOrders: unknown[];
  ts: number;
}

export interface Trade {
  id: number;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fee: number;
  round_trip_profit: number | null;
  created_at: string;
}

export interface DailySnapshot {
  id: number;
  bot_id: number;
  date: string;
  equity_usdt: number;
  realized_pnl_usdt: number;
  unrealized_pnl_usdt: number;
  num_round_trips: number;
  total_fees_usdt: number;
  funding_usdt: number;
}

export interface Roundtrip {
  id: number;
  buy_fill_id: string;
  sell_fill_id: string;
  buy_price: number;
  sell_price: number;
  size: number;
  profit: number;
  created_at: string;
}

// A fill recorded by the engine's fill poller, sourced verbatim from
// GRVT's fill_history endpoint. Every field is real exchange data:
//   - `fee` is what GRVT actually charged (positive) or refunded
//     (negative — maker rebate) for THIS fill on THIS account at the
//     user's current volume tier. Different accounts pay different
//     rates; the bot is fee-agnostic and never assumes a value.
export interface FillRow {
  id: number;
  fill_id: string;     // == event_time, used as the unique key
  event_time: string;  // GRVT nanosecond timestamp
  is_buyer: 0 | 1;
  price: number;
  size: number;
  fee: number;         // signed; negative = rebate earned
  created_at: string;  // ISO from event_time
}

export interface RebateSummary {
  count: number;        // total fills observed
  sumFee: number;       // signed; negative = net rebate earned
  netRebateUsdt: number; // -sumFee; positive when user earned net
  avgFee: number;
  minFee: number;
  maxFee: number;
}

// Returned by /api/v2/bots/:id/range/preview AND used internally by the
// commit endpoint so the user is committing to exactly what they saw.
// Mirrors RangeUpdatePlan from the bot engine — every numeric field is
// derived from real GRVT state, no estimates.
export interface RangeUpdatePlan {
  botId: number;
  currentRange: { lower: number; upper: number };
  newRange: { lower: number; upper: number };
  currentPrice: number;
  currentPosition: number;
  newSellLevels: number;
  newBuyLevels: number;
  newTotalLevels: number;
  newSpacing: number;
  canonicalQty: number;
  ethNeeded: number;
  ethDeficit: number;
  ethExcess: number;
  autoBuy: {
    size: number;
    estimatedPrice: number;
    estimatedCost: number;
    slippagePct: number;
    estimatedSlippageUsd: number;
  } | null;
  ordersToCancel: number;
  ordersToCancelSample: Array<{ order_id: string; price: number }>;
  levelsToCreate: number;
  warnings: string[];
  safetyViolations: string[];
  noop: boolean;
}

// Real grid_profit, computed by spread-pairing every fill in fills_archive
// (filtered to post-bot-creation). Same algorithm the engine uses for
// bot.grid_profit_usdt, but operating over the FULL backfilled history
// instead of just the last ~430 fills GRVT exposes per request.
//
// Why spread-pair instead of FIFO: a grid bot opens 93 simultaneous
// positions at different price levels — FIFO over the flat fill stream
// would falsely match a $1800 buy against a $2240 sell (+$440/ETH that
// never actually happened). Spread-pair only matches buys & sells whose
// price difference is within one grid spacing window.
//
// Why not equity-minus-investment: bot.investment_usdt is bumped by
// compound rebalances AND by external margin transfers, so it doesn't
// reflect original cash deposited.
export interface RealizedSummary {
  gridProfit: number;       // gross trade-pair profit
  totalFees: number;        // signed; negative = net rebate earned
  netGridProfit: number;    // gridProfit - totalFees (rebates increase net)
  pairs: number;            // matched grid round trips
  avgPerPair: number;
  fillCount: number;
  unpairedBuys: number;     // open BUY lots (≈ current position)
  unpairedSells: number;    // SELLs without matching BUY (data gap warning)
  firstFillAt: string | null;
  lastFillAt: string | null;
}

// H.7: aggregate metrics across all of the user's non-stopped bots.
// Returned by GET /api/v2/portfolio-summary.
export interface PortfolioSummary {
  botCount: number;
  runningCount: number;
  totalInvested: number;
  totalEquity: number;
  totalRealized: number;
  totalUnrealized: number;
  totalPnl: number;
  totalPnlPct: number;
  totalPositionUsdt: number;
  avgLeverage: number;
  // Per-pair notional exposure (sum of position_size * avg_entry_price).
  pairExposure: Record<string, number>;
}

// H.7: per-day equity, summed across the user's non-stopped bots.
// Returned by GET /api/v2/portfolio-equity-curve.
export interface PortfolioEquityPoint {
  date: string;   // YYYY-MM-DD
  equity: number; // USD
}

// H.6: backtest request/response. POST /api/v2/backtest runs a pure
// simulation against historical GRVT candles — no orders placed.
export interface BacktestInput {
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  lower_price: number;
  upper_price: number;
  num_grids: number;
  investment_usdt: number;
  fee_pct?: number;          // default 0.05 (5 bps maker)
  interval?: CandleInterval; // default 'CI_1_H'
  limit?: number;            // candle count, default 500, max 1000
  sl_pct?: number;
  tp_pct?: number;
  auto_shift_enabled?: boolean;
  auto_shift_pct?: number;
  compound_pct?: number;
  virtual_enabled?: boolean;
  active_window_size?: number;
  funding_rate_pct?: number; // signed, percent of notional per 8h
  days?: number;
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
  stoppedBy: 'none' | 'outside_range' | 'liquidation' | 'stop_loss' | 'take_profit';
  shifts: number;
  compounds: number;
  liquidated: boolean;
  frames: Array<{
    time: number;
    price: number;
    equity: number;
    position: number;
    lower: number;
    upper: number;
  }>;
  interval?: string;
  days?: number;
  startPrice: number;
}

export interface OrderRow {
  id: number;
  order_id: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  quantity: number;
  price: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  grid_level_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface FundingRow {
  id: number;
  instrument: string;
  funding_rate: number;
  payment_usdt: number;
  position_size: number;
  funding_time: string;
  created_at: string;
}

export interface WizardPreset {
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  lower_price: number;
  upper_price: number;
  num_grids: number;
  investment_usdt: number;
  virtual_enabled?: boolean;
  active_window_size?: number;
  sl_pct?: number;
  tp_pct?: number;
  auto_shift_enabled?: boolean;
  auto_shift_pct?: number;
  compound_pct?: number;
  copiedFrom?: {
    publishedId: number;
    sourceBotId?: number | null;
    authorName: string;
    rangeAdapted?: boolean;
    originalLower?: number;
    originalUpper?: number;
    markPrice?: number;
  };
}

export interface ValidateBotInput {
  pair: string;
  direction: 'long' | 'short';
  lower_price: number;
  upper_price: number;
  num_grids: number;
  investment_usdt: number;
  leverage: number;
  // H.8: Virtual grids
  virtual_enabled?: boolean;
  active_window_size?: number;
  // H.5: optional sub-account routing. Null/missing = default creds.
  grvt_sub_account_id?: number | null;
}

// H.5: GRVT sub-account row as the dashboard sees it (no encrypted fields).
export interface GrvtSubAccount {
  id: number;
  label: string;
  isDefault: boolean;
  lastTestOk: boolean | null;
  createdAt: number;
}

export interface ValidateBotResult {
  valid: true;
  pair: string;
  direction: 'long' | 'short';
  input: {
    lower: number;
    upper: number;
    grids: number;
    investment: number;
    leverage: number;
  };
  computed: {
    spacing: number;
    spacingPct: number;
    qtyPerLevel: number;
    notional: number;
    profitPerRoundTrip: number;
    midPrice: number;
    liquidationEstimate: number;
    liqDistancePct: number;
  };
  warnings: string[];
}

// Kline / candlestick — both timestamps in unix MILLISECONDS (not ns).
// The bot's getKlines() already converts the GRVT ns string format.
export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export type CandleInterval =
  | 'CI_1_M'
  | 'CI_5_M'
  | 'CI_15_M'
  | 'CI_30_M'
  | 'CI_1_H'
  | 'CI_4_H'
  | 'CI_1_D';

export interface UserProfile {
  id: string;
  email: string;
  isAdmin: boolean;
  hasGrvtCreds: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  displayName: string | null;
  bio: string | null;
  hasAvatar: boolean;
  avatarUpdatedAt: number | null;
  tags: string[];
}

export interface CommunityAuthor {
  id: string;
  name: string;
  hasAvatar: boolean;
  avatarUpdatedAt?: number | null;
  tags?: string[];
}

export interface CommunityBot {
  id: number;
  rank: number;
  title: string;
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  lowerPrice: number;
  upperPrice: number;
  rangeWidthPct?: number;
  numGrids: number;
  investmentUsdt: number;
  virtualEnabled: boolean;
  activeWindowSize: number | null;
  slPct: number | null;
  tpPct: number | null;
  autoShiftEnabled: boolean;
  autoShiftPct: number | null;
  compoundPct: number | null;
  pnlUsdt: number;
  pnlPct: number;
  copiesCount: number;
  publishedAt: number;
  liveStatus?: 'running' | 'paused' | 'stopped' | 'closed' | 'aggregate';
  startedAt?: number | null;
  endedAt?: number | null;
  durationMs?: number | null;
  roundtrips?: number;
  sourceBotId?: number | null;
  isAuthorTotal?: boolean;
  author: CommunityAuthor;
}

export interface ProfileOwnBot {
  id: number;
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  status: BotStatus;
  investmentUsdt: number;
  realizedUsdt: number;
  unrealizedUsdt: number;
  pnlUsdt: number;
  pnlPct: number;
  createdAt: string;
  copiedFromBotId: number | null;
  copiedFromName: string | null;
  published: boolean;
  publishedId: number | null;
}

export interface ProfileStrategy {
  id: number;
  title: string;
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  liveStatus: BotStatus | 'closed';
  ownPnlUsdt: number;
  ownPnlPct: number;
  copiesCount: number;
  copiesCreated: number;
  uniqueCopiers: number;
  copiesRunning: number;
  copiesPaused: number;
  copiesClosed: number;
  copierInvestedUsdt: number;
  copierPnlUsdt: number;
  copierPnlPct: number;
  publishedAt: number;
  sourceBotId: number | null;
}

export interface ProfileCopier {
  id: string;
  name: string;
  tags: string[];
  hasAvatar: boolean;
  botId: number | null;
  pair: string | null;
  status: 'running' | 'paused' | 'stopped' | null;
  investmentUsdt: number | null;
  pnlUsdt: number | null;
  pnlPct: number | null;
}

export interface TraderProfile {
  bots: {
    created: number;
    running: number;
    paused: number;
    closed: number;
    published: number;
    copiedFromOthers: number;
    roundtrips: number;
  };
  earnings: {
    investedUsdt: number;
    originalInvestedUsdt: number;
    realizedUsdt: number;
    unrealizedUsdt: number;
    totalPnlUsdt: number;
    totalPnlPct: number;
    pnlRunningUsdt: number;
    pnlPausedUsdt: number;
    pnlClosedUsdt: number;
    investedRunningUsdt: number;
    reinvestedUsdt: number;
    pairedProfitUsdt: number;
    feesUsdt: number;
    fundingUsdt: number;
  };
  audience: {
    uniqueCopiers: number;
    copyInterests: number;
    uniqueInterestPeople: number;
    copiesCreated: number;
    copiesRunning: number;
    copiesPaused: number;
    copiesClosed: number;
    investedUsdt: number;
    realizedUsdt: number;
    unrealizedUsdt: number;
    pnlUsdt: number;
    pnlPct: number;
  };
  copiers: ProfileCopier[];
  strategies: ProfileStrategy[];
  ownBots: ProfileOwnBot[];
  bestBotId: number | null;
  worstBotId: number | null;
  account?: AccountPerformance;
  displayName?: string | null;
  bio?: string | null;
  tags?: string[];
  following?: FollowingEntry[];
}

export interface AutoCopierBot {
  botId: number;
  pair: string;
  direction: 'long' | 'short';
  status: string;
  investmentUsdt: number;
  pnlUsdt: number;
  pnlPct: number;
  leaderPair: string;
}

export interface AutoCopier {
  id: string;
  name: string;
  hasAvatar: boolean;
  avatarUpdatedAt: number | null;
  copyInvestmentUsdt: number;
  copies: number;
  investedUsdt: number;
  pnlUsdt: number;
  pnlPct: number;
  bots: AutoCopierBot[];
}

export interface AutoCopierPage {
  page: number;
  pageSize: number;
  total: number;
  summary: {
    people: number;
    copies: number;
    running: number;
    paused: number;
    closed: number;
    investedUsdt: number;
    pnlUsdt: number;
    pnlPct: number;
    realizedUsdt: number;
    unrealizedUsdt: number;
  };
  rows: AutoCopier[];
}

export interface AccountPerformance {
  connected: boolean;
  live: boolean;
  equityUsdt: number;
  unrealizedUsdt: number;
  realizedUsdt: number;
  fundingUsdt: number;
  totalPnlUsdt: number;
  points: Array<{ date: string; equity: number }>;
}

export interface TraderSearchBot {
  id: number;
  title: string;
  pair: string;
  pnlUsdt: number;
  pnlPct: number;
  status: string | null;
}

export interface TraderSearchHit {
  id: string;
  name: string;
  tag: string;
  handle: string;
  bio: string | null;
  hasAvatar: boolean;
  avatarUpdatedAt: number | null;
  runningBots: number;
  published: TraderSearchBot[];
}

export interface FollowState {
  following: boolean;
  autoCopy: boolean;
  copyInvestmentUsdt: number | null;
}

export interface FollowingEntry {
  id: string;
  name: string;
  hasAvatar: boolean;
  avatarUpdatedAt: number | null;
  autoCopy: boolean;
  copyInvestmentUsdt: number | null;
}

export interface PublicTraderProfile extends TraderProfile {
  id: string;
  name: string;
  bio: string | null;
  hasAvatar: boolean;
  avatarUpdatedAt: number | null;
  memberSince: number;
  tags: string[];
  equity: Array<{ date: string; equity: number }>;
  follow?: FollowState;
}

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

export interface HealthV2 {
  status: 'ok';
  uptime: number;
  runningBots: number;
  cacheSize: number;
  memory: { rss: number; heapUsed: number };
  ts: number;
}

// API error envelope thrown by the client when a request fails.
export class ApiError extends Error {
  constructor(
    public status: number,
    public payload: unknown,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
