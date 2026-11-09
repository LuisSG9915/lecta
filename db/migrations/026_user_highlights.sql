-- Resaltados de pasajes del portal Kindle (/k).
CREATE TABLE IF NOT EXISTS lecta_user_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_hash TEXT NOT NULL,
  section_index INT NOT NULL,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT false,
  synced_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_user_highlights_user_book_section
  ON lecta_user_highlights (user_id, book_hash, section_index);

ALTER TABLE lecta_user_highlights ENABLE ROW LEVEL SECURITY;
-- schema_locked se activa manualmente tras la migración.