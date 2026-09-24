-- One tag per account. The public identifier is Nombre#TAG, unique
-- case-insensitively: LauToro#LAS cannot exist twice, but LauToro#LA
-- and LauToroo#LAS can.

DELETE FROM user_tags
WHERE ctid IN (
  SELECT ctid FROM (
    SELECT ctid,
           row_number() OVER (PARTITION BY user_id ORDER BY position ASC) AS rn
    FROM user_tags
  ) ranked
  WHERE rn > 1
);

DROP INDEX IF EXISTS idx_user_tags_lower;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tags_user
  ON user_tags (user_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS handle_key TEXT;

UPDATE users u
SET handle_key = lower(
  CASE
    WHEN u.display_name IS NOT NULL AND btrim(u.display_name) <> '' THEN btrim(u.display_name)
    ELSE left(split_part(COALESCE(u.email, ''), '@', 1), 24)
  END
) || '#' || lower(ut.tag)
FROM user_tags ut
WHERE ut.user_id = u.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_key
  ON users (handle_key)
  WHERE handle_key IS NOT NULL AND handle_key <> '';
