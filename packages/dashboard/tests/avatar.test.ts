import { describe, expect, it } from 'vitest';
import { communityAvatarUrl } from '@/lib/avatar';

const USER = '00000000-0000-4000-8000-000000000001';

describe('communityAvatarUrl', () => {
  it('omits the URL when the user has no photo', () => {
    expect(communityAvatarUrl(USER, false, 123)).toBeNull();
  });

  it('uses a path cache key so the image URL stays a real file request', () => {
    expect(communityAvatarUrl(USER, true, 1_758_000_000_000)).toBe(
      `/api/v2/community/avatar/${USER}/1758000000000`,
    );
  });

  it('serves the bare avatar path when there is no stamp', () => {
    expect(communityAvatarUrl(USER, true, null)).toBe(
      `/api/v2/community/avatar/${USER}`,
    );
  });
});
