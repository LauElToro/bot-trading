import {
  Bot,
  Compass,
  Crown,
  Orbit,
  Radar,
  SlidersHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AppNavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
}

export const APP_NAV: AppNavItem[] = [
  { to: '/dashboard', labelKey: 'nav.overview', icon: Radar, end: true },
  { to: '/dashboard/bots', labelKey: 'nav.bots', icon: Bot },
  { to: '/dashboard/podio', labelKey: 'nav.podium', icon: Crown },
  { to: '/dashboard/guia', labelKey: 'nav.guide', icon: Compass },
  { to: '/dashboard/backtest', labelKey: 'nav.backtest', icon: Orbit },
  { to: '/dashboard/settings', labelKey: 'nav.settings', icon: SlidersHorizontal },
];
