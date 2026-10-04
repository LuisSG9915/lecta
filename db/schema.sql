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
