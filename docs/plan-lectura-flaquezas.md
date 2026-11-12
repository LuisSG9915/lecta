# Plan: flaquezas del apartado de lectura (2026-11-11)

Origen: reporte de Luis tras leer en móvil. Tres fallos concretos y un barrido de
fallos de la misma familia. Las fases 1–3 cierran con `pnpm gate` verde y son un
commit aislado cada una. La fase 4 es de inventario, sin código.

## Contexto y causa raíz verificada

### F1. «sin embargo» aparece subrayado

- `applySyntacticLines` (`src/client/lib/syntactic-lines.ts`) envuelve cada
  coincidencia de `COMPLEX_CONNECTORS` («sin embargo», «no obstante», «por lo
  tanto»…) en `<span data-connector="true">`, **solo** dentro de la rama
  `enableSyntactic` (`options.syntacticLines`). Chromatic, anclas biónicas o
  pacer por sí solos no crean el span.
- `reader.css:2317-2320` (`.book-content [data-connector="true"]`, la única
  regla con `data-connector`) le pinta `underline dotted`. Se parece a las
  marcas de palabras consultables (`mark.predicted-word`;
  `mark.lecta-unknown-word` en temas oscuros), pero el conector **no responde**
  a nada.
- `syntacticLines` vale `false` por defecto (`settings.ts`). Lo encienden sin que
  el lector piense en «líneas sintácticas»: los presets `guided`, `focus` y
  `lexical` (`settings.ts:552,630,641`) y la migración de ajustes viejos con
  `focusMode` `"syntactic"` o `"chromatic"` (`settings.ts:739-742`). También
  aceptar la sugerencia de fatiga (`handleAcceptFocusAid`, `Reader.tsx`), que
  exige un toque explícito. De ahí el «hay veces».
- Resultado: un subrayado que promete «esta palabra es difícil» en una locución
  conocida. Viola la regla 1 de Zero-Friction (inteligencia invisible).

### F2. El cloze de fin de capítulo no exige pensar

Dos causas independientes:

1. **El enunciado imprime la respuesta.** `SentenceBuilderGame.tsx:458` muestra
   «Completa el espacio para «**{targetWord}**»». Basta tocar la opción igual a
   la palabra en negrita.
2. **Los distractores son no-palabras.** `DeepReadingSummaryModal.tsx`
   (repaso al cerrar capítulo) y `MidChapterRecallCard.tsx` montan
   `SentenceBuilderGame` en modo cloze **sin `options`**. Sin `options`, el
   juego llama `generateClozeOptions(targetWord, { lang, count: 3 })`
   (importado de `lib/game.ts`, que reexporta `practice.ts`): objetivo + 2
   distractores de `generateMorphologicalDistractors`, variantes por sufijo de
   la **misma palabra**. «inteligibles» no casa con ninguna regla española, cae
   a la contingencia `["s", "es", …]` y produce «inteligibless» e
   «inteligibleses». Aun cuando las reglas casan, el ejercicio mide
   concordancia, no significado.

Lo que ya existe y se reutiliza:

- `pickDistractors(target, pool, count)` (`practice.ts`): devuelve `SavedWord[]`
  de otras palabras del cuaderno, misma `pos` primero, orden por hash FNV de
  (objetivo, candidata) para que cada palabra reciba distractores distintos.
  **No filtra idioma.**
- El modo «Elegir palabra» del Cuaderno (`useReviewSession.ts:791-806`) lo usa
  así: pool filtrado por idioma + `shuffleStable(..., seedFor(key))`. Es el
  patrón a copiar. `seedFor` vive en `notebook-model.ts:119`.
- `matchCase` (privada en `practice.ts:834`) ya iguala mayúscula inicial.
- `listSavedWords(language, scope)` (`idb.ts`) ya filtra por idioma.
- `pickLevelDistractors` no se reutiliza aquí (ordena por `key`: todas las
  palabras reciben los mismos primeros candidatos, el bug que `pickDistractors`
  corrigió; su «nivel» es el estado FSRS). Sigue en uso en
  `buildAdaptivePracticeQueue` y `rescueChallenge`; entra al inventario de la
  Fase 4.

