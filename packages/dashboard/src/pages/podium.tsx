import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Copy, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { communityAvatarUrl } from '@/lib/avatar';
import type { CommunityBot, WizardPreset } from '@/lib/api-types';
import { formatPercent, formatPnl, formatUsd } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/primitives/button';
import { Card } from '@/components/primitives/card';
import { useT } from '@/i18n';

function toPreset(
  bot: CommunityBot,
  extra?: {
    rangeAdapted?: boolean;
    originalRange?: { lower: number; upper: number };
    markPrice?: number | null;
  },
): WizardPreset {
  return {
    pair: bot.pair,
    direction: bot.direction,
    leverage: bot.leverage,
    lower_price: bot.lowerPrice,
    upper_price: bot.upperPrice,
    num_grids: bot.numGrids,
    investment_usdt: bot.investmentUsdt,
    virtual_enabled: bot.virtualEnabled,
    active_window_size: bot.activeWindowSize ?? undefined,
    sl_pct: bot.slPct ?? undefined,
    tp_pct: bot.tpPct ?? undefined,
    auto_shift_enabled: bot.autoShiftEnabled,
    auto_shift_pct: bot.autoShiftPct ?? undefined,
    compound_pct: bot.compoundPct ?? undefined,
    copiedFrom: {
      publishedId: bot.id,
      authorName: bot.author.name,
      rangeAdapted: extra?.rangeAdapted,
      originalLower: extra?.originalRange?.lower,
      originalUpper: extra?.originalRange?.upper,
      markPrice: extra?.markPrice ?? undefined,
    },
  };
}

