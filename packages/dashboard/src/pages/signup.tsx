import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import {
  GRVT_REFERRAL_CODE,
  GRVT_REFERRAL_URL,
} from '@/lib/brand';
import { GoogleSignInButton } from '@/components/google-sign-in';
import { useLang } from '@/i18n';
import {
  AuthShell,
  authButtonClass,
  authInputClass,
} from '@/components/auth/auth-shell';
import { OtpStep } from '@/components/auth/otp-step';

const COPY = {
  es: {
    kicker: 'REGISTRO SEGURO',
    title: 'Creá tu cuenta y diseñá tu primera grilla',
    subtitle: 'Registrate en menos de un minuto. No se colocan órdenes hasta que vos las confirmes.',
    email: 'Email',
    emailPlaceholder: 'tu@email.com',
    password: 'Contraseña',
    passwordPlaceholder: 'Mínimo 8 caracteres',
    confirm: 'Confirmar contraseña',
    terms: 'Ver términos y condiciones',
    fullTerms: 'Abrir documento completo',
    accept: 'Leí y acepto los términos y condiciones',
    submit: 'Crear mi cuenta',
    pending: 'Creando…',
    divider: 'o',
    account: '¿Ya tenés cuenta?',
    login: 'Iniciá sesión',
    referral: '¿Todavía no tenés GRVT?',
    referralLink: 'Creá tu cuenta con beneficios',
    referralTitle: 'Cuenta GRVT vinculada al referido',
    referralBody:
      'Para usar Toro, tu cuenta GRVT debe haberse creado desde nuestro enlace con el código HCAQ5ES.',
    referralCode: 'Código de referido requerido',
    referralConfirm:
      'Confirmo que mi cuenta GRVT fue creada con el referido HCAQ5ES.',
    otpError: 'El código es incorrecto, venció o ya fue utilizado.',
    resendError: 'No pudimos reenviar el código. Intentá nuevamente.',
    created: 'Email verificado. Tu cuenta ya está lista.',
  },
  en: {
    kicker: 'SECURE REGISTRATION',
    title: 'Create your account and design your first grid',
    subtitle: 'Sign up in under a minute. No orders are placed until you confirm them.',
    email: 'Email',
    emailPlaceholder: 'you@email.com',
    password: 'Password',
    passwordPlaceholder: 'At least 8 characters',
    confirm: 'Confirm password',
    terms: 'View terms and conditions',
    fullTerms: 'Open full document',
    accept: 'I have read and accept the terms and conditions',
    submit: 'Create my account',
    pending: 'Creating…',
    divider: 'or',
    account: 'Already have an account?',
    login: 'Sign in',
    referral: 'Don’t have GRVT yet?',
    referralLink: 'Create your account with benefits',
    referralTitle: 'GRVT account linked to the referral',
    referralBody:
      'To use Toro, your GRVT account must have been created from our link with code HCAQ5ES.',
    referralCode: 'Required referral code',
    referralConfirm:
      'I confirm my GRVT account was created with referral HCAQ5ES.',
    otpError: 'The code is incorrect, expired, or has already been used.',
    resendError: 'We could not resend the code. Please try again.',
    created: 'Email verified. Your account is ready.',
  },
} as const;

