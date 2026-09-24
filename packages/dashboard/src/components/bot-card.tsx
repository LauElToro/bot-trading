// BotCard — overview and bots-list tile. The whole card opens the bot.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from './primitives/card';
import { StatusPill } from './primitives/status-pill';
import { Delta } from './primitives/delta';
import { Sparkline } from './charts/sparkline';
import { RangeBar } from './range-bar';
import { api } from '@/lib/api-client';
import { useWsChannel } from '@/lib/use-ws-channel';
import { formatPercent, formatPnl, formatSize, formatUsd } from '@/lib/format';
import { pairParts } from '@/lib/pair';
import { reconcilePnl } from '@/lib/pnl';
import { cn } from '@/lib/cn';
import type { BotSummary } from '@/lib/api-types';
import { useT } from '@/i18n';

interface BotTick {
  status: BotSummary['status'];
  positionSize: number;
  avgEntryPrice: number;
  gridProfit: number;
  trendPnl: number;
  totalPnl: number;
}

interface BotCardProps {
  bot: BotSummary;
}

export function BotCard({ bot }: BotCardProps) {
  const t = useT();
  const [tick, setTick] = useState<BotTick | null>(null);
  useWsChannel<BotTick>(`bot:${bot.id}`, (msg) => {
    if (msg.type === 'tick') setTick(msg.data);
  });
  const snapshots = useQuery({
    queryKey: ['snapshots', bot.id],
    queryFn: () => api.getSnapshots(bot.id),
    staleTime: 5 * 60_000,
  });

  const sparkData = (snapshots.data?.snapshots ?? [])
    .slice(0, 30)
    .reverse()
    .map((s) => ({ value: s.equity_usdt }));

  const status = tick?.status ?? bot.status;
  const pnl = reconcilePnl(
    tick?.gridProfit ?? bot.grid_profit_usdt,
    tick?.trendPnl ?? bot.trend_pnl_usdt,
    tick?.totalPnl ?? bot.total_pnl_usdt,
  );
  const gridProfit = pnl.realized;
  const trendPnl = pnl.unrealized;
  const totalPnl = pnl.total;
  const positionSize = tick?.positionSize ?? bot.position_size;
  const avgEntry = tick?.avgEntryPrice ?? bot.avg_entry_price;
  const equity = bot.investment_usdt + totalPnl;
  const equityPct = bot.investment_usdt > 0 ? (totalPnl / bot.investment_usdt) * 100 : 0;
  const { asset, market } = pairParts(bot.pair);
  const long = bot.direction === 'long';
  const up = totalPnl > 0;
  const down = totalPnl < 0;
  const hasPosition = Math.abs(positionSize) > 1e-8;

  return (
    <Link
      to={`/dashboard/bots/${bot.id}`}
      className="group block h-full hover:no-underline focus-visible:outline-none focus-visible:[&_div[data-card]]:border-primary"
      aria-label={`Open bot ${bot.id} ${bot.pair} ${bot.direction} ${bot.leverage}x`}
    >
      <Card
        data-card
        className="relative flex h-full cursor-pointer flex-col overflow-hidden p-0 transition-colors hover:border-primary/50"
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 left-0 w-1',
            up ? 'bg-success' : down ? 'bg-danger' : 'bg-border-strong',
          )}
        />

        <div className="flex flex-1 flex-col gap-4 p-5 pl-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-semibold tracking-tight text-text-primary">{asset}</h3>
                <span className="font-mono text-[10px] tracking-wider text-text-muted">{market}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
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
            <StatusPill status={status} />
          </div>

          <div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-2xs uppercase tracking-wider text-text-muted">{t('bots.cardResult')}</p>
                <p
                  className={cn(
                    'font-mono text-3xl font-semibold tracking-tight',
                    up ? 'text-success' : down ? 'text-danger' : 'text-text-primary',
                  )}
                >
                  {formatPnl(totalPnl)}
                </p>
              </div>
              <Delta value={equityPct} format={formatPercent} className="mb-1 text-sm" />
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {t('bots.cardOnCapital', { amount: formatUsd(bot.investment_usdt) })}
              <span className="mx-1.5 text-text-disabled">·</span>
              {t('bots.cardEquity')} {formatUsd(equity)}
            </p>
          </div>

          <Sparkline data={sparkData} id={`bot-${bot.id}`} positive={up ? true : down ? false : undefined} />

          <div className="grid grid-cols-2 gap-2">
            <ResultChip label={t('bots.cardRealized')} value={gridProfit} />
            <ResultChip label={t('bots.cardUnrealized')} value={trendPnl} />
          </div>

          <div className="mt-auto">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-2xs uppercase tracking-wider text-text-muted">{t('bots.cardRange')}</span>
              <span className="font-mono text-[10px] text-text-muted">
                {t('bots.cardLevels', { n: bot.num_grids })}
              </span>
            </div>
            <RangeBar
              lower={bot.lower_price}
              upper={bot.upper_price}
              marker={hasPosition ? avgEntry : null}
              markerLabel={t('bots.cardEntry')}
            />
            <p className="mt-2 truncate font-mono text-[11px] text-text-secondary">
              {t('bots.cardPosition')}
              {' · '}
              {hasPosition
                ? `${formatSize(positionSize)} @ ${formatUsd(avgEntry)}`
                : t('bots.cardNoPosition')}
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ResultChip({ label, value }: { label: string; value: number }) {
  const up = value > 0;
  const down = value < 0;
  return (
    <div
      className={cn(
        'px-3 py-2',
        up ? 'bg-success/10' : down ? 'bg-danger/10' : 'bg-bg-muted',
      )}
    >
      <p className="text-2xs uppercase tracking-wider text-text-muted">{label}</p>
      <p
        className={cn(
          'mt-0.5 font-mono text-sm tabular-nums',
          up ? 'text-success' : down ? 'text-danger' : 'text-text-primary',
        )}
      >
        {formatPnl(value)}
      </p>
    </div>
  );
}
