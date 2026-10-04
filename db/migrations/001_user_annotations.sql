-- Marcadores y pasajes del lector por cuenta (sincronización entre
-- dispositivos). Prefijo lecta_ porque esta base se comparte.
CREATE TABLE IF NOT EXISTS lecta_user_annotations (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_hash STRING NOT NULL,
  id STRING NOT NULL,
  kind STRING NOT NULL,
  section_index INT8 NOT NULL DEFAULT 0,
  anchor STRING,
  text STRING,
  prefix STRING,
  suffix STRING,
  note STRING,
  created_at INT8 NOT NULL,
  updated_at INT8 NOT NULL,
  deleted BOOL NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, book_hash, id)
);
CREATE INDEX IF NOT EXISTS lecta_user_annotations_user
  ON lecta_user_annotations (user_id);
