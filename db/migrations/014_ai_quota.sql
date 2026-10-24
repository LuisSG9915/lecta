-- 014_ai_quota.sql: Cuota atómica de IA por cuenta, alcance y hora natural.
-- La PK (user_id, scope, bucket_hour) es lo que permite que
-- INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING sea una sola
-- operación atómica: dos peticiones simultáneas no pueden leer el mismo
-- total y superar el límite.
CREATE TABLE IF NOT EXISTS lecta_ai_quota (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  scope STRING NOT NULL,
  bucket_hour INT8 NOT NULL,
  units_used INT8 NOT NULL,
  updated_at INT8 NOT NULL,
  PRIMARY KEY (user_id, scope, bucket_hour)
);
