-- 025_user_books_genre.sql: género editorial de la guía comunitaria.
--
-- La sección «Comunidad» se filtra por género (pestaña Explora): la
-- columna guarda uno de los valores de BOOK_GENRES (o "" cuando el
-- EPUB no declara dc:subject mapeable y quien comparte no eligió uno).
-- Se rellena al subir (dc:subject normalizado) o al compartir (chips
-- de la hoja de opciones). TEXT + DEFAULT '' como author/language.
ALTER TABLE user_books
  ADD COLUMN IF NOT EXISTS genre TEXT NOT NULL DEFAULT '';
