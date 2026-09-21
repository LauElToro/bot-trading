// Create Bot Wizard — 4-step modal: Pair → Range → Config → Confirm
//
// Step 4 calls /bots/validate, then POST /bots creates the bot paused.
// Why paused-by-default: startBot() places real orders on GRVT.

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Layers,
  PauseCircle,
  Search,
  Shield,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Modal } from './primitives/modal';
import { Button } from './primitives/button';
import { Input } from './primitives/input';
import { Mono } from './primitives/mono';
import { FieldHelp } from './field-help';
import { api } from '@/lib/api-client';
import { RangePickerChart } from './charts/range-picker-chart';
import {
  formatPercent,
  formatPnl,
  formatSize,
  formatUsd,
} from '@/lib/format';
import type { ValidateBotInput, ValidateBotResult, WizardPreset } from '@/lib/api-types';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';

export type { WizardPreset } from '@/lib/api-types';

interface CreateBotWizardProps {
  open: boolean;
  onClose: () => void;
  preset?: WizardPreset;
}

interface WizardState {
  pair: string;
  direction: 'long' | 'short';
  lower: string;
  upper: string;
  grids: string;
  investment: string;
  leverage: string;
  acceptedRisk: boolean;
  compoundPct: string;
  safeguardEnabled: boolean;
  safeguardThresholdPct: string;
  safeguardAction: 'pause' | 'pause_close';
  slPct: string;
  tpPct: string;
  autoShiftEnabled: boolean;
  autoShiftPct: string;
  virtualEnabled: boolean;
  activeWindowSize: string;
  subAccountId: string;
}

const INITIAL_STATE: WizardState = {
  pair: '',
  direction: 'long',
  lower: '',
  upper: '',
  grids: '',
  investment: '',
  leverage: '',
  acceptedRisk: false,
  compoundPct: '0',
  safeguardEnabled: false,
  safeguardThresholdPct: '10',
  safeguardAction: 'pause',
  slPct: '',
  tpPct: '',
  autoShiftEnabled: false,
  autoShiftPct: '10',
  virtualEnabled: false,
  activeWindowSize: '70',
  subAccountId: '',
};

const FALLBACK_PAIRS = [
  { value: 'ETH_USDT_Perp', label: 'ETH-USDT-Perp' },
  { value: 'BTC_USDT_Perp', label: 'BTC-USDT-Perp' },
];

const FEATURED_TICKERS = ['BTC', 'ETH', 'SOL', 'DOGE'];

type Step = 0 | 1 | 2 | 3;
const STEP_LABEL_KEYS = [
  'wizard.stepPair',
  'wizard.stepRange',
  'wizard.stepConfig',
  'wizard.stepConfirm',
];
const STEP_HINT_KEYS = [
  'wizard.stepHintPair',
  'wizard.stepHintRange',
  'wizard.stepHintConfig',
  'wizard.stepHintConfirm',
];

function applyPreset(preset?: WizardPreset): WizardState {
  if (!preset) return INITIAL_STATE;
  return {
    ...INITIAL_STATE,
    pair: preset.pair,
    direction: preset.direction,
    lower: String(preset.lower_price),
    upper: String(preset.upper_price),
    grids: String(preset.num_grids),
    investment: String(preset.investment_usdt),
    leverage: String(preset.leverage),
    virtualEnabled: preset.virtual_enabled === true,
    activeWindowSize: String(preset.active_window_size ?? INITIAL_STATE.activeWindowSize),
    slPct: preset.sl_pct != null ? String(preset.sl_pct) : '',
    tpPct: preset.tp_pct != null ? String(preset.tp_pct) : '',
    autoShiftEnabled: preset.auto_shift_enabled === true,
    autoShiftPct: String(preset.auto_shift_pct ?? INITIAL_STATE.autoShiftPct),
    compoundPct: String(preset.compound_pct ?? 0),
  };
}

function parsePair(value: string) {
  const [ticker = value, quote = 'USDT', kind = 'Perp'] = value.split('_');
  return { ticker, quote, kind };
}

