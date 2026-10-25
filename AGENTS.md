# Lecta — notas del proyecto

## Verificación

- `pnpm typecheck` (cliente + worker + MCP), `pnpm lint`, `pnpm test`, `pnpm build`.
- `pnpm gate` encadena typecheck + lint + test + build + check:size: es la puerta de
  cierre de cada fase de `docs/plan-8-fases.md`. `pnpm lint` tiene un tope duro de **0
  warnings** (bajó de 28 con la auditoría UX del 2026-10-24, que dejó de bailar el análisis
  del React Compiler y limpió los 20 que quedaban): un warning nuevo rompe el gate.
  `check:size` va en **178.5 kB** de 215 kB gzip; en peso quedan ~36 kB de margen.
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
- Último deploy: **2026-10-24**, versión `5822f097-e648-4cd7-93ee-9a6195a49747`
  (auditoría UX + pull por `synced_at` + `/api/health` con chequeo de base).
  Verificado en caliente: `/api/health` → 200 `{"ok":true,"db":"connected"}`,
  `/` → 200, `/api/positions` sin sesión → 401, `check-model` con el ONNX de R2
  intacto y `smoke:auth` completo en verde contra producción.
- **Hyperdrive `lecta-db` (id `0b4288d9…`) tiene el cache DESACTIVADO a propósito.**
  Con cache activado, una verificación de existencia (`findUserByEmail`) quedó
  servida en stale ~60 s y `request-password-reset` no creaba el token para un
  usuario recién registrado. Además una sesión revocada podía seguir válida
  desde el cache. No reactivar el caching sin aislar auth de las lecturas.
- Workers Logs activo (`observability.logs.enabled` en `wrangler.jsonc`): los
  eventos estructurados (`client_error` y compañía) se consultan en el dashboard
  con retención de días, no como histórico.
- `POST /api/client-errors` recibe errores del navegador **sin sesión y sin base
  de datos** (no llama a `withClient`): allowlist `name`/`code`/`route`/`version`
  y, opcional, `message`; tope de 30/min y 300/hora por IP **por isolate** (es un
  freno a los logs, no seguridad) y rechazo silencioso con 204. La ruta se sanea
  (`/k/ABCD` → `/k/*`). Interruptores en Diagnóstico: `shareClientErrors` e
  `includeErrorMessage` (este último apagado por defecto).
- Secrets en el worker: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `DEEPSEEK_API_KEY`,
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `AI_GATEWAY_KEY`, `AI_GATEWAY_URL`.
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

