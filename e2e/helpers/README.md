# e2e/helpers — utilidades de Playwright

## Overview

Ayudas compartidas por las pruebas e2e para simular gestos táctiles sin
depender del soporte táctil del navegador de prueba.

## Interface

- [`touch.ts:touch(page, type, x, y)`]: despacha un `PointerEvent` de tipo
  `type` (`pointerdown`, `pointerup`, …) con `pointerType: "touch"`,
  `pointerId: 1`, sobre `document.elementFromPoint(x, y)` (o `body`).
- [`touch.ts:clickAt(page, x, y)`]: despacha un `MouseEvent("click")` en
  el mismo punto.
- Usado por `e2e/word-card.spec.ts` y `e2e/reader-quote.spec.ts`.

- [`session.ts:withTestSession(target, {plan?, starterCoat?})`]: simula
  `get-session`, `/api/account/state`, `/api/account/starter-coat` y las
  rutas de sync con respuestas vacías (plan `founder_lifetime` por defecto).
  Exporta `TEST_USER_ID` y `TEST_DB_NAME`.

## Invariants

- Los eventos son sintéticos: no crean selección nativa ni tiradores del
  sistema. Para probar tiradores nativos hace falta un dispositivo real
  (AGENTS.md: flujo por adb).
- `buttons` vale `0` solo en `pointerup`; en cualquier otro tipo vale `1`.

## Side Effects

- Ejecuta código en la página vía `page.evaluate`; no toca disco ni red.

## Verification

- Run: `pnpm test:e2e`