export function SignupPage() {
  const { signup, loginWithGoogle, verifyOtp, resendOtp } = useAuth();
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const copy = COPY[lang];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [referralCode] = useState(GRVT_REFERRAL_CODE);
  const [referralConfirmed, setReferralConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<{ id: string; emailHint: string } | null>(null);
  const [otpError, setOtpError] = useState('');
  // TOS texts are fetched from the server so the dashboard and the
  // hash audit log stay in lockstep without manual duplication. We
  // keep both languages in memory so toggling is instant.
  const [tosTexts, setTosTexts] = useState<{ en: string; es: string } | null>(
    null
  );
  const [tosLoadError, setTosLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getTos()
      .then((r) => {
        if (cancelled) return;
        if (r.texts) {
          setTosTexts(r.texts);
        } else {
          setTosTexts({ en: r.text, es: r.text });
        }
      })
      .catch(() => {
        if (!cancelled) setTosLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const passwordError =
    confirm && password !== confirm
      ? t('auth.signup.passwordsDontMatch')
      : undefined;
  const canSubmit =
    !!email &&
    password.length >= 8 &&
    password === confirm &&
    accepted &&
    referralCode.trim().toUpperCase() === GRVT_REFERRAL_CODE &&
    referralConfirmed &&
    !!tosTexts &&
    !pending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    try {
      const result = await signup(email, password, lang, referralCode);
      setChallenge({ id: result.challengeId, emailHint: result.emailHint });
    } catch (err) {
      toast.error((err as Error).message || t('auth.signup.signupFailed'));
    } finally {
      setPending(false);
    }
  }

  async function handleVerify(code: string) {
    if (!challenge) return;
    setPending(true);
    setOtpError('');
    try {
      await verifyOtp(challenge.id, code, email);
      toast.success(copy.created);
      navigate('/dashboard/onboarding/grvt', { replace: true });
    } catch {
      setOtpError(copy.otpError);
    } finally {
      setPending(false);
    }
  }

  async function handleResend() {
    if (!challenge) return;
    try {
      await resendOtp(challenge.id, lang);
    } catch {
      toast.error(copy.resendError);
    }
  }

  const handleGoogle = useCallback(async (idToken: string) => {
    if (
      !accepted ||
      !tosTexts ||
      !referralConfirmed ||
      referralCode.trim().toUpperCase() !== GRVT_REFERRAL_CODE
    ) {
      toast.error(t('auth.signup.acceptTermsFirst'));
      return;
    }
    setPending(true);
    try {
      await loginWithGoogle(idToken, {
        acceptedTerms: true,
        tosLang: lang,
        referralCode,
      });
      toast.success(t('auth.signup.accountCreated'));
      navigate('/dashboard/onboarding/grvt', { replace: true });
    } catch (err) {
      toast.error((err as Error).message || t('auth.common.googleFailed'));
    } finally {
      setPending(false);
    }
  }, [
    accepted,
    tosTexts,
    loginWithGoogle,
    lang,
    navigate,
    referralCode,
    referralConfirmed,
    t,
  ]);

  const termsBody = tosTexts ? tosTexts[lang] : '';

  return (
    <AuthShell mode="signup">
      {challenge ? (
        <OtpStep
          emailHint={challenge.emailHint}
          pending={pending}
          error={otpError}
          onVerify={handleVerify}
          onResend={handleResend}
          onBack={() => {
            setChallenge(null);
            setOtpError('');
          }}
        />
      ) : (
        <div>
          <p className="font-mono text-[10px] tracking-[.2em] text-primary">{copy.kicker}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.035em] text-text-primary sm:text-4xl">{copy.title}</h1>
          <p className="mt-3 text-sm leading-6 text-text-muted">{copy.subtitle}</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-3.5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-text-secondary">{copy.email}</span>
              <span className="relative block">
                <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-disabled" />
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={copy.emailPlaceholder} disabled={pending} required className={`${authInputClass} pl-11`} />
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-text-secondary">{copy.password}</span>
                <span className="relative block">
                  <LockKeyhole className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-disabled" />
                  <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={copy.passwordPlaceholder} disabled={pending} required className={`${authInputClass} pl-11 pr-10`} />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-text-secondary">{copy.confirm}</span>
                <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={pending} required className={authInputClass} />
              </label>
            </div>
            {passwordError && <p className="text-xs text-danger">{passwordError}</p>}

            <div className="rounded-lg border border-primary/25 bg-primary-soft p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-text-primary">{copy.referralTitle}</p>
                  <p className="mt-1 text-[11px] leading-4 text-text-muted">{copy.referralBody}</p>
                </div>
                <a
                  href={GRVT_REFERRAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-md border border-primary/40 px-2.5 py-1.5 text-[10px] font-bold text-primary hover:bg-primary/10"
                >
                  GRVT ↗
                </a>
              </div>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                  {copy.referralCode}
                </span>
                <input
                  type="text"
                  value={referralCode}
                  readOnly
                  maxLength={GRVT_REFERRAL_CODE.length}
                  disabled={pending}
                  required
                  className={`${authInputClass} h-10 cursor-default bg-bg-base font-mono uppercase tracking-[.18em]`}
                />
              </label>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] leading-4 text-text-secondary">
                <input
                  type="checkbox"
                  checked={referralConfirmed}
                  onChange={(event) => setReferralConfirmed(event.target.checked)}
                  disabled={pending}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>{copy.referralConfirm}</span>
              </label>
            </div>

            <details className="rounded-lg border border-border-subtle bg-bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-text-secondary">{copy.terms}</summary>
              <div className="border-t border-border-subtle px-4 py-3">
                {tosLoadError ? (
                  <p className="text-xs text-danger">{t('common.networkError')}</p>
                ) : !tosTexts ? (
                  <p className="animate-pulse text-xs text-text-muted">{t('common.loading')}</p>
                ) : (
                  <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap font-sans text-[10px] leading-relaxed text-text-muted">{termsBody}</pre>
                )}
                <Link
                  to="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex text-[11px] font-semibold text-primary underline underline-offset-2"
                >
                  {copy.fullTerms}
                </Link>
              </div>
            </details>
            <label className="flex cursor-pointer items-start gap-2.5 text-xs text-text-secondary">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={pending || !tosTexts} className="mt-0.5 size-4 accent-primary" />
              <span>{copy.accept}</span>
            </label>

            <button type="submit" disabled={!canSubmit} className={authButtonClass}>
              {pending ? copy.pending : copy.submit}
              {!pending && <ArrowRight className="size-4" />}
            </button>
          </form>

          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-text-disabled">
              <span className="h-px flex-1 bg-border-subtle" />{copy.divider}<span className="h-px flex-1 bg-border-subtle" />
            </div>
            <GoogleSignInButton
              onCredential={handleGoogle}
              disabled={
                pending ||
                !accepted ||
                !tosTexts ||
                !referralConfirmed ||
                referralCode.trim().toUpperCase() !== GRVT_REFERRAL_CODE
              }
              label="signup_with"
              locale={lang}
            />
          </div>

          <p className="mt-4 text-center text-xs text-text-muted">
            {copy.account}{' '}
            <Link to="/dashboard/login" className="font-semibold text-primary hover:underline">{copy.login}</Link>
          </p>
          <p className="mt-2 text-center text-[11px] text-text-disabled">
            {copy.referral}{' '}
            <a href={GRVT_REFERRAL_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{copy.referralLink}</a>
          </p>
        </div>
      )}
    </AuthShell>
  );
}
