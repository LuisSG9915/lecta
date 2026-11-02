-- 024_user_books_community.sql: biblioteca comunitaria «solo papel».
--
-- El lector decide compartir un EPUB suyo (`shared` + `shared_at`): la
-- estantería de otras cuentas lo lista en la sección «Comunidad» y lo
-- adjunta como copia propia marcada `paper_only` — esa copia solo abre
-- el índice del modo papel, nunca el lector. La fila viaja por cuenta
-- como el resto de user_books; sin ella el attach no es más que una
-- descarga anónima y la copia moriría con la del donante.
ALTER TABLE user_books
  ADD COLUMN IF NOT EXISTS shared BOOL NOT NULL DEFAULT false;

ALTER TABLE user_books
  ADD COLUMN IF NOT EXISTS shared_at INT8 NOT NULL DEFAULT 0;

ALTER TABLE user_books
  ADD COLUMN IF NOT EXISTS paper_only BOOL NOT NULL DEFAULT false;

-- Catálogo: `WHERE shared GROUP BY book_id` deduplica por sha256 — el
-- mismo EPUB compartido por cinco lectores es una sola entrada. La PK
-- (user_id, book_id) queda fuera de la clave del índice para no
-- reproducir el índice colgado de CockroachDB.
CREATE INDEX IF NOT EXISTS idx_user_books_shared
  ON user_books (book_id) WHERE shared;
