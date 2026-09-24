import type { QueryExecutor } from '../database/postgres.js';
import { identityName } from './profile-tags.js';

export interface TraderSearchHit {
  id: string;
  name: string;
  tag: string;
  handle: string;
  bio: string | null;
  hasAvatar: boolean;
  avatarUpdatedAt: number | null;
  runningBots: number;
  published: Array<{
    id: number;
    title: string;
    pair: string;
    pnlUsdt: number;
    pnlPct: number;
    status: string | null;
  }>;
}

export interface TraderSearchPattern {
  exact: string;
  like: string;
}

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (ch) => `!${ch}`);
}

/**
 * LauToro#LAS and lautoro#las are the same search.
 * LauToro#LA is a prefix, so it also finds LauToro#LAS.
 * LauToroo#LAS does not match LauToro#LAS.
 */
export function traderSearchPattern(raw: string): TraderSearchPattern | null {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return null;
  const hash = trimmed.indexOf('#');
  if (hash === -1) {
    const name = trimmed.toLowerCase();
    if (!/^[\p{L}\p{N} ._\-]{2,40}$/u.test(name)) return null;
    return { exact: name, like: `${escapeLike(name)}%` };
  }
  const name = trimmed.slice(0, hash).trim().toLowerCase();
  const tag = trimmed.slice(hash + 1).trim().toLowerCase();
  if (name && !/^[\p{L}\p{N} ._\-]{1,40}$/u.test(name)) return null;
  if (tag && !/^[\p{L}\p{N}]{1,16}$/u.test(tag)) return null;
  if (!name && tag) {
    return { exact: `#${tag}`, like: `%#${escapeLike(tag)}%` };
  }
  if (name && !tag) {
    return { exact: `${name}#`, like: `${escapeLike(name)}#%` };
  }
  if (!name || !tag) return null;
  const exact = `${name}#${tag}`;
  return { exact, like: `${escapeLike(exact)}%` };
}

interface SearchRow {
  id: string;
  display_name: string | null;
  email: string;
  bio: string | null;
  has_avatar: boolean | number | null;
  avatar_updated_at: number | null;
  tag: string;
  running: number;
}

interface PublishedRow {
  id: number;
  user_id: string;
  title: string;
  pair: string;
  pnl_usdt: number;
  pnl_pct: number;
  status: string | null;
}

export async function searchTraders(db: QueryExecutor, raw: string): Promise<TraderSearchHit[]> {
  const pattern = traderSearchPattern(raw);
  if (!pattern) return [];
  const rows = await db.all<SearchRow>(`
    SELECT
      u.id,
      u.display_name,
      u.email,
      u.bio,
      (u.avatar_url IS NOT NULL) AS has_avatar,
      u.avatar_updated_at,
      ut.tag,
      (
        SELECT COUNT(*) FROM grid_bots b
        WHERE b.user_id = u.id AND b.status = 'running'
      ) AS running
    FROM users u
    JOIN user_tags ut ON ut.user_id = u.id
    WHERE u.handle_key LIKE ? ESCAPE '!'
    ORDER BY
      CASE WHEN u.handle_key = ? THEN 0 ELSE 1 END,
      length(u.handle_key),
      u.handle_key
    LIMIT 8
  `, [pattern.like, pattern.exact]);

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  const published = await db.all<PublishedRow>(`
    SELECT pb.id, pb.user_id, pb.title, pb.pair, pb.pnl_usdt, pb.pnl_pct, gb.status
    FROM published_bots pb
    LEFT JOIN grid_bots gb ON gb.id = pb.source_bot_id
    WHERE pb.user_id IN (${placeholders})
      AND pb.seed_key IS NULL
      AND pb.source_bot_id IS NOT NULL
    ORDER BY pb.pnl_pct DESC, pb.id DESC
  `, ids);

  const byUser = new Map<string, TraderSearchHit['published']>();
  for (const row of published) {
    const list = byUser.get(row.user_id) ?? [];
    if (list.length >= 3) continue;
    list.push({
      id: Number(row.id),
      title: row.title,
      pair: row.pair,
      pnlUsdt: Number(row.pnl_usdt) || 0,
      pnlPct: Number(row.pnl_pct) || 0,
      status: row.status,
    });
    byUser.set(row.user_id, list);
  }

  return rows.map((row) => {
    const name = identityName(row.display_name, row.email);
    const tag = row.tag;
    return {
      id: row.id,
      name,
      tag,
      handle: `${name}#${tag}`,
      bio: row.bio?.trim() || null,
      hasAvatar: Boolean(row.has_avatar),
      avatarUpdatedAt: row.avatar_updated_at ?? null,
      runningBots: Number(row.running) || 0,
      published: byUser.get(row.id) ?? [],
    };
  });
}
