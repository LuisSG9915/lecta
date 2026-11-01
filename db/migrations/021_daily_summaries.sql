-- 021_daily_summaries.sql: Resumen diario de uso por dispositivo.
--
-- Telemetría de la fase de análisis: hasta ahora velocidad de lectura,
-- foco, retrocesos, fatiga, preparación, TTS y consejos solo vivían en
-- el dispositivo (readingEvents de IndexedDB). Cada cliente empuja una
-- fila por (usuario, día, dispositivo) con conteos y totales — nunca
-- texto ni palabras — y el servidor la conserva para el panel del
-- dueño y la vista personal.
--
-- `day` es YYYY-MM-DD en la zona `tz` del dispositivo que agregó (el
-- mismo criterio que el panel: los días son locales, no UTC).
-- `updated_at` arbitra el upsert como en las demás colecciones:
-- gana la fila más reciente. `synced_at` es el sello de servidor.
CREATE TABLE IF NOT EXISTS lecta_daily_summaries (
  user_id       STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  day           STRING NOT NULL,
  device        STRING NOT NULL DEFAULT 'unknown',
  tz            STRING NOT NULL DEFAULT 'UTC',
  minutes       FLOAT8 NOT NULL DEFAULT 0,
  dwell_ms      INT8 NOT NULL DEFAULT 0,
  words_read    INT8 NOT NULL DEFAULT 0,
  consults      INT8 NOT NULL DEFAULT 0,
  regressions   INT8 NOT NULL DEFAULT 0,
  fatigue       INT8 NOT NULL DEFAULT 0,
  words_saved   INT8 NOT NULL DEFAULT 0,
  reviews       INT8 NOT NULL DEFAULT 0,
  review_hits   INT8 NOT NULL DEFAULT 0,
  prep_answered INT8 NOT NULL DEFAULT 0,
  prep_known    INT8 NOT NULL DEFAULT 0,
  tts_ms        INT8 NOT NULL DEFAULT 0,
  tips_shown    INT8 NOT NULL DEFAULT 0,
  tips_accepted INT8 NOT NULL DEFAULT 0,
  updated_at    INT8 NOT NULL,
  synced_at     INT8 NOT NULL,
  PRIMARY KEY (user_id, day, device)
);

-- Consulta del panel por usuario y sello de servidor. La PK no se
-- incluye entera (Cockroach la añade implícita al índice): con las
-- tres columnas la sentencia quedaba esperando el GC de esquema.
CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_synced
  ON lecta_daily_summaries (user_id, synced_at);
