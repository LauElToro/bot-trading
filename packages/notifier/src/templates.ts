import type { BotRow, DailySnapshotRow, RoundtripRow } from './db.js';
import { composeEmail, type EmailFact, type OutboundEmail } from './email-layout.js';

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const body = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${body}`;
}

function fmtPnl(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  const body = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${body}`;
}

function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function directionLabel(direction: string): string {
  if (direction === 'long') return 'largo (LONG)';
  if (direction === 'short') return 'corto (SHORT)';
  return direction;
}

function statusLabel(status: string): string {
  const names: Record<string, string> = {
    running: 'en ejecución',
    paused: 'en pausa',
    stopped: 'detenido',
    error: 'en error',
  };
  return `${names[status] ?? status} (${status.toUpperCase()})`;
}

function statusMeaning(status: string): string {
  switch (status) {
    case 'running':
      return 'El bot está en ejecución: Toro monitorea el instrumento y puede colocar o reponer órdenes en tu cuenta de GRVT.';
    case 'paused':
      return 'El bot está en pausa: Toro dejó de monitorearlo e intentó cancelar las órdenes abiertas de ese instrumento en GRVT. La posición, si había una, sigue abierta en GRVT.';
    case 'stopped':
      return 'El bot está detenido: Toro intentó cancelar las órdenes y cerrar la posición en GRVT. Si el cierre no se completó, el tamaño que quede sigue en tu cuenta de GRVT y hay que cerrarlo a mano.';
    case 'error':
      return 'El bot quedó en error y no está operando. Revisá las órdenes y la posición en GRVT antes de volver a iniciarlo.';
    default:
      return `El estado registrado es ${status}. Revisá el bot en el dashboard y las órdenes abiertas en GRVT.`;
  }
}

