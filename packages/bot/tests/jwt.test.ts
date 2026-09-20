import { describe, it, expect } from 'vitest';
import {
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

  it('hashes refresh tokens stably', () => {
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
    expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('def'));
  });
});
