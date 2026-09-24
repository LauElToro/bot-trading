/** GRVT total when the engine has one; otherwise the sum of the two parts. */
export function livePnlSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `(CASE
    WHEN ${p}total_pnl_usdt <> 0
      OR (${p}grid_profit_usdt + ${p}trend_pnl_usdt) = 0
    THEN ${p}total_pnl_usdt
    ELSE ${p}grid_profit_usdt + ${p}trend_pnl_usdt
  END)`;
}

/** Realized restated so it plus unrealized equals livePnlSql. */
export function liveRealizedSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `(CASE
    WHEN ${p}total_pnl_usdt <> 0
      OR (${p}grid_profit_usdt + ${p}trend_pnl_usdt) = 0
    THEN ${p}total_pnl_usdt - ${p}trend_pnl_usdt
    ELSE ${p}grid_profit_usdt
  END)`;
}
