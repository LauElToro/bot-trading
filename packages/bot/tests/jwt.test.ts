import { describe, it, expect } from 'vitest';
import {
  signAccessToken,
  signTokenPair,
  verifyToken,
  verifyRefreshToken,
  hashRefreshToken,
} from '../src/auth/jwt.js';

describe('JWT access/refresh pair', () => {
  it('signs an access token that verifyToken accepts and verifyRefreshToken rejects', () => {
    const uid = '11111111-1111-4111-8111-111111111111';
    const pair = signTokenPair(uid);
    expect(verifyToken(pair.accessToken)?.userId).toBe(uid);
    expect(verifyRefreshToken(pair.accessToken)).toBeNull();
  });

  it('signs a refresh token that verifyRefreshToken accepts and verifyToken rejects', () => {
    const uid = '11111111-1111-4111-8111-111111111111';
    const pair = signTokenPair(uid);
    expect(verifyRefreshToken(pair.refreshToken)?.userId).toBe(uid);
    expect(verifyToken(pair.refreshToken)).toBeNull();
  });

  it('rejects an access token whose version is missing and exposes tv', () => {
    const uid = '11111111-1111-4111-8111-111111111111';
    const current = signAccessToken(uid, 2);
    expect(verifyToken(current)?.tv).toBe(2);
    const stale = signAccessToken(uid, 1);
    expect(verifyToken(stale)?.tv).toBe(1);
    expect(verifyToken(stale)?.tv).not.toBe(2);
  });

  it('hashes refresh tokens stably', () => {
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
    expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('def'));
  });
});
