// F.5 — Email sink for notifier alerts. Uses Gmail app-password aliases
// (GMAIL_USER / GMAIL_APP_PASSWORD) or generic SMTP_* vars. When neither
// is set the client is a no-op so Telegram-only installs stay unchanged.

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

export class EmailClient {
  private readonly enabled: boolean;
  private transporter: Transporter | null = null;

  constructor() {
    this.enabled = isEmailConfigured();
    if (this.enabled) {
      log.info({ from: mailFrom() }, 'email notifications enabled');
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

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.enabled || !to) {
      log.debug({ subject }, '[email dry-run] would send');
      return;
    }
    const escaped = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    try {
      await this.getTransporter().sendMail({
        from: mailFrom(),
        to,
        subject,
        text: body,
        html: `<pre style="font-family:ui-sans-serif,system-ui,sans-serif;white-space:pre-wrap;line-height:1.45">${escaped}</pre>`,
      });
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
      return 'Toro — cambio de estado del bot';
    case 'daily_summary':
      return 'Toro — resumen diario';
    default:
      return `Toro — ${type}`;
  }
}