Cómo se arma hoy la cola post-capítulo: `completeChapterTo` vive en el hook
`useReaderPagination` (`useReaderNavigation.ts:203-271`, opciones
`UseReaderPaginationOptions`, `:81-114`; se llama en `Reader.tsx:2986`). Es
**síncrono**, no carga palabras guardadas y llama
`buildPostChapterConsolidationQueue(candidates, prefs, isL2, { bookId })`.
Las modalidades son `"sentence-cloze"`, `"word-scramble"` y `"grammar-nuance"`;
el modal pinta cloze para todo lo que no sea `"word-scramble"`.
`MidChapterRecallCard` recibe su ítem de `pickMidChapterRecall(words, …)`
(`Reader.tsx:1050`), que ya carga todas las palabras.

Dónde carga hoy Reader las palabras guardadas: al abrir el libro
(`Reader.tsx:2263`, `listSavedWords(bookLanguage, scope)`) y en el efecto de
`Reader.tsx:~2499`, que depende solo de `[vocabVersion]` (sube tras sync,
calibración o `onVocabChange` del Cuaderno abierto sobre el lector, no al
guardar desde el lector) y no corre al abrir. Los guardados y borrados del
lector pasan por `onWordSaved` (`Reader.tsx:3080`) y `onWordRemoved` (`:3150`),
salvo `onSaveToPractice` (`:4457-4479`), que guarda sin llamar `onWordSaved`.

Lemas reales de los ítems episódicos: todos los productores rellenan `lemma`,
a menudo con la forma superficial (`useReaderSelection.ts:123`
`hitEntry?.lemma || hit.word.toLowerCase()`, `mid-chapter-recall.ts:35`,
`useReaderChapterPrep.ts:700`). `normalizeWordForm` casi no cambia palabras en
español (solo `-mente`). `recordModalityAttempt` no tiene llamador en
producción: los pesos adaptativos no se registran hoy.

### F3. No se puede subrayar una cita en móvil

- En táctil, la presión sostenida (`LONG_PRESS_MS = 480`,
  `ReaderContent.tsx`) abre la ficha y llama `removeAllRanges()`.
- La selección nativa del SO (que también nace de la presión larga) selecciona
  una palabra; el listener de `selectionchange` (`Reader.tsx`, debounce 200 ms)
  ve `words.length === 1` (o `0` con `singleWordHit`), borra la selección y abre
  `WordPanel`. Hoy ese listener es además el único camino para cambiar de
  palabra con la ficha abierta (el temporizador sale en `if (selection) return`).
- Otros manejadores de `ReaderContent.tsx` también matan la selección: el toque
  con selección activa la limpia (`:361-363`); con la ficha abierta, cualquier
  toque tras 400 ms la cierra (`:348-357`); `onContextMenu` hace
  `preventDefault` en táctil (`:478-485`), lo que en Chromium Android puede
  suprimir los tiradores nativos (por verificar en dispositivo). En Android,
  iniciar la selección nativa puede disparar `pointercancel`, que cancela el
  temporizador de presión.
- Los tiradores desaparecen antes de poder arrastrarlos: la rama
  `words.length >= 2` que monta `ReaderSelectionBar` (Tinta, Reflexión, Postal,
  Preguntar) es **inalcanzable en móvil**. Si la ficha está abierta,
  `overlayReleaseRef` suspende además la barra; ese ref lo comparten la ficha
  (`useReaderSelection.ts`), las hojas de preparación de capítulo y `openSheet`,
  así que hoy no se puede saber cuál overlay está abierto.
- La ficha ya trae acciones de pasaje (`passageActions`: Tinta, Reflexión,
  Postal, Preguntar, `WordPanel.tsx`; cableadas en `wordPassageActions`,
  `Reader.tsx:3981-4007`), pero «Tinta» guarda `selection.range`, que cubre
  **solo la palabra** tocada; y solo se ven en `disclosureLevel === 3` (requiere
  IA, `effectiveContext` y «¿Qué significa aquí?» + «Ver más»).
- Lo que llega a `QuotesPanel` (`components/notebook/QuotesPanel.tsx`) son
  anotaciones `kind === "passage"`, creadas por «Tinta» (`savePassageRange` →
  `saveAnnotation`). No hay botón «Cita».
- En escritorio (arrastre con ratón) la barra sí aparece.
- La decisión del Track 4 («una palabra = ficha directa, sin píldora») se
  mantiene; lo que cambia es que esa decisión no puede cerrar el camino a
  seleccionar más de una palabra.

## Fases

### Fase 1 — Conectores sin subrayado (F1)

Archivos: `src/client/styles/reader.css`, `src/client/styles/tokens.test.ts`.

