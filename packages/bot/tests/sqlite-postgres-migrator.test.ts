import { describe, expect, it } from 'vitest';
import {
  checksumRows,
  normalizeRow,
  parseArgs,
} from '../tools/migrate-sqlite-to-postgres.js';

describe('SQLite to PostgreSQL migrator', () => {
  it('requires an external PostgreSQL URL', () => {
    expect(() => parseArgs([], {})).toThrow('DATABASE_URL');
    expect(parseArgs(
      ['--source=legacy.db', '--batch-size=250', '--dry-run'],
      { DATABASE_URL: 'postgresql://example/test' },
    )).toMatchObject({
      source: 'legacy.db',
      databaseUrl: 'postgresql://example/test',
      batchSize: 250,
      dryRun: true,
    });
  });

  it('maps legacy integer owners to stable UUID values', () => {
    const map = new Map([
      ['1', '11111111-1111-4111-8111-111111111111'],
    ]);
    expect(normalizeRow('users', { id: 1, email: 'owner@example.com' }, map))
      .toMatchObject({ id: '11111111-1111-4111-8111-111111111111' });
    expect(normalizeRow('grid_bots', { id: 9, user_id: 1 }, map))
      .toMatchObject({ id: 9, user_id: '11111111-1111-4111-8111-111111111111' });
  });

  it('produces deterministic checksums independent of object key order', () => {
    expect(checksumRows([{ a: 1, b: 2 }]))
      .toBe(checksumRows([{ b: 2, a: 1 }]));
  });
});
