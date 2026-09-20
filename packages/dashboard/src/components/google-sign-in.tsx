import { useEffect, useRef } from 'react';

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

export function isGoogleSignInEnabled(): boolean {
  return !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
}

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
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

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

  if (!clientId) return null;

  return (
    <div
      ref={hostRef}
      className={disabled ? 'pointer-events-none opacity-50' : undefined}
    />
  );
}
