import { Link, NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { BrandMark } from '@/components/brand-mark';
import { UserAvatar } from '@/components/user-avatar';
import { communityAvatarUrl, publicDisplayName } from '@/lib/avatar';
import { useAuth } from '@/lib/auth-context';
import { GRVT_REFERRAL_URL } from '@/lib/brand';
import { useT } from '@/i18n';
import { APP_NAV } from './nav-items';

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const displayName = publicDisplayName(user?.displayName, user?.email);

  return (
    <>
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/55 lg:hidden',
          open ? 'block' : 'hidden',
        )}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[17.5rem] flex-col text-white',
          'bg-[#101114] lg:static lg:z-auto',
          'transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="pointer-events-none absolute inset-0 opacity-[.09] [background-image:linear-gradient(#dc2626_1px,transparent_1px),linear-gradient(90deg,#dc2626_1px,transparent_1px)] [background-size:52px_52px]" />

        <div className="relative flex items-center justify-between px-5 py-5">
          <Link to="/dashboard" onClick={onClose} aria-label="Toro dashboard">
            <BrandMark compact inverted />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center border border-white/15 text-white/70 hover:text-white lg:hidden"
          >
            <X className="size-4" />
            <span className="sr-only">{t('common.close')}</span>
          </button>
        </div>

        <p className="relative px-5 pb-3 font-mono text-[10px] tracking-[.22em] text-[#f87171]">
          {t('nav.controlCenter')}
        </p>

        <nav aria-label="Main navigation" className="relative flex-1 overflow-y-auto border-t border-white/10">
          {APP_NAV.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 border-b border-white/10 px-5 py-3.5 transition-colors',
                  isActive ? 'bg-white/[.06] text-white' : 'text-[#a1a1aa] hover:bg-white/[.04] hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'w-6 font-mono text-[10px] tracking-wider',
                      isActive ? 'text-[#f87171]' : 'text-[#71717a]',
                    )}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center border transition-colors',
                      isActive
                        ? 'border-[#f87171] bg-[#f87171]/15 text-[#f87171] shadow-[0_0_16px_rgba(248,113,113,.35)]'
                        : 'border-white/10 bg-white/[.03] text-[#d4d4d8] group-hover:border-white/25',
                    )}
                  >
                    <item.icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="text-sm font-medium">{t(item.labelKey)}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="relative border-t border-white/10 px-5 py-4">
          {user && (
            <Link
              to="/dashboard/settings"
              onClick={onClose}
              className="flex items-center gap-3 py-1"
            >
              <UserAvatar
                name={user.displayName}
                email={user.email}
                src={communityAvatarUrl(user.id, user.hasAvatar, user.avatarUpdatedAt)}
                size="sm"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{displayName}</div>
                <div className="truncate font-mono text-[10px] text-[#71717a]">{user.email}</div>
              </div>
            </Link>
          )}
          <a
            href={GRVT_REFERRAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 block font-mono text-[10px] tracking-wide text-[#f87171] hover:underline"
          >
            {t('nav.referral')}
          </a>
        </div>
      </aside>
    </>
  );
}
