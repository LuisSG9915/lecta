-- 028_landing_daily.sql: embudo de la landing (/inicio/) agregado por día.
--
-- Una fila por (día, evento, fuente) con `hits` sumado por UPSERT, igual que
-- lecta_error_signatures (018). Sin cookies, sin IP, sin id de usuario: solo
-- contadores. `source` es utm_source o el dominio de referencia normalizado
-- (máx. 32 caracteres, `direct` si no hay ninguno).
--
-- Eventos (allowlist en src/worker/landing-events.ts): `view`, `cta:<lugar>`,
-- `demo_open`, `demo_save`, `demo_reveal`, `pick_cat`, `price_toggle` y
-- `signup` (este último solo lo escribe el worker al reclamar el gato).
--
-- Rollout: el worker tolera la tabla ausente (la escritura se traga el error
-- y el endpoint responde 204), así que deploy y migración van en cualquier
-- orden. Retención: el cron de las 05:00 borra lo anterior a 90 días.

CREATE TABLE IF NOT EXISTS lecta_landing_daily (
  bucket_day DATE   NOT NULL,
  event      STRING NOT NULL,
  source     STRING NOT NULL,
  hits       INT8   NOT NULL DEFAULT 0,
  CONSTRAINT lecta_landing_daily_pk PRIMARY KEY (bucket_day, event, source)
);
