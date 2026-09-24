import { formatUsd } from '@/lib/format';

interface RangeBarProps {
  lower: number;
  upper: number;
  marker?: number | null;
  markerLabel?: string;
}

/** Horizontal band from the grid floor to the ceiling, with an optional entry mark. */
export function RangeBar({ lower, upper, marker, markerLabel }: RangeBarProps) {
  const span = upper - lower;
  const inside =
    marker != null &&
    Number.isFinite(marker) &&
    marker > 0 &&
    span > 0 &&
    marker >= lower &&
    marker <= upper;
  const pct = inside && marker != null ? ((marker - lower) / span) * 100 : 0;

  return (
    <div>
      <div className="relative h-1.5 bg-bg-muted" aria-hidden="true">
        <div className="absolute inset-0 bg-primary/25" />
        {inside && (
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-primary ring-2 ring-bg-elevated"
            style={{ left: `${pct}%` }}
            title={markerLabel}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 font-mono text-[10px] text-text-muted">
        <span>{formatUsd(lower)}</span>
        <span>{formatUsd(upper)}</span>
      </div>
    </div>
  );
}
