# Lecta — notas del proyecto

## Convenciones de Testing y CI

- **Aislamiento de entornos en Vitest**: `environmentMatchGlobs` asigna entorno estricto `'node'` a `src/worker/**`, `src/shared/**` y `mcp/src/**`, reservando `'jsdom'` exclusivamente para componentes y hooks de `src/client/**`. Evita fugas de memoria y emulaciones de DOM innecesarias.
- **Pool de procesos y memoria**: `pool: 'forks'` con workers dinámicos (`process.env.CI ? 2 : 4`) para garantizar que el sistema operativo reclame la memoria tras suites pesadas y prevenir OOM en runners de 2 vCPUs.
- **Regla de cobertura Ratchet (`pnpm coverage:ratchet`)**: Los umbrales de cobertura en `vitest.config.ts` (líneas y funciones >= 70% en `src/worker/**`) solo aumentan, jamás disminuyen. Nuevos módulos deben nacer con pruebas unitarias herméticas.
- **CI Paralelizado en 4 Jobs (`.github/workflows/ci.yml`)**: `static` (typecheck + lint, 5m), `unit` (cobertura Vitest, 10m), `build` (compilación y check:size, 8m) corren en paralelo desde t=0; `e2e` (Playwright, 15m) descarga el artefacto `dist/` tras el build.
- **Pruebas E2E y Tag `@smoke`**: `e2e/smoke-journeys.spec.ts` cubre los 3 recorridos críticos (apertura EPUB, TTS y sincronización de estado entre contextos). En CI, el proyecto WebKit ejecuta exclusivamente tests con `@smoke` (`pnpm test:e2e:smoke`), mientras Chromium corre la suite completa.
- **Guardia de la posición del lector (`e2e/reader-position.spec.ts`)**: importa `fixtures/scroll.epub` (generado por `scripts/make-scroll-fixture.mjs`), lee a media página, espera el guardado perezoso, recarga, abre el libro **desde la estantería** y exige el mismo párrafo con el mismo desplazamiento dentro de él, dos aperturas seguidas. Reimportar el EPUB en cada reapertura era el paso frágil (parsea el zip y pega contra la API simulada del arnés), no la app: se reabre pulsando el libro. Falla con `desplazamiento dentro del párrafo: antes 229px, después 0px` si se pierde la fracción intra-párrafo.
- **El service worker no recarga la primera visita**: `registerServiceWorker` (`src/client/lib/sw-register.ts`) sólo recarga en `controllerchange` si la página **ya estaba** controlada. `public/sw.js` hace `skipWaiting()` y `clients.claim()`, así que en la primera visita el SW tomaba el control y recargaba la página encima de la importación del libro, la primera sección o la posición restaurada (rompía `smoke-journeys` de forma intermitente). Un arnés e2e que necesite inmunidad total puede stubear `navigator.serviceWorker.register`.
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
  `check:size` va en **204.8 kB** de 215 kB gzip (avisa al 95%); en peso quedan ~10 kB de margen.
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
- **El servidor no guarda `anchorOffset`**: `/api/positions` sólo persiste `anchor` como texto, así que la
  precisión es local al dispositivo. Al mezclar el pull (`src/client/lib/positions-sync.ts`) se conserva el
  `anchorOffset` local si la fila remota apunta al mismo `anchor`; un `anchor` distinto gana (viene de otro
  dispositivo y ahí no hay fracción que recuperar). Añadirlo al esquema pide migración y autorización expresa.

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

- URL: `https://lecta.luis-sg9915.workers.dev` — deploy con `pnpm run deploy`.
- Último deploy: **2026-10-29** (sexto del día), versión
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
- **Hyperdrive `lecta-db` (id `0b4288d9…`) tiene el cache DESACTIVADO a propósito.**
  Con cache activado, una verificación de existencia (`findUserByEmail`) quedó
  servida en stale ~60 s y `request-password-reset` no creaba el token para un
  usuario recién registrado. Además una sesión revocada podía seguir válida
  desde el cache. No reactivar el caching sin aislar auth de las lecturas.
- Workers Logs activo (`observability.logs.enabled` en `wrangler.jsonc`): los
  eventos estructurados (`client_error` y compañía) se consultan en el dashboard
  con retención de días, no como histórico.
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
  `LECTA_OWNER_EMAIL` (opcional: abre el agregado de errores y recibe el digest).
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
  oración no hay `choose`). El botón principal del héroe ofrece aprender antes de
  repasar; si no hay nada que practicar, los modos libres quedan apagados y se
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

