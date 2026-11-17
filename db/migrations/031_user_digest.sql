-- 031_user_digest.sql: preferencia de resumen semanal por correo.
--
-- Opt-in por cuenta para recibir el digest semanal (fan-out del cron y
-- baja por token). Se guarda en lecta_user_plan (ya per-usuario) para no
-- crear otra tabla. Idempotente: ADD COLUMN IF NOT EXISTS.
--
-- schema_locked: lecta_user_plan puede estar bloqueada; si el ALTER falla
-- con «schema_locked=true», desbloquear, migrar y re-bloquear.

ALTER TABLE lecta_user_plan
  ADD COLUMN IF NOT EXISTS digest_opt_in BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE lecta_user_plan
  ADD COLUMN IF NOT EXISTS digest_unsubscribe_token TEXT;