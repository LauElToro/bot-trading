// Compact equity sparkline for BotCard. No axes, no tooltip.
// Color follows the move: blue when the series rises, red when it falls.

import { Area, AreaChart, ResponsiveContainer } from 'recharts';

interface SparklineProps {
  data: Array<{ value: number }>;
  height?: number;
  id?: string;
  /** Used when there are not enough points to draw a series. */
  positive?: boolean;
}

export function Sparkline({ data, height = 56, id = 'spark', positive }: SparklineProps) {
  if (data.length < 2) {
    const stroke =
      positive === true
        ? 'var(--color-success)'
        : positive === false
          ? 'var(--color-danger)'
          : 'var(--color-text-disabled)';
    return (
      <div style={{ height, width: '100%' }} role="img" aria-label="Equity sparkline unavailable">
        <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="block h-full w-full" aria-hidden="true">
          <line x1="0" y1="5" x2="100" y2="5" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    );
  }

  const first = data[0]?.value ?? 0;
  const last = data[data.length - 1]?.value ?? 0;
  const isUp = positive ?? last >= first;
  const stroke = isUp ? 'var(--color-success)' : 'var(--color-danger)';
  const fillId = `spark-${id}-${isUp ? 'up' : 'down'}`;
  const pctChange = first > 0 ? ((last - first) / first) * 100 : 0;
  const direction = isUp ? 'up' : 'down';
  const ariaLabel = `Equity sparkline ${direction} ${pctChange.toFixed(1)}% over ${data.length} snapshots`;

  return (
    <div style={{ height, width: '100%' }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${fillId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
