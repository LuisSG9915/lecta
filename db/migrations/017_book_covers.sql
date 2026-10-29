-- 017_book_covers.sql: Sello de portada existente para previsualización remota
ALTER TABLE user_books
  ADD COLUMN IF NOT EXISTS has_cover BOOLEAN NOT NULL DEFAULT FALSE;