Cambio:
1. Borrar la regla entera `reader.css:2317-2320`. El span se conserva: lo usan
   `applyBionicToElement` para saltarlo (`syntactic-lines.ts:227`) y
   `clearSyntacticLines` para desenrollarlo (`:163`).
2. No tocar `COMPLEX_CONNECTORS`, la segmentación ni `data-sub`.
3. Aceptado: con anclas biónicas activas el conector sigue sin ancla biónica
   (efecto del salto en `:227`); no es una marca visual que prometa acción.

Criterio verificable:
- Prueba en `tokens.test.ts`, reutilizando su bucle sobre todas las hojas
  (`:243`), que falla si alguna regla con `data-connector` declara
  `text-decoration` en cualquier CSS.
- Captura a 390 px en `papel` y `noche` con el preset `focus`: «sin embargo» sin
  raya.

### Fase 2 — Un cloze que obliga a leer (F2)

Archivos:
- `src/client/lib/practice.ts`, `practice.test.ts`
- `src/client/lib/game.test.ts`
- `src/client/lib/episodic-cloze.ts` (nuevo) + `episodic-cloze.test.ts`
- `src/client/lib/mid-chapter-recall.ts`, `mid-chapter-recall.test.ts`
- `src/client/hooks/useReaderNavigation.ts`, `useReaderNavigation.test.ts`
- `src/client/components/Reader.tsx`
- `src/client/components/SentenceBuilderGame.tsx`, `SentenceBuilderGame.test.ts`
- `src/client/components/DeepReadingSummaryModal.tsx`, `DeepReadingSummaryModal.test.ts`
- `src/client/components/reader/MidChapterRecallCard.tsx`, `MidChapterRecallCard.test.ts`

Reglas: **ni el enunciado ni la pista muestran el objetivo** y **los
distractores son otras palabras reales del cuaderno**, nunca variantes
inventadas.

Cambio:
1. Enunciado: `SentenceBuilderGame.tsx:458` pasa a «Completa la frase del
   capítulo:». El bloque de glosa `.sentence-cloze-gloss` (`:477-487`) se queda
   como pista, salvo que la glosa contenga el objetivo como **palabra completa**
   (cualquiera de sus claves de lema, ver paso 3, sobre la glosa normalizada con
   `normalizeSearchText`): entonces se ocultan el bloque y su `title`
   (`SentenceBuilderGame.tsx:480`). «sol» no oculta una glosa con «solitario».
2. `generateMorphologicalDistractors` se conserva (la llama
   `generateClozeOptions`) pero pierde las tablas de reglas es/en y la
   contingencia por sufijos/cambio de letra. Queda devolviendo solo los
   `candidates` que pasan el filtro actual (≠ objetivo sin distinguir
   mayúsculas, longitud ±4). Sin candidatos devuelve `[]`, y
   `generateClozeOptions` solo el objetivo. La reexportación en `game.ts` se
   queda (la importa `SentenceBuilderGame`). Se exporta `matchCase`.
3. `seedFor` se mueve de `notebook-model.ts:119` a `practice.ts`, junto a
   `shuffleStable`, y `notebook-model.ts` lo reexporta (sus importadores no
   cambian). Archivo nuevo `src/client/lib/episodic-cloze.ts`. Importa
   `practice.ts`, `search-text.ts` y `shared/word-form.ts`; **solo lo importan
   hooks y `mid-chapter-recall.ts`**, nunca `practice.ts`, así que no hay
   ciclo. Exporta:
   `episodicClozeOptions(item: EpisodicWordItem, pool: SavedWord[]): string[] | null`
   y `attachClozeOptions(queue, pool)` (paso 4).
   - Objetivo sintético `SavedWord`: `key = \`${lang}:${form.toLowerCase()}\``
     (inline, mismo formato que `wordKey`, sin importar `idb.ts`),
     `form = item.surfaceForm || item.lemma`, `pos = item.partOfSpeech`,
     `language = item.lang`, `savedAt = 0`.
   - Pool: palabras con `(w.language || "es").slice(0, 2).toLowerCase()` igual
     al del ítem (misma regla que `mid-chapter-recall.ts`). Exclusión de la
     misma palabra, igual en ambos lados y con el idioma de cada uno:
     claves `{ n(lemma), n(normalizeWordForm(lemma, lang)), n(normalizeWordForm(form, lang)) }`
     con `n = normalizeSearchText` (sin valores vacíos). Se excluye la candidata
     si comparte alguna clave con el objetivo **o** si alguna clave de cada lado
     comparte un prefijo de ≥5 letras (atrapa flexiones del español sin lema de
     catálogo: «susurró» / «susurraba»). Perder a veces un distractor legítimo
     («presentar» / «presencia») es aceptado.
   - Se excluyen candidatas cuya forma guardada empieza en mayúscula (nombres
     propios) salvo que el objetivo también empiece en mayúscula; así `matchCase`
     nunca convierte «Madrid» en «madrid».
   - `pickDistractors(objetivo, pool, 3)`, mapeado a `.form` y cada uno con
     `matchCase(form del objetivo, distractor)` para que la mayúscula no delate.
     `partOfSpeech` suele faltar en consultas del capítulo: se cae al grupo
     «otros» (aceptado).
   - ≥2 distractores →
     `shuffleStable([objetivo, ...distractores], seedFor(item.lemma || item.surfaceForm))`
     (4 opciones con 3 distractores, 3 con 2). <2 → `null`. La semilla usa el
     lema y no `word.key` como el Cuaderno: el ítem episódico no tiene `key`
     guardada (desviación aceptada).
   - `EpisodicWordItem` gana `options?: string[]`.
