import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { communityAvatarUrl, publicDisplayName } from '@/lib/avatar';
import { GRVT_REFERRAL_URL } from '@/lib/brand';
import { PageHeader } from '@/components/page-header';
import { UserAvatar } from '@/components/user-avatar';
import { Card } from '@/components/primitives/card';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { Mono } from '@/components/primitives/mono';
import { SubAccountsCard } from '@/components/sub-accounts-card';
import { useT } from '@/i18n';

export function SettingsPage() {
  const t = useT();
  const { user, logout, refreshMe } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setBio(user?.bio ?? '');
  }, [user?.displayName, user?.bio]);

  async function saveProfile() {
    setSaving(true);
    try {
      await api.updateProfile({ displayName, bio });
      await refreshMe();
      toast.success(t('profile.saved'));
    } catch (err) {
      toast.error((err as Error).message || t('profile.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function onPickAvatar(file: File | undefined) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error(t('profile.imageType'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('profile.imageSize'));
      return;
    }
    setUploading(true);
    try {
      const data = await fileToBase64(file);
      await api.uploadAvatar(file.type, data);
      await refreshMe();
      toast.success(t('profile.avatarSaved'));
    } catch (err) {
      toast.error((err as Error).message || t('profile.avatarFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    setUploading(true);
    try {
      await api.deleteAvatar();
      await refreshMe();
      toast.success(t('profile.avatarRemoved'));
    } catch (err) {
      toast.error((err as Error).message || t('profile.avatarFailed'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
      />

      <Card>
        <p className="font-mono text-[10px] tracking-[.18em] text-primary">{t('profile.kicker')}</p>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{t('profile.title')}</h2>
        <div className="mt-5 flex flex-col gap-5 sm:flex-row">
          <div className="flex flex-col items-start gap-3">
            <UserAvatar
              name={displayName || user?.displayName}
              email={user?.email}
              src={user ? communityAvatarUrl(user.id, user.hasAvatar, user.avatarUpdatedAt) : null}
              size="xl"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                void onPickAvatar(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? t('profile.uploading') : t('profile.changePhoto')}
              </Button>
              {user?.hasAvatar && (
                <Button size="sm" variant="ghost" disabled={uploading} onClick={() => void removeAvatar()}>
                  {t('profile.removePhoto')}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-text-disabled">{t('profile.photoHint')}</p>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <Input
              label={t('profile.displayName')}
              value={displayName}
              maxLength={40}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={publicDisplayName(null, user?.email)}
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
                {t('profile.bio')}
              </span>
              <textarea
                value={bio}
                maxLength={160}
                rows={3}
                onChange={(event) => setBio(event.target.value)}
                placeholder={t('profile.bioPlaceholder')}
                className="w-full border border-border-subtle bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus-visible:border-primary"
              />
            </label>
            <Button onClick={() => void saveProfile()} disabled={saving}>
              {saving ? t('common.save') + '…' : t('profile.save')}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold mb-3">{t('settings.sectionAccount')}</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-text-muted uppercase tracking-wider text-2xs">{t('settings.account.email')}</dt>
          <dd className="font-mono text-text-secondary">{user?.email}</dd>
          <dt className="text-text-muted uppercase tracking-wider text-2xs">{t('settings.account.role')}</dt>
          <dd className="text-text-secondary">
            {user?.isAdmin ? t('settings.account.admin') : t('settings.account.user')}
          </dd>
        </dl>
        <div className="mt-4">
          <Button
            variant="secondary"
            onClick={() => {
              logout();
              navigate('/dashboard/login', { replace: true });
            }}
          >
            {t('settings.account.logoutBtn')}
          </Button>
        </div>
      </Card>

      <Card>
        <p className="font-mono text-[10px] tracking-[.18em] text-primary">{t('onboarding.grvt.kicker')}</p>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{t('settings.sectionGrvt')}</h2>
        {user?.hasGrvtCreds ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="size-2 rounded-full bg-success" />
              <span className="text-text-secondary">{t('settings.grvtConnected')}</span>
            </div>
            <p className="text-sm leading-6 text-text-muted">{t('settings.grvtEncryptedNote')}</p>
            <p className="text-xs text-text-muted">{t('settings.grvtTutorialHint')}</p>
            <Button variant="secondary" onClick={() => navigate('/dashboard/onboarding/grvt')}>
              {t('settings.grvtUpdateBtn')}
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="size-2 rounded-full bg-warning" />
              <span className="text-warning">{t('settings.grvtNotConnected')}</span>
            </div>
            <p className="text-sm leading-6 text-text-muted">{t('settings.grvtMissingNote')}</p>
            <p className="text-xs text-text-muted">{t('settings.grvtTutorialHint')}</p>
            <Button variant="primary" onClick={() => navigate('/dashboard/onboarding/grvt')}>
              {t('settings.grvtConnectBtn')}
            </Button>
          </div>
        )}
      </Card>

      {user?.hasGrvtCreds && <SubAccountsCard />}

      <Card>
        <h2 className="text-sm font-semibold mb-2">{t('settings.sectionConnection')}</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-text-muted uppercase tracking-wider text-2xs">{t('settings.apiBase')}</dt>
          <dd className="font-mono text-text-secondary">
            {import.meta.env.VITE_API_BASE_URL || t('settings.sameOrigin')}
          </dd>
          <dt className="text-text-muted uppercase tracking-wider text-2xs">{t('settings.auth')}</dt>
          <dd className="font-mono text-text-secondary">
            JWT (<Mono>userId={user?.id}</Mono>)
          </dd>
        </dl>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold mb-2">{t('settings.sectionReferral')}</h2>
        <p className="text-2xs text-text-muted">{t('settings.referralBody')}</p>
        <a
          href={GRVT_REFERRAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-sm text-primary hover:underline"
        >
          {t('settings.referralCta')}
        </a>
      </Card>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
