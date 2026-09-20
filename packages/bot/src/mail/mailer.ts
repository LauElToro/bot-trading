// Outbound email — password reset + transactional notifications.
//
// SMTP is OPTIONAL. Configure either the generic SMTP_* vars or the
// Gmail aliases (GMAIL_USER + GMAIL_APP_PASSWORD). If neither is set,
// password-reset URLs are logged at WARN for out-of-band delivery.

import nodemailer, { type Transporter } from 'nodemailer';
import { childLogger } from '../server/logger.js';

const log = childLogger('mailer');

let transporter: Transporter | null = null;

function gmailUser(): string {
  return (process.env.GMAIL_USER || process.env.SMTP_USER || '').trim();
}

function gmailPass(): string {
  // Gmail app passwords are often pasted with spaces; nodemailer wants
  // the 16 chars either way, but stripping is more reliable.
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

async function sendMail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
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
  expiresInMinutes: number;
}

export async function sendPasswordResetEmail(params: PasswordResetEmail): Promise<void> {
  if (!isMailerConfigured()) {
    log.warn(
      { to: params.to, resetUrl: params.resetUrl, expiresInMinutes: params.expiresInMinutes },
      'SMTP not configured — password reset URL must be delivered manually'
    );
    return;
  }
  await sendMail({
    to: params.to,
    subject: 'Reset your Toro password',
    text:
      `We received a request to reset the password for this account.\n\n` +
      `Click the link below to choose a new password:\n${params.resetUrl}\n\n` +
      `This link expires in ${params.expiresInMinutes} minutes and can be used only once. ` +
      `If you did not request this, you can ignore this email — your password will stay the same.`,
    html:
      `<p>We received a request to reset the password for this account.</p>` +
      `<p><a href="${params.resetUrl}">Reset your password</a></p>` +
      `<p>This link expires in ${params.expiresInMinutes} minutes and can be used only once. ` +
      `If you did not request this, you can ignore this email — your password will stay the same.</p>`,
  });
}

export async function sendWelcomeEmail(to: string): Promise<void> {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, '') || '';
  const dashboardUrl = base ? `${base}/dashboard/` : '/dashboard/';
  await sendMail({
    to,
    subject: 'Bienvenido a Toro',
    text:
      `Tu cuenta está lista.\n\n` +
      `Siguiente paso: conectá tus credenciales de GRVT (solo permiso Trade) y creá un bot en pausa.\n` +
      `${dashboardUrl}\n`,
    html:
      `<p>Tu cuenta está lista.</p>` +
      `<p>Siguiente paso: conectá tus credenciales de GRVT (solo permiso Trade) y creá un bot en pausa.</p>` +
      `<p><a href="${dashboardUrl}">Abrir el dashboard</a></p>`,
  });
}

export async function sendNotificationEmail(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<boolean> {
  const escaped = params.body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return sendMail({
    to: params.to,
    subject: params.subject,
    text: params.body,
    html: `<pre style="font-family:ui-sans-serif,system-ui,sans-serif;white-space:pre-wrap;line-height:1.45">${escaped}</pre>`,
  });
}
