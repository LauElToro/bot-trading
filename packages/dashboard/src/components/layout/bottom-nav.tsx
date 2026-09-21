import { NavLink } from 'react-router-dom';
import { Hexagon, LayoutGrid, Settings, Trophy } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';
import { useT } from '@/i18n';

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.overview', icon: LayoutGrid, end: true },
  { to: '/dashboard/bots', labelKey: 'nav.bots', icon: Hexagon },
  { to: '/dashboard/podio', labelKey: 'nav.podium', icon: Trophy },
  { to: '/dashboard/settings', labelKey: 'nav.settings', icon: Settings },
];

export function BottomNav() {
  const t = useT();
  return (
    <nav
      aria-label="Mobile navigation"
      className={cn(
        'md:hidden flex',
        'fixed bottom-0 inset-x-0 h-14 z-40',
        'bg-bg-base/95 border-t border-border-subtle backdrop-blur-xl',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5',
              'text-2xs font-medium',
              isActive ? 'text-primary' : 'text-text-muted',
            )
          }
        >
          <item.icon className="size-5" aria-hidden="true" />
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
