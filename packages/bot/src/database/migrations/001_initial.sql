CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  accepted_referral_link INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  last_login_at BIGINT,
  google_sub TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS grvt_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_api_key TEXT NOT NULL, api_key_iv TEXT NOT NULL, api_key_tag TEXT NOT NULL,
  encrypted_api_secret TEXT NOT NULL, api_secret_iv TEXT NOT NULL, api_secret_tag TEXT NOT NULL,
  encrypted_trading_address TEXT NOT NULL, trading_address_iv TEXT NOT NULL, trading_address_tag TEXT NOT NULL,
  encrypted_account_id TEXT NOT NULL, account_id_iv TEXT NOT NULL, account_id_tag TEXT NOT NULL,
  encrypted_sub_account_id TEXT NOT NULL, sub_account_id_iv TEXT NOT NULL, sub_account_id_tag TEXT NOT NULL,
  created_at BIGINT NOT NULL, last_used_at BIGINT, last_test_ok INTEGER, last_test_at BIGINT, last_test_error TEXT
);

CREATE TABLE IF NOT EXISTS grvt_sub_accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Default',
  encrypted_api_key TEXT NOT NULL, api_key_iv TEXT NOT NULL, api_key_tag TEXT NOT NULL,
  encrypted_api_secret TEXT NOT NULL, api_secret_iv TEXT NOT NULL, api_secret_tag TEXT NOT NULL,
  encrypted_trading_address TEXT NOT NULL, trading_address_iv TEXT NOT NULL, trading_address_tag TEXT NOT NULL,
  encrypted_account_id TEXT NOT NULL, account_id_iv TEXT NOT NULL, account_id_tag TEXT NOT NULL,
  encrypted_sub_account_id TEXT NOT NULL, sub_account_id_iv TEXT NOT NULL, sub_account_id_tag TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0, last_test_ok INTEGER, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_accounts_user ON grvt_sub_accounts(user_id);

CREATE TABLE IF NOT EXISTS grid_bots (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  pair TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
  leverage INTEGER NOT NULL,
  lower_price DOUBLE PRECISION NOT NULL,
  upper_price DOUBLE PRECISION NOT NULL,
  num_grids INTEGER NOT NULL,
  investment_usdt DOUBLE PRECISION NOT NULL,
  original_investment_usdt DOUBLE PRECISION,
  quantity_per_level DOUBLE PRECISION,
  grid_profit_usdt DOUBLE PRECISION DEFAULT 0,
  trend_pnl_usdt DOUBLE PRECISION DEFAULT 0,
  total_pnl_usdt DOUBLE PRECISION DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('paused', 'running', 'stopped')),
  position_size DOUBLE PRECISION DEFAULT 0,
  avg_entry_price DOUBLE PRECISION DEFAULT 0,
  liquidation_price DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  params_json TEXT DEFAULT '{}',
  grid_profit_seed DOUBLE PRECISION,
  grid_profit_seed_timestamp TEXT,
  compound_pct DOUBLE PRECISION,
  compound_threshold_usdt DOUBLE PRECISION,
  compound_interval_hours DOUBLE PRECISION,
  last_compound_at TEXT,
  total_reinvested DOUBLE PRECISION,
  safeguard_enabled INTEGER DEFAULT 0,
  safeguard_threshold_pct DOUBLE PRECISION,
  safeguard_action TEXT,
  alert_drawdown_pct DOUBLE PRECISION,
  alert_fill_batch INTEGER,
  alert_liq_proximity_pct DOUBLE PRECISION,
  sl_pct DOUBLE PRECISION,
  tp_pct DOUBLE PRECISION,
  auto_shift_enabled INTEGER DEFAULT 0,
  auto_shift_pct DOUBLE PRECISION,
  last_auto_shift_at BIGINT,
  bot_type TEXT DEFAULT 'grid',
  dca_amount_usdt DOUBLE PRECISION,
  dca_interval_hours DOUBLE PRECISION,
  last_dca_at TEXT,
  virtual_enabled INTEGER DEFAULT 0,
  active_window_size INTEGER,
  grvt_sub_account_id BIGINT REFERENCES grvt_sub_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_bots_status ON grid_bots(status);
CREATE INDEX IF NOT EXISTS idx_grid_bots_user ON grid_bots(user_id);

