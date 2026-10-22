-- El sync de conocimiento sin filtro de idioma ordena por
-- (updated_at, language, lemma). El índice de 012
-- (user_id, language, updated_at) no cubre ese orden, así que Cockroach
-- hacía top-k + filter sobre la tabla. Este índice sí casa con la consulta.
CREATE INDEX IF NOT EXISTS idx_user_knowledge_user_updated_lang_lemma
  ON lecta_user_knowledge (user_id, updated_at, language, lemma);
