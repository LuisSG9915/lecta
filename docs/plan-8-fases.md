# Plan de 8 fases — v2 (ejecutable)

> Base: commit `13e69d3` + Fase 0 aplicada el 2026-10-22.
> Sustituye a la v1 de este mismo archivo. Los cambios respecto a la v1 están en
> [§14](#14-qué-cambió-respecto-a-la-v1); las premisas falsas que no hay que repetir, en
> [§15](#15-apéndice--premisas-que-no-se-deben-repetir).

Estado verificado el 2026-10-22, árbol con Fase 0 aplicada:

| Métrica | Valor | Límite | Margen |
|---|---|---|---|
| JS inicial (gzip) | 176.67 kB | 215.00 kB | 38.33 kB (aviso al 90 % = 193.5) |
| CSS inicial (gzip) | 19.84 kB | 55.00 kB | 35.16 kB |
| Pruebas | 168 archivos / 2 365 pruebas | — | — |
| Lint | 28 warnings | 28 (`--max-warnings 28`) | **0** |
| Migraciones en prod | 001–013 | 013 | al día (2026-10-22) |

El lint queda **exactamente** en el tope de 28; cualquier warning nuevo falla el gate. El JS
tiene margen tras la Fase 3, pero se sigue midiendo en cada fase.

---

## 0. Cómo se usa este documento

### 0.1 Gate universal

Toda fase se cierra con un solo comando, desde la raíz:

```bash
pnpm gate
```

que encadena `typecheck → lint → test → build → check:size`. Salida esperada:

| Paso | Esperado |
|---|---|
| `typecheck` | sin salida, exit 0 (incluye `mcp/`) |
| `lint` | `0 errors`, **≤ 28 warnings** |
| `test` | todos los archivos verdes; el total de pruebas solo sube |
| `build` | `dist/` regenerado; borra `dist/lecta/.dev.vars` |
| `check:size` | `206.05 kB` (baja con la Fase 3) y **sin** línea de aviso desde la Fase 3 |

Si la fase toca UI, lector, sync o el service worker, además:

```bash
pnpm test:e2e
```

(Playwright levanta `vite preview` en `:5173` y reconstruye solo; tarda ~3 min. No lo añadas al
gate: es lento y no hace falta en fases de worker puro.)

### 0.2 Cuándo una fase está cerrada

1. `pnpm gate` verde **y** el gate extra de la fase, si lo tiene.
2. Todos los criterios de aceptación marcados **con la evidencia pegada en el PR** (comando +
   salida, no «funciona»).
3. `AGENTS.md` y `docs/sistema-lecta.md` actualizados si la fase cambia un comportamiento
   observable.
4. Un commit (o PR) que contiene **solo** esa fase.

Si un criterio no se puede verificar con un comando, el criterio está mal escrito: reescríbelo
antes de implementar.

### 0.3 Commits

```
feat(fase-5): reporte de errores de cliente sin base de datos
fix(fase-4): cursor de push monótono en los seis carriles
chore(fase-2): modelo TTS versionado y verificado por hash
```

Revierte con `git revert <sha>` salvo que la fase diga otra cosa.

### 0.4 Reglas duras

- **Una fase = un commit.** Nada de refactors laterales «de paso».
- **Producción solo con la frase literal** `Autorizo migrar lecta y desplegar a producción.`
- **No se sube el presupuesto** de 215 kB ni se sube `--max-warnings` para pasar el gate.
- **No se reactiva el cache de Hyperdrive** `lecta-db`.
- **Ninguna prueba escribe en tablas `lexicon_*`**: el catálogo vive en `lecta_dev` y es el mismo
  que lee producción. Un test destructivo ahí rompe prod.
- **Ningún secreto** se imprime, se commitea ni se pega en el chat.

---

## 1. Tablero

| Fase | Entrega | Depende de | Bloquea a | Riesgo | Esf. | Gate extra |
|---|---|---|---|---|---|---|
| 0 | Decisiones + observability + checksum | — | 1 | — | — | ✅ cerrada |
| 1 | Prod migrada y desplegada | 0, auth de wrangler | 2, 5 | **Alto** (única irreversible) | S | smoke contra prod |
| 2 | TTS 24 MB versionado y verificado | 1 (deploy) | — | Medio | M | `check-model` + e2e de voz |
| 3 | Arranque ≤ 193.5 kB | 0 | 5, 7 | Bajo | M | `test:e2e` |
| 4 | Cursor de sync veraz + índice | 0 | — | **Alto** (pérdida silenciosa de datos) | L | sync manual en dev |
| 5 | Errores de cliente observables | 3 (presupuesto) y 1 (logs) | 6 | Bajo | M | — |
| 6 | Cobertura real + MCP con pruebas | 4, 5 | 7 | Bajo | M | `test:coverage` |
| 7 | `Reader.tsx` ≤ 3 500 líneas (objetivo 3 000) | 3, 6 | — | **Alto** (monolito de 5 503 líneas) | L | `test:e2e` por extracción |
| 8 | ODbL descargable de verdad | — | — | Bajo | S | `curl -I` en prod |

**Paralelizables hoy:** 3 (peso) y 4 (sync) no dependen de producción. La 2 sí necesita un deploy
para verificar el R2 real, pero el código se puede escribir antes.
**Orden recomendado:** 3 → 4 → 1 → 2 → 5 → 6 → 7 → 8 si hay que esperar credenciales; 1 primero
si ya las hay, porque desbloquea el resto.

## 2. Grafo de dependencias

```
Fase 0 (decisiones) ──┬─→ Fase 1 (prod) ──→ Fase 2 (TTS/R2)
                      │                     └─→ Fase 5 (logs en prod)
                      ├─→ Fase 3 (peso) ──┬─→ Fase 5
                      │                   └─→ Fase 7
                      └─→ Fase 4 (sync) ──→ Fase 6 (cobertura) ──→ Fase 7
                                                               Fase 8 (independiente)
```

La Fase 3 va **antes** de la 5 porque el interruptor de errores añade UI y el presupuesto está al
95.8 %. La 6 va **antes** de la 7 porque la 7 es el refactor más grande del plan y conviene tener
red de cobertura antes de mover 5 503 líneas.

---

## 3. Fase 0 — Decisiones y precondiciones · **cerrada**

- [x] **0.1 Presupuesto JS:** se mantiene en 215.00 kB. Meta de la Fase 3: ≤ 193.5 kB (el aviso
      del 90 %). No se sube a 240 kB.
- [x] **0.2 ODbL:** Opción A, ejecutada en la Fase 8 (`public/lexicon/` ya existe, ver §11).
- [x] **0.3 Migraciones en prod:** 001–010 aplicadas; 011, 012 y 013 pendientes.
- [x] **0.4 Observabilidad:** `observability.logs.enabled` y `issues.enabled` en `wrangler.jsonc`.
- [x] **0.5 `MODEL_SHA256`:** documentado con el hash real; `--verify` aborta si falta.
- [x] **0.6 (nuevo) Gate único:** script `pnpm gate` en `package.json`; `pnpm lint` queda en 28
      warnings exactos, así que la regla es «no añadas ni uno».

**Evidencia:** `pnpm gate` verde; `node scripts/upload-model.mjs --verify` con `MODEL_SHA256`
vacío sale con código 1 y mensaje explícito; `wrangler.jsonc` con los dos bloques de
`observability`.

---

## 4. Fase 1 — Producción

| | |
|---|---|
| **Entrega** | Prod con esquema 001–013 y el árbol desplegado, sin ventana de rutas rotas |
| **Depende de** | Fase 0; `wrangler` autenticado; acceso a la base `lecta` |
| **Riesgo** | Alto — es la única fase irreversible de verdad |
| **Esfuerzo** | S (30–45 min, la mayor parte esperando los índices) |

**Por qué ahora:** 011 crea `user_books` y `/api/user/books` ya está desplegada: desplegar sin
migrar deja los EPUBs cloud en 500. 012 y 013 son índices; sin ellos el sync funciona, pero
CockroachDB hace top-k + filter sobre las tablas incrementales.

### 4.1 Precondiciones (no negociables)

```bash
pnpm exec wrangler whoami          # debe mostrar la cuenta, no "Not logged in"
pnpm gate                          # verde antes de tocar nada
git status --short                 # solo lo que vas a desplegar
```

Si `whoami` falla: `pnpm exec wrangler login` (interactivo) o `export CLOUDFLARE_API_TOKEN=…`.
Sin esto, `pnpm run deploy` muere y la fase no empieza.

Para la base, una de dos:

- añadir `DATABASE_URL_PROD` a `.env` (recomendado: `scripts/db-migrate.mjs:167` la usa tal cual), o
- confiar en la reescritura de `--prod`, que cambia `/lecta_dev` → `/lecta` en `DATABASE_URL`.

**Nunca** pegar la cadena de conexión en el chat ni en un commit.

### 4.2 Estado de partida (solo lectura)

```bash
node --env-file=.env --input-type=module -e '
import pg from "pg";
const url = process.env.DATABASE_URL_PROD ?? process.env.DATABASE_URL.replace("/lecta_dev", "/lecta");
const c = new pg.Client({ connectionString: url });
await c.connect();
const r = await c.query("select name from lecta_schema_migrations order by name");
console.log(r.rows.map((x) => x.name).join("\n"));
await c.end();'
```

Esperado: 10 líneas, de `001_user_annotations.sql` a `010_kindle_link_codes.sql`.

Si aparece `014_*` en `db/migrations/` (porque la Fase 4 se adelantó), entra en esta misma
ventana: la lista esperada pasa a terminar en `014_…`.

### 4.3 Migrar

```bash
pnpm db:migrate --prod
```

- Si 012/013 exceden el `statement_timeout`: `LECTA_MIGRATE_TIMEOUT_MS=300000 pnpm db:migrate --prod`.
- Si falla con `schema_locked`: `ALTER TABLE … SET (schema_locked = false)`, migrar, volver a
  bloquear. Lo dice el propio script; no lo saltes.
- El migrador compara `current_database()` con `LECTA_MIGRATE_TARGET=lecta` y **se niega** si la
  URL apunta a otro sitio. Ese guard es la red de seguridad: si salta, no lo rodees.
- **Si un `CREATE INDEX` se cuelga, no es la tabla: es la cola.** Un job `SCHEMA CHANGE GC` de
  cualquier `DROP INDEX`/`DROP TABLE` reciente ocupa la cola hasta que pasa `gc.ttlseconds`
  (4500 s = 75 min en esta base) y bloquea todos los cambios de esquema. Comprobación:
  `show jobs` → si hay un `SCHEMA CHANGE GC` en `waiting for MVCC GC`, espera; ni `CANCEL JOB`
  ni `PAUSE JOB` lo liberan. Lección del 2026-10-22: no crees índices de prueba y los borres el
  mismo día de una migración.
- **Un `CREATE INDEX` que incluye la PK completa se cuelga** (bug del cluster, verificado en
  `lecta_user_activity`, `lecta_user_reviews` y `lecta_user_knowledge`). CockroachDB ya añade las
  columnas de la PK de forma implícita, así que se dejan fuera las que la completan:
  `(user_id, ended_at, id)` → `(user_id, ended_at)`. El índice resultante en `SHOW INDEXES` sale
  con la PK añadida, que es el efecto buscado.

### 4.4 Desplegar

```bash
pnpm run deploy                    # vite build + wrangler deploy
pnpm exec wrangler deployments list | head -5
```

### 4.5 Smoke

```bash
SMOKE_URL=https://lecta.luis-sg9915.workers.dev pnpm smoke:auth
curl -sS https://lecta.luis-sg9915.workers.dev/api/health
# El modelo da 404 hoy: R2 no tiene ningún objeto en models/. Se sube en la Fase 2.
curl -sSI https://lecta.luis-sg9915.workers.dev/models/kitten-tts-quantized.onnx | head -3
```

**Ojo con `smoke:auth`:** no es de solo lectura. Crea **dos cuentas reales** en producción
(`…-a@` y `…-b@`), sube un EPUB falso a R2 y escribe vocab/posiciones. No borra nada al terminar.
Por eso: se corre **una vez por deploy relevante**, no en bucle, y se anotan las dos cuentas para
purgarlas cuando haga falta. No llama a `enrich` con sesión (solo comprueba los 401), así que no
gasta tokens de IA.

### 4.6 Vigilar

```bash
timeout 600 pnpm exec wrangler tail --format json > /tmp/lecta-tail.jsonl || true
grep -c '"event"' /tmp/lecta-tail.jsonl; grep -i '"level":"error"' /tmp/lecta-tail.jsonl | head
```

Esperado: 10 minutos sin errores 500 ni `[worker-error]` repetidos.

### 4.7 Criterios de aceptación

| # | Criterio | Cómo se comprueba | Esperado |
|---|---|---|---|
| 1 | Esquema al día | re-ejecutar §4.2 | 13 filas, termina en `013_…` |
| 2 | Worker sano | `curl /api/health` | `{"status":"ok"}` |
| 3 | Auth y aislamiento | `pnpm smoke:auth` | `Todas las pruebas pasaron.` |
| 4 | Kindle | `verifyKindleLinkSmokeTest` (incluido en 3) | código de 4 letras válido |
| 5 | EPUBs cloud | `smoke:auth` sube y lista `/api/books` | 200 y el libro aparece |
| 6 | Sin errores nuevos | §4.6 | 0 errores 5xx |

El modelo (`/models/…`) **hoy devuelve 404** y no es criterio de esta fase: R2 no tiene ningún
objeto en `models/` y el binario se sube en la Fase 2 (§5). Verificado el 2026-10-22 con
`wrangler r2 object get`: «The specified key does not exist.»

**Ejecutado el 2026-10-22:** los seis criterios verdes. `pnpm smoke:auth` pasó entero,
`/api/health` 200, `wrangler tail` sin errores, migraciones 001–013 registradas y worker
`9e8242d0` desplegado. Dos matices que quedaron en `AGENTS.md`: `smoke:auth` deja dos cuentas
`@smoke.test` en producción, y tres índices se crearon con las columnas de filtro en vez de
repetir la PK (efecto idéntico, ver la nota de PK completa en §4.3).

### 4.8 Señales de fallo

- `migrate` dice que la base no coincide → la URL no es `lecta`. No insistas.
- `/api/user/books` 500 después de desplegar → 011 no se aplicó (o se aplicó en `lecta_dev`).
- `smoke:auth` falla en `sign-up` → Better Auth o `BETTER_AUTH_URL`; revisa logs antes de tocar nada.
- El deploy sube pero el asset no cambia → `vite build` cacheado; `rm -rf dist` y reintenta.

### 4.9 Rollback

```bash
pnpm exec wrangler rollback --name lecta
```

Las migraciones son aditivas (`CREATE TABLE/INDEX IF NOT EXISTS`): no hay que revertirlas. El
rollback del worker basta para volver al comportamiento anterior.

### 4.10 No hacer

- `pnpm db:setup` contra prod (recrea esquema).
- Editar `DATABASE_URL` de `.env` (debe seguir en `lecta_dev`).
- Desplegar antes de migrar: rompe EPUBs cloud.
- Correr `smoke:auth` contra prod en cada commit.

---

## 5. Fase 2 — Kitten TTS: un binario, una versión, un hash

| | |
|---|---|
| **Entrega** | Modelo 24 MB identificable, verificado y cacheado sin ambigüedad |
| **Depende de** | Fase 1 (para verificar contra prod), credenciales R2 |
| **Riesgo** | Medio — un fallo deja la voz HD descargando 24 MB para nada |
| **Esfuerzo** | M |

**Por qué:** verificado el 2026-10-22, la cadena está rota desde el primer eslabón.

1. **R2 no tiene ningún objeto** en `models/` (`wrangler r2 object get` → «The specified key does
   not exist»), así que `/models/…` devuelve 404. El bucket `lecta-books` existe y el binding
   `env.BOOKS` está en la versión desplegada: falta el binario, no la infraestructura.
2. Como `/models/…` falla, el cliente cae al primer fallback, que es **v0.1**. Es decir: la «Voz
   Neural HD» que se descargan hoy los usuarios **no es la v0.8-int8** que documenta `AGENTS.md`.
3. La caché `lecta-kitten-tts-v1` **no tiene versión**: cuando el modelo cambie, el navegador
   seguirá sirviendo el viejo desde CacheStorage, porque `isModelDownloaded` solo mira estado y
   `content-type`. Y el cliente guarda el fallback **bajo la URL primaria**
   (`kittenTtsEngine.ts:322`), así que la procedencia se pierde.
4. La ruta sirve `immutable` durante un año a un nombre sin versión: si el binario cambia, el
   navegador no se entera.
5. Nada verifica el hash en el cliente: la única validación es «pesa más de 10 MB».

### 5.1 Cambios

1. **Nombre versionado** en los tres sitios a la vez: `kitten-tts-nano-0.8-int8-v1.onnx` en
   `MODEL_FILENAME` (upload), `KITTEN_MODEL_URL` (cliente) y `scripts/check-model.mjs`.
2. **Caché versionada:** `KITTEN_CACHE_NAME = "lecta-kitten-tts-v2"`. Sin esto, cambiar la URL no
   invalida lo cacheado (el cliente guarda el fallback bajo la URL primaria,
   `kittenTtsEngine.ts:322`).
3. **Hash en el cliente:** constante `KITTEN_MODEL_SHA256`, `crypto.subtle.digest("SHA-256")`
   sobre el `Blob` **antes** de `cache.put`. Si no coincide: `this.progress = error`, no se escribe
   caché, se libera el blob. Almacenar `x-model-sha256` en la `Response` cacheada y comparar ese
   header en `isModelDownloaded` — **no** recalcular 24 MB de hash en cada arranque.
4. **Fallbacks:** se eliminan. Es un DLC opcional; R2 + caché de Cloudflare basta. Si se decide
   mantenerlos, deben ser la **misma** versión y el **mismo** hash, y `KITTEN_MODEL_CDN_URL` deja
   de existir como v0.1.
5. **Ruta `/models/:filename`:** usar `bucket.head()` cuando el método es HEAD (hoy abre el cuerpo
   con `get()` y lo tira). Mantener `Content-Length`, `ETag`, `Cache-Control`.
6. **`scripts/check-model.mjs`:** HEAD a `${BASE_URL}/models/<archivo>`; exige 200,
   `Content-Length` = 24 369 971 ± 2 %, `ETag` y `Cache-Control` presentes. Sin credenciales → se
   corre a mano y en un workflow programado, no en cada PR.

### 5.2 Pasos

```bash
# 0. Hoy no hay nada en R2 y .cache/models no existe: esta subida descarga ~24 MB de HF,
#    verifica el hash y sube con el nombre nuevo (una sola pasada, sin copias).
MODEL_FILENAME=kitten-tts-nano-0.8-int8-v1.onnx \
MODEL_SHA256=f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc \
pnpm model:upload --verify

# 1. Verificar desde fuera
node scripts/check-model.mjs --url https://lecta.luis-sg9915.workers.dev

# 2. No hay objeto viejo que borrar: models/ estaba vacío. El paso de borrado de §5.5 solo
#    aplicará en una futura rotación de modelo.
```

### 5.3 Criterios de aceptación

| # | Criterio | Cómo | Esperado |
|---|---|---|---|
| 1 | R2 ya no está vacío | `wrangler r2 object get lecta-books/models/kitten-tts-nano-0.8-int8-v1.onnx --file=/tmp/m` | 24 369 971 bytes, hash `f7b0afcb…` |
| 2 | Objeto correcto servido | `check-model.mjs` | 200, tamaño exacto, ETag |
| 3 | Cliente cachea verificado | DevTools → Cache Storage | entrada con `x-model-sha256` correcto |
| 4 | Hash alterado no cachea | test unitario con digest falso | error de progreso, caché vacía |
| 5 | Recarga usa caché | segunda carga del lector | 0 peticiones de red al modelo |
| 6 | HEAD no lee cuerpo | `curl -I` + logs | 200 sin descarga |
| 7 | Nada de v0.1 | `grep -rn "0\\.1" src/client/lib/tts*` | 0 resultados |
| 8 | Presupuesto | `pnpm check:size` | ≤ 215 kB (sin cambios) |

**Ejecutado el 2026-10-22.** Modelo subido con hash verificado y servido en
`/models/kitten-tts-nano-0.8-int8-v1.onnx` (200, 24 369 971 bytes, ETag, `immutable`); la URL
vieja da 404 y no queda ninguna referencia a Hugging Face ni a v0.1 en el código. `check-model`
verde contra producción. Los criterios 3, 4, 5 y 6 se demuestran con pruebas unitarias
(`kittenNetworkStorage.test.ts` y `app.test.ts`): **no existe e2e de voz HD en el repo**, así
que ese gate del plan no se puede cumplir y no se marca como hecho. Desplegado el worker
`f69dd412` tras `pnpm gate` verde (169 archivos, 2 373 pruebas).

### 5.4 Señales de fallo

- La descarga se queda en 99 % → `Content-Length` del objeto no coincide con el real.
- `isModelDownloaded` devuelve `true` con un modelo viejo → la caché no se versionó (paso 2).
- El worker devuelve 200 pero el cliente recibe HTML → el fallback SPA sigue vivo; revisa que
  `content-type` no sea `text/html`.
- `wrangler r2 object delete` falla → no hay credenciales R2 de escritura, o el nombre del bucket
  está mal.
- `model:upload` baja 24 MB y aborta por hash → el binario de HF cambió; no lo subas «arreglando»
  el hash sin avisar: significa que el modelo ya no es el que documenta `AGENTS.md`.

### 5.5 Rollback

Revertir el commit. El objeto nuevo se queda en R2 sin que nadie lo referencie (24 MB, coste
despreciable) y el cliente anterior vuelve a su URL y a su fallback. No hay migración de datos.

### 5.6 No hacer

- Cambiar el nombre sin cambiar `KITTEN_MODEL_URL` y `KITTEN_CACHE_NAME` en el mismo commit.
- Confiar en `/models/*` de `public/_headers`: **no aplica**. `wrangler.jsonc` tiene
  `/models/*` en `assets.run_worker_first`, así que la petición la atiende el worker antes de
  tocar los assets. Los headers reales salen del código de la ruta.
- Validar el hash solo en el servidor: el navegador es quien cachea.

---

## 6. Fase 3 — Peso inicial

| | |
|---|---|
| **Entrega** | Arranque ≤ 193.5 kB gzip sin aviso, sin cambiar comportamiento |
| **Depende de** | Fase 0 |
| **Riesgo** | Bajo |
| **Esfuerzo** | M |

**Por qué:** 206.05 kB de 215 (95.8 %) con aviso activo. Cualquier modal nuevo revienta CI, y las
Fases 5 y 7 añaden código. Los culpables reales, medidos: `react-vendor` 66.0, `index` 43.5,
`CompanionProvider` 40.4, `idb` 16.8, `reading-location` 16.5 kB. **No** es `ai-pref` (3.6 kB).

### 6.1 Cambios, por rentabilidad

1. `CompanionPanel` (55.7 kB de fuente, arrastra `CompanionCloset`) y `CompanionCelebration` →
   `React.lazy` + `Suspense` dentro de `CompanionProvider.tsx` (líneas 546 y 565). Disparar el
   `import()` en idle para que la primera apertura no parpadee.
   `CompanionStage`/`CompanionButton` se quedan estáticos: se ven en la estantería.
2. `DiagnosticsModal` (11.5 kB) y `LegalNotice` (8.2 kB) → `lazy` en `App.tsx` (líneas 79-80,
   1505, 1509). Solo se montan con `showDiagnostics` / `showLegal`.
3. Investigar `reading-location` (16.5 kB): separar lo que no se usa en el primer render.
4. Solo si hace falta: `Icon` o `settings`.

### 6.2 Criterios de aceptación

| # | Criterio | Cómo | Esperado |
|---|---|---|---|
| 1 | Bajo el aviso | `pnpm run build && pnpm check:size` | ≤ 193.5 kB, **sin** línea de aviso |
| 2 | Sin regresión de precarga | contar `modulepreload` en `dist/client/index.html` | ≤ 15 |
| 3 | Sin saltos | e2e + apertura del panel de la mascota | sin CLS visible |
| 4 | Comportamiento igual | `pnpm gate` + `pnpm test:e2e` | verde |
| 5 | Chunks diferidos existen | `ls dist/client/assets \| grep -i companion` | chunk aparte, no en `index.html` |

**Ejecutado el 2026-10-22:** 206.05 → **176.08 kB** gzip (17.4 kB por debajo del aviso de 193.5),
CSS 32.92 → 19.84 kB, módulos iniciales 16 → 14 (13 `modulepreload` + 1 script). Chunks nuevos:
`CompanionPanel`, `CompanionCelebration`, `DiagnosticsModal`, `LegalNotice`. Gate verde (169
archivos, 2 373 pruebas, 28/28 warnings) y e2e 12/12 (chromium + webkit-iphone). Desplegado el
worker `e603dd4a`. Las pruebas que abren la hoja del compañero ahora esperan al chunk (antes
asumían montaje síncrono); `CompanionCelebration.test.ts` precarga el módulo porque con
temporizadores falsos el `import()` dinámico no resuelve.

### 6.3 Señales de fallo

- El tamaño baja pero el aviso sigue → el warning mira el 90 % de 215 (193.5); necesitas bajar de
  ahí, no de 206.
- `check:size` sube tras un `lazy` → el `modulepreload` del chunk diferido está en el HTML;
  `vite` lo hace si el `import()` se resuelve en el mismo tick.

### 6.4 Rollback

Revertir el commit. Sin migración ni estado.

### 6.5 No hacer

- `React.lazy` en `Shelf.tsx`: ahí no hay modales pesados (los que hay ya son `lazy`). Sería un
  cambio vacío.
- Diferir `CompanionStage`.
- Tocar `react-vendor` o `idb`: son dependencias, no código propio.
- Subir el presupuesto a 240 kB.

---

## 7. Fase 4 — Sync: cursor veraz e índice que lo sostenga

| | |
|---|---|
| **Entrega** | El cursor de push nunca adelanta a un dato no enviado; el pull no salta filas |
| **Depende de** | Fase 0 |
| **Riesgo** | **Alto** — un cursor mal avanzado pierde datos en silencio, y solo se nota al cambiar de dispositivo |
| **Esfuerzo** | L |

**Por qué:** `Date.now()` como cursor de push se repite en **seis** carriles (`vocab`, `knowledge`,
`annotations`, `activity`, `reviews`, `positions`). Si el usuario guarda una palabra mientras el
PUT está en vuelo, su sello queda por debajo del cursor y esa palabra **no se empuja nunca**. Y el
GET de vocab ordena por `(updated_at, form)` con el único índice `(user_id, language, updated_at)`
— el mismo top-k + filter que 013 corrigió para `knowledge`.

### 7.1 Cambios

1. `src/client/lib/sync-cursors.ts`: nueva `advanceSyncCursor(userId, key, stamp)` **monótona**
   (solo escribe si `stamp > actual`). Usarla también en los cursores de **pull**.
2. `pushWordsToServer` devuelve `{ ok, acceptedMax }`: recorre lotes y devuelve el máximo del
   **último lote confirmado**. Los seis carriles avanzan con ese valor, no con el reloj.
3. Eliminar la rama «`toPush` vacío y `lastPushedAt === 0` ⇒ escribir `Date.now()`».
4. Eliminar los fallbacks a cursores globales (`vocab`, `vocab:push`, `knowledge:push`) y dejar de
   escribirlos. Coste: un re-sync completo por idioma la primera vez; beneficio: no se saltan
   remotos antiguos al descubrir un idioma nuevo. Anotarlo en `docs/sistema-lecta.md`.
5. ~~Migración `014_vocab_sync_order_index.sql`~~ **descartada con evidencia**. El `EXPLAIN` en
   `lecta_dev` del GET de vocab (`user_id`, `language`, `updated_at > ?`,
   `ORDER BY updated_at, form`) usa `idx_user_words_user_lang_updated` con span directo y **sin
   nodo de sort ni top-k**: CockroachDB añade `form` al índice como columna implícita de la PK, así
   que el índice de 012 ya cumple el orden. Además, el índice propuesto incluía la PK completa
   (`user_id, language, form`) y ese patrón **se cuelga** en este cluster (§4.3). No hay migración
   que aplicar. Recomendación opcional de Cockroach para otra fase: cubrir con
   `STORING (lemma, pos, meaning, context, …)` para evitar el index join.

### 7.2 Criterios de aceptación (pruebas con nombre)

| # | Criterio | Prueba | Esperado |
|---|---|---|---|
| 1 | No usa el reloj | `sync-cursors.test.ts` con `Date.now` fijado en 9e15 | cursor = `max(updatedAt)` aceptado |
| 2 | Monótono | `advanceSyncCursor(u, "vocab", 100)` y luego `50` | se queda en 100 |
| 3 | Carrera | guardar palabra con el `fetch` pendiente | el siguiente sync la empuja |
| 4 | Lote parcial | lote 1 OK, lote 2 falla | cursor = máximo del lote 1 |
| 5 | Sin cursores globales | `grep -rn "vocab:push\\|knowledge:push" src/client` | 0 resultados |
| 6 | Índice usado | `EXPLAIN` del GET de vocab en `lecta_dev` | `idx_user_words_user_lang_updated`, sin sort |
| 7 | Sin duplicados | sync manual dev, dos pasadas | ids estables |

**Ejecutado el 2026-10-22.** Los seis carriles usan `advanceSyncCursor` con el `acceptedMax` del
push; no queda ninguna escritura de cursor con `Date.now()` (`grep` vacío) y los cursores globales
de vocabulario desaparecieron. Pruebas nuevas: `sync-cursors.test.ts` (monotonía, valores
corruptos, aislamiento por cuenta), y en `vocab.test.ts` el cursor no usa el reloj (`Date.now`
fijado en 9e15 → cursor 200), el lote parcial (501 palabras, segundo PUT rechazado → cursor 500) y
la carrera (palabra guardada durante el vuelo → se empuja en el ciclo siguiente). En
`reading-sync.test.ts`, la misma prueba de «no reloj» para anotaciones. **014 descartada** con el
`EXPLAIN` de arriba. El «sync manual en dev, dos pasadas» no se pudo hacer desde aquí: queda
pendiente de una pasada con la app abierta.

### 7.3 Señales de fallo

- El cursor avanza pero faltan palabras en el otro dispositivo → alguien sigue escribiendo
  `Date.now()` en un carril que no tocaste. Son seis; cuéntalos.
- `EXPLAIN` sigue haciendo scan: el índice no cubre `form` o el orden del `ORDER BY` no coincide.
- Las pruebas pasan solo con `fake timers` y fallan en e2e: el problema está en el orden de
  escritura, no en el reloj.

### 7.4 Rollback

Revertir el commit. La migración 014 es un índice: `DROP INDEX IF EXISTS` si molesta (no debería).
Al revertir, los cursores vuelven a `Date.now()`; el primer sync reenvía de más, nunca de menos.

### 7.5 No hacer

- Arreglar solo `vocab.ts`: son seis carriles.
- Usar `Date.now()` como respaldo «porque casi siempre funciona». Es exactamente el bug.
- Avanzar el cursor con lotes que no respondieron 200.
- Aplicar 014 a producción fuera de una ventana autorizada.

---

## 8. Fase 5 — Observabilidad de errores de cliente

| | |
|---|---|
| **Entrega** | Saber qué rompe en el navegador sin abrir un agujero de coste ni de privacidad |
| **Depende de** | Fase 3 (presupuesto) y Fase 1 (logs activos) |
| **Riesgo** | Bajo |
| **Esfuerzo** | M |

**Por qué:** el endpoint no existe. Sin límite, un bucle de errores martillea Hyperdrive; con
`message` libre se filtran textos del libro.

### 8.1 Diseño

- `POST /api/client-errors`, **sin sesión y sin base de datos**. Nunca llama a `withClient`.
  Se registra antes de las rutas de auth, junto a `/api/health` (`src/worker/app.ts:233`).
- Cuerpo máximo 2 kB. Allowlist estricta: `name`, `code`, `route` (solo pathname, sin query ni
  hash, y solo si empieza por una ruta conocida), `version` (build), `message` (≤ 200 chars, **solo
  si el usuario activó «incluir mensaje»**).
- Rechazo silencioso: campo extra, tipo raro o cuerpo grande ⇒ **204 igualmente** (no dar señal al
  atacante ni romper al cliente).
- Límite por IP (`CF-Connecting-IP`) en memoria del isolate: 30/min y 300/hora. Es un tope
  **por isolate**, no un rate limit global; la defensa real es que no toca la base. Anotarlo en el
  código para que nadie lo confunda con seguridad.
- Salida: `console.error(JSON.stringify({ event: "client_error", … }))` → Workers Logs.
- Cliente: huella `${name}|${code}|${route}`; una vez por sesión y máximo 5 por carga.
  `fetch(..., { keepalive: true })`, y si falla se ignora.
- Interruptores en `DiagnosticsModal.tsx`, dentro de `FeatureFlags` de `src/client/lib/settings.ts`
  (`shareClientErrors`, activado; `includeErrorMessage`, desactivado) — **no** en
  `loadSessionValue`: las flags ya tienen UI y persistencia.

### 8.2 Criterios de aceptación

| # | Criterio | Cómo | Esperado |
|---|---|---|---|
| 1 | Camino feliz | `curl -X POST /api/client-errors` con cuerpo válido | 204 + línea JSON en logs |
| 2 | Ruta saneada | `route: "/reader?book=abc#x"` | se registra `/reader` |
| 3 | Cuerpo sucio | campo extra o `message` de 10 kB | 204 y **nada** en logs |
| 4 | Tope | 40 peticiones seguidas | ≤ 30 registradas |
| 5 | Sin BD | `app.request` con un `env` **sin** `DATABASE_URL` | 204 igual (si tocara la BD daría 503) |
| 6 | Interruptor | flag apagada | 0 peticiones de red |

Las pruebas 1–4 se hacen con `app.request` (Hono) en unit, no contra prod: deterministas y gratis.
La 5 es la que evita la regresión cara.

**Ejecutado el 2026-10-22.** `src/worker/client-errors.ts` (allowlist, saneo de ruta, límites) y
`src/client/lib/client-errors.ts` (huella por sesión, máximo 5 por carga, `keepalive`). Enganchado
en `ErrorBoundary.componentDidCatch`, `window.onerror` y `unhandledrejection`; interruptores
`shareClientErrors` (on) e `includeErrorMessage` (off) en `FeatureFlags`, con su UI en Diagnóstico.
Verificado contra producción con `wrangler tail`: el reporte válido responde 204 y deja
`{"event":"client_error",...,"route":"/reader","version":"prod"}`; el cuerpo con `stack` y el de
10 kB responden 204 y **no** dejan nada. El código de Kindle (`/k/ABCD`) se registra como `/k/*`
para no filtrar el código de vinculación. Pruebas: 24 nuevas (worker + cliente), gate en 172
archivos / 2 414 pruebas. Desplegado `53165f0f`.

### 8.3 Señales de fallo

- 204 pero no aparece nada en logs → el endpoint está detrás del handler de errores o el
  `console.error` va con un nivel filtrado.
- Un bucle llena los logs → el dedupe por huella no está respetando «una por sesión».

### 8.4 Rollback

Revertir. Sin migración. Si el endpoint quedó desplegado y molesta, apagar la flag desde
diagnóstico (el cliente deja de enviar) sin desplegar.

### 8.5 No hacer

- Loguear el `message` por defecto.
- Escribir errores en la base: multiplica RUs y es el vector de abuso más caro.
- Poner el endpoint detrás de sesión: la mitad de los errores interesantes son de sesión inválida.

---

## 9. Fase 6 — Cobertura real y MCP con pruebas

| | |
|---|---|
| **Entrega** | Los huecos de cobertura cerrados y `mcp/src/tools.ts` con pruebas |
| **Depende de** | Fases 4 y 5 (para que los umbrales nuevos no nazcan viejos) |
| **Riesgo** | Bajo |
| **Esfuerzo** | M |

### 9.1 Cambios

- `src/client/lib/use-page-gesture.ts`: 64.8 % sentencias / 56.3 % funciones / 0 % ramas → ≥ 85 %
  de sentencias.
- `src/client/lib/page-gesture.ts`: 100 % sentencias pero 18.8 % ramas → ≥ 60 % de ramas.
- Umbrales por archivo en `vitest.config.ts`, además de los globales:
  ```ts
  thresholds: {
    lines: 75,
    functions: 72,
    "src/shared/**": { lines: 85, functions: 90 },
    "src/client/lib/**": { lines: 75, functions: 72 },
    "src/client/lib/use-page-gesture.ts": { lines: 85, functions: 80 },
    "src/client/lib/page-gesture.ts": { branches: 60 },
  },
  ```
- `mcp/src/tools.ts` (1 241 líneas, 12 herramientas, cero pruebas): tabla de casos que recorra las
  herramientas **registradas** — nombre presente, entrada válida con zod, camino feliz con `fetch`
  mockeado, y un error HTTP por herramienta.
- Añadir `mcp/src/**/*.ts` a `coverage.include` (hoy MCP queda fuera de la cobertura).

### 9.2 Criterios de aceptación

| # | Criterio | Cómo | Esperado |
|---|---|---|---|
| 1 | Umbrales nuevos verdes | `pnpm test:coverage` | exit 0 |
| 2 | Cada herramienta cubierta | contar `registerTool` vs casos | 12/12 con feliz + error |
| 3 | MCP en cobertura | `coverage/coverage-summary.json` | incluye `mcp/src` |
| 4 | Sin tocar el catálogo | `grep -rn "lexicon_" mcp/src --include=*.test.ts` | 0 escrituras |
| 5 | A11y | `pnpm test:e2e` + axe en pantallas de Fases 3 y 5 | verde |

### 9.3 Señales de fallo

- Los umbrales pasan pero el informe no incluye el archivo → `coverage.include` no lo matchea.
- Tests de MCP que necesitan red → están llamando a `fetch` real; mockea `globalThis.fetch`.

### 9.4 Rollback

Revertir. Los umbrales vuelven a los globales.

### 9.5 No hacer

- Bajar el umbral global para compensar.
- Probar `tools.ts` contra la API real: es lento, gasta RUs y depende de datos.
- Escribir en `lexicon_*` desde un test: el catálogo de `lecta_dev` es el de producción.

---

## 10. Fase 7 — Partir `Reader.tsx`

| | |
|---|---|
| **Entrega** | `Reader.tsx` ≤ 3 000 líneas sin cambiar comportamiento |
| **Depende de** | Fases 3 (peso) y 6 (cobertura) |
| **Riesgo** | **Alto** — 5 503 líneas, el componente más crítico de la app |
| **Esfuerzo** | L |

**Realidad del repo:** ya existe `src/client/components/reader/` con `ReaderOverlays.tsx`,
`ReaderTopBar.tsx` y `ReaderSearchAndTocSheet.tsx`; `SmartReaderDock.tsx` ya está fuera. No se
parte de cero y no se inventan `ReaderContent`/`ReaderDock` «nuevos» sin mirar eso.

### 10.1 Invariantes

- Se conserva `export default Reader` con las mismas props.
- Se conservan los exports nombrados `recordDominated` y `PRESET_LABELS`
  (`Reader.test.ts:6` y `:119` los importan).
- Las reglas CSS que verifican `Reader.test.ts:348` y `:367` siguen en
  `src/client/styles/reader.css`. Si se parte el CSS, se actualizan las rutas en el **mismo**
  commit.
- Cada extracción es un commit con `pnpm gate` + `pnpm test:e2e` verdes. Si el e2e falla, se
  revierte esa extracción, no se «arregla» la prueba.

### 10.2 Orden de extracción (de menor a mayor acoplamiento)

| # | Archivo nuevo | Qué se lleva | Líneas objetivo | Verificación |
|---|---|---|---|---|
| 1 | `reader/useReaderTts.ts` | estado del motor, lookahead, voz, reproducción | −400 | e2e de voz |
| 2 | `reader/ReaderChrome.tsx` | barra superior, progreso, cabecera de capítulo | −350 | e2e |
| 3 | `reader/ReaderContent.tsx` | canal de render (foliate), selección, resaltado | −600 | e2e + selección |
| 4 | `reader/ReaderDockHost.tsx` | cableado de `SmartReaderDock` y modos | −250 | e2e |

Sobran ~1 100 líneas de margen: el objetivo es ≤ 3 000, el mínimo aceptable 3 500. Si al terminar
la 4 sigues por encima de 3 500, **no** fuerces una quinta extracción: documenta qué queda acoplado
y para.

### 10.3 Criterios de aceptación

| # | Criterio | Cómo | Esperado |
|---|---|---|---|
| 1 | Tamaño | `wc -l src/client/components/Reader.tsx` | ≤ 3 500 (objetivo 3 000) |
| 2 | Sin cambio de comportamiento | `pnpm gate` + `pnpm test:e2e` tras cada extracción | verde |
| 3 | Exports intactos | `grep -n "export default\\|recordDominated\\|PRESET_LABELS"` | presentes |
| 4 | CSS donde toca | `grep -n "reader.css" src/client/components/Reader.test.ts` | 2 coincidencias, rutas válidas |
| 5 | Peso intacto | `pnpm check:size` | igual o mejor que antes de la fase |

### 10.4 Señales de fallo

- Sube el CSS o el JS inicial → `Reader` ya era `lazy`; si sube es que algo se importa estático.
- Una prueba de arquitectura falla y «se arregla» cambiando el assert → estás rompiendo el
  invariante. Revierte.

### 10.5 Rollback

`git revert` de la extracción concreta. Cada una es independiente.

### 10.6 No hacer

- Crear un helper en `Reader.test.ts` para concatenar `.tsx`: **ninguna prueba lee `Reader.tsx`
  como texto** (leen `reader.css`).
- Extraer dos cosas en un commit.
- Cambiar nombres de props «de paso».

---

## 11. Fase 8 — Legal / ODbL

| | |
|---|---|
| **Entrega** | La afirmación de `LegalNotice.tsx` es verdadera y el enlace resuelve |
| **Depende de** | Nada |
| **Riesgo** | Bajo |
| **Esfuerzo** | S |

**Estado:** el texto promete la tabla forma→lema descargable en
`github.com/lecta-app/lecta-lexicon-data`, y ese repositorio responde **404** al visitante anónimo.
`LegalNotice.test.ts` fija esa cadena. La tabla existe en local: `data/lexicon/es-forms.tsv`
(14 423 009 bytes, TSV, `data/` está en `.gitignore`), que comprime a **1.89 MB**.

`public/lexicon/` **ya existe** (contiene `locuciones.es.json`, 2.29 MB) y `public/_headers` ya
tiene una regla `/lexicon/*` con `max-age=86400`. No hay que crear nada de cero.

### 11.1 Opción A (recomendada)

```bash
gzip -9 -c data/lexicon/es-forms.tsv > public/lexicon/forms-es.tsv.gz
ls -l public/lexicon/forms-es.tsv.gz   # ≈ 1.89 MB
```

1. `public/lexicon/README.md`: autoría, licencia ODbL 1.0, fecha y método de derivación (§4.3 y
   §4.6).
2. `public/_headers`: bloque específico **antes** del genérico `/lexicon/*` para que el `.gz` se
   descargue como archivo y no se sirva como texto:
   ```
   /lexicon/forms-es.tsv.gz
     Content-Type: application/gzip
     Content-Disposition: attachment; filename="forms-es.tsv.gz"
   ```
   Verifica el resultado con `curl -I`: en Cloudflare las reglas se combinan, así que **comprueba
   que gana la específica**; si no, mete las dos cabeceras en la regla genérica.
3. `LegalNotice.tsx`: enlace a `/lexicon/forms-es.tsv.gz` y «`.csv`» → «`.tsv`» (es lo que se
   exporta de verdad).
4. Prueba de regresión: el `href` empieza por `/lexicon/` **y** el archivo existe en `public/`
   (`fs.existsSync`), para que no vuelva a prometerse algo inexistente.
5. `docs/licencias-lexico.md` actualizado con la ubicación real.

### 11.2 Criterios de aceptación

| # | Criterio | Cómo | Esperado |
|---|---|---|---|
| 1 | Enlace real | `curl -I https://lecta.luis-sg9915.workers.dev/lexicon/forms-es.tsv.gz` | 200, `application/gzip`, tamaño ≈ 1.89 MB |
| 2 | Texto y archivo coinciden | `LegalNotice.test.ts` | verde con la comprobación de existencia |
| 3 | Sin 404 residual | `grep -rn "lecta-lexicon-data" src docs` | 0 resultados |
| 4 | No infla el bundle | `pnpm check:size` | sin cambios (es un asset estático) |
| 5 | Dentro de límites | `pnpm run deploy` | ningún error de tamaño por archivo |

### 11.3 Señales de fallo

- El `.gz` se sirve como `text/plain` y el navegador lo muestra en vez de descargarlo → gana la
  regla genérica; reordena o unifica.
- 200 en local y 404 en prod → el archivo no está en `public/` o no se redeployó.

### 11.4 Rollback

Revertir. El archivo en `public/` se puede borrar sin efectos: nadie lo referencia.

### 11.5 No hacer

- Cambiar el enlace a `/lexicon/...` **antes** de que el archivo exista: es otro 404 con más pasos.
- Meter el TSV crudo (14.4 MB) en `public/`: gzip obligatorio.
- Publicar el derivado sin la atribución ODbL del §4.

---

## 12. Riesgos transversales

1. **El catálogo léxico es compartido.** `src/worker/lexicon.ts` consulta `lecta_dev.lexicon_*`
   desde producción. Un test o un script que escriba ahí **modifica lo que leen los usuarios**.
   Vale para las Fases 4, 6 y cualquier script nuevo.
2. **Lint sin margen.** 28 de 28. Un warning nuevo tumba el gate de cualquier fase.
3. **Presupuesto de JS al 95.8 %.** Cualquier import estático nuevo (modales de las Fases 5 y 7)
   debe entrar como `lazy`.
4. **Hyperdrive sin cache, a propósito.** No lo reactives para «mejorar» latencia: ya rompió auth
   una vez.
5. **Segunda ventana de producción.** Si la Fase 4 crea `014_*` después de la Fase 1, queda una
   migración pendiente en prod. Anótala en `AGENTS.md` en el mismo commit; no la apliques sin
   autorización.
6. **`pnpm run build` borra `dist/lecta/.dev.vars`.** Para probar auth/IA en local usa
   `pnpm preview:local`.
7. **E2E construye.** `pnpm test:e2e` levanta `vite preview` y hace `build`; no lo corras en
   paralelo con otro `build` (se pisan `dist/`).

## 13. Registro de decisiones

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-10-22 | Presupuesto JS se queda en 215 kB; meta 193.5 en Fase 3 | Bajar el límite sin medir habría roto CI |
| 2026-10-22 | ODbL en Fase 8, Opción A (asset propio) | No depender de un repo de GitHub que da 404 |
| 2026-10-22 | `observability.logs` activado | Sin logs, la Fase 5 no sirve de nada |
| 2026-10-22 | `MODEL_SHA256` obligatorio con `--verify` | Un «verificar» que no verifica es peor que nada |
| 2026-10-22 | Gate único `pnpm gate` | Cinco comandos a mano se olvidan; uno no |
| 2026-10-22 | `smoke:auth` deja 2 cuentas en prod | Se acepta y se documenta; no hay borrado automático |

## 14. Qué cambió respecto a la v1

- **Criterios verificables**: cada criterio tiene comando y salida esperada (§4.7, §5.3, …). Antes
  eran frases.
- **Gate único** `pnpm gate` en vez de cinco comandos sueltos.
- **Fase 1**: se documenta que `smoke:auth` **escribe** en producción; se añade el paso de
  `deployments list`, el `tail` con timeout y la regla de que 014 entra en la misma ventana.
- **Fase 2**: se añade versionar la **caché** (no solo la URL), no recalcular el hash en cada
  arranque, borrar el objeto viejo de R2, y se aclara que `public/_headers` **no** aplica a
  `/models`.
- **Fase 2 (verificado en producción el 2026-10-22)**: R2 está **vacío**. El plan anterior daba
  por hecho que el binario estaba subido; no lo está, y el cliente lleva meses cayendo al fallback
  **v0.1**. La subida inicial pasa a ser el primer paso de la fase, y la Fase 1 deja de exigir
  `/models` 200.
- **Fase 3**: se explica de dónde sale el 193.5 (90 % de 215) y que hay que medir después de
  cada cambio, no al final.
- **Fase 4**: pruebas con nombre, la regla de una sola ventana de producción para 014 y la lista
  explícita de los seis carriles.
- **Fase 5**: los interruptores van a `FeatureFlags` (ya existen), no a `loadSessionValue`; el
  límite por IP se documenta como tope por isolate, no como seguridad.
- **Fase 6**: tabla de umbrales completa, MCP dentro de `coverage.include`, prohibición de escribir
  en `lexicon_*`.
- **Fase 7**: tabla de extracciones con líneas objetivo y la regla «si el e2e falla, revierte».
- **Fase 8**: `public/lexicon/` ya existe; se añade `_headers` para el `.gz` y la comprobación de
  que la regla específica gana.
- **§12 Riesgos transversales** y **§13 Registro de decisiones**: nuevos.

## 15. Apéndice — premisas que no se deben repetir

| Afirmación | Realidad |
|---|---|
| `mcp/` está fuera de `pnpm typecheck` | `typecheck` encadena `pnpm mcp:typecheck`, que tipa fuente **y** pruebas. |
| El chunk `ai-pref` pesa ~44 kB | Pesa 3.6 kB. El nombre del chunk no identifica su contenido. |
| `Shelf.tsx` importa modales pesados | No los importa. `RestoreBackupDialog` ya es `lazy`; los demás viven en `Vocabulary`, `ReaderMoreMenu` y `ReaderOverlays`. |
| `/models` no soporta HEAD ni expone ETag | Ya soporta HEAD con `Content-Length`, `ETag` y `Cache-Control`. Solo falta usar `head()`. |
| `public/_headers` controla `/models` | No: `/models/*` está en `assets.run_worker_first` de `wrangler.jsonc` y lo sirve el worker. Los headers salen del código. |
| `Reader.test.ts` lee `Reader.tsx` con `readFileSync` | Lee `src/client/styles/reader.css`. No hay que concatenar fuentes. |
| El cursor de push defectuoso es solo de `vocab` | Son seis carriles: vocab, knowledge, annotations, activity, reviews, positions. |
| `smoke:auth` es un smoke de solo lectura | Crea 2 usuarios, sube un EPUB a R2 y escribe vocab en la base que apuntes. |
| El modelo está en R2 | R2 no tiene ningún objeto en `models/` (verificado el 2026-10-22): `/models/…` da 404 y los usuarios descargan **v0.1** por el fallback. La subida inicial es parte de la Fase 2. |
| La Fase 8 puede esperar al final | La afirmación de descarga pública ya está en la app y el enlace da 404. |
| `public/lexicon/` hay que crearlo | Ya existe (con `locuciones.es.json`) y ya tiene regla de caché en `_headers`. |
