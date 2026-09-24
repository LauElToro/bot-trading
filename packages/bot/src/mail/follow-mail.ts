import { composeEmail, type OutboundEmail } from './layout.js';
import type { FollowAction } from '../server/follow-rules.js';

export interface FollowMailInput {
  to: string;
  lang?: 'es' | 'en';
  traderName: string;
  kind: FollowAction | 'streak' | 'copy_failed';
  pair?: string | null;
  detail?: string | null;
  streakDays?: number | null;
  profileUrl?: string | null;
}

export function buildFollowEmail(input: FollowMailInput): OutboundEmail {
  const spanish = input.lang !== 'en';
  const name = input.traderName || (spanish ? 'Un trader' : 'A trader');
  const pair = input.pair?.trim() || '';
  const detail = input.detail?.trim() || '';
  const heading = spanish ? headingEs(input.kind, name) : headingEn(input.kind, name);
  const subject = `Toro — ${heading}`;
  const paragraphs = spanish
    ? paragraphsEs(input.kind, name, pair, detail, input.streakDays ?? null)
    : paragraphsEn(input.kind, name, pair, detail, input.streakDays ?? null);
  const facts = [
    { label: spanish ? 'Trader' : 'Trader', value: name },
    ...(pair ? [{ label: spanish ? 'Par' : 'Pair', value: pair }] : []),
    ...(detail ? [{ label: spanish ? 'Detalle' : 'Detail', value: detail }] : []),
    ...(input.kind === 'streak' && input.streakDays
      ? [{ label: spanish ? 'Racha' : 'Streak', value: spanish ? `${input.streakDays} días` : `${input.streakDays} days` }]
      : []),
  ];
  return composeEmail(subject, {
    lang: spanish ? 'es' : 'en',
    preheader: paragraphs[0] ?? heading,
    heading,
    paragraphs,
    facts,
    cta: input.profileUrl
      ? { label: spanish ? 'Ver perfil' : 'View profile', href: input.profileUrl }
      : undefined,
    footer: spanish
      ? `Toro envió este correo a ${input.to} porque seguís a ${name}.`
      : `Toro sent this email to ${input.to} because you follow ${name}.`,
  });
}

function headingEs(kind: FollowMailInput['kind'], name: string): string {
  switch (kind) {
    case 'bot_created': return `${name} creó un bot`;
    case 'bot_started': return `${name} prendió un bot`;
    case 'bot_paused': return `${name} pausó un bot`;
    case 'bot_closed': return `${name} cerró un bot`;
    case 'bot_action': return `${name} cambió un bot`;
    case 'streak': return `${name} mantiene la racha`;
    case 'copy_failed': return `No se pudo copiar el bot de ${name}`;
  }
}

function headingEn(kind: FollowMailInput['kind'], name: string): string {
  switch (kind) {
    case 'bot_created': return `${name} created a bot`;
    case 'bot_started': return `${name} started a bot`;
    case 'bot_paused': return `${name} paused a bot`;
    case 'bot_closed': return `${name} closed a bot`;
    case 'bot_action': return `${name} changed a bot`;
    case 'streak': return `${name} kept the streak`;
    case 'copy_failed': return `Could not copy ${name}'s bot`;
  }
}

function paragraphsEs(
  kind: FollowMailInput['kind'],
  name: string,
  pair: string,
  detail: string,
  streakDays: number | null,
): string[] {
  const where = pair ? ` en ${pair}` : '';
  switch (kind) {
    case 'bot_created':
      return [`${name} creó un bot nuevo${where}. Quedó pausado hasta que lo prenda.`];
    case 'bot_started':
      return [`${name} prendió un bot${where}. Si tenés la copia automática activa, Toro intenta prender el tuyo con el monto que elegiste.`];
    case 'bot_paused':
      return [`${name} pausó un bot${where}. El tuyo no se pausa solo.`];
    case 'bot_closed':
      return [`${name} cerró un bot${where}. El tuyo sigue como está.`];
    case 'bot_action':
      return [`${name} ejecutó un cambio${where}${detail ? `: ${detail}` : '.'}`];
    case 'streak':
      return [`${name} lleva ${streakDays ?? 0} días seguidos con al menos un bot en marcha.`];
    case 'copy_failed':
      return [`Toro no pudo crear o prender tu copia${where}. ${detail || 'Revisá las claves de GRVT y que no tengas ya un bot activo en ese par.'}`];
  }
}

function paragraphsEn(
  kind: FollowMailInput['kind'],
  name: string,
  pair: string,
  detail: string,
  streakDays: number | null,
): string[] {
  const where = pair ? ` on ${pair}` : '';
  switch (kind) {
    case 'bot_created':
      return [`${name} created a new bot${where}. It stays paused until they start it.`];
    case 'bot_started':
      return [`${name} started a bot${where}. If automatic copy is on, Toro tries to start yours with the amount you chose.`];
    case 'bot_paused':
      return [`${name} paused a bot${where}. Yours is not paused for you.`];
    case 'bot_closed':
      return [`${name} closed a bot${where}. Yours stays as it is.`];
    case 'bot_action':
      return [`${name} made a change${where}${detail ? `: ${detail}` : '.'}`];
    case 'streak':
      return [`${name} has had at least one bot running for ${streakDays ?? 0} days in a row.`];
    case 'copy_failed':
      return [`Toro could not create or start your copy${where}. ${detail || 'Check your GRVT keys and that you do not already have an active bot on that pair.'}`];
  }
}
