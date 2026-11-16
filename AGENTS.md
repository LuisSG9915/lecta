# Lecta — notas del proyecto

## Principios de trabajo con código (karpathy-guidelines)

Inspirados en las observaciones de Andrej Karpathy sobre errores típicos de LLMs al programar
(plugin `andrej-karpathy-skills`, MIT). Aplican a todo cambio; para tareas triviales, criterio propio.

1. **Piensa antes de programar.** Declara supuestos. Si hay varias interpretaciones, preséntalas
   en vez de elegir en silencio. Si algo no está claro, para y pregunta. Si existe un enfoque más
   simple, dilo.
2. **Simplicidad primero.** Solo lo pedido: sin abstracciones para un único uso, sin
   configurabilidad no solicitada, sin manejo de errores para escenarios imposibles. Si algo
   podría ser 50 líneas y tiene 200, reescríbelo.
3. **Cambios quirúrgicos.** Toca solo lo necesario y respeta el estilo existente. No «mejores»
   código, comentarios ni formato ajenos. El código muerto que no es tuyo se menciona, no se borra.
   Quita solo los imports, variables y funciones que tu cambio dejó huérfanos. Cada línea
   modificada debe poder rastrearse hasta la petición.
4. **Ejecución guiada por objetivos.** Define el criterio verificable antes de codificar: un test
   que reproduzca el bug y luego pase; tests antes y después de un refactor. Para tareas de varios
   pasos, enuncia un plan corto con una comprobación por paso. Un criterio débil («que funcione»)
   obliga a preguntar constantemente.

## Convenciones de Testing y CI

- **Aislamiento de entornos en Vitest**: `environmentMatchGlobs` asigna entorno estricto `'node'` a `src/worker/**`, `src/shared/**` y `mcp/src/**`, reservando `'jsdom'` exclusivamente para componentes y hooks de `src/client/**`. Evita fugas de memoria y emulaciones de DOM innecesarias.
- **Pool de procesos y memoria**: `pool: 'forks'` con workers dinámicos (`process.env.CI ? 2 : 4`) para garantizar que el sistema operativo reclame la memoria tras suites pesadas y prevenir OOM en runners de 2 vCPUs.
- **Regla de cobertura Ratchet (`pnpm coverage:ratchet`)**: Los umbrales de cobertura en `vitest.config.ts` (líneas y funciones >= 70% en `src/worker/**`) solo aumentan, jamás disminuyen. Nuevos módulos deben nacer con pruebas unitarias herméticas.
- **CI Paralelizado en 4 Jobs (`.github/workflows/ci.yml`)**: `static` (typecheck + lint, 5m), `unit` (cobertura Vitest, 10m), `build` (compilación y check:size, 8m) corren en paralelo desde t=0; `e2e` (Playwright, 15m) descarga el artefacto `dist/` tras el build.
- **Pruebas E2E y Tag `@smoke`**: `e2e/smoke-journeys.spec.ts` cubre los 3 recorridos críticos (apertura EPUB, TTS y sincronización de estado entre contextos). En CI, el proyecto WebKit ejecuta exclusivamente tests con `@smoke` (`pnpm test:e2e:smoke`), mientras Chromium corre la suite completa.
- **Guardia de la posición del lector (`e2e/reader-position.spec.ts`)**: importa `fixtures/scroll.epub` (generado por `scripts/make-scroll-fixture.mjs`), lee a media página, espera el guardado perezoso, recarga, abre el libro **desde la estantería** y exige el mismo párrafo con el mismo desplazamiento dentro de él, dos aperturas seguidas. Reimportar el EPUB en cada reapertura era el paso frágil (parsea el zip y pega contra la API simulada del arnés), no la app: se reabre pulsando el libro. Falla con `desplazamiento dentro del párrafo: antes 229px, después 0px` si se pierde la fracción intra-párrafo.
- **El service worker no recarga la primera visita**: `registerServiceWorker` (`src/client/lib/sw-register.ts`) sólo recarga en `controllerchange` si la página **ya estaba** controlada. `public/sw.js` hace `skipWaiting()` y `clients.claim()`, así que en la primera visita el SW tomaba el control y recargaba la página encima de la importación del libro, la primera sección o la posición restaurada (rompía `smoke-journeys` de forma intermitente). Un arnés e2e que necesite inmunidad total puede stubear `navigator.serviceWorker.register`.
- **Navegación del SW sin abort + aviso `LECTA_NAV_STALE`**: si la red tarda más de `NAVIGATION_TIMEOUT_MS` (3500 ms) se sirve el `index.html` guardado *sin cortar el fetch*; cuando la copia fresca llega se guarda en caché y se avisa `LECTA_NAV_STALE` — el cliente recarga sólo en los primeros 45 s de sesión (`NAV_STALE_WINDOW_MS`), después la copia ya queda para la próxima apertura. `/sw-manifest.json` y `/manifest.webmanifest` están excluidos del fetch handler (siempre a red): el install/activate pide el manifiesto con `?v=<ts>` porque sus propios fetch los intercepta el SW viejo activo, que si no le serviría el manifiesto del deploy anterior desde caché. Por la misma razón el install **no** precachea `/` ni `/index.html` directo: pide `/__lecta_shell__` (`shellRequest()`, ruta que el SW viejo no trata como navegación → cae a la red → el fallback SPA devuelve el HTML del deploy vigente) y lo guarda con `cache.put` bajo ambas claves. Pedirlas directo dejaba al SW viejo servir el HTML anterior por el fallback de red lenta y el precaché quedaba envenenado con la versión vieja hasta borrar caché. El precaché del install tolera fallos por archivo (`cache.add` individual); un `cache.addAll` todo-o-nada descartaba el SW nuevo ante un solo 404.
- **Política de Flaky Tests (`docs/flaky-tests.md`)**: Pruebas con fallos intermitentes se registran con causa raíz. Si un test acumula 3 reintentos en 2 semanas, se aísla con `.fixme` y se programa su corrección.
- **Smoke Tests Post-Deploy (`deploy-smoke.yml`)**: Verificación automática post-despliegue con `pnpm smoke:auth` y `pnpm smoke:sync` usando exponential backoff en `/api/health` para absorber la propagación de Cloudflare Workers, autenticación sobre cuenta canónica (UPSERT idempotente) y reporte automático de issues con etiqueta `smoke-regression` ante fallos.

## Verificación

- `pnpm typecheck` (cliente + worker + MCP), `pnpm lint`, `pnpm test`, `pnpm build`.
- `pnpm gate` corre las pruebas con `scripts/test-trace.mjs`: si fallan, deja el log
  completo en `artifacts/test-failures/<fecha>.log` y resume en la terminal el
  archivo y la prueba. (Existe porque un fallo del gate se perdió una vez por
  filtrar la salida con un grep: un fallo sin nombre cuesta una tarde.)
- `pnpm gate` encadena typecheck + lint + test + build + check:size: es la puerta de
  cierre de cada fase de `docs/plan-8-fases.md`. `pnpm lint` tiene un tope duro de **0
  warnings** (bajó de 28 con la auditoría UX del 2026-10-24, que dejó de bailar el análisis
  del React Compiler y limpió los 20 que quedaban): un warning nuevo rompe el gate.
  `check:size` va en **207.14 kB** de 215 kB gzip (avisa al 90 %, es decir a partir de
  193.5 kB — el aviso sale siempre y hay que fijarse en el margen que imprime, no en su
  presencia); en peso quedan ~7.9 kB de margen.
- La suite (`vitest.config.ts`) corre con **4 workers** y timeouts de 15 s. Son 183 archivos con
  jsdom en un portátil de 8 GB que además corre IDE: con un worker por núcleo, un pico de memoria
  mata workers y tumba archivos que no tienen que ver con el cambio (visto el 2026-10-22: 6
  archivos y 18 pruebas de golpe, sin reproducirse después). Con 4 workers tarda **~28 s** y
  aguanta carga.
- `pnpm smoke:auth` corre contra un server vivo y **escribe** en él (dos cuentas
  nuevas, un EPUB en R2 y vocab); `SMOKE_URL=<url>` para producción, una sola vez
  por deploy y anotando las cuentas creadas.
- `pnpm smoke:sync` (`scripts/smoke-sync.mjs`) verifica el contrato de sync de
  punta a punta: crea una cuenta temporal y comprueba que el pull incremental
  devuelve `syncedAt`, que el cursor no repite filas y que una fila escrita con
  `updatedAt` atrasado **sí** aparece por sello de servidor. Igual que
  `smoke:auth`, escribe: apúntalo a dev o anota la cuenta. Contra producción el
  2026-10-24 pasó completo antes y después del deploy.
- `pnpm db:setup` / `pnpm db:auth` aplican esquema y tablas de Better Auth (usan `DATABASE_URL` de `.env`).
- `pnpm db:migrate` aplica `db/migrations/*.sql` en orden a la base del `.env` (idempotente, registra en `lecta_schema_migrations`). Migraciones nuevas van solo a `lecta_dev` salvo autorización.
- El migrador exige que `current_database()` coincida con `LECTA_MIGRATE_TARGET` (default `lecta_dev`). Para producción: `LECTA_MIGRATE_TARGET=lecta` + `DATABASE_URL` con el nombre cambiado a `lecta` — solo con autorización expresa.
- `pnpm db:migrate` aplica `db/migrations/*.sql` en orden (registra lo aplicado en `lecta_schema_migrations`; idempotente).
- `pnpm db:migrate` falla rápido si una tabla destino tiene `schema_locked=true`; no espera indefinidamente. Desbloquéala solo para esa migración (`ALTER TABLE ... SET (schema_locked = false)`), migra y vuelve a bloquearla. `LECTA_MIGRATE_TIMEOUT_MS` ajusta el límite de sentencia (default 120000 ms).
- `pnpm build` elimina `dist/lecta/.dev.vars` (secretos) al terminar. Para probar
  auth, sync o IA en local con `vite preview`, usa `pnpm preview:local`
  (`LECTA_KEEP_DEV_VARS=1`): conserva ese archivo solo en tu máquina.
- **CockroachDB serializa los cambios de esquema y un job `SCHEMA CHANGE GC`
  ocupa la cola mientras espera MVCC GC.** El TTL de la base es
  `gc.ttlseconds = 4500` (75 min): tras un `DROP INDEX`/`DROP TABLE`, cualquier
  `CREATE INDEX` o `ALTER TABLE` se queda colgado hasta que expira. Verificado el
  2026-10-22 con migraciones de 20 s bloqueadas más de 5 min. Reglas: no crear
  índices de prueba y borrarlos el mismo día de una migración; si una migración
  se cuelga, mirar `SHOW JOBS` antes de tocar nada (un GC en `waiting for MVCC GC`
  es la causa, y ni `CANCEL JOB` ni `PAUSE JOB` lo liberan).
- **Un `CREATE INDEX` cuyas columnas clave incluyen la PK completa se cuelga**
  (bug del cluster, verificado el 2026-10-22 en `lecta_user_activity`,
  `lecta_user_reviews` y `lecta_user_knowledge`). CockroachDB ya añade las
  columnas de la PK de forma implícita al índice, así que la solución es dejar
  fuera las que completan la PK: `(user_id, ended_at, id)` → `(user_id, ended_at)`.
  Los índices de prod `idx_user_activity_user_ended_id`,
  `idx_user_reviews_user_created_id` e `idx_user_knowledge_user_updated_lang_lemma`
  se crearon así (`SHOW INDEXES` los muestra con las columnas de la PK añadidas,
  que es justo el efecto buscado).
- **Sourcemaps de producción**: `vite.config.ts` compila con `sourcemap: "hidden"` y
  `sourcemapVault()` mueve los `.map` fuera de `dist/` a
  `artifacts/sourcemaps/<build-id>/` con índice en `artifacts/sourcemaps/index.json`
  (retiene 20 builds; `artifacts/` es gitignored). Sin eso, `@cloudflare/vite-plugin`
  los publicaría en `/assets/*.map` con el fuente descargable. Para leer un frame
  guardado en `lecta_error_signatures` (llegan como `index-CMW2Mu5g.js:2:2667`):
  `pnpm symbols "<frame>"`, o `pnpm symbols --db [--days 7] [--json]` para la tabla
  entera resuelta. Usa `@jridgewell/trace-mapping` (devDependency, 0 kB de bundle) y
  solo lee: nunca escribe. Detalle en `docs/observabilidad-errores.md` §6.
- `pnpm model:upload` sube el modelo de Kitten TTS a R2
  (`models/kitten-tts-nano-0.8-int8-v1.onnx`; el nombre lleva versión porque la
  ruta se sirve con `Cache-Control: immutable` durante un año).
  Requiere credenciales de escritura de R2 (`wrangler login` o `CLOUDFLARE_API_TOKEN`).
  `pnpm model:upload --verify` exige `MODEL_SHA256` y aborta si falta o no coincide;
  sin `--verify` avisa y sube igual. Origen: `KittenML/kitten-tts-nano-0.8-int8`
  (`kitten_tts_nano_v0_8.onnx`, 24 369 971 bytes,
  SHA-256 `f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc`).
- `node scripts/check-model.mjs --url https://lecta.luis-sg9915.workers.dev`
  verifica desde fuera que `/models/…` responde 200 con el tamaño, `ETag` y caché
  inmutable. No necesita credenciales; úsalo tras subir el modelo o cambiar la ruta.
- La configuración del modelo (URL, hash, nombre de caché) vive en
  `src/client/lib/kittenModel.ts`, compartida por el motor, el worker de inferencia
  y el service worker. **El cliente verifica el SHA-256 antes de cachear** y guarda
  el sello en la respuesta (`x-model-sha256`); `isModelDownloaded` compara el sello,
  no recalcula 24 MB en cada arranque. No hay fallbacks a Hugging Face: si R2 no
  sirve el binario, la voz HD falla y hay que arreglar el despliegue.
  Subir un modelo nuevo = cambiar versión en URL y caché (`lecta-kitten-tts-vN`).

## Posición del lector

- La posición vive en el **scroll del documento** (`src/client/styles/reader.css`), no en una caja
  interna: `scrollRatioNow()` divide `window.scrollY` entre `scrollHeight - innerHeight`.