export function CreateBotWizard({ open, onClose, preset }: CreateBotWizardProps) {
  const t = useT();
  const [step, setStep] = useState<Step>(0);
  const [state, setState] = useState<WizardState>(() => applyPreset(preset));
  const [validated, setValidated] = useState<ValidateBotResult | null>(null);
  const navigate = useNavigate();

  const instrumentsQuery = useQuery({
    queryKey: ['instruments'],
    queryFn: () => api.getInstruments(),
    staleTime: 60_000,
    enabled: open,
  });
  const subAccountsQuery = useQuery({
    queryKey: ['sub-accounts'],
    queryFn: () => api.listSubAccounts(),
    enabled: open,
  });
  const subAccounts = subAccountsQuery.data ?? [];
  const PAIRS = instrumentsQuery.data?.instruments
    ? (instrumentsQuery.data.instruments as any[])
        .filter((i: any) => i.instrument?.includes('_Perp') || i.symbol?.includes('_Perp'))
        .map((i: any) => {
          const name = i.instrument ?? i.symbol ?? i.name;
          return { value: name, label: name.replace(/_/g, '-') };
        })
    : FALLBACK_PAIRS;
  const queryClient = useQueryClient();

  const validateMutation = useMutation({
    mutationFn: (input: ValidateBotInput) => api.validateBot(input),
    onSuccess: (result) => {
      setValidated(result);
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: ValidateBotInput) => api.createBot(input),
    onSuccess: (result) => {
      toast.success(t('wizard.botCreatedToast', { id: result.id }));
      void queryClient.invalidateQueries({ queryKey: ['bots'] });
      navigate(`/dashboard/bots/${result.id}`);
      handleClose();
    },
    onError: (err: Error) => {
      toast.error(t('wizard.createFailedToast', { msg: err.message }));
    },
  });

  function handleClose() {
    setStep(0);
    setState(INITIAL_STATE);
    setValidated(null);
    validateMutation.reset();
    createMutation.reset();
    onClose();
  }

  function handleCreate() {
    if (!validated) return;
    const compoundPct = Math.min(100, Math.max(0, parseInt(state.compoundPct || '0', 10)));
    const safeguardPayload = state.safeguardEnabled
      ? {
          safeguard_enabled: true,
          safeguard_threshold_pct: Math.min(
            50,
            Math.max(1, parseFloat(state.safeguardThresholdPct || '10')),
          ),
          safeguard_action: state.safeguardAction,
        }
      : {};
    const slPct = parseFloat(state.slPct || '0');
    const tpPct = parseFloat(state.tpPct || '0');
    const autoShiftPayload = state.autoShiftEnabled
      ? { auto_shift_enabled: true, auto_shift_pct: parseFloat(state.autoShiftPct || '10') }
      : {};
    const virtualPayload = state.virtualEnabled
      ? {
          virtual_enabled: true,
          active_window_size: Math.min(80, Math.max(20, parseInt(state.activeWindowSize || '70', 10))),
        }
      : {};
    const subAccountPayload = state.subAccountId
      ? { grvt_sub_account_id: parseInt(state.subAccountId, 10) }
      : {};
    createMutation.mutate({
      pair: validated.pair,
      direction: validated.direction,
      lower_price: validated.input.lower,
      upper_price: validated.input.upper,
      num_grids: validated.input.grids,
      investment_usdt: validated.input.investment,
      leverage: validated.input.leverage,
      ...(compoundPct > 0 ? { compound_pct: compoundPct } : {}),
      ...safeguardPayload,
      ...(slPct > 0 ? { sl_pct: slPct } : {}),
      ...(tpPct > 0 ? { tp_pct: tpPct } : {}),
      ...autoShiftPayload,
      ...virtualPayload,
      ...subAccountPayload,
    } as any);
  }

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((s) => ({ ...s, [key]: value }));
    if (
      key !== 'acceptedRisk' &&
      key !== 'compoundPct' &&
      key !== 'safeguardEnabled' &&
      key !== 'safeguardThresholdPct' &&
      key !== 'safeguardAction' &&
      key !== 'slPct' &&
      key !== 'tpPct' &&
      key !== 'autoShiftEnabled' &&
      key !== 'autoShiftPct' &&
      key !== 'subAccountId'
    ) {
      setValidated(null);
    }
  }

  function next() {
    if (step === 2) {
      const input: ValidateBotInput = {
        pair: state.pair,
        direction: state.direction,
        lower_price: parseFloat(state.lower),
        upper_price: parseFloat(state.upper),
        num_grids: parseInt(state.grids, 10),
        investment_usdt: parseFloat(state.investment),
        leverage: parseInt(state.leverage, 10),
        ...(state.virtualEnabled
          ? {
              virtual_enabled: true,
              active_window_size: parseInt(state.activeWindowSize || '70', 10),
            }
          : {}),
      } as ValidateBotInput;
      validateMutation.mutate(input);
    }
    setStep((s) => Math.min(3, s + 1) as Step);
  }

  function back() {
    setStep((s) => Math.max(0, s - 1) as Step);
  }

  const canNext = (() => {
    if (step === 0) return !!state.pair;
    if (step === 1) {
      const lo = parseFloat(state.lower);
      const hi = parseFloat(state.upper);
      return Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > lo;
    }
    if (step === 2) {
      const inv = parseFloat(state.investment);
      const grids = parseInt(state.grids, 10);
      const lev = parseInt(state.leverage, 10);
      const maxGrids = state.virtualEnabled ? 500 : 95;
      const windowOk =
        !state.virtualEnabled ||
        (() => {
          const w = parseInt(state.activeWindowSize || '0', 10);
          return w >= 20 && w <= 80;
        })();
      return inv > 0 && grids >= 2 && grids <= maxGrids && lev >= 1 && lev <= 50 && windowOk;
    }
    if (step === 3) return state.acceptedRisk;
    return false;
  })();

  const nextHint =
    step === 0 && !canNext
      ? t('wizard.needPair')
      : step === 1 && !canNext
        ? t('wizard.needRange')
        : step === 2 && !canNext
          ? t('wizard.needConfig')
          : step === 3 && !canNext
            ? t('wizard.needRisk')
            : step === 3
              ? t('wizard.createHint')
              : t(STEP_HINT_KEYS[step]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="wide"
      kicker={t('wizard.kicker')}
      title={t('wizard.title')}
      description={t('wizard.modalDesc')}
      headerExtra={<Stepper step={step} onJump={(s) => setStep(s)} />}
      footerStart={nextHint}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          {step > 0 && (
            <Button variant="secondary" onClick={back}>
              <ChevronLeft className="size-4" />
              {t('common.back')}
            </Button>
          )}
          {step < 3 ? (
            <Button onClick={next} disabled={!canNext}>
              {t('wizard.continueBtn')}
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!canNext || createMutation.isPending}
              onClick={handleCreate}
            >
              <Check className="size-4" />
              {createMutation.isPending ? t('wizard.creatingShort') : t('wizard.createPaused')}
            </Button>
          )}
        </>
      }
    >
      {preset?.copiedFrom && (
        <div className="mb-5 border border-primary/35 bg-primary-soft px-3 py-2 text-xs text-text-secondary">
          <p>{t('wizard.copiedFrom', { name: preset.copiedFrom.authorName })}</p>
          {preset.copiedFrom.rangeAdapted &&
            preset.copiedFrom.markPrice != null &&
            preset.copiedFrom.originalLower != null &&
            preset.copiedFrom.originalUpper != null && (
              <p className="mt-1 text-text-muted">
                {t('wizard.copiedRangeAdapted', {
                  mark: formatUsd(preset.copiedFrom.markPrice),
                  low: formatUsd(preset.copiedFrom.originalLower),
                  high: formatUsd(preset.copiedFrom.originalUpper),
                })}
              </p>
            )}
        </div>
      )}
      {step === 0 && (
        <StepPair state={state} update={update} pairs={PAIRS} subAccounts={subAccounts} />
      )}
      {step === 1 && <StepRange state={state} update={update} />}
      {step === 2 && <StepConfig state={state} update={update} />}
      {step === 3 && (
        <StepConfirm
          state={state}
          update={update}
          validated={validated}
          isValidating={validateMutation.isPending}
          error={validateMutation.error as Error | null}
        />
      )}
    </Modal>
  );
}

