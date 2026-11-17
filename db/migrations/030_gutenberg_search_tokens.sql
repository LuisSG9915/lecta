-- 030_gutenberg_search_tokens.sql: tokens de búsqueda para el índice de
-- Gutenberg (Explora). Evita el FULL SCAN de `LIKE '%...%'` sobre
-- search_text añadiendo una columna STRING[] con índice invertido y
-- cambiando la búsqueda del worker a containment (@>).
--
-- CockroachDB: las tablas nuevas nacen con schema_locked=true; si el ALTER
-- o el CREATE INVERTED INDEX falla con «schema_locked=true», desbloquear
-- solo para esta migración y volver a bloquear después:
--   ALTER TABLE gutenberg_books SET (schema_locked = false);
--   ...migración...
--   ALTER TABLE gutenberg_books SET (schema_locked = true);
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE INVERTED INDEX IF NOT EXISTS,
-- y el backfill solo toca filas sin tokens.

ALTER TABLE gutenberg_books
  ADD COLUMN IF NOT EXISTS search_tokens STRING[] NOT NULL DEFAULT ARRAY[]::STRING[];

-- Backfill de filas cargadas antes de esta migración (el script nuevo ya
-- escribe search_tokens al hacer UPSERT). Tokeniza el search_text ya
-- normalizado: quita puntuación, parte por espacios y descarta vacíos.
UPDATE gutenberg_books
   SET search_tokens = array_remove(
         string_to_array(
           trim(regexp_replace(lower(search_text), '[^a-z0-9 ]', ' ', 'g')),
           ' '
         ),
         ''
       )
 WHERE array_length(search_tokens, 1) IS NULL
    OR array_length(search_tokens, 1) = 0;

-- Índice invertido: permite `search_tokens @> $terms` sin full scan.
CREATE INVERTED INDEX IF NOT EXISTS idx_gutenberg_books_search_tokens
  ON gutenberg_books (search_tokens);