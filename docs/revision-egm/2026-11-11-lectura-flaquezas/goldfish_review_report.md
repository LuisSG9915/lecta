# Goldfish Annotated Review Report — Ronda 5 (tope)

**Target:** `docs/plan-lectura-flaquezas.md` (full file)
**Revisores:** `implementation_readiness` (completed), `codebase_details` (completed)
**Resultado:** ronda NO limpia (0 Blockers, 8 Majors). Tope de 5 rondas alcanzado sin converger.
**Churn:** ninguno. Fases 1 y 4 siguen listas salvo [6].

## Majors abiertos (todos PROPOSE FIX)

### [1] ir-5-M1 + cd-5-M1 — La glosa necesita el lema y el componente no lo recibe
* **Edit:** `lemmaKeys(lemma, form, lang): Set<string>` exportada desde `practice.ts` (no rompe la regla de imports de `episodic-cloze.ts`); prop opcional `targetLemma` en `SentenceBuilderGame`, la pasan el modal y `MidChapterRecallCard` (`item.lemma`). «Palabra completa» = tokens `\p{L}+` de la glosa normalizada. Caso de prueba: glosa con el lema y `targetWord` flexionado.

### [2] cd-5-M2 — La tinta de la oración no se repinta en el libro
* **Discrepancia:** al recargar, la anotación se pinta con `applyPassageMarks` → `findPassageRange` (`passage-marks.ts:122,146`), cuyo `foldContainer` (`:41-45`) mete espacios en fronteras inline. Guardado correcto, subrayado invisible.
* **Edit:** corregir `foldContainer` para insertar espacio solo en fronteras de bloque; prueba en `passage-marks.test.ts` con `<em>` pegado a puntuación y anclas biónicas; el e2e comprueba que aparece `mark` del pasaje en el texto, no solo en `QuotesPanel`. Con esto [9] de ronda 3 podría volver a usar `findPassageRange` — se mantiene `sentenceRangeForHit` (offsets directos) para no reabrir.

### [3] ir-5-M2 — Doble apertura timer + `selectionchange` tardío
* **Edit:** `sameWord` = `normalizeSearchText(palabra)` + offset de carácter en el bloque (helper común del paso 9), independiente del origen del rango. Caso: «timer abrió primero, selección nativa llega después en la misma palabra» → `ignore`. El timer, cuando cede a `selectionchange`, mantiene `pressConsumedRef.current = true`; háptica y cooldown de `validateTapIntent` pasan al camino de `selectionchange` (cd-5-N13).

### [4] cd-5-M3 — Selecciones de solo puntuación
* **Edit:** entrada `emptyWord` (palabra limpia vacía) → `ignore`; se quita la fila imposible «0 palabras con hit».

### [5] cd-5-M4 — Cloze resoluble sin leer cuando la frase es la palabra sola
* **Edit:** `attachClozeOptions` exige `blankWordInContext(chapterSentence, form, lang) !== null` (ya lo usa `pickMidChapterRecall`); si falla → mismas reglas que sin opciones. Criterio de render: la cita visible no contiene el objetivo.

### [6] cd-5-M6 + ir-5-N2 — `tokens.test.ts:243` no recorre todas las hojas
* **Edit:** subir a nivel de módulo una lista hecha con `readdirSync` (ya importado) sobre `src/client/styles/` + `src/client/styles.css`; regla: bloque cuyo selector contiene `data-connector` y cuerpo con `text-decoration`. Borrar también el comentario `reader.css:2316` (ir-5-N1).

### [7] cd-5-M5 — Listas de archivos incompletas y sin marcar
* **Edit:** añadir `notebook-model.ts`, `passage-marks.ts` (+ test), `SentenceBuilderGame.tsx` imports; marcar cada ruta Crear/Modificar.

## Nits (PROPOSE FIX)
* «Saltar» duplicado en `MidChapterRecallCard`: la tarjeta no pasa `onSkip` (su botón ya existe).
* Guarda: ocultar también «Pulsa [1-N]» (`:552-554`) y «🐱 Michi» (`:531-543`).
* Razón de cambio de `useReaderNavigation.test.ts:321-361`: el riesgo es `lang`/`surfaceForm` indefinidos, no que se saque la entrada.
* `onSaveToPractice` encadena `.then(({ word }) => upsert(word))`, rechazo ignorado; `WordPanel.tsx:677-680` borra sin `onRemoved` si no halló entrada → el ref se reconstruye en la siguiente carga (aceptado). Upsert/remove como helper puro con prueba (ir-5-N5).
* `sentenceRangeForHit(hit, language)` sin `block`.
* Idioma: igualdad exacta como el Cuaderno a mitad de capítulo.
* C5 usa clic de ratón; sin IA las acciones nunca salen.
* e2e: nombrar `.reader__passage-bar`, su botón «Tinta» (`.selection-save`), ruta lector → Cuaderno, y `setBaseAndExtent` sobre el mismo nodo que `extractWordAtPoint`.

