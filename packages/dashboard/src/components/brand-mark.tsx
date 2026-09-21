import { cn } from '@/lib/cn';
import { BRAND_NAME } from '@/lib/brand';

interface BrandMarkProps {
  compact?: boolean;
  inverted?: boolean;
  className?: string;
}

export function BrandMark({ compact = false, inverted = false, className }: BrandMarkProps) {
  return (
    <div className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'grid place-items-center shrink-0 bg-primary text-white font-bold leading-none select-none',
          compact ? 'size-7 text-sm' : 'size-9 text-base'
        )}
        aria-hidden="true"
      >
        T
      </span>
      <span
        className={cn(
          'font-semibold tracking-[0.12em]',
          inverted ? 'text-white' : 'text-text-primary',
          compact ? 'text-sm' : 'text-base'
        )}
      >
        {BRAND_NAME.toUpperCase()}
      </span>
    </div>
  );
}
