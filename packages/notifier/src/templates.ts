// Email-oriented alert copy. Plain text so the same body works as
// text/plain and as the HTML pre block.

import type { BotRow, DailySnapshotRow, RoundtripRow } from './db.js';

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPnl(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function fillsTemplate(roundtrips: RoundtripRow[]): string {
  if (roundtrips.length === 0) return '';
  const total = roundtrips.reduce((sum, r) => sum + r.profit, 0);
  const lines = roundtrips.slice(0, 10).map((r) => {
    const mark = r.profit >= 0 ? '+' : '-';
    return `${mark} ${fmtUsd(r.buy_price)} → ${fmtUsd(r.sell_price)}  ${fmtPnl(r.profit)}`;
  });
  const more = roundtrips.length > 10 ? `\n…+${roundtrips.length - 10} más` : '';
  return [
    `${roundtrips.length} round-trip${roundtrips.length === 1 ? '' : 's'} nuevos. Total ${fmtPnl(total)}`,
    '',
    ...lines,
    more,
  ]
    .filter(Boolean)
    .join('\n');
}

export function drawdownTemplate(
  currentEquity: number,
  hwm: number,
  thresholdPct: number,
): string {
  const drop = currentEquity - hwm;
  const dropPct = (drop / hwm) * 100;
  return [
    'Alerta de drawdown',
    '',
    `Equity:     ${fmtUsd(currentEquity)}`,
    `Máximo:     ${fmtUsd(hwm)}`,
    `Caída:      ${fmtPnl(drop)} (${fmtPct(dropPct)})`,
    '',
    `Umbral: ${thresholdPct}%. Revisá el dashboard antes de seguir operando.`,
  ].join('\n');
}

export function statusChangeTemplate(
  bot: BotRow,
  fromStatus: string,
  toStatus: string,
): string {
  return [
    `Bot ${bot.id} (${bot.pair}) pasó a ${toStatus.toUpperCase()}`,
    `Estado anterior: ${fromStatus}`,
    bot.last_error ? `\nError: ${bot.last_error}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function liqProximityTemplate(
  bot: BotRow,
  markPrice: number,
  liqPrice: number,
  distancePct: number,
): string {
  return [
    `Proximidad de liquidación — Bot ${bot.id} (${bot.pair})`,
    '',
    `Mark:       ${fmtUsd(markPrice)}`,
    `Liquidación:${fmtUsd(liqPrice)}`,
    `Distancia:  ${distancePct.toFixed(1)}%`,
    '',
    distancePct < 5
      ? 'CRÍTICO — considerá pausar o cerrar este bot ahora.'
      : 'Monitoreá de cerca. Si el safeguard está activo, el bot puede pausarse solo.',
  ].join('\n');
}

export function dailySummaryTemplate(
  bot: BotRow,
  snapshot: DailySnapshotRow | undefined,
  yesterdayEquity: number | null,
): string {
  const equity = bot.investment_usdt + bot.total_pnl_usdt;
  const pct = (bot.total_pnl_usdt / bot.investment_usdt) * 100;
  const dayDelta =
    yesterdayEquity != null
      ? `\nDía:         ${fmtPnl(equity - yesterdayEquity)} (${fmtPct(((equity - yesterdayEquity) / yesterdayEquity) * 100)})`
      : '';
  const rtCount = snapshot?.round_trips ?? '—';
  return [
    `Resumen diario — Bot ${bot.id} ${bot.pair}`,
    '',
    `Equity:      ${fmtUsd(equity)}`,
    `PnL total:   ${fmtPnl(bot.total_pnl_usdt)} (${fmtPct(pct)})${dayDelta}`,
    `Realizado:   ${fmtPnl(bot.grid_profit_usdt)}`,
    `No realizado:${fmtPnl(bot.trend_pnl_usdt)}`,
    `Round-trips: ${rtCount}`,
    `Estado:      ${bot.status}`,
  ].join('\n');
}