---

Status: resolved (auto accept: 5 Majors + 13 nits PROPOSE FIX aplicados, 0 CONTEST, 0 ESCALATE nuevos, 0 DECLINE)

# Goldfish Annotated Review Report — Ronda 4

**Target:** `docs/plan-lectura-flaquezas.md` (full file)
**Revisores:** `implementation_readiness` (completed), `codebase_details` (completed)
**Resultado:** ronda NO limpia (0 Blockers, 5 Majors). Rondas limpias consecutivas: 0. Ronda 4 de 5.
**Tendencia:** ambos verifican casi todas las afirmaciones de código; Fases 1 y 4 listas. Los Majors son pruebas no listadas y bordes de diseño, no premisas falsas.
**Churn:** ninguno (los hallazgos refinan, no piden revertir).

## Majors

### [1] ir-4-M1 + cd-4-M1 — Dos pruebas de paginación se rompen
* **Discrepancia:** `useReaderNavigation.test.ts:321-338` y `:340-361` simulan la cola con `{ item: { lemma: "casa" }, modality: "recognition" }`; `attachClozeOptions` (no simulado) lee `surfaceForm` indefinido o vacía la cola → `navigate` se llama.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Listar ambas; fixture con `EpisodicWordItem` completo (`surfaceForm` corta, modalidad `"word-scramble"`). `attachClozeOptions` tolera `surfaceForm` ausente (usa `lemma`).

### [2] ir-4-M2 + cd-4-M3 — Exclusión por lema no funciona con los lemas reales
* **Discrepancia:** los productores siempre rellenan `lemma`, a menudo con la forma superficial (`useReaderSelection.ts:123`, `mid-chapter-recall.ts:35`, `useReaderChapterPrep.ts:700`); `normalizeWordForm` casi no hace nada en `es`. «susurraba» pasa como distractor de «susurró».
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Conjunto de claves por palabra `{n(lemma), n(normalizeWordForm(lemma, lang)), n(normalizeWordForm(form, lang))}` con `n = normalizeSearchText`, en ambos lados; se excluye si comparten clave **o** si comparten un prefijo ≥5 letras (atrapa flexiones del español sin lema de catálogo; perder algún distractor legítimo como «presencia» frente a «presentar» es aceptado). Casos: «susurró» (lema = forma) frente a «susurraba»; EN «whispered» frente a «whispering».

### [3] ir-4-M3 + cd-4-M4 — Guarda <2 opciones da crédito FSRS gratis; pruebas sin archivo
* **Discrepancia:** «Continuar» → `onSolve` → `consolidateEpisodicWord` (Good) en `Reader.tsx:1060-1063` y `DeepReadingSummaryModal.tsx:138`; la tecla `1` sigue eligiendo (`SentenceBuilderGame.tsx:280-297`). Faltan casos de prueba para la guarda, la glosa oculta y el «abrir libro sin sync».
* **AI Suggestion:** PROPOSE FIX
* **Edit:** La guarda pinta la frase completa y un «Saltar» que llama `onSkip` (prop nueva, opcional; sin crédito), sin atajos de teclado. Casos nuevos en `SentenceBuilderGame.test.ts` (guarda, glosa oculta). El «abrir libro sin sync» se prueba en `useReaderNavigation.test.ts` con `savedWordsRef` lleno; la carga en `Reader.tsx:2263` queda como verificación manual.

### [4] cd-4-M2 + ir-4-N4 — `recordModalityAttempt` no tiene llamador
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Quitar la regla; anotar que los pesos adaptativos no se registran hoy.

### [5] cd-4-M5 + ir-4-N2 — Refresco del ref sin enganche
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Upsert/borrado por `key` en `onWordSaved` (`Reader.tsx:3080`) y `onWordRemoved` (`:3150`); `onSaveToPractice` (`:4457-4479`) llama al mismo upsert. Sin relectura de IDB.

