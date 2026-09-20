import { describe, it, expect } from 'vitest';
import {
  signTokenPair,
  verifyToken,
  verifyRefreshToken,
  hashRefreshToken,
} from '../src/auth/jwt.js';

describe('JWT access/refresh pair', () => {
  it('signs an access token that verifyToken accepts and verifyRefreshToken rejects', () => {
    const pair = signTokenPair(42);
    expect(verifyToken(pair.accessToken)?.userId).toBe(42);
    expect(verifyRefreshToken(pair.accessToken)).toBeNull();
  });

  it('signs a refresh token that verifyRefreshToken accepts and verifyToken rejects', () => {
    const pair = signTokenPair(42);
    expect(verifyRefreshToken(pair.refreshToken)?.userId).toBe(42);
    expect(verifyToken(pair.refreshToken)).toBeNull();
  });

  it('hashes refresh tokens stably', () => {
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
    expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('def'));
  });
});
