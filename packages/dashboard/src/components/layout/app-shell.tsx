import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { KeyboardShortcutsModal } from '../keyboard-shortcuts-modal';
import { useUiStore } from '@/stores/ui-store';

export function AppShell() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const pendingChord = useRef<string | null>(null);
  const chordTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).isContentEditable) return;

      const key = e.key.toLowerCase();

      if (pendingChord.current) {
        const chord = pendingChord.current + key;
        pendingChord.current = null;
        clearTimeout(chordTimer.current);

        switch (chord) {
          case 'go': navigate('/dashboard'); return;
          case 'gb': navigate('/dashboard/bots'); return;
          case 'gp': navigate('/dashboard/podio'); return;
          case 'gh': navigate('/dashboard/guia'); return;
          case 'gs': navigate('/dashboard/settings'); return;
          case 'nb':
            window.dispatchEvent(new CustomEvent('wizard:open'));
            return;
        }
        return;
      }

      if (key === 'g' || key === 'n') {
        pendingChord.current = key;
        chordTimer.current = setTimeout(() => {
          pendingChord.current = null;
        }, 500);
        return;
      }

      switch (key) {
        case '?':
          setShortcutsOpen(true);
          break;
        case 't':
          toggleTheme();
          break;
        case 'escape':
          setShortcutsOpen(false);
          setNavOpen(false);
          break;
      }
    },
    [navigate, toggleTheme],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex min-h-dvh bg-bg-base text-text-primary">
      <a
        href="#main-content"
        className="absolute left-2 top-2 z-50 -translate-y-16 bg-primary px-3 py-2 text-xs font-semibold text-bg-base transition-transform focus-visible:translate-y-0"
      >
        Skip to main content
      </a>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenNav={() => setNavOpen(true)} />
        <main
          id="main-content"
          tabIndex={-1}
          className="relative flex-1 min-w-0 overflow-y-auto p-4 md:p-8 focus:outline-none"
        >
          <div className="pointer-events-none absolute inset-0 opacity-[.035] [background-image:linear-gradient(var(--color-text-primary)_1px,transparent_1px),linear-gradient(90deg,var(--color-text-primary)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="relative mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
