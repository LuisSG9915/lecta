-- Posición de lectura por cuenta y libro (continuidad entre
-- dispositivos). Una fila por (user_id, book_hash); updated_at arbitra
-- como en vocabulario y anotaciones.
CREATE TABLE IF NOT EXISTS lecta_user_positions (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_hash STRING NOT NULL,
  section_index INT8 NOT NULL DEFAULT 0,
  scroll_top FLOAT8 NOT NULL DEFAULT 0,
  ratio FLOAT8,
  progress FLOAT8,
  anchor STRING,
  updated_at INT8 NOT NULL,
  PRIMARY KEY (user_id, book_hash)
);
