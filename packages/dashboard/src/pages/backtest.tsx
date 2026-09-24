// H.6 — Backtest page.
// Pure simulation against historical GRVT candles. No orders are placed.
// Form on the left, result on the right (or stacked on mobile).
//
// "Apply to wizard" navigates to / with the inputs in router state, which
// OverviewPage reads to open the create-bot-wizard pre-filled.

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Play, ArrowRight, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Card } from '@/components/primitives/card';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { StatCard } from '@/components/primitives/stat-card';
import { EquityCurve, type EquityPoint } from '@/components/charts/equity-curve';
import { formatPercent, formatPnl, formatUsdCompact } from '@/lib/format';
import { useT } from '@/i18n';
import type {
  BacktestInput,
  BacktestResult,
} from '@/lib/api-types';

interface FormState {
  pair: string;
  direction: 'long' | 'short';
  leverage: string;
  lower: string;
  upper: string;
  grids: string;
  investment: string;
  feePct: string;
  duration: string;
  durationUnit: 'days' | 'weeks';
  sl: string;
  tp: string;
  autoShift: boolean;
  autoShiftPct: string;
  compound: string;
  virtual: boolean;
  windowSize: string;
  funding: string;
}

const INITIAL: FormState = {
  pair: 'ETH_USDT_Perp',
  direction: 'long',
  leverage: '5',
  lower: '',
  upper: '',
  grids: '40',
  investment: '500',
  feePct: '0.05',
  duration: '2',
  durationUnit: 'weeks',
  sl: '',
  tp: '',
  autoShift: false,
  autoShiftPct: '10',
  compound: '0',
  virtual: false,
  windowSize: '70',
  funding: '0',
};

const INTERVAL_LABEL: Record<string, string> = {
  CI_15_M: '15 min',
  CI_30_M: '30 min',
  CI_1_H: '1 h',
  CI_4_H: '4 h',
  CI_1_D: '1 d',
};

const FALLBACK_PAIRS = [
  { value: 'ETH_USDT_Perp', label: 'ETH-USDT-Perp' },
  { value: 'BTC_USDT_Perp', label: 'BTC-USDT-Perp' },
  { value: 'SOL_USDT_Perp', label: 'SOL-USDT-Perp' },
];

