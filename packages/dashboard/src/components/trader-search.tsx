import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { communityAvatarUrl } from '@/lib/avatar';
import { presetFromCopy } from '@/lib/community-preset';
import { formatPercent, formatPnl } from '@/lib/format';
import type { TraderSearchHit } from '@/lib/api-types';
import { UserAvatar } from '@/components/user-avatar';
import { ProfileTags } from '@/components/profile-tags';
import { useT } from '@/i18n';

export function TraderSearch() {
  const t = useT();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<TraderSearchHit[]>([]);
  const [copying, setCopying] = useState<number | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      api.searchTraders(trimmed)
        .then((data) => setHits(data.traders))
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  async function copyBot(id: number, handle: string) {
    setCopying(id);
    try {
      const result = await api.copyLeaderBot(id);
      toast.success(t('community.copiedToast', { name: handle }));
      setOpen(false);
      navigate('/dashboard', {
        state: {
          presetWizard: presetFromCopy(result.bot, {
            rangeAdapted: result.rangeAdapted,
            originalRange: result.originalRange,
            markPrice: result.markPrice,
          }),
        },
      });
    } catch (err) {
      toast.error((err as Error).message || t('community.copyFailed'));
    } finally {
      setCopying(null);
    }
  }

  const show = open && query.trim().length >= 2;

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 max-w-[9.5rem] sm:max-w-md">
      <label className="flex h-9 items-center gap-2 border border-border-subtle bg-bg-surface px-2 focus-within:border-primary">
        <Search className="size-3.5 shrink-0 text-text-disabled" />
        <input
          value={query}
          placeholder={t('community.searchPlaceholder')}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="w-full bg-transparent font-mono text-xs text-text-primary outline-none placeholder:text-text-disabled"
        />
      </label>
      {show && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 border border-border-subtle bg-bg-elevated shadow-lg">
          {loading && hits.length === 0 ? (
            <p className="px-3 py-3 text-xs text-text-muted">{t('common.loading')}</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-xs text-text-muted">{t('community.searchEmpty')}</p>
          ) : (
            <ul>
              {hits.map((hit) => (
                <li key={hit.id} className="border-b border-border-subtle last:border-0">
                  <div className="flex items-start gap-3 px-3 py-3">
                    <Link
                      to={`/dashboard/perfil/${hit.id}`}
                      onClick={() => setOpen(false)}
                      className="flex min-w-0 flex-1 items-start gap-3 hover:text-primary"
                    >
                      <UserAvatar
                        name={hit.name}
                        email=""
                        src={communityAvatarUrl(hit.id, hit.hasAvatar, hit.avatarUpdatedAt)}
                        size="sm"
                      />
                      <span className="min-w-0">
                        <ProfileTags
                          name={hit.name}
                          tags={[hit.tag]}
                          className="text-sm font-medium"
                          tagClassName="text-[11px]"
                        />
                        <span className="mt-1 block text-[11px] text-text-muted">
                          {t('community.searchRunning', { count: hit.runningBots })}
                        </span>
                      </span>
                    </Link>
                  </div>
                  {hit.published.length > 0 && (
                    <ul className="border-t border-border-subtle">
                      {hit.published.map((bot) => (
                        <li key={bot.id} className="flex items-center justify-between gap-3 px-3 py-2">
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium">{bot.title}</span>
                            <span className="font-mono text-[10px] text-text-muted">
                              {bot.pair} · {formatPnl(bot.pnlUsdt)} · {formatPercent(bot.pnlPct)}
                            </span>
                          </span>
                          <button
                            type="button"
                            disabled={copying === bot.id}
                            onClick={() => void copyBot(bot.id, hit.handle)}
                            className="shrink-0 text-xs font-medium text-primary disabled:opacity-50"
                          >
                            {t('community.copy')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