function dashboardUrl(): string | null {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
  if (!base || !/^https?:\/\//.test(base)) return null;
  return `${base}/dashboard/`;
}

function botIdentity(bot: BotRow): string {
  return `bot ${bot.id} (${bot.pair}, ${directionLabel(bot.direction)}, ${bot.leverage}x)`;
}

const EMPTY: OutboundEmail = { subject: '', text: '', html: '' };

export function fillsTemplate(roundtrips: RoundtripRow[]): OutboundEmail {
  if (roundtrips.length === 0) return EMPTY;
  const total = roundtrips.reduce((sum, row) => sum + row.profit, 0);
  const botIds = [...new Set(roundtrips.map((row) => row.bot_id))];
  const countLabel = roundtrips.length === 1
    ? 'Se cerró 1 round-trip'
    : `Se cerraron ${roundtrips.length} round-trips`;
  const where = botIds.length === 1
    ? `en el bot ${botIds[0]}`
    : `en los bots ${botIds.join(', ')}`;
  const dashboard = dashboardUrl();
  return composeEmail(
    `Toro — ${roundtrips.length} round-trip${roundtrips.length === 1 ? '' : 's'} ${where}`,
    {
      lang: 'es',
      preheader: `${countLabel}. Resultado neto del lote: ${fmtPnl(total)}.`,
      heading: 'Se cerraron operaciones de la grilla',
      paragraphs: [
        `${countLabel} ${where}. Un round-trip es una compra y una venta emparejadas en la grilla.`,
        `El resultado neto de este lote, sumando las ${roundtrips.length} operaciones, es ${fmtPnl(total)}.`,
      ],
      facts: [
        { label: 'Operaciones del lote', value: String(roundtrips.length) },
        { label: 'Resultado neto', value: fmtPnl(total), accent: true },
        { label: 'Bots', value: botIds.join(', ') },
      ],
      notes: [
        'Este correo no pausa el bot. El resultado es el de la grilla, no el PnL total de la cuenta en GRVT.',
      ],
      ...(dashboard ? { cta: { label: 'Abrir el dashboard', href: dashboard } } : {}),
      footer: 'Toro envió este correo porque se cerraron round-trips en tus bots. Podés apagar este aviso en Ajustes.',
    },
  );
}

export function profitMilestoneTemplate(opts: {
  bot: BotRow;
  milestonePct: number;
}): OutboundEmail {
  const { bot, milestonePct } = opts;
  const pct = bot.investment_usdt > 0
    ? (bot.total_pnl_usdt / bot.investment_usdt) * 100
    : 0;
  const dashboard = dashboardUrl();
  const milestone = fmtPct(milestonePct);
  return composeEmail(
    `Toro — el bot ${bot.id} (${bot.pair}) cruzó ${milestone} de PnL`,
    {
      lang: 'es',
      preheader: `PnL total (GRVT) ${fmtPnl(bot.total_pnl_usdt)} (${fmtPct(pct)}) sobre ${fmtUsd(bot.investment_usdt)}.`,
      heading: 'El PnL del bot cruzó un umbral',
      paragraphs: [
        `El ${botIdentity(bot)} cruzó el umbral de ${milestone} sobre el capital asignado.`,
        `El PnL total (GRVT) es ${fmtPnl(bot.total_pnl_usdt)}, un ${fmtPct(pct)} de ${fmtUsd(bot.investment_usdt)} asignados. Este aviso no cierra ni pausa el bot.`,
      ],
      facts: [
        { label: 'Bot', value: String(bot.id) },
        { label: 'Instrumento', value: bot.pair },
        { label: 'Dirección', value: directionLabel(bot.direction) },
        { label: 'Estado', value: statusLabel(bot.status) },
        { label: 'Capital asignado', value: fmtUsd(bot.investment_usdt) },
        { label: 'PnL total (GRVT)', value: fmtPnl(bot.total_pnl_usdt), accent: true },
        { label: 'Resultado sobre el capital', value: fmtPct(pct), accent: true },
        { label: 'Umbral avisado', value: milestone },
      ],
      ...(dashboard ? { cta: { label: 'Abrir el dashboard', href: dashboard } } : {}),
      footer: `Toro envió este correo porque el bot ${bot.id} cruzó un hito de resultado. Podés cambiar el porcentaje o apagar el aviso en Ajustes.`,
    },
  );
}

export function drawdownTemplate(
  currentEquity: number,
  hwm: number,
  thresholdPct: number,
): OutboundEmail {
  const drop = Math.abs(currentEquity - hwm);
  const dropPct = hwm > 0 ? (drop / hwm) * 100 : 0;
  const dashboard = dashboardUrl();
  return composeEmail(
    `Toro — el equity cayó ${dropPct.toFixed(2)}% desde el máximo`,
    {
      lang: 'es',
      preheader: `Equity ${fmtUsd(currentEquity)}. Máximo ${fmtUsd(hwm)}. Umbral ${thresholdPct}%.`,
      heading: 'El equity de tus bots cayó del máximo',
      paragraphs: [
        `El equity de tus bots pasó de ${fmtUsd(hwm)} a ${fmtUsd(currentEquity)}. La caída es ${fmtUsd(drop)} (${dropPct.toFixed(2)}%), por encima del umbral de ${thresholdPct}%.`,
        'Este correo se envía una sola vez por día mientras la caída siga. No pausa los bots.',
      ],
      facts: [
        { label: 'Equity actual', value: fmtUsd(currentEquity), accent: true },
        { label: 'Máximo registrado', value: fmtUsd(hwm) },
        { label: 'Caída', value: `${fmtUsd(drop)} (${dropPct.toFixed(2)}%)`, accent: true },
        { label: 'Umbral del aviso', value: `${thresholdPct}%` },
      ],
      ...(dashboard ? { cta: { label: 'Abrir el dashboard', href: dashboard } } : {}),
      footer: 'Toro envió este correo porque el equity de tus bots cruzó el umbral de drawdown. Podés apagarlo en Ajustes.',
    },
  );
}

export function statusChangeTemplate(
  bot: BotRow,
  fromStatus: string,
  toStatus: string,
): OutboundEmail {
  const dashboard = dashboardUrl();
  const notes = [statusMeaning(toStatus)];
  if (bot.last_error) notes.push(`Último error registrado: ${bot.last_error}`);
  return composeEmail(
    `Toro — el bot ${bot.id} (${bot.pair}) pasó a ${statusLabel(toStatus)}`,
    {
      lang: 'es',
      preheader: `Estado anterior: ${statusLabel(fromStatus)}.`,
      heading: 'Cambió el estado de un bot',
      paragraphs: [
        `El bot ${bot.id}, instrumento ${bot.pair}, pasó de ${statusLabel(fromStatus)} a ${statusLabel(toStatus)}.`,
      ],
      facts: [
        { label: 'Bot', value: String(bot.id) },
        { label: 'Instrumento', value: bot.pair },
        { label: 'Estado anterior', value: statusLabel(fromStatus) },
        { label: 'Estado actual', value: statusLabel(toStatus), accent: true },
      ],
      notes,
      ...(dashboard ? { cta: { label: 'Abrir el dashboard', href: dashboard } } : {}),
      footer: `Toro envió este correo porque el bot ${bot.id} cambió de estado. Podés apagar los avisos de estado en Ajustes.`,
    },
  );
}

export function liqProximityTemplate(
  bot: BotRow,
  markPrice: number,
  liqPrice: number,
  distancePct: number,
  thresholdPct?: number,
): OutboundEmail {
  const distance = `${distancePct.toFixed(1)}%`;
  const critical = distancePct < 5;
  const dashboard = dashboardUrl();
  const facts: EmailFact[] = [
    { label: 'Bot', value: String(bot.id) },
    { label: 'Instrumento', value: bot.pair },
    { label: 'Dirección', value: directionLabel(bot.direction) },
    { label: 'Apalancamiento', value: `${bot.leverage}x` },
    { label: 'Precio de marca usado', value: fmtUsd(markPrice) },
    { label: 'Precio de liquidación', value: fmtUsd(liqPrice), accent: true },
    { label: 'Distancia', value: distance, accent: true },
  ];
  if (thresholdPct != null && Number.isFinite(thresholdPct)) {
    facts.push({ label: 'Umbral del aviso', value: `${thresholdPct}%` });
  }
  return composeEmail(
    `Toro — el bot ${bot.id} (${bot.pair}) está a ${distance} de la liquidación`,
    {
      lang: 'es',
      preheader: `Marca ${fmtUsd(markPrice)}. Liquidación ${fmtUsd(liqPrice)}. Distancia ${distance}.`,
      heading: 'El precio se acercó a la liquidación',
      paragraphs: [
        `En el ${botIdentity(bot)} el precio de marca está a ${distance} del precio de liquidación.`,
        critical
          ? 'La distancia es menor a 5%. Conviene pausar el bot o cerrar la posición ahora. Si el safeguard está activo, el bot puede pausarse solo; este correo no lo pausa.'
          : 'La distancia ya está dentro del aviso. Seguí el precio de marca y el de liquidación. Si el safeguard está activo, el bot puede pausarse solo; este correo no lo pausa.',
      ],
      facts,
      ...(dashboard ? { cta: { label: 'Abrir el dashboard', href: dashboard } } : {}),
      footer: `Toro envió este correo porque el bot ${bot.id} se acercó a su precio de liquidación. Podés apagar este aviso en Ajustes.`,
    },
  );
}

export function dailySummaryTemplate(
  bot: BotRow,
  snapshot: DailySnapshotRow | undefined,
  referenceEquity: number | null,
): OutboundEmail {
  const equity = bot.investment_usdt + bot.total_pnl_usdt;
  const pct = bot.investment_usdt > 0
    ? (bot.total_pnl_usdt / bot.investment_usdt) * 100
    : 0;
  const dashboard = dashboardUrl();
  const facts: EmailFact[] = [
    { label: 'Bot', value: String(bot.id) },
    { label: 'Instrumento', value: bot.pair },
    { label: 'Dirección', value: directionLabel(bot.direction) },
    { label: 'Apalancamiento', value: `${bot.leverage}x` },
    { label: 'Estado', value: statusLabel(bot.status) },
    { label: 'Capital asignado', value: fmtUsd(bot.investment_usdt) },
    { label: 'Equity (capital + PnL total)', value: fmtUsd(equity), accent: true },
    { label: 'PnL total (GRVT)', value: `${fmtPnl(bot.total_pnl_usdt)} (${fmtPct(pct)})`, accent: true },
    { label: 'PnL realizado (grilla)', value: fmtPnl(bot.grid_profit_usdt) },
    { label: 'PnL no realizado', value: fmtPnl(bot.trend_pnl_usdt) },
  ];
  if (referenceEquity != null && referenceEquity !== 0) {
    const delta = equity - referenceEquity;
    const deltaPct = (delta / referenceEquity) * 100;
    facts.push({
      label: 'Variación contra la referencia',
      value: `${fmtPnl(delta)} (${fmtPct(deltaPct)})`,
      accent: true,
    });
  }
  const when = snapshot ? `, snapshot ${snapshot.date}` : '';
  return composeEmail(`Toro — resumen del bot ${bot.id} (${bot.pair})${when}`, {
    lang: 'es',
    preheader: `Equity ${fmtUsd(equity)}. PnL total ${fmtPnl(bot.total_pnl_usdt)} (${fmtPct(pct)}).`,
    heading: 'Resumen del bot',
    paragraphs: [
      `Equity ${fmtUsd(equity)}. PnL total (GRVT) ${fmtPnl(bot.total_pnl_usdt)} (${fmtPct(pct)}) sobre ${fmtUsd(bot.investment_usdt)} asignados.`,
    ],
    facts,
    ...(dashboard ? { cta: { label: 'Abrir el dashboard', href: dashboard } } : {}),
    footer: `Toro envió este resumen porque el bot ${bot.id} estaba en ejecución. Podés apagar el resumen diario en Ajustes.`,
  });
}
