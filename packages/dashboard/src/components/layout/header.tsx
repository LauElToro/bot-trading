import { Menu } from 'lucide-react';
import { cn } from '@/lib/cn';
import { BrandMark } from '@/components/brand-mark';
import { Link } from 'react-router-dom';
import { useWsStatus } from '@/lib/use-ws-channel';
import type { WsStatus } from '@/lib/ws-client';
import { LanguageToggle, useT } from '@/i18n';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/lib/auth-context';
import { UserAvatar } from '@/components/user-avatar';
import { communityAvatarUrl } from '@/lib/avatar';
import { TraderSearch } from '@/components/trader-search';

const STATUS_KEY: Record<WsStatus, { color: string; key: string }> = {
  open: { color: 'text-success', key: 'wsLive' },
  connecting: { color: 'text-warning', key: 'wsConnecting' },
  closed: { color: 'text-text-muted', key: 'wsOffline' },
  error: { color: 'text-danger', key: 'wsError' },
};

export function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const t = useT();
  const { user } = useAuth();
  const status = useWsStatus();
  const styles = STATUS_KEY[status];

  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-bg-base/90 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 md:px-6">
        <button
          type="button"
          onClick={onOpenNav}
          className="grid size-8 place-items-center border border-border-subtle text-text-secondary hover:border-primary hover:text-primary lg:hidden"
        >
          <Menu className="size-4" />
          <span className="sr-only">{t('nav.menu')}</span>
        </button>

        <Link to="/dashboard" className="lg:hidden" aria-label="Toro dashboard">
          <BrandMark compact />
        </Link>

        <p className="hidden font-mono text-[10px] tracking-[.2em] text-text-disabled lg:block">
          {t('nav.controlCenter')}
        </p>

        <TraderSearch />

        <div className="ml-auto flex items-center gap-2">
          <div
            className={cn(
              'hidden items-center gap-1.5 font-mono text-[10px] tracking-[.14em] sm:flex',
              styles.color,
            )}
            title={`WebSocket: ${status}`}
            role="status"
            aria-live="polite"
          >
            <span
              className={cn(
                'inline-block size-1.5 rounded-full bg-current',
                status === 'open' && 'pulse-slow',
              )}
              aria-hidden="true"
            />
            {t(`header.${styles.key}` as 'header.wsLive')}
          </div>
          {user && (
            <Link to="/dashboard/perfil" aria-label={t('nav.profile')} className="ml-1">
              <UserAvatar
                name={user.displayName}
                email={user.email}
                src={communityAvatarUrl(user.id, user.hasAvatar, user.avatarUpdatedAt)}
                size="sm"
              />
            </Link>
          )}
          <LanguageToggle variant="compact" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
