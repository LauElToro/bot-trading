ALTER TABLE grid_bots ADD COLUMN IF NOT EXISTS copied_from_bot_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_grid_bots_copied_from
  ON grid_bots(copied_from_bot_id);
