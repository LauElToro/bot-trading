ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_id TEXT;

UPDATE refresh_tokens SET family_id = id::text WHERE family_id IS NULL OR family_id = '';

ALTER TABLE refresh_tokens ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(user_id, family_id);
