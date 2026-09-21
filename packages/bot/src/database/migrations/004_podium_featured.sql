ALTER TABLE published_bots ADD COLUMN IF NOT EXISTS seed_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_published_bots_seed
  ON published_bots(seed_key)
  WHERE seed_key IS NOT NULL;
