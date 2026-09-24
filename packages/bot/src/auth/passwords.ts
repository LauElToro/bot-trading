// Password hashing using bcryptjs.
//
// Pure JS, no native binaries — survives `npm install` on any host
// without a build toolchain. cost=12 is roughly equivalent to ~250ms
// per hash on a modern CPU, which is the standard recommendation
// (high enough to slow brute force, low enough to keep login snappy).

import bcrypt from 'bcryptjs';

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: string | null = null;

/** Burns the same bcrypt time when the account does not exist. */
export async function verifyPasswordOrDummy(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!dummyHash) dummyHash = await bcrypt.hash('timing-equalizer', COST);
  const target = hash && hash.length > 0 ? hash : dummyHash;
  return bcrypt.compare(plain, target);
}

export function passwordIssue(plain: string): 'too_short' | 'too_long' | null {
  const bytes = Buffer.byteLength(plain);
  if (bytes < 8) return 'too_short';
  if (bytes > 72) return 'too_long';
  return null;
}
