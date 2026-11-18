# Menú compacto para la presión larga sobre una palabra (táctil)

Plan: Opus (arquitecto). Implementación: Sonnet. 2026-11-17.

## Problema
La presión larga sobre UNA palabra abre un menú de 9 objetivos (Significado, Tinta, 3 tonos, Reflexión, Postal, Preguntar, Copiar) en fila deslizable; no cabe en 390 px y los botones miden ~32 px.

## Objetivo
Con `selButton.word` (una palabra, solo táctil): 3 botones ≥44 px — «Significado» ancho y principal, «Tinta» (ámbar), «Copiar». Reflexión/Postal/Preguntar ya viven en la ficha (`wordPassageActions`). Con ≥2 palabras: barra completa actual sin cambios. Tiradores y `classifySelection` intactos.

## Decisión pendiente (Luis)
«Tinta» compacta llama a `savePassageSelection("amber")`, que subraya **solo la palabra**; la «Tinta» de la ficha (`Reader.tsx:3461-3468`, `sentenceRangeForHit`) subraya **la oración**.
- A (por defecto del plan): conservar, subraya la palabra.
- B: oración. Requiere prop nueva `onHighlightWord(hit)` en `Reader.tsx` que use `sentenceRangeForHit(hit, language) ?? range` + `savePassageRange`.

## Ya correcto, no tocar
- `selButton.word` solo se fija en táctil (`Reader.tsx:2455`, `2492`); con ratón nunca sale el compacto.
- Arrastrar un tirador → `selectionchange` → `word` pasa a `undefined` → barra completa sola.
- `menuHalfW = 170` (`Reader.tsx:2485`) sigue valiendo.

## Paso 1 — `src/client/components/reader/ReaderSelectionBar.tsx`
1. Comentario de cabecera (l.1-5): documentar el modo palabra.
2. Antes del `return` (l.193): `const wordMode = Boolean(selButton.word && onDefine);` y extraer `defineBtn` (l.204-221) y `copyBtn` (l.308-323) a constantes JSX sin cambiar su lógica.
3. Contenedor (l.197): clase `selection-menu reader__passage-bar` + `selection-menu--word` si `wordMode`; `role="toolbar"`; `aria-label` «Acciones de la palabra» / «Acciones del pasaje». Mantener `reader__passage-bar` (lo busca el e2e).
4. `wordMode`: `defineBtn` + botón `selection-menu-btn selection-save` (`title`/`aria-label` «Resaltar con tinta ámbar», `onPointerDown` preventDefault, `onClick` → `savePassageSelection("amber")`, icono `highlight` + «Tinta») + `copyBtn`. `!wordMode`: JSX actual intacto.

Verificable: typecheck limpio.

## Paso 2 — `src/client/styles/reader.css` (tras `.tone-dot--dario`, ~l.4052)
Solo tokens existentes (`--action-tint-bg`, `--action-tint-border`, `--vermilion`, `--ink`); sin hex.
- `.selection-menu--word .selection-menu-btn { min-height:44px; min-width:44px; justify-content:center; }`
- `.selection-menu--word button.selection-define { flex:1 1 auto; background:var(--action-tint-bg); box-shadow:inset 0 0 0 1px var(--action-tint-border); color:var(--vermilion); font-weight:600; }` — selector con `button` para ganar a `components.css:1020` (`.selection-menu button:not(.tone-dot)`, 0-2-1).
- En `@media (max-width:640px)` (~l.4055-4121): `.selection-menu--word { overflow-x:visible; justify-content:stretch; }`.
- Actualizar comentario l.4063: la fila deslizable solo aplica al modo pasaje.

Verificable: a 390 px `scrollWidth <= clientWidth`; cada botón ≥44 px de alto.

## Paso 3 — `src/client/components/reader/ReaderSelectionBar.test.ts`
`describe("Mini menú de una palabra (táctil)")`, `selButton = { x, y, placement:"bottom", word:{ word:"perenne" } as WordHit }`, sin `touch`, `onDefine: vi.fn()`.
1. Hay `.selection-menu--word`, exactamente 3 `button` (`.selection-define`, `.selection-save`, `.selection-copy`); 0 de `.tone-dot`, `.selection-deep`, `.selection-card`, `.selection-ask-cat`.
2. Click `.selection-save` → `savePassageSelection("amber")`.
3. Click `.selection-define` → `onDefine(hit)` + `setSelButton(null)`.
4. `word` sin `onDefine` → barra completa (`.tone-dot--salvia`, sin `--word`).
5. Pruebas de pasaje existentes (l.48-120) intactas; añadir en l.54 que no exista `.selection-menu--word`.

Verificable: `pnpm vitest run src/client/components/reader/ReaderSelectionBar.test.ts`.

## Paso 4 — `e2e/reader-quote.spec.ts` (l.104-122)
- Tras l.107: 3 botones, 0 `.selection-deep`, cada `boundingBox().height >= 44`, `scrollWidth <= clientWidth`.
- L.108-114 (deslizar la fila): mover tras l.122 (modo pasaje) para no perder ese guardia.
- Tras l.122: `.selection-deep` count 1 (vuelve la barra completa).
- `e2e/word-card.spec.ts:149-175` usa `.selection-define`: sin cambios.

Verificable: `pnpm exec playwright test e2e/reader-quote.spec.ts e2e/word-card.spec.ts --project=chromium`.

## Riesgos
- Especificidad CSS (paso 2): confirmar en captura que Significado no queda transparente.
- Tono fijo ámbar; salvia/Darío quedan en la ficha o al ampliar selección.
- Cierre de selección: Copiar/Significado ya limpian; `savePassageSelection` limpia vía `selectionchange` (`Reader.tsx:2496`). Sin cambios.
- Bundle: +pocos cientos de bytes sobre ~5.7 kB de margen; mirar `check:size`.
- `docs/auditoria/*diseno-2026-11-10*` mencionan clases del menú: históricos, no tocar.

## Verificación final
- `pnpm gate` (typecheck, lint 0 warnings, test, build, check:size) + `pnpm test:e2e:smoke`.
- Capturas 390×844 `papel` y `noche`: (a) presión larga → 3 botones sin scroll, Significado legible; (b) selección ampliada → barra completa como antes.
