import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { communityAvatarUrl, publicDisplayName } from '@/lib/avatar';
import { ProfileTags } from '@/components/profile-tags';
import { GRVT_REFERRAL_URL } from '@/lib/brand';
import { PageHeader } from '@/components/page-header';
import { UserAvatar } from '@/components/user-avatar';
import { Card } from '@/components/primitives/card';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { SubAccountsCard } from '@/components/sub-accounts-card';
import { useT } from '@/i18n';
import { ApiError, DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@/lib/api-types';

export function SettingsPage() {
  const t = useT();
  const { user, logout, refreshMe, patchUser } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [tag, setTag] = useState(user?.tags?.[0] ?? '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const serverTag = user?.tags?.[0] ?? '';

  useEffect(() => {
    if (dirty) return;
    setDisplayName(user?.displayName ?? '');
    setBio(user?.bio ?? '');
    setTag(serverTag);
  }, [dirty, serverTag, user?.bio, user?.displayName]);

  const previewName = displayName.trim() || publicDisplayName(null, user?.email);
  const previewTag = tag.trim().replace(/^#+/u, '').replace(/\s+/g, '');

  async function addRandomTag() {
    setSuggesting(true);
    try {
      const { tag: suggested } = await api.suggestTag(previewName);
      setDirty(true);
      setTag(suggested);
    } catch (err) {
      toast.error((err as Error).message || t('profile.tagFailed'));
    } finally {
      setSuggesting(false);
    }
  }

  async function saveProfile() {
    if (previewTag && !/^[\p{L}\p{N}]{2,16}$/u.test(previewTag)) {
      toast.error(t('profile.tagInvalid'));
      return;
    }
    setSaving(true);
    try {
      const saved = await api.updateProfile({
        displayName,
        bio,
        ...(previewTag ? { tags: [previewTag] } : {}),
      });
      patchUser({
        displayName: saved.displayName,
        bio: saved.bio,
        tags: saved.tags,
      });
      setDisplayName(saved.displayName ?? '');
      setBio(saved.bio ?? '');
      setTag(saved.tags[0] ?? previewTag);
      setDirty(false);
      await refreshMe();
      toast.success(t('profile.saved'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const payload = err.payload as {
          tag?: string;
          handle?: string;
          displayName?: string | null;
          bio?: string | null;
        } | null;
        if (payload && ('displayName' in payload || 'bio' in payload)) {
          patchUser({
            displayName: payload.displayName ?? null,
            bio: payload.bio ?? null,
          });
          setDisplayName(payload.displayName ?? '');
          setBio(payload.bio ?? '');
        }
        await refreshMe();
        const taken = payload?.handle || (payload?.tag ? `#${payload.tag}` : '');
        toast.error(t('profile.tagTaken', { tag: taken }));
      } else {
        toast.error((err as Error).message || t('profile.saveFailed'));
      }
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
              onChange={(event) => {
                setDirty(true);
                setDisplayName(event.target.value);
              }}
              placeholder={publicDisplayName(null, user?.email)}
            />
            <div className="space-y-2">
              <span className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
                {t('profile.tag')}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-[10rem] flex-1 items-center border border-border-subtle bg-bg-surface focus-within:border-primary">
                  <span className="pl-3 font-mono text-sm text-text-muted">#</span>
                  <input
                    value={tag}
                    maxLength={16}
                    placeholder="LAS"
                    onChange={(event) => {
                      setDirty(true);
                      setTag(event.target.value.replace(/^#+/u, '').replace(/\s+/g, ''));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void saveProfile();
                      }
                    }}
                    className="h-10 w-full bg-transparent px-2 font-mono text-sm text-text-primary outline-none placeholder:text-text-disabled"
                  />
                </div>
                <Button type="button" size="sm" variant="ghost" disabled={suggesting} onClick={() => void addRandomTag()}>
                  {suggesting ? t('profile.tagSuggesting') : t('profile.tagRandom')}
                </Button>
              </div>
              <ProfileTags name={previewName} tags={previewTag ? [previewTag] : []} className="text-sm font-semibold" />
              <p className="text-[11px] text-text-disabled">{t('profile.tagHint')}</p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
                {t('profile.bio')}
              </span>
              <textarea
                value={bio}
                maxLength={160}
                rows={3}
                onChange={(event) => {
                  setDirty(true);
                  setBio(event.target.value);
                }}
                placeholder={t('profile.bioPlaceholder')}
                className="w-full border border-border-subtle bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus-visible:border-primary"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void saveProfile()} disabled={saving}>
                {saving ? t('common.save') + '…' : t('profile.save')}
              </Button>
              <Link to="/dashboard/perfil" className="text-sm font-medium text-primary">
                {t('trader.open')}
              </Link>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold mb-3">{t('settings.sectionAccount')}</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-text-muted uppercase tracking-wider text-2xs">{t('settings.account.email')}</dt>
          <dd className="font-mono text-text-secondary">{user?.email}</dd>
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

      <NotificationsCard
        initial={user?.notifications ?? DEFAULT_NOTIFICATION_PREFS}
        onSaved={refreshMe}
      />

      {user?.hasGrvtCreds && <SubAccountsCard />}

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

function NotificationsCard({
  initial,
  onSaved,
}: {
  initial: NotificationPrefs;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrefs(initial);
  }, [initial]);

  async function persist(next: NotificationPrefs) {
    setPrefs(next);
    setSaving(true);
    try {
      await api.updateNotifications(next);
      await onSaved();
      toast.success(t('settings.alerts.saved'));
    } catch (err) {
      toast.error((err as Error).message || t('settings.alerts.saveFailed'));
      setPrefs(initial);
    } finally {
      setSaving(false);
    }
  }

  function toggle<K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) {
    void persist({ ...prefs, [key]: value });
  }

  return (
    <Card>
      <p className="font-mono text-[10px] tracking-[.18em] text-primary">{t('settings.alerts.kicker')}</p>
      <h2 className="mt-2 text-lg font-semibold tracking-tight">{t('settings.alerts.title')}</h2>
      <p className="mt-2 text-sm leading-6 text-text-muted">{t('settings.alerts.subtitle')}</p>

      <label className="mt-5 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={prefs.emailsEnabled}
          disabled={saving}
          onChange={(event) => toggle('emailsEnabled', event.target.checked)}
        />
        <span>
          <span className="font-medium text-text-primary">{t('settings.alerts.master')}</span>
          <span className="mt-0.5 block text-xs text-text-muted">{t('settings.alerts.masterHint')}</span>
        </span>
      </label>

      <div className={`mt-4 space-y-3 ${prefs.emailsEnabled ? '' : 'opacity-50'}`}>
        <AlertToggle
          label={t('settings.alerts.profit')}
          hint={t('settings.alerts.profitHint')}
          checked={prefs.profitMilestones}
          disabled={saving || !prefs.emailsEnabled}
          onChange={(checked) => toggle('profitMilestones', checked)}
        />
        {prefs.emailsEnabled && prefs.profitMilestones && (
          <label className="flex items-center gap-3 pl-7 text-sm">
            <span className="text-text-muted">{t('settings.alerts.profitPct')}</span>
            <input
              type="number"
              min={1}
              max={25}
              step={1}
              value={prefs.profitMilestonePct}
              disabled={saving}
              onChange={(event) => {
                const n = Number(event.target.value);
                setPrefs({ ...prefs, profitMilestonePct: n });
              }}
              onBlur={() => {
                if (prefs.profitMilestonePct !== initial.profitMilestonePct) {
                  void persist(prefs);
                }
              }}
              className="w-16 border border-border-subtle bg-bg-surface px-2 py-1 text-sm text-text-primary outline-none focus-visible:border-primary"
            />
            <span className="text-text-muted">%</span>
          </label>
        )}
        <AlertToggle
          label={t('settings.alerts.drawdown')}
          hint={t('settings.alerts.drawdownHint')}
          checked={prefs.drawdown}
          disabled={saving || !prefs.emailsEnabled}
          onChange={(checked) => toggle('drawdown', checked)}
        />
        <AlertToggle
          label={t('settings.alerts.liq')}
          hint={t('settings.alerts.liqHint')}
          checked={prefs.liqProximity}
          disabled={saving || !prefs.emailsEnabled}
          onChange={(checked) => toggle('liqProximity', checked)}
        />
        <AlertToggle
          label={t('settings.alerts.status')}
          hint={t('settings.alerts.statusHint')}
          checked={prefs.statusChanges}
          disabled={saving || !prefs.emailsEnabled}
          onChange={(checked) => toggle('statusChanges', checked)}
        />
        <AlertToggle
          label={t('settings.alerts.daily')}
          hint={t('settings.alerts.dailyHint')}
          checked={prefs.dailySummary}
          disabled={saving || !prefs.emailsEnabled}
          onChange={(checked) => toggle('dailySummary', checked)}
        />
      </div>
    </Card>
  );
}

function AlertToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="font-medium text-text-primary">{label}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{hint}</span>
      </span>
    </label>
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