4. Fuente del pool post-capítulo, sin volver async el cierre y sin tocar
   `buildPostChapterConsolidationQueue`:
   - `Reader.tsx` gana `savedWordsRef: Ref<SavedWord[]>` (vacío por defecto) y
     un helper `rememberSavedWords(words)` que lo escribe. Se llama en la carga
     al abrir (`Reader.tsx:2263`) y en el efecto de `Reader.tsx:~2499`. Los
     guardados y borrados del lector actualizan el ref en memoria, sin releer
     IndexedDB: upsert por `key` en `onWordSaved` (`:3080`) y en
     `onSaveToPractice` (`:4457-4479`), y borrado por `key` en `onWordRemoved`
     (`:3150`).
   - `UseReaderPaginationOptions` gana `savedWordsRef?: Ref<SavedWord[]>`
     (opcional: las pruebas que construyen opciones siguen tipando). Reader lo
     pasa en `Reader.tsx:2986`.
   - En `completeChapterTo`, justo después de construir la cola
     (`useReaderNavigation.ts:247`, hoy `const queue`), una constante nueva:
     `const withOptions = attachClozeOptions(queue, savedWordsRef?.current ?? [])`,
     usada en lugar de `queue` desde ahí.
   - `attachClozeOptions(queue: Array<{ item: EpisodicWordItem; modality: ConsolidationModality }>, pool: SavedWord[])`
     devuelve el mismo tipo con **copias nuevas** de cada entrada e ítem (los
     ítems originales se comparten con `currentChapterLookups` y
     `currentChapterPrimedWordsRef`; no se mutan). Cada copia lleva
     `options = episodicClozeOptions(item, pool) ?? undefined`. Si no hay
     opciones y la modalidad no es `"word-scramble"` (`"sentence-cloze"` o
     `"grammar-nuance"`): pasa a `"word-scramble"` si la palabra
     (`surfaceForm || lemma`) mide ≤10 letras (la regla de `practice.ts:628`, el
     juego corre con 10 s); si es más larga, la entrada sale de la cola.
   - Sacar entradas después del recorte a `maxExercisesPerChapter` puede dejar
     la cola más corta aunque queden candidatos sin usar: aceptado.
   - Carga fallida o ref vacía → pool vacío → scramble o entrada fuera, nunca
     un cloze sin opciones.
   - `buildPostChapterConsolidationQueue` y `Reader.test.ts:799,1317` no
     cambian.
5. Mitad de capítulo: `pickMidChapterRecall(words, …)` calcula
   `episodicClozeOptions(item, words)`; si da `null`, hace `continue` al
   siguiente vencido; si ninguno sirve, no devuelve ítem.
6. Render:
   - `DeepReadingSummaryModal` pinta `WordScrambleGame` cuando la modalidad es
     `"word-scramble"` **o** `item.options` tiene <2 entradas; si no, pasa
     `options={item.options}` a `SentenceBuilderGame`.
   - `MidChapterRecallCard` pasa `options={item.options}`.
   - Guarda defensiva en `SentenceBuilderGame`: en cloze con <2 opciones no
     pinta botones de opción ni el botón de pista (`handleClozeHint`) y apaga
     los atajos de teclado del cloze (`:280-297`); muestra la frase completa y
     «Saltar», que llama una prop nueva opcional `onSkip` (**nunca** `onSolve`:
     `onSolve` acaba en `consolidateEpisodicWord` con calificación Good, en
     `Reader.tsx:1060-1063` y `DeepReadingSummaryModal.tsx:138`). Sin `onSkip`
     no pinta botón. `MidChapterRecallCard` pasa su `onSkip`.
