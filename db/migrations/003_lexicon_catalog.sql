-- Catálogo léxico: procedencia y calidad (Fase 2 del plan).
-- Permite distinguir lo cargado de fuentes lingüísticas, lo generado
-- por IA y lo verificado, y sostener el botón «no corresponde».

-- Versión y licencia de cada fuente externa cargada (wordfreq,
-- simplemma, Wikcionario). Una fila por carga.
CREATE TABLE IF NOT EXISTS lexicon_sources (
  id INT8 PRIMARY KEY DEFAULT unique_rowid(),
  name STRING NOT NULL,
  version STRING,
  license STRING,
  url STRING,
  loaded_at INT8 NOT NULL
);

-- zipf: frecuencia medida por wordfreq (escala ~0–8); distinta de
-- freq_rank, que el enriquecimiento IA estima. source: de dónde vino
-- el lema ('ai', 'list', 'wiktionary', 'manual', 'seed').
-- status: calidad ('ok', 'doubtful', 'low-info', 'error').
ALTER TABLE lexicon_entries ADD COLUMN IF NOT EXISTS zipf FLOAT8;
ALTER TABLE lexicon_entries ADD COLUMN IF NOT EXISTS source STRING;
ALTER TABLE lexicon_entries ADD COLUMN IF NOT EXISTS status STRING;
ALTER TABLE lexicon_entries ADD COLUMN IF NOT EXISTS model_version STRING;
ALTER TABLE lexicon_entries ADD COLUMN IF NOT EXISTS prompt_version STRING;

-- Sentidos: estado editorial y contador de reportes «no corresponde».
ALTER TABLE lexicon_senses ADD COLUMN IF NOT EXISTS status STRING;
ALTER TABLE lexicon_senses ADD COLUMN IF NOT EXISTS reports INT4 NOT NULL DEFAULT 0;

-- Formas: procedencia ('list' de simplemma | 'ia') y si la misma forma
-- apunta a más de un lema (útil para sugerencias y desambiguación).
ALTER TABLE lexicon_forms ADD COLUMN IF NOT EXISTS source STRING;
ALTER TABLE lexicon_forms ADD COLUMN IF NOT EXISTS ambiguous BOOL NOT NULL DEFAULT false;
