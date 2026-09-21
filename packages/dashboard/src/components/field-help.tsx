import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

export function FieldHelp({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-2 flex gap-2 border border-border-subtle bg-bg-surface px-3 py-2.5">
      <Info className="mt-0.5 size-3.5 shrink-0 text-primary" strokeWidth={1.75} />
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-text-primary">{title}</p>
        <p className="mt-0.5 text-[11px] leading-5 text-text-muted">{children}</p>
      </div>
    </div>
  );
}