7. Concordancia: los distractores van en su forma guardada, sin flexionar. A
   veces la concordancia delatará la respuesta; es mejor que una no-palabra.

Pruebas que cambian:
- Se borran (fijan variantes por sufijo): `practice.test.ts:769-775` («camin»),
  `:777-782` («wandering»), `:784-789` («Susurró»), `:803-808` («perenne», 3
  opciones sin candidatos).
- `practice.test.ts:791-801` (objetivo «quimera», candidatos con «quimérico» y
  «camino», aserción `toContain("camino")`) se conserva sin cambios.
- `game.test.ts:418-427`: se reescribe; la aserción `:420-422`
  (`generateMorphologicalDistractors("susurró")` → 2) se borra, y
  `generateClozeOptions("whisper", …)` sin candidatos devuelve 1 opción.
- `mid-chapter-recall.test.ts:48-52` y `:69-78`: el pool de prueba suma palabras
  del idioma **no vencidas** hasta tener ≥3 candidatas por objetivo, para que
  siga habiendo ítem y «prefiere la que venció antes» siga midiendo lo mismo.
- `SentenceBuilderGame.test.ts:173-194` y `:283-307`: pasan `options`
  explícitas en vez de depender de la generación automática. Casos nuevos:
  (a) guarda con 1 opción → sin botones de opción ni pista, la tecla `1` no
  hace nada, «Saltar» llama `onSkip` y no `onSolve`; (b) glosa que contiene el
  objetivo como palabra completa → bloque y `title` ocultos; glosa con «sol»
  dentro de «solitario» → visible.
- `DeepReadingSummaryModal.test.ts:288-356` y `:548-610`: el ítem
  `"sentence-cloze"` lleva `options` (incluida «quimera»); caso nuevo: ítem sin
  opciones → se pinta `WordScrambleGame`.
- `MidChapterRecallCard.test.ts`: el ítem lleva `options`.
- `useReaderNavigation.test.ts:321-338` y `:340-361`: hoy simulan la cola con
  `{ item: { lemma: "casa" }, modality: "recognition" }`; pasan a un
  `EpisodicWordItem` completo (`surfaceForm` corta) con modalidad
  `"word-scramble"`, para que `attachClozeOptions` (no simulado) no saque la
  entrada y la consolidación siga abriéndose en vez de navegar.
- `useReaderNavigation.test.ts`, bloque `describe("useReaderPagination")`
  (`:194+`), casos nuevos: con `savedWordsRef` vacío la cola sale sin cloze;
  con `savedWordsRef` lleno (como queda tras abrir el libro, sin sync) los
  ítems cloze traen `options`.

Criterio verificable:
- `generateClozeOptions("inteligibles", { lang: "es" })` sin candidatos
  devuelve `["inteligibles"]`.
- `episodicClozeOptions` con pool de 5 palabras del idioma: objetivo + 3 del
  pool, mismo orden en dos llamadas, objetivo no siempre en la posición 0
  entre varios lemas, dos lemas distintos no reciben los mismos 3, y con objetivo
  «Susurró» todos los distractores empiezan en mayúscula.
- Pool de otro idioma, de 1 palabra o con solo formas del mismo lema → `null`;
  casos con el lema igual a la forma, como en producción: ítem «susurró»
  (`lemma: "susurró"`) frente a un «susurraba» guardado; EN ítem «whispered»
  (`lemma: "whispered"`) frente a un «whispering» guardado sin lema. Un
  candidato «Madrid» no aparece para un objetivo en minúscula.
  `attachClozeOptions` asigna `"word-scramble"` (también si la modalidad era
  `"grammar-nuance"`), saca la entrada si mide >10 letras y no muta los ítems de
  entrada; `pickMidChapterRecall` salta al siguiente vencido.
- Verificación manual: abrir un libro en dev, no sincronizar, guardar ≥3
  palabras y cerrar capítulo → el repaso trae cloze con opciones reales (el ref
  se llenó en `Reader.tsx:2263` y con `onWordSaved`).
- Render del cloze: ni el enunciado ni la glosa visible contienen `targetWord`.

### Fase 3 — Subrayar una cita en móvil (F3)

