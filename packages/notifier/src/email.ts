// Email sink for notifier alerts. Uses Gmail app-password aliases
// (GMAIL_USER / GMAIL_APP_PASSWORD) or generic SMTP_* vars.

import nodemailer, { type Transporter } from 'nodemailer';
import { childLogger } from './logger.js';

const log = childLogger('email');

function gmailUser(): string {
  return (process.env.GMAIL_USER || process.env.SMTP_USER || '').trim();
}

function gmailPass(): string {
  return (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '').replace(/\s+/g, '');
}

function mailFrom(): string {
  return (
    process.env.MAIL_FROM ||
    process.env.SMTP_FROM ||
    (gmailUser() ? `Toro <${gmailUser()}>` : 'noreply@localhost')
  );
}

export function isEmailConfigured(): boolean {
  const host = process.env.SMTP_HOST || (gmailUser() ? 'smtp.gmail.com' : '');
  return !!(host && gmailUser() && gmailPass());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function wrapHtml(kicker: string, title: string, body: string): string {
  const escaped = escapeHtml(body).replace(/\n/g, '<br>');
  return (
    `<div style="background:#111113;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#fafafa">` +
    `<div style="max-width:560px;margin:auto">` +
    `<p style="color:#ef4444;font-size:11px;letter-spacing:2px;margin:0 0 16px">${escapeHtml(kicker)}</p>` +
    `<h1 style="font-size:22px;margin:0 0 20px;font-weight:600">${escapeHtml(title)}</h1>` +
    `<div style="padding:18px;border:1px solid #3f3f46;background:#18181b;font-family:Consolas,monospace;font-size:13px;line-height:1.6;color:#d4d4d8">` +
    `${escaped}` +
    `</div>` +
    `<p style="color:#71717a;font-size:12px;line-height:1.6;margin:20px 0 0">Toro · alertas de grilla. Este mail se envió porque hay un evento en tu cuenta.</p>` +
    `</div></div>`
  );
}

export class EmailClient {
  private readonly enabled: boolean;
  private transporter: Transporter | null = null;

  constructor() {
    this.enabled = isEmailConfigured();
    if (this.enabled) {
      log.info({ from: mailFrom() }, 'email notifications enabled');
    } else {
      log.warn('SMTP not configured — alert emails will not be sent');
    }
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT ?? 587);
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user: gmailUser(), pass: gmailPass() },
    });
    return this.transporter;
  }

  async send(to: string, subject: string, body: string, type = 'alert'): Promise<void> {
    if (!this.enabled || !to) {
      log.debug({ subject, to }, '[email dry-run] would send');
      return;
    }
    try {
      await this.getTransporter().sendMail({
        from: mailFrom(),
        to,
        subject,
        text: body,
        html: wrapHtml('TORO · ALERTA', subjectForAlert(type), body),
      });
      log.info({ to, subject }, 'alert email sent');
    } catch (err) {
      log.error({ err: (err as Error).message, to, subject }, 'email send failed');
    }
  }
}

export function subjectForAlert(type: string): string {
  switch (type) {
    case 'fills':
      return 'Toro — nuevos round-trips';
    case 'drawdown':
      return 'Toro — alerta de drawdown';
    case 'liq_proximity':
      return 'Toro — proximidad de liquidación';
    case 'status':
    case 'status_change':
      return 'Toro — cambio de estado del bot';
    case 'daily_summary':
      return 'Toro — resumen diario';
    default:
      return `Toro — ${type}`;
  }
}
