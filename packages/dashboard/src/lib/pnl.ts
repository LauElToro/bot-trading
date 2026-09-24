/**
 * GRVT's reported total is the number on the exchange. The two parts
 * sometimes disagree with it by fees or funding, so the headline is the
 * reported total and realized is whatever is left after unrealized.
 */
export function reconcilePnl(
  realized: number,
  unrealized: number,
  reportedTotal: number,
): { total: number; realized: number; unrealized: number } {
  const summed = realized + unrealized;
  const total = reportedTotal !== 0 || summed === 0 ? reportedTotal : summed;
  return { total, realized: total - unrealized, unrealized };
}
