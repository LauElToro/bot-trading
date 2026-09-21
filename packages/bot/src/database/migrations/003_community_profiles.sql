ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_pathname TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;

CREATE TABLE IF NOT EXISTS published_bots (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_bot_id BIGINT REFERENCES grid_bots(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  pair TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
  leverage INTEGER NOT NULL,
  lower_price DOUBLE PRECISION NOT NULL,
  upper_price DOUBLE PRECISION NOT NULL,
  num_grids INTEGER NOT NULL,
  investment_usdt DOUBLE PRECISION NOT NULL,
  virtual_enabled INTEGER NOT NULL DEFAULT 0,
  active_window_size INTEGER,
  sl_pct DOUBLE PRECISION,
  tp_pct DOUBLE PRECISION,
  auto_shift_enabled INTEGER NOT NULL DEFAULT 0,
  auto_shift_pct DOUBLE PRECISION,
  compound_pct DOUBLE PRECISION,
  safeguard_enabled INTEGER NOT NULL DEFAULT 0,
  safeguard_threshold_pct DOUBLE PRECISION,
  safeguard_action TEXT,
  pnl_usdt DOUBLE PRECISION NOT NULL DEFAULT 0,
  pnl_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  copies_count INTEGER NOT NULL DEFAULT 0,
  published_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_published_bots_source
  ON published_bots(user_id, source_bot_id)
  WHERE source_bot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_published_bots_rank
  ON published_bots(pnl_pct DESC, copies_count DESC, published_at DESC);

CREATE TABLE IF NOT EXISTS published_bot_copies (
  id BIGSERIAL PRIMARY KEY,
  published_id BIGINT NOT NULL REFERENCES published_bots(id) ON DELETE CASCADE,
  copier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  UNIQUE (published_id, copier_id)
);
