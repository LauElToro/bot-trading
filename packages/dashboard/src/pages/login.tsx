import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-types';
import { GRVT_REFERRAL_URL } from '@/lib/brand';
import { GoogleSignInButton } from '@/components/google-sign-in';
import { useLang, useT } from '@/i18n';
import {
  AuthShell,
  authButtonClass,
  authInputClass,
} from '@/components/auth/auth-shell';
import { OtpStep } from '@/components/auth/otp-step';

const COPY = {
  es: {
    kicker: 'ACCESO A TU CUENTA',
    title: 'Volvé a Toro y seguí operando',
    subtitle: 'Ingresá con tu email y contraseña. Después confirmaremos tu acceso por email.',
    email: 'Email',
    emailPlaceholder: 'tu@email.com',
    password: 'Contraseña',
    passwordPlaceholder: 'Tu contraseña',
    submit: 'Continuar de forma segura',
    pending: 'Validando…',
    divider: 'o',
    noAccount: '¿Todavía no tenés cuenta?',
    create: 'Creá una',
    referral: '¿Todavía no usás GRVT?',
    referralLink: 'Abrí tu cuenta',
    otpError: 'El código es incorrecto, venció o ya fue utilizado.',
    resendError: 'No pudimos reenviar el código. Intentá nuevamente.',
  },
  en: {
    kicker: 'ACCOUNT ACCESS',
    title: 'Return to Toro and keep trading',
    subtitle: 'Enter your email and password. We will then confirm your access by email.',
    email: 'Email',
    emailPlaceholder: 'you@email.com',
    password: 'Password',
    passwordPlaceholder: 'Your password',
    submit: 'Continue securely',
    pending: 'Checking…',
    divider: 'or',
    noAccount: 'Don’t have an account yet?',
    create: 'Create one',
    referral: 'Not using GRVT yet?',
    referralLink: 'Open your account',
    otpError: 'The code is incorrect, expired, or has already been used.',
    resendError: 'We could not resend the code. Please try again.',
  },
} as const;

export function LoginPage() {
  const { login, loginWithGoogle, verifyOtp, resendOtp } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const { lang } = useLang();
  const copy = COPY[lang];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<{ id: string; emailHint: string } | null>(null);
  const [otpError, setOtpError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setPending(true);
    try {
      const result = await login(email, password, lang);
      setChallenge({ id: result.challengeId, emailHint: result.emailHint });
    } catch (err) {
      toast.error((err as Error).message || t('auth.login.loginFailed'));
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
      navigate('/dashboard', { replace: true });
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
    setPending(true);
    try {
      await loginWithGoogle(idToken);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t('auth.login.googleNeedsSignup'));
        navigate('/dashboard/signup', { replace: true });
        return;
      }
      toast.error((err as Error).message || t('auth.common.googleFailed'));
    } finally {
      setPending(false);
    }
  }, [loginWithGoogle, navigate, t]);

  return (
    <AuthShell mode="login">
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
          <h1 className="mt-2 text-3xl font-bold tracking-[-.035em] text-text-primary sm:text-4xl">
            {copy.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-text-muted">{copy.subtitle}</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-text-secondary">{copy.email}</span>
              <span className="relative block">
                <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-disabled" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={copy.emailPlaceholder}
                  disabled={pending}
                  required
                  className={`${authInputClass} pl-11`}
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-text-secondary">{copy.password}</span>
              <span className="relative block">
                <LockKeyhole className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-disabled" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={copy.passwordPlaceholder}
                  disabled={pending}
                  required
                  className={`${authInputClass} px-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            <div className="flex justify-end">
              <Link to="/dashboard/forgot-password" className="text-xs font-medium text-primary hover:underline">
                {t('auth.login.forgotPassword')}
              </Link>
            </div>
            <button type="submit" disabled={pending || !email || !password} className={authButtonClass}>
              {pending ? copy.pending : copy.submit}
              {!pending && <ArrowRight className="size-4" />}
            </button>
          </form>

          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-text-disabled">
              <span className="h-px flex-1 bg-border-subtle" />
              {copy.divider}
              <span className="h-px flex-1 bg-border-subtle" />
            </div>
            <GoogleSignInButton onCredential={handleGoogle} disabled={pending} label="signin_with" locale={lang} />
          </div>

          <p className="mt-5 text-center text-xs text-text-muted">
            {copy.noAccount}{' '}
            <Link to="/dashboard/signup" className="font-semibold text-primary hover:underline">
              {copy.create}
            </Link>
          </p>
          <p className="mt-3 text-center text-[11px] text-text-disabled">
            {copy.referral}{' '}
            <a href={GRVT_REFERRAL_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
              {copy.referralLink}
            </a>
          </p>
        </div>
      )}
    </AuthShell>
  );
}
