-- 018_error_signatures.sql
-- Errores agrupados por huella: una fila por (día, firma), no por evento.
--
-- `signature` = SHA-256 truncado de `name|code|route_normalizada|primer frame`.
-- `hits` se incrementa con UPSERT, así que un bucle de 10 000 errores escribe
-- 10 000 veces el mismo renglón en lugar de crear 10 000 filas.
--
-- `sample_frames` y `last_message` existen solo para depurar: el primero es el
-- contexto de llamada (hasta 3 frames limpios unidos por « -> », 200 caracteres);
-- el segundo viaja únicamente si el usuario activó «incluir mensaje del error»
-- en Diagnóstico, y puede contener texto del libro que estaba leyendo.
--
-- Retención: el cron de las 05:00 borra las filas con `bucket_day` anterior a
-- 30 días (ERROR_SIGNATURE_MAX_DAYS), así que la tabla no crece sin límite.

CREATE TABLE IF NOT EXISTS lecta_error_signatures (
  bucket_day    DATE        NOT NULL,
  signature     STRING      NOT NULL,
  route         STRING      NOT NULL,
  name          STRING      NOT NULL,
  code          STRING      NOT NULL DEFAULT '',
  version       STRING      NOT NULL DEFAULT '',
  hits          INT8        NOT NULL DEFAULT 0,
  sample_frames STRING      NOT NULL DEFAULT '',
  last_message  STRING      NULL,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lecta_error_signatures_pk PRIMARY KEY (bucket_day, signature)
);
