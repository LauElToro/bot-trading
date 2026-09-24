-- Daily equity of the GRVT account (default credentials plus every
-- connected sub-account). This is the account balance, not the sum of
-- bot ledgers. One row per user per day; later reads overwrite today.

CREATE TABLE IF NOT EXISTS account_equity_daily (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  equity DOUBLE PRECISION NOT NULL,
  unrealized DOUBLE PRECISION NOT NULL DEFAULT 0,
  realized DOUBLE PRECISION NOT NULL DEFAULT 0,
  funding DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
