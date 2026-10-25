-- 015_server_synced_at.sql: Cursor de pull basado en tiempo del servidor (synced_at).
-- Protege contra relojes de cliente atrasados o adelantados desvinculando
-- el cursor incremental del árbitro LWW (updated_at).

ALTER TABLE lecta_user_words ADD COLUMN IF NOT EXISTS synced_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint;
ALTER TABLE lecta_user_knowledge ADD COLUMN IF NOT EXISTS synced_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint;
ALTER TABLE lecta_user_annotations ADD COLUMN IF NOT EXISTS synced_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint;
ALTER TABLE lecta_user_reviews ADD COLUMN IF NOT EXISTS synced_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint;
ALTER TABLE lecta_user_positions ADD COLUMN IF NOT EXISTS synced_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint;
ALTER TABLE lecta_user_activity ADD COLUMN IF NOT EXISTS synced_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint;

CREATE INDEX IF NOT EXISTS idx_user_words_synced_at ON lecta_user_words (user_id, language, synced_at ASC);
CREATE INDEX IF NOT EXISTS idx_user_knowledge_synced_at ON lecta_user_knowledge (user_id, synced_at ASC);
CREATE INDEX IF NOT EXISTS idx_user_annotations_synced_at ON lecta_user_annotations (user_id, synced_at ASC);
CREATE INDEX IF NOT EXISTS idx_user_reviews_synced_at ON lecta_user_reviews (user_id, synced_at ASC);
CREATE INDEX IF NOT EXISTS idx_user_positions_synced_at ON lecta_user_positions (user_id, synced_at ASC);
CREATE INDEX IF NOT EXISTS idx_user_activity_synced_at ON lecta_user_activity (user_id, synced_at ASC);
