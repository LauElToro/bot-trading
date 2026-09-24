const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export function publicDisplayName(name: string | null | undefined, email?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const local = email?.split('@')[0];
  return local && local.length > 0 ? local : 'Trader';
}

export function communityAvatarUrl(
  userId: string,
  hasAvatar: boolean,
  cacheKey?: number | null,
): string | null {
  if (!hasAvatar || !userId) return null;
  // Path segment, not a query string. Some edges cache or drop `?v=` and
  // then the header/profile URL 404s while the bare podium URL still works.
  const version = typeof cacheKey === 'number' && Number.isFinite(cacheKey) && cacheKey > 0
    ? `/${Math.trunc(cacheKey)}`
    : '';
  return `${BASE_URL}/api/v2/community/avatar/${encodeURIComponent(userId)}${version}`;
}
