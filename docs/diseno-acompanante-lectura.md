# Modo acompañante — vocabulario para quien lee fuera de la app

**Estado:** propuesta de diseño para auditar (Antigravity). Sin implementar.
**Fecha:** 2026-11-01. Revisada el mismo día contra el código: las citas de
§2 están verificadas; lo añadido por la revisión va marcado «(rev.)».

## 1. La idea

Hay usuarios que leen el libro **en físico** o en otro servicio (Kindle, Kobo,
Google Play Books) y no van a leer dentro de Lecta. Hoy el sistema no les sirve:
toda la captura de vocabulario ocurre tocando palabras en el lector propio.

La propuesta: un flujo que no exige leer en la app.

1. Elegir un libro de los que ya están subidos a R2 (la biblioteca de la cuenta,
   incluidos los que no están descargados en el dispositivo).
2. Ver **solo la lista de capítulos** — nada de lector.
3. Tocar un capítulo → lista de **posibles palabras complicadas**, personalizada
   con el nivel de vocabulario del usuario (θ por idioma, escala `4 − zipf`), su
   evidencia de conocimiento y su Cuaderno.
4. Por palabra: marcar «La conozco» / guardarla al Cuaderno, igual que en la
   preparación «Antes de leer» del lector.
5. **Agregar palabras que no salieron en la lista** — las que el usuario se
   encontró leyendo el físico — con búsqueda de definición en el catálogo.

Resultado: el Cuaderno y las tarjetas FSRS crecen igual que si leyera en la app,
y cada «posibles palabras» del siguiente capítulo sale mejor calibrada.

## 2. Lo que ya existe (mapa de reutilización)

### 2.1 Libros en R2 y estantería

| Pieza | Dónde | Qué hace |
|---|---|---|
| `GET /api/books` | `src/worker/app.ts:1955` | Lista `books/{userId}/*.epub` de R2 con título, autor, idioma, secciones, portada |
| `listRemoteBooks` / `downloadBook` | `src/client/lib/books.ts:55,67` | Lista y descarga libros remotos |
| Mezcla local + remota | `src/client/App.tsx:645-651` | La estantería ya muestra libros solo-en-nube |
| `openRemoteBook` | `src/client/App.tsx:1328` | Descarga → guarda en IDB → abre |

### 2.2 Catálogo, análisis y selección de palabras (cliente)

| Pieza | Dónde | Qué hace |
|---|---|---|
| `buildChapterCatalog`, `targetAt`, `ChapterRange` | `src/client/lib/chapters.ts:274` | Destinos lógicos del EPUB (índice/landmarks) con rango de secciones físicas |
| `createChapterAnalyzer` | `src/client/lib/chapter-analysis.ts:109` | Extrae formas del rango, consulta el léxico (`batchLookup`), cachea por destino |
| `buildSuggestionRows` | `src/client/lib/section-words.ts` | Selección personalizada: θ + knowledge + Cuaderno + `nextChapterUtility`; niveles rows/uncertain/deferred (tope 40) |
| `loadUserTheta` | `src/client/lib/profile-models.ts:280` | θ por idioma en escala `4 − zipf` — **esto es "el nivel de vocabulario"** |
| `confirmPreparation` → `savePreparationBatch` | `src/client/lib/preparation.ts:321` | Transacción conocimiento + Cuaderno, luego push al servidor |
| `SectionPreview` | `src/client/components/SectionPreview.tsx` | Vista ya desacoplada: recibe filas/respuestas/callbacks |
| `saveWordWithKnowledge`, `saveVocabEntry` | `src/client/lib/idb.ts:1635`, `vocab.ts:319` | Alta manual de palabra con evidencia `source:"saved"` |
| `lookupWord`, `batchLookup` | `src/client/lib/lexicon.ts:260,283` | Definición del catálogo para el alta manual (con caché offline) |
| `buildPostChapterConsolidationQueue` | `src/client/lib/practice.ts:561` | Cola de repaso: reencuentros del Cuaderno dentro del capítulo |
| `recordChapterCompleted` | `src/client/lib/profile-models.ts:600` | Marca «capítulo terminado» en el perfil — ver §5.7 antes de usarla |
| `menteBaseForms`, `cliticBaseForms`, `isWordToken` | `src/shared/word-form.ts`, `lib/knowledge.ts` | Bases flexivas para el autocompletado del alta manual |