## Nits (todos PROPOSE FIX salvo indicación)
* cd-4-N1/N2 + ir-4-N3 — `attachClozeOptions(queue, pool)` devuelve copias nuevas (no muta ítems compartidos); nueva constante en `useReaderNavigation.ts:247`.
* cd-4-N3 — sacar ítems tras `slice` puede achicar la cola: aceptado, anotado.
* cd-4-N4 — `vocabVersion` también sube con `onVocabChange` del Cuaderno: anotado.
* cd-4-N5 — mover `seedFor` a `practice.ts` junto a `shuffleStable` y reexportarlo desde `notebook-model.ts`; `episodic-cloze.ts` deja de importar `notebook-model`.
* cd-4-N6 — la prueba de Fase 1 reutiliza el bucle de hojas de `tokens.test.ts:243`.
* cd-4-N7 + ir-4-N1 — glosa: coincidencia de palabra completa con las claves de [2]; ocultar también `title` (`SentenceBuilderGame.tsx:480`).
* cd-4-N8 + ir-4-N8 — `sentenceRangeForHit`: bloque y offset desde `hit.range` (extraer helper común de `words.ts:98-109`/`:140-153`), `null` sin `range`, rango recortado como `findSentence`; se mantiene el `if (range)` de `onHighlight`.
* cd-4-N9 + ir-4-N9 — helper táctil en `word-card.spec.ts:149-183`; API `touch(page, type, x, y)` y `clickAt(page, x, y)`.
* cd-4-N10 — pestaña «Citas y Hallazgos».
* ir-4-N5/N6 — `classifySelection` sin `isTouch`; fila «0 palabras sin hit → ignore».
* ir-4-N7 — «una palabra» = split por espacios del listener.
* ir-4-N10 — C5 rojo se marca `test.fixme` con referencia a la decisión pendiente.
* ir-4-N11 — candidatos con forma guardada en mayúscula inicial (nombres propios) se excluyen salvo que el objetivo también la tenga.

---

Status: resolved (auto accept: 10 hallazgos + 6 nits PROPOSE FIX aplicados, 0 CONTEST, 0 ESCALATE nuevos, 1 DECLINE)

# Goldfish Annotated Review Report — Ronda 3

**Target:** `docs/plan-lectura-flaquezas.md` (full file)
**Revisores:** `implementation_readiness` (completed tras 1 reintento por límite de uso), `codebase_details` (completed tras 1 reintento)
**Resultado:** ronda NO limpia (3 Blockers, ~10 Majors). Rondas limpias consecutivas: 0. Ronda 3 de 5.
**Fase 1 y Fase 4:** ambos revisores las dan por listas.
**Fixes reabiertos (ronda 2):** [2]/[4] `savedWordsRef` mal ubicado, ciclo de imports y `findPassageRange`. No es churn: revertir a la versión de ronda 1 reintroduce los hallazgos de ronda 2; el arreglo es más preciso, no opuesto.

## Blockers

### [1] ir-3-B1 + cd-3-B1 — `savedWordsRef` vacío en sesión normal
* **Discrepancia:** el efecto de `Reader.tsx:~2499` depende de `[vocabVersion]` y sale si `state !== "ready"`; no corre al abrir. La primera carga real es `Reader.tsx:2263`. Guardar desde el lector no sube `vocabVersion`. Todo caería a `word-scramble`.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Helper `rememberSavedWords(words)` que escribe el ref, llamado en `:2263` y `:2499`, y recarga del ref (`listSavedWords`, async, sin bloquear) tras cada guardado/borrado desde el lector. Prueba: abrir libro, cerrar capítulo sin sync → hay cloze.

### [2] ir-3-B2 + cd-3-M3 — Pruebas del modal que se rompen
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Añadir `DeepReadingSummaryModal.test.ts` (`:288-356`, `:548-610`: pasan `options`; caso nuevo sin opciones → `WordScrambleGame`) y `MidChapterRecallCard.test.ts` si existe. `game.test.ts:420-422` («susurró» → 2) se borra.

### [3] cd-3-M9 — `e2e/word-card.spec.ts` C5 quizá ya está rojo
* **Discrepancia:** C5 (`:51-67`) espera acciones de pasaje visibles al tocar; hoy solo salen en nivel 3.
* **AI Suggestion:** PROPOSE FIX (severidad del revisor: Major; lo listo aquí porque condiciona la puerta de cierre)
* **Edit:** Paso 0 de Fase 3: correr `e2e/word-card.spec.ts` y anotar el estado de C5 en el plan antes de usarlo como puerta.

