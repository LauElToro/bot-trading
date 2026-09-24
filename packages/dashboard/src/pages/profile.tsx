import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { communityAvatarUrl, publicDisplayName } from '@/lib/avatar';
import { presetFromCopy } from '@/lib/community-preset';
import { formatPercent, formatPnl, formatUsd } from '@/lib/format';
import { ApiError, type AccountPerformance, type FollowState, type FollowingEntry, type ProfileCopier, type ProfileOwnBot, type ProfileStrategy, type TraderProfile } from '@/lib/api-types';
import { PageHeader } from '@/components/page-header';
import { UserAvatar } from '@/components/user-avatar';
import { StatCard } from '@/components/primitives/stat-card';
import { Delta } from '@/components/primitives/delta';
import { Button } from '@/components/primitives/button';
import { Card } from '@/components/primitives/card';
import { StatusPill } from '@/components/primitives/status-pill';
import { EquityCurve } from '@/components/charts/equity-curve';
import { formatPublicHandle, ProfileTags } from '@/components/profile-tags';
import { cn } from '@/lib/cn';
import { useLang, useT } from '@/i18n';
import { useState } from 'react';

function pnlClass(value: number): string {
  if (value > 0) return 'text-success';
  if (value < 0) return 'text-danger';
  return 'text-text-primary';
}

function formatWhen(ms: number | null | undefined, lang: string): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-AR' : 'en-US', {
    dateStyle: 'medium',
  }).format(new Date(ms));
}

