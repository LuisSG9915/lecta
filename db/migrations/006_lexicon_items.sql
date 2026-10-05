-- Ítems de ejercicio generados por IA y validados por reglas (Nivel B).
-- Un ítem por acepción del catálogo: la oración nueva sirve para
-- «elegir el significado en contexto» y para «completar la oración».
CREATE TABLE IF NOT EXISTS lexicon_items (
  id STRING NOT NULL PRIMARY KEY,
  entry_id INT8 NOT NULL REFERENCES lexicon_entries(id) ON DELETE CASCADE,
  sense_order INT4 NOT NULL,
  sentence STRING NOT NULL,
  distractors JSONB NOT NULL,        -- [3 definiciones incorrectas plausibles]
  status STRING NOT NULL DEFAULT 'auto_validado',  -- auto_validado | verificado | rechazado
  model_version STRING,
  prompt_version STRING,
  attempts INT8 NOT NULL DEFAULT 0,
  correct INT8 NOT NULL DEFAULT 0,
  created_at INT8 NOT NULL,
  UNIQUE (entry_id, sense_order)
);

-- Alcance del consumo IA en lecta_rate_log: los ítems de ejercicio y la
-- corrección de oraciones comparten la tabla pero con presupuesto propio
-- ('item', 'verify'), así no se comen la cuota de enriquecimiento
-- ('enrich', el valor que reciben las filas ya registradas).
ALTER TABLE lecta_rate_log ADD COLUMN IF NOT EXISTS scope STRING NOT NULL DEFAULT 'enrich';