Archivos:
- `src/client/lib/tap-intent-guard.ts` (+ prueba)
- `src/client/lib/words.ts` (+ prueba)
- `src/client/components/Reader.tsx`
- `src/client/components/reader/ReaderContent.tsx`
- `e2e/helpers/touch.ts` (nuevo, extraído de `e2e/word-card.spec.ts:149-183`;
  exporta `touch(page, type, x, y)` y `clickAt(page, x, y)`)
- `e2e/word-card.spec.ts` (usa el helper extraído)
- `e2e/reader-quote.spec.ts` (nuevo)

Principio: **la presión sobre una palabra sigue abriendo la ficha**, pero la
selección nativa queda viva para extenderla.

Cambio:
0. Antes de tocar código: correr `e2e/word-card.spec.ts` y anotar aquí el
   estado del caso C5 (`:51-67`, espera acciones de pasaje visibles al tocar,
   que hoy solo salen en el nivel 3). Si ya está rojo, se marca `test.fixme`
   con un comentario que apunta a la decisión pendiente del paso 9, y así sale
   de la puerta de cierre.
1. `isTouchInput(pointerType)` en `tap-intent-guard.ts` = touch|pen o
   `matchMedia("(pointer: coarse)")`. Sustituye solo los dos sitios idénticos
   (`Reader.tsx:2609-2612`, `ReaderContent.tsx:320-323`). No se tocan
   `Reader.tsx:2668-2670` (detección de dispositivo, sin tipo de puntero),
   `ReaderContent.tsx:482` (solo touch) ni `tap-intent-guard.ts:52`: tienen
   otra semántica.
2. `selectionRef` en Reader como espejo único:
   `useEffect(() => { selectionRef.current = selection })` (patrón de
   `optionsRef`, `useReaderSelection.ts:54-57`). Cubre los 7 sitios que llaman
   `setSelection`, incluido atrás del historial, `openSheet`,
   `closeOtherOverlays`, `readerInitialWord` y el cargador de sección.
3. Función pura `classifySelection({ words, hasHit, cardWord, sheetOpen, sameWord })`
   en `tap-intent-guard.ts`. `words` = número de palabras con el mismo split por
   espacios del listener actual; `hasHit` = hay `singleWordHit`; `cardWord` = palabra
   de `selectionRef.current` o `null` (así una ficha abierta por
   `readerInitialWord`, que no empuja overlay, cuenta como ficha);
   `sheetOpen` = `overlayReleaseRef.current` vivo y `selectionRef.current === null`;
   `sameWord` = misma palabra normalizada y mismo
   `startContainer`/`startOffset` que la ficha.

   | Entrada | Resultado |
   |---|---|
   | 0 palabras sin `hasHit` (solo espacios o puntuación) | `ignore` (oculta la barra, como hoy) |
   | 0–1 palabra, hoja abierta | `open-card` (la ficha sustituye la hoja, como hoy) |
   | ≥2 palabras, hoja abierta | `ignore` (como hoy) |
   | 0–1 palabra, sin ficha | `open-card` |
   | 0–1 palabra, ficha en otra palabra | `open-card` (swap, como hoy) |
   | 0–1 palabra, `sameWord` | `ignore` |
   | ≥2 palabras, sin ficha | `passage-bar` |
   | ≥2 palabras, ficha abierta | `close-card-then-bar` |

   La tabla vale para táctil y ratón; el tipo de puntero no entra en
   `classifySelection` y solo decide, fuera de ella, si se limpia la selección
   nativa (paso 5).
4. En táctil abre la ficha `selectionchange`, no el temporizador. El
   temporizador de presión larga solo abre si a los 480 ms no hay selección
   nativa (dispositivos que no la crean). Así un `pointercancel` de Android no
   deja sin ficha, y el cambio de palabra sigue por `selectionchange`. Un solo
   camino evita repetir `swap`, telemetría, `recordConsult` y el push de
   consulta.
5. En táctil, ni el temporizador ni `selectionchange` llaman
   `removeAllRanges()`. En ratón no cambia.
6. `close-card-then-bar`: llama `closeSelection` y monta `ReaderSelectionBar`.
7. Un efecto que observa `selection` pasar a `null` limpia la selección nativa
   si sigue siendo de una palabra (cubre ×, toque, atrás, `openSheet`).
   `ReaderContent.tsx:361-363` se queda: un toque fuera de la ficha limpia la
   selección, es la salida esperada.