function FollowingLine({ entry }: { entry: FollowingEntry }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(entry.copyInvestmentUsdt ? String(entry.copyInvestmentUsdt) : '');
  const [busy, setBusy] = useState(false);

  async function save(autoCopy: boolean) {
    const investmentUsdt = Number(amount);
    if (autoCopy && (!Number.isFinite(investmentUsdt) || investmentUsdt < 50)) {
      toast.error(t('trader.autoCopyNeedAmount'));
      return;
    }
    setBusy(true);
    try {
      await api.setFollowCopy(entry.id, autoCopy ? { autoCopy: true, investmentUsdt } : { autoCopy: false });
      await queryClient.invalidateQueries({ queryKey: ['trader-profile'] });
    } catch (err) {
      toast.error((err as Error).message || t('trader.followFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 border border-border-subtle p-3 sm:flex-row sm:items-center sm:justify-between">
      <Link to={`/dashboard/perfil/${entry.id}`} className="text-sm font-medium">
        {entry.name}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="w-28 border border-border-subtle bg-bg-base px-2 py-1.5 text-sm"
          inputMode="decimal"
          aria-label={t('trader.autoCopyAmount')}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Button disabled={busy} onClick={() => void save(true)}>{t('trader.autoCopySave')}</Button>
        {entry.autoCopy && (
          <Button variant="secondary" disabled={busy} onClick={() => void save(false)}>
            {t('trader.autoCopyOff')}
          </Button>
        )}
      </div>
    </li>
  );
}

export function FollowControls({ userId, follow }: { userId: string; follow: FollowState }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(follow.copyInvestmentUsdt ? String(follow.copyInvestmentUsdt) : '');
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ['public-trader', userId] });
      await queryClient.invalidateQueries({ queryKey: ['trader-profile'] });
    } catch (err) {
      toast.error((err as Error).message || t('trader.followFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!follow.following) {
    return (
      <Button disabled={busy} onClick={() => void run(() => api.followTrader(userId))}>
        {t('trader.follow')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-3 sm:items-end">
      <Button variant="secondary" disabled={busy} onClick={() => void run(() => api.unfollowTrader(userId))}>
        {t('trader.unfollow')}
      </Button>
      <div className="w-full max-w-xs border border-border-subtle bg-bg-elevated p-3 text-left">
        <p className="text-sm font-medium">{t('trader.autoCopy')}</p>
        <p className="mt-1 text-xs leading-5 text-text-muted">{t('trader.autoCopyHint')}</p>
        <label className="mt-3 block text-[10px] tracking-[.14em] text-text-muted">
          {t('trader.autoCopyAmount')}
          <input
            className="mt-1 w-full border border-border-subtle bg-bg-base px-2 py-1.5 text-sm text-text-primary"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <div className="mt-3 flex gap-2">
          <Button
            disabled={busy}
            onClick={() => {
              const investmentUsdt = Number(amount);
              if (!Number.isFinite(investmentUsdt) || investmentUsdt < 50) {
                toast.error(t('trader.autoCopyNeedAmount'));
                return;
              }
              void run(() => api.setFollowCopy(userId, { autoCopy: true, investmentUsdt }));
            }}
          >
            {t('trader.autoCopySave')}
          </Button>
          {follow.autoCopy && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => api.setFollowCopy(userId, { autoCopy: false }))}
            >
              {t('trader.autoCopyOff')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const t = useT();
  const { lang } = useLang();
  const navigate = useNavigate();
  const { userId: routeUserId } = useParams();
  const { user } = useAuth();
  const mine = !routeUserId || routeUserId === user?.id;

  const profileQuery = useQuery({
    queryKey: ['trader-profile'],
    queryFn: () => api.getTraderProfile(),
    refetchInterval: 15_000,
    enabled: mine,
  });
  const publicQuery = useQuery({
    queryKey: ['public-trader', routeUserId],
    queryFn: () => api.getPublicTrader(routeUserId!),
    enabled: !mine && Boolean(routeUserId),
    refetchInterval: 15_000,
  });

  const activeQuery = mine ? profileQuery : publicQuery;
  const profile = mine ? profileQuery.data : publicQuery.data;
  const curve = profile?.account?.points ?? (mine ? [] : publicQuery.data?.equity ?? []);
  const missing = !mine && publicQuery.error instanceof ApiError && publicQuery.error.status === 404;
  const tags = mine
    ? (profileQuery.data?.tags ?? user?.tags ?? [])
    : publicQuery.data?.tags ?? [];
  const name = mine
    ? publicDisplayName(profileQuery.data?.displayName ?? user?.displayName, user?.email)
    : publicQuery.data?.name ?? t('trader.title');
  const handle = formatPublicHandle(name, tags);
  const bio = (mine
    ? (profileQuery.data?.bio ?? user?.bio)
    : publicQuery.data?.bio)?.trim();
  const avatarSrc = mine
    ? (user ? communityAvatarUrl(user.id, user.hasAvatar, user.avatarUpdatedAt) : null)
    : (publicQuery.data
      ? communityAvatarUrl(publicQuery.data.id, publicQuery.data.hasAvatar, publicQuery.data.avatarUpdatedAt)
      : null);

  async function copyPublished(publishedId: number, author: string) {
    try {
      const result = await api.copyLeaderBot(publishedId);
      toast.success(t('community.copiedToast', { name: author }));
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
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={mine ? t('trader.eyebrow') : t('trader.publicEyebrow')}
        title={mine ? t('trader.title') : handle}
        subtitle={mine ? t('trader.subtitle') : t('trader.publicSubtitle')}
        action={
          mine ? (
            <Button variant="secondary" onClick={() => navigate('/dashboard/settings')}>
              {t('trader.edit')}
            </Button>
          ) : (
            <div className="flex flex-col items-stretch gap-3 sm:items-end">
              <FollowControls
                userId={routeUserId!}
                follow={publicQuery.data?.follow ?? { following: false, autoCopy: false, copyInvestmentUsdt: null }}
              />
              <Button variant="secondary" onClick={() => navigate('/dashboard/podio')}>
                {t('trader.backToPodium')}
              </Button>
            </div>
          )
        }
      />

      {mine && (
        <Card>
          <h2 className="text-lg font-semibold tracking-[-.03em]">{t('trader.sectionFollowing')}</h2>
          {(profileQuery.data?.following ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">{t('trader.noFollowing')}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {(profileQuery.data?.following ?? []).map((entry) => (
                <FollowingLine key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <UserAvatar
            name={name}
            email={mine ? user?.email : null}
            src={avatarSrc}
            size="xl"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold tracking-[-.03em]">
              <ProfileTags name={name} tags={tags} tagClassName="text-base font-medium" />
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-text-secondary">
              {bio || (mine ? t('trader.noBio') : t('trader.noBioPublic'))}
            </p>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <Fact
                label={t('trader.memberSince')}
                value={formatWhen(mine ? user?.createdAt : publicQuery.data?.memberSince, lang)}
              />
              {mine && (
                <>
                  <Fact label={t('trader.lastLogin')} value={formatWhen(user?.lastLoginAt, lang)} />
                  <Fact
                    label={t('trader.exchange')}
                    value={user?.hasGrvtCreds ? t('trader.grvtOn') : t('trader.grvtOff')}
                  />
                </>
              )}
            </dl>
          </div>
        </div>
      </Card>

      {activeQuery.isPending ? (
        <div className="h-48 animate-pulse border border-border-subtle bg-bg-elevated" />
      ) : missing ? (
        <Card>
          <p className="text-sm text-text-muted">{t('trader.notFound')}</p>
        </Card>
      ) : activeQuery.isError || !profile ? (
        <Card className="border-danger/40">
          <p className="text-sm text-danger">{t('trader.loadFailed')}</p>
        </Card>
      ) : (
        <ProfileBody
          profile={profile}
          curve={curve}
          linked={mine}
          onCopy={mine ? null : (publishedId) => void copyPublished(publishedId, handle)}
        />
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[.16em] text-text-disabled">{label}</dt>
      <dd className="mt-1 text-sm text-text-primary">{value}</dd>
    </div>
  );
}

function ProfileBody({
  profile,
  curve,
  linked,
  onCopy,
}: {
  profile: TraderProfile;
  curve: Array<{ date: string; equity: number }>;
  linked: boolean;
  onCopy: ((publishedId: number) => void) | null;
}) {
  const t = useT();
  const { bots, audience, account } = profile;
  const running = profile.ownBots.filter((bot) => bot.status === 'running');
  const paused = profile.ownBots.filter((bot) => bot.status === 'paused');
  const closed = profile.ownBots.filter((bot) => bot.status !== 'running' && bot.status !== 'paused');
  const borrowed = profile.ownBots.filter((bot) => bot.copiedFromBotId != null);
  const best = [...profile.ownBots].sort((a, b) => b.pnlUsdt - a.pnlUsdt).slice(0, 3);

  return (
    <>
      <AccountSection account={account} />

      <section className="flex flex-col gap-3">
        <SectionTitle title={t('trader.sectionRunningNow')} />
        {running.length === 0 ? (
          <Card>
            <p className="text-sm text-text-muted">{t('trader.noRunning')}</p>
          </Card>
        ) : (
          <div className="border border-border-subtle">
            {running.map((bot) => (
              <BotLine key={bot.id} bot={bot} linked={linked} onCopy={onCopy} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title={t('trader.sectionBest')} hint={t('trader.bestHint')} />
        {best.length === 0 ? (
          <Card>
            <p className="text-sm text-text-muted">{t('trader.noBest')}</p>
          </Card>
        ) : (
          <div className="grid gap-px bg-border-subtle md:grid-cols-3">
            {best.map((bot) => (
              <Extreme key={bot.id} bot={bot} label={t('trader.best')} linked={linked} onCopy={onCopy} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title={t('trader.equityTitle')} hint={t('trader.equityHint')} />
        <Card className="p-4">
          {curve.length === 0 ? (
            <p className="text-sm text-text-muted">{t('trader.accountCurveEmpty')}</p>
          ) : (
            <EquityCurve points={curve} positive={(account?.totalPnlUsdt ?? 0) > 0 || (curve.at(-1)?.equity ?? 0) >= (curve[0]?.equity ?? 0)} />
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title={t('trader.sectionBots')} />
        <div className="grid grid-cols-2 gap-px overflow-hidden bg-border-subtle md:grid-cols-4">
          <StatCard label={t('trader.created')} value={String(bots.created)} />
          <StatCard label={t('trader.running')} value={String(bots.running)} />
          <StatCard label={t('trader.paused')} value={String(bots.paused)} />
          <StatCard label={t('trader.closed')} value={String(bots.closed)} />
          <StatCard label={t('trader.published')} value={String(bots.published)} />
          <StatCard label={t('trader.copied')} value={String(bots.copiedFromOthers)} />
          <StatCard label={t('trader.roundtrips')} value={String(bots.roundtrips)} />
          <StatCard label={t('trader.investedRunning')} value={formatUsd(profile.earnings.investedRunningUsdt)} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title={t('trader.sectionAudience')} hint={t('trader.audienceBody')} />
        <div className="grid grid-cols-2 gap-px overflow-hidden bg-border-subtle md:grid-cols-4">
          <StatCard label={t('trader.uniqueCopiers')} value={String(audience.uniqueCopiers)} />
          <StatCard label={t('trader.copiesCreated')} value={String(audience.copiesCreated)} />
          <StatCard label={t('trader.copiesRunning')} value={String(audience.copiesRunning)} />
          <StatCard label={t('trader.copiesClosed')} value={String(audience.copiesClosed)} />
          <StatCard label={t('trader.copiesPaused')} value={String(audience.copiesPaused)} />
          <StatCard
            label={t('trader.copierPnl')}
            value={formatPnl(audience.pnlUsdt)}
            delta={<Delta value={audience.pnlPct} format={formatPercent} />}
          />
          <StatCard label={t('trader.copierInvested')} value={formatUsd(audience.investedUsdt)} />
          <StatCard label={t('trader.copyInterests')} value={String(audience.copyInterests)} />
        </div>
        <p className="text-xs text-text-muted">
          {t('trader.interestPeople', { count: audience.uniqueInterestPeople })}
          {' · '}
          {t('trader.copierSplit', {
            realized: formatPnl(audience.realizedUsdt),
            unrealized: formatPnl(audience.unrealizedUsdt),
          })}
        </p>
        {profile.copiers.some((copier) => copier.status === 'running') && (
          <div className="flex flex-col border border-border-subtle bg-bg-elevated">
            {profile.copiers.filter((copier) => copier.status === 'running').map((copier, index) => (
              <CopierRow key={`${copier.id}-${copier.botId ?? index}`} copier={copier} />
            ))}
          </div>
        )}
        {audience.copiesCreated === 0 && profile.copiers.length === 0 && (
          <p className="text-sm text-text-muted">{t('trader.noCopies')}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title={t('trader.sectionStrategies')} />
        {profile.strategies.length === 0 ? (
          <Card>
            <p className="text-sm text-text-muted">{t('trader.noStrategies')}</p>
          </Card>
        ) : (
          <div className="border border-border-subtle">
            {profile.strategies.map((strategy) => (
              <StrategyRow key={strategy.id} strategy={strategy} linked={linked} onCopy={onCopy} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title={t('trader.sectionList')} />
        {profile.ownBots.length === 0 ? (
          <Card>
            <p className="text-sm text-text-muted">{t('trader.emptyBots')}</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <BotGroup title={t('trader.running')} bots={running} linked={linked} onCopy={onCopy} />
            <BotGroup title={t('trader.paused')} bots={paused} linked={linked} onCopy={onCopy} />
            <BotGroup title={t('trader.closed')} bots={closed} linked={linked} onCopy={onCopy} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title={t('trader.sectionBorrowed')} />
        {borrowed.length === 0 ? (
          <Card>
            <p className="text-sm text-text-muted">{t('trader.noBorrowed')}</p>
          </Card>
        ) : (
          <div className="border border-border-subtle">
            {borrowed.map((bot) => (
              <BotLine key={bot.id} bot={bot} linked={linked} onCopy={onCopy} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {hint && <p className="mt-1 max-w-3xl text-sm leading-6 text-text-muted">{hint}</p>}
    </div>
  );
}

function CopierRow({ copier }: { copier: ProfileCopier }) {
  const t = useT();
  const pnl = copier.pnlUsdt;
  return (
    <Link
      to={`/dashboard/perfil/${copier.id}`}
      className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 last:border-0 hover:bg-bg-muted/40"
    >
      <span className="flex min-w-0 items-center gap-3">
        <UserAvatar
          name={copier.name}
          email=""
          src={communityAvatarUrl(copier.id, copier.hasAvatar)}
          size="sm"
        />
        <span className="min-w-0">
          <ProfileTags name={copier.name} tags={copier.tags} className="text-sm font-medium" tagClassName="text-[11px]" />
          <span className="mt-1 block font-mono text-[10px] text-text-muted">
            {copier.pair ?? t('trader.copierTapOnly')}
            {copier.investmentUsdt != null ? ` · ${formatUsd(copier.investmentUsdt)}` : ''}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {copier.status ? <StatusPill status={copier.status} /> : (
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            {t('trader.copierTapOnly')}
          </span>
        )}
        {pnl != null && (
          <span className={cn('font-mono text-sm', pnlClass(pnl))}>
            {formatPnl(pnl)}
            {copier.pnlPct != null && <span className="ml-2">{formatPercent(copier.pnlPct)}</span>}
          </span>
        )}
      </span>
    </Link>
  );
}

function AccountSection({ account }: { account: AccountPerformance | undefined }) {
  const t = useT();
  if (!account || !account.connected || (!account.live && account.points.length === 0 && account.equityUsdt === 0)) {
    return (
      <section className="flex flex-col gap-3">
        <SectionTitle title={t('trader.sectionAccount')} hint={t('trader.accountHint')} />
        <Card>
          <p className="text-sm text-text-muted">
            {!account || !account.connected ? t('trader.accountOff') : t('trader.accountStale')}
          </p>
        </Card>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title={t('trader.sectionAccount')} hint={t('trader.accountHint')} />
      {!account.live && (
        <p className="text-xs text-text-muted">{t('trader.accountStale')}</p>
      )}
      <div className="grid grid-cols-2 gap-px overflow-hidden bg-border-subtle md:grid-cols-4">
        <StatCard
          label={t('trader.accountPnl')}
          value={formatPnl(account.totalPnlUsdt)}
        />
        <StatCard label={t('trader.accountEquity')} value={formatUsd(account.equityUsdt)} />
        <StatCard label={t('trader.accountRealized')} value={formatPnl(account.realizedUsdt)} />
        <StatCard label={t('trader.accountUnrealized')} value={formatPnl(account.unrealizedUsdt)} />
        <StatCard label={t('trader.accountFunding')} value={formatPnl(account.fundingUsdt)} />
      </div>
    </section>
  );
}

function Extreme({
  bot,
  label,
  linked,
  onCopy,
}: {
  bot: ProfileOwnBot;
  label: string;
  linked: boolean;
  onCopy: ((publishedId: number) => void) | null;
}) {
  const t = useT();
  const className = 'bg-bg-elevated p-4';
  const body = (
    <>
      <p className="font-mono text-[10px] uppercase tracking-[.16em] text-text-disabled">{label}</p>
      <p className="mt-2 text-sm font-semibold">{bot.pair}</p>
      <p className="mt-1 font-mono text-[10px] text-text-muted">
        {bot.direction} · {bot.leverage}x
      </p>
      <p className={cn('mt-1 font-mono text-lg', pnlClass(bot.pnlUsdt))}>
        {formatPnl(bot.pnlUsdt)}
        <span className="ml-2 text-sm">{formatPercent(bot.pnlPct)}</span>
      </p>
      <div className="mt-2">
        <StatusPill status={bot.status} />
      </div>
      {onCopy && bot.publishedId != null && (
        <button
          type="button"
          onClick={() => onCopy(bot.publishedId!)}
          className="mt-3 text-xs font-medium text-primary"
        >
          {t('community.copy')}
        </button>
      )}
    </>
  );
  if (!linked) return <div className={className}>{body}</div>;
  return (
    <Link to={`/dashboard/bots/${bot.id}`} className={cn(className, 'block hover:bg-bg-muted/40')}>
      {body}
    </Link>
  );
}

function StrategyRow({
  strategy,
  linked,
  onCopy,
}: {
  strategy: ProfileStrategy;
  linked: boolean;
  onCopy: ((publishedId: number) => void) | null;
}) {
  const t = useT();
  const body = (
    <>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{strategy.title}</span>
          {strategy.liveStatus === 'closed' ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
              {t('trader.closed')}
            </span>
          ) : (
            <StatusPill status={strategy.liveStatus} />
          )}
        </div>
        <p className="mt-1 font-mono text-[10px] text-text-muted">
          {strategy.pair} · {strategy.direction} · {strategy.leverage}x
        </p>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-right sm:grid-cols-4">
        <Metric label={t('trader.strategyOwnPnl')} value={formatPnl(strategy.ownPnlUsdt)} tone={strategy.ownPnlUsdt} />
        <Metric label={t('trader.strategyCopies')} value={String(strategy.copiesCreated)} />
        <Metric label={t('trader.strategyPeople')} value={String(strategy.uniqueCopiers)} />
        <Metric
          label={t('trader.strategyCopierPnl')}
          value={`${formatPnl(strategy.copierPnlUsdt)} · ${formatPercent(strategy.copierPnlPct)}`}
          tone={strategy.copierPnlUsdt}
        />
      </div>
      {onCopy && (
        <button
          type="button"
          onClick={() => onCopy(strategy.id)}
          className="shrink-0 text-xs font-medium text-primary"
        >
          {t('community.copy')}
        </button>
      )}
    </>
  );
  const className = 'flex flex-col gap-3 border-b border-border-subtle bg-bg-elevated px-4 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between';
  if (!linked || strategy.sourceBotId == null) return <div className={className}>{body}</div>;
  return (
    <Link to={`/dashboard/bots/${strategy.sourceBotId}`} className={cn(className, 'hover:bg-bg-muted/40')}>
      {body}
    </Link>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-disabled">{label}</div>
      <div className={cn('font-mono text-sm', tone == null ? 'text-text-primary' : pnlClass(tone))}>{value}</div>
    </div>
  );
}

function BotGroup({
  title,
  bots,
  linked,
  onCopy,
}: {
  title: string;
  bots: ProfileOwnBot[];
  linked: boolean;
  onCopy: ((publishedId: number) => void) | null;
}) {
  if (bots.length === 0) return null;
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[.16em] text-text-disabled">
        {title} · {bots.length}
      </p>
      <div className="border border-border-subtle">
        {bots.map((bot) => (
          <BotLine key={bot.id} bot={bot} linked={linked} onCopy={onCopy} />
        ))}
      </div>
    </div>
  );
}

function BotLine({
  bot,
  linked,
  onCopy,
}: {
  bot: ProfileOwnBot;
  linked: boolean;
  onCopy?: ((publishedId: number) => void) | null;
}) {
  const t = useT();
  const className = 'flex items-center justify-between gap-3 border-b border-border-subtle bg-bg-elevated px-4 py-3 last:border-0';
  const body = (
    <>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{bot.pair}</span>
          <span className="font-mono text-[10px] text-text-muted">
            {bot.direction} · {bot.leverage}x
          </span>
          <StatusPill status={bot.status} />
          {bot.published && (
            <span className="font-mono text-[10px] tracking-wide text-primary">{t('trader.onPodium')}</span>
          )}
        </div>
        {bot.copiedFromName && (
          <p className="mt-1 text-xs text-text-muted">{t('trader.fromAuthor', { name: bot.copiedFromName })}</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className={cn('font-mono text-sm', pnlClass(bot.pnlUsdt))}>{formatPnl(bot.pnlUsdt)}</div>
        <div className="font-mono text-[10px] text-text-muted">
          {formatPercent(bot.pnlPct)} · {formatUsd(bot.investmentUsdt)}
        </div>
        {onCopy && bot.publishedId != null && (
          <button
            type="button"
            onClick={() => onCopy(bot.publishedId!)}
            className="mt-1 text-xs font-medium text-primary"
          >
            {t('community.copy')}
          </button>
        )}
      </div>
    </>
  );
  if (!linked) return <div className={className}>{body}</div>;
  return (
    <Link to={`/dashboard/bots/${bot.id}`} className={cn(className, 'hover:bg-bg-muted/40')}>
      {body}
    </Link>
  );
}
