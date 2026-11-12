# e2e — pruebas de extremo a extremo (Playwright)

## Overview

Pruebas Playwright contra el build servido por `vite preview` en
`http://localhost:5188` (`playwright.config.ts`: `testDir: "./e2e"`,
`workers: 1`, `timeout: 45_000`). En local el `webServer` compila antes
(`pnpm run build && pnpm exec vite preview --port 5188`); en CI sirve el
`dist/` descargado. Los bindings de Hyperdrive apuntan a una cadena falsa
(`postgresql://mock:mock@localhost:5432/mock`).

## Subdirectories & Boundaries

- helpers: [./helpers/README.md](./helpers/README.md) — `withTestSession` (sesión simulada, la cuenta es obligatoria), `touch` y
  `clickAt`, gestos táctiles sintéticos.

## Specs

- `smoke-journeys.spec.ts` — recorridos críticos con tag `@smoke`.
- `reader-position.spec.ts` — guardia de la posición del lector (usa
  `fixtures/scroll.epub` de `scripts/make-scroll-fixture.mjs`).
- `community.spec.ts`
- `critical-journeys.spec.ts`
- `paper-reading.spec.ts`
- `reader-quote.spec.ts`
- `word-card.spec.ts`
- `welcome.spec.ts` — sin sesión, `?gato=calico` llega a la bienvenida.

Toda spec que abre la app registra `withTestSession(context)` en un
`test.beforeEach` y lee IndexedDB en `lecta:u:u_e2e_test` (`TEST_DB_NAME`).

## Invariants

- Proyecto `chromium` corre todo; `webkit-iphone` corre solo `@smoke` en CI
  y `[webkit]|@smoke` en local (`playwright.config.ts:projects`).
- En `smoke-journeys.spec.ts` llevan `@smoke` los Journeys 1, 2 y 4 y la
  prueba de layout Kindle; el Journey 3 (sincronización entre contextos)
  no lo lleva, así que WebKit no lo corre.

## Side Effects

- Lanza `vite preview` (y un build en local) y navegadores Playwright.

## Verification

- Run: `pnpm test:e2e`
- Run: `pnpm test:e2e:smoke`
