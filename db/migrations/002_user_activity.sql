-- Intervalos de lectura por cuenta (sincronización entre dispositivos).
-- Inmutables y anexables: la clave es (user_id, id) y el cliente manda
-- el uuid que generó al cerrar el intervalo.
CREATE TABLE IF NOT EXISTS lecta_user_activity (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id STRING NOT NULL,
  book_hash STRING NOT NULL,
  started_at INT8 NOT NULL,
  ended_at INT8 NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS lecta_user_activity_user
  ON lecta_user_activity (user_id);
