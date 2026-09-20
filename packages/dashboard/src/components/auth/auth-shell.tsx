import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, LockKeyhole, Radio, ShieldCheck } from 'lucide-react';
import { useLang } from '@/i18n';
import { ThemeToggle } from '@/components/theme-toggle';

const COPY = {
  es: {
    loginKicker: 'ACCESO SEGURO',
    loginTitle: 'Tu estrategia sigue trabajando.',
    loginBody: 'Volvé al centro de control para revisar tus grillas, fills y exposición en tiempo real.',
    signupKicker: 'EMPEZÁ CON CONTROL',
    signupTitle: 'Construí tu grilla antes de activarla.',
    signupBody: 'Configurá el rango, medí el riesgo y revisá cada orden antes de usar fondos reales.',
    checks: ['Código OTP por email', 'Credenciales cifradas', 'Bots creados en pausa'],
    range: 'RANGO ACTIVO',
    fills: 'FILLS HOY',
    risk: 'RIESGO',
    protected: 'SESIÓN PROTEGIDA',
  },
  en: {
    loginKicker: 'SECURE ACCESS',
    loginTitle: 'Your strategy keeps working.',
    loginBody: 'Return to the control center to review your grids, fills, and exposure in real time.',
    signupKicker: 'START IN CONTROL',
    signupTitle: 'Build your grid before switching it on.',
    signupBody: 'Set the range, measure risk, and review every order before using real funds.',
    checks: ['Email OTP code', 'Encrypted credentials', 'Bots start paused'],
    range: 'ACTIVE RANGE',
    fills: 'FILLS TODAY',
    risk: 'RISK',
    protected: 'PROTECTED SESSION',
  },
} as const;

export function AuthShell({
  mode,
  children,
}: {
  mode: 'login' | 'signup';
  children: ReactNode;
}) {
  const { lang, setLang } = useLang();
  const copy = COPY[lang];
  const title = mode === 'login' ? copy.loginTitle : copy.signupTitle;
  const body = mode === 'login' ? copy.loginBody : copy.signupBody;
  const kicker = mode === 'login' ? copy.loginKicker : copy.signupKicker;

  return (
    <div className="min-h-dvh bg-bg-muted p-0 text-text-primary md:grid md:place-items-center md:p-6">
      <div className="mx-auto grid min-h-dvh w-full max-w-[1180px] overflow-hidden bg-bg-base shadow-lg md:min-h-[720px] md:grid-cols-[.92fr_1.08fr] md:rounded-[1.4rem]">
        <aside className="relative hidden overflow-hidden bg-[#101114] p-8 text-white md:flex md:flex-col lg:p-10">
          <div className="pointer-events-none absolute inset-0 opacity-[.09] [background-image:linear-gradient(#dc2626_1px,transparent_1px),linear-gradient(90deg,#dc2626_1px,transparent_1px)] [background-size:52px_52px]" />
          <Link to="/" className="relative inline-flex items-center gap-2.5 self-start">
            <span className="grid size-9 place-items-center rounded-md bg-primary font-bold text-white">T</span>
            <span className="font-semibold tracking-[.12em]">TORO</span>
          </Link>

          <div className="relative mt-16">
            <p className="font-mono text-[10px] tracking-[.22em] text-[#f87171]">{kicker}</p>
            <h2 className="mt-4 max-w-md text-[2.65rem] font-semibold leading-[1.02] tracking-[-.045em]">
              {title}
            </h2>
            <p className="mt-5 max-w-md text-sm leading-6 text-[#a1a1aa]">{body}</p>
          </div>

          <div className="relative mt-10 border border-[#3f3f46] bg-[#18181b]/90 p-5">
            <div className="flex items-center justify-between border-b border-[#3f3f46] pb-4">
              <div>
                <p className="font-mono text-[9px] tracking-[.16em] text-[#a1a1aa]">ETH / USDT</p>
                <p className="mt-1 font-mono text-xl">$3,581.60</p>
              </div>
              <span className="flex items-center gap-2 font-mono text-[9px] text-[#f87171]">
                <Radio className="size-3" />
                LIVE
              </span>
            </div>
            <div className="relative mt-5 h-32">
              {[20, 43, 65, 88].map((top, index) => (
                <div
                  key={top}
                  className={`absolute left-0 h-px ${
                    index < 2 ? 'bg-[#ef4444]' : 'bg-[#3b82f6]'
                  }`}
                  style={{ top: `${top}%`, width: `${78 - index * 9}%` }}
                />
              ))}
              <div className="absolute left-0 top-[54%] h-px w-full bg-[#ef4444] shadow-[0_0_10px_#ef4444]" />
              <span
                className="absolute right-0 font-mono text-[9px] text-[#f87171]"
                style={{ top: 'calc(54% - 8px)' }}
              >
                MARK
              </span>
            </div>
            <div className="grid grid-cols-3 gap-px bg-[#3f3f46]">
              {[
                [copy.range, '$3.2K—3.9K'],
                [copy.fills, '18'],
                [copy.risk, '4.2%'],
              ].map(([label, value]) => (
                <div key={label} className="bg-[#18181b] px-3 py-3">
                  <p className="text-[8px] tracking-wider text-[#a1a1aa]">{label}</p>
                  <p className="mt-1 font-mono text-[11px]">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mt-auto grid gap-2 pt-8">
            {copy.checks.map((item) => (
              <div key={item} className="flex items-center gap-2 text-xs text-[#d4d4d8]">
                <Check className="size-3.5 text-[#f87171]" />
                {item}
              </div>
            ))}
          </div>
        </aside>

        <section className="flex min-h-dvh flex-col bg-bg-base px-5 py-5 sm:px-10 md:min-h-0 md:px-10 md:py-8 lg:px-16">
          <div className="flex items-center justify-between">
            <Link to="/" className="inline-flex items-center gap-2 md:hidden">
              <span className="grid size-8 place-items-center rounded-md bg-primary font-bold text-white">T</span>
              <span className="font-semibold tracking-[.1em]">TORO</span>
            </Link>
            <ThemeToggle className="ml-auto mr-2 rounded-full" />
            <div className="inline-flex overflow-hidden rounded-full border border-border-subtle bg-bg-elevated p-0.5">
              {(['es', 'en'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={lang === item}
                  onClick={() => setLang(item)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${
                    lang === item ? 'bg-primary text-white' : 'text-text-muted'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center py-8">
            {children}
          </div>
          <div className="flex items-center justify-center gap-2 text-[10px] text-text-muted">
            <ShieldCheck className="size-3.5 text-primary" />
            {copy.protected}
            <span aria-hidden="true">·</span>
            <LockKeyhole className="size-3" />
            AES-256-GCM
          </div>
        </section>
      </div>
    </div>
  );
}

export const authInputClass =
  'h-12 w-full rounded-lg border border-border-default bg-bg-surface px-4 text-sm text-text-primary outline-none transition placeholder:text-text-disabled focus:border-primary focus:bg-bg-base focus:ring-2 focus:ring-primary/15 disabled:opacity-60';

export const authButtonClass =
  'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-50';
