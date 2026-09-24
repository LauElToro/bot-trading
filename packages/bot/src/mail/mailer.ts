import nodemailer, { type Transporter } from 'nodemailer';
import { childLogger } from '../server/logger.js';
import { composeEmail, type OutboundEmail } from './layout.js';

const log = childLogger('mailer');

let transporter: Transporter | null = null;

function gmailUser(): string {
  return (process.env.GMAIL_USER || process.env.SMTP_USER || '').trim();
}

function gmailPass(): string {
  return (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '').replace(/\s+/g, '');
}

export function isMailerConfigured(): boolean {
  const host = process.env.SMTP_HOST || (gmailUser() ? 'smtp.gmail.com' : '');
  return !!(host && gmailUser() && gmailPass());
}

function mailFrom(): string {
  return (
    process.env.MAIL_FROM ||
    process.env.SMTP_FROM ||
    (gmailUser() ? `Toro <${gmailUser()}>` : 'noreply@localhost')
  );
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT ?? 587);
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user: gmailUser(),
      pass: gmailPass(),
    },
  });
  return transporter;
}

function dashboardUrl(): string | null {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
  if (!base || !/^https?:\/\//.test(base)) return null;
  return `${base}/dashboard/`;
}

async function sendMail(params: OutboundEmail & { to: string }): Promise<boolean> {
  if (!isMailerConfigured()) {
    log.warn({ to: params.to, subject: params.subject }, 'SMTP not configured — email not sent');
    return false;
  }
  await getTransporter().sendMail({
    from: mailFrom(),
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
  log.info({ to: params.to, subject: params.subject }, 'email sent');
  return true;
}

export interface PasswordResetEmail {
  to: string;
  resetUrl: string;
  resetCode: string;
  expiresInMinutes: number;
  lang?: 'es' | 'en';
}

export function buildPasswordResetEmail(params: PasswordResetEmail): OutboundEmail {
  const spanish = params.lang !== 'en';
  const minutes = String(params.expiresInMinutes);
  if (spanish) {
    return composeEmail(`Toro — restablecer la contraseña de ${params.to}`, {
      lang: 'es',
      preheader: `El enlace vence en ${minutes} minutos y sirve una sola vez.`,
      heading: 'Restablecé la contraseña de tu cuenta',
      paragraphs: [
        `Recibimos una solicitud para elegir una contraseña nueva en la cuenta ${params.to}.`,
        `El código de un solo uso vence en ${minutes} minutos. Pegalo en la página de restablecimiento. Si pedís otro, este deja de servir.`,
        `Código: ${params.resetCode}`,
        'Si no pediste el cambio, ignorá este correo. La contraseña actual sigue igual.',
      ],
      cta: { label: 'Abrir la página de restablecimiento', href: params.resetUrl },
      notes: [
        'La página no incluye el código en la dirección. Copiá el código del correo y pegalo en el formulario. No reenvíes el código.',
      ],
      footer: `Toro envió este correo a ${params.to} porque alguien pidió restablecer la contraseña de esa cuenta.`,
    });
  }
  return composeEmail(`Toro — reset the password for ${params.to}`, {
    lang: 'en',
    preheader: `The link expires in ${minutes} minutes and works only once.`,
    heading: 'Reset the password for your account',
    paragraphs: [
      `We received a request to choose a new password for ${params.to}.`,
      `The single-use code expires in ${minutes} minutes. Paste it on the reset page. A newer request cancels this one.`,
      `Code: ${params.resetCode}`,
      'If you did not ask for this, ignore this email. Your current password stays the same.',
    ],
    cta: { label: 'Open the reset page', href: params.resetUrl },
    notes: [
      'The page address does not include the code. Copy the code from this email into the form. Do not forward the code.',
    ],
    footer: `Toro sent this email to ${params.to} because someone asked to reset the password for that account.`,
  });
}

export async function sendPasswordResetEmail(params: PasswordResetEmail): Promise<void> {
  if (!isMailerConfigured()) {
    log.warn(
      { to: params.to, expiresInMinutes: params.expiresInMinutes },
      'SMTP not configured — password reset email not sent'
    );
    return;
  }
  const mail = buildPasswordResetEmail(params);
  await sendMail({ to: params.to, ...mail });
}

export function buildWelcomeEmail(to: string, lang: 'es' | 'en' = 'es'): OutboundEmail {
  const dashboard = dashboardUrl();
  if (lang === 'en') {
    return composeEmail('Toro — your account is active', {
      lang: 'en',
      preheader: 'Next step: connect GRVT with Trade permission only, then create a paused bot.',
      heading: 'Your Toro account is active',
      paragraphs: [
        `${to} is verified. Toro does not hold funds. Orders are sent to your own GRVT account.`,
        'Connect API keys with the Trade permission only. Do not enable Withdraw or Transfer.',
        'Create a bot and leave it paused until you have checked the instrument, the price range, the leverage, and the margin. Nothing is sent to the exchange until you start that bot.',
      ],
      ...(dashboard ? { cta: { label: 'Open the dashboard', href: dashboard } } : {}),
      footer: `Toro sent this email to ${to} because that address finished signup.`,
    });
  }
  return composeEmail('Toro — tu cuenta ya está activa', {
    lang: 'es',
    preheader: 'Siguiente paso: conectá GRVT solo con permiso Trade y creá un bot en pausa.',
    heading: 'Tu cuenta de Toro está activa',
    paragraphs: [
      `${to} quedó verificado. Toro no custodia fondos. Las órdenes salen de tu cuenta de GRVT.`,
      'Conectá las API keys solo con permiso Trade. No actives Withdraw ni Transfer.',
      'Creá un bot y dejalo en pausa hasta revisar el instrumento, el rango de precios, el apalancamiento y el margen. No se envía nada al exchange hasta que inicies ese bot.',
    ],
    ...(dashboard ? { cta: { label: 'Abrir el dashboard', href: dashboard } } : {}),
    footer: `Toro envió este correo a ${to} porque esa dirección terminó el registro.`,
  });
}

export async function sendWelcomeEmail(to: string, lang: 'es' | 'en' = 'es'): Promise<void> {
  await sendMail({ to, ...buildWelcomeEmail(to, lang) });
}

export function buildAuthenticationCodeEmail(params: {
  to: string;
  code: string;
  purpose: 'signup' | 'login';
  lang: 'es' | 'en';
  expiresInMinutes: number;
}): OutboundEmail {
  const minutes = String(params.expiresInMinutes);
  const signup = params.purpose === 'signup';
  if (params.lang === 'es') {
    const heading = signup ? 'Código para verificar tu email' : 'Código para iniciar sesión';
    const subject = signup
      ? `Toro — código para verificar ${params.to}`
      : `Toro — código para entrar con ${params.to}`;
    return composeEmail(subject, {
      lang: 'es',
      preheader: `Código de 6 dígitos. Vence en ${minutes} minutos y sirve una sola vez.`,
      heading,
      paragraphs: signup
        ? [
            `Recibimos una solicitud para crear una cuenta de Toro con ${params.to}.`,
            `Ingresá este código de 6 dígitos en la pantalla de verificación. Vence en ${minutes} minutos y solo se puede usar una vez.`,
            'Toro no te va a pedir este código por otro canal. No lo reenvíes.',
          ]
        : [
            `Alguien intentó iniciar sesión en Toro con ${params.to}.`,
            `Si fuiste vos, ingresá este código de 6 dígitos. Vence en ${minutes} minutos y solo se puede usar una vez.`,
            'Si no fuiste vos, ignorá este correo. La contraseña no cambia y la sesión no se abre.',
          ],
      code: params.code,
      facts: [
        { label: 'Cuenta', value: params.to },
        { label: 'Uso del código', value: signup ? 'Verificar el email y crear la cuenta' : 'Iniciar sesión' },
        { label: 'Vigencia', value: `${minutes} minutos desde este envío`, accent: true },
        { label: 'Usos', value: 'Uno solo' },
      ],
      footer: `Toro envió este correo a ${params.to} para confirmar esa dirección.`,
    });
  }

  const heading = signup ? 'Code to verify your email' : 'Code to sign in';
  const subject = signup
    ? `Toro — code to verify ${params.to}`
    : `Toro — code to sign in as ${params.to}`;
  return composeEmail(subject, {
    lang: 'en',
    preheader: `6-digit code. It expires in ${minutes} minutes and works only once.`,
    heading,
    paragraphs: signup
      ? [
          `We received a request to create a Toro account for ${params.to}.`,
          `Enter this 6-digit code on the verification screen. It expires in ${minutes} minutes and can be used only once.`,
          'Toro will not ask you for this code on any other channel. Do not forward it.',
        ]
      : [
          `Someone tried to sign in to Toro as ${params.to}.`,
          `If that was you, enter this 6-digit code. It expires in ${minutes} minutes and can be used only once.`,
          'If that was not you, ignore this email. Your password does not change and no session is opened.',
        ],
    code: params.code,
    facts: [
      { label: 'Account', value: params.to },
      { label: 'Code is for', value: signup ? 'Verifying the email and creating the account' : 'Signing in' },
      { label: 'Expires', value: `${minutes} minutes after this email was sent`, accent: true },
      { label: 'Uses', value: 'Once' },
    ],
    footer: `Toro sent this email to ${params.to} to confirm that address.`,
  });
}

export async function sendAuthenticationCode(params: {
  to: string;
  code: string;
  purpose: 'signup' | 'login';
  lang: 'es' | 'en';
  expiresInMinutes: number;
}): Promise<boolean> {
  return sendMail({ to: params.to, ...buildAuthenticationCodeEmail(params) });
}

export async function sendNotificationEmail(params: OutboundEmail & { to: string }): Promise<boolean> {
  return sendMail(params);
}
