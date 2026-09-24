CREATE TABLE IF NOT EXISTS user_tags (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, position)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tags_lower
  ON user_tags (lower(tag));
