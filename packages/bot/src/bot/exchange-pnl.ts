export function pnlFromExchangePosition(position: {
  unrealized_pnl?: string | number | null;
  realized_pnl?: string | number | null;
  total_pnl?: string | number | null;
} | null | undefined): { unrealized: number; realized: number; total: number } {
  if (!position) return { unrealized: 0, realized: 0, total: 0 };
  const num = (value: string | number | null | undefined) => {
    const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? n : 0;
  };
  const unrealized = num(position.unrealized_pnl);
  const realized = num(position.realized_pnl);
  const reported = typeof position.total_pnl === 'number'
    ? position.total_pnl
    : parseFloat(String(position.total_pnl ?? ''));
  const total = Number.isFinite(reported) ? reported : unrealized + realized;
  return { unrealized, realized, total };
}
