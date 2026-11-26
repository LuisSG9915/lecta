-- 035_plan_events.sql: avisos de Lecta+ vistos por cuenta
-- (docs/designs/2026-11-25-monetizacion-lecta-plus.md, F19).
--
-- Una fila por (cuenta, día, evento) con `hits` sumado por UPSERT. Solo
-- guarda eventos `app:*` (paywall, fin de prueba, checkout) que llegan CON
-- sesión; sirve para medir qué aviso precede al pago por cohorte. Sin IP ni
-- texto libre. Es dato personal: va en el aviso de privacidad. Se borra con
-- la cuenta (ON DELETE CASCADE) y el cron de las 05:00 poda lo anterior a
-- 180 días.
--
-- Rollout: el worker tolera la tabla ausente (42P01), así que deploy y
-- migración van en cualquier orden. Idempotente: IF NOT EXISTS.
--
-- schema_locked: las tablas nuevas nacen bloqueadas; si algo falla con
-- «schema_locked=true», desbloquear, migrar y re-bloquear.

CREATE TABLE IF NOT EXISTS lecta_plan_events (
  user_id TEXT   NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  day     DATE   NOT NULL,
  event   STRING NOT NULL,
  hits    INT8   NOT NULL DEFAULT 0,
  CONSTRAINT lecta_plan_events_pk PRIMARY KEY (user_id, day, event)
);
