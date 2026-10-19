-- 011_user_books.sql: Sincronización Cloud de EPUBs propios (BYO-EPUB) en D1 y R2
CREATE TABLE IF NOT EXISTS user_books (
  user_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_user_books_user
  ON user_books(user_id, updated_at DESC);
