---
trigger: always_on
description: Flujo de trabajo por fases de Lecta e invariantes de datos reales
---

# Lecta — flujo de trabajo

- Lecta se planifica por fases con estados. El plan vigente en
  `~/.devin/plans/plan-92a9faffd37ea978.md` es la fuente de verdad;
  consúltalo antes de implementar.
- SWE-2 Max implementa solo diseños cerrados. Las decisiones de producto,
  el contenido editorial y cualquier cambio sobre datos reales los decide
  Luis; no se improvisan.
- Al acabar cada fase se verifica (`pnpm typecheck`, `pnpm lint`,
  `pnpm test`, `pnpm build` según el alcance) y se reportan los bloqueos
  sin ocultarlos.
- Preservar TODOS los cambios locales, incluidos archivos sin seguimiento.
  Nunca usar checkout/reset para limpiar la base.

## Invariantes de datos

- Jamás reescribir ni borrar filas reales de usuario; los merges arbitran
  por `updatedAt` con lápidas.
- Las tarjetas FSRS son objetos serializados de `ts-fsrs`: no renombrar
  campos ni convertir estados.
- Los IDs del catálogo son `int8` > 2^53: viajan como string en JSON.
- IndexedDB por cuenta (`lecta` anónimo, `lecta:u:<id>`); las claves con
  versión (`preparation:v1:`, `bookStart:v1:`) solo cambian con migración
  explícita y compatibilidad hacia atrás.
- Verificar `getActiveUserId()` estable antes de empujar al servidor.

## Prohibido

- Leer `.env`, loguear secretos, tokens o enlaces de autenticación.
- Reactivar el caché de Hyperdrive ni crear pools `pg` globales.
- Migraciones fuera de `lecta_dev` sin autorización expresa.
- Push, deploy o reparaciones masivas de datos sin petición explícita.