export function BacktestPage() {
  const t = useT();
  const [form, setForm] = useState<FormState>(INITIAL);
  const navigate = useNavigate();

  const instrumentsQuery = useQuery({
    queryKey: ['instruments'],
    queryFn: () => api.getInstruments(),
    staleTime: 60_000,
  });

  const pairs = instrumentsQuery.data?.instruments
    ? (instrumentsQuery.data.instruments as Array<Record<string, unknown>>)
        .map((i) => (i.instrument ?? i.symbol ?? i.name) as string)
        .filter((name) => typeof name === 'string' && name.includes('_Perp'))
        .map((name) => ({ value: name, label: name.replace(/_/g, '-') }))
    : FALLBACK_PAIRS;

  const mutation = useMutation({
    mutationFn: (input: BacktestInput) => api.runBacktest(input),
  });

  const lower = parseFloat(form.lower);
  const upper = parseFloat(form.upper);
  const grids = parseInt(form.grids, 10);
  const investment = parseFloat(form.investment);
  const leverage = parseFloat(form.leverage);
  const feePct = parseFloat(form.feePct);
  const duration = parseFloat(form.duration);
  const days = form.durationUnit === 'weeks' ? duration * 7 : duration;
  const sl = form.sl.trim() === '' ? null : parseFloat(form.sl);
  const tp = form.tp.trim() === '' ? null : parseFloat(form.tp);
  const shiftPct = parseFloat(form.autoShiftPct);
  const compound = parseFloat(form.compound);
  const windowSize = parseInt(form.windowSize, 10);
  const funding = parseFloat(form.funding);

  const errors: string[] = [];
  if (!form.pair) errors.push(t('backtest.validation.pairRequired'));
  if (!Number.isFinite(lower) || lower <= 0) errors.push(t('backtest.validation.lowerGt0'));
  if (!Number.isFinite(upper) || upper <= 0) errors.push(t('backtest.validation.upperGt0'));
  if (Number.isFinite(lower) && Number.isFinite(upper) && lower >= upper) errors.push(t('backtest.validation.lowerLtUpper'));
  if (!Number.isInteger(grids) || grids < 2) errors.push(t('backtest.validation.gridsMin'));
  if (!Number.isFinite(investment) || investment <= 0) errors.push(t('backtest.validation.investmentGt0'));
  if (!Number.isFinite(leverage) || leverage < 1) errors.push(t('backtest.validation.leverageMin'));
  if (!Number.isFinite(feePct) || feePct < 0 || feePct > 1) errors.push(t('backtest.validation.feeRange'));
  if (!Number.isFinite(duration) || duration < 1) errors.push(t('backtest.validation.durationMin'));
  if (days > 120) errors.push(t('backtest.validation.durationMax'));
  if (sl != null && (!Number.isFinite(sl) || sl < 0 || sl > 100)) errors.push(t('backtest.validation.slRange'));
  if (tp != null && (!Number.isFinite(tp) || tp < 0 || tp > 1000)) errors.push(t('backtest.validation.tpRange'));
  if (form.autoShift && (!Number.isFinite(shiftPct) || shiftPct <= 0 || shiftPct > 100)) errors.push(t('backtest.validation.shiftRange'));
  if (!Number.isFinite(compound) || compound < 0 || compound > 100) errors.push(t('backtest.validation.compoundRange'));
  if (form.virtual && (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 80)) errors.push(t('backtest.validation.windowRange'));
  if (!Number.isFinite(funding) || funding < -5 || funding > 5) errors.push(t('backtest.validation.fundingRange'));
  const isValid = errors.length === 0;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  function run() {
    if (!isValid) return;
    mutation.mutate({
      pair: form.pair,
      direction: form.direction,
      leverage,
      lower_price: lower,
      upper_price: upper,
      num_grids: grids,
      investment_usdt: investment,
      fee_pct: feePct,
      days,
      ...(sl != null && sl > 0 ? { sl_pct: sl } : {}),
      ...(tp != null && tp > 0 ? { tp_pct: tp } : {}),
      ...(form.autoShift ? { auto_shift_enabled: true, auto_shift_pct: shiftPct } : {}),
      ...(compound > 0 ? { compound_pct: compound } : {}),
      ...(form.virtual ? { virtual_enabled: true, active_window_size: windowSize } : {}),
      ...(funding !== 0 ? { funding_rate_pct: funding } : {}),
    });
  }

  function applyToWizard() {
    navigate('/dashboard', {
      state: {
        presetWizard: {
          pair: form.pair,
          direction: form.direction,
          leverage,
          lower_price: lower,
          upper_price: upper,
          num_grids: grids,
          investment_usdt: investment,
          ...(sl != null && sl > 0 ? { sl_pct: sl } : {}),
          ...(tp != null && tp > 0 ? { tp_pct: tp } : {}),
          ...(form.autoShift ? { auto_shift_enabled: true, auto_shift_pct: shiftPct } : {}),
          ...(compound > 0 ? { compound_pct: compound } : {}),
          ...(form.virtual ? { virtual_enabled: true, active_window_size: windowSize } : {}),
        },
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('backtest.title')}
        </h1>
        <p className="text-sm text-text-muted mt-1">
          {t('backtest.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-2 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
            {t('backtest.parameters')}
          </h2>

          <div className="flex flex-col gap-1.5">
            <label className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
              {t('backtest.pair')}
            </label>
            <select
              value={form.pair}
              onChange={(e) => update('pair', e.target.value)}
              className="h-10 px-3 rounded-md bg-bg-surface border border-border-subtle text-sm text-text-primary"
            >
              {pairs.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
                {t('backtest.direction')}
              </label>
              <select
                value={form.direction}
                onChange={(e) => update('direction', e.target.value as 'long' | 'short')}
                className="h-10 px-3 rounded-md bg-bg-surface border border-border-subtle text-sm text-text-primary"
              >
                <option value="long">{t('backtest.directionLong')}</option>
                <option value="short">{t('backtest.directionShort')}</option>
              </select>
            </div>
            <Input
              label={t('backtest.leverage')}
              numeric
              value={form.leverage}
              onChange={(e) => update('leverage', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('backtest.lowerPrice')}
              numeric
              placeholder="e.g. 1800"
              value={form.lower}
              onChange={(e) => update('lower', e.target.value)}
            />
            <Input
              label={t('backtest.upperPrice')}
              numeric
              placeholder="e.g. 2400"
              value={form.upper}
              onChange={(e) => update('upper', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('backtest.grids')}
              numeric
              value={form.grids}
              onChange={(e) => update('grids', e.target.value)}
            />
            <Input
              label={t('backtest.investment')}
              numeric
              value={form.investment}
              onChange={(e) => update('investment', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('backtest.feePerSide')}
              numeric
              value={form.feePct}
              onChange={(e) => update('feePct', e.target.value)}
              helper={t('backtest.feeHelper')}
            />
            <Input
              label={t('backtest.duration')}
              numeric
              value={form.duration}
              onChange={(e) => update('duration', e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
              {t('backtest.durationUnit')}
            </label>
            <select
              value={form.durationUnit}
              onChange={(e) => update('durationUnit', e.target.value as 'days' | 'weeks')}
              className="h-10 px-3 rounded-md bg-bg-surface border border-border-subtle text-sm text-text-primary"
            >
              <option value="days">{t('backtest.unitDays')}</option>
              <option value="weeks">{t('backtest.unitWeeks')}</option>
            </select>
            <p className="text-2xs text-text-muted">
              {t('backtest.runFor', {
                days: Math.round(days) || 0,
                weeks: Math.max(1, Math.round((days || 0) / 7)),
              })}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('backtest.stopLoss')}
              numeric
              value={form.sl}
              onChange={(e) => update('sl', e.target.value)}
              helper={t('backtest.riskHelper')}
            />
            <Input
              label={t('backtest.takeProfit')}
              numeric
              value={form.tp}
              onChange={(e) => update('tp', e.target.value)}
              helper={t('backtest.riskHelper')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('backtest.compound')}
              numeric
              value={form.compound}
              onChange={(e) => update('compound', e.target.value)}
            />
            <Input
              label={t('backtest.funding')}
              numeric
              value={form.funding}
              onChange={(e) => update('funding', e.target.value)}
              helper={t('backtest.fundingHelper')}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={form.autoShift}
              onChange={(e) => update('autoShift', e.target.checked)}
            />
            {t('backtest.autoShift')}
          </label>
          {form.autoShift && (
            <Input
              label={t('backtest.autoShiftPct')}
              numeric
              value={form.autoShiftPct}
              onChange={(e) => update('autoShiftPct', e.target.value)}
            />
          )}

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={form.virtual}
              onChange={(e) => update('virtual', e.target.checked)}
            />
            {t('backtest.virtual')}
          </label>
          {form.virtual && (
            <Input
              label={t('backtest.windowSize')}
              numeric
              value={form.windowSize}
              onChange={(e) => update('windowSize', e.target.value)}
            />
          )}

          {!isValid && (
            <ul className="text-2xs text-danger flex flex-col gap-0.5">
              {errors.map((e) => (
                <li key={e}>· {e}</li>
              ))}
            </ul>
          )}

          <Button
            onClick={run}
            disabled={!isValid || mutation.isPending}
          >
            <Play className="size-4" />
            {mutation.isPending ? t('backtest.running') : t('backtest.runBtn')}
          </Button>
        </Card>

        <div className="lg:col-span-3 flex flex-col gap-4">
          {mutation.isError && (
            <Card className="border-danger/40">
              <p className="text-sm text-danger">
                {t('backtest.failedPrefix')} {(mutation.error as Error).message}
              </p>
            </Card>
          )}

          {!mutation.data && !mutation.isPending && !mutation.isError && (
            <Card>
              <p className="text-sm text-text-muted">
                {t('backtest.placeholder')}
              </p>
            </Card>
          )}

          {mutation.isPending && (
            <Card>
              <p className="text-sm text-text-muted animate-pulse">
                {t('backtest.fetching')}
              </p>
            </Card>
          )}

          {mutation.data && <ResultPanel result={mutation.data} onApply={applyToWizard} />}
        </div>
      </div>
    </div>
  );
}

function GridReplay({ result }: { result: BacktestResult }) {
  const t = useT();
  const frames = result.frames ?? [];
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setIndex(0);
    setPlaying(frames.length > 1);
  }, [frames]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => {
        if (current >= frames.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing, frames.length]);

  if (frames.length === 0) return null;
  const frame = frames[Math.min(index, frames.length - 1)]!;
  const span = Math.max(frame.upper - frame.lower, 1);
  const lines = Array.from({ length: 13 }, (_, i) => frame.lower + (span * i) / 12);
  const priceY = (price: number) => {
    const raw = 100 - ((price - frame.lower) / span) * 100;
    return Math.min(98, Math.max(2, raw));
  };
  const day = Math.max(1, Math.round((frame.time - frames[0]!.time) / 86400) + 1);
  const week = Math.max(1, Math.ceil(day / 7));
  const interval = INTERVAL_LABEL[result.interval ?? ''] ?? result.interval ?? '';

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
          {t('backtest.replay')}
        </h2>
        <button
          type="button"
          className="text-xs text-text-primary underline"
          onClick={() => {
            if (index >= frames.length - 1) setIndex(0);
            setPlaying((value) => !value);
          }}
        >
          {playing ? t('backtest.replayPause') : t('backtest.replayPlay')}
        </button>
      </div>
      <p className="text-xs text-text-muted mb-3">
        {t('backtest.replayCaption', {
          day,
          week,
          price: frame.price.toFixed(2),
          position: frame.position.toFixed(3),
        })}
        {interval ? ` · ${interval}` : ''}
      </p>
      <svg viewBox="0 0 100 100" className="w-full h-56 bg-bg-surface rounded-md">
        {lines.map((price) => {
          const y = priceY(price);
          const buy = price < frame.price;
          return (
            <line
              key={price}
              x1="8"
              x2="92"
              y1={y}
              y2={y}
              stroke={buy ? 'var(--color-success)' : 'var(--color-danger)'}
              strokeOpacity={0.45}
              strokeWidth={0.4}
            />
          );
        })}
        <line
          x1="6"
          x2="94"
          y1={priceY(frame.price)}
          y2={priceY(frame.price)}
          stroke="var(--color-primary)"
          strokeWidth={1.2}
        />
      </svg>
      <input
        type="range"
        min={0}
        max={frames.length - 1}
        value={index}
        onChange={(e) => {
          setPlaying(false);
          setIndex(Number(e.target.value));
        }}
        className="w-full mt-3"
      />
    </Card>
  );
}

function stopLabel(
  t: (key: string) => string,
  stoppedBy: BacktestResult['stoppedBy'],
): string {
  if (stoppedBy === 'outside_range') return t('backtest.stopOutside');
  if (stoppedBy === 'liquidation') return t('backtest.stopLiquidation');
  if (stoppedBy === 'stop_loss') return t('backtest.stopSl');
  if (stoppedBy === 'take_profit') return t('backtest.stopTp');
  return t('backtest.stopNone');
}

function ResultPanel({
  result,
  onApply,
}: {
  result: BacktestResult;
  onApply: () => void;
}) {
  const t = useT();
  const points: EquityPoint[] = result.equityCurve.map((p) => ({
    date: new Date(p.time * 1000).toISOString().slice(0, 16).replace('T', ' '),
    equity: p.equity,
  }));

  const warnings: string[] = [];
  if (result.maxDrawdownPct > 30)
    warnings.push(t('backtest.warnHighDrawdown', { pct: result.maxDrawdownPct.toFixed(1) }));
  if (result.roundTrips < 5)
    warnings.push(t('backtest.warnFewTrips', { n: result.roundTrips }));
  if (result.netProfit <= 0) warnings.push(t('backtest.warnNoProfit'));

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-border-subtle rounded-lg overflow-hidden">
        <StatCard
          label={t('backtest.netProfit')}
          value={
            <span className={result.netProfit >= 0 ? 'text-success' : 'text-danger'}>
              {formatPnl(result.netProfit)}
            </span>
          }
        />
        <StatCard label={t('backtest.grossProfit')} value={formatPnl(result.totalProfit)} />
        <StatCard label={t('backtest.feesPaid')} value={formatPnl(-result.totalFees)} />
        <StatCard
          label={t('backtest.maxDrawdown')}
          value={
            <span className={result.maxDrawdownPct > 30 ? 'text-danger' : 'text-text-primary'}>
              {formatPercent(-result.maxDrawdownPct)}
            </span>
          }
        />
        <StatCard label={t('backtest.roundTrips')} value={String(result.roundTrips)} />
        <StatCard
          label={t('backtest.avgPerTrip')}
          value={formatPnl(result.avgProfitPerTrip)}
        />
        <StatCard
          label={t('backtest.profitFactor')}
          value={Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : '∞'}
        />
        <StatCard
          label={t('backtest.daysInMarket')}
          value={result.daysInMarket > 0
            ? `${result.daysInMarket}d · ${Math.max(1, Math.round(result.daysInMarket / 7))}sem`
            : '0d'}
        />
        <StatCard label={t('backtest.candlesProcessed')} value={String(result.candlesProcessed)} />
        <StatCard label={t('backtest.endingEquity')} value={formatUsdCompact(result.endingEquity)} />
        <StatCard
          label={t('backtest.roi')}
          value={
            <span className={result.roiPct >= 0 ? 'text-success' : 'text-danger'}>
              {formatPercent(result.roiPct)}
            </span>
          }
        />
        <StatCard label={t('backtest.fundingPaid')} value={formatPnl(-result.fundingPaid)} />
        <StatCard label={t('backtest.unrealized')} value={formatPnl(result.unrealizedPnl)} />
        <StatCard label={t('backtest.buyHold')} value={formatPercent(result.buyHoldPct)} />
        <StatCard label={t('backtest.timeInRange')} value={formatPercent(result.timeInRangePct)} />
        <StatCard
          label={t('backtest.stoppedBy')}
          value={result.stoppedBy === 'outside_range'
            ? t('backtest.stopOutside', { price: result.startPrice.toFixed(2) })
            : stopLabel(t, result.stoppedBy)}
        />
        <StatCard label={t('backtest.shifts')} value={String(result.shifts)} />
        <StatCard label={t('backtest.compounds')} value={String(result.compounds)} />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
            {t('backtest.equityCurve')}
          </h2>
          <span className="text-2xs text-text-muted">
            {t('backtest.startsAt', { amount: formatUsdCompact(points[0]?.equity ?? 0) })}
          </span>
        </div>
        <EquityCurve points={points} height={260} />
      </Card>

      <GridReplay result={result} />

      {warnings.length > 0 && (
        <Card className="border-warning/40">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
            <ul className="text-xs text-text-secondary flex flex-col gap-1">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <Button variant="secondary" onClick={onApply}>
          {t('backtest.applyToWizard')}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  );
}
