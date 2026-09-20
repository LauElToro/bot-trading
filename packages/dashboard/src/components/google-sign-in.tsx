import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {
            client_id: string;
            callback: (resp: { credential: string }) => void;
            ux_mode?: 'popup' | 'redirect';
          }) => void;
          renderButton: (
            parent: HTMLElement,
            opts: {
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              width?: number;
              text?: 'signin_with' | 'signup_with' | 'continue_with';
              locale?: string;
            }
          ) => void;
        };
      };
    };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const BUILD_TIME_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export function GoogleSignInButton({
  onCredential,
  disabled,
  label,
  locale = 'es',
}: {
  onCredential: (idToken: string) => void;
  disabled?: boolean;
  label?: 'signin_with' | 'signup_with' | 'continue_with';
  locale?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | undefined>(BUILD_TIME_CLIENT_ID);
  const [configResolved, setConfigResolved] = useState(!!BUILD_TIME_CLIENT_ID);

  useEffect(() => {
    if (BUILD_TIME_CLIENT_ID) return;
    let cancelled = false;
    api.getAuthConfig()
      .then((config) => {
        if (!cancelled && config?.googleAuthEnabled && config.googleClientId) {
          setClientId(config.googleClientId);
        }
      })
      .catch(() => {
        // Keep the visible unavailable state; password login remains usable.
      })
      .finally(() => {
        if (!cancelled) setConfigResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!clientId || !hostRef.current || disabled) return;
    const host = hostRef.current;

    const render = () => {
      if (!window.google?.accounts?.id || !host) return;
      host.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => {
          if (resp.credential) onCredential(resp.credential);
        },
        ux_mode: 'popup',
      });
      window.google.accounts.id.renderButton(host, {
        theme: 'outline',
        size: 'large',
        width: Math.min(host.clientWidth || 320, 400),
        text: label ?? 'continue_with',
        locale,
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing && window.google?.accounts?.id) {
      render();
      return;
    }
    const script = existing ?? document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = render;
    if (!existing) document.head.appendChild(script);
  }, [clientId, disabled, label, locale, onCredential]);

  if (!clientId) {
    const text = label === 'signup_with'
      ? (locale === 'es' ? 'Registrarse con Google' : 'Sign up with Google')
      : (locale === 'es' ? 'Continuar con Google' : 'Continue with Google');
    return (
      <div>
        <button
          type="button"
          disabled
          className="flex h-10 w-full items-center justify-center gap-3 rounded border border-border-default bg-bg-base text-sm text-text-secondary opacity-60"
        >
          <span className="font-bold text-primary" aria-hidden="true">G</span>
          {configResolved ? text : `${text}…`}
        </button>
        {configResolved && (
          <p className="mt-1.5 text-center text-[10px] text-text-disabled">
            {locale === 'es' ? 'Google todavía no está configurado.' : 'Google is not configured yet.'}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className={disabled ? 'pointer-events-none opacity-50' : undefined}
    />
  );
}
