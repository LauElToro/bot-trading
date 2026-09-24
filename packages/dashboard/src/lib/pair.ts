/** ETH_USDT_Perp → { asset: "ETH", market: "USDT Perp" }. */
export function pairParts(pair: string): { asset: string; market: string } {
  const parts = pair.split('_').filter(Boolean);
  const asset = parts[0] ?? pair;
  if (parts[1] === 'USDT' && parts.includes('Perp')) {
    return { asset, market: 'USDT Perp' };
  }
  return { asset, market: parts.slice(1).join(' ') || pair };
}