- `SavedBookPosition` (`src/client/lib/idb.ts`) guarda `sectionIndex`, `ratio`, `progress`, `anchor`
  (texto del primer bloque visible) y **`anchorOffset`**: la fracción 0–1 del bloque ancla que quedó
  por encima de la ventana. El texto del ancla no distingue «empezando el párrafo» de «229 px dentro»;
  la fracción sí, y sobrevive a cambios de letra o de ancho.
- `viewTopAnchor()` / `scrollToAnchor(container, anchor, { offset })` (`src/client/lib/reading-location.ts`)
  son la pareja capturar/restaurar. El `anchorOffset` viaja en `ReaderNavRestore`, en las decisiones de
  `resolveEntryTarget` (`src/client/lib/book-start.ts`), en los puntos de retorno (notas, enlaces internos)
  y en el `resumeRequest` de `App.tsx`.
- `keepAnchorStable()` vigila el bloque ancla 2,5 s (400 ms de corrección por cuadro y luego sólo cuando
  cambia `scrollHeight`): el contenido refluye al asentar fuentes, imágenes y resaltados, y sin ese
  corrector el punto se iba una pantalla atrás. Se aparta en cuanto el lector toca (`wheel`, `pointerdown`,
  `touchstart`, `keydown`).
- **Guardar al salir es un solo camino.** `closeReader` (`src/client/App.tsx`) pide al lector su última
  posición (`positionFlushRef`) y **espera** ese guardado antes de desmontar y de llamar `syncPositions()`.
  El callback que deja «atrás» en el historial (`openBook` → `pushOverlay`) también llama `closeReader`:
  antes sólo hacía `setBook(null)`, así que el gesto de retroceso salía sin guardar y sin subir la posición
  a la cuenta, y el pull de la siguiente apertura devolvía una fila vieja. La flecha interna (`handleBack`)
  ya guardaba.
- **Qué NO medir al cerrar.** Cuando el libro sale de la pantalla el documento queda con el alto de la
  estantería y `window.scrollY` cae a 0: una medición nueva en ese instante guarda «principio del capítulo»
  encima del punto leído. `useReaderPersistence` expone `saveLatest()` (la última posición capturada en la
  ref, sin volver a medir) y el cierre usa esa; `closedRef` corta el guardado perezoso pendiente y el del
  desmontaje, que si no escupía el tope del capítulo después del cierre.
- **La limpieza de desmontaje del hook tiene que depender sólo de `bookHash`.** Con las funciones del lector
  en el array (cambian de identidad en cada render) el efecto se reprogramaba en cada render y escribía en
  IndexedDB cientos de veces por segundo (medido en el arnés: 9 081 escrituras en una apertura). Las
  funciones se guardan en refs (`saveLatestRef`, `closeActivityRef`).
- **El servidor ya guarda `anchorOffset`**: la migración `019_positions_anchor_offset.sql`
  (aplicada en `lecta_dev` y `lecta` el 2026-10-29) añadió la columna `anchor_offset FLOAT8` a
  `lecta_user_positions` y `/api/positions` la persiste y la devuelve, así que la fracción
  intra-párrafo viaja entre dispositivos. Al mezclar el pull (`src/client/lib/positions-sync.ts`)
  se conserva el `anchorOffset` local si la fila remota apunta al mismo `anchor`; un `anchor`
  distinto gana (viene de otro dispositivo). Filas escritas por clientes viejos llegan con
  `anchor_offset` nulo → `undefined` en el JSON.

## Ficha de palabra (WordPanel)

- **Dos variantes de `/api/ai/explain-in-passage`.** El servidor elige el prompt
  *compacto* (sólo matiz, ≤80 tokens) únicamente cuando llega `localDefinition`;
  sin ella usa el prompt completo, que devuelve `directMeaning` además del matiz.
  La clave de caché del worker lleva la variante (`c:`/`f:` + lema + pasaje
  normalizado): una respuesta compacta nunca se sirve a una petición completa.
- **El significado va primero y la explicación sólo al tocar.** Al abrir, el
  panel sólo consulta el diccionario; si no hay definición y hay sesión + IA,
  una sola llamada (variante completa) cubre el Significado (`directMeaning ||
  inPassageMeaning`) y deja la respuesta lista para «En esta frase» — tocar el
  botón no gasta una segunda consulta. El botón es «¿Qué significa aquí?».
- **Nunca se pinta el mismo texto dos veces**: si `inPassageMeaning` normalizado
  coincide con el significado mostrado, la frase sólo muestra `Tono: …` (el tono
  «Literario» de relleno del servidor se omite, igual que el `catTip` genérico
  «Fíjate en cómo resuena…», que ya no se pinta en el panel — sigue en
  «Preguntar»).
- **El cuaderno guarda el significado mostrado** (diccionario o IA), jamás el
  matiz de la frase. La caché de sesión de explicaciones lleva versión
  `passage_meaning:v2:<variante>:`; las entradas `v1` se ignoran solas (es
  caché efímera, no hace falta migración).
- **`canExplain` = hay sesión** y la preferencia «Usar IA» (`useAi`) se respetan:
  sin sesión no hay consultas automáticas y el panel muestra el aviso de
  iniciar sesión en vez de un botón que siempre fallaría con 401.

## Diccionario local descargable (dict-*)

- **Un paquete por idioma** (`public/dict/dict-<lang>-v1.bin`, TSV+gzip):
  `es` 4.8 MB (126 905 lemas · 336 248 formas), `en` 501 KB (15 233 lemas ·
  49 155 formas con glosas en español — el Wikcionario en español documenta
  palabras inglesas). Los genera `scripts/lexicon-pack.mjs --lang=es|en` desde
  el catálogo de `lecta_dev`; regenerar = subir la versión en la URL y pegar
  el SHA-256 nuevo en `DICTIONARY_PACKS` (`src/client/lib/dictionaryPack.ts`).
- **El orden de acepciones refleja al servidor**: fichas por `freq_rank NULLS
  LAST` y luego cantidad de acepciones («casa» abre sustantivo, «ser» verbo).
  Acepciones: Wikcionario si la ficha tiene; si no, la semilla propia
  (`source IS NULL`); las de IA nunca se empaquetan.
- **Instalación silenciosa al abrir un libro es/en** (`Reader.tsx`,
  `requestIdleCallback`): descarga → verifica bytes + SHA-256 → parseo en
  streaming → IndexedDB `lecta-dict-<lang>` (una base por idioma para que la
  reinstalación solo purgue al suyo). La meta `pack` se escribe al final; un
  fallo reintenta en la próxima apertura. `lookupDictionaryPack` entra en
  `lookupWordRaw` tras cuaderno/memoria y antes del banco de calibración y
  la red — `offline: true` y sin gastar la cuota de IA.
- **La extensión `.bin` es a propósito**: con `.gz` vite dev sirve
  `Content-Encoding: gzip` y el fetch llega descomprimido, rompiendo el hash.
  Y viven en `/dict/`, no `/lexicon/`, porque en `_headers` de Cloudflare las
  reglas que coinciden se concatenan (se medía un Cache-Control doble).
- **Catálogo inglés en el servidor**: `lexicon-wiktionary.mjs --lang=en` con
  el dump `data/lexicon/en-wiktionary.jsonl.gz` (sección «Inglés» de kaikki
  eswiktionary). Cargado en `lecta_dev` y en `lecta` el 2026-11-03 (19 011
  fichas, 32 317 acepciones, 65 832 formas; fuente `kaikki-eswiktionary-en`).
  `LEXICON_CATALOG_REV` quedó `es:1, en:2` — los manifiestos `bookVocab:v1:`
  con otra rev se re-analizan solos.

## Portal Kindle (/k)

Portal server-rendered para e-ink (`src/worker/kindle/`): HTML+CSS inline,
JS mínimo ES5 con mejora progresiva — todo funciona solo con enlaces y
formularios. Código: `routes.ts` (rutas), `views.ts` (HTML), `epub-reader.ts`
(zip/EPUB/sanitizar/paginar), `cache.ts` (caché), `timing.ts` (Server-Timing).

- **Caché de capítulos y recursos en R2** (`cache.ts`): claves
  `kcache/ch/{hash}/{sección}.json` (versión `v` dentro del JSON,
  `KINDLE_CHAPTER_CACHE_V`) y `kcache/res/{hash}/{ruta}`. Escrituras
  **best-effort** (`waitUntil`): un fallo de caché nunca rompe la lectura.
  Hay segunda capa en memoria del isolate (TTL 30 min, máx. 24 capítulos,
  solo artefactos de texto — jamás conexiones `pg` ni objetos de request).
  **Al cambiar sanitize, paginación o estructura del artefacto (p. ej. TOC),
  subir `KINDLE_CHAPTER_CACHE_V`**: las entradas viejas leen miss y se
  reescriben solas, sin purga manual. `purgeKindleBookCache(bucket, hash)`
  borra ambos prefijos; se llama al eliminar el libro y en el reset de cuenta.
- **Preferencias por cuenta**: tabla `lecta_kindle_prefs` (migración 020,
  una fila por usuario). Fuente única del vocabulario: `src/shared/kindle-prefs.ts`
  (valores, `KindlePrefs`, `normalizeKindlePrefs`, `KINDLE_PREF_LABELS`,
  `KINDLE_PREF_FIELDS`) — la usan el worker, `/k/ajustes`, la API y el panel
  del celular. **Precedencia en `/k/read`: parámetro explícito > fila de la
  cuenta > cookie del dispositivo > default**; sin fila guardada la cookie
  mantiene su efecto. El código tolera que la tabla no exista: lectura cae a
  defaults y escritura responde 503 amable (permite desplegar antes de migrar).
- **Rutas**: `/k` (estantería; sin sesión redirige a `/kindle` con el código
  directo), `/kindle` (vinculación por código de 4 letras), `/k/login`,
  `/k/read/{hash}` (`?section`,`?page`,`?mode`,`?size`,`?margin`,`?layout`,
  `?toc=1` índice real, `?prep=1` antesala Rasch/ZPD), `/k/read/{hash}/resource`,
  `/k/lookup`, `/k/vocab/add`, `/k/knowledge/mark`, `/k/practice`,
  `/k/ajustes` (form sin JS), `/k/preview` (marco) + `/k/preview/page`
  (página real del lector, overrides `font,size,lh,margin,align,mode,layout`).
  API JSON: `GET/PUT /api/kindle/prefs`, `GET /api/kindle/status?code=`,
  `POST /api/kindle/link`.
- **Viewport real**: el lector escribe la cookie `lecta_k_vp` con
  `innerWidth×innerHeight` una sola vez (ES5). Se valida con formato estricto
  `\d{2,5}x\d{2,5}` dentro de 240–4096 y `paginateChapter` escala
  presupuestos por área (tope 0.7–1.6) y caracteres/línea por ancho
  (0.8–1.35). Sin cookie → presupuesto de referencia 600×800.
- **Medición**: `Server-Timing` por etapa en `/k/read` (`db`, `r2`, `parse`,
  `render`). `pnpm bench:kindle` mide el pipeline CPU sobre un EPUB sintético
  o `--epub <ruta>` (base medida: ≤5 ms; el coste real es red R2+DB).
  `pnpm calibrate:kindle` corre un arnés Playwright que renderiza las páginas
  con el HTML+CSS reales en Chromium a 600×800 / 758×1024 / 1072×1448 y
  reporta % de páginas desbordadas, llenado mediano y escala sugerida;
  opciones `--epub`, `--sections`, `--sizes`, `--vp`. Presupuestos
  calibrados en `KINDLE_PAGE_BUDGETS`/`KINDLE_CHARS_PER_LINE`
  (`epub-reader.ts`): `sm`1060/`md`830/`lg`625/`xl`460/`xxl`395.
- **Fuentes auto-hospedadas**: `public/fonts/*.woff2` (Literata, Source
  Serif 4, Atkinson, OpenDyslexic), servidas como assets estáticos;
  `@font-face` vive en `KINDLE_CSS` (`views.ts`) con `unicode-range` y
  `font-display: swap`. Cambiar una familia = archivo nuevo + declaración;
  nunca CDN.
- **Panel del celular**: `KindleAppearancePanel` (Cuenta → «Tu Kindle»)
  carga/guarda vía `/api/kindle/prefs` y embebe `/k/preview/page` en un
  iframe `sandbox` con debounce — la vista previa es el render real, no una
  réplica. La navegación DENTRO del marco funciona: los enlaces `/k/read/…`
  se reescriben a `/k/preview/page?book=…` conservando los overrides (los
  de salida `/k`, `/k/ajustes` abren pestaña real con `target="_blank"`).
  **CSP**: todo el portal `/k*` envía `frame-ancestors 'self'`
  (`kindleHtmlCspFor`) porque el iframe navega entre sus páginas; el resto
  del HTML del worker conserva `'none'`. La app madre permite
  `frame-src 'self'` por `default-src`.
- **Reanudación y enlaces**: la estantería y «Seguir leyendo» nunca fijan
  `page=` al reanudar — el lector restaura por `anchor`/`ratio`. Los enlaces
  internos del EPUB (`notas.xhtml#f7`) se reescriben a
  `/k/read/{hash}?section=N#f7` (aterrizan en la página 0 de la sección:
  el fragmento exacto es mejora pendiente). TOC real desde nav EPUB3 y NCX.
- **Actividad del Kindle**: cada paso de página inserta un evento puntual
  veraz en `lecta_user_activity` (`started_at = ended_at`, 0 minutos) —
  la bitácora es append-only por `id` y los intervalos fabricados serían
  descartados por el merge.
- **Migración 020 pendiente en producción** (`lecta`): orden seguro =
  deploy primero (el código tolera la tabla ausente), luego
  `LECTA_MIGRATE_TARGET=lecta pnpm db:migrate`, y verificar `/k`,
  `/k/ajustes`, `/k/preview` y `GET/PUT /api/kindle/prefs`. Requiere
  autorización expresa de Luis.

## MCP

- `mcp/` es un servidor MCP local (stdio, solo lectura) que proxya la API HTTP
  de Lecta. `pnpm mcp:build` compila y `pnpm mcp:typecheck` verifica tipos.
  Detalle y configuración de clientes en `mcp/README.md`.
- `pnpm test` incluye las pruebas de `mcp/src` (configuración, cookies y
  manejo de errores HTTP). `mcp/dist/` es artefacto y está ignorado.