8. `onContextMenu` en táctil: verificar en Chromium Android (dispositivo real)
   si el `preventDefault` suprime los tiradores. Si los suprime, se quita en
   táctil. El resultado se anota en este documento, bajo esta fase. El callout
   de iOS sobre la ficha se acepta.
9. «Tinta» de la ficha subraya la **oración**. Helper puro nuevo
   `sentenceRangeForHit(block: HTMLElement, hit: WordHit, language: string): Range | null`
   en `words.ts`: localiza la oración con el mismo `Intl.Segmenter` de
   `findSentence` sobre `block.textContent` y convierte sus offsets en un `Range`
   recorriendo los nodos de texto del bloque. El bloque (`closest` con el
   selector de `words.ts:98-99`) y el offset de la palabra salen de
   `hit.range.startContainer`/`startOffset`; esa lógica, hoy duplicada en
   `words.ts:98-109` y `:140-153`, se extrae a un helper común que usan los tres.
   Devuelve `null` si `hit.range` falta (fichas de `readerInitialWord`, cuyo
   `onHighlight` ya es `undefined`, `Reader.tsx:3984`). El rango se recorta de
   espacios igual que el `.trim()` de `findSentence`. No se usa
   `findPassageRange`: su `foldContainer` mete espacios al final de cada nodo
   inline y no casa con `<em>` pegado a puntuación ni con anclas biónicas.
   En `wordPassageActions.onHighlight` (`Reader.tsx:3981-4007`):
   `savePassageRange(sentenceRangeForHit(...) ?? selection.range, tone)`, dentro
   del `if (range)` que ya tiene.
   `WordPanel.tsx` no cambia en esta fase.
   **Decisión pendiente de Luis:** si las acciones de pasaje pasan a verse en el
   nivel 1 de la ficha (hoy solo en el 3, que exige IA).

Criterio verificable:
- Pruebas de `classifySelection`: una por fila de la tabla.
- Pruebas de `sentenceRangeForHit` en jsdom: el rango cubre la oración completa
  y nada más con (a) puntuación pegada tras `</em>` (`una <em>quimera</em>, dijo`),
  (b) la palabra tocada dentro de `mark.predicted-word`, (c) anclas biónicas
  activas (`applySyntacticLines` con `bionicAnchors`).
- `e2e/reader-quote.spec.ts` con
  `test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })`:
  presión larga con `e2e/helpers/touch.ts` → ficha abierta; crear la selección
  de esa palabra con `setBaseAndExtent` → la ficha sigue abierta
  (`sameWord → ignore`); extender con `setBaseAndExtent` a 4 palabras → ficha
  cerrada y barra visible; «Tinta» → ir a Cuaderno → pestaña «Citas y
  Hallazgos» (`Vocabulary.tsx:722`) y la
  anotación aparece en `QuotesPanel`. Los eventos sintéticos no crean selección
  nativa ni prueban los tiradores reales: eso lo cubre la verificación manual del
  paso 8.
- `e2e/word-card.spec.ts` igual que en el paso 0 (sin regresiones nuevas).

### Fase 4 — Barrido de flaquezas de la misma familia (inventario, sin código)

Objetivo: fallos con el mismo patrón — señal visual sin acción, ejercicio que se
resuelve sin pensar, gesto que cierra otro camino.

Pasos:
1. Inventario de toda marca visual en `.book-content` (`mark.*`, `[data-*]`,
   `.lecta-*`) con la acción que dispara. Regla: marca sin acción se quita,
   salvo que sea una ayuda de lectura que el lector activó a propósito.
2. Inventario de toda modalidad de repaso (`WordScrambleGame`,
   `SentenceBuilderGame` cloze/syntax, modos del Cuaderno, y los usos de
   `pickLevelDistractors` en `buildAdaptivePracticeQueue` y `rescueChallenge`)
   con su fuente de opciones. Ninguna puede generar no-palabras ni mostrar la
   respuesta.
3. Inventario de gestos del lector (toque, doble toque en inglés, presión larga,
   arrastre, bordes en páginas) y qué camino bloquea cada uno.
4. Salida: tabla al final de este documento con columnas
   `superficie | archivo | acción que dispara | decisión (arreglar/aceptar/descartar) | fase`.
   Los arreglos entran como fases nuevas, una por familia.

Criterio verificable: la tabla existe, cada fila tiene decisión, y las filas
«arreglar» tienen fase asignada.

## Fuera de alcance

