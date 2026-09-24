CREATE TABLE IF NOT EXISTS user_follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auto_copy INTEGER NOT NULL DEFAULT 0,
  copy_investment_usdt DOUBLE PRECISION,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_followee ON user_follows(followee_id);

CREATE TABLE IF NOT EXISTS bot_mirrors (
  id BIGSERIAL PRIMARY KEY,
  leader_bot_id BIGINT NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  follower_bot_id BIGINT NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  UNIQUE (leader_bot_id, follower_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_mirrors_follower_bot ON bot_mirrors(follower_bot_id);

CREATE TABLE IF NOT EXISTS follow_streak_days (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS follow_notifications (
  id BIGSERIAL PRIMARY KEY,
  followee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  UNIQUE (followee_id, follower_id, kind, ref)
);