CREATE TABLE IF NOT EXISTS grid_levels (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  level_index INTEGER NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity DOUBLE PRECISION NOT NULL,
  is_filled INTEGER DEFAULT 0,
  pending_replace INTEGER DEFAULT 0,
  order_id TEXT,
  filled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  state TEXT DEFAULT 'active',
  UNIQUE(bot_id, level_index)
);
CREATE INDEX IF NOT EXISTS idx_grid_levels_bot_id ON grid_levels(bot_id);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  order_id TEXT NOT NULL UNIQUE,
  instrument TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  type TEXT NOT NULL CHECK (type IN ('limit', 'market')),
  quantity DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'filled', 'cancelled', 'rejected')),
  grid_level_id BIGINT REFERENCES grid_levels(id),
  metadata TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_bot_id ON orders(bot_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  order_id TEXT NOT NULL,
  fill_id TEXT NOT NULL UNIQUE,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  fee DOUBLE PRECISION NOT NULL,
  fee_currency TEXT DEFAULT 'USDT',
  pnl_usdt DOUBLE PRECISION,
  round_trip_profit DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trades_bot_id ON trades(bot_id);
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);

CREATE TABLE IF NOT EXISTS funding_history (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  instrument TEXT NOT NULL,
  funding_rate DOUBLE PRECISION NOT NULL,
  payment_usdt DOUBLE PRECISION NOT NULL,
  position_size DOUBLE PRECISION NOT NULL,
  funding_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_funding_bot_id ON funding_history(bot_id);

CREATE TABLE IF NOT EXISTS daily_snapshots (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  date TEXT NOT NULL,
  timestamp TIMESTAMPTZ,
  equity DOUBLE PRECISION NOT NULL DEFAULT 0,
  balance_usdt DOUBLE PRECISION,
  equity_usdt DOUBLE PRECISION,
  grid_profit_net DOUBLE PRECISION NOT NULL DEFAULT 0,
  grid_profit_usdt DOUBLE PRECISION,
  trend_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  trend_pnl_usdt DOUBLE PRECISION,
  total_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_pnl_usdt DOUBLE PRECISION,
  round_trips INTEGER DEFAULT 0,
  num_round_trips INTEGER,
  eth_price DOUBLE PRECISION,
  position_size DOUBLE PRECISION DEFAULT 0,
  drawdown_pct DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bot_id, date)
);

CREATE TABLE IF NOT EXISTS bot_cash_movements (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('compound', 'deposit', 'withdrawal', 'initial')),
  amount_usdt DOUBLE PRECISION NOT NULL,
  notes TEXT,
  occurred_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_bot ON bot_cash_movements(bot_id, occurred_at);

CREATE TABLE IF NOT EXISTS fills_archive (
  id BIGSERIAL PRIMARY KEY,
  fill_id TEXT UNIQUE,
  event_time TEXT,
  is_buyer INTEGER,
  price DOUBLE PRECISION,
  size DOUBLE PRECISION,
  fee DOUBLE PRECISION,
  created_at TEXT,
  bot_id BIGINT REFERENCES grid_bots(id) ON DELETE SET NULL,
  instrument TEXT,
  user_id UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_fills_archive_bot ON fills_archive(bot_id, event_time);
CREATE INDEX IF NOT EXISTS idx_fills_archive_instrument ON fills_archive(instrument, event_time);
CREATE INDEX IF NOT EXISTS idx_fills_arch_user ON fills_archive(user_id);

CREATE TABLE IF NOT EXISTS paired_roundtrips (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT REFERENCES grid_bots(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  buy_fill_id TEXT,
  sell_fill_id TEXT,
  buy_price DOUBLE PRECISION,
  sell_price DOUBLE PRECISION,
  size DOUBLE PRECISION,
  profit DOUBLE PRECISION,
  created_at TEXT,
  UNIQUE(buy_fill_id, sell_fill_id)
);
CREATE INDEX IF NOT EXISTS idx_paired_roundtrips_bot ON paired_roundtrips(bot_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context TEXT NOT NULL,
  context_ref BIGINT,
  accepted_at BIGINT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  terms_version TEXT NOT NULL,
  terms_text_hash TEXT NOT NULL,
  terms_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_terms_user ON terms_acceptances(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT,
  created_at BIGINT NOT NULL,
  ip_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_pwreset_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_reset_tokens(user_id);

CREATE OR REPLACE FUNCTION inherit_grid_bot_user_id() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.bot_id IS NOT NULL THEN
    SELECT user_id INTO NEW.user_id FROM grid_bots WHERE id = NEW.bot_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'grid_levels', 'orders', 'trades', 'funding_history', 'daily_snapshots',
    'bot_cash_movements', 'fills_archive', 'paired_roundtrips'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I',
      'trg_' || table_name || '_user_id',
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION inherit_grid_bot_user_id()',
      'trg_' || table_name || '_user_id',
      table_name
    );
  END LOOP;
END $$;
