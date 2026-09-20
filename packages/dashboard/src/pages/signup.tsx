import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { GRVT_REFERRAL_URL } from '@/lib/brand';
import { GoogleSignInButton, isGoogleSignInEnabled } from '@/components/google-sign-in';
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
    accept: 'Leí y acepto los términos y condiciones',
    submit: 'Crear mi cuenta',
    pending: 'Creando…',
    divider: 'o',
    account: '¿Ya tenés cuenta?',
    login: 'Iniciá sesión',
    referral: '¿Todavía no tenés GRVT?',
    referralLink: 'Creá tu cuenta con beneficios',
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
    accept: 'I have read and accept the terms and conditions',
    submit: 'Create my account',
    pending: 'Creating…',
    divider: 'or',
    account: 'Already have an account?',
    login: 'Sign in',
    referral: 'Don’t have GRVT yet?',
    referralLink: 'Create your account with benefits',
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
    !!tosTexts &&
    !pending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    try {
      const result = await signup(email, password, lang);
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
    if (!accepted || !tosTexts) {
      toast.error(t('auth.signup.acceptTermsFirst'));
      return;
    }
    setPending(true);
    try {
      await loginWithGoogle(idToken, { acceptedTerms: true, tosLang: lang });
      toast.success(t('auth.signup.accountCreated'));
      navigate('/dashboard/onboarding/grvt', { replace: true });
    } catch (err) {
      toast.error((err as Error).message || t('auth.common.googleFailed'));
    } finally {
      setPending(false);
    }
  }, [accepted, tosTexts, loginWithGoogle, lang, navigate, t]);

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
          <p className="font-mono text-[10px] tracking-[.2em] text-[#9a711f]">{copy.kicker}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.035em] text-[#211c15] sm:text-4xl">{copy.title}</h1>
          <p className="mt-3 text-sm leading-6 text-[#756a5b]">{copy.subtitle}</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-3.5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[#453d33]">{copy.email}</span>
              <span className="relative block">
                <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9a9185]" />
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={copy.emailPlaceholder} disabled={pending} required className={`${authInputClass} pl-11`} />
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[#453d33]">{copy.password}</span>
                <span className="relative block">
                  <LockKeyhole className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9a9185]" />
                  <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={copy.passwordPlaceholder} disabled={pending} required className={`${authInputClass} pl-11 pr-10`} />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8f877c]" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[#453d33]">{copy.confirm}</span>
                <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={pending} required className={authInputClass} />
              </label>
            </div>
            {passwordError && <p className="text-xs text-[#b13b2d]">{passwordError}</p>}

            <details className="rounded-lg border border-[#ded8cf] bg-[#faf8f3]">
              <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-[#6d6254]">{copy.terms}</summary>
              <div className="border-t border-[#e4ded5] px-4 py-3">
                {tosLoadError ? (
                  <p className="text-xs text-[#b13b2d]">{t('common.networkError')}</p>
                ) : !tosTexts ? (
                  <p className="animate-pulse text-xs text-[#8b8174]">{t('common.loading')}</p>
                ) : (
                  <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap font-sans text-[10px] leading-relaxed text-[#756a5b]">{termsBody}</pre>
                )}
              </div>
            </details>
            <label className="flex cursor-pointer items-start gap-2.5 text-xs text-[#5f5549]">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={pending || !tosTexts} className="mt-0.5 size-4 accent-[#c79220]" />
              <span>{copy.accept}</span>
            </label>

            <button type="submit" disabled={!canSubmit} className={authButtonClass}>
              {pending ? copy.pending : copy.submit}
              {!pending && <ArrowRight className="size-4" />}
            </button>
          </form>

          {isGoogleSignInEnabled() && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-[#aaa297]">
                <span className="h-px flex-1 bg-[#e1dcd3]" />{copy.divider}<span className="h-px flex-1 bg-[#e1dcd3]" />
              </div>
              <GoogleSignInButton onCredential={handleGoogle} disabled={pending || !accepted || !tosTexts} label="signup_with" locale={lang} />
            </div>
          )}

          <p className="mt-4 text-center text-xs text-[#756a5b]">
            {copy.account}{' '}
            <Link to="/dashboard/login" className="font-semibold text-[#208a57] hover:underline">{copy.login}</Link>
          </p>
          <p className="mt-2 text-center text-[11px] text-[#91877a]">
            {copy.referral}{' '}
            <a href={GRVT_REFERRAL_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-[#98701b] hover:underline">{copy.referralLink}</a>
          </p>
        </div>
      )}
    </AuthShell>
  );
}