**Aclave:** las piezas de librería están limpias y desacopladas. Lo único soldado
al lector es el hook `useReaderChapterPrep` (toma ~30 refs de `Reader.tsx`): el
acompañante debe componer las librerías directamente, no reusar ese hook.

**(rev.) Ojo con `saveVocabEntry` (`vocab.ts:340`):** fija `language:"es"` en la
palabra y en la evidencia. Para libros en otros idiomas el alta manual va por
`saveWordWithKnowledge` con el `language` del libro, o se parametriza la
función.

### 2.3 El equivalente en servidor (portal `/k`, e-ink)

| Pieza | Dónde | Qué hace |
|---|---|---|
| `/k` estantería | `src/worker/kindle/routes.ts` | Lista los libros R2 de la cuenta, HTML sin JS |
| `?toc=1` | `routes.ts:1882` + `renderKindleTocView` | Índice real del libro |
| `?prep=1` antesala | `routes.ts:1941-2092` + `renderKindleChapterPrimingView` | Palabras difíciles del capítulo con «Ya la sé» / «+ Repasar» por palabra |
| Selección servidor | `epub-reader.ts` | `extractChapterPrepCandidates` + `estimateThetaFromD1Knowledge` + `selectKindleChapterPrimingWords` (tope 5) |
| `/k/vocab/add` | `routes.ts:2341` | UPSERT en `lecta_user_words`; si falta el significado lo busca en `lexicon_*` |
| `/k/knowledge/mark` | `routes.ts:2410` | Marca lema conocido/desconocido (`source:'preparation'`) |
| `/k/lookup` | `routes.ts:2303` | Consulta de diccionario con formulario de guardado |
| Caché de capítulos | `kindle/cache.ts` | Artefactos por capítulo en R2 (`kcache/ch/{hash}/{sección}.json`) |

## 3. Flujo propuesto

```
Estantería / sección «Acompañar lectura»
  └─ Libro (de R2; si no está local se descarga una vez, como openRemoteBook)
       └─ Lista de capítulos (buildChapterCatalog — mismos títulos del índice)
            └─ Hoja de palabras del capítulo (SectionPreview o variante)
                 ├─ «La conozco» / «No la conozco» → evidencia + Cuaderno
                 ├─ confirmar → confirmPreparation (misma transacción de hoy)
                 ├─ «Agregar palabra» → caja con autocompletado sobre las
                 │   formas del libro (§5.8) → lookup → saveWordWithKnowledge
                 └─ «Ya leí este capítulo» (§5.7) → repaso de reencuentros
```

Opcional a discutir: «voy por este capítulo» — registrar avance externo para
sugerir primero el capítulo actual. Ver §5.4. (rev.) La versión barata para
v1: recordar solo el «último capítulo abierto» en el store `session` con clave
propia versionada (`companion:v1:{hash}:last`), sin tocar
`lecta_user_positions`.

## 4. Rutas de implementación

### Ruta A — Extender el portal `/k` (server-rendered)

Casi todo existe ya: falta una vista de libro que liste capítulos con acción
«Palabras» cada uno (hoy la antesala solo aparece dentro del lector), subir el
tope de `selectKindleChapterPrimingWords` (parámetro `maxWords`, hoy 5) y una
caja de «agregar palabra» (el patrón `/k/lookup` + `/k/vocab/add` ya lo resuelve).

- **A favor:** mínimo código nuevo; funciona en cualquier navegador sin descargar
  el EPUB; escrituras server-authoritative directas a `lecta_user_words` /
  `lecta_user_knowledge`; cero peso de bundle.
- **En contra:** usa **otro** algoritmo de selección y **otro** estimador de θ
  (`estimateThetaFromD1Knowledge` deriva θ de las filas de conocimiento, no del
  perfil calibrado). Las palabras sugeridas **no serían las mismas** que vería la
  preparación in-app — divergencia real del modelo de aprendizaje. Cada toque es
  un round-trip a Cockroach (~100 ms). La UI está pensada para e-ink.

