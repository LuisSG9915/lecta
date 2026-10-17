CREATE TABLE IF NOT EXISTS kindle_link_codes (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT,
  session_token TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 600)
);
CREATE INDEX IF NOT EXISTS idx_kindle_link_codes_status ON kindle_link_codes(status, expires_at);
