// Same maintenance margin as the engine's computeLiqPriceLocal().
// Long liquidates below the anchor; short liquidates above it.
const MAINTENANCE_MARGIN = 0.005;

export function estimateLiquidationPrice(
  anchor: number,
  leverage: number,
  direction: 'long' | 'short',
): number | null {
  if (!(anchor > 0) || !(leverage >= 1)) return null;
  const factor = 1 / leverage - MAINTENANCE_MARGIN;
  if (factor <= 0) return null;
  const price = direction === 'long' ? anchor * (1 - factor) : anchor * (1 + factor);
  return price > 0 && Number.isFinite(price) ? price : null;
}

/** GRVT field `est_liquidation_price` on the live position payload. */
export function readPositionLiquidation(position: unknown): number | null {
  if (!position || typeof position !== 'object') return null;
  const row = position as Record<string, unknown>;
  const size = typeof row.size === 'number' ? row.size : parseFloat(String(row.size ?? ''));
  if (!Number.isFinite(size) || Math.abs(size) < 1e-8) return null;
  const raw = row.est_liquidation_price ?? row.el ?? row.liquidation_price;
  const price = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Prefer GRVT's liquidation price for the open position. The local
 * formula ignores cross margin and can be far from the exchange.
 * When there is no position, estimate from entry, mark, or range mid.
 */
export function resolveLiquidationPrice(input: {
  exchange?: number | null;
  stored: number | null | undefined;
  avgEntry: number | null | undefined;
  mark: number | null | undefined;
  lower: number;
  upper: number;
  leverage: number;
  direction: 'long' | 'short';
}): { price: number | null; estimated: boolean; source: 'exchange' | 'stored' | 'entry' | 'mark' | 'range' } {
  if (input.exchange != null && input.exchange > 0) {
    return { price: input.exchange, estimated: false, source: 'exchange' };
  }
  if (input.stored != null && input.stored > 0) {
    return { price: input.stored, estimated: false, source: 'stored' };
  }
  if (input.avgEntry != null && input.avgEntry > 0) {
    return {
      price: estimateLiquidationPrice(input.avgEntry, input.leverage, input.direction),
      estimated: true,
      source: 'entry',
    };
  }
  if (input.mark != null && input.mark > 0) {
    return {
      price: estimateLiquidationPrice(input.mark, input.leverage, input.direction),
      estimated: true,
      source: 'mark',
    };
  }
  return {
    price: estimateLiquidationPrice((input.lower + input.upper) / 2, input.leverage, input.direction),
    estimated: true,
    source: 'range',
  };
}
