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
  if (!hasAvatar) return null;
  const version = cacheKey ? `?v=${cacheKey}` : '';
  return `${BASE_URL}/api/v2/community/avatar/${userId}${version}`;
}
