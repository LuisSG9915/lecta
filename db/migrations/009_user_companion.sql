-- Compañero del Cuaderno (el gato) sincronizado por cuenta.
-- Cuatro colecciones independientes: baselines de la versión local
-- anterior (inmutables, uno por dispositivo de origen), journal de
-- eventos nuevos (append-only por id), registros mutables por campo
-- (nombre/ropa/presencia, árbitro updated_at+operation_id) y recibos
-- monotónicos (créditos de logro, cofres abiertos, avisos vistos).
-- Todos caen por ON DELETE CASCADE con la cuenta, igual que el resto.
CREATE TABLE IF NOT EXISTS lecta_user_companion_baselines (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  origin_id STRING NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (user_id, origin_id)
);

CREATE TABLE IF NOT EXISTS lecta_user_companion_events (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id STRING NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS lecta_user_companion_fields (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  field STRING NOT NULL,
  value JSONB NOT NULL,
  updated_at INT8 NOT NULL,
  operation_id STRING NOT NULL,
  PRIMARY KEY (user_id, field)
);

CREATE TABLE IF NOT EXISTS lecta_user_companion_receipts (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id STRING NOT NULL,
  at INT8 NOT NULL,
  PRIMARY KEY (user_id, id)
);
