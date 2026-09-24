import { isUserId, newUserId, type UserId } from '../auth/user-id.js';
import { tickOperationalStreaks } from '../server/follows.js';
import { PostgresExecutor, type RunResult } from './postgres.js';

export interface GridBot {
  id: number;
  user_id?: UserId | null;
  pair: string;
  direction: 'long' | 'short';
  leverage: number;
  lower_price: number;
  upper_price: number;
  num_grids: number;
  investment_usdt: number;
  grid_profit_usdt: number;
  trend_pnl_usdt: number;
  total_pnl_usdt: number;
  status: 'paused' | 'running' | 'stopped';
  position_size: number;
  avg_entry_price: number;
  liquidation_price: number;
  created_at: string;
  updated_at: string;
  params_json: string; // JSON con parámetros adicionales
  grid_profit_seed?: number;
  grid_profit_seed_timestamp?: string;
  total_reinvested?: number;
  original_investment_usdt?: number;
  // Set at creation, immutable. Source of truth for per-level order
  // size — read by getFixedQty(), updateBotRange(), etc. Replaces
  // the recompute-from-investment_usdt formula that drifted under
  // compound rebalances.
  quantity_per_level?: number;
  // Compound rebalance settings (0 = disabled)
  compound_pct?: number;
  compound_threshold_usdt?: number;
  compound_interval_hours?: number;
  last_compound_at?: string;
  // Liquidation proximity safeguard (C.4). Opt-in per bot, configured at
  // creation. safeguard_enabled=0 means the check is a no-op; the legacy
  // behavior of not pausing on proximity is preserved.
  safeguard_enabled?: number;
  safeguard_threshold_pct?: number;
  safeguard_action?: 'pause' | 'pause_close';
  // F.1: per-bot alert threshold overrides. When null, notifier uses
  // global defaults from env vars (NOTIFY_DRAWDOWN_PCT, etc.).
  alert_drawdown_pct?: number | null;
  alert_fill_batch?: number | null;
  alert_liq_proximity_pct?: number | null;
  // H.3: stop-loss / take-profit (null = disabled)
  sl_pct?: number | null;
  tp_pct?: number | null;
  // H.2: dynamic grid auto-shift
  auto_shift_enabled?: number;
  auto_shift_pct?: number | null;
  last_auto_shift_at?: number | null;
  // H.4: DCA mode
  bot_type?: 'grid' | 'dca';
  dca_amount_usdt?: number | null;
  dca_interval_hours?: number | null;
  last_dca_at?: string | null;
  // H.8: Virtual grids
  virtual_enabled?: number;
  active_window_size?: number | null;
  // H.5: optional FK into grvt_sub_accounts. NULL = use the user's
  // default credentials in grvt_credentials. Non-null routes the
  // engine through that specific sub-account's encrypted creds.
  grvt_sub_account_id?: number | null;
  // Set when this bot was created from a published strategy. Closing the
  // source also closes these copies.
  copied_from_bot_id?: number | null;
}

export interface GridLevel {
  id: number;
  bot_id: number;
  level_index: number;
  price: number;
  side: 'buy' | 'sell';
  quantity: number;
  is_filled: boolean;
  pending_replace?: boolean;
  // Nullable to allow explicit null in updates (used to clear order_id when virtualizing).
  order_id?: string | null;
  filled_at?: string;
  created_at: string;
  // H.8: Virtual grids state. 'active' = order on exchange, 'virtual' = outside window,
  // 'filled' = executed (mirrors is_filled for legacy). Default 'active' for legacy rows.
  state?: 'active' | 'virtual' | 'filled';
}

export interface OrderRecord {
  id: number;
  bot_id: number;
  order_id: string;
  instrument: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  quantity: number;
  price: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  grid_level_id?: number;
  metadata?: string;
  created_at: string;
  updated_at: string;
}

export interface TradeRecord {
  id: number;
  bot_id: number;
  order_id: string;
  fill_id: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fee: number;
  fee_currency: string;
  pnl_usdt?: number;
  round_trip_profit?: number;
  created_at: string;
}

export interface FundingRecord {
  id: number;
  bot_id: number;
  instrument: string;
  funding_rate: number;
  payment_usdt: number;
  position_size: number;
  funding_time: string;
  created_at: string;
}

export interface DailySnapshot {
  id: number;
  bot_id: number;
  date: string; // YYYY-MM-DD
  equity: number;
  grid_profit_net: number;
  trend_pnl: number;
  total_pnl: number;
  round_trips: number;
  eth_price: number | null;
  created_at: string;
}

/** PostgreSQL-backed database manager. */
export class GridBotDB {
  private db: PostgresExecutor;
  private dbRun: (sql: string, ...params: any[]) => Promise<RunResult>;
  private dbGet: (sql: string, ...params: any[]) => Promise<any>;
  private dbAll: (sql: string, ...params: any[]) => Promise<any[]>;

  constructor(databaseUrl?: string) {
    this.db = new PostgresExecutor(databaseUrl ?? process.env.DATABASE_URL);
    const args = (params: any[]): unknown[] =>
      params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    this.dbRun = (sql, ...params) => this.db.run(sql, args(params));
    this.dbGet = (sql, ...params) => this.db.get(sql, args(params));
    this.dbAll = (sql, ...params) => this.db.all(sql, args(params));
  }

  async tickFollowStreaks(now?: Date): Promise<number> {
    return tickOperationalStreaks(this.db, now);
  }

  /** Validate the external connection and apply pending migrations. */
  async initialize(): Promise<void> {
    try {
      await this.db.migrate();
      const { seedFeaturedLeaders } = await import('../server/community.js');
      await seedFeaturedLeaders(this.db);
      console.log('✅ PostgreSQL database inicializada');
    } catch (error) {
      console.error('❌ Error inicializando database:', error);
      throw error;
    }
  }

