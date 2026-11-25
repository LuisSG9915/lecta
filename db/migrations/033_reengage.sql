-- 033_reengage.sql: correo de regreso a los 7 días de inactividad
-- (docs/designs/2026-11-24-correo-de-regreso.md).
--
-- Opt-out: el correo llega salvo que la cuenta se dé de baja. reengage_sent_at
-- marca el último envío (uno por ausencia, máximo uno cada 30 días). Se guarda
-- en lecta_user_plan (ya per-usuario), como la 031. Sin estas columnas el cron
-- no envía nada. Idempotente: ADD COLUMN IF NOT EXISTS.
--
-- schema_locked: lecta_user_plan nace bloqueada; si el ALTER falla con
-- «schema_locked=true», desbloquear, migrar y re-bloquear.

ALTER TABLE lecta_user_plan
  ADD COLUMN IF NOT EXISTS reengage_opt_out BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE lecta_user_plan
  ADD COLUMN IF NOT EXISTS reengage_sent_at INT8;
