# El sistema Lecta — contexto técnico para IA

Este documento describe cómo funciona Lecta de punta a punta, con el
detalle suficiente para que una IA (o una persona nueva en el
proyecto) entienda la arquitectura, los datos y las reglas sin tener
que releer todo el código. Es un mapa: para el detalle fino, cada
sección apunta al archivo donde vive la verdad.

Actualizado contra el código al commit `ae1f9ab` (compañero felino
con sync entre dispositivos). Si algo contradice al código, gana el
código.

---

## 1. Qué es Lecta

Lecta es un **lector de EPUB en español con aprendizaje de vocabulario
integrado**. La persona lee libros; al tocar una palabra ve su
definición, la guarda en un cuaderno y la repasa después con
repetición espaciada (FSRS). Antes de cada capítulo, la app predice
qué palabras probablemente no conoce y ofrece marcarlas ("Antes de
leer"). Un gato compañero da puntos, niveles y logros por leer.

Funciona **sin conexión** (todo vive primero en IndexedDB) y **sin
cuenta** (uso anónimo); al crear cuenta, los datos anónimos migran y
empiezan a sincronizarse entre dispositivos.

Audiencia: lectores que quieren ampliar vocabulario leyendo. La
interfaz está en español (México) y usa palabras sencillas; los
comentarios del código también están en español.

---

## 2. Arquitectura de un vistazo

```
┌─────────────────────────── CLIENTE (navegador) ───────────────────────────┐
│ React 19 + TS + Vite 8 — SPA, assets estáticos servidos por el Worker     │
│                                                                           │
│  UI (components/)        Libs puras y acceso (lib/)         Datos locales │
│  · Shelf (estantería)    · epub.ts / chapters.ts            IndexedDB     │
│  · Reader (lector)       · words.ts / section-words.ts      por cuenta:   │
│  · WordPanel (ficha)     · knowledge.ts (perfil+predicción) "lecta"       │
│  · Vocabulary (cuaderno) · fsrs.ts / learn.ts / practice.ts   (anónimo)   │
│  · Account / Calibration · idb.ts (stores + scope)          "lecta:u:id"  │
│  · Companion (gato)      · *-sync.ts (merge con servidor)                 │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │ fetch /api/* (cookie de sesión Better Auth)
┌──────────────────────────────▼────────────────────────────────────────────┐
│ WORKER (Cloudflare Workers + Hono 4)   src/worker/index.ts → app.ts       │
│                                                                           │
│  /api/auth/*   Better Auth 1.7 (magic link, correo+contraseña, borrado)   │
│  /api/books/*  EPUBs del usuario en R2  (books/<userId>/<hash>.epub)      │
│  /api/catalog* Catálogo público en R2   (catalog/index.json …)            │
│  /api/lexicon/* Catálogo léxico + IA (DeepSeek)                           │
│  /api/vocab|annotations|activity|reviews|positions|knowledge  sync        │
│  /api/companion  estado del gato (merge transaccional)                    │
│                                                                           │
│  scheduled() diario: borra sesiones/verificaciones vencidas y rate_log    │
│  Workflow: EnrichmentWorkflow — enriquecimiento léxico en segundo plano   │
└───────┬───────────────────────────┬──────────────────────┬───────────────┘
        │ Hyperdrive (pg por request, sin pools globales)
        ▼                           ▼                      ▼
  CockroachDB (2 bases)      Cloudflare R2          DeepSeek API
  `lecta`      = producción  `lecta-books`          (vía AI Gateway
  `lecta_dev`  = desarrollo   books/<uid>/…          opcional o directo)
     + catálogo léxico        catalog/…
       COMPARTIDO (único,
       se consulta como
       "lecta_dev.lexicon_*"
       también desde prod)
```

**Regla de oro de datos**: el catálogo léxico (`lexicon_*`) existe una
sola vez, en `lecta_dev`, y el worker lo consulta con nombre calificado
(`CATALOG = "lecta_dev."` en `src/worker/lexicon.ts`). Los datos de
usuario (`lecta_user_*`, tablas de Better Auth) van en la base del
entorno: `lecta` en prod, `lecta_dev` en dev. No duplicar `lexicon_*`
en `lecta`.

---

## 3. Stack y dependencias

**Cliente**
- React 19 + TypeScript, build con Vite 8. Sin framework de rutas:
  `App.tsx` es una máquina de vistas + hojas modales; `history.ts`
  sincroniza la pila de capas con el botón "atrás" del navegador.
- `foliate-js` 1.0 abre y pagina EPUBs; `@zip.js/zip.js` los descomprime
  en memoria.
- `idb` 8 para IndexedDB; `ts-fsrs` para la repetición espaciada.
- `dompurify` sanitiza el HTML de cada sección del EPUB.
- Vitest para pruebas (`pnpm test`).

**Worker**
- Cloudflare Workers + Hono. Cada request abre su conexión `pg` a través
  del binding Hyperdrive (`withClient()` en `src/worker/db.ts`); los
  sockets no sobreviven entre invocaciones y **está prohibido** crear
  pools globales.
- `better-auth` + `kysely` para cuentas; `resend` para correo.
- Cloudflare Workflows (`lecta-enrichment`) para definir palabras en
  segundo plano.
- Cron `0 5 * * *` (diario): purga `session`/`verification` vencidas y
  `lecta_rate_log` > 48 h.

**Datos**
- CockroachDB (compatible con Postgres, driver `pg` 8.23).
- R2: bucket `lecta-books` con dos prefijos: `books/<userId>/` (privado)
  y `catalog/` (público).
- IndexedDB local por cuenta, versión 9, 12 stores.

**IA**
- DeepSeek (`deepseek-flash` vía `callDeepSeek` en `src/worker/ai.ts`),
  opcionalmente a través de un AI Gateway de Cloudflare
  (`AI_GATEWAY_URL`; vacío = `api.deepseek.com` directo).
- Cuatro operaciones: `enrich` (fichas nuevas), `item` (ejercicios),
  `verify` (corregir oración escrita por el lector), `explain`
  (explicación en contexto). Cada una tiene tope de tokens y cuota
  horaria propia.

---

## 4. Modelo de datos

### 4.1 IndexedDB local (`src/client/lib/idb.ts`, DB_VERSION 9)

Una base por cuenta: `lecta` para anónimo, `lecta:u:<userId>` al entrar
sesión. `captureDbScope()` congela la cuenta activa al iniciar una
operación y `isDbScopeActive()` aborta escrituras si la cuenta cambió a
mitad del proceso (`StaleScopeError`) — protección clave contra datos
mezclados entre cuentas.

| Store | Contenido |
|---|---|
| `books` | EPUB + portada + metas, por `hash` (sha256 del archivo) |
| `positions` | Posición de lectura por `bookHash` (sección, scroll/ancla, ratio, progreso) |
| `session` | Pares clave/valor de sesión (último libro, borradores, prefs del juego…) |
| `savedWords` | Cuaderno: palabra + significado + contexto + tarjeta FSRS + lápida |
| `annotations` | Marcadores y pasajes subrayados, con lápida |
| `activity` | Intervalos de lectura (inicio/fin, sección, palabras, regresiones) — inmutable |
| `reviews` | Historial de repasos FSRS — inmutable |
| `knowledge` | Evidencia «conozco / no conozco» por lema, con lápida |
| `readingEvents` | Trayecto de lectura local (telemetría, 90 días, nunca se sube) |
| `bookOps` | Cola persistente de subidas/borrados de EPUB a R2 |
| `companionEvents` | Journal de eventos del juego (XP, cuidados…) |
| `companionReceipts` | Recibos monotónicos (logros vistos, cofres abiertos) |

Al iniciar sesión, lo anónimo migra a la base de la cuenta con
arbitraje por sello de tiempo.

### 4.2 SQL — base del entorno (`lecta` / `lecta_dev`)

Tablas de Better Auth: `user`, `session`, `account`, `verification`.

| Tabla | Migración | Contenido |
|---|---|---|
| `lecta_user_words` | schema.sql | Cuaderno (mirror de `savedWords`, con `sense_entry_id`/`sense_order` al catálogo) |
| `lecta_rate_log` | schema.sql | Cuotas IA por usuario/scope/hora |
| `lecta_user_annotations` | 001 | Marcadores y pasajes |
| `lecta_user_activity` | 002 | Intervalos de lectura |
| `lecta_user_reviews` | 004 | Repasos FSRS |
| `lecta_user_positions` | 005 | Posición por libro |
| `lecta_user_knowledge` | 007 | Evidencia de conocimiento |
| `lecta_user_companion_baselines` | 009 | Punto de corte de migración del juego |
| `lecta_user_companion_events` | 009 | Journal de eventos del gato |
| `lecta_user_companion_fields` | 009 | Registros arbitrados por sello (nombre, color, preferencias) |
| `lecta_user_companion_receipts` | 009 | Recibos (uniones monotónicas) |

Todas las tablas `lecta_user_*` llevan `user_id` con `ON DELETE
CASCADE` a `user`: borrar la cuenta borra sus filas solas.

### 4.3 SQL — catálogo léxico compartido (solo `lecta_dev`)

| Tabla | Contenido |
|---|---|
| `lexicon_entries` | Lema, `pos` (categoría), `freq_rank`, `zipf`, idioma |
| `lexicon_forms` | Forma flexionada → `entry_id` (+ bases clíticas y de «-mente») |
| `lexicon_senses` | Acepciones: definición, ejemplo, `source` (`wiktionary` / `ai` / NULL) |
| `lexicon_sources` | Procedencia de la carga (003) |
| `lexicon_items` | Ejercicios generados por IA (oración + distractores) (006) |

Los `entry_id` son `int8` de CockroachDB — pueden pasar de 2^53, así
que **viajan como string** en JSON y en IndexedDB. Nunca convertirlos
con `Number()`.

### 4.4 R2 (`lecta-books`)

- `books/<userId>/<sha256>.epub` — biblioteca privada.
- `catalog/index.json` — índice del catálogo público.
- `catalog/<id>.epub`, `.vocab.json` (manifiesto de vocabulario
  precomputado), `.cover.jpg` — públicos e inmutables.

---

## 5. Flujos principales

### 5.1 Arranque y cuentas

1. `loadLastUserId()` (localStorage) abre al instante la estantería de
   la última cuenta confirmada — solo decide qué base abrir, nunca
   autoriza nada.
2. En paralelo, la sesión real de Better Auth manda: si difiere, la app
   cambia de `DbScope` y re-carga.
3. Todo `fetch` autenticado sale por `accountFetch()` (`account-fetch.ts`):
   añade `x-lecta-user-id` y, al volver, verifica que la cuenta siga
   siendo la misma; si cambió lanza `StaleScopeError` y la respuesta se
   descarta.

Auth (Better Auth, `/api/auth/*`):
- Magic link (10 min), correo+contraseña, «olvidé contraseña», borrado
  de cuenta con verificación por correo. El enlace de borrado exige la
  misma sesión que lo pidió.
- `beforeDelete` purga `books/<userId>/` de R2; las filas SQL caen por
  CASCADE; el cliente marca `lecta:pending-delete` y solo limpia la
  base local cuando el correo redirige con `cuenta=eliminada`
  (`account-cleanup.ts`).
- Hyperdrive corre con **caché desactivado a propósito** — con caché,
  `findUserByEmail` quedaba stale ~60 s y rompía registro/reset.
  No reactivarlo.

### 5.2 Añadir y abrir libros

- **Propio**: «Añadir libro» acepta `.epub`; `epub-check.ts` verifica
  firma ZIP y tope de 50 MB; se guarda en `books` por sha256. Con
  sesión, `book-queue.ts` lo sube a R2 con reintentos persistentes
  (`bookOps`).
- **Libro de muestra**: `public/libros/azul-ruben-dario.epub` entra por
  el mismo tubo («Leer un libro de muestra», ver `docs/muestra-azul.md`).
- **Catálogo público** («Descubre»): `catalog.ts` (cliente) trae
  `/api/catalog`, guarda índice y manifiestos en `session` para offline
  y descarga el EPUB por el flujo normal. Curación en
  `scripts/catalog-curation.json` (dominio público, autores fallecidos
  ≤ 1924; seed en `scripts/catalog-seed.mjs`).
- Solo en la nube: la estantería lista los remotos y los descarga al
  abrirlos.

### 5.3 El lector (`Reader.tsx`, ~3.4k líneas — la pieza central)

- `chapters.ts` construye el catálogo de destinos desde landmarks +
  TOC + heurística; clasifica `chapter | preliminary | other |
  uncertain` y **no inventa** «Capítulo 1» sin evidencia.
- `sanitize.ts` + DOMPurify limpian cada sección; los `id` se renombran
  a `data-frag-id` (los destinos del TOC no pueden chocar con ids de la
  app); las imágenes del zip se hidratan como `blob:` dentro de `epub.ts`
  (primero se pinta el texto; las imágenes se rellenan en segundo plano).
- Dos modos: **scroll continuo** y **paginación por columnas CSS**
  (`pagination.ts`, 1–2 columnas según ancho). La posición se guarda
  como ancla de texto (`reading-location.ts`), no como offset — sobrevive
  a cambios de fuente/tamaño/interlineado/ancho.
- Ajustes (`settings.ts`): tipografía (Literata, Alegreya Sans, Source
  Serif, Atkinson, OpenDyslexic), tamaño, interlineado, medida, temas
  (claro, sepia, pizarra, OLED), justificado, capitular, guionado
  opcional, líneas sintácticas y regla de foco (1 línea / 3 líneas /
  párrafo — `FocusRuler`).
- Búsqueda dentro del libro (`book-search.ts`: plegado de acentos,
  iteración por secciones cancelable).

### 5.4 Modelo de conocimiento y «Antes de leer»

`knowledge.ts` es puro y determinista:

- **Evidencia** (`knowledge` store): lema → {conocida, fuente, sello,
  lápida}. Fuentes explícitas (calibración, «ya la conocía»,
  preparación) pesan más que inferidas (consultas, dominio por FSRS).
- **`estimateProfile`**: prueba umbrales zipf 1.0–5.5 en pasos de 0.5 y
  elige el que menos errores comete contra la evidencia, con
  regularización λ=2 hacia el base 3.0 y ajuste manual `profileAdjust`.
  Etiquetas para la interfaz: amplio / medio / en desarrollo.
- **`predictSection(forms, entriesByForm, saved, knowledge, threshold)`**
  clasifica cada forma única de un destino: guardada → aparte;
  «-mente» con raíz común → conocida; POS funcional → conocida; sin
  ficha propia prueba la base clítica y si nada → `missing`; con
  evidencia explícita manda la evidencia; sin evidencia, si **todas**
  las fichas son raras (zipf < umbral) → predicha con la de mayor zipf;
  sin medición → `uncertain`. Tope `PREDICT_CAP = 40`, el resto va
  `deferred` (la hoja los ofrece diferidos, no los declara conocidos).
- La hoja «Antes de leer» (`preparation.ts`, modos auto/aviso/apagada)
  registra respuestas `known|unknown` por lema; `skipped` también queda
  registrado. Sus respuestas alimentan `knowledge` y el Cuaderno.
- **Calibración** (`calibration.ts` + `calibration-bank.ts`): banco
  editorial por bandas zipf, solo palabras con acepción y medición
  real; se ofrece tras observar lectura real del tramo — nunca por
  aterrizar al final vía marcador o salto. Migra de anónimo a cuenta.

### 5.5 Tocar una palabra → `WordPanel`

`words.ts`/`segmenter.ts` extraen la forma y su oración; `lexicon.ts`
(cliente) consulta `GET /api/lexicon/lookup`. El panel ofrece:

- ficha: lema, categoría, acepciones con definición/ejemplo
- **Guardar**: entra al Cuaderno con tarjeta FSRS nueva (`card`) — y si
  venía sin ficha queda «sin significado» hasta que el catálogo la
  tenga (`word-meanings.ts` la rellena por compare-and-set al abrir
  Vocabulary)
- **Ya la conocía**: evidencia explícita de `knowledge`
- **Explicación IA** (`/api/lexicon/explain`): recibe solo palabra +
  idioma + oración — nunca el libro ni la cuenta
- **Enriquecer**: si no hay ficha o falta acepción, `POST
  /api/lexicon/enrich(-batch)` encola generación IA vía Workflow; el
  Reader re-consulta unas veces hasta que aparece y remarca el texto.

En el texto, `markWords` pinta dos cosas: guardadas por nivel FSRS
(`word-level.ts`: nueva / aprendiendo / asentada; ≥90 días de
estabilidad ya no se marca) y predichas con subrayado punteado.

### 5.6 Cuaderno y repasos (`Vocabulary.tsx`)

- Tarjeta FSRS serializada de `ts-fsrs` por palabra — **no renombrar
  campos ni convertir estados** (regla del proyecto).
- Modos: **Aprender** (primera exposición guiada, `learn.ts`,
  `learnExposure:v1`), **Repasar hoy** (mezcla automática: cloze /
  elegir / significado / palabra según tenga contexto), y modos a mano:
  sentido, contexto, oración nueva y escribir oración — estos últimos
  usan `lexicon_items` generados por IA y `/api/lexicon/verify-sentence`.
- Ejercicios con opciones: acierto → `Rating.Hard`, fallo →
  `Rating.Again`; distractores deterministas por `pos`
  (`practice.ts`, `shuffleStable` con semilla).
- Cada repaso queda en `reviews` (inmutable) y se sincroniza.

### 5.7 Actividad, telemetría y fatiga

- `activity`: intervalos de lectura con `startedAt/endedAt`, sección,
  palabras, regresiones — anexables por `id`, sin edición.
- `readingEvents`: trayecto local por visita (a qué destinos entró, qué
  sugirió la hoja, qué hizo con cada palabra). **Solo local**: no se
  sincroniza, se exporta con el respaldo, retención 90 días, se apaga
  en Cuenta.
- `focus-telemetry.ts`: detecta fatiga — ≥25 min de tramo, ventana de
  5 min con ≥35% de regresiones y muestra mínima, enfriamiento de
  10 min entre avisos.
- `reading-goal.ts` + `ReadingActivity`: días con lectura, meta semanal,
  dwell, PPM estimado (`progress.ts`, base 180 ppm), avisos de fatiga.

### 5.8 El gato compañero (`Companion*.tsx` + `companion-*`)

- Estados (`companion-data.ts` shared): SLEEP, READING, DEEP_FOCUS,
  CURIOUS, YAWN, CELEBRATING… Reacciona a apertura/cierre del lector,
  consultas, fatiga, meta semanal, fin de capítulo y fin de libro.
- **Event-sourcing local**: `award()` anexa eventos al journal
  (`companionEvents`) con id estable + sello + `dayKey` de la zona del
  emisor; la proyección es determinista en cualquier réplica.
  `companionReceipts` une monotónicamente lo ya visto (cofres, logros
  anunciados) — un baseline importado nunca celebra.
- Sync dedicado (`companion-sync.ts` + `src/worker/companion.ts`):
  PUT transaccional por lotes con detección de conflictos y GET con
  paginación keyset (nunca OFFSET). Preferencias de sonido y animación
  son del dispositivo (`companionDevicePrefs`), no se sincronizan.
- Sonido solo en gestos voluntarios (maullido al abrir su hoja,
  ronroneo al acariciar); autoplay rechazado se traga en silencio —
  el audio es adorno.

### 5.9 Sincronización (todas las colecciones)

Patrón común (`*-sync.ts` + `reading-data.ts` del worker):

- **Anexables** (activity, reviews, events): `PUT` inserta por `id`, el
  servidor descarta repetidos; `GET` baja lo que falta. Reenviar es
  seguro.
- **Mutables** (words, annotations, positions, knowledge, companion):
  merge por clave, gana `updatedAt` mayor, **lápidas incluidas** — un
  borrado offline se propaga igual que un cambio.
- `knowledge` tiene arbitraje convergente propio (`knowledgeArbWins`:
  peso de fuente → sello → lápida → veredicto), idéntico en cliente,
  sync y upsert SQL: cualquier orden de llegada converge.
- Posiciones detectan conflicto: si el servidor pisó una posición local
  distinta, el cliente pregunta antes de saltar.
- Envíos en lotes (vocab 500/PUT; knowledge con su propio tope); se
  detiene al primer lote fallido — nunca se finge sync.
- Todo el ciclo corre atado al `DbScope` capturado al empezar; si la
  cuenta cambia, se aborta limpio.

### 5.10 Catálogo léxico y enriquecimiento IA

- Carga masiva desde Wikcionario (kaikki.org) con
  `scripts/lexicon-wiktionary.mjs` → `lexicon_senses.source='wiktionary'`;
  licencias y obligaciones en `docs/licencias-lexico.md` (la tabla
  forma→lema es ODbL: hay que ofrecerla descargable).
- `POST /api/lexicon/enrich` (una forma) y `/enrich-batch` (lote)
  generan fichas con DeepSeek en segundo plano vía Workflow; el Reader
  dispara lotes de hasta `AUTO_ENRICH_CAP = 8` por destino cuando la
  predicción tiene huecos — solo con sesión y «Usar IA» encendida
  (`ai-pref.ts`, opt-out en Cuenta).
- Salida IA validada en el servidor (`ai.ts`): JSON estricto, `pos`
  permitido, tope de definiciones/ejemplos, `promptVersion` y
  `modelVersion` guardados por fila, telemetría `lecta.ai_call`.
- Cuotas por hora y scope (`lecta_rate_log`, ventana de 1 h):
  enriquecer 60, ítems 24, verificar 30, explicar 30.
- `catalog-seed.mjs --seed` (`buildResolvedManifest`) resuelve las
  formas de cada libro del catálogo contra `lexicon_forms`/`entries`
  en lotes de 2 000 y emite `.vocab.json` — el mismo análisis que haría
  `predictSection` en vivo, precomputado con bases clíticas/«-mente»
  como llaves extra.

---

## 6. API completa (`/api/*`)

Auth (Better Auth, `/api/auth/*`): magic-link, sign-in/up
email+password, request/reset password, delete-user con callback.

| Método y ruta | Qué hace |
|---|---|
| `GET /api/health` | ok |
| `GET /api/lexicon/lookup?form=&lang=` | Fichas de una forma (pública) |
| `GET /api/lexicon/sample` | Muestra para calibración |
| `POST /api/lexicon/batch` | Lookup por lote de formas |
| `POST /api/lexicon/enrich` | Encola ficha IA (una forma) |
| `POST /api/lexicon/enrich-batch` | Encola lote → Workflow |
| `POST /api/lexicon/report` | Reporta una acepción |
| `POST /api/lexicon/items` | Ítems de ejercicio (genera con IA si faltan) |
| `POST /api/lexicon/items/answer` | Registra respuesta de un ítem |
| `POST /api/lexicon/verify-sentence` | Corrige oración escrita (sin contexto del libro) |
| `POST /api/lexicon/explain` | Explicación en contexto (cacheada en memoria por clave) |
| `GET/PUT /api/vocab` | Merge del cuaderno (PUT ≤ 500) |
| `GET/PUT /api/annotations` | Merge marcadores/pasajes |
| `GET/PUT /api/activity` | Anexar/leer intervalos |
| `GET/PUT /api/reviews` | Anexar/leer repasos |
| `GET/PUT /api/positions` | Posición por libro con detección de pisado |
| `GET/PUT /api/knowledge` | Merge con arbitraje convergente |
| `GET/PUT /api/companion` | Estado del gato: PUT transaccional, GET keyset |
| `GET /api/books` | Lista EPUBs del usuario |
| `PUT/GET/DELETE /api/books/:hash` | Subir/descargar/borrar (DELETE 404 = ok) |
| `GET /api/catalog` | Índice del catálogo público |
| `GET /api/catalog/:id/epub|vocab|cover` | Objeto inmutable del catálogo |

Errores al usuario en español claro («Llegaste al límite de
definiciones con IA por hora…»). Respuestas 401/503/429 según caso.

---

## 7. Reglas que no se negocian

1. **Datos de usuario jamás se reescriben ni se pierden**: merges por
   `updatedAt` con lápidas; nada de `DELETE` real salvo el CASCADE del
   borrado de cuenta.
2. **Sin sockets `pg` globales** en el Worker — `withClient()` por
   request, Hyperdrive siempre.
3. **`entry_id` viaja como string** (int8 > 2^53). Filas viejas pueden
   tener ids truncados del catálogo local viejo: el backfill los ignora
   y cae a la primera acepción.
4. **El catálogo léxico vive solo en `lecta_dev`**, consultado como
   `lecta_dev.lexicon_*` desde cualquier entorno. No duplicarlo.
5. **Scope por cuenta en todo async**: capturar `DbScope` al empezar,
   verificar antes de cada escritura; `StaleScopeError` no es un fallo
   del servidor.
6. **Hyperdrive sin caché** (auth se rompe con stale reads); las
   respuestas del catálogo público sí se cachean agresivamente porque
   son inmutables.
7. **Privacidad**: la IA de una palabra recibe solo palabra+idioma+
   oración; verificar oración no envía contexto; el trayecto de lectura
   es local, exportable y apagable; no loguear correos ni tokens.
8. **Tarjetas FSRS** se guardan serializadas de `ts-fsrs`; no mutar su
   forma.
9. Migraciones nuevas solo a `lecta_dev` (`LECTA_MIGRATE_TARGET` lo
   exige); prod requiere autorización expresa.
10. Claves de session versionadas (`preparation:v1:`, `bookStart:v1:`…)
    solo cambian con migración explícita hacia atrás compatible.

---

## 8. Mapa de archivos

```
src/
├── worker/                  Cloudflare Worker + Hono
│   ├── index.ts             fetch + scheduled (cron diario)
│   ├── app.ts               rutas principales (lexicon, books, vocab…)
│   ├── auth.ts              Better Auth (magic link, Resend, beforeDelete→R2)
│   ├── db.ts                withClient() — conexión por request vía Hyperdrive
│   ├── session.ts           getSession()
│   ├── reading-data.ts      /api/{annotations,activity,reviews,positions,knowledge}
│   ├── catalog.ts           /api/catalog* (público, inmutable)
│   ├── lexicon.ts           consultas al catálogo compartido (lecta_dev.)
│   ├── ai.ts                callDeepSeek: prompts, límites, reintentos, validación
│   ├── companion.ts         /api/companion (tx + keyset)
│   └── enrichment-workflow.ts  Workflow de fichas IA
├── client/
│   ├── App.tsx              raíz: vistas, hojas, sync al montar
│   ├── components/
│   │   ├── Reader.tsx       lector EPUB (pieza central)
│   │   ├── Shelf.tsx        estantería + Descubre (catálogo)
│   │   ├── WordPanel.tsx    ficha de palabra
│   │   ├── Vocabulary.tsx   cuaderno, Aprender, modos de práctica
│   │   ├── Calibration.tsx  calibración por bandas zipf
│   │   ├── Account.tsx      cuenta, prefs (IA, historial), exportar
│   │   ├── ReadingActivity.tsx  actividad semanal
│   │   ├── Companion*.tsx   gato: hoja, celebraciones, provider
│   │   └── BookStart/SectionPreview/ThemeMenu/FocusRuler/…
│   ├── lib/
│   │   ├── idb.ts           IndexedDB por cuenta + DbScope (LOS datos locales)
│   │   ├── epub.ts          abre el EPUB, sanitiza e hidrata imágenes como blob:
│   │   ├── chapters.ts / sanitize.ts / book-search.ts / reading-location.ts
│   │   ├── words.ts / segmenter.ts / section-words.ts / chapter-analysis.ts
│   │   ├── marks.ts / passage-marks.ts / word-level.ts  marcas en el texto
│   │   ├── phrases.ts       locuciones por lema (asset estático, sin red)
│   │   ├── lexicon.ts       cliente del catálogo (lookup, batch, enrich)
│   │   ├── knowledge.ts     estimateProfile + predictSection (PURO)
│   │   ├── preparation.ts   «Antes de leer» (respuestas → evidencia)
│   │   ├── calibration.ts / profile-models.ts / coverage.ts / book-vocab.ts
│   │   ├── fsrs.ts / learn.ts / practice.ts / vocab.ts / word-meanings.ts
│   │   ├── reading-sync.ts / positions-sync.ts / companion-sync.ts
│   │   ├── reading-events.ts / focus-telemetry.ts / reading-goal.ts
│   │   ├── books.ts / book-queue.ts / catalog.ts (cliente) / annotations.ts
│   │   ├── auth.ts          authClient (better-auth/react + magicLink)
│   │   ├── account-fetch.ts / account-cleanup.ts / last-user.ts
│   │   ├── game.ts / companion-*.ts  (journal, presencia, inbox, audio)
│   │   ├── settings.ts / progress.ts / pagination.ts / history.ts / modal.ts
│   │   └── export.ts        respaldo JSON + CSV/Anki/Markdown
├── shared/                  código ejecutado en ambos lados
│   ├── reading-data.ts      contratos de sync + límites de lote
│   ├── lexicon.ts           tipos del catálogo (entry, sense, item)
│   ├── word-form.ts         normalización, «-mente», clíticos
│   ├── companion-data.ts    eventos, proyección y merges del juego
│   ├── gamification.ts      XP, niveles, logros
│   ├── calibration-bank.ts  banco editorial por bandas
│   ├── stopwords.ts         funcionales que no son vocabulario
│   └── epub-check.ts        firma ZIP + tope 50 MB
db/
├── schema.sql               base inicial (lexicon_* + user_words + rate_log)
└── migrations/001–009       anotaciones, actividad, catálogo, repasos,
                             posiciones, ítems, conocimiento, sources, gato
scripts/
├── db-setup.mjs / auth-migrate.mjs / db-migrate.mjs
├── lexicon-wiktionary.mjs   carga masiva del Wikcionario → lexicon_*
├── catalog-seed.mjs         curación Gutenberg + manifiestos .vocab.json
└── catalog-curation.json    lista curada (dominio público, ≤1924)
public/
├── libros/azul-ruben-dario.epub   libro de muestra
├── lexicon/locuciones.es.json     locuciones (Wikcionario)
└── _headers                       CSP estricta, Referrer-Policy no-referrer
docs/
├── sistema-lecta.md         ← este archivo
├── licencias-lexico.md      obligaciones ODbL/CC BY-SA del léxico
└── muestra-azul.md          origen del libro de muestra
wrangler.jsonc               worker `lecta`: BOOKS (R2), HYPERDRIVE,
                             workflow `lecta-enrichment`, cron 0 5 * * *,
                             secrets.required
```

---

## 9. Comandos y verificación

```bash
pnpm dev          # Vite + worker local (reiniciar tras tocar .env)
pnpm typecheck    # tsc cliente + worker
pnpm lint         # eslint
pnpm test         # vitest
pnpm build        # vite build
pnpm deploy       # build + wrangler deploy → lecta.luis-sg9915.workers.dev
pnpm db:setup     # esquema base (usa DATABASE_URL de .env)
pnpm db:auth      # tablas de Better Auth
pnpm db:migrate   # migrations/*.sql en orden → lecta_schema_migrations
                  # (exige LECTA_MIGRATE_TARGET; default lecta_dev)
pnpm smoke:auth   # pruebas de auth contra server vivo (SMOKE_URL=)
```

`.env` (dev) apunta `DATABASE_URL` a `lecta_dev` y debe traer
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`; sin ella el
binding de Hyperdrive en dev túnelaba a producción. Secrets del worker:
`DATABASE_URL`, `DEEPSEEK_API_KEY`, `BETTER_AUTH_SECRET`,
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `AI_GATEWAY_KEY`,
`AI_GATEWAY_URL` — controlados por `secrets.required` en
`wrangler.jsonc` (si no está ahí, dev no la ve).

---

## 10. Trampas conocidas y decisiones deliberadas

- **Nunca reactivar caché de Hyperdrive**: rompió `request-password-reset`
  para usuarios recién registrados y dejó sesiones revocadas válidas
  ~60 s. Está documentado en AGENTS.md.
- **`RESEND_FROM_EMAIL` = `onboarding@resend.dev`**: Resend solo entrega
  al correo dueño de la cuenta hasta verificar dominio propio.
- **`AI_GATEWAY_KEY` actual es decorativa**: el gateway viejo no existe;
  si se activa `authentication` en el gateway hay que generar token nuevo.
- **BETTER_AUTH_URL no se fija en prod**: el código cae al origen de la
  petición.
- **`enrich` en background**: la lectura nunca espera a la IA; el Reader
  re-consulta tras encolar y remarca cuando la ficha aparece.
- **DELETE de libro remoto con 404 cuenta como éxito**: otro dispositivo
  pudo borrarlo antes; la op encolada sale de la cola.
- **Tablas `lexicon_*` dormidas en `lecta` (prod)**: existen pero no se
  usan — cuidado: pruebas destructivas sobre ellas en dev sí pegan a la
  base compartida real.
- **«Atrás» del navegador cierra capas, no sale de la app**:
  `history.ts` lleva la contabilidad de `back()` internos para no
  confundir popstates de contabilidad con un atrás del usuario.
- **`defaultdb` en el cluster pertenece a otro proyecto (POS)**: no
  tocar sus tablas.