export function PodiumPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const leadersQuery = useQuery({
    queryKey: ['community-leaders'],
    queryFn: () => api.getLeaders(),
    staleTime: 15_000,
  });

  async function handleCopy(bot: CommunityBot) {
    if (bot.isAuthorTotal) return;
    try {
      const result = await api.copyLeaderBot(bot.id);
      void queryClient.invalidateQueries({ queryKey: ['community-leaders'] });
      toast.success(t('community.copiedToast', { name: bot.author.name }));
      navigate('/dashboard', {
        state: {
          presetWizard: toPreset(result.bot, {
            rangeAdapted: result.rangeAdapted,
            originalRange: result.originalRange,
            markPrice: result.markPrice,
          }),
        },
      });
    } catch (err) {
      toast.error((err as Error).message || t('community.copyFailed'));
    }
  }

  const bots = leadersQuery.data?.bots ?? [];
  const top = bots.slice(0, 3);
  const rest = bots.slice(3);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t('community.eyebrow')}
        title={t('community.title')}
        subtitle={t('community.subtitle')}
      />

      {leadersQuery.isPending ? (
        <div className="h-64 animate-pulse border border-border-subtle bg-bg-elevated" />
      ) : bots.length === 0 ? (
        <Card>
          <p className="font-mono text-[10px] tracking-[.18em] text-primary">{t('community.emptyKicker')}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-.03em]">{t('community.emptyTitle')}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-text-muted">{t('community.emptyBody')}</p>
        </Card>
      ) : (
        <>
          <section className="grid gap-px border border-border-subtle bg-border-subtle lg:grid-cols-3">
            {([top[1], top[0], top[2]] as Array<CommunityBot | undefined>).map((bot, visualIndex) => {
              const place = visualIndex === 1 ? 1 : visualIndex === 0 ? 2 : 3;
              if (!bot) {
                return (
                  <div key={`empty-${place}`} className="min-h-56 bg-bg-base p-5">
                    <p className="font-mono text-[10px] text-text-disabled">0{place}</p>
                    <p className="mt-6 text-sm text-text-disabled">{t('community.slotEmpty')}</p>
                  </div>
                );
              }
              return (
                <PodiumCard
                  key={bot.id}
                  bot={bot}
                  place={place}
                  featured={place === 1}
                  onCopy={() => handleCopy(bot)}
                />
              );
            })}
          </section>

          {rest.length > 0 && (
            <section>
              <p className="mb-3 font-mono text-[10px] tracking-[.18em] text-text-disabled">
                {t('community.restTitle')}
              </p>
              <ol className="border-t border-border-default">
                {rest.map((bot) => (
                  <li
                    key={bot.id}
                    className="grid gap-3 border-b border-border-subtle py-4 md:grid-cols-[3rem_1fr_auto] md:items-center"
                  >
                    <span className="font-mono text-xs text-primary">
                      {String(bot.rank).padStart(2, '0')}
                    </span>
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar
                        name={bot.author.name}
                        src={communityAvatarUrl(bot.author.id, bot.author.hasAvatar)}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{bot.title}</div>
                        <div className="text-xs text-text-muted">
                          {bot.isAuthorTotal
                            ? t('community.authorTotalBy', { name: bot.author.name })
                            : `${t('community.by', { name: bot.author.name })} · ${bot.pair.replace(/_/g, ' ')} · ${bot.leverage}x`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`font-mono text-sm ${bot.pnlPct >= 0 ? 'text-success' : 'text-danger'}`}>
                        {formatPercent(bot.pnlPct)}
                      </span>
                      {bot.isAuthorTotal ? (
                        <span className="hidden font-mono text-[10px] text-text-disabled sm:inline">
                          {t('community.authorTotal')}
                        </span>
                      ) : (
                        <>
                          <span className="hidden font-mono text-[10px] text-text-disabled sm:inline">
                            {t('community.copies', { count: bot.copiesCount })}
                          </span>
                          <Button size="sm" variant="secondary" onClick={() => handleCopy(bot)}>
                            <Copy className="size-3.5" />
                            {t('community.copy')}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}

      <p className="text-[11px] leading-5 text-text-disabled">{t('community.disclaimer')}</p>
    </div>
  );
}

function PodiumCard({
  bot,
  place,
  featured,
  onCopy,
}: {
  bot: CommunityBot;
  place: number;
  featured?: boolean;
  onCopy: () => void;
}) {
  const t = useT();
  return (
    <div className={`bg-bg-base p-5 ${featured ? 'lg:-mt-3 lg:mb-[-12px] lg:shadow-lg' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[.18em] text-primary">
          {place === 1 ? t('community.first') : place === 2 ? t('community.second') : t('community.third')}
        </span>
        {place === 1 && <Trophy className="size-4 text-primary" />}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <UserAvatar
          name={bot.author.name}
          src={communityAvatarUrl(bot.author.id, bot.author.hasAvatar)}
          size={featured ? 'lg' : 'md'}
        />
        <div>
          <div className="text-sm font-semibold">{bot.author.name}</div>
          <div className="text-[11px] text-text-muted">{bot.pair.replace(/_/g, ' ')}</div>
        </div>
      </div>
      <div className={`mt-5 font-mono ${featured ? 'text-3xl' : 'text-2xl'} ${bot.pnlPct >= 0 ? 'text-success' : 'text-danger'}`}>
        {formatPercent(bot.pnlPct)}
      </div>
      <div className="mt-1 text-[11px] text-text-muted">
        {formatPnl(bot.pnlUsdt)} · {formatUsd(bot.investmentUsdt)} · {bot.numGrids} {t('community.levels')}
        {bot.rangeWidthPct != null && (
          <> · {t('community.width', { pct: `${bot.rangeWidthPct.toFixed(1)}%` })}</>
        )}
      </div>
      <p className="mt-2 font-mono text-[10px] tracking-wide text-text-disabled">
        {t('community.rangeAdapts')}
      </p>
      <p className="mt-3 text-xs leading-5 text-text-secondary">{bot.title}</p>
      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] text-text-disabled">
          {t('community.copies', { count: bot.copiesCount })}
        </span>
        <Button size="sm" onClick={onCopy}>
          <Copy className="size-3.5" />
          {t('community.copy')}
        </Button>
      </div>
    </div>
  );
}