## Majors

### [4] ir-3-M1 + cd-3-M1 — Ciclo de imports
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `practice.ts` no cambia por el pool. `episodic-cloze.ts` exporta `attachClozeOptions(queue, pool)` y lo llama `useReaderPagination` justo después de `buildPostChapterConsolidationQueue`. Nadie importa `episodic-cloze.ts` salvo hooks: sin ciclo. Clave inline `${lang}:${form.toLowerCase()}` (sin importar idb).

### [5] ir-3-M2 + cd-3-M2 — Hook equivocado
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `UseReaderPaginationOptions.savedWordsRef?: Ref<SavedWord[]>` (opcional), llamada en `Reader.tsx:2986`, pruebas en `describe("useReaderPagination")` (`useReaderNavigation.test.ts:194+`).

### [6] ir-3-M3 + cd-3-M4 — Normalización de lema asimétrica y sin idioma
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Ambos lados: `normalizeSearchText(lemma || normalizeWordForm(form, lang))`. Casos de prueba: EN «whisper» vs «whispered»; ítem sin lema («susurró»).

### [7] ir-3-M4 + cd-3-M5 + cd-3-N1 — Detección táctil: semánticas distintas
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Solo se unifican los dos sitios idénticos (`Reader.tsx:2609-2612`, `ReaderContent.tsx:320-323`) en `isTouchInput(pointerType)` = touch|pen o `(pointer: coarse)`. `Reader.tsx:2668-2670`, `ReaderContent.tsx:482` y `tap-intent-guard.ts:52` no se tocan.

### [8] cd-3-M6 — Tabla cambia el swap con hoja abierta
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Se conserva lo de hoy: hoja abierta + 0–1 palabra → `open-card` (la ficha sustituye la hoja); hoja abierta + ≥2 → `ignore`. `cardWord` sale de `selectionRef`, así una ficha de `readerInitialWord` cuenta como ficha.

### [9] ir-3-M5 + cd-3-M7 — `findPassageRange` no casa la oración
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Helper puro `sentenceRangeForHit(block, hit, language)` en `words.ts`: offset de oración de `findSentence` sobre `block.textContent` y recorrido de nodos de texto (técnica de `words.ts:106-109`). Bloque = selector de `words.ts:98-99`. Fixtures: puntuación pegada tras `</em>`, palabra dentro de `mark.predicted-word`, anclas biónicas activas.

### [10] ir-3-M6 + cd-3-M8 — Pruebas de Fase 3 no construibles
* **AI Suggestion:** PROPOSE FIX
* **Edit:** La prueba de rango apunta a `sentenceRangeForHit` (sin probar el closure). e2e: extraer el helper táctil a `e2e/helpers/touch.ts`; tras la presión, crear la selección de 1 palabra con `setBaseAndExtent` y comprobar que la ficha sigue (`sameWord → ignore`); luego extender a 4; ir a Cuaderno → Citas.

## Nits
* ir-3-N1 — `Reader.tsx:1050` → **PROPOSE FIX**.
* ir-3-N2 + cd-3-N2 — `savedAt` en el objetivo sintético → **PROPOSE FIX**.
* ir-3-N3 — scramble forzado con `surfaceForm` >10 letras: el ítem sale de la cola; intentos forzados no van a `recordModalityAttempt` → **PROPOSE FIX**.
* ir-3-N4 + cd-3-N4 — guarda <2 opciones: muestra la frase completa y «Continuar» (llama `onSolve`), sin botón de pista → **PROPOSE FIX**.
* ir-3-N5 — absorbido en [2].
* cd-3-N3 — semilla distinta al Cuaderno, declarar → **PROPOSE FIX**.
* cd-3-N5 — palabras extra de la prueba no vencidas → **PROPOSE FIX**.
* cd-3-N6 — `syntactic-lines.test.ts:148-162` sigue válido → **DECLINE** (sin cambio).

---

Status: resolved (auto accept: 13 hallazgos + 9 nits PROPOSE FIX aplicados, 0 CONTEST, 0 ESCALATE nuevos, 1 DECLINE)

# Goldfish Annotated Review Report — Ronda 2

