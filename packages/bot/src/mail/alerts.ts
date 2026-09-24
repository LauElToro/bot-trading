import { childLogger } from '../server/logger.js';
import { composeEmail, type EmailFact, type OutboundEmail } from './layout.js';
import { sendNotificationEmail } from './mailer.js';

const log = childLogger('mail-alerts');

function dashboardUrl(): string | null {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
  if (!base || !/^https?:\/\//.test(base)) return null;
  return `${base}/dashboard/`;
}

export function buildSafeguardEmail(params: {
  to: string;
  botId: number;
  pair: string;
  action: string;
  reason: string;
}): OutboundEmail {
  const close = params.action === 'pause_close';
  const facts: EmailFact[] = [
    { label: 'Bot', value: String(params.botId) },
    { label: 'Instrumento', value: params.pair },
    {
      label: 'Acción aplicada',
      value: close
        ? 'Pausa y cierre de posición'
        : 'Pausa. La posición queda abierta',
      accent: true,
    },
  ];

  const liq = params.reason.match(/dist=([-0-9.]+)%:liq=([-0-9.]+):mark=([-0-9.]+)/);
  const stop = params.reason.match(/SL triggered at ([-+0-9.]+)% \(threshold ([-+0-9.]+)%\)/);
  const take = params.reason.match(/TP triggered at ([-+0-9.]+)% \(threshold ([-+0-9.]+)%\)/);

  let what: string;
  if (liq) {
    what = `El precio de marca de ${params.pair} se acercó al precio de liquidación más de lo que permite el safeguard del bot ${params.botId}.`;
    facts.push(
      { label: 'Distancia a la liquidación', value: `${liq[1]}%`, accent: true },
      { label: 'Precio de liquidación', value: `$${liq[2]}` },
      { label: 'Precio de marca', value: `$${liq[3]}` },
    );
  } else if (stop) {
    what = `El PnL total del bot ${params.botId} llegó al stop-loss configurado.`;
    facts.push(
      { label: 'Pérdida registrada', value: `${stop[1]}% del capital asignado`, accent: true },
      { label: 'Stop-loss configurado', value: `${stop[2]}%` },
    );
  } else if (take) {
    what = `El PnL total del bot ${params.botId} llegó al take-profit configurado.`;
    facts.push(
      { label: 'Ganancia registrada', value: `${take[1]}% del capital asignado`, accent: true },
      { label: 'Take-profit configurado', value: `${take[2]}%` },
    );
  } else {
    what = `Se activó el safeguard del bot ${params.botId} (${params.pair}).`;
  }

  const actionText = close
    ? 'Toro pausó el bot, canceló las órdenes de ese instrumento e intentó cerrar la posición en GRVT. Si quedó un resto, sigue en tu cuenta de GRVT y hay que cerrarlo a mano.'
    : 'Toro pausó el bot e intentó cancelar las órdenes abiertas de ese instrumento en GRVT. La posición, si había una, sigue abierta.';

  const dashboard = dashboardUrl();
  return composeEmail(`Toro — safeguard del bot ${params.botId} (${params.pair})`, {
    lang: 'es',
    preheader: close
      ? `El bot ${params.botId} se pausó y Toro intentó cerrar la posición en ${params.pair}.`
      : `El bot ${params.botId} se pausó. La posición de ${params.pair} sigue en GRVT.`,
    heading: 'Un safeguard frenó un bot',
    paragraphs: [what, actionText],
    facts: [
      ...facts,
      { label: 'Detalle técnico', value: params.reason },
    ],
    notes: [
      'El bot no vuelve a operar hasta que lo revises y lo inicies de nuevo. Mirá en GRVT las órdenes abiertas y el tamaño de la posición antes de reanudarlo.',
    ],
    ...(dashboard ? { cta: { label: 'Abrir el dashboard', href: dashboard } } : {}),
    footer: `Toro envió este correo a ${params.to} porque el safeguard del bot ${params.botId} se activó en tu cuenta.`,
  });
}

export async function sendSafeguardEmail(params: {
  to: string;
  botId: number;
  pair: string;
  action: string;
  reason: string;
}): Promise<void> {
  const mail = buildSafeguardEmail(params);
  try {
    const sent = await sendNotificationEmail({ to: params.to, ...mail });
    if (sent) log.info({ to: params.to, botId: params.botId }, 'safeguard email sent');
  } catch (err) {
    log.error({ err: (err as Error).message, botId: params.botId }, 'safeguard email failed');
  }
}
