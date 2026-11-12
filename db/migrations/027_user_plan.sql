-- 027_user_plan.sql: plan por cuenta (free / lecta_plus / founder_lifetime),
-- idempotencia de webhooks de Stripe y libros propios solo con metadatos.
--
-- Rollout (docs/designs/2026-11-12-planes-y-landing.md):
--   * El worker se despliega antes que esta migración. Sin la tabla, el plan
--     se lee como founder_lifetime (degradado) y las escrituras responden 503.
--   * NO aplicar en `lecta` antes de 2026-11-13T00:00:00Z: el INSERT de
--     fundadores corre una sola vez y las cuentas creadas después quedarían
--     sin fila (free) aunque sean anteriores al corte.
--   * user_books suele estar con schema_locked=true: desbloquearla solo para
--     el ALTER y volver a bloquearla (ver 016 y 026).
-- Sellos en INT8 (ms epoch), como reset_at y synced_at. Sin RLS.

CREATE TABLE IF NOT EXISTS lecta_user_plan (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'lecta_plus', 'founder_lifetime')),
  starter_coat TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan_expires_at INT8,
  created_at INT8 NOT NULL,
  updated_at INT8 NOT NULL
);

-- Sin las columnas de la PK: CockroachDB las añade implícitas y un índice
-- que las incluye completas se cuelga en el cluster (AGENTS.md).
CREATE INDEX IF NOT EXISTS idx_user_plan_stripe_customer
  ON lecta_user_plan (stripe_customer_id);

CREATE TABLE IF NOT EXISTS lecta_stripe_events (
  event_id TEXT PRIMARY KEY,
  processed_at INT8 NOT NULL
);

-- Libros propios registrados solo con metadatos (plan free): r2_key = ''
-- y has_file = false. Las filas existentes tienen archivo.
ALTER TABLE user_books ADD COLUMN IF NOT EXISTS has_file BOOL NOT NULL DEFAULT true;

-- Mecenas Fundadores: toda cuenta creada antes de 2026-11-13T00:00:00Z
-- (epoch 1794528000). Misma forma de comparación que src/worker/admin.ts.
INSERT INTO lecta_user_plan (user_id, plan, created_at, updated_at)
SELECT id, 'founder_lifetime',
       (extract(epoch from now()) * 1000)::INT8,
       (extract(epoch from now()) * 1000)::INT8
FROM "user"
WHERE "createdAt" < to_timestamp(1794528000)
ON CONFLICT (user_id) DO UPDATE SET plan = 'founder_lifetime';
