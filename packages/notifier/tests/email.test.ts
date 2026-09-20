import { describe, it, expect } from 'vitest';
import { EmailClient, subjectForAlert } from '../src/email';

describe('EmailClient', () => {
  it('is a dry-run when SMTP/Gmail env is missing', async () => {
    const prevUser = process.env.GMAIL_USER;
    const prevPass = process.env.GMAIL_APP_PASSWORD;
    const prevHost = process.env.SMTP_HOST;
    const prevSmtpUser = process.env.SMTP_USER;
    const prevSmtpPass = process.env.SMTP_PASS;
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const c = new EmailClient();
    await expect(c.send('a@b.c', 'subj', 'body')).resolves.toBeUndefined();
    if (prevUser !== undefined) process.env.GMAIL_USER = prevUser;
    if (prevPass !== undefined) process.env.GMAIL_APP_PASSWORD = prevPass;
    if (prevHost !== undefined) process.env.SMTP_HOST = prevHost;
    if (prevSmtpUser !== undefined) process.env.SMTP_USER = prevSmtpUser;
    if (prevSmtpPass !== undefined) process.env.SMTP_PASS = prevSmtpPass;
  });
});

describe('subjectForAlert', () => {
  it('maps known types', () => {
    expect(subjectForAlert('drawdown')).toContain('drawdown');
    expect(subjectForAlert('fills')).toContain('round-trips');
    expect(subjectForAlert('custom')).toContain('custom');
  });
});
