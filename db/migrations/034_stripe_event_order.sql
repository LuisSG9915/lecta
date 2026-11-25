-- 034_stripe_event_order.sql: orden de los eventos de Stripe
-- (docs/designs/2026-11-25-monetizacion-lecta-plus.md, F14).
--
-- stripe_event_created guarda el instante (ms) del último evento de Stripe
-- aplicado a la fila del plan. upsertPlanFromStripe ignora eventos más viejos:
-- un customer.subscription.updated que llega tarde ya no pisa un deleted
-- más nuevo. Sin la columna el worker aplica el evento como antes (42703).
-- Idempotente: ADD COLUMN IF NOT EXISTS.
--
-- schema_locked: lecta_user_plan nace bloqueada; si el ALTER falla con
-- «schema_locked=true», desbloquear, migrar y re-bloquear.

ALTER TABLE lecta_user_plan
  ADD COLUMN IF NOT EXISTS stripe_event_created INT8;
