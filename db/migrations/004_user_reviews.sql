-- Historial de repasos por cuenta (append-only, como la actividad).
-- La clave es (user_id, id) y el cliente manda el uuid que generó al
-- cerrar el repaso; el servidor solo inserta los que faltan.
CREATE TABLE IF NOT EXISTS lecta_user_reviews (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id STRING NOT NULL,
  language STRING NOT NULL,
  form STRING NOT NULL,
  kind STRING NOT NULL,
  rating STRING NOT NULL,
  hints INT4 NOT NULL DEFAULT 0,
  created_at INT8 NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS lecta_user_reviews_user ON lecta_user_reviews (user_id);

-- Acepción elegida al guardar: (entry_id, sense_order) identifica la
-- fila de lexicon_senses; meaning queda como copia para repaso offline.
ALTER TABLE lecta_user_words ADD COLUMN IF NOT EXISTS sense_entry_id INT8;
ALTER TABLE lecta_user_words ADD COLUMN IF NOT EXISTS sense_order INT4;
