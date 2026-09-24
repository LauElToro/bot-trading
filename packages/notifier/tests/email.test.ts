import { describe, it, expect } from 'vitest';
import { EmailClient } from '../src/email';
import { drawdownTemplate, profitMilestoneTemplate, statusChangeTemplate, fillsTemplate } from '../src/templates';
import type { BotRow, RoundtripRow } from '../src/db';

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
    await expect(c.send('a@b.c', {
      subject: 'subj',
      text: 'body',
      html: '<p>body</p>',
    })).resolves.toBeUndefined();
    if (prevUser !== undefined) process.env.GMAIL_USER = prevUser;
    if (prevPass !== undefined) process.env.GMAIL_APP_PASSWORD = prevPass;
    if (prevHost !== undefined) process.env.SMTP_HOST = prevHost;
    if (prevSmtpUser !== undefined) process.env.SMTP_USER = prevSmtpUser;
    if (prevSmtpPass !== undefined) process.env.SMTP_PASS = prevSmtpPass;
  });
});

function bot(): BotRow {
  return {
    id: 3,
    pair: 'ETH_USDT_Perp',
    status: 'running',
    direction: 'short',
    leverage: 10,
    investment_usdt: 100,
    total_pnl_usdt: 24.69,
    grid_profit_usdt: 0.61,
    trend_pnl_usdt: 24.08,
    avg_entry_price: 2768,
    liquidation_price: 3759,
  };
}

function rt(): RoundtripRow {
  return {
    id: 1,
    bot_id: 3,
    user_id: 'user-1',
    buy_price: 2743.2,
    sell_price: 2747.8,
    size: 0.03,
    profit: 0.14,
    created_at: '2026-09-21T22:00:00Z',
  };
}

describe('alert email subjects', () => {
  it('names the event instead of a generic label', () => {
    expect(drawdownTemplate(8000, 10000, 15).subject).toContain('equity');
    expect(profitMilestoneTemplate({
      bot: bot(),
      milestonePct: 20,
    }).subject).toContain('PnL');
    expect(fillsTemplate([rt()]).subject).toContain('round-trip');
    expect(statusChangeTemplate(bot(), 'running', 'paused').subject).toContain('en pausa');
  });
});
