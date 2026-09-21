import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        {eyebrow && (
          <p className="mb-2 font-mono text-[10px] tracking-[.22em] text-primary">{eyebrow}</p>
        )}
        <h1 className="text-3xl font-semibold tracking-[-.04em] text-text-primary sm:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}