- `opencode.json` lo registra como servidor `lecta` y lo recompila al arrancar.
  Credenciales solo por entorno: `LECTA_EMAIL` + `LECTA_PASSWORD` o
  `LECTA_COOKIE`; `LECTA_BASE_URL` para apuntar a dev. Sin credenciales
  funcionan las herramientas públicas.
- El MCP no se conecta a la base ni escribe: si se agregan herramientas de
  escritura, deben pasar por la API y respetar la sincronización por sello de
  `updatedAt` (nada de SQL directo).

## Producción

- URL: **`https://lectal.app`** (Custom Domain del Worker en `wrangler.jsonc`) — deploy con `pnpm run deploy`.
  `https://lecta.luis-sg9915.workers.dev` sigue activo (`workers_dev: true`) pero sus **páginas** responden
  301 a `lectal.app` (`src/worker/canonical-host.ts`); `/api/*`, archivos con extensión (`/sw.js`,
  `/assets/*`…), `/__lecta_shell__` y todo lo que no sea GET/HEAD se atienden ahí mismo: el webhook de
  Stripe está registrado en workers.dev y el SW viejo tiene que poder actualizarse. Por eso
  `run_worker_first` es `"/*"` con negativos para los directorios estáticos y el Worker devuelve a
  `env.ASSETS` lo que no es ruta suya (`isWorkerRoute`). El SW navega con `redirect: "manual"`: con
  `"follow"` el 301 a otro origen fallaba y servía la copia cacheada. IndexedDB, cookies y SW son por
  origen: al pasar a `lectal.app` cada usuario vuelve a iniciar sesión y lo no sincronizado se queda en
  workers.dev. Scripts y MCP (`DEFAULT_BASE_URL`) siguen en workers.dev: la API no se redirige.
