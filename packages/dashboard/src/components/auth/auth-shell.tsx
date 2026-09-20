import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, LockKeyhole, Radio, ShieldCheck } from 'lucide-react';
import { useLang } from '@/i18n';

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
    <div className="min-h-dvh bg-[#e9e5dc] p-0 text-[#211c15] md:grid md:place-items-center md:p-6">
      <div className="mx-auto grid min-h-dvh w-full max-w-[1180px] overflow-hidden bg-[#fffdf8] shadow-[0_30px_90px_rgba(45,35,20,.16)] md:min-h-[720px] md:grid-cols-[.92fr_1.08fr] md:rounded-[1.4rem]">
        <aside className="relative hidden overflow-hidden bg-[#0c0a08] p-8 text-[#f6f0e6] md:flex md:flex-col lg:p-10">
          <div className="pointer-events-none absolute inset-0 opacity-[.08] [background-image:linear-gradient(#e8b84a_1px,transparent_1px),linear-gradient(90deg,#e8b84a_1px,transparent_1px)] [background-size:52px_52px]" />
          <Link to="/" className="relative inline-flex items-center gap-2.5 self-start">
            <span className="grid size-9 place-items-center rounded-md bg-[#e8b84a] font-bold text-[#0c0a08]">T</span>
            <span className="font-semibold tracking-[.12em]">TORO</span>
          </Link>

          <div className="relative mt-16">
            <p className="font-mono text-[10px] tracking-[.22em] text-[#e8b84a]">{kicker}</p>
            <h2 className="mt-4 max-w-md text-[2.65rem] font-semibold leading-[1.02] tracking-[-.045em]">
              {title}
            </h2>
            <p className="mt-5 max-w-md text-sm leading-6 text-[#b9ab96]">{body}</p>
          </div>

          <div className="relative mt-10 border border-[#3d342a] bg-[#12100d]/90 p-5">
            <div className="flex items-center justify-between border-b border-[#302920] pb-4">
              <div>
                <p className="font-mono text-[9px] tracking-[.16em] text-[#8f806b]">ETH / USDT</p>
                <p className="mt-1 font-mono text-xl">$3,581.60</p>
              </div>
              <span className="flex items-center gap-2 font-mono text-[9px] text-[#3dba74]">
                <Radio className="size-3" />
                LIVE
              </span>
            </div>
            <div className="relative mt-5 h-32">
              {[20, 43, 65, 88].map((top, index) => (
                <div
                  key={top}
                  className={`absolute left-0 h-px ${
                    index < 2 ? 'bg-[#e85d4c]' : 'bg-[#3dba74]'
                  }`}
                  style={{ top: `${top}%`, width: `${78 - index * 9}%` }}
                />
              ))}
              <div className="absolute left-0 top-[54%] h-px w-full bg-[#e8b84a] shadow-[0_0_10px_#e8b84a]" />
              <span
                className="absolute right-0 font-mono text-[9px] text-[#e8b84a]"
                style={{ top: 'calc(54% - 8px)' }}
              >
                MARK
              </span>
            </div>
            <div className="grid grid-cols-3 gap-px bg-[#302920]">
              {[
                [copy.range, '$3.2K—3.9K'],
                [copy.fills, '18'],
                [copy.risk, '4.2%'],
              ].map(([label, value]) => (
                <div key={label} className="bg-[#12100d] px-3 py-3">
                  <p className="text-[8px] tracking-wider text-[#796d5e]">{label}</p>
                  <p className="mt-1 font-mono text-[11px]">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mt-auto grid gap-2 pt-8">
            {copy.checks.map((item) => (
              <div key={item} className="flex items-center gap-2 text-xs text-[#b9ab96]">
                <Check className="size-3.5 text-[#3dba74]" />
                {item}
              </div>
            ))}
          </div>
        </aside>

        <section className="flex min-h-dvh flex-col bg-[#fffdf8] px-5 py-5 sm:px-10 md:min-h-0 md:px-10 md:py-8 lg:px-16">
          <div className="flex items-center justify-between">
            <Link to="/" className="inline-flex items-center gap-2 md:hidden">
              <span className="grid size-8 place-items-center rounded-md bg-[#d8a52d] font-bold text-[#0c0a08]">T</span>
              <span className="font-semibold tracking-[.1em]">TORO</span>
            </Link>
            <div className="ml-auto inline-flex overflow-hidden rounded-full border border-[#d9d2c6] bg-white p-0.5">
              {(['es', 'en'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={lang === item}
                  onClick={() => setLang(item)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${
                    lang === item ? 'bg-[#211c15] text-white' : 'text-[#756a5b]'
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
          <div className="flex items-center justify-center gap-2 text-[10px] text-[#8b8174]">
            <ShieldCheck className="size-3.5 text-[#208a57]" />
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
  'h-12 w-full rounded-lg border border-[#d8d2c8] bg-[#f3f5f6] px-4 text-sm text-[#211c15] outline-none transition placeholder:text-[#a59e94] focus:border-[#b9871d] focus:bg-white focus:ring-2 focus:ring-[#e8b84a]/20 disabled:opacity-60';

export const authButtonClass =
  'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#d7a52f] px-5 text-sm font-semibold text-[#17130e] transition hover:bg-[#c49222] disabled:cursor-not-allowed disabled:opacity-50';
