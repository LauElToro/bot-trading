import { randomUUID } from 'node:crypto';

export type UserId = string;

export const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TEST_OPERATOR_USER_ID = '00000000-0000-4000-8000-000000000001';

export function newUserId(): UserId {
  return randomUUID();
}

export function isUserId(value: unknown): value is UserId {
  return typeof value === 'string' && USER_ID_RE.test(value);
}

export function parseUserId(value: unknown): UserId | null {
  if (isUserId(value)) return value;
  return null;
}
