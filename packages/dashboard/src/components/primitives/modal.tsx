// Modal — native <dialog> for keyboard trap, Escape-to-close, and ARIA.
// Visual language matches Toro login/home: sharp edges, numbered kickers.

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  kicker?: string;
  size?: 'regular' | 'wide';
  children: ReactNode;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  footerStart?: ReactNode;
}

const SIZE_CLASS: Record<'regular' | 'wide', string> = {
  regular: 'max-w-[560px]',
  wide: 'max-w-[960px]',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  kicker,
  size = 'regular',
  children,
  headerExtra,
  footer,
  footerStart,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleBackdropClick}
      className={cn(
        'toro-modal p-0 overflow-hidden',
        'bg-bg-elevated text-text-primary border border-border-default shadow-lg',
        'backdrop:bg-black/72 backdrop:backdrop-blur-[2px]',
        'open:flex open:flex-col',
        'w-full max-h-[94dvh] md:max-h-[88dvh]',
        'fixed bottom-0 left-0 right-0 m-0 md:static md:m-auto',
        SIZE_CLASS[size],
      )}
      aria-modal="true"
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
    >
      <header className="relative shrink-0 border-b border-border-subtle">
        <div className="pointer-events-none absolute inset-0 opacity-[.05] [background-image:linear-gradient(#dc2626_1px,transparent_1px),linear-gradient(90deg,#dc2626_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative flex items-start justify-between gap-4 px-5 py-4 md:px-6">
          <div className="min-w-0">
            {kicker && (
              <p className="font-mono text-[10px] tracking-[.22em] text-primary">
                {kicker}
              </p>
            )}
            <h2
              id={titleId}
              className="text-[1.35rem] font-semibold leading-tight tracking-[-.03em] text-text-primary"
            >
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-xs leading-5 text-text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid size-8 shrink-0 place-items-center border border-border-default text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
          >
            <X className="size-4" />
          </button>
        </div>
        {headerExtra}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">{children}</div>

      {footer && (
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-5 py-3 md:px-6">
          <div className="min-w-0 text-[11px] leading-4 text-text-muted">
            {footerStart}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">{footer}</div>
        </footer>
      )}
    </dialog>
  );
}
