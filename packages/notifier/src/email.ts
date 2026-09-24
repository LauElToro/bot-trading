// Email sink for notifier alerts. Uses Gmail app-password aliases
// (GMAIL_USER / GMAIL_APP_PASSWORD) or generic SMTP_* vars.

import nodemailer, { type Transporter } from 'nodemailer';
import type { OutboundEmail } from './email-layout.js';
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

  async send(to: string, mail: OutboundEmail): Promise<void> {
    if (!this.enabled || !to) {
      log.debug({ subject: mail.subject, to }, '[email dry-run] would send');
      return;
    }
    try {
      await this.getTransporter().sendMail({
        from: mailFrom(),
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      log.info({ to, subject: mail.subject }, 'alert email sent');
    } catch (err) {
      log.error({ err: (err as Error).message, to, subject: mail.subject }, 'email send failed');
    }
  }
}
