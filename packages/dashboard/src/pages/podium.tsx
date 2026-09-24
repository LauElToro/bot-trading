import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { communityAvatarUrl } from '@/lib/avatar';
import type { CommunityBot, WizardPreset } from '@/lib/api-types';
import { formatPercent, formatPnl, formatUsd } from '@/lib/format';
import { pairParts } from '@/lib/pair';
import { RangeBar } from '@/components/range-bar';
import { PageHeader } from '@/components/page-header';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/primitives/button';
import { Card } from '@/components/primitives/card';
import { formatPublicHandle, ProfileTags } from '@/components/profile-tags';
import { presetFromCopy } from '@/lib/community-preset';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';

type PodiumTab = 'active' | 'finished';

function toPreset(
  bot: CommunityBot,
  extra?: {
    rangeAdapted?: boolean;
    originalRange?: { lower: number; upper: number };
    markPrice?: number | null;
  },
): WizardPreset {
  return presetFromCopy(bot, extra);
}

function formatDuration(
  ms: number | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return t('community.durationUnknown');
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  if (totalMinutes < 60) return t('community.durationMinutes', { n: totalMinutes });
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 48) return t('community.durationHours', { n: hours, m: minutes });
  const days = Math.floor(hours / 24);
  return t('community.durationDays', { n: days, h: hours % 24 });
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
  const [chosenTab, setChosenTab] = useState<PodiumTab | null>(null);

  async function handleCopy(bot: CommunityBot) {
    if (bot.isAuthorTotal) return;
    try {
      const result = await api.copyLeaderBot(bot.id);
      void queryClient.invalidateQueries({ queryKey: ['community-leaders'] });
      toast.success(t('community.copiedToast', { name: formatPublicHandle(bot.author.name, bot.author.tags) }));
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
  const strategies = bots.filter((bot) => !bot.isAuthorTotal && bot.liveStatus !== 'aggregate');
  const running = strategies.filter((bot) => bot.liveStatus === 'running');
  const paused = strategies.filter((bot) => bot.liveStatus === 'paused');
  const finished = strategies.filter(
    (bot) => bot.liveStatus !== 'running' && bot.liveStatus !== 'paused',
  );
  const aggregates = bots.filter((bot) => bot.isAuthorTotal || bot.liveStatus === 'aggregate');
  const tab: PodiumTab = chosenTab ?? (running.length > 0 ? 'active' : 'finished');
  const podiumBots = tab === 'active' ? running : finished;
  const top = podiumBots.slice(0, 3);
  const rest = podiumBots.slice(3);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t('community.eyebrow')}
        title={t('community.title')}
        subtitle={t('community.subtitle')}
        action={
          <PodiumSwitch
            tab={tab}
            activeCount={running.length}
            finishedCount={finished.length}
            onChange={setChosenTab}
          />
        }
      />

      {leadersQuery.isPending ? (
        <div className="h-80 animate-pulse border border-border-subtle bg-bg-elevated" />
      ) : strategies.length === 0 && aggregates.length === 0 ? (
        <Card>
          <p className="font-mono text-[10px] tracking-[.18em] text-primary">{t('community.emptyKicker')}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-.03em]">{t('community.emptyTitle')}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-text-muted">{t('community.emptyBody')}</p>
        </Card>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            {tab === 'active' ? t('community.tabHintActive') : t('community.tabHintFinished')}
          </p>

          {podiumBots.length === 0 ? (
            <Card>
              <p className="text-sm text-text-muted">
                {tab === 'active' ? t('community.activeEmpty') : t('community.finishedEmpty')}
              </p>
            </Card>
          ) : (
            <PodiumStage bots={top} onCopy={handleCopy} />
          )}

          {rest.length > 0 && (
            <section>
              <p className="mb-3 font-mono text-[10px] tracking-[.18em] text-text-disabled">
                {t('community.restHeading')}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {rest.map((bot, index) => (
                  <StrategyCard
                    key={bot.id}
                    bot={bot}
                    place={index + 4}
                    onCopy={() => handleCopy(bot)}
                  />
                ))}
              </div>
            </section>
          )}

          {tab === 'active' && paused.length > 0 && (
            <section>
              <p className="mb-3 font-mono text-[10px] tracking-[.18em] text-text-disabled">
                {t('community.pausedTitle')}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {paused.map((bot, index) => (
                  <StrategyCard
                    key={bot.id}
                    bot={bot}
                    place={index + 1}
                    onCopy={() => handleCopy(bot)}
                  />
                ))}
              </div>
            </section>
          )}

          {tab === 'finished' && aggregates.map((bot) => (
            <div
              key={bot.id}
              className="flex flex-wrap items-center justify-between gap-3 border border-border-subtle bg-bg-elevated px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold">{bot.title}</p>
                <p className="text-xs text-text-muted">
                  <Link
                    to={`/dashboard/perfil/${bot.author.id}`}
                    className="hover:text-primary"
                  >
                    {t('community.authorTotalBy', { name: formatPublicHandle(bot.author.name, bot.author.tags) })}
                  </Link>
                </p>
              </div>
              <p className={`font-mono text-lg ${bot.pnlPct >= 0 ? 'text-success' : 'text-danger'}`}>
                {formatPercent(bot.pnlPct)}
              </p>
            </div>
          ))}
        </>
      )}

      <p className="text-[11px] leading-5 text-text-disabled">{t('community.disclaimer')}</p>
    </div>
  );
}

