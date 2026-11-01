-- 022_book_language.sql: idioma de cada libro propio sincronizado.
--
-- El idioma ya viaja en el EPUB local (StoredBook.language) pero el
-- registro cloud solo guardaba título y autor; sin él el panel no
-- puede agrupar lectura por idioma. El worker lo pide en el encabezado
-- `x-book-language` de la subida y tolera la columna ausente igual que
-- kindle_prefs tolera la tabla ausente: desplegar antes que migrar.
ALTER TABLE user_books
  ADD COLUMN IF NOT EXISTS language STRING NOT NULL DEFAULT '';
