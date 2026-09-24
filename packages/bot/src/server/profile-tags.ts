import { createHash, randomInt } from 'node:crypto';
import type { QueryExecutor } from '../database/postgres.js';
import type { UserId } from '../auth/user-id.js';

export const MAX_PROFILE_TAGS = 1;

const WORDS = [
  'Cripto', 'Grid', 'Toro', 'Rango', 'Nivel', 'Margen', 'Alpha', 'Perp',
  'Banda', 'Swing', 'Delta', 'Sigma', 'Nova', 'Atlas', 'Norte', 'Brasa',
  'Nube', 'Rayo', 'Ola', 'Fuego', 'Lumen', 'Omega', 'Cobre', 'Viento',
];

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export class TagTakenError extends Error {
  tag: string;
  handle: string;
  constructor(tag: string, handle?: string) {
    super('tag_taken');
    this.name = 'TagTakenError';
    this.tag = tag;
    this.handle = handle ?? `${tag}`;
  }
}

/** Visible name: public display name, or an opaque alias. Never the email. */
export function identityName(displayName: string | null | undefined, opaqueId?: string | null): string {
  const trimmed = displayName?.trim();
  if (trimmed) return trimmed;
  const suffix = createHash('sha256').update(opaqueId || 'anon').digest('hex').slice(0, 4);
  return `Trader ${suffix}`;
}

/** Case-insensitive key for Nombre#TAG. LauToro#LAS and lautoro#las are the same handle. */
export function handleKey(name: string, tag: string): string {
  return `${name.trim().toLowerCase()}#${tag.trim().toLowerCase()}`;
}

export function formatHandle(name: string, tag: string): string {
  return `${name.trim()}#${tag.trim()}`;
}

export function randomTag(): string {
  if (randomInt(2) === 0) {
    return Array.from({ length: 3 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
  }
  const word = WORDS[randomInt(WORDS.length)] ?? 'Grid';
  return randomInt(2) === 0 ? word : `${word}${randomInt(10, 100)}`;
}

export function normalizeTag(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#+/u, '');
  if (/\s/u.test(cleaned)) return null;
  if (!/^[\p{L}\p{N}]{2,16}$/u.test(cleaned)) return null;
  return cleaned;
}

export function parseTagList(value: unknown): string[] {
  const read = (items: unknown[]): string[] => {
    const tags: string[] = [];
    for (const item of items) {
      const tag = normalizeTag(String(item));
      if (tag) tags.push(tag);
      if (tags.length >= MAX_PROFILE_TAGS) break;
    }
    return tags;
  };
  if (Array.isArray(value)) return read(value);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? read(parsed) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function collectTags(input: unknown): { tags: string[] } | { error: 'invalid' | 'too_many' } {
  if (!Array.isArray(input)) return { error: 'invalid' };
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const tag = normalizeTag(String(item ?? ''));
    if (!tag) return { error: 'invalid' };
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > MAX_PROFILE_TAGS) return { error: 'too_many' };
  return { tags };
}

export async function listUserTags(db: QueryExecutor, userId: UserId): Promise<string[]> {
  const rows = await db.all<{ tag: string }>(
    `SELECT tag FROM user_tags WHERE user_id = ? ORDER BY position ASC LIMIT 1`,
    [userId],
  );
  return rows.map((row) => row.tag);
}

async function loadIdentity(db: QueryExecutor, userId: UserId): Promise<string> {
  const row = await db.get<{ display_name: string | null; email: string }>(
    `SELECT display_name, email FROM users WHERE id = ?`,
    [userId],
  );
  return identityName(row?.display_name, userId);
}

async function handleOwner(db: QueryExecutor, key: string): Promise<string | undefined> {
  const row = await db.get<{ id: string }>(
    `SELECT id FROM users WHERE handle_key = ?`,
    [key],
  );
  return row?.id;
}

async function insertTag(db: QueryExecutor, userId: UserId, tag: string): Promise<void> {
  await db.run(
    `INSERT INTO user_tags (user_id, tag, position) VALUES (?, ?, 0)`,
    [userId, tag],
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}

export async function suggestUserTag(db: QueryExecutor, name = ''): Promise<string> {
  const identity = identityName(name, null) || 'trader';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const tag = randomTag();
    const owner = await handleOwner(db, handleKey(identity, tag));
    if (!owner) return tag;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tag = `${randomTag()}${randomInt(100, 1000)}`;
    const owner = await handleOwner(db, handleKey(identity, tag));
    if (!owner) return tag;
  }
  return `${randomTag()}${randomInt(1000, 10000)}`;
}

async function writeHandle(db: QueryExecutor, userId: UserId, name: string, tag: string): Promise<void> {
  const key = handleKey(name, tag);
  const handle = formatHandle(name, tag);
  await db.run(`DELETE FROM user_tags WHERE user_id = ?`, [userId]);
  try {
    await insertTag(db, userId, tag);
    await db.run(`UPDATE users SET handle_key = ? WHERE id = ?`, [key, userId]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new TagTakenError(tag, handle);
    throw error;
  }
}

export async function ensureUserTags(db: QueryExecutor, userId: UserId): Promise<string[]> {
  const current = await listUserTags(db, userId);
  const name = await loadIdentity(db, userId);
  if (current.length > 0) {
    const tag = current[0]!;
    try {
      await db.run(
        `UPDATE users SET handle_key = ? WHERE id = ? AND (handle_key IS NULL OR handle_key = '')`,
        [handleKey(name, tag), userId],
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    return [tag];
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const tag = await suggestUserTag(db, name);
    try {
      await db.transaction(async (tx) => {
        const owner = await handleOwner(tx, handleKey(name, tag));
        if (owner && owner !== userId) throw new TagTakenError(tag, formatHandle(name, tag));
        await writeHandle(tx, userId, name, tag);
      });
      return [tag];
    } catch (error) {
      if (error instanceof TagTakenError || isUniqueViolation(error)) continue;
      throw error;
    }
  }
  const fallback = `${randomTag()}${randomInt(1000, 10000)}`;
  await db.transaction(async (tx) => {
    await writeHandle(tx, userId, name, fallback);
  });
  return [fallback];
}

export async function ensurePublishedAuthorTags(db: QueryExecutor): Promise<void> {
  const rows = await db.all<{ user_id: UserId }>(`
    SELECT DISTINCT pb.user_id
    FROM published_bots pb
    WHERE NOT EXISTS (
      SELECT 1 FROM user_tags ut WHERE ut.user_id = pb.user_id
    )
  `);
  for (const row of rows) {
    await ensureUserTags(db, row.user_id);
  }
}

export async function setUserTags(db: QueryExecutor, userId: UserId, tags: string[]): Promise<string[]> {
  return db.transaction(async (tx) => {
    const name = await loadIdentity(tx, userId);
    const tag = tags[0] ?? await suggestUserTag(tx, name);
    const key = handleKey(name, tag);
    const handle = formatHandle(name, tag);
    const owner = await handleOwner(tx, key);
    if (owner && owner !== userId) throw new TagTakenError(tag, handle);
    await writeHandle(tx, userId, name, tag);
    return [tag];
  });
}
