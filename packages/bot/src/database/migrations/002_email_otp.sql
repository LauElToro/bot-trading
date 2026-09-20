CREATE TABLE IF NOT EXISTS email_otp_challenges (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'login')),
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_otp_user
  ON email_otp_challenges(user_id, purpose);

CREATE INDEX IF NOT EXISTS idx_email_otp_expiry
  ON email_otp_challenges(expires_at);
