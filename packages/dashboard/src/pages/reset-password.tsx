import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { LanguageToggle, useT } from '@/i18n';

export function ResetPasswordPage() {
  const t = useT();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    !!token && password.length >= 8 && password === confirm && !pending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    try {
      await api.resetPassword(token, password);
      toast.success(t('auth.resetPassword.successBody'));
      navigate('/dashboard/login', { replace: true });
    } catch (err) {
      toast.error((err as Error).message || t('auth.resetPassword.failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-bg-base">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-end">
          <LanguageToggle />
        </div>
        <div className="text-center space-y-3">
          <BrandMark className="justify-center" />
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            {t('auth.resetPassword.title')}
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {t('auth.resetPassword.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('auth.resetPassword.missingToken')}
            autoComplete="one-time-code"
            value={token}
            onChange={(e) => setToken(e.target.value.trim())}
            disabled={pending}
          />
          <Input
            label={t('auth.resetPassword.newPassword')}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            error={tooShort ? t('auth.signup.password') : undefined}
          />
          <Input
            label={t('auth.resetPassword.confirmPassword')}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={pending}
            error={
              mismatch ? t('auth.resetPassword.passwordsDontMatch') : undefined
            }
          />
          <Button
            variant="primary"
            type="submit"
            disabled={!canSubmit}
            className="w-full"
          >
            {pending
              ? t('auth.resetPassword.resetting')
              : t('auth.resetPassword.resetBtn')}
          </Button>
        </form>

        <p className="text-xs text-text-muted text-center">
          <Link to="/dashboard/login" className="text-primary hover:underline">
            {t('auth.resetPassword.backToLogin')}
          </Link>
        </p>
      </div>
    </div>
  );
}