### Ruta B — Superficie acompañante dentro de la app React

Componer `buildChapterCatalog` → `createChapterAnalyzer` → `buildSuggestionRows`
→ `SectionPreview` → `confirmPreparation`, más un campo de alta manual. Punto de
entrada: acción por libro en la estantería («Palabras por capítulo»).

- **A favor:** **la misma selección que el lector** — mismo θ, mismo knowledge
  map, mismo `nextChapterUtility`; funciona sin conexión con el libro ya
  descargado; el registro `preparation:v1:` queda compartido con la antesala del
  lector (si prepara el capítulo aquí y luego lo lee en la app, ya está hecho);
  no duplica algoritmos que luego habría que unificar.
- **En contra:** exige descargar y parsear el EPUB completo (igual que abrirlo
  para leer — ya es el flujo normal); hay que escribir un controlador delgado
  nuevo (no reusar `useReaderChapterPrep`, acoplado a `Reader.tsx`); sumar JS al
  bundle exige carga diferida (vamos en ~179.6 kB de 215 kB gzip).

### Recomendación

**Ruta B.** El criterio decisivo es la consistencia del modelo: un «difícil»
distinto entre acompañante y lector le quita sentido a la personalización y
ensucia θ con dos estimadores. La ruta A queda como extensión barata posterior
para el portal e-ink (su audiencia sí lee en pantalla, es un caso distinto).

## 5. Decisiones de producto (las decide Luis, no el implementador)

1. **Nombre y entrada:** ¿acción por libro en la estantería («Acompañar»,
   «Palabras por capítulo») o sección propia? El vocabulario de UI lo define Luis.
2. **Evidencia de «La conozco»:** ¿cuenta igual que la preparación in-app
   (`source:"preparation"`) o con fuente propia (`"acompanante"`)? Cambia cómo
   pesa en θ y en reportes futuros. (rev.) Recomendación: reusar
   `"preparation"` al confirmar sugerencias y `"saved"` en el alta manual —
   son los mismos actos que hoy hace el lector; `source` es texto libre, así
   que `"acompanante"` es legal pero solo aporta si se van a sacar reportes
   separados del modo.
3. **Alta manual:** ¿búsqueda con definición del catálogo (flujo `/k/lookup`) o
   captura libre sin definición? ¿El idioma de la palabra siempre es el del libro?
4. **«Voy por este capítulo»:** ¿registrar avance externo para ordenar la lista
   de capítulos y priorizar? `lecta_user_positions` guarda `section_index`, pero
   mezclar avance externo con la posición del lector puede corromper el retomado
   — probablemente necesite marca o tabla aparte, o no hacerse en v1.
   (rev.) Recomendación: v1 con solo «último capítulo abierto» local (clave
   `companion:v1:{hash}:last` en `session`); el avance externo completo es una
   decisión aparte con su propio diseño.
5. **Cuántas palabras por capítulo:** la hoja de lectura topea en 40 y la
   antesala en 5; una lista de estudio para físico quizá quiera ~12–15.
   (rev.) ~12–15 en la selección principal funciona: `PREPARATION_ROWS_CAP = 40`
   sigue de tope duro y el resto cae a la bandeja `deferred` colapsada.
6. **Capítulos ya preparados:** si el registro `preparation:v1:` de ese capítulo
   ya está `reviewed`, ¿mostrar resumen o permitir rehacer? (Misma semántica que
   `decidePreparation`.)
7. **«Ya leí este capítulo» (rev. — lo que faltaba):** el circuito de
   aprendizaje (consolidación episódica, cola de reencuentros del Cuaderno,
   `recordChapterCompleted`) hoy solo se dispara leyendo en la app. Para el
   lector de papel hay dos sub-decisiones:
   a) ¿ofrecer la cola de repaso de reencuentros al marcar el capítulo como
      leído? Recomendado: sí — sin esto las palabras episódicas del lector de
      papel nunca consolidan;
   b) ¿contar el capítulo en «Tu recorrido» (`recordChapterCompleted`)?
      Decidir qué significa la métrica antes de mezclar lectura externa con
      lectura en pantalla.
