import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { communityAvatarUrl } from '@/lib/avatar';
import { formatPercent, formatPnl, formatUsd } from '@/lib/format';
import type { AutoCopier, AutoCopierBot } from '@/lib/api-types';
import { PageHeader } from '@/components/page-header';
import { UserAvatar } from '@/components/user-avatar';
import { StatCard } from '@/components/primitives/stat-card';
import { Delta } from '@/components/primitives/delta';
import { Button } from '@/components/primitives/button';
import { Card } from '@/components/primitives/card';
import { StatusPill } from '@/components/primitives/status-pill';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';

function pnlClass(value: number): string {
  if (value > 0) return 'text-success';
  if (value < 0) return 'text-danger';
  return 'text-text-primary';
}

export function AutoCopiersPage() {
  const t = useT();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['auto-copiers', page],
    queryFn: () => api.getAutoCopiers(page),
  });
  const data = query.data;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize || 8)));
  const summary = data?.summary;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t('copies.eyebrow')}
        title={t('copies.title')}
        subtitle={t('copies.subtitle')}
      />

      {query.isPending ? (
        <div className="h-28 animate-pulse border border-border-subtle bg-bg-elevated" />
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden bg-border-subtle md:grid-cols-4">
          <StatCard label={t('copies.people')} value={String(summary?.people ?? 0)} />
          <StatCard label={t('copies.bots')} value={String(summary?.copies ?? 0)} />
          <StatCard label={t('copies.running')} value={String(summary?.running ?? 0)} />
          <StatCard label={t('copies.closed')} value={String(summary?.closed ?? 0)} />
          <StatCard label={t('copies.paused')} value={String(summary?.paused ?? 0)} />
          <StatCard
            label={t('copies.result')}
            value={formatPnl(summary?.pnlUsdt ?? 0)}
            delta={<Delta value={summary?.pnlPct ?? 0} format={formatPercent} />}
          />
          <StatCard label={t('copies.invested')} value={formatUsd(summary?.investedUsdt ?? 0)} />
        </div>
      )}

      {summary && (
        <p className="font-mono text-xs text-text-muted">
          {t('copies.split', {
            realized: formatPnl(summary.realizedUsdt),
            unrealized: formatPnl(summary.unrealizedUsdt),
          })}
        </p>
      )}

      {query.isError ? (
        <Card className="border-danger/40">
          <p className="text-sm text-danger">{t('copies.loadFailed')}</p>
        </Card>
      ) : query.isPending ? null : (data?.rows.length ?? 0) === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">{t('copies.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {data?.rows.map((row) => (
            <CopierCard key={row.id} row={row} />
          ))}
        </div>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-muted">{t('copies.pageStatus', { page, pages })}</p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              {t('copies.pagePrev')}
            </Button>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>
              {t('copies.pageNext')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CopierCard({ row }: { row: AutoCopier }) {
  const t = useT();
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Link to={`/dashboard/perfil/${row.id}`} className="flex min-w-0 items-center gap-3">
          <UserAvatar
            name={row.name}
            email=""
            src={communityAvatarUrl(row.id, row.hasAvatar, row.avatarUpdatedAt)}
            size="md"
          />
          <span className="min-w-0">
            <span className="block truncate text-base font-medium">{row.name}</span>
            {row.copyInvestmentUsdt > 0 && (
              <span className="mt-1 block text-xs text-text-muted">
                {t('copies.amount')} {formatUsd(row.copyInvestmentUsdt)}
              </span>
            )}
          </span>
        </Link>
        <div className="flex gap-6 text-right">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.14em] text-text-disabled">{t('copies.bots')}</p>
            <p className="mt-1 text-sm">{row.copies}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.14em] text-text-disabled">{t('copies.invested')}</p>
            <p className="mt-1 font-mono text-sm">{formatUsd(row.investedUsdt)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.14em] text-text-disabled">{t('copies.result')}</p>
            <p className={cn('mt-1 font-mono text-sm', pnlClass(row.pnlUsdt))}>
              {formatPnl(row.pnlUsdt)}
              <span className="ml-2">{formatPercent(row.pnlPct)}</span>
            </p>
          </div>
        </div>
      </div>
      {row.bots.length === 0 ? (
        <p className="text-sm text-text-muted">{t('copies.noBots')}</p>
      ) : (
        <div className="border border-border-subtle">
          {row.bots.map((bot) => (
            <BotLine key={bot.botId} bot={bot} />
          ))}
        </div>
      )}
    </Card>
  );
}

function BotLine({ bot }: { bot: AutoCopierBot }) {
  const t = useT();
  const status = bot.status === 'running' || bot.status === 'paused' || bot.status === 'stopped' || bot.status === 'error'
    ? bot.status
    : 'paused';
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm">{bot.pair}</p>
        <p className="mt-1 font-mono text-[10px] text-text-muted">
          {bot.direction} · {t('copies.fromPair')} {bot.leaderPair} · {formatUsd(bot.investmentUsdt)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusPill status={status} />
        <span className={cn('font-mono text-sm', pnlClass(bot.pnlUsdt))}>
          {formatPnl(bot.pnlUsdt)}
          <span className="ml-2">{formatPercent(bot.pnlPct)}</span>
        </span>
      </div>
    </div>
  );
}
