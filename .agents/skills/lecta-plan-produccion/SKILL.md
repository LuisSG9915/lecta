---
name: lecta-plan-produccion
description: Ejecuta el plan de 8 fases de producción y endurecimiento de Lecta (docs/plan-8-fases.md), una fase a la vez, con puertas de verificación y sin tocar producción sin autorización expresa.
---

# Ejecutar el plan de 8 fases de Lecta

## Fuente de verdad

`docs/plan-8-fases.md` es el único documento que gobierna este trabajo. Léelo
completo antes de tocar nada. Si algo del repo lo contradice, gana el documento y
se reporta la contradicción; no se “adapta” el plan en silencio.

Precedencia explícita (para que no haya dudas):

1. `docs/plan-8-fases.md` — plan vigente de producción/endurecimiento.
2. `AGENTS.md` y `.agents/rules/lecta-zero-friction.md` — invariantes del proyecto.
3. Todo lo demás es histórico: `plan.md`, `plan2.md`, `ROADMAP-LECTA.md`, el plan
   citado en `.devin/rules/lecta-workflow.md`. **No los ejecutes ni los actualices.**
4. `/lecta-ux-overhaul` es otro plan (12 tracks de producto/UX). No lo mezcles con
   este. Si el usuario lo invoca, es una sesión distinta.

## Cómo se trabaja

- **Una fase por turno.** Antes de empezar, repite en dos líneas: fase, objetivo y
  criterios de aceptación que vas a verificar.
- **No encadenes fases** sin que el usuario lo pida. Al terminar una, entrega el
  reporte y detente.
- **Sin commit, sin push y sin deploy** salvo petición explícita. `plan2.md` y las
  reglas de Devin ya lo prohibían; se mantiene.
- Si un criterio de aceptación falla: se detiene, se explica y se propone el
  arreglo. Nunca se “arregla” una prueba bajando asserts, saltándola o relajando
  umbrales.

## Puerta de producción (Fase 1)

No ejecutes `pnpm db:migrate --prod`, `pnpm run deploy` ni nada que escriba en la
base `lecta` hasta que el usuario escriba, literalmente, una autorización como:

> Autorizo migrar `lecta` y desplegar a producción.

Sin esa frase: prepara los comandos, verifica el estado en solo lectura y pide la
autorización. Lo mismo para cualquier migración nueva fuera de `lecta_dev`.

`pnpm smoke:auth` **escribe** en el destino que se le indique: crea dos cuentas
reales, sube un EPUB falso a R2 y guarda vocab. Contra producción, una vez por
deploy relevante y anotando los dos correos creados; nunca en bucle ni en CI.

## Verificación obligatoria

Antes de cerrar cualquier fase:

```bash
pnpm gate   # typecheck → lint → test → build → check:size
```

Y además `pnpm test:e2e` en las fases que tocan UI o el lector (3, 5, 6 y 7).
Reporta la salida real (números, no “todo bien”): archivos de test, pruebas,
duración y resultado de `check:size`.

Un criterio de aceptación solo cuenta si se demuestra con un comando y su salida.
Si no se puede demostrar así, el criterio está mal escrito: dilo antes de
implementar, no después de fallar.

### Suelo del gate

- `pnpm lint` está **exactamente** en 28 de 28 warnings: cualquier warning nuevo
  rompe el gate. Arregla el tuyo, no subas `--max-warnings`.
- `check:size` está en 176.08 de 215 kB: hay margen, pero cada import estático nuevo se mide.
- `pnpm test:e2e` reconstruye `dist/`: no lo corras en paralelo con otro `build`.

## Reglas de código que no se negocian

- El presupuesto de 215 kB gzip no se sube. Los paneles y modales nuevos entran con
  `React.lazy` + `Suspense` desde el primer commit.
- No reactivar el cache de Hyperdrive `lecta-db` ni crear pools `pg` globales.
- No leer `.env` ni registrar secretos, tokens o enlaces de autenticación.
- Preservar los cambios locales y los archivos sin seguimiento: nada de
  `git checkout`, `reset` o `clean` para “limpiar”.
- Migraciones nuevas solo a `lecta_dev` (salvo la Fase 1 autorizada). Si una
  migración queda pendiente en producción, se anota en `AGENTS.md` en el mismo
  commit; no se abre una segunda ventana por un índice.
- **Ninguna prueba ni script escribe en las tablas `lexicon_*` de `lecta_dev`**: el
  catálogo está calificado desde el worker y es el que lee producción.

## Anti-patrones del plan anterior (no repetirlos)

- No añadir `react-hooks` de MCP al typecheck: ya está encadenado en `pnpm typecheck`.
- No poner `React.lazy` en `Shelf.tsx`: ahí no hay modales pesados.
- No crear un helper de `readFileSync` en `Reader.test.ts`: lee `reader.css`, no `.tsx`.
- No arreglar solo `vocab.ts`: el cursor con `Date.now()` está en seis carriles.
- No dar por buena la validación de `MODEL_SHA256` sin definir la variable.
- No confiar en `public/_headers` para `/models`: esa ruta la sirve el worker.
- No tratar `pnpm smoke:auth` como si fuera de solo lectura.

## Formato del reporte al cerrar una fase

```
Fase N — <nombre>
Hecho: <bullets cortos con archivos>
Comandos: <comando → resultado real>
Criterios: - [x] ... / - [ ] ... (con el motivo del que falle)
Fuera de alcance / pendientes: <si hay>
Siguiente paso propuesto: <fase o decisión que necesita el usuario>
```

## Arranque típico

- “Ejecuta la Fase 0 del plan”: solo decisiones y verificación en solo lectura.
- “Ejecuta la Fase 1”: primero pide la autorización de producción.
- “Prepara la Fase N y enséñame el diff sin aplicar”: cuando el usuario quiera
  revisar antes.
