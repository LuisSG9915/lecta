# Prueba inversa de 14 días y cortesía diaria de IA

Aprobado por Luis el 2026-11-24.

## Por qué

Casi ninguna cuenta free llega a ver lo que vende Lecta+ (Palabras previstas, IA en
contexto, Kindle, nube): la prueba de 7 días exige tarjeta y la cortesía de IA (5 al
mes) se agota en una sesión o no se descubre. Queremos que toda cuenta nueva viva
Lecta+ antes de decidir y que la IA aparezca en el hábito diario.

## Decisiones

- **Prueba inversa, calculada al leer el plan** (sin migración ni escritura). Una cuenta
  cuyo plan efectivo es `free` está en prueba mientras
  `now < max(createdAt, REVERSE_TRIAL_START) + 14 días`, con
  `REVERSE_TRIAL_START = 2026-11-25T00:00:00Z`: las cuentas free que ya existen también
  reciben sus 14 días. En prueba, `getUserPlan` devuelve `plan: "lecta_plus"` y
  `trialEndsAt`; los middlewares no cambian.
- **Sin gracia**: el día 15 vuelve a `free` (la gracia de 3 días es solo para pagos).
- **Sin prueba de Stripe**: el checkout ya no manda `trial_period_days`. Durante la
  prueba se puede suscribir (no responde 409). `trialEligible` desaparece de
  `/api/account/state`; entra `trialEndsAt` (número o null).
- **EPUB subidos a R2 durante la prueba se quedan** y responden 402 al terminar.
- **Cortesía de IA: 3 al día UTC** (antes 5 al mes). Mismo scope `free-courtesy` en
  `lecta_ai_quota`, bucket por día; las filas mensuales viejas dejan de leerse.

## Alternativas descartadas

- Escribir una fila `lecta_plus` con vencimiento al registrarse: hereda la gracia de
  3 días y se confunde con una suscripción de Stripe.
- Columna `trial_ends_at`: migración sobre una tabla con `schema_locked`.

## Superficies

- `src/shared/plan.ts`: constantes de prueba y cortesía, `reverseTrialEndsAt`, bucket diario.
- `src/worker/plan-store.ts`: `trialEndsAt` en el snapshot; lee `"user"."createdAt"`
  solo cuando el plan de la fila es `free`.
- `src/worker/account.ts`, `src/worker/billing.ts`.
- Cliente: `account-plan.ts`, `ReaderCard.tsx` (estado «Prueba de Lecta+ · quedan N
  días» con botón de suscribirse), `WordPanel.tsx` («hoy» en vez de «este mes»).
- Textos: `LegalNotice.tsx` y `marketing/landing/index.html`.
