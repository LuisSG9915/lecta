-- Procedencia por acepción, como ya tienen entradas y formas:
-- distingue lo cargado del Wikcionario (obligaciones CC BY-SA/GFDL)
-- de lo generado por IA y lo sembrado a mano. NULL = fila previa a
-- esta columna (semilla o lista original).
ALTER TABLE lexicon_senses ADD COLUMN IF NOT EXISTS source STRING;

-- Las acepciones bajo entradas 'ai' salieron del enriquecimiento IA;
-- quedan rotuladas para auditoría (y para no confundirlas con la
-- carga del Wikcionario).
UPDATE lexicon_senses s SET source = 'ai'
FROM lexicon_entries e
WHERE e.id = s.entry_id AND e.source = 'ai' AND s.source IS NULL;
