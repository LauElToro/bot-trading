import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-types';
import { GRVT_REFERRAL_URL } from '@/lib/brand';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { GoogleSignInButton, isGoogleSignInEnabled } from '@/components/google-sign-in';
import { LanguageToggle, useLang, useT } from '@/i18n';

export function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const { lang } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setPending(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error((err as Error).message || t('auth.login.loginFailed'));
    } finally {
      setPending(false);
    }
  }

  const handleGoogle = useCallback(async (idToken: string) => {
    setPending(true);
    try {
      await loginWithGoogle(idToken);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t('auth.login.googleNeedsSignup'));
        navigate('/signup', { replace: true });
        return;
      }
      toast.error((err as Error).message || t('auth.common.googleFailed'));
    } finally {
      setPending(false);
    }
  }, [loginWithGoogle, navigate, t]);

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-bg-base">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-end">
          <LanguageToggle />
        </div>
        <div className="text-center space-y-3">
          <BrandMark className="justify-center" />
          <p className="text-sm text-text-muted">{t('auth.login.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('auth.login.email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
          />
          <Input
            label={t('auth.login.password')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
          />
          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-xs text-text-muted hover:text-primary hover:underline"
            >
              {t('auth.login.forgotPassword')}
            </Link>
          </div>
          <Button
            variant="primary"
            type="submit"
            disabled={pending || !email || !password}
            className="w-full"
          >
            {pending ? t('auth.login.loggingIn') : t('auth.login.loginBtn')}
          </Button>
        </form>

        {isGoogleSignInEnabled() && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-2xs uppercase tracking-wider text-text-muted">
              <span className="flex-1 h-px bg-border-subtle" />
              {t('auth.common.or')}
              <span className="flex-1 h-px bg-border-subtle" />
            </div>
            <GoogleSignInButton
              onCredential={handleGoogle}
              disabled={pending}
              label="signin_with"
              locale={lang}
            />
          </div>
        )}

        <p className="text-xs text-text-muted text-center">
          {t('auth.login.noAccount')}{' '}
          <Link to="/signup" className="text-primary hover:underline">
            {t('auth.login.signUp')}
          </Link>
        </p>

        <p className="text-2xs text-text-muted text-center">
          {t('auth.login.needGrvt')}{' '}
          <a
            href={GRVT_REFERRAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t('auth.login.grvtReferralCta')}
          </a>
        </p>
      </div>
    </div>
  );
}