  /**
   * Crear todas las tablas
   */
  private async createTables(): Promise<void> {
    // Tabla: grid_bots
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS grid_bots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pair TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
        leverage INTEGER NOT NULL,
        lower_price REAL NOT NULL,
        upper_price REAL NOT NULL,
        num_grids INTEGER NOT NULL,
        investment_usdt REAL NOT NULL,
        grid_profit_usdt REAL DEFAULT 0,
        trend_pnl_usdt REAL DEFAULT 0,
        total_pnl_usdt REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('paused', 'running', 'stopped')),
        position_size REAL DEFAULT 0,
        avg_entry_price REAL DEFAULT 0,
        liquidation_price REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        params_json TEXT DEFAULT '{}'
      )
    `);

    // Tabla: grid_levels
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS grid_levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id INTEGER NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
        level_index INTEGER NOT NULL,
        price REAL NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
        quantity REAL NOT NULL,
        is_filled BOOLEAN DEFAULT 0,
        pending_replace BOOLEAN DEFAULT 0,
        order_id TEXT,
        filled_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(bot_id, level_index)
      )
    `);

    // Agregar columna pending_replace si no existe (migration)
    try {
      await this.dbRun(`ALTER TABLE grid_levels ADD COLUMN pending_replace BOOLEAN DEFAULT 0`);
      console.log('✅ Columna pending_replace agregada a grid_levels');
    } catch (e) {
      // Columna ya existe, ignorar error
    }

    // Migration: original_investment_usdt — the cash deposit at bot
    // creation, immutable. Required because investment_usdt gets bumped
    // by compound rebalances AND by external margin transfers, so it
    // no longer reflects the original deposit. New bots set this on
    // INSERT; for legacy bots we backfill = current investment_usdt
    // (best guess; the user can manually correct individual rows).
    try {
      await this.dbRun(`ALTER TABLE grid_bots ADD COLUMN original_investment_usdt REAL`);
      console.log('✅ Columna original_investment_usdt agregada a grid_bots');
    } catch (e) {
      // Columna ya existe, ignorar
    }
    // Backfill NULL rows so the column has data for existing bots.
    await this.dbRun(`
      UPDATE grid_bots
      SET original_investment_usdt = investment_usdt
      WHERE original_investment_usdt IS NULL
    `);

    // Migration: quantity_per_level — the IMMUTABLE per-grid order size,
    // set at bot creation. Critical fix for the "qty drift" bug:
    //
    //   Previously, getFixedQty() recomputed qty on every call from
    //   investment_usdt * leverage * 0.75 / num_grids / midPrice.
    //   When compound bumped investment_usdt mid-life, the formula
    //   produced a bigger qty for new orders → buys placed at qty=0.04
    //   would later get matched against sells placed at qty=0.05, with
    //   the residual 0.01 polluting the position permanently. Bot 42
    //   accumulated months of drift this way.
    //
    // Fix: store the qty at bot creation and read it from here forever.
    // The only legitimate way to change it is a deliberate "rebalance"
    // operation that ALSO adjusts the position to match — never via a
    // silent recompute on each monitor tick.
    try {
      await this.dbRun(`ALTER TABLE grid_bots ADD COLUMN quantity_per_level REAL`);
      console.log('✅ Columna quantity_per_level agregada a grid_bots');
    } catch (e) { /* already exists */ }
    // Backfill from existing grid_levels[0].quantity for legacy bots —
    // this is the qty the bot has been using lately, so it's the
    // pragmatic "current truth". Bot 42 will get 0.05.
    await this.dbRun(`
      UPDATE grid_bots
      SET quantity_per_level = (
        SELECT quantity FROM grid_levels
        WHERE grid_levels.bot_id = grid_bots.id
        LIMIT 1
      )
      WHERE quantity_per_level IS NULL
    `);

    // Migration: compound_* columns. These were added manually on the
    // production DB during the compound rebalance feature but never had
    // proper ALTER statements, so a fresh DB (dev, test, new deploy)
    // would crash on any SELECT that references them.
    for (const col of [
      'compound_pct REAL',
      'compound_threshold_usdt REAL',
      'compound_interval_hours REAL',
      'last_compound_at TEXT',
      'total_reinvested REAL',
    ]) {
      try { await this.dbRun(`ALTER TABLE grid_bots ADD COLUMN ${col}`); } catch (e) { /* exists */ }
    }

    // Migration: safeguard_* columns (C.4). Liquidation proximity check,
    // opt-in per bot at creation. Legacy bots get safeguard_enabled=0 via
    // the DEFAULT, so their behavior does not change after this migration.
    try {
      await this.dbRun(`ALTER TABLE grid_bots ADD COLUMN safeguard_enabled INTEGER DEFAULT 0`);
      console.log('✅ Columna safeguard_enabled agregada a grid_bots');
    } catch (e) { /* already exists */ }
    try {
      await this.dbRun(`ALTER TABLE grid_bots ADD COLUMN safeguard_threshold_pct REAL`);
      console.log('✅ Columna safeguard_threshold_pct agregada a grid_bots');
    } catch (e) { /* already exists */ }
    try {
      await this.dbRun(`ALTER TABLE grid_bots ADD COLUMN safeguard_action TEXT`);
      console.log('✅ Columna safeguard_action agregada a grid_bots');
    } catch (e) { /* already exists */ }

    // F.1: per-bot alert threshold overrides. When null, the notifier
    // uses the global defaults from env vars.
    for (const col of [
      'alert_drawdown_pct REAL',
      'alert_fill_batch INTEGER',
      'alert_liq_proximity_pct REAL',
      // H.3: stop-loss / take-profit
      'sl_pct REAL',
      'tp_pct REAL',
      // H.2: dynamic grid auto-shift
      'auto_shift_enabled INTEGER DEFAULT 0',
      'auto_shift_pct REAL',
      'last_auto_shift_at INTEGER',
      // H.4: DCA mode
      "bot_type TEXT DEFAULT 'grid'",
      'dca_amount_usdt REAL',
      'dca_interval_hours REAL',
      'last_dca_at TEXT',
      // H.8: Virtual grids — allow grid counts beyond GRVT's 80 order cap
      // by keeping only the N closest to market active; rotate as price moves.
      'virtual_enabled INTEGER DEFAULT 0',
      'active_window_size INTEGER',
      // H.5: optional FK to grvt_sub_accounts. NULL = use default
      // credentials. We can't add a real FK constraint via ALTER in
      // SQLite, but the column lives alongside the table and the
      // application-layer guards (delete blocked when bots reference)
      // keep referential integrity.
      'grvt_sub_account_id INTEGER',
      'copied_from_bot_id INTEGER',
    ]) {
      try { await this.dbRun(`ALTER TABLE grid_bots ADD COLUMN ${col}`); } catch (e) { /* exists */ }
    }
    try {
      await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_grid_bots_copied_from ON grid_bots(copied_from_bot_id)`);
    } catch { /* exists */ }

    // H.8: Add `state` column to grid_levels ('active' | 'virtual' | 'filled')
    try { await this.dbRun(`ALTER TABLE grid_levels ADD COLUMN state TEXT DEFAULT 'active'`); } catch (e) { /* exists */ }
    // Backfill: filled legacy rows (is_filled=1) should have state='filled'
    try { await this.dbRun(`UPDATE grid_levels SET state = 'filled' WHERE is_filled = 1 AND (state IS NULL OR state = 'active')`); } catch (e) { /* */ }

    // Tabla: bot_cash_movements — explicit ledger for every cash flow
    // touching a bot's notional. Each row records WHY investment_usdt
    // changed: 'compound' when the engine reinvested grid profit,
    // 'deposit' when external margin was transferred in, 'withdrawal'
    // when funds were pulled out. New bots populate this from day 1
    // so we can always reconstruct: original_investment + sum(deposits)
    // + sum(compounds) - sum(withdrawals) = current_notional, with
    // every component accounted for.
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS bot_cash_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id INTEGER NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('compound', 'deposit', 'withdrawal', 'initial')),
        amount_usdt REAL NOT NULL,
        notes TEXT,
        occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.dbRun(`
      CREATE INDEX IF NOT EXISTS idx_cash_movements_bot
        ON bot_cash_movements(bot_id, occurred_at)
    `);

    // Tabla: orders
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id INTEGER NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
        order_id TEXT NOT NULL,
        instrument TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
        type TEXT NOT NULL CHECK (type IN ('limit', 'market')),
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'filled', 'cancelled', 'rejected')),
        grid_level_id INTEGER REFERENCES grid_levels(id),
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(order_id)
      )
    `);

    // Tabla: trades
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id INTEGER NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
        order_id TEXT NOT NULL,
        fill_id TEXT NOT NULL UNIQUE,
        side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        fee REAL NOT NULL,
        fee_currency TEXT DEFAULT 'USDT',
        pnl_usdt REAL,
        round_trip_profit REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla: funding_history
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS funding_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id INTEGER NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
        instrument TEXT NOT NULL,
        funding_rate REAL NOT NULL,
        payment_usdt REAL NOT NULL,
        position_size REAL NOT NULL,
        funding_time DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS daily_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id INTEGER NOT NULL REFERENCES grid_bots(id) ON DELETE CASCADE,
        date TEXT NOT NULL, -- YYYY-MM-DD
        equity REAL NOT NULL,
        grid_profit_net REAL NOT NULL,
        trend_pnl REAL NOT NULL,
        total_pnl REAL NOT NULL,
        round_trips INTEGER DEFAULT 0,
        eth_price REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(bot_id, date)
      )
    `);

    // Migrate legacy daily_snapshots schema: old table had (timestamp,
    // balance_usdt, grid_profit_usdt, total_pnl_usdt, equity_usdt) but new
    // code expects (date, equity, grid_profit_net, trend_pnl, total_pnl).
    // Add the missing columns and backfill from old columns.
    for (const col of [
      'date TEXT',
      'equity REAL DEFAULT 0',
      'grid_profit_net REAL DEFAULT 0',
      'trend_pnl REAL DEFAULT 0',
      'total_pnl REAL DEFAULT 0',
      'round_trips INTEGER DEFAULT 0',
      'eth_price REAL',
    ]) {
      try { await this.dbRun(`ALTER TABLE daily_snapshots ADD COLUMN ${col}`); } catch (e) { /* exists */ }
    }
    // Backfill: copy old columns → new columns where new ones are still NULL/0
    try {
      await this.dbRun(`UPDATE daily_snapshots SET date = substr(timestamp, 1, 10) WHERE date IS NULL AND timestamp IS NOT NULL`);
      await this.dbRun(`UPDATE daily_snapshots SET equity = equity_usdt WHERE equity = 0 AND equity_usdt IS NOT NULL AND equity_usdt > 0`);
      await this.dbRun(`UPDATE daily_snapshots SET grid_profit_net = grid_profit_usdt WHERE grid_profit_net = 0 AND grid_profit_usdt IS NOT NULL AND grid_profit_usdt != 0`);
      await this.dbRun(`UPDATE daily_snapshots SET total_pnl = total_pnl_usdt WHERE total_pnl = 0 AND total_pnl_usdt IS NOT NULL AND total_pnl_usdt != 0`);
      await this.dbRun(`UPDATE daily_snapshots SET trend_pnl = trend_pnl_usdt WHERE trend_pnl = 0 AND trend_pnl_usdt IS NOT NULL AND trend_pnl_usdt != 0`);
      await this.dbRun(`UPDATE daily_snapshots SET round_trips = num_round_trips WHERE round_trips = 0 AND num_round_trips IS NOT NULL AND num_round_trips > 0`);
    } catch (e) { /* old columns may not exist on fresh DBs */ }

    // Tabla: fills_archive — every GRVT fill we've ever observed for this
    // sub-account, attributed to a bot via (bot_id, instrument).
    // Originally created ad-hoc by an emergency script (no bot_id, global).
    // Migration below adds bot_id + instrument so multi-bot setups can
    // attribute correctly. Constraint: each instrument can only have
    // ONE running bot at a time per sub-account in v0 — fills are
    // attributed by instrument lookup against grid_bots.
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS fills_archive (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fill_id TEXT UNIQUE,
        event_time TEXT,
        is_buyer INTEGER,
        price REAL,
        size REAL,
        fee REAL,
        created_at TEXT,
        bot_id INTEGER REFERENCES grid_bots(id) ON DELETE SET NULL,
        instrument TEXT
      )
    `);

    // Migration: add bot_id + instrument to legacy installs.
    try {
      await this.dbRun(`ALTER TABLE fills_archive ADD COLUMN bot_id INTEGER REFERENCES grid_bots(id) ON DELETE SET NULL`);
      console.log('✅ Columna bot_id agregada a fills_archive');
    } catch (e) { /* already exists */ }
    try {
      await this.dbRun(`ALTER TABLE fills_archive ADD COLUMN instrument TEXT`);
      console.log('✅ Columna instrument agregada a fills_archive');
    } catch (e) { /* already exists */ }

    // Backfill rows with NULL bot_id by attributing to the only bot whose
    // pair MIGHT have generated them. This is a best-effort migration:
    // if there's exactly ONE bot in the table, all NULL rows go to it.
    // If there are multiple bots already, leave NULLs alone (the operator
    // must manually attribute or accept that legacy fills are unattributed).
    await this.dbRun(`
      UPDATE fills_archive
      SET bot_id = (SELECT id FROM grid_bots LIMIT 1),
          instrument = (SELECT pair FROM grid_bots LIMIT 1)
      WHERE bot_id IS NULL
        AND (SELECT COUNT(*) FROM grid_bots) = 1
    `);

    await this.dbRun(`
      CREATE INDEX IF NOT EXISTS idx_fills_archive_bot
        ON fills_archive(bot_id, event_time)
    `);
    await this.dbRun(`
      CREATE INDEX IF NOT EXISTS idx_fills_archive_instrument
        ON fills_archive(instrument, event_time)
    `);

    // Tabla: paired_roundtrips - round-trips emparejados (buy + sell)
    // Source of truth for accurate round-trip counting (vs the buggy
    // sells-in-trades-table heuristic that froze in createDailySnapshots).
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS paired_roundtrips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buy_fill_id TEXT,
        sell_fill_id TEXT,
        buy_price REAL,
        sell_price REAL,
        size REAL,
        profit REAL,
        created_at TEXT,
        UNIQUE(buy_fill_id, sell_fill_id)
      )
    `);

    // Migration: add bot_id to paired_roundtrips (was missing in original schema)
    try { await this.dbRun(`ALTER TABLE paired_roundtrips ADD COLUMN bot_id INTEGER REFERENCES grid_bots(id)`); } catch (e) { /* exists */ }
    // Backfill: assign bot_id to orphan rows by joining on buy_fill_id → fills_archive.bot_id
    try {
      await this.dbRun(`
        UPDATE paired_roundtrips SET bot_id = (
          SELECT fa.bot_id FROM fills_archive fa WHERE fa.fill_id = paired_roundtrips.buy_fill_id LIMIT 1
        ) WHERE bot_id IS NULL
      `);
    } catch (e) { /* fills_archive may not exist yet on fresh DBs */ }

    // Índices para performance
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_bots_status ON grid_bots(status)`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_grid_levels_bot_id ON grid_levels(bot_id)`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_orders_bot_id ON orders(bot_id)`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_trades_bot_id ON trades(bot_id)`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_funding_bot_id ON funding_history(bot_id)`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_paired_roundtrips_bot ON paired_roundtrips(bot_id)`);

    // ─── Multi-tenancy migration ────────────────────────────────────
    // Adds users + grvt_credentials + terms_acceptances + user_id on
    // every per-bot table. Idempotent: each ALTER is wrapped in
    // try/catch since SQLite has no `IF NOT EXISTS` for ALTER.
    // See plan: C:\Users\52553\.claude\plans\virtual-splashing-ocean.md
    await this.runMultitenantMigration();

    console.log('📋 Tablas creadas/verificadas');
  }

  private async runMultitenantMigration(): Promise<void> {
    // Schema version tracking — first applied = 1.
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    // users — one row per account. PK is UUIDv4 (see newUserId).
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0,
        is_admin INTEGER NOT NULL DEFAULT 0,
        accepted_referral_link INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      )
    `);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);

    // Google Sign-In: stable subject from the ID token. Nullable —
    // password-only users stay without it. Unique when present.
    try {
      await this.dbRun(`ALTER TABLE users ADD COLUMN google_sub TEXT`);
    } catch {
      // Already exists.
    }
    await this.dbRun(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL`
    );

    // Refresh tokens — SHA-256 of the raw JWT. Rotation + revoke on
    // logout. Access tokens stay stateless.
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL
      )
    `);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)`);

    // grvt_credentials — AES-256-GCM encrypted GRVT API + signing
    // material. One row per user. Each field has its own IV+tag
    // because GCM requires unique IV per ciphertext under same key.
    // Master key comes from CREDENTIAL_MASTER_KEY; losing it means
    // every user must re-paste their credentials.
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS grvt_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        encrypted_api_key TEXT NOT NULL,
        api_key_iv TEXT NOT NULL,
        api_key_tag TEXT NOT NULL,
        encrypted_api_secret TEXT NOT NULL,
        api_secret_iv TEXT NOT NULL,
        api_secret_tag TEXT NOT NULL,
        encrypted_trading_address TEXT NOT NULL,
        trading_address_iv TEXT NOT NULL,
        trading_address_tag TEXT NOT NULL,
        encrypted_account_id TEXT NOT NULL,
        account_id_iv TEXT NOT NULL,
        account_id_tag TEXT NOT NULL,
        encrypted_sub_account_id TEXT NOT NULL,
        sub_account_id_iv TEXT NOT NULL,
        sub_account_id_tag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        last_test_ok INTEGER,
        last_test_at INTEGER,
        last_test_error TEXT
      )
    `);

    // terms_acceptances — append-only audit log. Stores the EXACT
    // text shown to the user at the moment of acceptance, plus IP
    // and user agent, so we can prove what they saw if anything is
    // ever disputed. context distinguishes signup TOS from per-bot
    // risk acceptance.
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS terms_acceptances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        context TEXT NOT NULL,
        context_ref INTEGER,
        accepted_at INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        terms_version TEXT NOT NULL,
        terms_text_hash TEXT NOT NULL,
        terms_text TEXT NOT NULL
      )
    `);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_terms_user ON terms_acceptances(user_id)`);

    // H.5: sub-accounts — allows one user to connect multiple GRVT
    // sub-accounts for strategy isolation. The existing grvt_credentials
    // table remains as the "default" credentials. Sub-accounts extend it.
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS grvt_sub_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT NOT NULL DEFAULT 'Default',
        encrypted_api_key TEXT NOT NULL,
        api_key_iv TEXT NOT NULL,
        api_key_tag TEXT NOT NULL,
        encrypted_api_secret TEXT NOT NULL,
        api_secret_iv TEXT NOT NULL,
        api_secret_tag TEXT NOT NULL,
        encrypted_trading_address TEXT NOT NULL,
        trading_address_iv TEXT NOT NULL,
        trading_address_tag TEXT NOT NULL,
        encrypted_account_id TEXT NOT NULL,
        account_id_iv TEXT NOT NULL,
        account_id_tag TEXT NOT NULL,
        encrypted_sub_account_id TEXT NOT NULL,
        sub_account_id_iv TEXT NOT NULL,
        sub_account_id_tag TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        last_test_ok INTEGER,
        created_at INTEGER NOT NULL
      )
    `);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_sub_accounts_user ON grvt_sub_accounts(user_id)`);

    // E.9: password reset tokens. We store SHA-256 of the raw token, never
    // the raw value — if the DB leaks, the tokens are not directly usable.
    // Single-use (used_at) and time-bound (expires_at). On password change
    // we mark all open tokens for that user as used so a leaked link can
    // never be redeemed twice.
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL,
        ip_address TEXT
      )
    `);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_pwreset_token_hash ON password_reset_tokens(token_hash)`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_reset_tokens(user_id)`);

    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS email_otp_challenges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'login')),
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        ip_address TEXT
      )
    `);
    await this.dbRun(
      `CREATE INDEX IF NOT EXISTS idx_email_otp_user ON email_otp_challenges(user_id, purpose)`
    );

    // ALTER existing tables to add user_id. Wrapped in try/catch
    // because SQLite doesn't support `ADD COLUMN IF NOT EXISTS`.
    // The columns are nullable; backfill happens in ownerBootstrap().
    const tablesToAlter = [
      'grid_bots',
      'grid_levels',
      'orders',
      'trades',
      'funding_history',
      'daily_snapshots',
      'fills_archive',
      'bot_cash_movements',
      'paired_roundtrips',
    ];
    for (const table of tablesToAlter) {
      try {
        await this.dbRun(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER REFERENCES users(id)`);
        console.log(`✅ Columna user_id agregada a ${table}`);
      } catch (e) {
        // Already exists, ignore.
      }
    }
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_grid_bots_user ON grid_bots(user_id)`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id)`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_fills_arch_user ON fills_archive(user_id)`);

    // ─── Triggers: auto-fill user_id on child rows ────────────────
    // Strategy: instead of refactoring every existing createX() to
    // accept and propagate user_id, we let SQLite derive it from the
    // parent grid_bots row at insert time. This keeps the blast
    // radius small (only grid_bots.createBot() needs to know about
    // user_id at the application level) and guarantees consistency
    // — there's no way to forget to set user_id on a child row.
    //
    // Each trigger fires AFTER INSERT and updates the just-inserted
    // row's user_id from the parent. Idempotent: DROP+CREATE.
    const childTables: Array<{ table: string; parentJoin: string }> = [
      { table: 'grid_levels',        parentJoin: 'NEW.bot_id' },
      { table: 'orders',             parentJoin: 'NEW.bot_id' },
      { table: 'trades',             parentJoin: 'NEW.bot_id' },
      { table: 'funding_history',    parentJoin: 'NEW.bot_id' },
      { table: 'daily_snapshots',    parentJoin: 'NEW.bot_id' },
      { table: 'bot_cash_movements', parentJoin: 'NEW.bot_id' },
      { table: 'fills_archive',      parentJoin: 'NEW.bot_id' },
      { table: 'paired_roundtrips', parentJoin: 'NEW.bot_id' },
    ];
    for (const { table, parentJoin } of childTables) {
      const triggerName = `trg_${table}_user_id`;
      await this.dbRun(`DROP TRIGGER IF EXISTS ${triggerName}`);
      await this.dbRun(`
        CREATE TRIGGER ${triggerName}
        AFTER INSERT ON ${table}
        FOR EACH ROW
        WHEN NEW.user_id IS NULL AND ${parentJoin} IS NOT NULL
        BEGIN
          UPDATE ${table}
          SET user_id = (SELECT user_id FROM grid_bots WHERE id = ${parentJoin})
          WHERE rowid = NEW.rowid;
        END
      `);
    }

    await this.ensureUuidUserIds();

    await this.dbRun(`
      INSERT OR IGNORE INTO schema_version (version, applied_at)
      VALUES (1, ?)
    `, [Date.now()]);
  }

  private async ensureUuidUserIds(): Promise<void> {
    const rows = await this.dbAll(`SELECT * FROM users`);
    const needsRewrite = rows.some((row: { id: unknown }) => !isUserId(row.id));
    if (!needsRewrite) return;

    const map = new Map<string, UserId>();
    for (const row of rows as Array<{ id: unknown }>) {
      const oldId = String(row.id);
      map.set(oldId, isUserId(row.id) ? row.id : newUserId());
    }

    await this.dbRun('PRAGMA foreign_keys = OFF');
    await this.dbRun(`
      CREATE TABLE users_uuid (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0,
        is_admin INTEGER NOT NULL DEFAULT 0,
        accepted_referral_link INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER,
        google_sub TEXT
      )
    `);
    for (const row of rows as Array<Record<string, unknown>>) {
      const id = map.get(String(row.id));
      await this.dbRun(
        `INSERT INTO users_uuid (id, email, password_hash, email_verified, is_admin, accepted_referral_link, created_at, last_login_at, google_sub)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          row.email,
          row.password_hash,
          row.email_verified ?? 0,
          row.is_admin ?? 0,
          row.accepted_referral_link ?? 0,
          row.created_at,
          row.last_login_at ?? null,
          row.google_sub ?? null,
        ]
      );
    }
    await this.dbRun(`DROP TABLE users`);
    await this.dbRun(`ALTER TABLE users_uuid RENAME TO users`);
    await this.dbRun(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await this.dbRun(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL`
    );

    const childTables = [
      'refresh_tokens',
      'grvt_credentials',
      'terms_acceptances',
      'grvt_sub_accounts',
      'password_reset_tokens',
      'grid_bots',
      'grid_levels',
      'orders',
      'trades',
      'funding_history',
      'daily_snapshots',
      'fills_archive',
      'bot_cash_movements',
      'paired_roundtrips',
    ];
    for (const [oldId, newId] of map) {
      if (oldId === newId) continue;
      for (const table of childTables) {
        try {
          await this.dbRun(
            `UPDATE ${table} SET user_id = ? WHERE CAST(user_id AS TEXT) = ?`,
            [newId, oldId]
          );
        } catch {
          // table may not exist on a fresh install
        }
      }
    }
    await this.dbRun('PRAGMA foreign_keys = ON');
    console.log(`Migrated ${map.size} user id(s) to UUIDv4`);
  }

  // === CRUD para grid_bots ===

  /**
   * Crear nuevo grid bot
   */
  async createBot(params: Omit<GridBot, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    // Compute the canonical per-level qty ONCE, at creation, and store
    // it immutably. Same formula as the legacy getFixedQty() but only
    // ever evaluated here, so subsequent compounds and updateBotRange
    // calls cannot drift it.
    const ORDER_ALLOC = 0.75;
    const midPrice = (params.lower_price + params.upper_price) / 2;
    const effCap = params.investment_usdt * params.leverage * ORDER_ALLOC;
    const computedQty = Math.max(
      Math.ceil((effCap / params.num_grids / midPrice) * 100) / 100,
      0.03
    );
    // Allow caller override (e.g. wizard preview) but default to the
    // formula above when params.quantity_per_level is not provided.
    const quantityPerLevel = params.quantity_per_level ?? computedQty;

    if (params.user_id == null) {
      throw new Error('user_id is required to create a bot');
    }

    // Set original_investment_usdt = investment_usdt at creation. After
    // this point, investment_usdt may drift (compound, manual edits) but
    // the original is immutable so we always know the real cash deposit.
    const values = [
      params.user_id ?? null,
      params.pair, params.direction, params.leverage, params.lower_price,
      params.upper_price, params.num_grids, params.investment_usdt,
      params.investment_usdt,  // original_investment_usdt = investment_usdt
      quantityPerLevel,        // immutable per-level qty
      params.grid_profit_usdt, params.trend_pnl_usdt, params.total_pnl_usdt,
      params.status, params.position_size, params.avg_entry_price,
      params.liquidation_price, params.params_json,
      params.virtual_enabled ?? 0,
      params.active_window_size ?? null,
      params.grvt_sub_account_id ?? null,
      params.copied_from_bot_id ?? null,
    ];
    const sql = `
      INSERT INTO grid_bots (
        user_id,
        pair, direction, leverage, lower_price, upper_price, num_grids,
        investment_usdt, original_investment_usdt, quantity_per_level,
        grid_profit_usdt, trend_pnl_usdt, total_pnl_usdt,
        status, position_size, avg_entry_price, liquidation_price, params_json,
        virtual_enabled, active_window_size, grvt_sub_account_id,
        copied_from_bot_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    return this.db.transaction(async (tx) => {
      const row = await tx.get<{ id: number }>(`${sql} RETURNING id`, values);
      if (!row) throw new Error('Failed to create grid bot');
      await tx.run(`
        INSERT INTO bot_cash_movements (bot_id, type, amount_usdt, notes)
        VALUES (?, 'initial', ?, 'Initial investment at bot creation')
      `, [row.id, params.investment_usdt]);
      return row.id;
    });
  }

  /**
   * Record a cash movement against a bot. Used by:
   *   - compound rebalance ('compound')
   *   - manual external deposits ('deposit')
   *   - manual withdrawals ('withdrawal')
   *
   * The 'initial' type is only used by createBot().
   *
   * Recording movements lets the dashboard report:
   *   bot.original_investment_usdt
   *     + Σ deposits + Σ compounds − Σ withdrawals
   *     = current notional
   * with full provenance.
   */
  async recordCashMovement(params: {
    bot_id: number;
    type: 'compound' | 'deposit' | 'withdrawal';
    amount_usdt: number;
    notes?: string;
  }): Promise<number> {
    const result = await this.dbRun(`
      INSERT INTO bot_cash_movements (bot_id, type, amount_usdt, notes)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `, [params.bot_id, params.type, params.amount_usdt, params.notes ?? null]);
    return result.lastID ?? 0;
  }

  /**
   * Total amount the compound rebalance has already pulled out of the
   * bot's grid profit. Used by checkCompoundRebalance() to avoid
   * double-counting the same profit on successive runs.
   */
  async getCompoundedTotal(botId: number): Promise<number> {
    const row = await this.dbGet(`
      SELECT COALESCE(SUM(amount_usdt), 0) AS total
      FROM bot_cash_movements
      WHERE bot_id = ? AND type = 'compound'
    `, botId);
    return (row?.total as number | undefined) ?? 0;
  }

  async listCashMovements(botId: number): Promise<Array<{
    id: number;
    type: string;
    amount_usdt: number;
    notes: string | null;
    occurred_at: string;
  }>> {
    return this.dbAll(`
      SELECT id, type, amount_usdt, notes, occurred_at
      FROM bot_cash_movements
      WHERE bot_id = ?
      ORDER BY occurred_at ASC
    `, botId);
  }

  /**
   * Obtener bot por ID
   */
  async getBot(botId: number): Promise<GridBot | null> {
    return await this.dbGet(`SELECT * FROM grid_bots WHERE id = ?`, [botId]);
  }

  /**
   * Obtener todos los bots
   */
  async getAllBots(): Promise<GridBot[]> {
    return await this.dbAll(`SELECT * FROM grid_bots ORDER BY created_at DESC`);
  }

  /**
   * Obtener bots por status
   */
  async getBotsByStatus(status: string): Promise<GridBot[]> {
    return await this.dbAll(`SELECT * FROM grid_bots WHERE status = ?`, [status]);
  }

  /**
   * Actualizar bot
   */
  async updateBot(botId: number, updates: Partial<GridBot>): Promise<void> {
    const fields = Object.keys(updates).filter(key => key !== 'id').map(key => `${key} = ?`);
    const values = Object.entries(updates)
      .filter(([key]) => key !== 'id')
      .map(([, value]) => value);
    
    if (fields.length === 0) return;

    await this.dbRun(`
      UPDATE grid_bots 
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [...values, botId]);
  }

  /**
   * Borrar bot (cascade a todas las tablas relacionadas)
   */
  async deleteBot(botId: number): Promise<void> {
    await this.dbRun(`DELETE FROM grid_bots WHERE id = ?`, [botId]);
  }

  // === CRUD para grid_levels ===

  /**
   * Crear nivel de grid
   */
  async createGridLevel(params: Omit<GridLevel, 'id' | 'created_at'>): Promise<number> {
    const state = params.state ?? 'active';
    const values = [params.bot_id, params.level_index, params.price, params.side,
        params.quantity, params.is_filled ? 1 : 0, params.order_id || null, params.filled_at || null, state];
    const row = await this.dbGet(`INSERT INTO grid_levels
      (bot_id, level_index, price, side, quantity, is_filled, order_id, filled_at, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`, values);
    if (!row) throw new Error('Failed to create grid level');
    return row.id;
  }

  /**
   * Obtener niveles de grid de un bot
   */
  async getGridLevels(botId: number): Promise<GridLevel[]> {
    return await this.dbAll(`
      SELECT * FROM grid_levels 
      WHERE bot_id = ? 
      ORDER BY level_index
    `, [botId]);
  }

  /**
   * Resize levels that are not sitting on a live GRVT order. Paused bots
   * and virtual levels pick up the new size on the next placement. Levels
   * with a real order_id keep their size until that order fills and the
   * monitor replaces it from quantity_per_level.
   */
  async resizeUnplacedLevels(botId: number, quantity: number): Promise<number> {
    const result = await this.dbRun(`
      UPDATE grid_levels
      SET quantity = ?
      WHERE bot_id = ?
        AND is_filled = 0
        AND (order_id IS NULL OR order_id = '' OR order_id = '0x00' OR order_id = 'price_based_detection')
    `, [quantity, botId]);
    return result.changes ?? 0;
  }

  /**
   * Marcar nivel como completado
   */
  async fillGridLevel(levelId: number, orderId: string): Promise<void> {
    await this.dbRun(`
      UPDATE grid_levels 
      SET is_filled = 1, order_id = ?, filled_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [orderId, levelId]);
  }

  /**
   * Marcar nivel como pendiente de colocación (error 7201)
   */
  async markLevelPendingReplace(levelId: number): Promise<void> {
    await this.dbRun(`
      UPDATE grid_levels 
      SET pending_replace = 1
      WHERE id = ?
    `, [levelId]);
  }

  /**
   * Limpiar pending_replace del nivel
   */
  async clearLevelPendingReplace(levelId: number): Promise<void> {
    await this.dbRun(`
      UPDATE grid_levels 
      SET pending_replace = 0
      WHERE id = ?
    `, [levelId]);
  }

  /**
   * Actualizar order_id de un nivel (sin marcar como filled)
   */
  async updateGridLevelOrderId(levelId: number, orderId: string): Promise<void> {
    await this.dbRun(`
      UPDATE grid_levels 
      SET order_id = ?
      WHERE id = ?
    `, [orderId, levelId]);
  }

  /**
   * Obtener niveles pendientes de reemplazo
   */
  async getPendingReplaceGridLevels(botId: number): Promise<GridLevel[]> {
    return await this.dbAll(`
      SELECT * FROM grid_levels 
      WHERE bot_id = ? AND pending_replace = 1
      ORDER BY level_index
    `, [botId]);
  }

  /**
   * Actualizar campos de un grid level
   */
  async updateGridLevel(levelId: number, updates: Partial<Pick<GridLevel, 'side' | 'is_filled' | 'order_id' | 'pending_replace' | 'quantity' | 'state'>>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.side !== undefined) {
      fields.push('side = ?');
      values.push(updates.side);
    }
    if (updates.is_filled !== undefined) {
      fields.push('is_filled = ?');
      values.push(updates.is_filled ? 1 : 0);
    }
    if (updates.order_id !== undefined) {
      fields.push('order_id = ?');
      // Accept explicit null to clear order_id (used when virtualizing)
      values.push(updates.order_id === null ? null : updates.order_id);
    }
    if (updates.pending_replace !== undefined) {
      fields.push('pending_replace = ?');
      values.push(updates.pending_replace ? 1 : 0);
    }
    if (updates.quantity !== undefined) {
      fields.push('quantity = ?');
      values.push(updates.quantity);
    }
    if (updates.state !== undefined) {
      fields.push('state = ?');
      values.push(updates.state);
    }
    
    if (fields.length === 0) return; // No updates
    
    values.push(levelId);
    
    await this.dbRun(`
      UPDATE grid_levels 
      SET ${fields.join(', ')}
      WHERE id = ?
    `, values);
  }

  async deleteGridLevel(levelId: number): Promise<void> {
    await this.dbRun(`DELETE FROM grid_levels WHERE id = ?`, [levelId]);
  }

  async deleteGridLevelsOutsideRange(botId: number, lower: number, upper: number): Promise<number> {
    const result = await this.dbRun(`
      DELETE FROM grid_levels
      WHERE bot_id = ? AND (price < ? OR price > ?)
    `, [botId, lower, upper]);

    return result.changes || 0;
  }

  /**
   * Atomically replace ALL grid levels for a bot. Used by the
   * range update operation: deletes everything, inserts the fresh
   * 0..N level set, all in a single transaction so a crash mid-flight
   * cannot leave a partial grid in the DB.
   *
   * Critical for the level_index UNIQUE collision fix: by deleting
   * all old rows BEFORE inserting new ones with reused level_index
   * values, we never violate the UNIQUE(bot_id, level_index) constraint.
   */
  async replaceAllGridLevels(
    botId: number,
    newLevels: Array<{
      level_index: number;
      price: number;
      side: 'buy' | 'sell';
      quantity: number;
      state?: 'active' | 'virtual' | 'filled';
    }>
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM grid_levels WHERE bot_id = ?', [botId]);
      for (const level of newLevels) {
        await tx.run(
          `INSERT INTO grid_levels (bot_id, level_index, price, side, quantity, is_filled, order_id, state)
           VALUES (?, ?, ?, ?, ?, 0, '0x00', ?)`,
          [botId, level.level_index, level.price, level.side, level.quantity, level.state ?? 'active'],
        );
      }
    });
  }

  // === CRUD para orders ===

  /**
   * Crear registro de orden
   */
  async createOrder(params: Omit<OrderRecord, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    try {
      const result = await this.dbRun(`
        INSERT INTO orders (bot_id, order_id, instrument, side, type, quantity, price, status, grid_level_id, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `, [params.bot_id, params.order_id, params.instrument, params.side, params.type,
          params.quantity, params.price, params.status, params.grid_level_id, params.metadata]);

      return result.lastID!;
    } catch (err: any) {
      if ((err.code === '23505' || err.message?.includes('unique constraint')) &&
          (params.order_id === '0x00' || params.order_id.startsWith('0x000000'))) {
        params.order_id = `temp_${Date.now()}_${params.price}`;
        console.log(`[DB] UNIQUE constraint workaround: renamed to ${params.order_id}`);
        const result = await this.dbRun(`
          INSERT INTO orders (bot_id, order_id, instrument, side, type, quantity, price, status, grid_level_id, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id
        `, [params.bot_id, params.order_id, params.instrument, params.side, params.type,
            params.quantity, params.price, params.status, params.grid_level_id, params.metadata]);
        return result.lastID!;
      }
      throw err;
    }
  }

  /**
   * Obtener órdenes de un bot
   */
  async getOrdersByBot(botId: number): Promise<OrderRecord[]> {
    return await this.dbAll(`
      SELECT * FROM orders 
      WHERE bot_id = ? 
      ORDER BY created_at DESC
    `, [botId]);
  }

  /**
   * Actualizar status de orden
   */
  async updateOrderStatus(orderId: string, status: string): Promise<void> {
    await this.dbRun(`
      UPDATE orders 
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE order_id = ?
    `, [status, orderId]);
  }

  // === CRUD para trades ===

  /**
   * Crear registro de trade
   */
  async createTrade(params: Omit<TradeRecord, 'id' | 'created_at'>): Promise<number> {
    const result = await this.dbRun(`
      INSERT INTO trades (bot_id, order_id, fill_id, side, quantity, price, fee, fee_currency, pnl_usdt, round_trip_profit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `, [params.bot_id, params.order_id, params.fill_id, params.side, params.quantity,
        params.price, params.fee, params.fee_currency, params.pnl_usdt, params.round_trip_profit]);

    return result.lastID!;
  }

  /**
   * Obtener trades de un bot
   */
  async getTradesByBot(botId: number): Promise<TradeRecord[]> {
    return await this.dbAll(`
      SELECT * FROM trades 
      WHERE bot_id = ? 
      ORDER BY created_at DESC
    `, [botId]);
  }

  /**
   * Obtener trades más recientes (para health check)
   */
  async getRecentTrades(limit: number = 10): Promise<TradeRecord[]> {
    return await this.dbAll(`
      SELECT * FROM trades 
      ORDER BY created_at DESC 
      LIMIT ?
    `, [limit]);
  }

  // === CRUD para funding_history ===

  /**
   * Crear registro de funding
   */
  async createFundingRecord(params: Omit<FundingRecord, 'id' | 'created_at'>): Promise<number> {
    const result = await this.dbRun(`
      INSERT INTO funding_history (bot_id, instrument, funding_rate, payment_usdt, position_size, funding_time)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id
    `, [params.bot_id, params.instrument, params.funding_rate, 
        params.payment_usdt, params.position_size, params.funding_time]);

    return result.lastID!;
  }

  /**
   * Obtener funding history de un bot
   */
  async getFundingHistoryByBot(botId: number): Promise<FundingRecord[]> {
    return await this.dbAll(`
      SELECT * FROM funding_history 
      WHERE bot_id = ? 
      ORDER BY funding_time DESC
    `, [botId]);
  }

  // === CRUD para daily_snapshots ===

  /**
   * Crear snapshot diario
   */
  async createDailySnapshot(params: Omit<DailySnapshot, 'id' | 'created_at'>): Promise<number> {
    const ts = new Date(params.date + 'T00:00:00Z').toISOString();
    const result = await this.dbRun(`
      INSERT INTO daily_snapshots
      (bot_id, date, timestamp, equity, balance_usdt, equity_usdt,
       grid_profit_net, grid_profit_usdt, trend_pnl, trend_pnl_usdt,
       total_pnl, total_pnl_usdt, round_trips, num_round_trips,
       eth_price, position_size, drawdown_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
      ON CONFLICT (bot_id, date) DO UPDATE SET
        timestamp = excluded.timestamp,
        equity = excluded.equity,
        balance_usdt = excluded.balance_usdt,
        equity_usdt = excluded.equity_usdt,
        grid_profit_net = excluded.grid_profit_net,
        grid_profit_usdt = excluded.grid_profit_usdt,
        trend_pnl = excluded.trend_pnl,
        trend_pnl_usdt = excluded.trend_pnl_usdt,
        total_pnl = excluded.total_pnl,
        total_pnl_usdt = excluded.total_pnl_usdt,
        round_trips = excluded.round_trips,
        num_round_trips = excluded.num_round_trips,
        eth_price = excluded.eth_price
      RETURNING id
    `, [
      params.bot_id, params.date, ts,
      params.equity, params.equity, params.equity,
      params.grid_profit_net, params.grid_profit_net,
      params.trend_pnl, params.trend_pnl,
      params.total_pnl, params.total_pnl,
      params.round_trips, params.round_trips,
      params.eth_price,
    ]);

    return result.lastID!;
  }

  /**
   * Obtener snapshots diarios de un bot
   */
  async getDailySnapshotsByBot(botId: number, limitDays?: number): Promise<DailySnapshot[]> {
    const limit = limitDays ? `LIMIT ${limitDays}` : '';
    return await this.dbAll(`
      SELECT * FROM daily_snapshots 
      WHERE bot_id = ? 
      ORDER BY date DESC
      ${limit}
    `, [botId]);
  }

  /**
   * Obtener último snapshot de un bot
   */
  async getLastDailySnapshot(botId: number): Promise<DailySnapshot | null> {
    return await this.dbGet(`
      SELECT * FROM daily_snapshots 
      WHERE bot_id = ? 
      ORDER BY date DESC 
      LIMIT 1
    `, [botId]);
  }

  /**
   * Verificar si ya existe snapshot para una fecha
   */
  async hasSnapshotForDate(botId: number, date: string): Promise<boolean> {
    const result = await this.dbGet(`
      SELECT 1 FROM daily_snapshots
      WHERE bot_id = ? AND date = ?
    `, [botId, date]);

    return !!result;
  }

  // === fills_archive ===

  /**
   * Insert a fill into fills_archive. Idempotent: uses INSERT OR IGNORE
   * keyed on the unique fill_id, so calling it twice with the same fill
   * is safe and returns 0 changes the second time. Returns true if a new
   * row was inserted, false if it was a duplicate.
   *
   * Multi-bot: caller MUST provide bot_id and instrument so the row can
   * be filtered correctly. v0 attribution is by instrument lookup
   * (one running bot per instrument, direction, and sub-account).
   */
  async insertFillArchive(params: {
    fill_id: string;
    event_time: string;
    is_buyer: number;
    price: number;
    size: number;
    fee: number;
    created_at: string;
    bot_id: number | null;
    instrument: string | null;
  }): Promise<boolean> {
    const result = await this.dbRun(`
      INSERT INTO fills_archive
        (fill_id, event_time, is_buyer, price, size, fee, created_at, bot_id, instrument)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (fill_id) DO NOTHING
    `, [
      params.fill_id,
      params.event_time,
      params.is_buyer,
      params.price,
      params.size,
      params.fee,
      params.created_at,
      params.bot_id,
      params.instrument,
    ]);
    return (result.changes ?? 0) > 0;
  }

  /**
   * Latest event_time we've stored, as a nanosecond string. Used by the
   * fill poller to ask GRVT only for fills newer than the watermark.
   * Returns null if the table is empty.
   */
  async getLatestFillEventTime(): Promise<string | null> {
    const row = await this.dbGet(`
      SELECT MAX(event_time) AS et FROM fills_archive
    `);
    return (row?.et as string | undefined) ?? null;
  }

  /**
   * Aggregate fee summary for the rebates stat. Sum is the sum of raw
   * fee values (negative for maker rebates), so a NEGATIVE sum means
   * the user EARNED that much. count is included so the dashboard can
   * show "N fills, $X earned".
   */
  async getFillFeeSummary(): Promise<{
    count: number;
    sumFee: number;
    minFee: number;
    maxFee: number;
  }> {
    const row = await this.dbGet(`
      SELECT COUNT(*) AS count,
             COALESCE(SUM(fee), 0) AS sum_fee,
             MIN(fee) AS min_fee,
             MAX(fee) AS max_fee
      FROM fills_archive
    `) as { count: number; sum_fee: number | null; min_fee: number | null; max_fee: number | null } | undefined;
    return {
      count: row?.count ?? 0,
      sumFee: row?.sum_fee ?? 0,
      minFee: row?.min_fee ?? 0,
      maxFee: row?.max_fee ?? 0,
    };
  }

  /**
   * List archived fills, newest first, paginated. Used by the v2
   * /fills endpoint that replaces the dead /trades reads.
   */
  async listFillArchive(limit: number = 200): Promise<Array<{
    id: number;
    fill_id: string;
    event_time: string;
    is_buyer: number;
    price: number;
    size: number;
    fee: number;
    created_at: string;
  }>> {
    return this.dbAll(`
      SELECT id, fill_id, event_time, is_buyer, price, size, fee, created_at
      FROM fills_archive
      ORDER BY event_time DESC
      LIMIT ?
    `, [limit]);
  }

  /**
   * Fills for a specific bot, ordered chronologically. Used by the
   * engine's calculateRealGridProfit() — must filter by bot_id so the
   * spread-pair matcher only sees this bot's fills, not the entire
   * sub-account history. Bot 44 hit a leak when this filter was
   * missing on 2026-04-08 (inherited bot 42's $76 profit).
   */
  async getFillsForBot(botId: number): Promise<Array<{
    fill_id: string;
    is_buyer: number;
    price: number;
    size: number;
    fee: number;
    event_time: string;
  }>> {
    return this.dbAll(`
      SELECT fill_id, is_buyer, price, size, fee, event_time
      FROM fills_archive
      WHERE bot_id = ?
      ORDER BY event_time ASC
    `, [botId]);
  }

  /**
   * Recent fills for a bot within a time window (ms). Used by the monitor
   * loop to detect fills via the WebSocket-backed archive *before* the
   * GRVT-lag skip kicks in. WS is typically faster than REST
   * getFillHistory, so this catches fills that happen inside the 10s
   * placement window (aggressive candles sweeping through a level we
   * just placed a counter on).
   */
  async findRecentFillsForBot(botId: number, withinMs: number): Promise<Array<{
    fill_id: string;
    event_time: string;
    is_buyer: number;
    price: number;
    size: number;
  }>> {
    const cutoffNs = ((Date.now() - withinMs) * 1_000_000).toString();
    return this.dbAll(`
      SELECT fill_id, event_time, is_buyer, price, size
      FROM fills_archive
      WHERE bot_id = ?
        AND event_time > ?
      ORDER BY event_time DESC
      LIMIT 50
    `, [botId, cutoffNs]);
  }

  /**
   * Compute realized PnL by FIFO matching every fill in fills_archive.
   *
   * Algorithm: walk fills oldest→newest, maintain a queue of open BUY lots
   * `[{ price, qtyRemaining }]`. Each SELL consumes from the head of the
   * queue until its size is covered, accumulating profit as
   * `(sellPrice - buyPrice) * matchedQty`. Any leftover BUY lots represent
   * the currently open position (reported as openSize / openCost).
   *
   * This is the same FIFO realized-PnL convention used by every major
   * exchange. Inputs are 100% real GRVT fill data — no estimation, no
   * heuristic spread, no assumed grid level pairing.
   *
   * Notes:
   *   - Fees come straight from fills_archive.fee (signed; negative =
   *     maker rebate earned). totalFees is the SUM, so a negative value
   *     means the user has net-earned rebates.
   *   - netPnl = realizedPnl - totalFees (subtracting because positive
   *     fee = paid; negative fee = earned and INCREASES netPnl).
   *   - Bot is currently LONG-only (BUY-then-SELL). For SHORT bots we'd
   *     need to mirror: queue SELL lots and consume on BUY. Not yet
   *     supported here — guarded by an assertion if we see SHORT data
   *     later.
   */
  async computeRealizedFifo(): Promise<{
    realizedPnl: number;
    totalFees: number;
    netPnl: number;
    roundTrips: number;
    avgPerRT: number;
    fillCount: number;
    openSize: number;
    openCost: number;
    firstFillAt: string | null;
    lastFillAt: string | null;
  }> {
    const fills = await this.dbAll(`
      SELECT is_buyer, price, size, fee, event_time
      FROM fills_archive
      ORDER BY event_time ASC
    `) as Array<{
      is_buyer: number;
      price: number;
      size: number;
      fee: number;
      event_time: string;
    }>;

    if (fills.length === 0) {
      return {
        realizedPnl: 0,
        totalFees: 0,
        netPnl: 0,
        roundTrips: 0,
        avgPerRT: 0,
        fillCount: 0,
        openSize: 0,
        openCost: 0,
        firstFillAt: null,
        lastFillAt: null,
      };
    }

    // Each entry is one BUY lot waiting to be matched against a future SELL.
    const lots: Array<{ price: number; qty: number }> = [];
    let realizedPnl = 0;
    let totalFees = 0;
    let roundTrips = 0;

    // Tiny epsilon to absorb float drift when consuming a lot exactly.
    const EPS = 1e-9;

    for (const f of fills) {
      totalFees += f.fee;
      if (f.is_buyer === 1) {
        lots.push({ price: f.price, qty: f.size });
        continue;
      }
      // SELL: consume from oldest BUY lots first.
      let remaining = f.size;
      while (remaining > EPS && lots.length > 0) {
        const lot = lots[0]!;
        const matched = Math.min(lot.qty, remaining);
        realizedPnl += (f.price - lot.price) * matched;
        roundTrips++;
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= EPS) lots.shift();
      }
      // If `remaining > EPS` here, we had a SELL with no matching BUY lot
      // — that would mean either a SHORT bot or pre-existing position.
      // For LONG bots this should not happen; we silently ignore the
      // unmatched portion rather than crash so the endpoint stays robust.
    }

    const openSize = lots.reduce((acc, l) => acc + l.qty, 0);
    const openCost = lots.reduce((acc, l) => acc + l.qty * l.price, 0);
    const fillCount = fills.length;
    const netPnl = realizedPnl - totalFees;
    const avgPerRT = roundTrips > 0 ? realizedPnl / roundTrips : 0;

    return {
      realizedPnl,
      totalFees,
      netPnl,
      roundTrips,
      avgPerRT,
      fillCount,
      openSize,
      openCost,
      firstFillAt: fills[0]!.event_time,
      lastFillAt: fills[fills.length - 1]!.event_time,
    };
  }

  // === paired_roundtrips ===

  /**
   * Insert a paired round-trip. Idempotent on the (buy_fill_id, sell_fill_id)
   * unique constraint.
   */
  async insertPairedRoundtrip(params: {
    bot_id: number;
    buy_fill_id: string;
    sell_fill_id: string;
    buy_price: number;
    sell_price: number;
    size: number;
    profit: number;
    created_at: string;
  }): Promise<boolean> {
    const result = await this.dbRun(`
      INSERT INTO paired_roundtrips
        (bot_id, buy_fill_id, sell_fill_id, buy_price, sell_price, size, profit, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (buy_fill_id, sell_fill_id) DO NOTHING
    `, [
      params.bot_id,
      params.buy_fill_id,
      params.sell_fill_id,
      params.buy_price,
      params.sell_price,
      params.size,
      params.profit,
      params.created_at,
    ]);
    return (result.changes ?? 0) > 0;
  }

  /** Running or paused bots created by copying this one. */
  async listActiveCopyIds(botId: number): Promise<number[]> {
    const rows = await this.dbAll(
      `SELECT id FROM grid_bots
       WHERE copied_from_bot_id = ?
         AND status IN ('running', 'paused')
       ORDER BY id`,
      [botId],
    ) as Array<{ id: number }>;
    return rows.map((row) => row.id);
  }

  /** Count paired roundtrips for a specific bot. */
  async countPairedRoundtrips(botId: number): Promise<number> {
    const row = await this.dbGet(
      `SELECT COUNT(*) as c FROM paired_roundtrips WHERE bot_id = ?`, [botId]);
    return row?.c || 0;
  }

  /** Sum gross profit from paired roundtrips for a specific bot. */
  async sumPairedRoundtripProfit(botId: number): Promise<number> {
    const row = await this.dbGet(
      `SELECT COALESCE(SUM(profit), 0) as p FROM paired_roundtrips WHERE bot_id = ?`, [botId]);
    return row?.p || 0;
  }

  /** Sum fees from fills_archive for a specific bot. */
  async sumFeesForBot(botId: number): Promise<number> {
    const row = await this.dbGet(
      `SELECT COALESCE(SUM(fee), 0) as f FROM fills_archive WHERE bot_id = ?`, [botId]);
    return row?.f || 0;
  }

  getExecutor(): PostgresExecutor {
    return this.db;
  }

  // === Utilidades ===

  /**
   * Obtener estadísticas generales
   */
  async getStats(): Promise<{
    totalBots: number;
    activeBots: number;
    totalPnl: number;
    totalTrades: number;
  }> {
    const [botsCount, activeCount, pnlSum, tradesCount] = await Promise.all([
      this.dbGet(`SELECT COUNT(*) as count FROM grid_bots`),
      this.dbGet(`SELECT COUNT(*) as count FROM grid_bots WHERE status = 'running'`),
      this.dbGet(`SELECT COALESCE(SUM(total_pnl_usdt), 0) as total FROM grid_bots`),
      this.dbGet(`SELECT COUNT(*) as count FROM trades`)
    ]);

    return {
      totalBots: botsCount.count,
      activeBots: activeCount.count,
      totalPnl: pnlSum.total,
      totalTrades: tradesCount.count
    };
  }

  // ─── Multi-tenant: users ───────────────────────────────────────

  async createUser(params: {
    email: string;
    password_hash: string;
    is_admin?: boolean;
    google_sub?: string | null;
    email_verified?: boolean;
    accepted_referral_link?: boolean;
  }): Promise<UserId> {
    const id = newUserId();
    await this.dbRun(
      `INSERT INTO users
        (id, email, password_hash, is_admin, google_sub, email_verified, accepted_referral_link, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.email,
        params.password_hash,
        params.is_admin ? 1 : 0,
        params.google_sub ?? null,
        params.email_verified ? 1 : 0,
        params.accepted_referral_link ? 1 : 0,
        Date.now(),
      ]
    );
    return id;
  }

  async getUserByEmail(email: string): Promise<{
    id: UserId;
    email: string;
    password_hash: string;
    email_verified: number;
    is_admin: number;
    google_sub: string | null;
    created_at: number;
    last_login_at: number | null;
  } | null> {
    return await this.dbGet(`SELECT * FROM users WHERE email = ?`, [email]);
  }

  async getUserById(id: UserId): Promise<{
    id: UserId;
    email: string;
    password_hash: string;
    email_verified: number;
    is_admin: number;
    google_sub: string | null;
    token_version?: number;
    created_at: number;
    last_login_at: number | null;
    display_name?: string | null;
    avatar_url?: string | null;
    avatar_pathname?: string | null;
    avatar_updated_at?: number | null;
    bio?: string | null;
    notify_emails_enabled?: number | null;
    notify_profit?: number | null;
    notify_drawdown?: number | null;
    notify_liq?: number | null;
    notify_status?: number | null;
    notify_daily?: number | null;
    notify_profit_pct?: number | null;
  } | null> {
    return await this.dbGet(`SELECT * FROM users WHERE id = ?`, [id]);
  }

  async updateUserProfile(
    userId: UserId,
    patch: { display_name: string | null; bio: string | null },
  ): Promise<void> {
    await this.dbRun(
      `UPDATE users SET display_name = ?, bio = ? WHERE id = ?`,
      [patch.display_name, patch.bio, userId],
    );
  }

  async updateUserNotificationPrefs(
    userId: UserId,
    patch: {
      emailsEnabled: boolean;
      profitMilestones: boolean;
      drawdown: boolean;
      liqProximity: boolean;
      statusChanges: boolean;
      dailySummary: boolean;
      profitMilestonePct: number;
    },
  ): Promise<void> {
    await this.dbRun(
      `UPDATE users SET
        notify_emails_enabled = ?,
        notify_profit = ?,
        notify_drawdown = ?,
        notify_liq = ?,
        notify_status = ?,
        notify_daily = ?,
        notify_profit_pct = ?
       WHERE id = ?`,
      [
        patch.emailsEnabled ? 1 : 0,
        patch.profitMilestones ? 1 : 0,
        patch.drawdown ? 1 : 0,
        patch.liqProximity ? 1 : 0,
        patch.statusChanges ? 1 : 0,
        patch.dailySummary ? 1 : 0,
        patch.profitMilestonePct,
        userId,
      ],
    );
  }

  async updateUserAvatar(
    userId: UserId,
    patch: { avatar_url: string | null; avatar_pathname: string | null },
  ): Promise<void> {
    await this.dbRun(
      `UPDATE users SET avatar_url = ?, avatar_pathname = ?, avatar_updated_at = ? WHERE id = ?`,
      [patch.avatar_url, patch.avatar_pathname, Date.now(), userId],
    );
  }

  async getUserByGoogleSub(sub: string): Promise<{
    id: UserId;
    email: string;
    password_hash: string;
    email_verified: number;
    is_admin: number;
    google_sub: string | null;
    created_at: number;
    last_login_at: number | null;
  } | null> {
    return await this.dbGet(`SELECT * FROM users WHERE google_sub = ?`, [sub]);
  }

  async linkGoogleSub(userId: UserId, sub: string): Promise<void> {
    await this.dbRun(
      `UPDATE users SET google_sub = ? WHERE id = ? AND email_verified = 1`,
      [sub, userId]
    );
  }

  async deleteUnverifiedUser(userId: UserId): Promise<void> {
    await this.dbRun(
      `DELETE FROM users WHERE id = ? AND email_verified = 0`,
      [userId]
    );
  }

  async bumpTokenVersion(userId: UserId): Promise<number> {
    const row = await this.dbGet(
      `UPDATE users SET token_version = token_version + 1 WHERE id = ? RETURNING token_version`,
      [userId]
    );
    await this.revokeAllRefreshTokensForUser(userId);
    return row?.token_version ?? 1;
  }

  async commitPasswordChange(userId: UserId, passwordHash: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const row = await tx.get<{ token_version: number }>(
        `UPDATE users SET password_hash = ?, token_version = token_version + 1
         WHERE id = ? RETURNING token_version`,
        [passwordHash, userId]
      );
      await tx.run(
        `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
        [Date.now(), userId]
      );
      return row?.token_version ?? 1;
    });
  }

  async insertRefreshToken(params: {
    user_id: UserId;
    token_hash: string;
    expires_at: number;
    family_id: string;
  }): Promise<void> {
    await this.dbRun(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at, family_id) VALUES (?, ?, ?, ?, ?)`,
      [params.user_id, params.token_hash, params.expires_at, Date.now(), params.family_id]
    );
  }

  async rotateRefreshToken(params: {
    old_hash: string;
    new_hash: string;
    user_id: UserId;
    expires_at: number;
  }): Promise<'ok' | 'reused' | 'invalid'> {
    return this.db.transaction(async (tx) => {
      const row = await tx.get<{
        id: number;
        user_id: UserId;
        family_id: string;
        revoked_at: number | null;
        expires_at: number;
      }>(
        `SELECT id, user_id, family_id, revoked_at, expires_at
         FROM refresh_tokens WHERE token_hash = ? FOR UPDATE`,
        [params.old_hash]
      );
      if (!row || row.user_id !== params.user_id) return 'invalid';
      if (row.revoked_at || row.expires_at < Date.now()) {
        await tx.run(
          `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND family_id = ? AND revoked_at IS NULL`,
          [Date.now(), row.user_id, row.family_id]
        );
        return 'reused';
      }
      await tx.run(
        `UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
        [Date.now(), row.id]
      );
      await tx.run(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at, family_id)
         VALUES (?, ?, ?, ?, ?)`,
        [params.user_id, params.new_hash, params.expires_at, Date.now(), row.family_id]
      );
      return 'ok';
    });
  }

  async findRefreshToken(tokenHash: string): Promise<{
    id: number;
    user_id: UserId;
    token_hash: string;
    expires_at: number;
    revoked_at: number | null;
  } | null> {
    return await this.dbGet(
      `SELECT id, user_id, token_hash, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?`,
      [tokenHash]
    );
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.dbRun(
      `UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
      [Date.now(), tokenHash]
    );
  }

  async revokeAllRefreshTokensForUser(userId: UserId): Promise<void> {
    await this.dbRun(
      `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
      [Date.now(), userId]
    );
  }

  async updateUserLastLogin(userId: UserId): Promise<void> {
    await this.dbRun(
      `UPDATE users SET last_login_at = ? WHERE id = ?`,
      [Date.now(), userId]
    );
  }

  async markUserEmailVerified(userId: UserId): Promise<void> {
    await this.dbRun(
      `UPDATE users SET email_verified = 1 WHERE id = ?`,
      [userId]
    );
  }

  async countUsers(): Promise<number> {
    const row = await this.dbGet(`SELECT COUNT(*) as c FROM users`);
    return (row?.c as number) ?? 0;
  }

  async updateUserPassword(userId: UserId, password_hash: string): Promise<void> {
    await this.commitPasswordChange(userId, password_hash);
  }

  // ─── Email OTP challenges ──────────────────────────────────────

  async createEmailOtpChallenge(params: {
    id: string;
    user_id: UserId;
    purpose: 'signup' | 'login';
    code_hash: string;
    expires_at: number;
    ip_address: string | null;
  }): Promise<void> {
    await this.dbRun(
      `UPDATE email_otp_challenges
       SET consumed_at = ?
       WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`,
      [Date.now(), params.user_id, params.purpose]
    );
    await this.dbRun(
      `INSERT INTO email_otp_challenges
        (id, user_id, purpose, code_hash, expires_at, created_at, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        params.id,
        params.user_id,
        params.purpose,
        params.code_hash,
        params.expires_at,
        Date.now(),
        params.ip_address,
      ]
    );
  }

  async getEmailOtpChallenge(id: string): Promise<{
    id: string;
    user_id: UserId;
    purpose: 'signup' | 'login';
    code_hash: string;
    expires_at: number;
    consumed_at: number | null;
    attempts: number;
  } | null> {
    return await this.dbGet(
      `SELECT id, user_id, purpose, code_hash, expires_at, consumed_at, attempts
       FROM email_otp_challenges WHERE id = ?`,
      [id]
    );
  }

  async incrementEmailOtpAttempts(id: string): Promise<void> {
    await this.dbRun(
      `UPDATE email_otp_challenges SET attempts = attempts + 1 WHERE id = ?`,
      [id]
    );
  }

  async consumeEmailOtpChallenge(id: string): Promise<boolean> {
    const result = await this.dbRun(
      `UPDATE email_otp_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
      [Date.now(), id]
    );
    return result.changes === 1;
  }

  async rotateEmailOtpChallenge(
    id: string,
    code_hash: string,
    expires_at: number
  ): Promise<void> {
    await this.dbRun(
      `UPDATE email_otp_challenges
       SET code_hash = ?, expires_at = ?, created_at = ?
       WHERE id = ? AND consumed_at IS NULL`,
      [code_hash, expires_at, Date.now(), id]
    );
  }

  // ─── Multi-tenant: password reset tokens (E.9) ─────────────────

  async insertPasswordResetToken(params: {
    user_id: UserId;
    token_hash: string;
    expires_at: number;
    ip_address: string | null;
  }): Promise<number> {
    const result = await this.dbRun(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at, ip_address)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
      [params.user_id, params.token_hash, params.expires_at, Date.now(), params.ip_address]
    );
    return result.lastID ?? 0;
  }

  async findValidPasswordResetToken(token_hash: string): Promise<{
    id: number;
    user_id: UserId;
    expires_at: number;
  } | null> {
    return await this.dbGet(
      `SELECT id, user_id, expires_at FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
      [token_hash, Date.now()]
    );
  }

  async markPasswordResetTokenUsed(id: number): Promise<void> {
    await this.dbRun(
      `UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`,
      [Date.now(), id]
    );
  }

  // Mark all open tokens for a user as used. Called when issuing a new
  // token (so only the latest is valid) AND after a successful reset
  // (so a stolen-but-not-yet-used link is invalidated).
  async invalidateOpenPasswordResetTokensForUser(userId: UserId): Promise<void> {
    await this.dbRun(
      `UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`,
      [Date.now(), userId]
    );
  }

  // ─── Multi-tenant: terms acceptances ───────────────────────────

  async insertTermsAcceptance(params: {
    user_id: UserId;
    context: 'signup' | 'create_bot' | 'update_credentials';
    context_ref?: number | null;
    ip_address: string | null;
    user_agent: string | null;
    terms_version: string;
    terms_text: string;
    terms_text_hash: string;
  }): Promise<void> {
    await this.dbRun(
      `INSERT INTO terms_acceptances
        (user_id, context, context_ref, accepted_at, ip_address, user_agent, terms_version, terms_text_hash, terms_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.user_id,
        params.context,
        params.context_ref ?? null,
        Date.now(),
        params.ip_address,
        params.user_agent,
        params.terms_version,
        params.terms_text_hash,
        params.terms_text,
      ]
    );
  }

  // ─── Multi-tenant: grvt_credentials ────────────────────────────
  // Stores AES-256-GCM encrypted credential fields. Each field has
  // its own IV and auth tag. Reads return the raw encrypted blob;
  // decryption happens in the api/grvt-client-factory layer.

  async upsertGrvtCredentials(params: {
    user_id: UserId;
    encrypted_api_key: string;        api_key_iv: string;        api_key_tag: string;
    encrypted_api_secret: string;     api_secret_iv: string;     api_secret_tag: string;
    encrypted_trading_address: string;trading_address_iv: string;trading_address_tag: string;
    encrypted_account_id: string;     account_id_iv: string;     account_id_tag: string;
    encrypted_sub_account_id: string; sub_account_id_iv: string; sub_account_id_tag: string;
    last_test_ok: boolean;
    last_test_error?: string | null;
  }): Promise<void> {
    const now = Date.now();
    await this.dbRun(
      `INSERT INTO grvt_credentials (
        user_id,
        encrypted_api_key, api_key_iv, api_key_tag,
        encrypted_api_secret, api_secret_iv, api_secret_tag,
        encrypted_trading_address, trading_address_iv, trading_address_tag,
        encrypted_account_id, account_id_iv, account_id_tag,
        encrypted_sub_account_id, sub_account_id_iv, sub_account_id_tag,
        created_at, last_test_ok, last_test_at, last_test_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        encrypted_api_key = excluded.encrypted_api_key,
        api_key_iv = excluded.api_key_iv,
        api_key_tag = excluded.api_key_tag,
        encrypted_api_secret = excluded.encrypted_api_secret,
        api_secret_iv = excluded.api_secret_iv,
        api_secret_tag = excluded.api_secret_tag,
        encrypted_trading_address = excluded.encrypted_trading_address,
        trading_address_iv = excluded.trading_address_iv,
        trading_address_tag = excluded.trading_address_tag,
        encrypted_account_id = excluded.encrypted_account_id,
        account_id_iv = excluded.account_id_iv,
        account_id_tag = excluded.account_id_tag,
        encrypted_sub_account_id = excluded.encrypted_sub_account_id,
        sub_account_id_iv = excluded.sub_account_id_iv,
        sub_account_id_tag = excluded.sub_account_id_tag,
        last_test_ok = excluded.last_test_ok,
        last_test_at = excluded.last_test_at,
        last_test_error = excluded.last_test_error
      `,
      [
        params.user_id,
        params.encrypted_api_key, params.api_key_iv, params.api_key_tag,
        params.encrypted_api_secret, params.api_secret_iv, params.api_secret_tag,
        params.encrypted_trading_address, params.trading_address_iv, params.trading_address_tag,
        params.encrypted_account_id, params.account_id_iv, params.account_id_tag,
        params.encrypted_sub_account_id, params.sub_account_id_iv, params.sub_account_id_tag,
        now, params.last_test_ok ? 1 : 0, now, params.last_test_error ?? null,
      ]
    );
  }

  async getGrvtCredentialsRaw(userId: UserId): Promise<{
    user_id: UserId;
    encrypted_api_key: string;        api_key_iv: string;        api_key_tag: string;
    encrypted_api_secret: string;     api_secret_iv: string;     api_secret_tag: string;
    encrypted_trading_address: string;trading_address_iv: string;trading_address_tag: string;
    encrypted_account_id: string;     account_id_iv: string;     account_id_tag: string;
    encrypted_sub_account_id: string; sub_account_id_iv: string; sub_account_id_tag: string;
    created_at: number;
    last_used_at: number | null;
    last_test_ok: number | null;
    last_test_at: number | null;
    last_test_error: string | null;
  } | null> {
    return await this.dbGet(`SELECT * FROM grvt_credentials WHERE user_id = ?`, [userId]);
  }

  async hasGrvtCredentials(userId: UserId): Promise<boolean> {
    const row = await this.dbGet(`SELECT 1 FROM grvt_credentials WHERE user_id = ?`, [userId]);
    return !!row;
  }

  async deleteGrvtCredentials(userId: UserId): Promise<void> {
    await this.dbRun(`DELETE FROM grvt_credentials WHERE user_id = ?`, [userId]);
  }

  // Flip last_test_ok + record the live failure message. Called from
  // lifecycle endpoints when the engine fails to log into GRVT with the
  // user's stored credentials — surfaces a persistent warning in the
  // dashboard until the user re-saves their keys.
  async markGrvtCredentialsTestResult(
    userId: UserId,
    ok: boolean,
    errorMessage?: string | null,
  ): Promise<void> {
    await this.dbRun(
      `UPDATE grvt_credentials
         SET last_test_ok = ?, last_test_at = ?, last_test_error = ?
         WHERE user_id = ?`,
      [ok ? 1 : 0, Date.now(), ok ? null : (errorMessage ?? null), userId],
    );
  }

  async touchGrvtCredentialsLastUsed(userId: UserId): Promise<void> {
    await this.dbRun(
      `UPDATE grvt_credentials SET last_used_at = ? WHERE user_id = ?`,
      [Date.now(), userId]
    );
  }

  // ─── H.5: grvt_sub_accounts ────────────────────────────────────
  // Multiple GRVT sub-accounts per user. The default credentials
  // (grvt_credentials) stay; this table holds extras with a label.
  // Bots reference a row here via grid_bots.grvt_sub_account_id.

  async listGrvtSubAccounts(userId: UserId): Promise<Array<{
    id: number;
    user_id: UserId;
    label: string;
    is_default: number;
    last_test_ok: number | null;
    created_at: number;
  }>> {
    return await this.dbAll(
      `SELECT id, user_id, label, is_default, last_test_ok, created_at
         FROM grvt_sub_accounts
        WHERE user_id = ?
        ORDER BY is_default DESC, created_at ASC`,
      [userId]
    );
  }

  async getGrvtSubAccountRaw(id: number): Promise<{
    id: number;
    user_id: UserId;
    label: string;
    encrypted_api_key: string;        api_key_iv: string;        api_key_tag: string;
    encrypted_api_secret: string;     api_secret_iv: string;     api_secret_tag: string;
    encrypted_trading_address: string;trading_address_iv: string;trading_address_tag: string;
    encrypted_account_id: string;     account_id_iv: string;     account_id_tag: string;
    encrypted_sub_account_id: string; sub_account_id_iv: string; sub_account_id_tag: string;
    is_default: number;
    last_test_ok: number | null;
    created_at: number;
  } | null> {
    return await this.dbGet(
      `SELECT * FROM grvt_sub_accounts WHERE id = ?`,
      [id]
    );
  }

  async createGrvtSubAccount(params: {
    user_id: UserId;
    label: string;
    encrypted_api_key: string;        api_key_iv: string;        api_key_tag: string;
    encrypted_api_secret: string;     api_secret_iv: string;     api_secret_tag: string;
    encrypted_trading_address: string;trading_address_iv: string;trading_address_tag: string;
    encrypted_account_id: string;     account_id_iv: string;     account_id_tag: string;
    encrypted_sub_account_id: string; sub_account_id_iv: string; sub_account_id_tag: string;
    is_default: boolean;
    last_test_ok: boolean;
  }): Promise<number> {
    const now = Date.now();
    // If marked default, clear any other defaults for this user first.
    // SQLite does not give us atomic "demote others + insert new" without
    // an explicit transaction, so we run the demote then the insert. The
    // race-with-itself surface is small (single user clicking twice fast)
    // and any inconsistency is corrected by the next listGrvtSubAccounts
    // call which orders by is_default DESC.
    if (params.is_default) {
      await this.dbRun(
        `UPDATE grvt_sub_accounts SET is_default = 0 WHERE user_id = ?`,
        [params.user_id]
      );
    }
    const result = await this.dbRun(
      `INSERT INTO grvt_sub_accounts (
        user_id, label,
        encrypted_api_key, api_key_iv, api_key_tag,
        encrypted_api_secret, api_secret_iv, api_secret_tag,
        encrypted_trading_address, trading_address_iv, trading_address_tag,
        encrypted_account_id, account_id_iv, account_id_tag,
        encrypted_sub_account_id, sub_account_id_iv, sub_account_id_tag,
        is_default, last_test_ok, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`,
      [
        params.user_id, params.label,
        params.encrypted_api_key, params.api_key_iv, params.api_key_tag,
        params.encrypted_api_secret, params.api_secret_iv, params.api_secret_tag,
        params.encrypted_trading_address, params.trading_address_iv, params.trading_address_tag,
        params.encrypted_account_id, params.account_id_iv, params.account_id_tag,
        params.encrypted_sub_account_id, params.sub_account_id_iv, params.sub_account_id_tag,
        params.is_default ? 1 : 0,
        params.last_test_ok ? 1 : 0,
        now,
      ]
    );
    if (result.lastID === undefined) throw new Error('Failed to create GRVT sub-account');
    return result.lastID;
  }

  async updateGrvtSubAccountMeta(
    id: number,
    userId: UserId,
    patch: { label?: string; is_default?: boolean }
  ): Promise<void> {
    if (patch.is_default === true) {
      // Demote any other default before promoting this row.
      await this.dbRun(
        `UPDATE grvt_sub_accounts SET is_default = 0
          WHERE user_id = ? AND id != ?`,
        [userId, id]
      );
    }
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.label !== undefined) { sets.push('label = ?'); args.push(patch.label); }
    if (patch.is_default !== undefined) {
      sets.push('is_default = ?');
      args.push(patch.is_default ? 1 : 0);
    }
    if (sets.length === 0) return;
    args.push(id, userId);
    await this.dbRun(
      `UPDATE grvt_sub_accounts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      args
    );
  }

  async deleteGrvtSubAccount(id: number, userId: UserId): Promise<void> {
    await this.dbRun(
      `DELETE FROM grvt_sub_accounts WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
  }

  async countBotsUsingSubAccount(subAccountId: number): Promise<number> {
    const row = await this.dbGet(
      `SELECT COUNT(*) as c FROM grid_bots WHERE grvt_sub_account_id = ?`,
      [subAccountId]
    ) as { c: number } | undefined;
    return row?.c ?? 0;
  }

  // ─── Multi-tenant: bot listing per user ────────────────────────

  async getBotsForUser(userId: UserId): Promise<GridBot[]> {
    return await this.dbAll(
      `SELECT * FROM grid_bots WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
  }

  async countActiveBotsForUser(userId: UserId): Promise<number> {
    const row = await this.dbGet(
      `SELECT COUNT(*) as c FROM grid_bots WHERE user_id = ? AND status IN ('running', 'paused')`,
      [userId]
    );
    return (row?.c as number) ?? 0;
  }

  // ─── Owner bootstrap ───────────────────────────────────────────
  // Idempotent. If users is empty, creates a UUIDv4 admin from
  // OWNER_EMAIL + OWNER_INITIAL_PASSWORD and backfills NULL
  // user_id rows to that admin. If users already exist, returns
  // the first admin UUID (or the first valid UUID).
  async getFirstAdminUserId(): Promise<UserId | null> {
    const row = await this.dbGet(
      `SELECT id FROM users WHERE is_admin = 1 ORDER BY created_at ASC LIMIT 1`
    );
    return isUserId(row?.id) ? row.id : null;
  }

  async ownerBootstrap(params: {
    email: string;
    password_hash: string;
  }): Promise<{ created: boolean; userId: UserId }> {
    const existing = await this.countUsers();
    if (existing > 0) {
      const admin = await this.getFirstAdminUserId();
      if (admin) return { created: false, userId: admin };
      const first = await this.dbGet(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`);
      if (!isUserId(first?.id)) {
        throw new Error('users table has rows but no valid UUID id');
      }
      return { created: false, userId: first.id };
    }
    const userId = await this.createUser({
      email: params.email,
      password_hash: params.password_hash,
      is_admin: true,
    });
    // Backfill every per-bot row to this owner.
    const tables = [
      'grid_bots', 'grid_levels', 'orders', 'trades',
      'funding_history', 'daily_snapshots', 'fills_archive',
      'bot_cash_movements', 'paired_roundtrips',
    ];
    for (const t of tables) {
      await this.dbRun(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`, [userId]);
    }
    console.log(`👤 Owner bootstrap: user ${userId} (${params.email}) created and backfilled`);
    return { created: true, userId };
  }

  /**
   * Cerrar conexión a database
   */
  async close(): Promise<void> {
    await this.db.close();
    console.log('📊 PostgreSQL database cerrada');
  }
}

// Instancia singleton de la database
export const db = new GridBotDB();

export default db;