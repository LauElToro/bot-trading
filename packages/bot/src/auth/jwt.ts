// JWT helpers — HS256 access + refresh pair.
//
// Preferred secrets: JWT_ACCESS_SECRET + JWT_REFRESH_SECRET.
// Fallback: JWT_SECRET (legacy single-secret installs).
// Rotating either secret invalidates that token family.

import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { isUserId, type UserId } from './user-id.js';

const ISSUER = 'grvt-grid';
const DEFAULT_ACCESS_TTL = 2 * 60 * 60; // 2h
const DEFAULT_REFRESH_TTL = 14 * 24 * 60 * 60; // 14d

function readSecret(name: string, fallback?: string): string {
  const s = process.env[name] || fallback || '';
  if (!s || s.length < 32) {
    throw new Error(
      `${name} env var is missing or too short (need 32+ chars). ` +
        'Generate one with: openssl rand -base64 48'
    );
  }
  return s;
}

function getAccessSecret(): string {
  return readSecret('JWT_ACCESS_SECRET', process.env.JWT_SECRET);
}

function getRefreshSecret(): string {
  return readSecret('JWT_REFRESH_SECRET', process.env.JWT_SECRET);
}

export function accessTtlSeconds(): number {
  const n = Number(process.env.ACCESS_TOKEN_TTL_SECONDS);
  return Number.isFinite(n) && n > 60 ? Math.floor(n) : DEFAULT_ACCESS_TTL;
}

export function refreshTtlSeconds(): number {
  const n = Number(process.env.REFRESH_TOKEN_TTL_SECONDS);
  return Number.isFinite(n) && n > 60 ? Math.floor(n) : DEFAULT_REFRESH_TTL;
}

export interface JwtPayload {
  userId: UserId;
  tv: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function signAccessToken(userId: UserId, tokenVersion = 1): string {
  return jwt.sign(
    { userId, typ: 'access', tv: tokenVersion, jti: randomUUID() },
    getAccessSecret(),
    {
      algorithm: 'HS256',
      issuer: ISSUER,
      expiresIn: accessTtlSeconds(),
    },
  );
}

/** @deprecated Use signAccessToken. Kept so existing callers/tests keep compiling. */
export function signToken(userId: UserId, tokenVersion = 1): string {
  return signAccessToken(userId, tokenVersion);
}

export function signRefreshToken(userId: UserId): string {
  return jwt.sign({ userId, typ: 'refresh' }, getRefreshSecret(), {
    algorithm: 'HS256',
    issuer: ISSUER,
    expiresIn: refreshTtlSeconds(),
  });
}

export function signTokenPair(userId: UserId, tokenVersion = 1): TokenPair {
  return {
    accessToken: signAccessToken(userId, tokenVersion),
    refreshToken: signRefreshToken(userId),
    expiresIn: accessTtlSeconds(),
  };
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getAccessSecret(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
    });
    if (typeof decoded === 'object' && decoded !== null && 'userId' in decoded) {
      const typ = (decoded as { typ?: string }).typ;
      if (typ && typ !== 'access') return null;
      const userId = (decoded as { userId?: unknown }).userId;
      const tv = (decoded as { tv?: unknown }).tv;
      if (!isUserId(userId) || typeof tv !== 'number' || !Number.isInteger(tv) || tv < 1) {
        return null;
      }
      return { userId, tv };
    }
    return null;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): { userId: UserId } | null {
  try {
    const decoded = jwt.verify(token, getRefreshSecret(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
    });
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'userId' in decoded &&
      (decoded as { typ?: string }).typ === 'refresh'
    ) {
      const userId = (decoded as { userId?: unknown }).userId;
      return isUserId(userId) ? { userId } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
