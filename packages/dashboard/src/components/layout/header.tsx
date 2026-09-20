import { cn } from '@/lib/cn';
import { BrandMark } from '@/components/brand-mark';
import { useWsStatus } from '@/lib/use-ws-channel';
import type { WsStatus } from '@/lib/ws-client';
import { LanguageToggle } from '@/i18n';
import { ThemeToggle } from '@/components/theme-toggle';

const STATUS_KEY: Record<WsStatus, { color: string; key: string }> = {
  open: { color: 'text-success', key: 'wsLive' },
  connecting: { color: 'text-warning', key: 'wsConnecting' },
  closed: { color: 'text-text-muted', key: 'wsOffline' },
  error: { color: 'text-danger', key: 'wsError' },
};

const WS_LABELS_FALLBACK: Record<string, string> = {
  wsLive: 'Live',
  wsConnecting: 'Connecting',
  wsOffline: 'Offline',
  wsError: 'Error',
};

export function Header() {
  const status = useWsStatus();
  const styles = STATUS_KEY[status];

  return (
    <header
      className={cn(
        'flex items-center gap-4',
        'h-14 shrink-0 px-4 md:px-6',
        'bg-bg-surface border-b border-border-subtle'
      )}
    >
      <BrandMark compact />

      <div className="flex-1" />

      <div
        className={cn(
          'flex items-center gap-1.5 text-xs font-medium',
          styles.color
        )}
        title={`WebSocket: ${status}`}
        role="status"
        aria-live="polite"
      >
        <span
          className={cn(
            'inline-block size-2 rounded-full bg-current',
            status === 'open' && 'pulse-slow'
          )}
          aria-hidden="true"
        />
        {WS_LABELS_FALLBACK[styles.key]}
      </div>

      <LanguageToggle variant="compact" className="ml-2" />

      <ThemeToggle className="ml-1" />
    </header>
  );
}
