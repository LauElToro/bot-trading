import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import {
  FieldSource,
  GrvtKeysTutorial,
  GrvtReferralLine,
  type GrvtTutorialStep,
} from '@/components/grvt-keys-tutorial';
import { LanguageToggle, useT } from '@/i18n';

export function GrvtOnboardingPage() {
  const t = useT();
  const { refreshMe } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<GrvtTutorialStep>(0);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [tradingAddress, setTradingAddress] = useState('');
  const [accountId, setAccountId] = useState('');
  const [subAccountId, setSubAccountId] = useState('');
  const [pending, setPending] = useState(false);

  const canSave =
    apiKey.length > 0 &&
    /^0x[0-9a-fA-F]{64}$/.test(apiSecret) &&
    /^0x[0-9a-fA-F]{40}$/.test(tradingAddress) &&
    accountId.length > 0 &&
    !pending;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setPending(true);
    try {
      await api.saveGrvtCredentials({
        apiKey,
        apiSecret,
        tradingAddress,
        accountId,
        subAccountId: subAccountId.trim() || undefined,
      });
      toast.success(t('onboarding.grvt.saved'));
      await refreshMe();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error((err as Error).message || t('onboarding.grvt.saveFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-dvh bg-bg-muted">
      <div className="mx-auto flex max-w-[860px] flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/dashboard/settings"
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary"
          >
            <ArrowLeft className="size-4" />
            {t('settings.title')}
          </Link>
          <LanguageToggle />
        </div>

        <div>
          <BrandMark />
          <p className="mt-5 font-mono text-[10px] tracking-[.22em] text-primary">
            {t('onboarding.grvt.kicker')}
          </p>
          <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-tight text-text-primary">
            {t('onboarding.grvt.title')}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
            {t('onboarding.grvt.subtitle')}
          </p>
          <div className="mt-3">
            <GrvtReferralLine />
          </div>
        </div>

        <GrvtKeysTutorial activeStep={step} onStepChange={setStep} />

        <section className="border border-border-subtle bg-bg-elevated">
          <div className="border-b border-border-subtle px-5 py-4">
            <p className="font-mono text-[10px] tracking-[.22em] text-primary">
              {t('onboarding.grvt.formKicker')}
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">
              {t('onboarding.grvt.formTitle')}
            </h2>
            <p className="mt-1 text-sm text-text-muted">{t('onboarding.grvt.formBody')}</p>
          </div>

          <form onSubmit={handleSave} className="grid gap-4 px-5 py-5 md:grid-cols-2">
            <FieldWrap active={step === 2}>
              <Input
                positive
                label={t('onboarding.grvt.apiKey')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={pending}
                autoComplete="off"
                onFocus={() => setStep(2)}
                className={apiKey.length > 0 ? 'border-ok' : undefined}
              />
              <FieldSource step={2} onOpen={setStep}>
                {t('onboarding.grvt.findApiKey')}
              </FieldSource>
            </FieldWrap>
            <FieldWrap active={step === 2}>
              <Input
                positive
                label={t('onboarding.grvt.apiSecret')}
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                disabled={pending}
                autoComplete="off"
                onFocus={() => setStep(2)}
                className={/^0x[0-9a-fA-F]{64}$/.test(apiSecret) ? 'border-ok' : undefined}
                helper={
                  apiSecret && !/^0x[0-9a-fA-F]{64}$/.test(apiSecret)
                    ? t('onboarding.grvt.apiSecretError')
                    : undefined
                }
              />
              <FieldSource step={2} onOpen={setStep}>
                {t('onboarding.grvt.findSecret')}
              </FieldSource>
            </FieldWrap>
            <FieldWrap active={step === 0}>
              <Input
                positive
                label={t('onboarding.grvt.accountId')}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={pending}
                autoComplete="off"
                onFocus={() => setStep(0)}
                className={accountId.length > 0 ? 'border-ok' : undefined}
              />
              <FieldSource step={0} onOpen={setStep}>
                {t('onboarding.grvt.findAccountId')}
              </FieldSource>
            </FieldWrap>
            <FieldWrap active={step === 0}>
              <Input
                positive
                label={t('onboarding.grvt.tradingAddress')}
                value={tradingAddress}
                onChange={(e) => setTradingAddress(e.target.value)}
                disabled={pending}
                autoComplete="off"
                onFocus={() => setStep(0)}
                className={/^0x[0-9a-fA-F]{40}$/.test(tradingAddress) ? 'border-ok' : undefined}
                helper={
                  tradingAddress && !/^0x[0-9a-fA-F]{40}$/.test(tradingAddress)
                    ? t('onboarding.grvt.tradingAddressError')
                    : undefined
                }
              />
              <FieldSource step={0} onOpen={setStep}>
                {t('onboarding.grvt.findAddress')}
              </FieldSource>
            </FieldWrap>
            <FieldWrap active={step === 0} className="md:col-span-2">
              <Input
                positive
                label={t('onboarding.grvt.subAccountId')}
                className={subAccountId.length > 0 ? 'border-ok' : undefined}
                value={subAccountId}
                onChange={(e) => setSubAccountId(e.target.value)}
                disabled={pending}
                autoComplete="off"
                onFocus={() => setStep(0)}
              />
              <FieldSource step={0} onOpen={setStep}>
                {t('onboarding.grvt.findSub')}
              </FieldSource>
            </FieldWrap>

            <div className="flex items-start gap-2 border border-border-subtle bg-bg-surface px-3 py-3 text-[11px] leading-5 text-text-muted md:col-span-2">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>{t('onboarding.grvt.encryptionNote')}</span>
            </div>

            <div className="md:col-span-2">
              <Button variant="primary" type="submit" disabled={!canSave} className="w-full md:w-auto">
                {pending ? t('onboarding.grvt.saving') : t('onboarding.grvt.saveBtn')}
              </Button>
              <p className="mt-3 text-2xs text-text-muted">{t('onboarding.grvt.canUpdateLater')}</p>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

function FieldWrap({
  active,
  children,
  className,
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        className,
        active
          ? 'border border-ok/45 bg-ok-soft px-3 py-3'
          : 'border border-transparent px-3 py-3',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