8. **Autocompletado del alta manual (rev.):** escribir con el libro en la otra
   mano es el punto de máxima fricción. Opciones: (a) autocompletar con las
   formas del libro — garantiza que la palabra exista, adjunta su frase de
   contexto e infiere el capítulo donde aparece; (b) captura libre +
   `lookupWord`. Recomendación: (a) con (b) de reserva, porque la edición
   física puede no coincidir con el EPUB (§6).

## 6. Riesgos e invariantes

- **Sin tablas nuevas en v1:** savedWords, knowledge y el store `session`
  (`preparation:v1:`) ya cubren todo. Nada de IDs int8 ni migraciones.
- **Merges por `updatedAt` con lápidas:** reusar `saveWordWithKnowledge` /
  `confirmPreparation`, jamás escrituras directas nuevas.
- **`getActiveUserId()` / `DbScope` estable** antes de empujar al servidor —
  mismo patrón que `confirmPrep` (`isDbScopeActive`).
- **No romper `useReaderChapterPrep`:** el acompañante compone librerías, no
  extrae el hook del lector.
- **Edición física ≠ EPUB (rev.):** el papel puede ser otra traducción o una
  edición abreviada. La lista por capítulo es organizativa, no posicional, y
  el alta manual NO debe exigir que la palabra exista en el EPUB.
- **Autocompletar pide un índice del libro entero (rev.):** construirlo en
  idle tras la descarga y cachearlo en IDB con clave versionada propia
  (`bookForms:v1:{hash}`) — misma regla de migración que `preparation:v1:`.
- **Cero endpoints nuevos (rev.):** toda escritura reusa `pushWordsToServer` /
  `pushKnowledgeToServer`; si el diseño pide un endpoint nuevo, algo se salió
  del camino.
- **`saveVocabEntry` fijada a `es` (rev.):** ver §2.2 — el alta manual en
  libros de otro idioma usa `saveWordWithKnowledge` con el idioma del libro.
- **Bundle:** la superficie completa (parse EPUB + análisis + hoja) va detrás de
  `import()` perezoso; `check:size` es puerta.
- **Descarga del EPUB:** libros grandes tardan; estado de «Descargando…» como
  `openRemoteBook`, con error amable.
- **Sin conexión:** análisis y guardado local funcionan; el push difiere igual
  que hoy (`synced:false` → «se sincroniza al volver la conexión»).

## 7. Criterios de aceptación (borrador)

1. Desde la estantería puedo abrir «Palabras por capítulo» de un libro que solo
   está en la nube; se descarga y muestra la lista de capítulos del índice.
2. Al tocar un capítulo veo las mismas candidatas que vería la antesala del
   lector (mismo θ, misma selección) — verificable comparando filas.
3. Marcar «No la conozco» y confirmar crea la palabra en `savedWords` con su
   tarjeta FSRS y la evidencia en `knowledge`, igual que `confirmPreparation`.
4. «Agregar palabra» con una palabra ausente de la lista la guarda con
   definición del catálogo (o sin ella si no hay ficha).
5. Sin sesión: todo queda local y se sincroniza después (comportamiento heredado).
6. `pnpm gate` en verde; la superficie carga diferida sin inflar el arranque.
7. El alta manual autocompleta desde las formas del libro y, si la palabra no
   está en el EPUB (edición distinta), se guarda igual tras `lookupWord`.
8. En un libro en inglés, la palabra agregada a mano queda con `language:"en"`
   en `savedWords` y `knowledge`.
9. Un capítulo sin candidatas muestra un estado vacío diseñado — no una hoja
   en blanco ni un spinner eterno.

## 8. Auditoría con Google Argon

`node scripts/generar-auditoria-acompanante.mjs` genera
`artifacts/auditoria-acompanante-para-argon.md`: un dossier autocontenido con
este documento, los archivos citados y las preguntas de auditoría — el mismo
patrón que `scripts/generar-auditoria-argon.mjs` usó para el subsistema Kindle.
El dossier se pega entero a Argon; su prompt va embebido al inicio del archivo.

## 9. Estado de implementación (2026-11-01)

Implementada la Ruta B completa. Decisiones finales y dónde difieren del
borrador:

- **Nombre e interna:** etiqueta visible «Leo este libro en papel» (Opciones
  del libro en la estantería; tocar la portada sigue abriendo el lector —
  regla zero-friction intacta). En código la superficie es `paperReading`
  (`Companion` ya es la mascota).
- **Índice del libro:** se reusa `bookVocab:v1:{hash}` (`loadBookVocab`) —
  el `bookForms:v1` propuesto se descartó porque el manifiesto ya existe y
  ya está en borrado/respaldo.
- **Estado propio:** `paperReading:v1:{hash}` (`lib/paper-reading.ts`) —
  solo `readTargetIds` + `lastTargetId`; registrado en
  `isBookScopedSessionKey` y `BACKUP_SESSION_PREFIXES`.
- **Misma selección del lector:** `buildChapterSuggestionRows`
  (`lib/preparation-rows.ts`) centraliza la llamada a `buildSuggestionRows`
  con las mismas fuentes (saved, knowledge, `threshold` de `refreshProfile`,
  `userTheta`, `isSecondLanguage`) — sin `bookFrequencies` ni umbral aparte,
  para que las filas coincidan con la antesala. La hoja comparte la caché
  `chapAn:{hash}:{target}` con el lector (`chapterAnalysisCacheKey`);
  registrada en `isBookScopedSessionKey` (muere con el libro; es caché
  regenerable, no viaja en el respaldo).
- **Hoja de capítulo propia** (`PaperChapterSheet`), no SectionPreview con
  prop: la antesala del lector tiene selector de estrategia y «Entrar al
  capítulo». La fila presentacional sí se comparte
  (`PreparationAnswerRow`, reexportada de `SectionPreview`).
- **12 palabras principales** ordenadas por primera aparición en el capítulo
  (`splitPaperRows`); el resto en «Ver más palabras de este capítulo»
  (paginado de 8) y «Otras palabras difíciles de medir» colapsadas.
- **Autoguardado:** cada respuesta es borrador persistido al tocarla;
  `closeChapter` confirma con `confirmPreparation` al cerrar la hoja, al
  marcar «Terminé» o al desmontar la pantalla — cerrar el celular no pierde
  respuestas. «Deshacer» del alta manual solo toca claves creadas en la
  visita (`manualCreatedRef`).
- **Alta manual:** autocompletado capítulo → libro → «Buscar en el
  diccionario»; guarda con `saveWordWithKnowledge` (idioma real del libro),
  contexto solo si la forma aparece en el capítulo (`contextIfPresent` —
  `extractChapterContextSnippet` devuelve el inicio cuando no hay
  coincidencia y guardaría una frase ajena).
- **«Terminé este capítulo»:** confirma respuestas, marca `readTargetIds`
  y muestra panel con «Repasar palabras de este libro» (solo si hay
  palabras del libro en el Cuaderno) — nada de `consolidateEpisodicWord`
  automático ni minutos fingidos.
- **Libro solo-en-cuenta:** el botón queda para todos; `openRemoteBook`
  devuelve `boolean` y el modo entra solo si la descarga cerró bien.
- **Cuaderno filtrado:** `initialBookFilter` en `Vocabulary`; cada petición
  remonta la vista por `key` (nonce) — el filtro se aplica una vez y el
  select queda libre.
- **Historial:** pantalla y hoja son capas `pushOverlay`; «atrás» cierra la
  hoja (con autoguardado) antes que la pantalla.
- **Bundle:** `PaperReading` va por `lazy()` — chunk propio 6.74 kB gzip
  diferido; arranque inicial quedó en 207.66 kB de 215 kB.
- **Cobertura:** 6 archivos de prueba unitaria (109 casos), 14 casos de
  componentes y `e2e/paper-reading.spec.ts` con dos recorridos: local
  (tap→lector, Opciones→modo, filas, «No la conozco», alta manual,
  «Terminé», «atrás») y solo-en-cuenta (lista remota → «Leo este libro
  en papel» → descarga → índice de capítulos).
- **Puerta:** `pnpm gate` en verde completo — typecheck, lint, 227
  archivos / 3204 pruebas, build y check:size.