- Último deploy: **2026-11-15** (séptimo del día), versión `0ddbfcbd-1dbc-473d-acb9-74571b772f48`, Lecta **v0.2.16** (commits `5356475`–`ecaba0c`): plan de pulido UX completo — portadas Gutenberg bajo demanda con R2 (`/api/catalog/pg-<n>/cover`), un solo buscador en «Libros gratuitos» con vista previa y «Abrir», pósters de pantalla cacheados en R2 (`screen/posters/<imdbId>.jpg`), rediseño de «Series y películas» (tarjetas, `ScreenPrepareSheet`, «Otro episodio», «Quitar» con confirmación, `imdbId` persistido) y **rieles de descubrimiento Trakt + respaldo curado** (`/api/screen/discover`, `/api/screen/related`, `screen-discover/v1/*` en R2). **Fix incluido**: OMDb devuelve `Response:"True"` con mayúscula y el detalle de serie/episodios siempre daba 404 (`omdbOk()`). **Secret nuevo**: `TRACKT_API_KEY` (subido antes del deploy; sin él los rieles sirven la lista curada de 27 títulos verificados contra OMDb). Verificado antes: `pnpm gate` (269 archivos / 3833 pruebas, JS 210.41/215 kB). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-CK38eusc.js` (igual al build local), `/api/screen/discover` y `/api/screen/related` sin sesión → 401, `/api/catalog/search?q=pride` → 200 con títulos reales. **Pendiente**: revisión manual de los rieles y la hoja en `pnpm preview:local`/producción; riesgo de política Trakt (prohíbe promover piratería) queda bajo observación; licencia OMDb CC BY-NC ya aceptada por Luis para la prueba.
- Deploy anterior: **2026-11-15** (sexto del día), versión `fad49ab8-8dd9-4067-aafa-11349f47f29d`, Lecta **v0.2.16** (commits `44f1d3c` + `547612a`): plan «Catálogo Gutenberg ampliado y zona Series y películas» completo (G1–G3, P1–P5; detalle en la sección propia de este archivo). Rutas nuevas `/api/catalog/search` + EPUB `pg-` y `/api/screen/*` (OMDb+SubDL, guías en R2 `screen-guides/v1/`). **Secrets nuevos**: `OMDB_API_KEY`, `SUBDL_API_KEY` (subidos antes del deploy). **Migración 029 aplicada en `lecta`** (la tabla ya existía vacía con `schema_locked`; se desbloqueó, migró y re-bloqueó). Verificado antes: `pnpm gate` (268 archivos / 3788 pruebas, JS 210.10/215 kB). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-C5vFLFaH.js` (igual al build local), `/sw.js` → 200, `/api/screen/search` y `/api/screen/poster` sin sesión → 401, `/api/catalog/search?q=dickens` → 200 `{"books":[]}` (tabla vacía: falta `--build`/`--load` cuando gutenberg.org reviva). **Pendiente**: gutenberg.org sigue 403 → índice en 0 filas; búsqueda lenta p50 ~926 ms (FULL SCAN, evaluar `search_tokens`); licencia OMDb CC BY-NC revisada por Luis y aceptada.
- Deploy anterior: **2026-11-15** (quinto del día), versión `c831885b-d948-4a9c-88bb-2cb7c4cd01de`, Lecta **v0.2.16** (commit `0dcaa9b`): «Probar con un clásico» sin cuenta (ver sección propia), apertura en el capítulo I con numerales entre guiones (`isLikelyChapterLabel`, «Capítulos»/«Chapters» como preliminares) y **fin del parpadeo bienvenida ↔ estantería sin sesión**: better-auth 1.7 pone `isPending: true` en cada refetch por foco cuando no hay sesión; `App` ahora trata «pendiente» solo hasta el primer veredicto (`sessionSettled`). Verificado antes: `pnpm gate` (3660 pruebas, JS 208.85/215 kB). En caliente: `/` → `assets/index-DJ5DQV2o.js`, `/api/health` → 200, `/api/catalog/alice-wonderland/epub` → 200; en Chromium sin sesión `?probar=alice-wonderland` abre en «Alice was beginning to get very tired…», al cerrar la bienvenida muestra «Crea tu cuenta gratis para seguir leyendo «Alice's…»» y se mantiene 14 s con eventos de foco forzados.
- Deploy anterior: **2026-11-15** (cuarto del día), versión `65fcabee-3722-470c-b3fe-3e55116e5d2d`, Lecta **v0.2.16** (commit `83cfe38`): bloque de confianza en la landing (nota del creador con texto aprobado por Luis, repaso con FSRS y privacidad alineada con `LegalNotice`; sin cifras de uso: 41 cuentas y 84 palabras al 2026-11-15). Solo cambió `/inicio/index.html`. En caliente: SHA-256 del `/inicio/` servido = build local, `/api/health` → 200.
- Deploy anterior: **2026-11-15** (tercero del día), versión `350f0b41-d25b-49de-8a3d-416483ee100b`, Lecta **v0.2.16** (commit `33e1e19`): franja «Tus libros, o más de 70 clásicos gratis» en la landing (estante tipográfico con títulos de `/api/catalog`, aviso de DRM, FAQ al día) y contraste AA de los lomos. Solo cambió `/inicio/index.html`. En caliente: el `/inicio/` servido tiene el mismo SHA-256 que el build local, `/api/health` → 200, workers.dev `/inicio/` → 301.
- Deploy anterior: **2026-11-15** (segundo del día), versión `69c1f22f-30c5-48fa-9e78-17d8b5a497dc`, Lecta **v0.2.16** (commit `2887f3d`): **`lectal.app` como dominio canónico** (Custom Domain creado por el deploy) y 301 de las páginas de workers.dev (ver «URL» arriba). Verificado antes: `pnpm test` (3653 pruebas), build y `wrangler deploy --dry-run`. En caliente: en `lectal.app` `/`, `/inicio/`, rutas SPA, `/sw.js`, assets y `/api/health` → 200 (con CSP y `no-store` en `/`), `/api/positions` → 401, `/k` → 302; en workers.dev `/`, `/inicio/` y `/reader/x?y=1` → 301 a `lectal.app` con ruta y query, `/sw.js`, assets y `/api/health` → 200, webhook de Stripe con firma falsa → 400 (sigue atendido ahí). Landing en Chromium sobre `lectal.app`: beacon a `/api/landing-events` escribió su fila en `lecta` (borrada). Único error de consola: la zona `lectal.app` inyecta el beacon de Cloudflare Web Analytics y la CSP lo bloquea.
- Deploy anterior: **2026-11-15**, versión `60d3aad5-c726-4c10-810a-69a37cf799fa`, Lecta **v0.2.16** (commit `9a7c99a`): landing con el dominio `lectal.app` en canonical/OG y CTAs relativos, quick wins de conversión (título, «Ver cómo funciona», Lecta+ sin «muy pronto») y el embudo `POST /api/landing-events` + `signup` en `starter-coat` (ver «Embudo de la landing»). Migración 028 aplicada en `lecta` después del deploy (un evento real de prueba escribió su fila y se borró). Verificado antes: typecheck, `pnpm test` (3646 pruebas), build y `check:size` (6.57 kB de margen); `pnpm lint` solo falla en `.agents/skills/` (sin seguimiento). En caliente: `/api/health` → 200, `/inicio/` con el título nuevo y `data-cta-id`, `landing.js` con `api/landing-events`, `POST /api/landing-events` → 204, `/api/positions` → 401. `lectal.app` aún no está conectado al Worker.
- Deploy anterior: **2026-11-14** (quinto del día), versión `cb56ae47-df5e-40b2-9acd-c5daf7dced29`, Lecta **v0.2.16** (commit `b2eed27`): el cierre del repaso (`ReviewDone`) ya no dice «Vuelve en ahora.»; `nextReviewNote` dice cuántas vencidas quedan (`reviewWords.length`), «La próxima vuelve en un momento.» por debajo de 1 min, el intervalo real o «Nada pendiente por ahora.». Prueba nueva `ReviewDone.test.ts`. Verificado antes: `pnpm gate` (3628 pruebas, JS 208.35/215 kB, CSS 23.15/55 kB). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-KzUDAIaN.js` (igual al build local), `/sw.js` → 200, `/api/positions` → 401, «vuelve en un momento» en el chunk de Vocabulary. Sin prueba con cuenta. Nota: `git push`/`fetch` fallaron con «Could not resolve host» dentro del sandbox aunque `curl` resolvía; fuera del sandbox funcionan.
- Deploy anterior: **2026-11-14** (cuarto del día), versión `8221fbd3-802d-4947-b824-ead089a3e70b`, Lecta **v0.2.16** (commit `7319728`, sobre `f035be2`: incluye el P1 de aprendizaje del tercero): arreglos hallados al probar el repaso del Cuaderno con una cuenta real en `vite preview` — la sesión empieza arriba (en móvil heredaba el desplazamiento de la portada y el gato quedaba bajo la barra sticky), el gato reinicia frase y racha al empezar cada sesión (`resetCat`/`setCombo(0)` en `Vocabulary.tsx`) y la ✕ de `.choice-option.is-wrong::after` va en posición absoluta (en flex heredaba el tachado). Verificado antes: `pnpm gate` (3624 pruebas, JS 208.35/215 kB, CSS 23.15/55 kB). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-BtUx5VXo.js` (igual al build local), `/sw.js` → 200, `/api/positions` → 401, `scrollTo({top:0})` en el chunk de Vocabulary y la ✕ absoluta en el CSS servido. Pendiente previo: `ReviewDone` dice «Vuelve en ahora.» cuando quedan vencidas. Para probar en local con cuenta: `LECTA_KEEP_DEV_VARS=1 pnpm exec vite build` y **reiniciar** `vite preview`; en el navegador del panel hubo que forzar `fetch(…, {cache:"reload"})` de los assets y desregistrar el SW porque había cacheado como `immutable` el HTML servido para los assets nuevos.
- Deploy anterior: **2026-11-14** (tercero del día), versión `b3ca2d4e-c693-4984-9044-b4922cf66f8c`, Lecta **v0.2.16** (commit `ed13672`, rama `fix/aprendizaje-p1` fusionada en `main` por fast-forward): P1 de la revisión Goldfish (§10 de `docs/estrategia-aprendizaje-2026-10-24.md`). Reto de cierre solo con reencuentros y filas de la hoja mostradas; `consolidateEpisodicWord` no revive lápidas, resuelve por lema y no da de alta palabras solo preparadas ni declaradas; reconsultar una palabra con `reps > 0` = Again sin XP una vez al día (`recordLookupLapse`); modal de cierre con «palabras leídas» reales (sin cobertura ni «asimiladas»); taller IA = Good solo si tocaba; atajos de la ficha sin modificadores y «Ya la sé» no actúa sobre guardadas; la hoja usa las señales de θ de la ficha (fuera `updateLanguageTheta`); `bookFrequenciesOf` en la preparación (lector y papel); Kindle: acierto con opciones = `hard`, `request_retention` 0,9; fuera código sin consumidor; sonda `senales-aprendizaje` en `audit-investigacion`. Sin migraciones ni secrets. Verificado antes: `pnpm gate` (3623 pruebas, JS 208.35/215 kB) + `audit:cuaderno` (solo C12 PARCIAL, previo). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-BSAP_wkX.js` (igual al build local), `/sw.js` → 200, `/api/positions` → 401, `/k` → 302, «Palabras leídas» y «Repaso del capítulo hecho» en `assets/Reader-Crj9k3Ug.js`. Pendiente: reencuentro sin consulta (requiere `ReviewKind` nuevo en el contrato de sync). Sin prueba en la app real con cuenta.
- Deploy anterior: **2026-11-14** (segundo del día), versión `6ab4a7fa-21de-4f42-b2b8-242db354aa54`, Lecta **v0.2.16** (commit `8224489`, rama `fix/aprendizaje-senales-p0` fusionada en `main` por fast-forward): P0 de la revisión Goldfish de la estrategia de aprendizaje (`docs/revision-egm/2026-11-14-estrategia/`, §10 de `docs/estrategia-aprendizaje-2026-10-24.md`). Reto de cierre y micro-cloze califican por `errorCount`/`usedHint` (`episodicRating`: error o pista = Again, primer intento = Hard; palabra nueva solo se codifica y vence mañana; no vencida acertada no se adelanta); fallo en minijuego del Cuaderno = Again también tras el rescate (`missedRef`); exposición pasiva por página leída y solo al avanzar, como métrica (`recordPassiveExposure` no crea filas ni cambia estado, sin θ; «familiar» ya no cuenta como conocida ni aprendida); señal de consulta con idioma del libro, zipf medido (`zipfForForm`) y una por palabra al día; frecuencia del capítulo por tokens (`countFormTokens`; `bookFrequencies` sigue pendiente); `hard` cuenta como acierto en cliente, `admin-insights` y SQL de admin. Sin migraciones ni secrets. Verificado antes: `pnpm gate` (3627 pruebas, JS 208.30/215 kB, CSS 23.15/55 kB). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-BaAl-Zoj.js` (igual al build local), `/sw.js` → 200, `/api/positions` → 401, `zipfFor` en `assets/Reader-ClZsjgne.js` y la regla `hard,good,easy,correct` en el `index-` servido. Sin prueba en la app real con cuenta.
- Deploy anterior: **2026-11-14**, versión `47e3b0c8-dd5b-492c-ab35-64fe1a849ea2`, Lecta **v0.2.16** (commit `59e3063`, en `main`): repaso del Cuaderno según `docs/designs/2026-11-13-cuaderno-repaso.md` (revisión Goldfish en `docs/revision-egm/2026-11-13-cuaderno/`). «Terminar por hoy» en la cabecera (sticky con `data-session`, califica la respuesta pendiente vía `exitSession`; en ≥64rem el riel lateral ya no se oculta en sesión); corrección en `.nb-answer-foot` (único `role="status"`) bajo las opciones, foco con `preventScroll` y `.nb-continue` sticky; opciones respondidas sin la opacidad de `button:disabled`, wash sobre `--paper-raised` y prueba de contraste en `tokens.test.ts`; gato de 72 px con `data-reacting`, `resultPose`/`resetCat` en `usePracticeCompanion`, una pista de IA por reto (`hintUsed`) y `catTap`; la racha ya no se suma dos veces (`grade` solo reacciona en autocalificación y «Escribir»); teclas 1–9 en `choose`/`sense`/`context` (`.nb-keys-hint--kbd`). Sin migraciones ni secrets. Verificado antes: `pnpm gate` (3621 pruebas, JS 208.19/215 kB, CSS 23.15/55 kB) + `pnpm audit:cuaderno` (C12 sigue PARCIAL, previo). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-BooBi6Wd.js` (igual al build local), `/sw.js` → 200, `/api/positions` → 401, `0.2.16` en `assets/DiagnosticsModal-DyzsDqz6.js`, `nb-answer-foot`/`nb-continue`/`lecta-pop` en el CSS servido. Sin prueba en la app real con cuenta (solo maqueta con el CSS compilado a 1440×800 y 390×750). Nota: `pnpm gate` no corre las afirmaciones de `audit-cuaderno`; correr `pnpm audit:cuaderno` aparte.
- Deploy anterior: **2026-11-13**, versión `07d1e741-e7b0-403c-a9dc-402f9273bf21`, Lecta **v0.2.15** (commit `5407cc1`, rama `feat/bloque3-hojas` fusionada en `main` por fast-forward): cierre del diseño `docs/designs/2026-11-12-planes-y-landing.md`. Bloque 3.4–3.7: repisas con filete y gato sobre el filete (shelf.css), doble filete en `.sheet` y microbrote `data-sprout` al guardar (components.css + WordPanel), «Tu Kindle» en pizarra noche con tokens reasignados y `--eink-*` (app.css), sol bermellón del bibliotecario en Journey y side-tabs a filetes de 1 px (game.css); las seis hojas sin hex, prendas del gato en tokens `--wear-*`/`--prop-*`. Bloque 4: título de la barra del lector por `bookDisplayName` (`readerTopBarTitle`) y fuera las ramas D1 / `BOOKS_BUCKET` / `MODELS_BUCKET` del worker (el grep del diseño da 0). Sin secrets nuevos. **La 027 se aplicó en `lecta` después de este deploy** (2026-11-14, ver «Planes Gratis / Lecta+»): el muro de pago queda activo para las cuentas posteriores al corte. Verificado antes: `pnpm gate` (3605 pruebas, JS 208.19/215 kB, CSS 23.14/55 kB) + `pnpm vitest run --coverage` (79.88 % líneas). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-CVrSMIAa.js` (igual al build local), `/sw.js` → 200, `/api/positions` y `/api/account/state` → 401, `/k` → 302, `/kindle` → 200, webhook con firma falsa → 400, `word-sprout`/`3px double`/`--eink-paper` en `assets/index-Dk9hHSQa.css`, `journey-sanctuary-sun` en `assets/game-CylRhx1Z.css` → 200.
- Deploy anterior: **2026-11-12**, versión `f35c8a68-c187-4af6-821a-bec6dcb337b6`, Lecta **v0.2.15** (commit `9062c11`, rama `feat/planes-lecta-plus` fusionada en `main` por fast-forward): planes Bloques 1–2 (cuenta obligatoria, puente `?gato=`, `lecta_user_plan`, Stripe sin SDK, gating Lecta+, Carné de Lector) y Bloque 3.1–3.3 (tokens de pizarra/superficies, notebook.css y reader.css sin hex). Secrets nuevos subidos por Luis antes del deploy: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY_ID`, `STRIPE_PRICE_YEARLY_ID` (Lecta+ $59 MXN/mes y $499 MXN/año, recurrentes; webhook a `/api/billing/webhook` con los 4 eventos de `HANDLED`; sin Stripe Tax). **Migración 027 NO aplicada en `lecta`**: con la tabla ausente `getUserPlan` cae a `founder_lifetime` (degradado), así que nadie ve el muro de pago hasta migrar (después del corte 2026-11-13T00:00Z y con autorización). Verificado antes: `pnpm gate` (3603 pruebas, JS 208.21/215 kB, CSS 23.25/55 kB). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-BPshJFQ4.js` (igual al build local), `/sw.js` → 200, `/api/positions` y `/api/account/state` → 401, `POST /api/billing/checkout` sin sesión → 401, `POST /api/billing/webhook` con firma falsa → 400 «Firma no válida».
- Deploy anterior: **2026-11-11** (cuarto del día), versión `3c1b2d11-fc76-4b48-b89b-f35a22ef8e9f`, Lecta **v0.2.15** (commit `8f0a4fa`): sin la barra «Copiar / Seleccionar todo» de Android al seleccionar. No hay API web para ocultarla conservando los tiradores nativos (probado por adb: reaplicar la selección por código quita barra y tiradores), así que en táctil el lector reaplica la selección nativa una vez por rango y `ReaderSelectionBar` pinta tiradores propios (`.selection-handle`, gotas bermellón con zona de 44 px que ajustan el extremo a límites de palabra) y suma «Copiar» al mini menú. Los listeners de scroll en captura (barra y `ReaderContent`) ignoran el scroll de la propia fila del menú, que antes lo cerraba al deslizarla. Verificado antes: `pnpm gate` (3459 pruebas, 201.97/215 kB) + e2e Chromium 13/13 + flujo real por adb (menú sin barra del sistema, arrastre de ambos tiradores, «Copiar»). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-CGMqVVYQ.js` (igual al build local), `/sw.js` → 200, `/api/positions` → 401, `selection-handle` y `selection-copy` en `assets/Reader-O-vojrX1.js`.
- Deploy anterior: **2026-11-11** (tercero del día), versión `f14ba15c-4359-4878-9d0c-36abe5040cc8`, Lecta **v0.2.15** (commit `1948335`): en táctil la presión larga ya no abre la ficha: selecciona la palabra (la selección nativa del sistema si llega en 300 ms, si no por código) y abre un mini menú con «Significado» primero + Tinta/tonos/Reflexión/Postal/Preguntar; ampliar con los tiradores pasa a modo pasaje. Se quitó el `preventDefault` de `onContextMenu`, que en Android suprimía la selección nativa y sus tiradores (probado por adb en el móvil de Luis, Brave/Chrome 157). El menú táctil baja 44 px bajo la selección, va en una fila deslizable y los puntos de tono ya no heredan `min-height`/fondo de `.selection-menu button`. Verificado antes: `pnpm gate` (3459 pruebas, 201.98/215 kB) + e2e Chromium 13/13 + flujo real por adb (presión → menú, arrastre de tirador → pasaje, Significado → ficha, Tinta → subrayado). En caliente: `/api/health` → 200 `db:connected`, `/` → `assets/index-BU4nl_Qv.js` (igual al build local), `/sw.js` → 200, `/api/positions` → 401, `selection-define` en `assets/Reader-Cc2rwi-V.js`. Para probar en Android por adb: `adb forward tcp:9222 localabstract:chrome_devtools_remote` + `chromium.connectOverCDP`, `adb reverse tcp:5188 tcp:5188` para el preview local y `adb exec-out screencap` (las capturas por CDP no dibujan los tiradores nativos). Ojo: tras un rebuild hay que reiniciar `vite preview` (si no, sirve HTML para los assets nuevos y el navegador los cachea como `immutable`).
- Deploy anterior: **2026-11-11** (segundo del día), versión `c82a7984-ebd7-4b82-8803-b4f2e1988817`, Lecta **v0.2.15** (commit `e1bbe97`): flaquezas de lectura (`docs/plan-lectura-flaquezas.md`). Conectores («sin embargo») sin subrayado; repaso de capítulo con enunciado que no nombra la respuesta y opciones de palabras reales del cuaderno (`lib/episodic-cloze.ts`, sin variantes por sufijo, sin formas del mismo lema ni nombres propios; sin opciones → ordenar letras); en táctil la presión larga deja viva la selección nativa y extenderla cierra la ficha y abre la barra de pasajes (`classifySelection` en `tap-intent-guard.ts`); Tinta desde la ficha subraya la oración (`sentenceRangeForHit`); `foldContainer` separa solo entre bloques; acciones de pasaje siempre visibles en la ficha. Sin migraciones. Verificado antes: `pnpm gate` (3454 pruebas, 201.98/215 kB) + e2e Chromium 13/13 (nuevo `e2e/reader-quote.spec.ts`). En caliente: `/api/health` → 200 `db:connected`, `/` → 200 sirviendo `assets/index-CnorN3nh.js` (igual al build local), `/sw.js` → 200, `/api/positions` sin sesión → 401, `close-card-then-bar` y «Acciones de pasaje» en `assets/Reader-BtULbUAn.js`, CSS sin `data-connector`. Pendiente: verificar en Android real que los tiradores nativos se pueden arrastrar (`onContextMenu` con `preventDefault`). Sin `smoke:auth`/`smoke:sync`: no toca auth ni el contrato de sync.
- Deploy anterior: **2026-11-11**, versión `a3c4d7ee-4890-4860-a2d4-ec210860dc96`, Lecta **v0.2.15**, commit `98d160b` (ya en `main`): landing de marketing en **`/inicio/`**. `landingPage()` (`vite.config.ts`) copia `marketing/landing/` (HTML, `landing.js`, fuentes, imágenes web) a `dist/client/inicio/`; no entra al bundle ni al precaché, y `public/sw.js` deja pasar `/inicio` a la red. El JS va en archivo aparte porque la CSP (`script-src 'self'`) bloquea scripts en línea. Sin cambios en la app ni migraciones. Verificado antes: `pnpm typecheck` + `pnpm lint` (0 warnings) + `pnpm test` (3417 pruebas) + build + `check:size`. En caliente: `/api/health` → 200 `db:connected`, `/` → 200, `/inicio` → 307 a `/inicio/` → 200, `landing.js`, fuentes e imágenes → 200, `/sw.js` con la exclusión; Chromium a 1280 y 390 px contra producción con la CSP real: 0 errores, ficha + guardar + elegir gato funcionan y los botones llevan `?gato=<pelaje>`. La página promete cosas que la app aún no hace (ver «Pendiente en la app» en `PRODUCT.md`).
- Deploy anterior: **2026-11-10** (segundo del día), versión `1a033619-08b6-4bdf-b178-885c8bfc1564`, Lecta **v0.2.15**: retiro total de la cápsula de palabra (`.word-capsule`): la pulsación larga, el toque y los modos de estrategia abren siempre la Tarjeta Única. Fuera `compactMode`, `capsuleHost`, `longPressSelection`, `.reader-floating-capsule-slot`, ~212 líneas de CSS, `syllables.ts` y las 5 pruebas de la cápsula; ancla `H4-jol` reajustada. Verificado antes de subir: `pnpm typecheck` + `pnpm lint` (0 warnings) + `pnpm test` (3417 pruebas, 239 archivos) + arnés 14/14 en verde. En caliente: `/api/health` → 200 `db:connected`, `/` → 200 sirviendo `assets/index-B_XJuiFM.js`, `/sw.js` → 200.
- Deploy anterior: **2026-11-10**, versión `10c6a6ba-64ea-4644-abbc-3be54dcacb38`, Lecta **v0.2.15**: cuaderno fases 2–5 del plan v2 (`Vocabulary.tsx` partido, repasos vencidos primero, Reto del Escritor acredita FSRS una vez por palabra, taller IA a la vista), pack `dict-en-v5` con stubs y limpieza del catálogo, consejo diario local sin IA + aviso de retrocesos (`POST /api/lexicon/tip` eliminado, `src/shared/tip.ts` fuera), contraste del gato en OLED/noche y `prefers-reduced-motion` real, tokens fantasma retirados e `ink-faint` legible. Sin migraciones nuevas (la 026 ya estaba aplicada). Los deploys del 08→10 no quedaron registrados aquí. Verificado en caliente: `/api/health` → 200 `db:connected`, `/` → 200, `/api/lexicon/lookup?form=casa&lang=es` → acepción, `/dict/dict-en-v5.bin` → 200, `/sw.js` → 200. CI del commit: static/unit/build verdes; e2e rojo en CI por falta de postgres local en el job (ajeno al cambio, viene fallando desde el 07). Sin `smoke:auth`/`smoke:sync`: no toca auth ni el contrato de sync.
- Deploy anterior: **2026-11-07**, versión `7c3cc5cf-6c00-4e66-b4e6-be84606c9b78`, Lecta **v0.2.15**: mejoras de rendimiento (lazy calibration-bank, memoización de componentes hoja, caché TTL en findEntries y /api/lexicon/sample), DX (husky + lint-staged + prettier), accesibilidad (contraste, aria-label, axe en 4 vistas), bundle (margen recuperado a 15.4 kB), Hyperdrive aislado (auth uncached + catalog cached con 2 bindings), cobertura worker 75/72 + reset-guard tests. `pnpm gate` verde (3327 pruebas). Verificado en caliente: `/api/health` → 200, `/api/lexicon/lookup` (casa) → acepción, `/` → 200.
- Deploy anterior: **2026-11-03** (segundo del día), versión
  `990381ad-f87b-43df-8bfb-0ae762979aed`, Lecta **v0.2.15**: diccionario local
  descargable es/en + catálogo inglés cargado en `lecta` (detalle en
  §«Diccionario local descargable»). Al abrir un libro el paquete de su
  idioma se instala solo en segundo plano; `school` resuelve
  «Escuela, instituto, colegio.» sin red ni IA. `pnpm gate` completo en verde
  (3 294 pruebas, bundle 208.77/215 kB — 97.1%). En caliente:
  `/api/health` → 200, `/dict/dict-en-v1.bin` y `dict-es-v1.bin` → 200 con
  `Cache-Control: immutable` (regla única), SHA-256 del `.bin` descargado =
  el de `DICTIONARY_PACKS`, `school`/`schools`/`run` → acepciones en español
  por la API, `casa` → «Edificio donde vive una persona o familia.».
  Instalación real en Puppeteer contra dev: `en` ~3 s, `es` ~23 s en idle.
  Sin `smoke:auth`/`smoke:sync`: no toca auth ni el contrato de sync.
- Deploy anterior: **2026-11-03**, versión `cbc17829-30ee-4d52-bd3b-a025024ebd3b`,
  Lecta **v0.2.15**: ficha de palabra con significado primero y explicación
  al tocar (detalle en §«Ficha de palabra (WordPanel)»). Al abrir ya no se
  lanza la IA: se muestra el significado del diccionario con la frase del
  libro como cita y «¿Qué significa aquí?» revela el matiz; sin definición
  local una sola llamada (variante completa del endpoint, caché `f:`) trae
  el significado — jamás se persiste en el catálogo remoto. Dedupe de
  textos repetidos, tono en renglón propio, sin `catTip` ni rellenos en el
  panel, caché de sesión `passage_meaning:v2`. Sin migraciones nuevas (las
  24 ya estaban aplicadas en `lecta`). Verificado: `pnpm gate` completo en
  verde (3 287 pruebas, bundle 208.46/215 kB), `e2e/word-card` 5/5.
  En caliente: `/api/health` → 200, `/` → 200 sirviendo
  `assets/index-ZR-MV6AG.js`, `/api/positions` sin sesión → 401, `0.2.15`
  en `assets/DiagnosticsModal-BBkmSbDn.js`, `passage_meaning:v2` y
  «Qué significa aquí» en `assets/Reader-9ulDFyGZ.js`. Sin
  `smoke:auth`/`smoke:sync`: no toca auth ni el contrato de sync.
- Deploy anterior: **2026-11-01**, versión `a83cde26-aaa5-474e-a1b7-6ae7bc662cad`,
  Lecta **v0.2.15**: plan Kindle K0–K9 completo (detalle en §«Portal Kindle
  (/k)»). Nuevo: preferencias de lectura por cuenta (`lecta_kindle_prefs`,
  migración 020 aplicada a `lecta` el mismo día), `/k/ajustes`, 4 tipografías
  auto-hospedadas en `/fonts`, caché de capítulos/recursos en R2 (`kcache/`,
  versión 2), calibración por viewport real (`lecta_k_vp`), TOC nav/NCX con
  enlaces internos reescritos, portada `/k` con «Seguir leyendo» y repaso del
  día, `/k/preview` + `/k/preview/page` (vista previa real) y panel «Tu
  Kindle» en Cuenta. Verificado en caliente: `/api/health` 200, `/k`→302
  `/kindle` sin sesión, `/k/ajustes`→login, `/k/preview`→`/kindle`,
  `/k/preview/page`→401, `/api/kindle/prefs`→401 sin sesión,
  `/fonts/literata-400-latin.woff2` 200; migración 020 aplicada solo en
  `lecta` (única pendiente), `lecta_kindle_prefs` creada con 0 filas.
  `pnpm gate` completo en verde antes del deploy (3069 pruebas, bundle
  206.06/215 kB).
- Deploy anterior: **2026-10-31** (segundo del día), versión
  `f96bc958-e699-4068-8aa0-f286a0df4317`, Lecta **v0.2.15**: el service worker
  dejaba la app vieja tras un deploy por tres causas — la navegación abortaba
  el fetch a los 3500 ms y servía el `index.html` cacheado sin avisar en redes
  lentas; el install/activate pedía `/sw-manifest.json` y el SW viejo activo lo
  interceptaba sirviendo el manifiesto del deploy anterior (la versión del
  precaché quedaba atrás para siempre); y el `cache.addAll` de ~86 archivos
  abortaba todo el install ante un solo 404. Ahora la navegación sirve el
  caché a los 3,5 s SIN cortar el fetch y avisa `LECTA_NAV_STALE` cuando la
  copia fresca llega (el cliente recarga sólo en los primeros 45 s de sesión);
  `/sw-manifest.json` y `/manifest.webmanifest` van siempre a red; el manifiesto
  se pide con `?v=<ts>` para romper el match del SW viejo; y el precaché tolera
  fallos por archivo. Incluye además los cambios locales sin commit del árbol
  (App.tsx, sync-state, account-fetch, retirada de useWordInspector/dom-pipeline).
  Verificado: `pnpm test` 3 015 en verde, typecheck+lint+build limpios, arnés
  Node sobre el `sw.js` real 10/10 en navegación y 8/8 en install/activate.
  En caliente: `/api/health` → 200, `/` → 200 con etag nuevo y `no-store`,
  `sw.js` sirviendo `LECTA_NAV_STALE`/`manifestRequest` con
  `SW_VERSION = bfdff50ab2` = `sw-manifest.json`, HTML apuntando a
  `assets/index-CB48vEmC.js`. Sin `smoke:auth`/`smoke:sync`: no toca auth ni
  el contrato de sync.
- Deploy anterior: **2026-10-31**, versión
  `a2bb2686-b7b4-4738-8316-59da56efe83f`, Lecta **v0.2.15**: tarjeta de palabra
  legible y sin bucle de renders. `--text-primary` no existía en ningún CSS, así
  que `var(--text-primary, #f5f2eb)` caía al crema del tema noche sobre
  `--surface-elevated` blanco: la ficha se veía **vacía** en papel/blanco
  (1.12:1 medido). Ahora es indirección de `--ink` (`--text-secondary` de
  `--ink-soft`) y el CTA y los chips usan `--on-accent`: 16.81:1 en papel,
  13.28:1 en noche. `setReaderContext` del compañero ignora escrituras
  idénticas (`sameReaderContext`), que era el «Maximum update depth exceeded»
  a ~24 renders/s del lector (73 errores en 3 s en dev, 1 221 en prod).
  Cerrar la ficha con un toque libera también la capa de historial
  (`onCloseSelection`): antes `overlayReleaseRef` quedaba vivo y
  `selectionchange` ignoraba las selecciones siguientes hasta recargar. La
  selección de UNA palabra sustituye la ficha abierta (el guard de
  `overlayReleaseRef` solo suspende ya la barra de pasajes). Pruebas de
  regresión en `CompanionProvider.test.ts` y `tokens.test.ts`. `docs/plan-8-fases.md`
  §16 deja la **Fase 9 propuesta** (cabecera de la ficha, zona neutral con
  umbral en `extractWordAtPoint`, resalte y anclaje, acciones de pasaje dentro de
  la ficha, un solo camino de cierre, 64 tokens fantasma), sin ejecutar. Sin
  migraciones ni secrets nuevos. Verificado en caliente: `pnpm gate` en verde
  (3 004 pruebas, 205.60/215 kB gzip), `/api/health` → 200, `/` → 200 sirviendo
  `assets/index-BtVzGWYg.js`, `0.2.15` en `assets/DiagnosticsModal-DfM64b4G.js`,
  `/api/positions` sin sesión → 401, `/k` → 200, y una prueba en Chromium
  móvil (412×915) contra producción: 0 «Maximum update depth», ficha de
  «perenne» con `color rgb(31,29,26)` sobre `rgb(255,255,255)`, 7 errores de
  consola restantes (todos `Executing inline event handler violates … 'script-src
  'self' 'wasm-unsafe-eval''`, ajenos a este cambio; antes eran 1 221 mezclados
  con el bucle). `artifacts/ux-word-card/` guarda el antes y el después. Sin
  `smoke:auth`/`smoke:sync`: no toca auth ni el contrato de sync.
- Deploy anterior: **2026-10-30** (primero del día), versión
  `1734aa72-ef94-4353-9dad-768c61fde554`, Lecta **v0.2.14**: Tarjeta Única de
  Palabra sin píldora intermedia (el toque o la selección de 1 palabra abre
  directo `WordPanel` con ★ guardar en el cuaderno en 1 toque — antes el camino
  era píldora → «Ficha» → tarjeta y la píldora no tenía acción de guardado;
  guarda `overlayReleaseRef` en el `selectionchange` para que ningún menú se
  monte sobre una ficha u hoja abierta — cierra el caso de dos modales para la
  misma palabra; cada toque registra `word_consulted` como espera la
  consolidación episódica del Track 10; `ReaderSelectionBar` queda solo como
  barra de pasajes para selecciones de más de 1 palabra; CSS `.reader__word-pill*`
  retirado; ancla H4-jol del registro de auditoría actualizada a
  `Reader.tsx:4644`). Sin migraciones ni secrets nuevos. Verificado en caliente:
  `pnpm gate` en verde (3001 pruebas, 205.51/215 kB gzip), `/api/health` → 200,
  `/` → 200 sirviendo `assets/index-CJdUukn_.js`, `0.2.14` en
  `assets/DiagnosticsModal-DkuXhQHo.js`, `/api/positions` sin sesión → 401,
  `/k` → 200. Sin `smoke:auth`/`smoke:sync`: no toca auth ni endpoints de sync.
- Deploy anterior: **2026-10-29** (noveno del día), versión
  `77d3a5bd-e3e6-40ca-bb54-3f7db631daa3`, Lecta **v0.2.13**: Unificación Psicométrica
  Rasch, Contrato de Sync y Helper Global `isReviewDueWord` (migración CockroachDB **019**
  `019_positions_anchor_offset.sql` aplicada con cerrojo temporal en dev y prod;
  preservación de `anchor` y `anchor_offset = 0` en persistencia Kindle y resolución
  de página por texto antes de ratio; escala Rasch $\beta = 4.0 - \text{zipf}$ neutra en 0;
  incorporación de `'practice'` a `REVIEW_KINDS` y normalización de fuente `'preparation'`
  con peso 2 en `knowledgeArbSql`; catálogo híbrido L2 con `findEntriesForForms` en libros
  en inglés; timer multimedia al inicio de estabilización de ancla; tokenización Unicode
  original para locuciones en `findEpisodicHighlightRange`; y helper global `isReviewDueWord`
  exigiendo primera exposición para unificar contadores e insignias en App, Reader,
  ReadingActivity y Shelf). Verificado en caliente: `pnpm gate` en verde (3003 pruebas,
  205.52/215 kB gzip), `/api/health` → 200, `/` → 200 sirviendo `assets/index-DfS_cwbW.js`,
  `0.2.13` en `assets/DiagnosticsModal-RsYfDp1B.js`, `/api/positions` sin sesión → 401,
  `/k` → 200. Sin `smoke:auth`/`smoke:sync`: no toca auth ni endpoints de sync.
- Deploy anterior: **2026-10-29** (octavo del día), versión
  `4eb34332-589b-424e-8c2c-57e732b46e57`, Lecta **v0.2.12**: Auditoría Kindle & E-ink
  (límite de descompresión 10 MB contra zip bombs en `readZipEntryBytes`, sanitización
  iterativa anti-XSS en `sanitizeKindleHtml` con bloqueo de meta/base/link/template/audio/video
  y atributos `on*` pegados, paginación con suelo físico de línea `minLineFloorPerBlock`
  contra acumulación de diálogos cortos, estimación Rasch MAP con Newton-Raphson amortiguado
  e inferencia de $\beta$ desde Zipf, overlay `.inline-lookup-card` flotante con backdrop
  en `layout-paged` para preservar Zero-Scroll, botón de cierre táctil $\ge 44\text{ px}$,
  mitigación de ghosting `#einkRefreshOverlay` cada 12 páginas, gestos táctiles de swipe
  horizontal con cerrojo anti-click fantasma de 500 ms, hidratación R2 protegida en `/k`
  con $\le 1$ EPUB y $\le 15\text{ MB}$, persistencia de contexto episódico en `/vocab/add`
  y renderizado de cita episódica con orden determinista en `/practice`). Sin migraciones
  ni secrets nuevos. Verificado en caliente: `pnpm gate` en verde (2964 pruebas, 204.97/215 kB
  gzip), `/api/health` → 200, `/` → 200 sirviendo `assets/index-avTkuHqQ.js`, `0.2.12` en
  `assets/DiagnosticsModal-C2Hmlqr0.js`, `/api/positions` sin sesión → 401, `/k` → 200.
  Sin `smoke:auth`/`smoke:sync`: no toca auth ni el contrato de sync.
- Deploy anterior: **2026-10-29** (séptimo del día), versión
  `a982618f-04f0-4e9e-94e6-5156394231e4`, Lecta **v0.2.11**: Recalibración del motor
  de paginación Kindle y soporte de márgenes (presupuestos sm: 1150/950, md: 900/750,
  lg: 680/540, xl: 500/390; penalización de salto de bloque de 22 caracteres y 32 en
  modo paragraphs; multiplicadores de margen sm ×1.05, md ×1.0, lg ×0.90; cookie de
  preferencia `lecta_k_margin` con max-age de 1 año; selector táctil Estrecho / Normal /
  Amplio en menú [ Modo / Aa ]; clases de contenedor `.margin-sm`, `.margin-md`,
  `.margin-lg`; max-height de `calc(100vh - 82px)` en `.epub-content` y preservación
  completa del parámetro `margin` en navegación y zonas táctiles). Sin migraciones ni
  secrets nuevos. Verificado en caliente: `pnpm gate` en verde (2950 pruebas, 204.98/215 kB
  gzip), `/api/health` → 200, `/` → 200 sirviendo `assets/index-Cr5KSmUs.js`, `0.2.11` en
  `assets/DiagnosticsModal-_44jBwjA.js`, `/api/positions` sin sesión → 401, `/k` → 200.
  Sin `smoke:auth`/`smoke:sync`: no toca auth ni el contrato de sync.
- Deploy anterior: **2026-10-29** (sexto del día), versión
  `31e91433-9422-4fbd-b527-64e468853496`, Lecta **v0.2.10**: Kindle Zero-Scroll &
  Pure Paging (filtro Zipf < 4.0 en antesala con salto sin fricción, erradicación de
  `.cat-notes-box` y de consultas léxicas por página en lectura regular, presupuestos
  dinámicos sm/md/lg/xl con penalización de 45 chars por salto de bloque, layout CSS
  100vh paged, nodos inertes `<span class="w">`, pulsación sostenida de 450 ms con
  fallback por selección nativa, modo `[ 🔍 Consultar ]`, zonas táctiles laterales
  25%/75% y barra inferior compacta de una línea). Sin migraciones ni secrets nuevos.
  Verificado en caliente: `pnpm gate` en verde (2943 pruebas, 204.98/215 kB gzip),
  `/api/health` → 200, `/` → 200 sirviendo `assets/index-Big_LEgH.js`, `0.2.10` en
  `assets/DiagnosticsModal-DcrEfHD_.js`, `/api/positions` sin sesión → 401, `/k` sirviendo
  `body.layout-paged`. Sin `smoke:auth`/`smoke:sync`: no toca auth ni el contrato de sync.
- Deploy anterior: **2026-10-29** (quinto del día), versión
  `459f1541-b018-43c1-867c-e3a552e4bb54`, Lecta **v0.2.8** (redeploy del mismo
  árbol, pedido expresamente; assets idénticos: `assets/index-mHYOojkW.js` con
  sha256 `f156971ab508872c4a33d81af4f7f07293d2fafdb97974de66217ffd5d4c00ad`
  local y servido, `0.2.8` en `assets/DiagnosticsModal-CXdvC3uH.js`,
  `/api/health` → 200, `/api/positions` sin sesión → 401). Sigue el arreglo
  del cierre con «atrás» del navegador.
- Deploy anterior: **2026-10-29** (cuarto del día), versión
  `a6671c49-f2c2-4f96-864a-051b3e7ab743`, Lecta **v0.2.8**: el cierre con
  «atrás» del navegador guarda la posición real (ver «Posición del lector»:
  `closeReader` en el callback del historial, `saveLatest()`, `closedRef`,
  limpieza del hook sólo por `bookHash` y `history.scrollRestoration` manual).
  Sin migraciones ni secrets. Verificado en caliente: `pnpm gate` en verde
  (2919 pruebas, 204.88/215 kB gzip), `/api/health` → 200, `/` → 200 sirviendo
  `assets/index-mHYOojkW.js`, `0.2.8` en `assets/DiagnosticsModal-CXdvC3uH.js`,
  `/api/positions` sin sesión → 401 y una prueba en Chromium contra producción:
  leer a 229 px dentro de P05, salir con `goBack()` y reabrir desde la
  estantería → la fila conserva `anchor: "P05"`, `anchorOffset 0.5511`,
  `scrollTop 1174` y la deriva es **0 px**. Sin `smoke:auth`/`smoke:sync`: no
  toca auth ni el contrato de sync.
- Deploy anterior: **2026-10-29** (tercero del día), versión
  `9f23f970-02f8-4277-8bf1-149e50c6121c`, Lecta **v0.2.7**: la posición real del
  lector (ver «Posición del lector»: `anchorOffset` + `keepAnchorStable`) y el
  service worker que ya no recarga la primera visita. Sin migraciones ni secrets
  nuevos. Verificado en caliente: `pnpm gate` en verde (2913 pruebas,
  204.82/215 kB gzip), `/api/health` → 200, `/` → 200 sirviendo
  `assets/index-B69sEL3k.js` (sha256 local idéntico al servido), `0.2.7` en
  `assets/DiagnosticsModal-C0shL8RD.js`, `/api/positions` sin sesión → 401,
  `POST /api/client-errors` → 204 con `origin`/`referer`/`user-agent` de
  navegador (fila borrada después, `name = 'deploy-check'`), `sw-manifest.json`
  lista el `index-` nuevo y una prueba en Chromium contra producción reabrió el
  libro con deriva **0 px** (`anchorOffset` 0.5511 → mismo párrafo, mismos 229 px
  dentro). Sin `smoke:auth`/`smoke:sync`: no toca auth ni el contrato de sync.
- Deploy anterior: **2026-10-29** (segundo del día), versión
  `1d2227f1-e37f-4d6d-8706-095d2e16dc32`, Lecta **v0.2.6**: sourcemaps de
  producción (`sourcemap: "hidden"` + `sourcemapVault()`, ver «Verificación»);
  los mapas se guardan en `artifacts/sourcemaps/` y no viajan al worker (92
  assets leídos, ningún `.map`, ningún asset nuevo — el bundle sigue en
  `assets/index-CMW2Mu5g.js`). Sin migraciones ni secrets nuevos. Verificado en
  caliente: `/api/health` → 200, `/` → 200, `POST /api/client-errors` → 204
  (ojo: con `curl` pelado Cloudflare responde **403**; hay que mandar
  `origin`/`referer`/`user-agent` de navegador) y la fila resultante en `lecta`
  se desminificó con `pnpm symbols --db` a `src/client/lib/history.ts:19:6
  (stack)`. Fila de verificación borrada después (`code = 'deploy-smoke'`).
- Deploy anterior: **2026-10-29**, versión
  `dcf599cd-5635-45bc-b8a9-88512c250a1c`, Lecta **v0.2.6**: observabilidad de
  errores (tabla `lecta_error_signatures`, `GET /api/error-reports`, bloque
  «Salud de la aplicación (servidor)» en Diagnóstico y digest por Resend desde
  el cron de las 05:00), más migraciones **017** y **018** aplicadas en `lecta`
  antes del worker. Secret nuevo `LECTA_OWNER_EMAIL` (`wrangler secret put`).
  Verificado en caliente: `pnpm gate` en verde (2892 pruebas, 204.17/215 kB
  gzip), `/api/health` → 200, `/` → 200 sirviendo `assets/index-CMW2Mu5g.js`,
  `Salud de la aplicación` en `assets/DiagnosticsModal-D7_pysK_.js`, `POST
  /api/client-errors` → 204 y la fila aparece con `sample_frames` y `version`,
  `GET /api/error-reports` sin sesión → 404. Fila de verificación borrada
  después (`code = 'deploy-check'`). Sin `smoke:auth`/`smoke:sync`: no toca auth
  ni el contrato de sync.
- Deploy anterior: **2026-10-28** (segundo del día), versión
  `6e984244-6664-4d5c-9623-178c97f530c1`, Lecta **v0.2.3**: notificaciones
  locales de hábito (`periodicsync`/`notificationclick` en `public/sw.js` y
  `localNotificationScheduler`), overlay «Reanudar sesión de lectura»
  (`ResumeSessionOverlay` con recuento del pasaje), récord mensual en el
  recorrido, `tap-intent-guard`, `tts-landing` y modo compacto de
  `/api/ai/explain-in-passage` (clave de caché lemma+pasaje normalizado y
  `dictionary`/`contextualNuance` en la respuesta). Sin migraciones.
  Verificado en caliente: `pnpm gate` en verde (2795 pruebas, 201.27/215 kB
  gzip), `/api/health` → 200, `/` → 200 sirviendo
  `assets/index-BULye57G.js`, `/api/positions` sin sesión → 401, `0.2.3` en
  `assets/DiagnosticsModal-BGE1LbgF.js`, `Reanudar sesión de lectura` en
  `assets/index-BULye57G.js` y `periodicsync`/`notificationclick`/
  `lecta-habit-reminder` en `sw.js`. Sin `smoke:auth`/`smoke:sync`: no toca
  auth ni el contrato de sync.
- Deploy anterior: **2026-10-28**, versión
  `f602a71f-fc61-44f4-b6c9-93a3ee1290a1`, Lecta **v0.2.2**: el Cuaderno enseña
  antes de examinar (ver «Regla del Cuaderno»). Incluye la migración **016**
  aplicada en `lecta` antes del worker (desbloquear `lecta_user_words` → `ALTER`
  → volver a bloquear; 0,8 s y 1,3 s, sin jobs en cola). Verificado en caliente:
  `pnpm gate` en verde (2720 pruebas, 180.11/215 kB gzip), `/api/health` → 200,
  `/` → 200 sirviendo `assets/index-BUAHLtMJ.js`, `/api/positions` sin sesión →
  401, `0.2.2` en `assets/DiagnosticsModal-UfzSsviw.js`, y las frases nuevas
  (`Seguir leyendo`, `Pasar por ahora`, `Los modos libres usan palabras que ya
  viste`) en `assets/Vocabulary-U4tEJWaQ.js`. `smoke:sync` contra producción
  pasó completo; además se probó `/api/vocab` a mano: PUT con `presentedAt` →
  200, PUT sin el campo no borra el sello y el pull lo devuelve como número.
  Cuentas temporales creadas: `sync-smoke-1793158594248@example.com` y
  `vocab-sonda-1793158618958@example.com` (esta segunda solo con una palabra
  tombada).
- La versión visible sale de `src/shared/app-version.ts` (`APP_VERSION`) y la usan
  `DiagnosticsModal.tsx` (UI y reporte copiado) y su prueba: al subir de versión
  hay que tocar ese archivo, `package.json` y `mcp/package.json` (más el
  `user-agent` `lecta-mcp/<versión>` de `mcp/src/api.ts`).
- **Hyperdrive: dos bindings.** `lecta-db` (id `0b4288d9…`) tiene el cache
  **desactivado** (auth, sesiones, permisos, lecturas post-escritura); `lecta-db-cached`
  (id `7d2a49ff…`) tiene el cache **activado** (max_age 60s) para lecturas
  stale-tolerantes del catálogo compartido (`/api/lexicon/*`). El código elige
  el binding vía `getConnectionString(env, cached)` / `withClient(env, run, cached)`:
  por defecto (uncached) para auth y sync de usuario; `cached=true` solo en las
  rutas del catálogo. No rutear auth ni sync de usuario por el binding cached.
- Workers Logs activo (`observability.logs.enabled` en `wrangler.jsonc`): los
  eventos estructurados (`client_error` y compañía) se consultan en el dashboard
  con retención de días, no como histórico.
- **Embudo de la landing** (`src/worker/landing-events.ts`, migración **028**
  `lecta_landing_daily`, una fila por día/evento/fuente con `hits`):
  `POST /api/landing-events` sin sesión, allowlist de eventos, siempre 204 y
  tolera la tabla ausente. `signup` solo lo escribe el worker en
  `PUT /api/account/starter-coat` cuando el pelaje se escribe por primera vez
  y el cliente manda `src` (guardado de `?src=` en `lecta:src`). Retención 90
  días en el cron. Lectura: `pnpm landing:stats [--days 14] [--json]`.
  028 aplicada en `lecta_dev` y en `lecta` (2026-11-15; en prod tras el deploy
  `60d3aad5`, sin jobs en cola; un `POST` real escribió su fila y se borró).
- `POST /api/client-errors` recibe errores del navegador **sin sesión**:
  allowlist `name`/`code`/`route`/`version`, `frames` (máx. 3, limpiados a
  `archivo.js:línea:columna`) y, opcional, `message`; tope de 30/min y 300/hora
  por IP **por isolate** (es un freno a los logs, no seguridad) y rechazo
  silencioso con 204. La ruta se sanea (`/k/ABCD` → `/k/*`) y se normaliza a
  `:id` antes de calcular la huella. Interruptores en Diagnóstico:
  `shareClientErrors` e `includeErrorMessage` (este último apagado por defecto).
- **Observabilidad de errores** (`docs/observabilidad-errores.md`): el reporte
  aceptado suma a `lecta_error_signatures` (una fila por `(bucket_day, signature)`,
  `hits` por UPSERT) dentro de `waitUntil`, y sus errores se tragan — el 204 nunca
  depende de la base. `signature` = SHA-256 truncado de
  `name|code|ruta_normalizada|frame0` (`fingerprint` en
  `src/worker/error-signatures.ts`). La fila guarda `sample_frames` (3 frames),
  `last_message` (solo con el flag) y `version`. `GET /api/error-reports?days=N`
  (máx. 30 días, 100 filas) responde **404** si falta `LECTA_OWNER_EMAIL` o la
  sesión no es la del dueño; lo pinta «Salud de la aplicación (servidor)» en
  Diagnóstico. El cron de las 05:00 purga lo anterior a 30 días y manda el digest
  por Resend cuando una firma cruza `ERROR_DIGEST_MIN_HITS = 5`.
- Secrets en el worker: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `DEEPSEEK_API_KEY`,
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `AI_GATEWAY_KEY`, `AI_GATEWAY_URL`,
  `LECTA_OWNER_EMAIL` (opcional: abre el agregado de errores y recibe el digest),
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY_ID`,
  `STRIPE_PRICE_YEARLY_ID` (cobro de Lecta+).
  `secrets.required` en `wrangler.jsonc` controla cuáles llegan al `env` en dev
  — si una var no está ahí, el worker no la ve (bug ya corregido con Resend).
- AI Gateway `lecta` (`gateway.ai.cloudflare.com/v1/<account>/lecta/deepseek`):
  sin auth propia (cada request lleva `DEEPSEEK_API_KEY`), `byok_only` para no
  tocar facturación unificada, cache apagado y rate limit solo como tope de
  emergencia. El `cfut_` de `AI_GATEWAY_KEY` quedó huérfano de un gateway que no
  existe y hoy es decorativo — si se activa `authentication` en el gateway hay
  que generar un token nuevo desde el dashboard. `AI_GATEWAY_URL` vacío cae a
  `api.deepseek.com` directo.
- `RESEND_FROM_EMAIL` usa `onboarding@resend.dev`: Resend solo entrega al
  correo dueño de la cuenta hasta verificar un dominio propio.
- `BETTER_AUTH_URL` no se fija en prod: el código cae al origen de la petición.

## Planes Gratis / Lecta+ (Stripe)

Diseño: `docs/designs/2026-11-12-planes-y-landing.md`.

- **Plan por cuenta**: tabla `lecta_user_plan` (migración 027). Sin fila =
  `free`; cuentas anteriores a 2026-11-13T00:00Z = `founder_lifetime`.
  `lecta_plus` vence en `plan_expires_at` + 3 días de gracia. La 027 está
  aplicada en `lecta_dev` (2026-11-12) y en `lecta` (2026-11-14 03:2x UTC,
  tras el corte y después del deploy `07d1e741`): 34 filas `founder_lifetime`
  = las 34 cuentas anteriores al corte; las 2 posteriores quedan `free` (sin
  fila). Tablas nuevas de CockroachDB nacen con `schema_locked=true` y el
  `CREATE INDEX` de la misma migración choca con el cerrojo: en ambas bases
  hubo que desbloquear `user_books`, correr `db:migrate`, desbloquear
  `lecta_user_plan` al primer fallo, re-correr (idempotente) y volver a
  bloquear `user_books`, `lecta_user_plan` y `lecta_stripe_events`.
- **Worker**: `plan-store.ts` (lectura/escritura; `loadUserPlan` es la única
  puerta), `plan-middleware.ts` (`requireLectaPlus` por ruta, nunca con
  `app.use`; `requireKindlePlan` en `/k/*` y `/kindle/priming/action`),
  `billing.ts` (`/api/billing/{checkout,portal,webhook}`) y `stripe.ts`
  (API REST sin SDK, `Stripe-Version: 2025-03-31.basil`; cancelación al
  borrar la cuenta en `beforeDelete`).
- **Rutas con gating** (402 `{ code: "LECTA_PLUS_REQUIRED" }`): las 9 de IA en
  contexto, `/api/lexicon/items(/answer)`, binarios propios (`PUT/POST
  /api/books(/:hash)`, `GET /api/books/:hash`, `PUT/GET
  /api/user/books/:bookId/file`), `/api/kindle/prefs` y vincular Kindle.
  Libres: `enrich*`, listas, catálogo y `PUT /api/user/books/:bookId/meta`.
- **Pruebas del worker**: mockean `loadUserPlan` de `./plan-store`
  (fundador por defecto); con `getSession` en `Once`, el middleware se lo
  come: usar `mockResolvedValue`.
- **Rollout de Stripe**: antes del deploy, `wrangler secret put` de
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY_ID` y
  `STRIPE_PRICE_YEARLY_ID` (están en `secrets.required`) y las mismas
  entradas en `.dev.vars`. El endpoint del webhook se crea en Stripe con
  `api_version=2025-03-31.basil`; pruebas locales con
  `stripe listen --latest --forward-to localhost:<port>/api/billing/webhook`.

## Probar con un clásico (sin cuenta)

- Única excepción a la cuenta obligatoria: `/?probar=<id>` (allowlist en
  `src/client/lib/trial.ts`: `marianela`, `alice-wonderland`) abre ese
  clásico en el lector sin sesión. `App.tsx` lleva `trial`
  (`loading` → `reading` → `ended`): mientras no sea `ended` no se muestra
  `Welcome` ni la estantería (solo «Abriendo…» y el lector). El libro se
  importa con `getCatalogBook` **después** de `sessionDbReady` (la base ya es
  la que dictó la sesión, no la optimista de `lastUserId`), así que cae en
  la base anónima `lecta`. Al cerrar el libro (flecha, «atrás») `trial` pasa
  a `ended` y `Welcome` muestra «Crea tu cuenta gratis para seguir leyendo
  «…»». Lo guardado pasa a la cuenta por `migrateAnonymousToUser` al
  registrarse en el mismo navegador. Con sesión, `?probar=` solo añade el
  libro a la estantería.
- Sin sesión la ficha usa el diccionario local y la IA muestra «Inicia
  sesión…» (`canExplain`). Botones en la landing: `data-cta-try`, eventos
  `cta:try-es` / `cta:try-en`.

## Cuentas y correo

- Magic link (10 min), correo+contraseña, "olvidé contraseña" y borrado de
  cuenta con verificación por correo. El enlace de borrado **exige la misma
  sesión** que lo pidió (Better Auth valida token contra sesión activa).
- `beforeDelete` purga paginando `books/<userId>/` y `user-books/<userId>/`
  de R2 y borra `user_books` y `kindle_link_codes` (también los códigos
  expirados). `lecta_user_words`, `lecta_rate_log` y `lecta_ai_quota` caen por
  `ON DELETE CASCADE`.
- IndexedDB separado por cuenta (`lecta` anónimo, `lecta:u:<id>` por usuario);
  al entrar sesión migra lo anónimo a la cuenta.

## Datos

- Bases separadas: **prod usa `lecta`** (vía Hyperdrive) y **dev usa `lecta_dev`**.
  `.env` apunta `DATABASE_URL` a `lecta_dev` y define
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` — sin esa var, el
  binding de Hyperdrive en dev túnelaba a la base de producción.
  `pnpm dev` debe reiniciarse tras cambiar `.env` (las vars se leen al arrancar).
- `lecta_dev` arrancó con esquema + auth + seed, sin usuarios: en dev hay que
  registrarse de nuevo (el correo es el mismo dominio, es solo otra base).
- `lecta` (prod) tiene aplicadas **001–015** (015 aplicada el 2026-10-24 y
  014 el 2026-10-23). Los índices de sync existen todos, pero dos se crearon con
  las columnas estrictamente necesarias y no como los escribe la migración: ver
  la nota de PK completa arriba. Las seis tablas de sync vuelven a estar con
  `schema_locked=true`.
- **017_book_covers.sql y 018_error_signatures.sql** aplicadas en `lecta_dev` y
  en `lecta` el 2026-10-29 (ambas bases en 18 migraciones). Las dos pedían
  `user_books` sin bloquear: se desbloqueó, se migró con
  `pnpm db:migrate --remote` y se volvió a bloquear en el mismo minuto, sin jobs
  en cola. En prod la tabla `lecta_error_signatures` nace vacía; con ella
  ausente el worker igual responde 204 (el error de escritura se traga), así que
  migración y deploy pueden ir en cualquier orden.
- **014_ai_quota.sql** aplicada en `lecta_dev` y `lecta` (2026-10-23, 14
  migraciones en cada una): `lecta_ai_quota` es la tabla del UPSERT atómico de
  cuota de IA (PK `user_id, scope, bucket_hour`, FK a `user` con CASCADE). El
  worker desplegado el 2026-10-24 ya la usa.
- **015_server_synced_at.sql** aplicada en `lecta` (2026-10-24, tabla por tabla)
  y en `lecta_dev` (2026-10-24, 15 migraciones en cada una): añade `synced_at
  BIGINT` con reloj de servidor a las seis tablas de sync y los índices
  `(user_id, synced_at)`. Es el cursor del pull incremental, así que **migración
  y deploy van juntos**: con 015 aplicada pero worker viejo, el pull por
  `updated_at` sigue funcionando; al revés, el pull fallaría.
  - `pnpm db:migrate` **se queda corto con 015**: cada DDL dispara un job
    `SCHEMA CHANGE GC` y CockroachDB serializa los cambios de esquema, así que
    el `statement_timeout` de 120 s tumba la migración a mitad. Aplícala
    sentencia por sentencia (desbloquear las seis tablas → 6 `ALTER` → 6
    `CREATE INDEX` → registrar en `lecta_schema_migrations` → volver a
    bloquear). Cada `ALTER ... ADD COLUMN` tardó entre 0 y 200 s.
  - Ojo al verificar: `SHOW COLUMNS` puede no ver la columna recién añadida
    mientras el job de esquema no finaliza; `SHOW JOBS` manda.
- `defaultdb` pertenece a otro proyecto (POS): no tocar sus tablas.
- EPUBs de prueba con copyright están en `.gitignore` (`/src/*.epub`,
  `/fixtures/*.epub` salvo `minimal.epub`).
- Acepciones del catálogo: `lexicon_senses.source` distingue
  `wiktionary` (carga masiva del Wikcionario en español vía kaikki.org
  con `node --env-file=.env scripts/lexicon-wiktionary.mjs`, lee
  `data/lexicon/es-wiktionary.jsonl.gz` — ver docs/licencias-lexico.md),
  `ai` (enriquecimiento DeepSeek) y NULL (semilla/carga original).
- **El catálogo léxico vive solo en `lecta_dev`** y es compartido: el
  worker lo consulta por nombre calificado (`CATALOG = "lecta_dev."`
  en src/worker/lexicon.ts) desde la misma conexión del cluster —
  incluye `lexicon_entries/forms/senses/sources/items`. No duplicar
  estas tablas en `lecta` (cuesta RUs y diverge); las tablas
  `lexicon_*` que quedaron en `lecta` están dormidas. Ojo: las pruebas
  destructivas sobre esas tablas en dev pegan a prod.
- `lecta_user_words.sense_entry_id` guarda ids del catálogo de
  `lecta_dev`; filas viejas en prod pueden tener ids del catálogo
  local viejo (ya no referenciables) — el backfill los ignora y cae a
  la primera acepción disponible.
- Palabras del Cuaderno sin `meaning`: `backfillWordMeanings`
  (src/client/lib/word-meanings.ts) las completa desde el catálogo al
  abrir Vocabulary — el enriquecimiento escribe en el catálogo, no en
  la palabra guardada, así que este paso es el que las actualiza.

## Reglas Zero-Friction y Kitten TTS (Sincronizado con .agents/rules)

1. **Inteligencia Invisible (1-Toque)**: Ninguna función psicométrica (Theta, FSRS, análisis sintáctico) debe mostrar jerga técnica ni bloquear la lectura con modales previos.
2. **Lectura en 0 Segundos**: Tocar un libro en `Shelf.tsx` abre directamente `Reader.tsx`. Prohibido interceptar con `Calibration.tsx`, `BookStart.tsx` o `SectionPreview.tsx` a pantalla completa.
3. **Un Solo Dock Inferior**: En `Reader.tsx` jamás deben coexistir dos barras flotantes inferiores. El Dock único muta suavemente entre Modo Lectura y Modo Audio/TTS.
4. **Kitten TTS Opcional y 100% Funcional**:
   - Por defecto, el TTS usa voces naturales inmediatas (`ttsSpeech.ts`, 0 MB).
   - `kittenTtsEngine.ts` y `kitten-tts.worker.ts` SE MANTIENEN como opción descargable ("Voz Neural HD Offline") almacenada en IndexedDB/CacheStorage tras consentimiento del usuario.
   - Prohibido incluir archivos `.onnx` pesados en el bundle principal del Worker de Cloudflare (< 25 MiB).
   - Implementar pre-síntesis (lookahead buffer de la oración N+1) en `kitten-tts.worker.ts` para eliminar silencios entre frases.
5. **Verificación Continua**: Después de cada cambio en componentes o librerías, ejecuta `pnpm test` (Vitest) y verifica que no existan regresiones de tipos con TypeScript.
6. **Identidad Visible Limpia**: Nunca renderizar hashes, IDs o nombres de archivo técnicos como texto visible en cliente ni en Kindle; pasar siempre por `bookDisplayName` (en cliente) o fallbacks limpios en servidor (`isHashLikeIdentifier` / `humanizeFilename`).

## Auditoría de la estrategia de aprendizaje

- `node scripts/audit-investigacion.mjs [--online]` audita
  `docs/estrategia-aprendizaje-2026-10-24.md` contra el código real y escribe
  `docs/auditoria/reporte.*`. Corre también en `pnpm test`.
- Cada afirmación de `docs/auditoria/claims.json` puede llevar `auditVerdict`
  (`SOSTENIDA` / `MATIZADA` / `REFUTADA`). Si una refutada deja de fallar, el
  arnés la marca `VERDICT_STALE` y el reporte falla: hay que revisar el
  veredicto, no silenciarlo.
- La comprobación `reachable` exige que la función citada se use en producción
  fuera de su archivo (no cuentan pruebas, comentarios ni reexportaciones). Toda
  afirmación que cite una función debe llevar una.
- θ vive en una sola escala (`betaFromZipf` = 4 − zipf, neutra en 0) y en una
  sola llave (`lecta:user_language_profile:v1`). La llave vieja
  `lecta:user_theta:*` solo se migra restando 3; no volver a escribirla.
- El cierre de capítulo debe pasar por `completeChapterTo`
  (`useReaderNavigation.ts`) en scroll y en páginas, y consolidar la tarjeta con
  `consolidateEpisodicWord` (`reviews.ts`). Un ejercicio resuelto = un repaso.
- `pnpm audit:cuaderno [--online]` audita el Cuaderno y la sesión de repaso
  contra el código y escribe `docs/auditoria/cuaderno/evidencia.*`. Corre también
  en `pnpm test` (`scripts/audit-cuaderno.test.mjs`). Las afirmaciones `corregido`
  vigilan que el arreglo siga en pie: si desaparecen, el reporte sale 1.
- Regla del Cuaderno (2026-10-28): la sesión de repaso **y los modos libres**
  salen de `reviewQueue` (`learn.ts`) — vencidas que ya pasaron por la ficha o por
  un repaso real. Nunca se examina una palabra con `reps === 0` sin exposición, no
  hay respaldo con palabras no vencidas y el modo se elige con `isEligible` (sin
  oración no hay `choose`). El botón principal del héroe es «Repasar» cuando hay
  vencidas (decisión de 2026-11-10: repasar primero) y «Aprender» queda como
  segundo botón; sin vencidas «Aprender» es el principal; si no hay nada que practicar, los modos libres quedan apagados y se
  explica por qué.
- Las afirmaciones de `audit-cuaderno` usan la comprobación `presente` (busca el
  patrón en todo el archivo y reporta dónde): mover código no rompe el arnés. Las
  líneas absolutas (`anchor`) quedan solo para probar el mecanismo; se cambiaron
  el 2026-10-28 después de que tres ediciones seguidas de `Vocabulary.tsx` dejaran
  el registro en PARCIAL sin que el arreglo hubiera cambiado.
- `lecta_user_words.presented_at` (migración **016**, aplicada en `lecta_dev` y en
  `lecta`) es el sello de primera exposición que viaja con la palabra.
  **Migración y worker van juntos**: el worker nuevo escribe y lee la columna; con
  la columna y el worker viejo no se rompe nada. Ya desplegado en v0.2.2.

## Deuda de complejidad (2026-11)

- `Reader.tsx` (4 934 líneas) y `app.ts` worker (3 716) son componentes/módulos
  monolíticos. Concentran estado, efectos, callbacks y JSX. `Vocabulary.tsx` ya se
  partió (plan v2 del Cuaderno, Fase 5, 2026-11-10: 4 085 → 864 líneas, ver abajo).
- **Plan de refactor (incremental, cada fase con `pnpm gate` verde)**:
  - Fase R1 — hooks de estado: `useReaderTts`, `useReaderSelection`, `useReaderAnchoring`.
  - Fase R2 — subcomponentes: `ReaderTtsDock`, `ReaderSelectionOverlay`, `ReaderChapterHeader`.
  - Fase R3 — orquestador: Reader.tsx queda como compositor (~800 líneas).
- Cada fase se valida con tests unitarios del hook extraído y, para R2/R3, con
  `e2e/smoke-journeys.spec.ts` y `e2e/reader-position.spec.ts`.
- **No mezclar con cambios funcionales**: una fase = un PR/commit aislado.
- **Estructura del Cuaderno tras partir `Vocabulary.tsx`** (sin cambios funcionales;
  `Vocabulary.tsx` es el compositor: monta los hooks, decide qué vista pintar y
  guarda lo pequeño que cruza vistas — pestaña, citas, avisos de deshacer, taller):
  - `src/client/lib/notebook-model.ts` — modelo puro (tipos, `wordStage`/`stateOf`/
    `matchesFilter`, `isEligible`, búsqueda, constantes). Sin React; con pruebas propias.
  - Hooks en `src/client/hooks/`: `useNotebookData` (carga y estado de palabras,
    conocimiento, exposición, «Usar IA»), `useHerbarioView` (filtros, ámbito, listas
    derivadas, nombres de libros), `useLearnSession` (ficha de Aprender),
    `useReviewSession` (cola, calificación FSRS, modos, pistas, rescate, cierre) y
    `usePracticeCompanion` (pose, frase y racha del gato).
  - Componentes en `src/client/components/notebook/`: `NotebookHero`, `FreeModes`,
    `HerbarioPanel`, `WordRow`, `LearnSessionView`, `PracticeCard`, `ReviewDone`,
    `QuotesPanel`. Reciben el objeto del hook (`view`, `session`, `review`) y no leen
    estado por su cuenta.
  - `audit-cuaderno` busca en el grupo `@notebook` (Vocabulary.tsx + estos módulos):
    mover código entre ellos no rompe las afirmaciones. `Vocabulary.tsx` reexporta
    `findEpisodicHighlightRange`, `renderHighlightedContext`, `safeStability` y
    `getStabilitySegments` porque las pruebas los importan por esa vía histórica.

## Rediseño UX editorial (fases F0–F8, 2026-11)

Rediseño de Tu recorrido, Cuaderno, Biblioteca, Explora, Tú y Tu Kindle para
reducir scroll, unificar controles y aprovechar el ancho en escritorio. Las
decisiones de producto las tomó Luis; esto documenta las invariantes técnicas.

- **Tokens compartidos** (`styles/tokens.css`): `--chip-active-*` (chips/filtros
  activos translúcidos, nunca naranja sólido — el sólido queda reservado al CTA
  principal), `--action-tint-*`, `--toggle-*`, `--select-*`. Borde punteado solo
  en zonas de adición/carga (p. ej. «+ Añadir libro»); avisos y estados
  pendientes usan borde sólido con tinte.
- **Filas de ajuste** (`styles/app.css`): `.setting-row` con variantes
  `--toggle`, `--select`, `--stack`. Título + descripción viven en el mismo
  bloque izquierdo (`.setting-hint` para el texto explicativo) y el control va a
  la derecha centrado; el divisor va debajo de toda la fila, nunca entre título
  y descripción.
- **Breakpoint de escritorio: `64rem`.** El mini-reproductor «Continuar leyendo»
  es un ítem compacto del riel lateral (`AppNav.tsx`) en ≥64rem; la píldora
  flotante solo existe en móvil.
- **Tu recorrido en Bento** (`Journey.tsx` + `game.css`): a ≥64rem el contenedor
  crece a ~72rem en 2 columnas (compañero + rango a la izquierda, Sendero de
  Tinta ocupando la derecha en altura). **El orden del DOM no cambia**: móvil y
  lectores de pantalla siguen viendo una sola columna lógica. El Sendero usa
  trazo fino (`stroke-dasharray` ~2px) y etiquetas de hasta 2 líneas sin
  truncar. El mapa de tinta de 28 días usa celdas compactas.
- **Cuaderno**: los cofres pendientes van en una fila de tarjetas compactas
  tintadas (`GamePanel.tsx`). La barra del Herbario es una sola (`.nb-tools` en
  `notebook.css`) con «Ritmo de repaso» dentro de «Más filtros».
- **Explora**: una sola etiqueta de mood por libro (`tags.slice(0, 1)`) + la
  píldora de afinidad; los selectores de estrategia llevan `aria-pressed`.
- **Tú** (`Account.tsx`): todo el contenido en tarjetas `.account-card`
  uniformes (cuenta/sesión, sincronización, nivel, IA+diccionario,
  lectura+vocabulario, compañero, Kindle). IA y diccionario viven en UNA sola
  tarjeta — no volver a duplicar sus controles en «Avanzado». Privacidad,
  diagnóstico, respaldo y resync van dentro del `<details>` «Avanzado».
- **Tu Kindle es vista previa local** (`KindleAppearancePanel.tsx`): ya no hay
  iframe ni 7 selects; renderiza `KINDLE_PREVIEW_SAMPLE` al instante con los
  mapas compartidos de `src/shared/kindle-prefs.ts` (familia, tamaño,
  interlineado, margen, alineación, enfoque clean/paragraphs/anchors,
  disposición paged/scroll). Ese módulo es la fuente única de opciones,
  etiquetas y normalización tanto para el cliente como para el worker
  (`worker/kindle/routes.ts` sigue sirviendo `/k/preview` para el e-reader).
  Guardar sigue siendo `PUT /api/kindle/prefs`.
- **Temas: jamás colores fijos** en componentes compartidos. `game.css` llevaba
  fondos/tintas hardcodeados que rompían el tema `papel`; siempre `var(--ink)`,
  `var(--ink-soft)`, `var(--paper-raised)`, `var(--vermilion)`. Al tocar estilos
  hay que capturar `papel` y `noche`.
- **`ReadingActivity.tsx` importa `../styles/notebook.css` directamente**: se
  renderiza también desde Journey y antes dependía de que `Vocabulary.tsx`
  cargara la hoja. Si un componente se usa en dos vistas, su CSS viaja con él.
- Verificación de cierre: `pnpm gate` completo (232 archivos, 3 302 pruebas,
  lint 0 warnings, build + `check:size` con ~4,5 kB gzip de margen) y capturas
  1440/390 px en `noche` y `papel`.

### Fase G (2026-11): densidad móvil y estilos rápidos

- **`useMediaQuery(query)`** (`src/client/hooks/useMediaQuery.ts`): media query
  reactiva con `useSyncExternalStore`; sin `matchMedia` (jsdom) regresa `false`
  — los componentes tratan `false` como móvil.
- **`JourneyFold`** (`components/JourneyFold.tsx`): sección plegable del
  recorrido. En móvil arranca cerrada; a ≥64rem va siempre abierta y el
  summary ignora el clic (chevron oculto). Plegadas: «Tu análisis»,
  «Récords personales» y «Tu horizonte de palabras». La grilla de 2 columnas
  del análisis vive en `.journey-insights .journey-fold-body` (los bloques ya
  no son hijos directos del `section`).
- **Mini-reproductor móvil**: pastilla compacta anclada a la derecha
  (`.mini-reader-bar`, `left:auto; right:var(--s-3)`); el título va en
  `.visually-hidden` para lector de pantalla y el botón es «Continuar» con
  `aria-label` completo. En escritorio sigue siendo el ítem del riel.
- **Explora**: una sola píldora visible por libro — la de **afinidad**
  (`.book-affinity-pill`); la categoría/mood solo vive en los chips de
  filtro superiores. `CommunityShelf` mantiene sus `discover-tag-pill`
  propias («Guía de papel», género): no son el mismo control.
- **Presets Kindle**: `KINDLE_PRESETS` y `matchKindlePreset` en
  `src/shared/kindle-prefs.ts` («Clásico» = `DEFAULT_KINDLE_PREFS`,
  «Alta legibilidad», «Dislexia», «Ágil»). En el panel son chips
  `aria-pressed`; una mezcla manual muestra «Personalizado». Al servidor
  (`PUT /api/kindle/prefs`) viajan las prefs resueltas, nunca el id.


## Catálogo Gutenberg y zona «Series y películas»

- **Gutenberg**: tabla `gutenberg_books` (migración 029, índice
  `(language, downloads DESC)`). Rutas del worker en `src/worker/catalog.ts`:
  `GET /api/catalog/search` (q ≤80, caché de isolate) y el EPUB `pg-<id>`
  bajo demanda (sesión → índice → cuota 20/h → fetch a gutenberg.org con UA
  propio, máx 25 MB, valida `PK` → R2 `catalog/pg-<id>.epub`). Importador:
  `node scripts/gutenberg-index.mjs --build` (volcado RDF oficial) y
  `--load` (upsert por lotes; `lecta_dev` por defecto con
  `DATABASE_URL_DEV`, `--remote` para `lecta` solo con autorización). La búsqueda del cliente
  vive en `src/client/lib/gutenberg.ts` y `GutenbergSearch.tsx` es chunk
  lazy bajo el riel curado de «Libros gratuitos».
- **Pantalla**: rutas `/api/screen/*` en `src/worker/screen.ts` y
  `src/worker/screen-discover.ts` (OMDb + SubDL + Trakt; llaves
  `OMDB_API_KEY`/`SUBDL_API_KEY`/`TRACKT_API_KEY` en `.dev.vars`, nunca en
  el repo; sin `TRACKT_API_KEY` los rieles sirven la lista curada de
  `screen-curated.ts`). Guías en R2 `screen-guides/v1/<type>-<imdbId>[-sNN eNN]-<lang>.json`;
  pósters en `screen/posters/<imdbId>.jpg` (inmutable, ahorra cuota OMDb);
  descubrimiento en `screen-discover/v1/rails.json` (fresca 12 h, sirve la
  vencida si Trakt cae) y `related-<type>-<imdbId>.json` (14 días, cuota
  `screen-related` 30/h). Rutas: `/api/screen/discover`,
  `/api/screen/related?imdbId=&type=`, `/api/screen/poster`. **OMDb
  devuelve `Response: "True"` con mayúscula** — `omdbOk()` compara sin
  caso; los fixtures deben usar el valor real. Portadas Gutenberg:
  `/api/catalog/pg-<n>/cover` → R2 `catalog/pg-<n>.cover.jpg`.
  Sondas reales: `node scripts/screen-probe.mjs --env-file=.env`,
  `node scripts/trakt-probe.mjs --env-file=.env` y
  `node scripts/screen-curated-check.mjs --env-file=.env` (verifica los
  27 imdbId curados contra OMDb); todas imprimen solo estados HTTP y
  nombres de campo, llaves redactadas. La política de Trakt exige el
  crédito visible en Cuenta → «Acerca de y Diagnóstico» (ya está).
- **Regla «solo palabras»**: de los subtítulos jamás se guarda ni devuelve
  diálogo, citas, marcas de tiempo ni orden narrativo. La guía
  (`src/shared/screen-guide.ts`) solo lleva formas normalizadas,
  `capitalOnly` y claves del banco `CORE_FOREIGN_IDIOMS` (compartido en
  `src/shared/foreign-idioms.ts`). El cliente las funde en
  `paperGuide:v1:<screenWorkHash>` y las frases por capítulo en
  `screenPhrases:v1:<hash>`; ambas claves mueren con `deleteStoredBook`.
  Los rieles de descubrimiento solo llevan `imdbId`/`type`/`title`/`year`/
  `hasPoster` — metadatos públicos, nunca contenido de obras.
- **Obras de pantalla**: `StoredBook`/`ShelfItem` llevan `mediaKind:
  "movie" | "tv"`, `imdbId`, `paperOnly` y Blob vacío (sin EPUB ni sync).
  Viven fuera de la estantería (`shelfBooks` las excluye), en «Tus
  títulos» de la pestaña «Series y películas» de Explora (tarjetas con
  póster → `ScreenPrepareSheet`, «Otro episodio», «Quitar» con
  confirmación) y en el filtro «Origen» del Cuaderno (`wordOrigin` en
  `notebook-model.ts`).
- **Explora (v3, 2026-11-16)**: `ExploreShelf` y `DiscoverRail` son chunks lazy
  precargados en idle (mismo patrón que `CompanionPanel`); el contexto compartido
  vive en `src/client/components/explore-context.ts` para que `CommunityShelf`
  no arrastre el chunk padre. Comunidad monta al abrir (pestaña por defecto) y
  reporta su conteo por el puente (`onLoaded`); catálogo y pantalla montan en su
  primera visita y quedan montados ocultos (`opened` por pestaña), con
  `tabIndex={0}` en los paneles y contadores accesibles («Comunidad, 12 guías»).
  «Libros gratuitos» tiene un solo campo: `freeQuery` filtra el riel curado en
  vivo y `catalogQuery` (Enter o la fila «Buscar en todos los clásicos» de
  `GutenbergSearch`, que en modo controlado no usa debounce) busca en Gutenberg;
  `pendingQuery` oculta resultados viejos mientras hay texto sin enviar.
  Comunidad pliega el idioma en `details.discover-more-filters`, deja los géneros
  en una línea con scroll (`.shelf-community-filters`) y ordena por afinidad con
  `compareBookCoverages` — las sin medir conservan el orden del servidor al final
  y la medición sigue siendo solo de lo visible (`attempted*Ref`, sin bucles).
- **Búsqueda Gutenberg lenta**: el `LIKE '%…%'` hace FULL SCAN en
  CockroachDB (p50 ~926 ms medido con 60k filas sintéticas). Si crece,
  evaluar columna `search_tokens` con índice antes de tocar el plan.
