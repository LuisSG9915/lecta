# Plan de simplificación del Cuaderno (Fases 1–5) — COMPLETADO

Decisión: Opción C — simplificación completa, ejecutada por fases con puerta
`pnpm gate` entre cada una.

## Verificación final
- `pnpm gate` verde: typecheck + lint 0 warnings + 236 archivos / 3.327 pruebas + build + `check:size` 199,31/215 kB.
- `audit-cuaderno` con 0 regresiones.

## Fases
- Fase 1 — Superficie: modos libres y racha colapsados en `<details>`; jerga reducida.
- Fase 2 — Gamificación ambiental: XP/Combo fuera del flujo principal.
- Fase 3 — Sesión única: cierre "Terminado por hoy." con próxima fecha y racha.
- Fase 4 — Contexto primero: ya existía (`PracticeContext` antes de revelar).
- Fase 5 — Medir y cerrar: puerta verde; medición longitudinal delegada al historial existente.

## Regla respetada
No se tocó el motor (FSRS-6, Rasch, ZPD, preparación, `isLearnPending`, `reviewQueue`).
Los modos avanzados se movieron, no se borraron.