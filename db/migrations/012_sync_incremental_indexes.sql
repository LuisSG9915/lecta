-- Índices para optimizar las consultas incrementales de sincronización (filtro temporal y orden ascendente).
CREATE INDEX IF NOT EXISTS idx_user_words_user_lang_updated
  ON lecta_user_words (user_id, language, updated_at);

CREATE INDEX IF NOT EXISTS idx_user_knowledge_user_lang_updated
  ON lecta_user_knowledge (user_id, language, updated_at);

CREATE INDEX IF NOT EXISTS idx_user_annotations_user_updated
  ON lecta_user_annotations (user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_ended_id
  ON lecta_user_activity (user_id, ended_at, id);

CREATE INDEX IF NOT EXISTS idx_user_reviews_user_created_id
  ON lecta_user_reviews (user_id, created_at, id);
