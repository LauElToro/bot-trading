import { describe, expect, it } from 'vitest';
import { buildSafeguardEmail } from '../src/mail/alerts.js';
import {
  buildAuthenticationCodeEmail,
  buildPasswordResetEmail,
  buildWelcomeEmail,
} from '../src/mail/mailer.js';

const FORBIDDEN = ['#e8b84a', '#ef4444', '#111113', '#18181b', '#3f3f46', '#f6f0e6', '#4a3f32'];

function expectBrand(html: string) {
  expect(html).toContain('#0a0a0a');
  expect(html).toContain('#dc2626');
  expect(html).toContain('#ffffff');
  for (const color of FORBIDDEN) expect(html).not.toContain(color);
}

describe('transactional emails', () => {
  it('puts the signup code in the body and names the account', () => {
    const mail = buildAuthenticationCodeEmail({
      to: 'ana@example.com',
      code: '048213',
      purpose: 'signup',
      lang: 'es',
      expiresInMinutes: 10,
    });
    expect(mail.subject).toBe('Toro — código para verificar ana@example.com');
    expect(mail.subject).not.toContain('048213');
    expect(mail.text).toContain('Código: 048213');
    expect(mail.text).toContain('ana@example.com');
    expect(mail.text).toContain('10 minutos');
    expect(mail.text).toContain('crear una cuenta');
    expectBrand(mail.html);
    expect(mail.html).toContain('048213');
  });

  it('writes the login code in English when lang is en', () => {
    const mail = buildAuthenticationCodeEmail({
      to: 'ana@example.com',
      code: '111222',
      purpose: 'login',
      lang: 'en',
      expiresInMinutes: 10,
    });
    expect(mail.subject).toContain('sign in');
    expect(mail.text).toContain('Someone tried to sign in');
    expect(mail.text).toContain('Code: 111222');
    expectBrand(mail.html);
  });

  it('includes the reset link, the account, and the expiry', () => {
    const url = 'https://toro.example/dashboard/reset-password';
    const mail = buildPasswordResetEmail({
      to: 'ana@example.com',
      resetUrl: url,
      resetCode: 'abc123token',
      expiresInMinutes: 60,
      lang: 'es',
    });
    expect(mail.text).toContain(url);
    expect(mail.text).toContain('abc123token');
    expect(mail.text).not.toContain('?token=');
    expect(mail.text).toContain('ana@example.com');
    expect(mail.text).toContain('60 minutos');
    expect(mail.html).toContain('https://toro.example/dashboard/reset-password');
    expect(mail.html).not.toContain('?token=');
    expectBrand(mail.html);
  });

  it('tells a new account to use Trade permission only', () => {
    const prev = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://toro.example';
    const mail = buildWelcomeEmail('ana@example.com', 'es');
    process.env.APP_BASE_URL = prev;
    expect(mail.text).toContain('ana@example.com');
    expect(mail.text).toContain('permiso Trade');
    expect(mail.text).toContain('Withdraw');
    expect(mail.text).toContain('no custodia fondos');
    expect(mail.text).toContain('https://toro.example/dashboard/');
    expectBrand(mail.html);
  });

  it('explains a liquidation safeguard with the prices from the reason', () => {
    const mail = buildSafeguardEmail({
      to: 'ana@example.com',
      botId: 7,
      pair: 'ETH_USDT_Perp',
      action: 'pause',
      reason: 'SAFEGUARD:pause:bot=7:dist=3.25%:liq=1700.00:mark=1757.00',
    });
    expect(mail.subject).toContain('bot 7');
    expect(mail.subject).toContain('ETH_USDT_Perp');
    expect(mail.text).toContain('3.25%');
    expect(mail.text).toContain('$1700.00');
    expect(mail.text).toContain('$1757.00');
    expect(mail.text).toContain('sigue abierta');
    expectBrand(mail.html);
  });

  it('explains a stop-loss close with the configured threshold', () => {
    const mail = buildSafeguardEmail({
      to: 'ana@example.com',
      botId: 7,
      pair: 'ETH_USDT_Perp',
      action: 'pause_close',
      reason: 'SAFEGUARD:pause_close:bot=7:SL triggered at -12.5% (threshold 10%)',
    });
    expect(mail.text).toContain('-12.5%');
    expect(mail.text).toContain('10%');
    expect(mail.text).toContain('cerrar la posición');
    expectBrand(mail.html);
  });
});
