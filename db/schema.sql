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
