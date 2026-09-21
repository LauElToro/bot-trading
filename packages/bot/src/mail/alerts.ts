import { childLogger } from '../server/logger.js';
import { sendNotificationEmail } from './mailer.js';

const log = childLogger('mail-alerts');

export async function sendSafeguardEmail(params: {
  to: string;
  botId: number;
  pair: string;
  action: string;
  reason: string;
}): Promise<void> {
  const actionLabel =
    params.action === 'pause_close'
      ? 'El bot se pausó y se cerró la posición.'
      : 'El bot se pausó y mantiene la posición.';
  const subject = `Toro — safeguard en bot ${params.botId} (${params.pair})`;
  const body = [
    `Se disparó el safeguard de liquidación.`,
    '',
    `Bot:     ${params.botId}`,
    `Par:     ${params.pair}`,
    `Acción:  ${actionLabel}`,
    `Detalle: ${params.reason}`,
    '',
    'Revisá el dashboard antes de volver a arrancar.',
  ].join('\n');
  try {
    const sent = await sendNotificationEmail({ to: params.to, subject, body });
    if (sent) log.info({ to: params.to, botId: params.botId }, 'safeguard email sent');
  } catch (err) {
    log.error({ err: (err as Error).message, botId: params.botId }, 'safeguard email failed');
  }
}
