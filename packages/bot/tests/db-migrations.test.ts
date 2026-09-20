import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { GridBotDB } from '../src/database/db.js';

const migrationUrl = new URL(
  '../src/database/migrations/001_initial.sql',
  import.meta.url,
);

describe('PostgreSQL migration contract', () => {
  it('requires DATABASE_URL when initialization opens the pool', async () => {
    await expect(new GridBotDB('').initialize())
      .rejects.toThrow('DATABASE_URL is required');
  });

  it('defines the complete trading and identity schema', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    for (const table of [
      'users',
      'grid_bots',
      'grid_levels',
      'orders',
      'trades',
      'funding_history',
      'daily_snapshots',
      'fills_archive',
      'paired_roundtrips',
      'bot_cash_movements',
      'refresh_tokens',
      'grvt_credentials',
      'grvt_sub_accounts',
      'terms_acceptances',
      'password_reset_tokens',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain('id UUID PRIMARY KEY');
    expect(sql).toContain('UNIQUE(bot_id, level_index)');
    expect(sql).toContain('inherit_grid_bot_user_id');
  });

  it('uses PostgreSQL DDL and UUID ownership throughout', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).not.toMatch(
      /\bAUTOINCREMENT\b|\bPRAGMA\b|INSERT OR (?:IGNORE|REPLACE)|\browid\b/i,
    );
    expect(sql).toContain('BIGSERIAL PRIMARY KEY');
    expect(sql).toContain('LANGUAGE plpgsql');
    expect(sql).not.toMatch(/user_id INTEGER REFERENCES users/);
  });
});
