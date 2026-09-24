import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  KeyRound,
  ShieldOff,
} from 'lucide-react';
import { GRVT_REFERRAL_URL } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';

export type GrvtTutorialStep = 0 | 1 | 2;

const SHOTS = [
  { src: '/tutorial/grvt-api-keys.png', altKey: 'onboarding.grvt.shotListAlt' },
  { src: '/tutorial/grvt-create-key.png', altKey: 'onboarding.grvt.shotCreateAlt' },
  { src: '/tutorial/grvt-reveal-key.png', altKey: 'onboarding.grvt.shotRevealAlt' },
] as const;

const STEP_META = [
  { n: '01', titleKey: 'onboarding.grvt.step1Title', bodyKey: 'onboarding.grvt.step1Body' },
  { n: '02', titleKey: 'onboarding.grvt.step2Title', bodyKey: 'onboarding.grvt.step2Body' },
  { n: '03', titleKey: 'onboarding.grvt.step3Title', bodyKey: 'onboarding.grvt.step3Body' },
] as const;

export function GrvtKeysTutorial({
  activeStep,
  onStepChange,
}: {
  activeStep: GrvtTutorialStep;
  onStepChange: (step: GrvtTutorialStep) => void;
}) {
  const t = useT();
  const shot = SHOTS[activeStep];

  return (
    <div className="border border-border-subtle bg-bg-elevated">
      <div className="px-5 py-4">
        <p className="font-mono text-[10px] tracking-[.22em] text-primary">
          {t('onboarding.grvt.tutorialKicker')}
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-text-primary">
          {t('onboarding.grvt.tutorialTitle')}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
          {t('onboarding.grvt.tutorialBody')}
        </p>
        <a
          href="https://grvt.io/exchange/account/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          {t('onboarding.grvt.openApiKeys')}
          <ExternalLink className="size-3.5" />
        </a>
      </div>

      <ol className="grid border-y border-border-subtle sm:grid-cols-3">
        {STEP_META.map((step, index) => {
          const active = activeStep === index;
          return (
            <li key={step.n}>
              <button
                type="button"
                onClick={() => onStepChange(index as GrvtTutorialStep)}
                className={cn(
                  'relative flex h-full w-full flex-col gap-1 border-b border-border-subtle px-4 py-3 text-left sm:border-b-0 sm:border-r sm:last:border-r-0',
                  active ? 'bg-primary-soft' : 'hover:bg-bg-muted',
                )}
              >
                {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
                <span className={cn('font-mono text-[10px] tracking-[.18em]', active ? 'text-primary' : 'text-text-muted')}>
                  {step.n}
                </span>
                <span className="text-sm font-semibold text-text-primary">{t(step.titleKey)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <figure className="bg-[#09090b]">
        <img
          src={shot.src}
          alt={t(shot.altKey)}
          className="mx-auto block w-full max-h-[420px] object-contain"
        />
      </figure>

      <div className="space-y-3 px-5 py-5">
        <p className="text-sm leading-6 text-text-secondary">{t(STEP_META[activeStep].bodyKey)}</p>
        {activeStep === 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            <Callout>{t('onboarding.grvt.tipAccount')}</Callout>
            <Callout tone="id">{t('onboarding.grvt.tipAccountId')}</Callout>
            <Callout tone="addr">{t('onboarding.grvt.tipAddress')}</Callout>
            <Callout danger>{t('onboarding.grvt.tipNoFunding')}</Callout>
          </ul>
        )}
        {activeStep === 1 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            <Callout ok>{t('onboarding.grvt.tipTradeOnly')}</Callout>
            <Callout danger>{t('onboarding.grvt.tipNoTransfer')}</Callout>
            <Callout tone="addr">{t('onboarding.grvt.tipCreateAddress')}</Callout>
          </ul>
        )}
        {activeStep === 2 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            <Callout>{t('onboarding.grvt.tipOnce')}</Callout>
            <Callout tone="key">{t('onboarding.grvt.tipApiKey')}</Callout>
            <Callout tone="secret">{t('onboarding.grvt.tipSecret')}</Callout>
          </ul>
        )}
      </div>
    </div>
  );
}

function Callout({
  children,
  ok,
  danger,
  tone,
}: {
  children: string;
  ok?: boolean;
  danger?: boolean;
  tone?: 'id' | 'addr' | 'key' | 'secret';
}) {
  return (
    <li
      className={cn(
        'flex items-start gap-2 border px-3 py-2 text-xs leading-5',
        danger
          ? 'border-danger/40 bg-danger-soft/40 text-text-secondary'
          : ok
            ? 'border-primary/40 bg-primary-soft text-text-secondary'
            : 'border-border-subtle bg-bg-surface text-text-muted',
      )}
    >
      {danger ? (
        <ShieldOff className="mt-0.5 size-3.5 shrink-0 text-danger" />
      ) : ok ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
      ) : tone === 'secret' || tone === 'key' ? (
        <KeyRound className="mt-0.5 size-3.5 shrink-0 text-primary" />
      ) : (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-primary" />
      )}
      <span>{children}</span>
    </li>
  );
}

export function FieldSource({
  step,
  onOpen,
  children,
}: {
  step: GrvtTutorialStep;
  onOpen: (step: GrvtTutorialStep) => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(step)}
      className="mt-1 text-left text-[11px] leading-5 text-text-muted hover:text-ok"
    >
      <span className="font-mono text-[10px] tracking-wider text-ok">
        {tStep(step)}
      </span>{' '}
      {children}
    </button>
  );
}

function tStep(step: GrvtTutorialStep) {
  return String(step + 1).padStart(2, '0');
}

export function GrvtReferralLine() {
  const t = useT();
  return (
    <p className="text-xs leading-5 text-text-muted">
      {t('onboarding.grvt.referralHint')}{' '}
      <a
        href={GRVT_REFERRAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary hover:underline"
      >
        {t('onboarding.grvt.referralCta')}
      </a>
    </p>
  );
}

export function useGrvtTutorialStep() {
  const [step, setStep] = useState<GrvtTutorialStep>(0);
  return { step, setStep };
}