**Target:** `docs/plan-lectura-flaquezas.md` (full file)
**Revisores:** `implementation_readiness` (completed), `codebase_details` (completed)
**Resultado:** ronda NO limpia (2 Blockers, ~10 Majors). Rondas limpias consecutivas: 0.
**Settled de ronda 1:** ESCALATE [17] ubicación de Tinta (abierto para Luis); no se reabre.
**Fix reabierto:** ninguno de ronda 1 vuelve igual; los Blockers nuevos son errores del texto escrito en el arreglo de ronda 1 (afirmación falsa sobre `useReaderNavigation`, prueba invertida).

## Blockers

### [1] ir-2-B1 + cd-2-M5 — `useReaderNavigation` no carga palabras; el pool queda sin fuente
* **Discrepancia:** `completeChapterTo` es síncrono y no importa `listSavedWords` ni `captureDbScope`. La afirmación del plan es falsa (verificado).
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Pool por ref, sin volver async el cierre: Reader ya carga `listSavedWords(language, scope)` en el efecto de `Reader.tsx:~2499`; ahí se guarda en `savedWordsRef` (nuevo, `SavedWord[]`, vacío por defecto). `useReaderNavigation` recibe `savedWordsRef` en sus opciones y lo pasa a `buildPostChapterConsolidationQueue(candidates, prefs, isL2, { bookId, pool })`. `listSavedWords` ya filtra por idioma. Fallo de carga o ref vacía → pool vacío → `word-scramble`. Añadir `Reader.tsx` y `useReaderNavigation.test.ts` a la lista.

### [2] cd-2-B1 (+ ir-2-M3) — Prueba «quimera» descrita al revés
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `practice.test.ts:791-801`: objetivo «quimera», candidato «quimérico»; la aserción real es `toContain("camino")`. Se conserva tal cual (candidatos siguen priorizados).

## Majors

### [3] ir-2-M2 + cd-2-M6 — Firma de la cola, nombre de modalidad, `grammar-nuance`
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `pool?: SavedWord[]` opcional en `options`. Sin `pool` (pruebas viejas) nada cambia. Con `pool`: cada ítem lleva `options`; si son `null` y la modalidad no es `word-scramble` (`sentence-cloze` o `grammar-nuance`) → `word-scramble`. Nombre real: `"sentence-cloze"`.

### [4] ir-2-M3 + cd-2-M2 — Lista de pruebas incompleta
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Añadir `practice.test.ts:777-782` («wandering»), `game.test.ts:418-427` (se reescribe: `generateClozeOptions` sin candidatos → 1 opción; la reexportación se queda porque la usa `SentenceBuilderGame`), `mid-chapter-recall.test.ts:48-52` y `:69-78`, `SentenceBuilderGame.test.ts:173-194` y `:283-307` (pasan `options` explícitas).

### [5] ir-2-M4 + cd-2-M3 — «lema distinto» incalculable; regla de borrado imposible
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `generateMorphologicalDistractors` se queda (la llama `generateClozeOptions`) con solo el filtro actual de candidatos (≠ objetivo, longitud ±4) y sin reglas ni contingencia. El filtro por lema vive solo en `episodicClozeOptions`, sobre `SavedWord` (`lemma || normalizeWordForm(form)`, `normalizeSearchText`).

### [6] cd-2-M6 + ir-2-M4 — Cloze sin opciones sigue posible
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `DeepReadingSummaryModal` renderiza `WordScrambleGame` si `item.options` tiene <2 entradas, sea cual sea la modalidad. `SentenceBuilderGame` en cloze con <2 opciones no pinta botones de opción (guarda defensiva + prueba).

### [7] ir-2-M5 + cd-2-M8 — Glosa duplicada y glosa con la respuesta
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Solo cambia la línea 458 → «Completa la frase del capítulo:». El bloque `.sentence-cloze-gloss` (477-487) queda como pista. Si la glosa contiene el objetivo (comparación con `normalizeSearchText`), se oculta. Prueba: ni enunciado ni glosa visible contienen el objetivo.

### [8] cd-2-M4 + ir-2-N9 — Ciclo de import con `seedFor`
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `episodicClozeOptions` vive en archivo nuevo `src/client/lib/episodic-cloze.ts` que importa `practice.ts` y `notebook-model.ts` (sin ciclo: ninguno de los dos lo importa). Semilla: `seedFor(item.lemma || item.surfaceForm)`.

### [9] cd-2-M7 — Mayúscula delata la respuesta
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Exportar `matchCase` de `practice.ts` y aplicarlo a cada distractor con la forma del objetivo en la frase.

