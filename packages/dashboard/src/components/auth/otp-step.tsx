import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { authButtonClass } from './auth-shell';
import { useLang } from '@/i18n';

const COPY = {
  es: {
    kicker: 'VERIFICACIÓN EN DOS PASOS',
    title: 'Revisá tu email',
    body: 'Enviamos un código de 6 dígitos a',
    code: 'Código de autenticación',
    verify: 'Verificar y continuar',
    verifying: 'Verificando…',
    noCode: '¿No llegó?',
    resend: 'Reenviar código',
    wait: 'Reenviar en {seconds}s',
    resent: 'Código reenviado',
    back: 'Volver y corregir el email',
  },
  en: {
    kicker: 'TWO-STEP VERIFICATION',
    title: 'Check your email',
    body: 'We sent a 6-digit code to',
    code: 'Authentication code',
    verify: 'Verify and continue',
    verifying: 'Verifying…',
    noCode: 'Didn’t get it?',
    resend: 'Resend code',
    wait: 'Resend in {seconds}s',
    resent: 'Code resent',
    back: 'Go back and edit the email',
  },
} as const;

export function OtpStep({
  emailHint,
  pending,
  error,
  onVerify,
  onResend,
  onBack,
}: {
  emailHint: string;
  pending: boolean;
  error?: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  onBack: () => void;
}) {
  const { lang } = useLang();
  const copy = COPY[lang];
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [cooldown, setCooldown] = useState(30);
  const [resent, setResent] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const code = digits.join('');

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    setDigits((current) => current.map((item, i) => (i === index ? digit : item)));
    if (digit && index < 5) inputs.current[index + 1]?.focus();
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    setDigits(Array.from({ length: 6 }, (_, index) => pasted[index] ?? ''));
    inputs.current[Math.min(5, pasted.length)]?.focus();
  }

  async function resend() {
    if (cooldown > 0) return;
    await onResend();
    setResent(true);
    setCooldown(30);
    window.setTimeout(() => setResent(false), 3000);
  }

  return (
    <div>
      <div className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
        <MailCheck className="size-6" />
      </div>
      <p className="mt-7 font-mono text-[10px] tracking-[.2em] text-primary">{copy.kicker}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-[-.035em] text-text-primary sm:text-4xl">
        {copy.title}
      </h1>
      <p className="mt-3 text-sm leading-6 text-text-muted">
        {copy.body} <strong className="font-semibold text-text-primary">{emailHint}</strong>.
      </p>

      <form
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === 6) void onVerify(code);
        }}
      >
        <label className="mb-2 block text-xs font-semibold text-text-secondary">{copy.code}</label>
        <div className="grid grid-cols-6 gap-2">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(node) => {
                inputs.current[index] = node;
              }}
              value={digit}
              onChange={(event) => setDigit(index, event.target.value)}
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (event.key === 'Backspace' && !digit && index > 0) {
                  inputs.current[index - 1]?.focus();
                }
              }}
              inputMode="numeric"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              aria-label={`${copy.code} ${index + 1}`}
              maxLength={1}
              disabled={pending}
              autoFocus={index === 0}
              className="h-14 min-w-0 rounded-lg border border-border-default bg-bg-surface text-center font-mono text-xl font-semibold text-text-primary outline-none focus:border-primary focus:bg-bg-base focus:ring-2 focus:ring-primary/15"
            />
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending || code.length !== 6} className={`${authButtonClass} mt-6`}>
          {pending ? copy.verifying : copy.verify}
        </button>
      </form>

      <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-text-muted">
        <span>{resent ? copy.resent : copy.noCode}</span>
        <button
          type="button"
          disabled={pending || cooldown > 0}
          onClick={() => void resend()}
          className="font-semibold text-primary hover:underline disabled:text-text-disabled disabled:no-underline"
        >
          {cooldown > 0
            ? copy.wait.replace('{seconds}', String(cooldown))
            : copy.resend}
        </button>
      </div>
      <button
        type="button"
        onClick={onBack}
        disabled={pending}
        className="mx-auto mt-7 flex items-center gap-2 text-xs text-text-muted hover:text-text-primary"
      >
        <ArrowLeft className="size-3.5" />
        {copy.back}
      </button>
    </div>
  );
}