function Stepper({ step, onJump }: { step: Step; onJump: (s: Step) => void }) {
  const t = useT();
  return (
    <ol className="relative grid grid-cols-4 border-t border-border-subtle">
      {STEP_LABEL_KEYS.map((labelKey, i) => {
        const active = i === step;
        const completed = i < step;
        return (
          <li key={labelKey} className="relative">
            <button
              type="button"
              disabled={!completed && !active}
              onClick={() => completed && onJump(i as Step)}
              className={cn(
                'flex w-full flex-col gap-1 px-3 py-3 text-left transition-colors md:px-5',
                active && 'bg-primary-soft',
                completed && 'hover:bg-bg-muted',
                !active && !completed && 'opacity-55',
              )}
            >
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
              <span
                className={cn(
                  'font-mono text-[10px] tracking-[.18em]',
                  active || completed ? 'text-primary' : 'text-text-muted',
                )}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={cn(
                  'text-xs font-medium',
                  active ? 'text-text-primary' : 'text-text-secondary',
                )}
              >
                {t(labelKey)}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepPair({
  state,
  update,
  pairs,
  subAccounts,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  pairs: Array<{ value: string; label: string }>;
  subAccounts: Array<{ id: number; label: string; isDefault: boolean }>;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pairs;
    return pairs.filter(
      (p) => p.label.toLowerCase().includes(q) || p.value.toLowerCase().includes(q),
    );
  }, [pairs, query]);

  const featured = useMemo(
    () =>
      FEATURED_TICKERS.map((ticker) =>
        pairs.find((p) => parsePair(p.value).ticker === ticker),
      ).filter(Boolean) as Array<{ value: string; label: string }>,
    [pairs],
  );

  const selected = state.pair ? parsePair(state.pair) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,.85fr)]">
      <div>
        {subAccounts.length > 0 && (
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-text-primary">{t('wizard.subAccountTitle')}</h3>
            <select
              value={state.subAccountId}
              onChange={(e) => update('subAccountId', e.target.value)}
              className="mt-2 h-10 w-full border border-border-subtle bg-bg-surface px-3 text-sm text-text-primary"
            >
              <option value="">{t('wizard.subAccountDefault')}</option>
              {subAccounts.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.label}
                  {s.isDefault ? ` (${t('settings.subAccounts.default')})` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-2xs text-text-muted">{t('wizard.subAccountHelp')}</p>
          </div>
        )}

        <h3 className="text-sm font-semibold text-text-primary">{t('wizard.selectInstrument')}</h3>
        <FieldHelp title={t('wizard.help.pairTitle')}>{t('wizard.help.pairBody')}</FieldHelp>

        <label className="relative mt-4 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('wizard.searchPairs', { n: pairs.length })}
            autoFocus
            className="h-11 w-full border border-border-subtle bg-bg-surface pl-10 pr-3 text-sm text-text-primary placeholder:text-text-disabled focus-visible:border-primary"
          />
        </label>

        {featured.length > 0 && !query && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] tracking-[.16em] text-text-muted">
              {t('wizard.featured')}
            </span>
            {featured.map((p) => {
              const { ticker } = parsePair(p.value);
              const on = state.pair === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => update('pair', p.value)}
                  className={cn(
                    'h-8 border px-3 font-mono text-xs tracking-wider transition-colors',
                    on
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary',
                  )}
                >
                  {ticker}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-3 max-h-[320px] overflow-y-auto border border-border-subtle">
          {filtered.map((p) => {
            const { ticker, quote, kind } = parsePair(p.value);
            const on = state.pair === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => update('pair', p.value)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 border-b border-border-subtle px-3 py-2.5 text-left last:border-b-0',
                  on ? 'bg-primary-soft' : 'hover:bg-bg-muted',
                )}
              >
                <span className="flex items-center gap-3">
                  <span
                    className={cn(
                      'grid size-9 place-items-center border font-mono text-[11px] font-semibold',
                      on
                        ? 'border-primary bg-primary text-white'
                        : 'border-border-subtle bg-bg-surface text-text-secondary',
                    )}
                  >
                    {ticker.slice(0, 4)}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-text-primary">{ticker}</span>
                    <span className="block font-mono text-[10px] tracking-wider text-text-muted">
                      {quote} · {kind}
                    </span>
                  </span>
                </span>
                {on ? (
                  <Check className="size-4 text-primary" />
                ) : (
                  <span className="font-mono text-[10px] text-text-disabled">50x</span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-text-muted">
              {t('wizard.noPairsMatch', { q: query })}
            </p>
          )}
        </div>
        <p className="mt-2 text-2xs text-text-muted">
          {t('wizard.pairsShown', { shown: filtered.length, total: pairs.length })}
        </p>
      </div>

      <aside className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{t('wizard.directionHeading')}</h3>
          <FieldHelp title={t('wizard.help.directionTitle')}>{t('wizard.help.directionBody')}</FieldHelp>
          <div className="mt-3 grid gap-2">
            {(
              [
                {
                  id: 'long' as const,
                  icon: ArrowUpRight,
                  title: t('wizard.longTitle'),
                  hint: t('wizard.longHint'),
                },
                {
                  id: 'short' as const,
                  icon: ArrowDownRight,
                  title: t('wizard.shortTitle'),
                  hint: t('wizard.shortHint'),
                },
              ]
            ).map((d) => {
              const on = state.direction === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => update('direction', d.id)}
                  className={cn(
                    'flex items-start gap-3 border px-3 py-3 text-left transition-colors',
                    on
                      ? d.id === 'long'
                        ? 'border-success bg-success-soft'
                        : 'border-danger bg-danger-soft'
                      : 'border-border-subtle hover:border-border-default',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-9 shrink-0 place-items-center border',
                      on
                        ? d.id === 'long'
                          ? 'border-success text-success'
                          : 'border-danger text-danger'
                        : 'border-border-subtle text-text-muted',
                    )}
                  >
                    <d.icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-text-primary">{d.title}</span>
                    <span className="mt-1 block text-[11px] leading-5 text-text-muted">{d.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border border-border-default bg-bg-surface p-4">
          <p className="font-mono text-[10px] tracking-[.18em] text-text-muted">
            {t('wizard.selectionTitle')}
          </p>
          {selected ? (
            <>
              <p className="mt-3 text-2xl font-semibold tracking-[-.04em] text-text-primary">
                {selected.ticker}
              </p>
              <p className="mt-1 font-mono text-xs text-text-secondary">
                {selected.quote} · {selected.kind}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <span
                  className={cn(
                    'border px-2 py-1 font-mono text-[10px] tracking-wider',
                    state.direction === 'long'
                      ? 'border-success text-success'
                      : 'border-danger text-danger',
                  )}
                >
                  {state.direction === 'long' ? t('wizard.longTitle') : t('wizard.shortTitle')}
                </span>
                <span className="text-[11px] text-text-muted">{t('wizard.pairMinMax')}</span>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6 text-text-muted">{t('wizard.selectionEmpty')}</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function StepRange({
  state,
  update,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
}) {
  const t = useT();
  const lo = parseFloat(state.lower);
  const hi = parseFloat(state.upper);
  const valid = Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > lo;
  const widthPct = valid ? (((hi - lo) / lo) * 100).toFixed(1) : '—';
  const selected = parsePair(state.pair);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{t('wizard.setRange')}</h3>
          <p className="mt-1 max-w-xl text-xs leading-5 text-text-muted">{t('wizard.rangeHelp')}</p>
        </div>
        <div className="border border-border-subtle px-3 py-2 text-right">
          <p className="font-mono text-[10px] tracking-[.16em] text-text-muted">{selected.ticker}</p>
          <p className="font-mono text-xs text-text-primary">{state.direction.toUpperCase()}</p>
        </div>
      </div>
      <FieldHelp title={t('wizard.help.rangeTitle')}>{t('wizard.help.rangeBody')}</FieldHelp>
      <div className="mt-4" />

      <RangePickerChart
        pair={state.pair}
        lower={lo || 0}
        upper={hi || 0}
        onLowerChange={(v) => update('lower', v.toFixed(2))}
        onUpperChange={(v) => update('upper', v.toFixed(2))}
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label={t('wizard.lowerPriceUsdt')}
          numeric
          inputMode="decimal"
          value={state.lower}
          onChange={(e) => update('lower', e.target.value)}
        />
        <Input
          label={t('wizard.upperPriceUsdt')}
          numeric
          inputMode="decimal"
          value={state.upper}
          onChange={(e) => update('upper', e.target.value)}
        />
      </div>
      <div
        className={cn(
          'mt-4 border px-3 py-2 text-xs',
          valid ? 'border-border-subtle text-text-muted' : 'border-danger/40 text-danger',
        )}
      >
        {valid ? (
          <>
            {t('wizard.rangeWidth')} <Mono className="text-text-primary">{widthPct}%</Mono>
          </>
        ) : (
          t('wizard.rangeInvalid')
        )}
      </div>
    </div>
  );
}

function StepConfig({
  state,
  update,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
}) {
  const t = useT();
  const investment = parseFloat(state.investment || '0');
  const leverage = parseInt(state.leverage || '0', 10);
  const notional = investment * leverage;

  return (
    <div className="space-y-4">
      <SectionCard
        index="01"
        icon={Wallet}
        title={t('wizard.configCapital')}
        subtitle={t('wizard.help.investmentBody')}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Input
              label={t('wizard.investment')}
              numeric
              inputMode="decimal"
              value={state.investment}
              onChange={(e) => update('investment', e.target.value)}
            />
            <FieldHelp title={t('wizard.help.investmentTitle')}>{t('wizard.help.investmentBody')}</FieldHelp>
          </div>
          <div>
            <Input
              label={t('wizard.leverage')}
              numeric
              inputMode="numeric"
              value={state.leverage}
              onChange={(e) => update('leverage', e.target.value)}
              helper="1x – 50x"
            />
            <FieldHelp title={t('wizard.help.leverageTitle')}>{t('wizard.help.leverageBody')}</FieldHelp>
          </div>
          <div className="border border-border-subtle bg-bg-muted/40 px-3 py-3">
            <p className="font-mono text-[10px] tracking-[.16em] text-text-muted">
              {t('wizard.notionalLabel')}
            </p>
            <p className="mt-2 font-mono text-lg text-text-primary">
              {Number.isFinite(notional) && notional > 0 ? formatUsd(notional) : '—'}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-text-muted">
              {t('wizard.effectiveNotionalEnd')}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        index="02"
        icon={Layers}
        title={t('wizard.configGrid')}
        subtitle={t('wizard.help.gridsBody')}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Input
              label={t('wizard.gridCount')}
              numeric
              inputMode="numeric"
              value={state.grids}
              onChange={(e) => update('grids', e.target.value)}
              helper={state.virtualEnabled ? '2 – 500 (virtual)' : '2 – 95'}
            />
            <FieldHelp title={t('wizard.help.gridsTitle')}>{t('wizard.help.gridsBody')}</FieldHelp>
          </div>
          <div>
            <Input
              label={t('wizard.reinvestPct')}
              numeric
              inputMode="numeric"
              value={state.compoundPct}
              onChange={(e) => update('compoundPct', e.target.value)}
              helper="0 = off · 100 = all profit"
            />
            <FieldHelp title={t('wizard.help.compoundTitle')}>{t('wizard.help.compoundBody')}</FieldHelp>
          </div>
        </div>
        <ToggleCard
          checked={state.virtualEnabled}
          onChange={(v) => update('virtualEnabled', v)}
          title={t('wizard.virtualToggle')}
          description={t('wizard.virtualDesc')}
        >
          <FieldHelp title={t('wizard.help.virtualTitle')}>{t('wizard.help.virtualBody')}</FieldHelp>
          {state.virtualEnabled && (
            <div className="mt-3 max-w-xs">
              <Input
                label={t('wizard.activeWindow')}
                numeric
                inputMode="numeric"
                value={state.activeWindowSize}
                onChange={(e) => update('activeWindowSize', e.target.value)}
                helper="20 – 80"
              />
            </div>
          )}
        </ToggleCard>
      </SectionCard>

      <SectionCard
        index="03"
        icon={Shield}
        title={t('wizard.configRisk')}
        subtitle={t('wizard.optional')}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Input
              label={t('wizard.slLabel')}
              numeric
              inputMode="decimal"
              value={state.slPct}
              onChange={(e) => update('slPct', e.target.value)}
            />
            <FieldHelp title={t('wizard.help.slTitle')}>{t('wizard.help.slBody')}</FieldHelp>
          </div>
          <div>
            <Input
              label={t('wizard.tpLabel')}
              numeric
              inputMode="decimal"
              value={state.tpPct}
              onChange={(e) => update('tpPct', e.target.value)}
            />
            <FieldHelp title={t('wizard.help.tpTitle')}>{t('wizard.help.tpBody')}</FieldHelp>
          </div>
        </div>

        <ToggleCard
          checked={state.safeguardEnabled}
          onChange={(v) => update('safeguardEnabled', v)}
          title={t('wizard.safeguardToggle')}
          description={t('wizard.safeguardDesc')}
        >
          {state.safeguardEnabled && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Input
                label={t('wizard.safeguardThreshold')}
                numeric
                inputMode="decimal"
                value={state.safeguardThresholdPct}
                onChange={(e) => update('safeguardThresholdPct', e.target.value)}
                helper="1 – 50"
              />
              <div>
                <label className="mb-1.5 block text-2xs font-semibold uppercase tracking-wider text-text-muted">
                  {t('wizard.safeguardActionLabel')}
                </label>
                <select
                  className="h-10 w-full border border-border-subtle bg-bg-base px-2 text-sm text-text-primary"
                  value={state.safeguardAction}
                  onChange={(e) =>
                    update('safeguardAction', e.target.value as 'pause' | 'pause_close')
                  }
                >
                  <option value="pause">{t('wizard.safeguardPauseOnly')}</option>
                  <option value="pause_close">{t('wizard.safeguardPauseClose')}</option>
                </select>
              </div>
              <p className="col-span-full flex items-start gap-1.5 text-2xs text-text-muted">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
                <span>{t('wizard.safeguardLiqNote')}</span>
              </p>
            </div>
          )}
        </ToggleCard>

        <ToggleCard
          checked={state.autoShiftEnabled}
          onChange={(v) => update('autoShiftEnabled', v)}
          title={t('wizard.autoShiftToggle')}
          description={t('wizard.autoShiftDesc')}
        >
          {state.autoShiftEnabled && (
            <div className="mt-3 max-w-xs">
              <Input
                label={t('wizard.shiftThreshold')}
                numeric
                inputMode="decimal"
                value={state.autoShiftPct}
                onChange={(e) => update('autoShiftPct', e.target.value)}
              />
            </div>
          )}
        </ToggleCard>
      </SectionCard>
    </div>
  );
}

function StepConfirm({
  state,
  update,
  validated,
  isValidating,
  error,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  validated: ValidateBotResult | null;
  isValidating: boolean;
  error: Error | null;
}) {
  const t = useT();
  if (isValidating) {
    return (
      <div className="py-12 text-center">
        <p className="font-mono text-[10px] tracking-[.2em] text-primary">{t('wizard.reviewKicker')}</p>
        <p className="mt-3 animate-pulse text-sm text-text-muted">{t('wizard.validating')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-danger/40 bg-danger-soft/30 p-4">
        <div className="flex items-start gap-2 text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="text-sm font-semibold">{t('wizard.validationFailed')}</div>
            <div className="mt-1 text-xs">{error.message}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!validated) return null;

  const c = validated.computed;
  const pair = parsePair(validated.pair);

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[10px] tracking-[.2em] text-primary">{t('wizard.reviewKicker')}</p>
        <h3 className="mt-1 text-lg font-semibold tracking-[-.03em] text-text-primary">
          {t('wizard.reviewAndCreate')}
        </h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RecapTile label={t('wizard.sumPair')} value={`${pair.ticker} / ${pair.quote}`} />
        <RecapTile
          label={t('wizard.sumDirection')}
          value={validated.direction.toUpperCase()}
          tone={validated.direction === 'long' ? 'long' : 'short'}
        />
        <RecapTile label={t('wizard.sumLeverage')} value={`${validated.input.leverage}x`} />
        <RecapTile
          label={t('wizard.sumRange')}
          value={`${formatUsd(validated.input.lower)} — ${formatUsd(validated.input.upper)}`}
        />
        <RecapTile label={t('wizard.sumGrids')} value={t('wizard.sumLevels', { n: validated.input.grids })} />
        <RecapTile label={t('wizard.sumInvestment')} value={formatUsd(validated.input.investment)} />
      </div>

      <div>
        <h4 className="mb-2 font-mono text-[10px] tracking-[.18em] text-text-muted">
          {t('wizard.computedParams')}
        </h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <RecapTile label={t('wizard.sumSpacing')} value={`${formatUsd(c.spacing)} (${c.spacingPct}%)`} />
          <RecapTile label={t('wizard.sumQtyPerLevel')} value={formatSize(c.qtyPerLevel)} />
          <RecapTile label={t('wizard.sumNotional')} value={formatUsd(c.notional)} />
          <RecapTile label={t('wizard.sumProfitPerRt')} value={formatPnl(c.profitPerRoundTrip)} />
          <RecapTile label={t('wizard.sumEstLiq')} value={formatUsd(c.liquidationEstimate)} />
          <RecapTile label={t('wizard.sumLiqDistance')} value={formatPercent(-c.liqDistancePct)} />
        </div>
      </div>

      {validated.warnings.length > 0 && (
        <div className="border border-warning/40 bg-warning-soft/30 p-3">
          <div className="flex items-start gap-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-semibold">{t('wizard.warnings')}</div>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {validated.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 border border-border-default bg-bg-surface px-3 py-3 text-xs text-text-muted">
        <PauseCircle className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>{t('wizard.pausedBanner')}</span>
      </div>

      <label
        className={cn(
          'flex cursor-pointer items-start gap-3 border px-3 py-3 text-xs text-text-secondary',
          state.acceptedRisk ? 'border-primary bg-primary-soft' : 'border-border-default',
        )}
      >
        <input
          type="checkbox"
          checked={state.acceptedRisk}
          onChange={(e) => update('acceptedRisk', e.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          {t('wizard.acceptanceText')} <Mono>{formatUsd(validated.input.investment)}</Mono>
          {t('wizard.acceptanceTextEnd')}
        </span>
      </label>
    </div>
  );
}

function SectionCard({
  index,
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  index: string;
  icon: typeof TrendingUp;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-border-subtle">
      <header className="flex items-start gap-3 border-b border-border-subtle px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center border border-border-subtle text-primary">
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <div>
          <p className="font-mono text-[10px] tracking-[.18em] text-primary">{index}</p>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-5 text-text-muted">{subtitle}</p>
        </div>
      </header>
      <div className="space-y-4 px-4 py-4">{children}</div>
    </section>
  );
}

function ToggleCard({
  checked,
  onChange,
  title,
  description,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn('border px-3 py-3', checked ? 'border-primary/40 bg-primary-soft/40' : 'border-border-subtle')}>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold text-text-primary">{title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-text-muted">{description}</span>
        </span>
      </label>
      {children}
    </div>
  );
}

function RecapTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'long' | 'short';
}) {
  return (
    <div className="border border-border-subtle bg-bg-surface px-3 py-3">
      <dt className="font-mono text-[10px] tracking-[.16em] text-text-muted">{label}</dt>
      <dd
        className={cn(
          'mt-1 font-mono text-sm text-text-primary',
          tone === 'long' && 'text-success',
          tone === 'short' && 'text-danger',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