### [10] ir-2-M7 + cd-2-M9 — `selectionRef` se desincroniza
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Espejo único en Reader: `useEffect(() => { selectionRef.current = selection })` (patrón de `optionsRef`, `useReaderSelection.ts:54-57`). Limpiar la selección nativa de 1 palabra en un efecto que observa `selection` → `null` (cubre ×, toque, atrás, `openSheet`, `closeOtherOverlays`). `ReaderContent.tsx:361-363` se queda (un toque fuera de la ficha limpia la selección: es la salida esperada).

### [11] ir-2-M6 + cd-2-M10 — `classifySelection` incompleta; Android puede cancelar la presión
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Tabla completa en el plan. Cambio de diseño: **en táctil abre `selectionchange` (no el temporizador)**; el temporizador solo abre si a los 480 ms no hay selección nativa (dispositivos que no la crean). Así cubre `pointercancel` de Android y el cambio de palabra (swap) sigue por `selectionchange`. `sameWord` = misma palabra normalizada y mismo `startContainer`/`startOffset`. `words` = número. Con hoja abierta (`overlayReleaseRef` y `selectionRef.current === null`) → `ignore`. `isTouchPointer` y `classifySelection` van en `src/client/lib/tap-intent-guard.ts`.

### [12] ir-2-M8 + cd-2-M12 — e2e sin método
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })`; presión con el helper táctil de `e2e/word-card.spec.ts:148-200`; extensión sintética con `selection.setBaseAndExtent` (declarado: no prueba los tiradores reales; eso queda para la verificación manual del paso 7). Se quita la aserción de rects (no hay cambio que la sostenga).

### [13] cd-2-M11 + ir-2-N11 — `sentenceRangeAt` sin idioma, duplica código
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Sin helper nuevo: `findPassageRange(block, { text: selection.context })` (`passage-marks.ts:59-91`) sobre el bloque de la palabra; `selection.context` ya es la oración de `findSentence`. Fallback: `selection.range`. Cambio en `wordPassageActions` (`Reader.tsx:3981-4007`), no en `WordPanel.tsx`.

## Nits
* ir-2-N10 + cd-2-N15/N14 — idioma por `.slice(0,2)`, `wordKey`, `.form` → **PROPOSE FIX**.
* cd-2-N16 — `continue` al siguiente vencido → **PROPOSE FIX**.
* cd-2-N17 — `pickLevelDistractors` sí se usa en otros sitios → **PROPOSE FIX**.
* cd-2-N19 — migración legacy enciende `syntacticLines` → **PROPOSE FIX**.
* cd-2-N20 — conector sin ancla biónica → **PROPOSE FIX** (aceptado explícito).
* cd-2-N21, N22 — `effectiveContext`, nombre `word-card.spec.ts` → **PROPOSE FIX**.
* ir-2-N12 — resultado de la verificación manual se anota en el plan → **PROPOSE FIX**.
* ir-2-N13 — Fase 4 marcada como no-código → **PROPOSE FIX**.
* cd-2-N13 — cuatro variantes de detección táctil → absorbido en [11].
* cd-2-N18 — absorbido en [1]/[3].
* cd-2-N23 — componente compartido de acciones de pasaje → **DECLINE** (depende de la decisión abierta [17]).

---

Status: resolved (auto accept: 22 PROPOSE FIX aplicados, 0 CONTEST, 1 ESCALATE abierto [17] ubicación de Tinta, 3 DECLINE)

# Goldfish Annotated Review Report — Ronda 1

**Target:** `docs/plan-lectura-flaquezas.md` (full file)
**Revisores:** `implementation_readiness` (completed), `codebase_details` (completed)
**Veredicto de ambos:** NO LISTO. Ronda no limpia (Blockers abiertos).

IDs: `ir` = implementation_readiness, `cd` = codebase_details. Hallazgos duplicados entre revisores se fusionan.

## Blockers

### [1] ir-1-B1 — El cloze imprime la respuesta
* **Scope:** F2 / Fase 2
* **Discrepancia:** `SentenceBuilderGame.tsx:458` muestra «Completa el espacio para «**{targetWord}**»». Con distractores reales igual se acierta copiando la palabra en negrita.
* **AI Suggestion:** PROPOSE FIX (verificado en código)
* **Edit:** Añadir a F2 la causa y a Fase 2 un paso: el enunciado del cloze muestra la glosa (`shortGloss`) o un texto neutro («Completa la frase del capítulo»), nunca `targetWord`. Prueba: el texto del enunciado no contiene el objetivo.

### [2] cd-1-B1 — Disparador del subrayado de conectores mal descrito
* **Scope:** F1, Fase 1
* **Discrepancia:** El span `data-connector` solo nace con `syntacticLines === true` (`enableSyntactic`, `syntactic-lines.ts:258,282`). Chromatic, biónico o pacer solos no lo crean. `handleAcceptFocusAid` exige aceptar explícitamente. Fuentes silenciosas reales: presets `guided`, `focus`, `lexical` (`settings.ts:552,630,641`).
* **AI Suggestion:** PROPOSE FIX (verificado)
* **Edit:** Reescribir F1: disparador = `syntacticLines`; fuentes silenciosas = esos tres presets. Captura de Fase 1 con preset `focus`.

### [3] cd-1-B2 — Razón falsa para conservar el span
* **Scope:** Fase 1 paso 1 (ir lo marcó Nit N1; cd Blocker)
* **Discrepancia:** `data-sub` va en `.syn-line` y lo calcula `getConnectorRegex`. El span sirve para que `applyBionicToElement` lo salte (`:227`) y para `clearSyntacticLines` (`:163`).
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Corregir la razón. Borrar la regla CSS entera `reader.css:2317-2320` (elimina además el `--accent-subtle`). Prueba en `tokens.test.ts` (ya lee `reader.css`).

### [4] ir-1-B2 + cd-1-M4 — Plomería del pool inexistente; sin lista de archivos
* **Scope:** Fase 2 pasos 3–4; todas las fases
* **Discrepancia:** Reader no guarda el cuaderno; el modal lo monta `ReaderOverlays.tsx:491` con cola de `useReaderNavigation.ts:243-249`; la tarjeta la monta `ReaderContent.tsx:239` y su ítem sale de `pickMidChapterRecall(words, …)` (`Reader.tsx:1049`), que ya tiene todas las palabras.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Resolver opciones al construir el ítem, no por props: añadir `options?: string[]` a `EpisodicWordItem`; rellenarlo en `buildPostChapterConsolidationQueue` (recibe el pool desde `useReaderNavigation`, que llama `listSavedWords`) y en `pickMidChapterRecall`. Los componentes pasan `item.options`. Lista explícita de archivos por fase.

### [5] ir-1-B3 + cd-1-M7 — Pruebas que se rompen no listadas
* **Scope:** Fase 2 paso 1
* **Discrepancia:** Rompen `practice.test.ts:769-775` («camin»), `:784-789` («Susurró»), `:791-801` («quimérico»/«quimera»), `:803-808` («perenne» 3 opciones), `game.test.ts:418-425`.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Listar las pruebas y su reescritura (ver [7]).

### [6] cd-1-B3 — Helpers de distractores mal descritos
* **Scope:** F2 último punto
* **Discrepancia:** Ni `pickDistractors` ni `pickLevelDistractors` filtran idioma; el «nivel» es estado FSRS (`markLevel`), no dificultad léxica; «Elegir palabra» usa solo `pickDistractors` con pool filtrado por idioma + `shuffleStable(seedFor(key))` (`useReviewSession.ts:791-806`).
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Reescribir el punto con esos hechos.

### [7] cd-1-B4 + ir-1-M12 — No existe botón «Cita»
* **Scope:** F3, criterio e2e de Fase 3
* **Discrepancia:** La barra tiene Tinta, Reflexión, Postal, Preguntar. A `QuotesPanel` llega lo guardado con «Tinta» (`kind === "passage"`).
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Usar «Tinta»; nombrar spec `e2e/reader-quote.spec.ts`.

## Majors

### [8] ir-1-M1 + cd-1-M7 — Filtro de raíz `len-3` indefinido
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Borrar las tablas de reglas y la contingencia: `generateMorphologicalDistractors` pasa a devolver solo `candidates` válidos (≠ objetivo, distinto lema, longitud ±4). Se elimina la función si queda sin uso tras el cambio; `generateClozeOptions` sin candidatos devuelve solo el objetivo. Pruebas viejas que fijan variantes por sufijo se borran; nuevas: «inteligibles» sin candidatos → ninguna opción empieza por «inteligib».

### [9] ir-1-M2 + cd-1-M6 — Cuántas opciones
* **AI Suggestion:** PROPOSE FIX
* **Edit:** 4 opciones (objetivo + 3), igual que «Elegir palabra». Con 2 candidatos: 3 opciones. Con <2: sin cloze (ver [11]).

### [10] ir-1-M3 + cd-1-M6 — Opciones sin barajar
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Barajar con `shuffleStable(all, seedFor(lemma))` al construir `options`.

### [11] ir-1-M4 + cd-1-M2 + cd-1-M3 — Helper equivocado y tipo
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Usar `pickDistractors` (orden por hash por objetivo). Adaptador `episodicTarget(item): SavedWord`-like con `key = lang:lemma`, `form = surfaceForm`, `pos = partOfSpeech`. Excluir del pool las palabras cuyo lema normalizado = lema del ítem (código nuevo, se especifica). `partOfSpeech` suele faltar: se cae a «otros».

### [12] ir-1-M5 + cd-1-M5 — Fallback a scramble sin lugar
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Post-capítulo: `buildPostChapterConsolidationQueue` asigna `word-scramble` si no hay ≥2 distractores. Mitad de capítulo: `pickMidChapterRecall` descarta ítems sin opciones (la tarjeta no aparece). Sin rama nueva en `MidChapterRecallCard`.

### [13] ir-1-M6 + cd-1-M1 — Paso 2 de Fase 2 ya existe
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Borrar el paso.

### [14] ir-1-M7 + cd-1-M9 — Doble apertura de la ficha
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Regla: en táctil abre solo el temporizador de presión; `selectionchange` con 1 palabra en táctil no llama `openSelection` si `selectionRef.current` ya apunta a la misma palabra y rango. Cubre la rama `words.length === 0 && singleWordHit`.

### [15] ir-1-M8 + cd-1-M10 — Selección residual y otros manejadores
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Al cerrar la ficha (× o toque) se limpia la selección si sigue siendo de 1 palabra. Revisar `ReaderContent.tsx:348-363` (toque cierra/limpia), `LONG_PRESS_SLOP_PX` y `onContextMenu` (`:478-485`): comprobar en Chromium Android que el `preventDefault` no suprime tiradores; si los suprime, es parte de la causa y se quita en táctil. Callout iOS: aceptado.

### [16] ir-1-M9 + cd-1-M8 — Distinguir la ficha de otros overlays
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Añadir `selectionRef` (espejo de `selection`) leído en el efecto de `selectionchange`; condición = `selectionRef.current !== null`. Nombre real: `closeSelection`.

### [17] ir-1-M10 + cd-1-M11 — La ficha ya tiene «Tinta»
* **AI Suggestion:** PROPOSE FIX + **ESCALATE** (ubicación)
* **Edit (fix):** No crear botón nuevo: `onHighlight` de la ficha guarda la oración entera vía `savePassageRange(sentenceRange, tone)`. Helper nuevo `sentenceRangeAt(range, container)` en `words.ts` (offsets de `findSentence` → `Range`).
* **ESCALATE:** hoy `passageActions` solo se ve en `disclosureLevel === 3` (requiere IA + dos toques). Decisión de producto de Luis: ¿«Tinta» visible siempre en el nivel 1 de la ficha?

### [18] ir-1-M11 — Paso 5 de Fase 3 condicional
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Sustituir por aserción e2e: el rect de la línea seleccionada no intersecta el rect de la ficha a 412×915.

### [19] cd-1-M12 — Prueba jsdom inviable
* **AI Suggestion:** PROPOSE FIX
* **Edit:** Extraer función pura `classifySelection({ words, isTouch, selectionOpen, sameWord })` → `"open-card" | "passage-bar" | "ignore" | "close-card-and-bar"`; probarla sin DOM. La integración la cubre el e2e.

## Nits

* ir-1-N2 — nombrar `tokens.test.ts` y rango CSS → **PROPOSE FIX** (absorbido en [3]).
* ir-1-N3 + cd nit — extraer `isTouchPointer(ref)` (duplicado en `Reader.tsx:2609` y `ReaderContent.tsx:320`) → **PROPOSE FIX**.
* ir-1-N4 — Fase 4: fijar tabla (columnas: superficie, archivo, acción, decisión, fase) y regla «sin acción → se quita» → **PROPOSE FIX**.
* ir-1-N5 — dispatch manual de `selectionchange` → absorbido en [19]. **DECLINE**.
* cd nit — `predicted-word`/`unknown-word` solo comparten estilo en parte → **DECLINE**.
* cd nit — `--accent-subtle` fantasma → absorbido en [3]. **DECLINE**.
