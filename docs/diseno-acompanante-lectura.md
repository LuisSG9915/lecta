# Modo acompañante — vocabulario para quien lee fuera de la app

**Estado:** propuesta de diseño para auditar (Antigravity). Sin implementar.
**Fecha:** 2026-11-01.

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
| `saveWordWithKnowledge`, `saveVocabEntry` | `src/client/lib/idb.ts`, `vocab.ts:319` | Alta manual de palabra con evidencia `source:"saved"` |

**Aclave:** las piezas de librería están limpias y desacopladas. Lo único soldado
al lector es el hook `useReaderChapterPrep` (toma ~30 refs de `Reader.tsx`): el
acompañante debe componer las librerías directamente, no reusar ese hook.

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
                 └─ «Agregar palabra» → caja de texto → lookup → saveWordWithKnowledge
```

Opcional a discutir: «voy por este capítulo» — registrar avance externo para
sugerir primero el capítulo actual. Ver §5.

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
   pesa en θ y en reportes futuros.
3. **Alta manual:** ¿búsqueda con definición del catálogo (flujo `/k/lookup`) o
   captura libre sin definición? ¿El idioma de la palabra siempre es el del libro?
4. **«Voy por este capítulo»:** ¿registrar avance externo para ordenar la lista
   de capítulos y priorizar? `lecta_user_positions` guarda `section_index`, pero
   mezclar avance externo con la posición del lector puede corromper el retomado
   — probablemente necesite marca o tabla aparte, o no hacerse en v1.
5. **Cuántas palabras por capítulo:** la hoja de lectura topea en 40 y la
   antesala en 5; una lista de estudio para físico quizá quiera ~12–15.
6. **Capítulos ya preparados:** si el registro `preparation:v1:` de ese capítulo
   ya está `reviewed`, ¿mostrar resumen o permitir rehacer? (Misma semántica que
   `decidePreparation`.)

## 6. Riesgos e invariantes

- **Sin tablas nuevas en v1:** savedWords, knowledge y el store `session`
  (`preparation:v1:`) ya cubren todo. Nada de IDs int8 ni migraciones.
- **Merges por `updatedAt` con lápidas:** reusar `saveWordWithKnowledge` /
  `confirmPreparation`, jamás escrituras directas nuevas.
- **`getActiveUserId()` / `DbScope` estable** antes de empujar al servidor —
  mismo patrón que `confirmPrep` (`isDbScopeActive`).
- **No romper `useReaderChapterPrep`:** el acompañante compone librerías, no
  extrae el hook del lector.
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

## 8. Prompt de auditoría para Antigravity

```
Audita docs/diseno-acompanante-lectura.md como revisor externo, sin escribir código:

1. Verifica contra el código que el mapa de reutilización (§2) es correcto:
   archivos, funciones y acoplamientos citados. Señala lo que falte o sobre.
2. Compara la Ruta A (portal /k) y la Ruta B (app React): ¿la recomendación de B
   se sostiene? ¿Hay una tercera ruta más simple que no vimos?
3. Busca invariantes rotos: merges por updatedAt, lápidas, claves preparation:v1:,
   DbScope por cuenta, presupuesto de bundle, sync offline.
4. Ataca la §5: ¿qué decisión de producto falta? ¿Cuál de las listadas puedes
   resolver con evidencia del código en vez de opinión?
5. Estima el trabajo real de la Ruta B: lista los componentes/hooks nuevos
   mínimos y qué tests exigiría la regla de cobertura ratchet.
6. Devuelve: defectos del diseño (crítico/importante/opcional), lo que está bien
   resuelto, y un plan de fases con verificación por fase si la Ruta B se aprueba.
```
