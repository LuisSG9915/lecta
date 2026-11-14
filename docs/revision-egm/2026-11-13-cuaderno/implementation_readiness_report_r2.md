Status: resolved (J1–J12 y Nits aplicados; sin ronda 3 por tope)

# Etapa 9: preparación para implementar, ronda 2 (re-auditoría)

**Objetivo:** `docs/designs/2026-11-13-cuaderno-repaso.md`, líneas 497–676.

| Revisor | Estado | Blocker | Major | Nit |
| --- | --- | --- | --- | --- |
| `egm-implementation-readiness` | completado | 0 | 7 | 10 |
| `egm-codebase-details` | completado | 1 | 11 | 9 |
| `egm-style` | completado | 0 | 2 | 10 |

**Resultado:** la ronda no queda limpia, aunque mejora frente a la ronda 1. Quedan 1 Blocker y 13 Major distintos.

La etapa 9 ya usó su única re-auditoría. Por eso los arreglos se aplican sin una ronda 3 y la revisión se cierra.

Los tres revisores confirman que las referencias de línea, los tokens, los presupuestos y la partición en pasos son correctos.

## 🔴 Blocker

### J1. El arnés simula `getWords` y `putWord`, que no existen en `idb`
`cd-B1`, `ir-M1`

El hook usa `captureDbScope` y `updateSavedWord`. Con el mock tal como está, `grade` cae siempre en el `catch`.

**Arreglo:**
- Copiar los mocks de `Vocabulary.test.ts:31-65` y `:86-89`: `idb` con `importOriginal`, `lexicon`, `reviews` y `vocab`.
- Quitar el mock de `fsrs`.
- Añadir un ayudante `renderReview(items)` que monte el hook con los argumentos mínimos.

## 🟡 Major

### J2. La prueba de foco no funciona en una prueba de hook
`cd-M1`, `ir-M2`

En una prueba de hook las refs son `null`.

**Arreglo:** mover la prueba a `Vocabulary.test.ts`.

### J3. Faltan pasos en la tabla de archivos
`ir-M3`, `cd-M8`, `cd-M9`, `cd-M10`

**Arreglo:**
- Fila de `Vocabulary.test.ts`: pasos 3, 4, 5 y 6. Su mock usa `hintUsed` y `onCatTap`.
- `PracticeCompanionHeader.test.ts:196-200`: esperar `onCatTap`.
- Añadir `ReviewDone.tsx` y `GamePanel.tsx` (ver J9).

### J4. El gato se queda en `celebrate` en los minijuegos
`ir-M4`, `ir-M5`, `cd-N9`

**Arreglo:** una tabla modo × resultado con la pose, la frase y el mecanismo de cada caso. El cambio de `currentKey` reinicia el gato en todos los modos.

### J5. No está claro cómo conviven `catPose` y `resultPose`
`ir-M6`

**Arreglo:** definir firmas y efectos.
- `setResultPose`.
- `resetCat()`, que cancela el temporizador, pone `resultPose` a `idle` y `catPose` a `idle`.
- El efecto sobre `[currentKey]` vive en `useReviewSession`.

### J6. El límite de pista y `hintUsed`
`ir-M7`, `cd-M3`, `cd-M4`, `cd-M2`

**Arreglo:**
- La salida temprana va dentro de `askCatHint` con `hintsUsedRef.current > 0`, y se añade la condición `current.mode !== "write"`.
- El estado `hintUsed`, con `useState`, se pone a `true` en `askCatHint` y se reinicia junto con `hintsUsedRef`.
- `catTap` excluye `write`.

### J7. El fondo de la opción respondida no es el que comprueba la prueba
`cd-M5`

**Arreglo:** pintar el fondo en capas, `linear-gradient(var(--success-wash), var(--success-wash)), var(--paper-raised)`, para que coincida con lo que compone la prueba.

### J8. Fondo de `.nb-continue`
`cd-M6`

**Arreglo:** `background: var(--grain), var(--surface-herbarium)` en las dos presentaciones, igual que `.notebook`.

### J9. Otros consumidores de `PracticeCompanionHeader`
`cd-M10`

**Arreglo:**
- `data-reacting` solo se activa si existe `onCatTap`.
- `role="status"` se mantiene cuando no hay `onCatTap` (`ReviewDone`, `GamePanel`).
- `line-clamp` solo se aplica con `onCatTap`.

### J10. `line-clamp` sin el patrón del repo
`cd-M11`

**Arreglo:** usar el bloque `-webkit-box` de `notebook.css:1454-1459`.

### J11. Patrones literales de la auditoría
`cd-M7`, `ir-N2`

**Arreglo:**
- C4: `className="nb-answer-foot" role="status"`.
- C15: `onClick=\{\(\) => void review\.exitSession\(\)\}`.
- Se escriben en una sola línea de JSX.

### J12. Frases ambiguas en el plan
`st-M1`, `st-M2`, `ir-N4`, `cd-N6`

**Arreglo:**
- Contrato de `exitSession`:
  - si `grade` devuelve `true`, suma 1;
  - sin pendiente, `extra = 0`;
  - mapeos `EXERCISE_RATING` / `Rating`;
  - `finishMatchTanda` corta si `grade` devuelve `false`.
- Criterio del paso 0: si un bloque supera su presupuesto en más de 8 px y ninguna regla de D3 lo reduce, se actualiza la tabla y se anota en `medidas.md`.

## 🟢 Nit (se aplican)

- `ir-N1`, `cd-N8`: iconos móviles por CSS (`.visually-hidden` en la etiqueta bajo 64rem). Se actualiza `aria-label` y el test `:148`.
- `ir-N3`: selector de la barra fija: `.notebook--page[data-session] .notebook-bar`, en `notebook.css`.
- `ir-N5`: el botón de salir se deshabilita mientras haya una tanda de Parejas calificándose.
- `ir-N6`: `--ink` en el texto de `.is-correct` y `.is-wrong`.
- `ir-N7`, `cd-N5`: `transition: transform var(--dur-2) var(--ease-out)`.
- `ir-N9`: frase literal `` `Era «${form}». La próxima la tienes.` ``.
- `ir-N10`: el ronroneo y la vibración se quedan en la cabecera. `pet()` no los repite.
- `cd-N1`: rangos `:702-707`.
- `cd-N2`: `contrastRatio :55-59`, `relativeLuminance :51-53`, `parseColor`, `extractThemeBlocks`.
- `cd-N3`: `:359` es el título del `it`.
- `cd-N4`: la pantalla final de Aprender está en `:65`.
- `cd-N7`: `senseLikeOptions[senseLikeAnswer]` e importar `conciseMeaning`.
- `st-N3` a `st-N12`: redacción.
