-- 029_gutenberg_books.sql: índice de Project Gutenberg para la búsqueda
-- del catálogo ampliado. Vive en lecta_dev junto al léxico compartido; el
-- worker lo lee por nombre calificado (CATALOG) con el binding con caché.
CREATE TABLE IF NOT EXISTS gutenberg_books (
  gutenberg_id INT4 PRIMARY KEY,
  language STRING NOT NULL,
  title STRING NOT NULL,
  author STRING NOT NULL DEFAULT '',
  subjects STRING[] NOT NULL DEFAULT ARRAY[]::STRING[],
  downloads INT4 NOT NULL DEFAULT 0,
  issued STRING,
  search_text STRING NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gutenberg_books_lang_downloads
  ON gutenberg_books (language, downloads DESC);