- Cambiar la segmentación de líneas sintácticas.
- Rediseñar `WordPanel` más allá de la decisión pendiente sobre «Tinta».
- El portal Kindle (`/k`): tiene su propio flujo de selección; se revisa en el
  barrido de la Fase 4, no se toca aquí.

## Verificación de cierre

`pnpm gate` + `e2e/smoke-journeys.spec.ts` + `e2e/reader-position.spec.ts` +
`e2e/word-card.spec.ts` + `e2e/reader-quote.spec.ts` + capturas 390 px en
`papel` y `noche`.

## Ajustes de la ronda 5 de revisión (prevalecen sobre el texto anterior)

Revisión Goldfish cerrada en el tope de 5 rondas (detalle en
`goldfish_review_report.md`). Estos ajustes se aplicaron al implementar:

- **Fase 1:** se borra también el comentario huérfano `reader.css:2316`. La
  prueba de `tokens.test.ts` recorre todas las hojas con `readdirSync`
  (`src/client/styles/*.css` + `src/client/styles.css`) y busca un bloque cuyo
  selector contenga `data-connector` con `text-decoration` en el cuerpo.
- **Fase 2:**
  - `lemmaKeys(lemma, form, lang): Set<string>` vive en `practice.ts` y la usan
    `episodic-cloze.ts` y `SentenceBuilderGame` (prop opcional `targetLemma`,
    que pasan el modal y `MidChapterRecallCard` con `item.lemma`). «Palabra
    completa» = tokens `\p{L}+` de la glosa normalizada.
  - `attachClozeOptions` y `pickMidChapterRecall` exigen además
    `blankWordInContext(chapterSentence, form, lang) !== null`; si no hay hueco,
    mismas reglas que sin opciones. La cita visible del cloze no contiene el
    objetivo.
  - `MidChapterRecallCard` no pasa `onSkip` al juego (ya tiene su «Saltar»). La
    guarda <2 opciones oculta también «Pulsa [1-N]» y el botón del gato.
  - `onSaveToPractice` encadena `.then(({ word }) => upsert(word))`; el
    upsert/borrado del ref es un helper puro con prueba. Si `WordPanel` borra sin
    `onRemoved`, el ref se corrige en la siguiente carga (aceptado).
  - Archivos añadidos: `notebook-model.ts` (Modificar: reexporta `seedFor`).
- **Fase 3:**
  - `foldContainer` (`passage-marks.ts`) inserta espacio solo en fronteras de
    bloque, no inline; así la tinta guardada se vuelve a pintar con `<em>`
    pegado a puntuación y con anclas biónicas. Prueba en `passage-marks.test.ts`.
  - `sentenceRangeForHit(hit, language)` (sin `block`).
  - `classifySelection` recibe `emptyWord` (palabra limpia vacía → `ignore`); se
    quita la fila «0 palabras con hit».
  - `sameWord` = `normalizeSearchText(palabra)` + offset de carácter en el
    bloque, independiente del origen del rango. Cuando el temporizador cede a
    `selectionchange` mantiene `pressConsumedRef.current = true`.

## Estado de implementación (2026-11-11)

- Fases 1, 2 y 3 implementadas en el árbol de trabajo (sin commit).
  `pnpm gate` verde: typecheck, lint 0 warnings, 3 454 pruebas, build y
  `check:size` 201.97/215 kB. Se reanclaron tres afirmaciones de
  `docs/auditoria/claims.json` (`H4-jol`, `H6-implicito-tiempo`,
  `H8-sin-medicion`) cuyas líneas se movieron.
- **Paso 0 de Fase 3:** C5 (`e2e/word-card.spec.ts`) ya fallaba en HEAD
  `98d160b` antes de estos cambios (verificado con `git stash`).
- **Decisión de Luis (2026-11-11):** las acciones de pasaje (Tinta, Reflexión,
  Postal, Preguntar) se ven siempre en la ficha, fuera de los niveles de
  divulgación (`WordPanel.tsx`), sin depender de IA ni de «Ver más». Con eso C5
  vuelve a pasar.
- e2e Chromium verdes (13/13): `reader-quote.spec.ts` (nuevo),
  `word-card.spec.ts` (C5 incluido), `reader-position.spec.ts`,
  `smoke-journeys.spec.ts`.
- **Pendiente:** paso 8 (verificar en Android real si `onContextMenu` con
  `preventDefault` suprime los tiradores nativos), verificación manual del
  cierre de capítulo con cloze real en dev, capturas 390 px `papel`/`noche` y
  la Fase 4 (inventario).
