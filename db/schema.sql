-- Catálogo léxico global de Lecta (por idioma, compartido entre cuentas).
CREATE TABLE IF NOT EXISTS lexicon_entries (
  id INT8 PRIMARY KEY DEFAULT unique_rowid(),
  language STRING NOT NULL,
  lemma STRING NOT NULL,
  pos STRING,
  freq_rank INT4,
  UNIQUE (language, lemma, pos)
);

CREATE TABLE IF NOT EXISTS lexicon_forms (
  language STRING NOT NULL,
  form STRING NOT NULL,
  entry_id INT8 NOT NULL REFERENCES lexicon_entries(id) ON DELETE CASCADE,
  PRIMARY KEY (language, form, entry_id)
);
CREATE INDEX IF NOT EXISTS lexicon_forms_lookup ON lexicon_forms (language, form);

CREATE TABLE IF NOT EXISTS lexicon_senses (
  entry_id INT8 NOT NULL REFERENCES lexicon_entries(id) ON DELETE CASCADE,
  sense_order INT4 NOT NULL DEFAULT 1,
  definition STRING NOT NULL,
  example STRING,
  PRIMARY KEY (entry_id, sense_order)
);

-- Vocabulario guardado por cuenta (sincronización entre dispositivos).
-- Prefijo lecta_ porque esta base se comparte con otros proyectos.
CREATE TABLE IF NOT EXISTS lecta_user_words (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  language STRING NOT NULL,
  form STRING NOT NULL,
  lemma STRING,
  pos STRING,
  meaning STRING,
  context STRING,
  book_hash STRING,
  card JSONB,
  saved_at INT8 NOT NULL,
  updated_at INT8 NOT NULL,
  deleted BOOL NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, language, form)
);
CREATE INDEX IF NOT EXISTS lecta_user_words_user ON lecta_user_words (user_id, language);
ALTER TABLE lecta_user_words ADD COLUMN IF NOT EXISTS deleted BOOL NOT NULL DEFAULT false;

-- Consumo de IA por cuenta (ventana deslizante); el Cron lo depura.
CREATE TABLE IF NOT EXISTS lecta_rate_log (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  units INT8 NOT NULL,
  created_at INT8 NOT NULL
);
CREATE INDEX IF NOT EXISTS lecta_rate_log_window ON lecta_rate_log (user_id, created_at);

-- Marcadores y pasajes del lector por cuenta (sincronización entre
-- dispositivos). En bases existentes se aplica con la migración
-- db/migrations/001_user_annotations.sql.
CREATE TABLE IF NOT EXISTS lecta_user_annotations (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_hash STRING NOT NULL,
  id STRING NOT NULL,
  kind STRING NOT NULL,
  section_index INT8 NOT NULL DEFAULT 0,
  anchor STRING,
  text STRING,
  prefix STRING,
  suffix STRING,
  note STRING,
  created_at INT8 NOT NULL,
  updated_at INT8 NOT NULL,
  deleted BOOL NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, book_hash, id)
);
CREATE INDEX IF NOT EXISTS lecta_user_annotations_user
  ON lecta_user_annotations (user_id);

CREATE TABLE IF NOT EXISTS kindle_link_codes (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT,
  session_token TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 600)
);
CREATE INDEX IF NOT EXISTS idx_kindle_link_codes_status ON kindle_link_codes(status, expires_at);

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