function PodiumSwitch({
  tab,
  activeCount,
  finishedCount,
  onChange,
}: {
  tab: PodiumTab;
  activeCount: number;
  finishedCount: number;
  onChange: (tab: PodiumTab) => void;
}) {
  const t = useT();
  const options: Array<{ id: PodiumTab; label: string; count: number }> = [
    { id: 'active', label: t('community.tabActive'), count: activeCount },
    { id: 'finished', label: t('community.tabFinished'), count: finishedCount },
  ];
  return (
    <div className="inline-flex border border-border-default bg-bg-base p-1" role="tablist">
      {options.map((option) => {
        const on = tab === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(option.id)}
            className={cn(
              'h-9 px-4 text-sm font-semibold transition-colors',
              on ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {option.label}
            <span className={cn('ml-2 font-mono text-[11px]', on ? 'text-white/80' : 'text-text-disabled')}>
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PodiumStage({
  bots,
  onCopy,
}: {
  bots: CommunityBot[];
  onCopy: (bot: CommunityBot) => void;
}) {
  if (bots.length === 1) {
    return (
      <div className="mx-auto w-full max-w-xl">
        <StrategyCard bot={bots[0]!} place={1} featured onCopy={() => onCopy(bots[0]!)} />
      </div>
    );
  }

  const visual = bots.length >= 3 ? [bots[1], bots[0], bots[2]] : [bots[1], bots[0]];
  return (
    <div
      className={cn(
        'grid items-end gap-4',
        visual.length === 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2',
      )}
    >
      {visual.map((bot) => {
        if (!bot) return null;
        const place = bots.indexOf(bot) + 1;
        return (
          <div key={bot.id} className={cn(place === 1 && visual.length === 3 && 'lg:-mt-6')}>
            <StrategyCard
              bot={bot}
              place={place}
              featured={place === 1}
              onCopy={() => onCopy(bot)}
            />
            <div
              className={cn(
                'mx-auto bg-primary',
                place === 1 ? 'h-3 w-full' : 'h-1.5 w-4/5 opacity-50',
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

function StrategyCard({
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
  const positive = bot.pnlPct >= 0;
  const flat = bot.pnlPct === 0 && bot.pnlUsdt === 0;
  const clock = formatDuration(bot.durationMs, t);
  const duration =
    bot.liveStatus === 'running' && bot.durationMs != null
      ? t('community.durationLive', { time: clock })
      : clock;
  const placeLabel =
    place === 1 ? t('community.first') : place === 2 ? t('community.second') : place === 3 ? t('community.third') : String(place).padStart(2, '0');
  const { asset, market } = pairParts(bot.pair);
  const titleIsPair = bot.title.replace(/[\s_-]/g, '').toLowerCase() === bot.pair.replace(/[\s_-]/g, '').toLowerCase();
  const long = bot.direction === 'long';

  return (
    <article
      className={cn(
        'relative flex h-full flex-col overflow-hidden border bg-bg-base',
        featured ? 'border-primary' : 'border-border-subtle',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 w-1',
          flat ? 'bg-border-strong' : positive ? 'bg-success' : 'bg-danger',
        )}
      />
      <div className="flex h-full flex-col p-5 pl-6">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] tracking-[.18em] text-primary">{placeLabel}</span>
          <span className="flex items-center gap-2">
            <LiveMark status={bot.liveStatus} />
            {featured && <Trophy className="size-4 text-primary" />}
          </span>
        </div>

        <Link
          to={`/dashboard/perfil/${bot.author.id}`}
          aria-label={t('community.openProfile', { name: formatPublicHandle(bot.author.name, bot.author.tags) })}
          className="mt-4 flex items-center gap-3 hover:text-primary"
        >
          <UserAvatar
            name={bot.author.name}
            src={communityAvatarUrl(bot.author.id, bot.author.hasAvatar, bot.author.avatarUpdatedAt)}
            size={featured ? 'lg' : 'md'}
          />
          <div className="min-w-0">
            <ProfileTags
              name={bot.author.name}
              tags={bot.author.tags}
              className="text-sm font-semibold"
              tagClassName="text-[11px]"
            />
          </div>
        </Link>

        <div className="mt-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className={cn('font-semibold tracking-tight', featured ? 'text-3xl' : 'text-2xl')}>{asset}</h3>
            <p className="font-mono text-[10px] tracking-wider text-text-muted">{market}</p>
            {!titleIsPair && (
              <p className="mt-1 truncate text-sm text-text-secondary">{bot.title}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                'border px-2 py-0.5 font-mono text-[10px] tracking-wider',
                long ? 'border-success text-success' : 'border-danger text-danger',
              )}
            >
              {long ? 'LONG' : 'SHORT'}
            </span>
            <span className="font-mono text-[10px] tracking-wider text-text-muted">{bot.leverage}x</span>
          </div>
        </div>

        <div className={cn('mt-4 px-3 py-3', flat ? 'bg-bg-muted' : positive ? 'bg-success/10' : 'bg-danger/10')}>
          <p className="text-2xs uppercase tracking-wider text-text-muted">{t('community.statResult')}</p>
          <p
            className={cn(
              'font-mono tracking-tight',
              featured ? 'text-4xl' : 'text-3xl',
              flat ? 'text-text-primary' : positive ? 'text-success' : 'text-danger',
            )}
          >
            {formatPercent(bot.pnlPct)}
          </p>
          <p className={cn('mt-1 font-mono text-sm', flat ? 'text-text-secondary' : positive ? 'text-success' : 'text-danger')}>
            {formatPnl(bot.pnlUsdt)}
            <span className="text-text-muted"> · {formatUsd(bot.investmentUsdt)}</span>
          </p>
        </div>

        <p className="mt-3 text-xs text-text-secondary">
          {t('community.cardMeta', {
            levels: bot.numGrids,
            copies: bot.copiesCount,
            time: duration,
          })}
        </p>

        <div className="mt-3">
          <RangeBar lower={bot.lowerPrice} upper={bot.upperPrice} />
        </div>
        <p className="mt-2 text-[11px] leading-5 text-text-disabled">{t('community.rangeAdapts')}</p>

        <div className="mt-auto pt-5">
          <Button className="w-full" onClick={onCopy}>
            <Copy className="size-3.5" />
            {t('community.copy')}
          </Button>
        </div>
      </div>
    </article>
  );
}

function LiveMark({ status }: { status: CommunityBot['liveStatus'] }) {
  const t = useT();
  const label =
    status === 'running'
      ? t('community.liveRunning')
      : status === 'paused'
        ? t('community.livePaused')
        : status === 'aggregate'
          ? null
          : t('community.liveClosed');
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-text-secondary">
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'running' ? 'bg-primary' : status === 'paused' ? 'bg-text-muted' : 'bg-text-disabled',
        )}
      />
      {label}
    </span>
  );
}
