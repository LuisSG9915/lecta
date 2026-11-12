# Planes Gratis / Lecta+, cuenta obligatoria y unificación visual del landing

*   **Author:** LuisSG9915
*   **Status:** Approved. La revisión Goldfish se aceptó en la ronda 3, con
    churn y por decisión del autor. Los arreglos de las rondas 1, 2 y 3 están
    aplicados.
*   **Date:** 2026-11-12
*   **Contexto de entrada:**
    [2026-11-12_DRIFT_REPORT.md](../../2026-11-12_DRIFT_REPORT.md), las decisiones
    de autor del 2026-11-12 y
    [goldfish_review_report_planes.md](../../goldfish_review_report_planes.md).

--------------------------------------------------------------------------------

## Overview

PRODUCT.md y el landing (`/inicio/`) prometen cosas que la app no hace:

- El pelaje elegido en el landing no llega a la app.
- La cuenta no es obligatoria.
- No existe Lecta+, no hay cobro y no hay nada restringido.
- La app no usa el mundo visual del landing.

Este documento cierra esas brechas en cuatro bloques atómicos. Cada bloque
termina con `pnpm gate` en verde:

- `pnpm typecheck`;
- `pnpm lint` con 0 warnings;
- `scripts/test-trace.mjs`, que corre `vitest run`;
- el build;
- `check:size`, con JS inicial `<=` 215 kB gzip y CSS `<=` 55 kB.

`pnpm gate` no mide cobertura, así que cada bloque corre además
`pnpm vitest run --coverage`.

## The Problem

Hoy cualquier persona puede usar, sin cuenta y sin pagar, todo lo que el
landing vende como Lecta+. Además, el pelaje elegido en el landing se pierde al
cruzar a la app.

La solución tiene cuatro partes:

- una tabla de plan por cuenta (`lecta_user_plan`);
- una fecha de corte para los Mecenas Fundadores;
- comprobación del plan en el Worker, con middlewares en un módulo propio que
  se montan ruta por ruta;
- cobro con Stripe por `fetch` directo, sin SDK.

La parte visual se aplica hoja por hoja.

## Goals

*   Toda cuenta creada antes de `2026-11-13T00:00:00Z` queda en
    `founder_lifetime`.
*   Una cuenta nueva sin pago queda en `free`.
    *   Las rutas de la tabla de gating responden `402` con
        `code: "LECTA_PLUS_REQUIRED"`.
    *   La UI muestra `PlanNote`, una nota al margen de 2 líneas, y nunca un
        modal.
*   El pelaje que la persona **eligió de forma explícita** en el landing
    (`?gato=` o `lecta:gato`) queda como `starter_coat`.
    *   Una cuenta `free` sin elección ve el selector de 5 pelajes.
    *   El pelaje inicial se usa siempre, sin requisito de nivel.
*   Pagar ($59 MXN al mes o $499 MXN al año) deja la cuenta en `lecta_plus`.
*   Regla única de pérdida del plan: `lecta_plus` pasa a `free` cuando
    `plan_expires_at + 3 días` queda en el pasado.
*   En `free` viajan entre dispositivos la posición, las palabras y los
    metadatos de los EPUB propios. El archivo `.epub` no viaja.
*   Al pasar a Lecta+, los libros locales sin archivo en la nube se suben
    solos.
*   Bundle sin SDK de Stripe. `Welcome` es lazy. `ReaderCard` y `AuthForms`
    viven en chunks que ya son lazy.
*   Las 7 hojas listadas en el Bloque 3 no contienen hex fuera de
    `tokens.css`. Los bloques por pelaje `.cat.cat--coat-*` de `game.css`
    (game.css:619-699) se mudan tal cual a `tokens.css`.

## Non-Goals

*   No hay gating en el servidor para pelajes ni accesorios. Viajan por
    `/api/companion` y se controlan solo en `companion-closet.ts`.
*   No hay gating en el servidor para «Palabras previstas», porque
    `predictSection` corre en el cliente.
*   Quedan libres `/api/ai/enrich`, `/api/lexicon/enrich` y
    `/api/lexicon/enrich-batch`. Rellenan el catálogo compartido y ya tienen
    cuota (`lecta_ai_quota`).
*   No hay pruebas gratuitas, cupones, CFDI ni más monedas que MXN.
*   No se tocan las tablas de Better Auth.
*   No hay rediseño de layout.
*   No se eliminan los hex de `Companion*.tsx`, `ResetAccountSection.tsx`,
    `TtsDebugPanel.tsx` ni `admin-insights.css` (ver Future Improvements).
*   No se borra la base anónima `lecta` de IndexedDB. Se sigue migrando al
    iniciar sesión.

## Open Questions

Ninguna. Decisiones tomadas el 2026-11-12:

*   **Orden de despliegue:** primero el deploy del Worker y después la
    migración 027.
    *   Mientras falte la tabla (`42P01`), las lecturas devuelven
        `founder_lifetime` con `degraded: true`.
    *   Mientras falte la tabla, las escrituras de plan responden `503`.
    *   Mientras falte la columna (`42703`), cada ruta usa su respaldo; ver
        «Ventana previa a la 027».
    *   La 027 no se aplica en `lecta` antes de `2026-11-13T00:00:00Z`.
*   **EPUB propio:** se registran metadatos gratis (`has_file = false`). El
    emparejamiento es por `sha256` exacto. Al pasar a Lecta+, los libros se
    suben solos.
*   **IA:** se sigue la tabla de gating. Las tres rutas de `enrich` quedan
    libres.
*   **Borrado de cuenta:** primero se cancela la suscripción en Stripe. Si
    Stripe falla, el borrado se aborta.
*   **Cancelación:** se aplica la regla única de vencimiento + 3 días, sin
    rebajas inmediatas.
*   **Selector de pelaje:** solo para cuentas `free`.
*   **`.cat.cat--coat-*`:** se mudan tal cual a una sección «Pelajes» de
    `tokens.css`. No se mezclan con los `--cat-fur` de tema.

## Critical User Journeys (CUJs)

### CUJ 1: Llegar desde el landing con un gato elegido

*   **Given**: En `/inicio/` la persona toca «Calicó Literario».
    *   El evento `change` guarda `lecta:gato = calico`.
    *   El evento `change` reescribe los CTA a `/?gato=calico`.
    *   Al cargar la página, en cambio, no se guarda nada ni se reescribe
        ningún `href`.
*   **When**: Abre la app sin sesión y crea su cuenta, incluso por magic link
    con `callbackURL: "/"`.
*   **Then**:
    1. El parser único de URL de App valida `calico`, lo guarda y limpia la
       URL.
    2. `Welcome` muestra el calicó.
    3. Con sesión, `claimStarterCoat()` hace `PUT /api/account/starter-coat`
       una sola vez, equipa el pelaje y borra `lecta:gato`.

### CUJ 2: Primera apertura sin red

*   **Given**: No hay sesión, no hay `lastUserId` y no hay red.
*   **When**: La persona abre la app.
*   **Then**: Ve `Welcome` con el aviso offline. No se monta ni la estantería
    ni el lector.

### CUJ 3: Gratis pide explicación con IA

*   **Given**: Hay una sesión `free` y la ficha de una palabra está abierta.
*   **When**: La persona toca «¿Qué significa aquí?».
*   **Then**:
    *   Aparece `PlanNote` con este texto: «La explicación en contexto es de
        Lecta+.» / «El significado de arriba siempre es tuyo.»
    *   La llamada directa a la ruta responde `402`.

### CUJ 4: Suscribirse

*   **Given**: Una cuenta `free` está en el Carné con «Anual» elegido.
*   **When**: La persona pulsa «Hacerme Lecta+».
*   **Then**:
    1. `POST /api/billing/checkout {period:"yearly"}` devuelve `{url}`.
    2. El webhook `checkout.session.completed` resuelve la cuenta por
       `client_reference_id` y hace UPSERT de `lecta_plus`.
    3. Al volver a `/?carne=1` se abre «Tú».
    4. App consulta `/api/account/state` cada 2 s durante 20 s, hasta ver
       `lecta_plus`, porque el webhook puede llegar tarde.
    5. Al pasar el plan a Lecta+, App encola la subida de cada libro cuya
       fila remota tiene `hasFile === false` y cuyo archivo existe en local.

### CUJ 5: Fundador

*   **Given**: Una cuenta creada antes del corte.
*   **When**: Entra a «Tú».
*   **Then**:
    *   Ve el sello «Mecenas de Primera Imprenta · Acceso Vitalicio».
    *   No ve el selector de pelaje.
    *   El checkout le responde `409`.

### CUJ 6: Gratis abre su EPUB en otro dispositivo

*   **Given**: Una cuenta `free` agregó `libro.epub` en el celular.
    `registerBookMeta()` creó la fila con `has_file = false`.
*   **When**: Abre la estantería en la computadora y toca el libro.
*   **Then**:
    1. El libro aparece con `remoteOnly` y `hasFile: false`, y con su
       progreso.
    2. Se abre la hoja «Adjunta tu archivo o pasa a Lecta+».
    3. Si el `sha256` del archivo coincide con el libro:
       1. `saveBook({hash, name: file.name, data: file, title, author,
          language, addedAt: Date.now()})`.
       2. `updateBookMeta`, como en `selectBook`.
       3. `refreshLibrary`.
       4. Se abre con `openStoredBook`.
    4. Si no coincide, se muestra el aviso de archivo distinto y no se
       escribe nada.

## Technical Plan (Architecture)

```text
landing ─(solo si eligió)─ ?gato= / lecta:gato ─▶ App.tsx (parser único de URL)
                                                    │ tabla de decisión → Welcome (lazy) / app
cliente ─ GET /api/account/state ─▶ Worker ─ plan-store.getUserPlan ─▶ lecta_user_plan (027)
   ├─ useUserPlan() (caché account:plan:v1:<userId>) → UI (PlanNote, closet, prep, Carné)
   ├─ rutas con gating ─▶ plan-middleware.requireLectaPlus (por ruta) ─▶ 401 / 402 / next
   └─ /k/* ─▶ plan-middleware.requireKindlePlan (sin sesión → next; exentas) ─▶ HTML 402
Carné ─▶ /api/billing/{checkout,portal} ─fetch─▶ api.stripe.com (Stripe-Version 2025-03-31.basil)
Stripe ─▶ /api/billing/webhook ─▶ firma ─▶ tx(evento, resolución de cuenta, UPSERT plan)
```

### Datos: migración 027

Todos los sellos van en `INT8`, en milisegundos.

- **`lecta_user_plan`**
  - `user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE`.
  - `plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN
    ('free','lecta_plus','founder_lifetime'))`.
  - `starter_coat TEXT`, `stripe_customer_id TEXT`,
    `stripe_subscription_id TEXT`, `plan_expires_at INT8`.
  - `created_at INT8 NOT NULL`, `updated_at INT8 NOT NULL`.
  - Índice `idx_user_plan_stripe_customer (stripe_customer_id)`, sin las
    columnas de la PK.
- **`lecta_stripe_events`**: `event_id TEXT PRIMARY KEY`,
  `processed_at INT8 NOT NULL`.
- **`user_books`**: `ALTER TABLE user_books ADD COLUMN IF NOT EXISTS has_file
  BOOL NOT NULL DEFAULT true`. Las filas que solo tienen metadatos usan
  `r2_key = ''`.
- **Fundadores**:

  ```sql
  INSERT INTO lecta_user_plan (user_id, plan, created_at, updated_at)
  SELECT id, 'founder_lifetime',
         (extract(epoch from now())*1000)::INT8,
         (extract(epoch from now())*1000)::INT8
  FROM "user" WHERE "createdAt" < to_timestamp(1794528000)
  ON CONFLICT (user_id) DO UPDATE SET plan = 'founder_lifetime'
  ```

- Que no exista fila equivale a `free`.
- `resetAccountDataDb` (db.ts:127-167) no borra `lecta_user_plan`.
- Sin RLS.
- La cabecera de la migración documenta el paso manual de `schema_locked`
  para `user_books`, como hacen las migraciones 016 (:14) y 026 (:18).

### Módulos de plan en el Worker

- **`src/shared/plan.ts`** (puro): `UserPlan`, `hasLectaPlus`,
  `normalizePlan`, `isStarterCoat` (contra `COMPANION_COAT_IDS`) y
  `PLAN_GRACE_MS = 3 días`.
- **`src/worker/plan-store.ts`**
  - `getUserPlan(client, userId, { inTransaction? })` devuelve
    `{ plan, starterCoat, expiresAt, stripeCustomerId, stripeSubscriptionId,
    degraded }`:
    - sin fila: `free`;
    - `lecta_plus` con `expiresAt + PLAN_GRACE_MS` en el pasado: `free`;
    - `42P01`, detectado con `isMissingTableError`: `founder_lifetime` con
      `degraded: true`;
    - cualquier otro error se propaga;
    - con `inTransaction`, la lectura se envuelve en un `SAVEPOINT`, igual
      que `lockResetMarker`.
  - `setStarterCoat(client, userId, coat)` devuelve
    `'written' | 'exists' | 'unavailable'`. Hace UPSERT solo si
    `starter_coat IS NULL`. Ante `42P01` devuelve `'unavailable'`.
  - `upsertPlanFromStripe(client, userId, patch)` es la única escritura de
    plan desde Stripe. Nunca rebaja una cuenta `founder_lifetime`.
  - `loadUserPlan(env, userId)` envuelve `withClient(env, c => getUserPlan(c,
    userId))`.
    - Devuelve `undefined` si `withClient` devuelve `undefined`, es decir, si
      no hay cadena de conexión (db.ts:66).
    - Es la **única** puerta que usan los middlewares, el checkout y
      `/api/account/state`.
    - Las pruebas mockean `loadUserPlan`; `getUserPlan` se prueba aparte, con
      un `client` simulado.
- **`src/worker/plan-middleware.ts`** importa `./plan-store`.
  - El tipo es `Session = NonNullable<Awaited<ReturnType<typeof
    getSession>>>`.
  - `requireLectaPlus = createMiddleware<{ Bindings: WorkerEnv; Variables: {
    session: Session } }>`:
    - sin sesión: `401 {error}`;
    - `loadUserPlan` devuelve `undefined`: `503 {error: "El almacenamiento no
      está configurado."}`;
    - error de base que no sea 42P01: `503`;
    - plan sin Lecta+: `402 { error: "Esta función es de Lecta+.", code:
      "LECTA_PLUS_REQUIRED" }`;
    - si pasa: `c.set("session")` y `next()`.
  - `requireKindlePlan`:
    - sin sesión: `next()`, porque los handlers ya redirigen a `/kindle` o
      `/k/login`;
    - rutas exentas, comparadas con la ruta completa: `/k/login`,
      `/k/logout`, `/k/kindle`, `/k/link`, `/k/verify`,
      `/k/api/kindle/status` y `/k/api/kindle/link`;
    - sin plan: HTML `renderKindlePlanRequiredView()` con status `402`.
  - Se monta **ruta por ruta**. Nunca se usa `app.use` sobre
    `/api/books/:hash`, porque atraparía `/community` (app.ts:2263).
  - Orden final de una ruta con gating:
    1. Middleware: 401 / 503 / 402.
    2. Validación del body: 400.
    3. Configuración del handler: 503.
- **Handlers que pasan a `c.get("session")`**, para que el mock no deje
  `getSession` en `undefined`:
  - `handleBookUpload`, retipado con
    `Context<{ Bindings: WorkerEnv; Variables: { session: Session } }>`
    (app.ts:2144);
  - `GET /api/books/:hash`;
  - `PUT/GET /api/user/books/:bookId/file`;
  - las 9 rutas de IA con gating;
  - `/api/lexicon/items` y `/api/lexicon/items/answer`.
- **`GET /api/account/state`** suma `plan`, `starterCoat` y `planExpiresAt`.
  Si ocurre un error que no sea 42P01, omite `plan`.

### Ventana previa a la 027

Rutas y comportamiento mientras falte la tabla (42P01) o la columna (42703):

| Ruta / función | 42P01 (sin tabla) | 42703 (sin `has_file`) |
| --- | --- | --- |
| `getUserPlan` | `founder_lifetime`, `degraded` | — |
| `PUT /api/account/starter-coat` | `503` | — |
| Webhook | ROLLBACK + `503` | — |
| Checkout | `503` si `degraded` | — |
| `PUT /api/user/books/:bookId/meta` | — | `503` |
| `listUserBooksOutsidePrefix` (función app.ts:2606) | — | Reintenta sin `has_file`, con el patrón `?? query(sqlPrevious)` de app.ts:2574 |
| `GET /api/user/books` (ruta app.ts:3412) | — | Reintenta sin `has_file` (código nuevo, mismo patrón) |
| `listMetaOnlyRows` | — | `[]` |
| Upserts de `recordUserBook` | — | Cadena de 3 variantes: genre + `has_file` → genre → base |

### Tabla de gating

| Superficie | Servidor | Cliente |
| --- | --- | --- |
| IA: app.ts:914, 980, 1067, 1142, 1249, 1387, 1455, 1522, 1589 | `requireLectaPlus` | `PlanNote`; ficha con `planLocked` |
| Modos libres: `/api/lexicon/items`, `/items/answer` | `requireLectaPlus` | `FreeModes` deshabilitado; «Repasar» sin cambios |
| Binarios propios: `PUT/POST /api/books(/:hash)`, `GET /api/books/:hash`, `PUT/GET /api/user/books/:bookId/file` | `requireLectaPlus` | En `free` solo se registran metadatos |
| `PUT /api/user/books/:bookId/meta` | Libre, con sesión | Siempre primero en `selectBook` |
| `/k/*` y `/k/priming/action`, `/k/kindle/priming/action` | `requireKindlePlan` | — |
| `/kindle/priming/action` (app.ts:221) | `requireKindlePlan`, porque es un formulario HTML: sin sesión sigue procesando `mute_book`, `disable_all` y `enable_all` | — |
| `POST /api/kindle/link` | En `handleKindleLinkAction` (routes.ts:756): rechaza `userId` vacío; sin plan, 402 | `KindleAppearancePanel` con `PlanNote` |
| `GET/PUT /api/kindle/prefs` | JSON 402 | Mismo panel |
| Palabras previstas | — | `shouldAutoShowPreview(…, plan)` en `useReaderChapterPrep.ts:40`; abrirla a mano muestra `PlanNote` |
| Pelajes y accesorios | — | `ClosetRequirement` con `kind: "plan"` |

### Libros propios: metadatos y archivo

- **`PUT /api/user/books/:bookId/meta`**
  - Body: `{title, author, language, sha256, size}`.
  - `bookId` se valida con `HASH_PATTERN` (app.ts:1963).
  - Validaciones:
    - `sha256 !== bookId` → 400.
    - `checkUserBooksQuota(env, userId, bookId, 0)` solo cuenta libros (tope
      de 100); si se pasa, 413.
  - Pasa por `withResetGuard` / `resetAck`.
  - SQL: `INSERT INTO user_books (user_id, book_id, title, author, language,
    r2_key, size_bytes, sha256, has_file, created_at, updated_at) VALUES (…,
    '', 0, $sha256, false, now, now) ON CONFLICT (user_id, book_id) DO UPDATE
    SET title, author, language, updated_at`. Nunca toca `r2_key`,
    `size_bytes` ni `has_file`.
  - No tiene rama D1.
- **`recordUserBook`** (app.ts:1796-1818)
  - Fija `has_file = true` y el `size_bytes` real.
  - El DO UPDATE fija `has_file = EXCLUDED.has_file` y `size_bytes =
    EXCLUDED.size_bytes`.
  - Ante 42703 usa la cadena de 3 variantes (genre + `has_file` → genre →
    base). Hoy la cadena es genre → base (app.ts:1832-1839).
- **Listados**
  - `listUserBooksOutsidePrefix` (función app.ts:2606; SQL :2611) y
    `GET /api/user/books` (ruta app.ts:3412; SQL :3435) agregan
    `AND has_file = true`, con el respaldo de la tabla de la ventana previa.
  - El nuevo `listMetaOnlyRows` corre después de las filas paper-only y
    actualiza `listed` en cada ciclo.
  - `GET /api/books` devuelve `hasFile: false` para esas filas.
- **Cliente**
  - `RemoteBook` (books.ts:5-24) y `ShelfItem` (Shelf.tsx:74-85) ganan
    `hasFile?: boolean`.
  - `refreshLibrary` (App.tsx:723-753) copia ese campo en `remoteItems`.
    En `localItems` (App.tsx:692-709) lo copia con
    `remoteByHash.get(hash)?.hasFile`.
  - `downloadBook` (books.ts:91-106) devuelve `{file}` o `{status}`.
    `openRemoteBook` (App.tsx:1395-1398) manda un 402 a la hoja de adjuntar
    en lugar de mostrar «Revisa tu conexión».
  - `openShelfItem` (App.tsx:1461-1471) y `handlePaperBook` (App.tsx:1556)
    abren la hoja de adjuntar cuando `hasFile === false || (plan === 'free'
    && remoteOnly)`.
  - Las descargas (App.tsx:1920, Shelf.tsx:1631) se ocultan en esos casos.
  - Una descarga que recibe `402` abre la hoja.
- **`selectBook`**
  1. Siempre encola una operación `meta` en `runBookQueue`. La ejecuta
     `registerBookMeta()` (books.ts).
     - Un 402 o un 4xx descartan la operación.
     - Un 5xx o la falta de red la reintentan.
  2. Con `hasLectaPlus(plan)`, encola además la subida.
  3. Un `402` en la subida saca esa operación de la cola.
- **Paso a Lecta+**: lo corre **solo App**, una vez, cuando el plan pasa de
  algo que no es Lecta+ a Lecta+.
  1. `listRemoteBooks()` → filas con `hasFile === false` cuyo hash existe en
     local.
  2. `queueBookUpload` de esas filas.
  3. `runBookQueue`.
- **Hoja de adjuntar**: `src/client/components/AttachBookSheet.tsx`.
  - Corre las dos validaciones de `epub-intake`: la de los primeros 4096
    bytes y la del buffer completo.

### Cuenta obligatoria y URL

- **Parser único de URL** en `authLink` (App.tsx:141-150): lee `token`,
  `error`, `cuenta`, `gato` y `carne`.
  - Guarda `gato` en `lecta:gato` antes de `replaceState`.
  - `carne=1` pone `showAccount = true`.
- **Tabla de decisión**: gana la primera fila que aplica.

| Condición | Qué se muestra |
| --- | --- |
| Hay `authLink` (token, error o cuenta) | `Welcome` en ese modo (reset, error o cuenta eliminada) |
| Hay sesión | La app |
| `isPending` | Carga, como hoy |
| `error` | La base local si hay `lastUserId`; si no, `Welcome` con aviso |
| Sin sesión y en línea | `Welcome`, y se borra `lastUserId` |
| Sin sesión, sin red y con `lastUserId` | La base local |
| Sin sesión, sin red y sin `lastUserId` | `Welcome` con el aviso offline |

- **Plan en el cliente**: hay un único store de módulo en
  `account-plan.ts`.
  - API: `planStore.get()`, `planStore.subscribe(fn)` y
    `planStore.set(userId, snapshot)`.
  - Usa la clave de `getActiveUserId()` (idb.ts:664) y persiste en
    `account:plan:v1:<userId>`.
  - `useUserPlan()` es `useSyncExternalStore` sobre ese store.
  - El valor inicial es `null`, que significa «desconocido». Con `null` no
    se muestran notas ni se hacen llamadas premium.
  - **Solo App** llama a `set`: después de `checkRemoteReset` (que le pasa el
    cuerpo que ya leyó, sin pedirlo dos veces), en `runFullSync` y en el
    sondeo de `?carne=1`.
- **Vuelta de Checkout**: con `carne=1`, App consulta `/api/account/state`
  cada 2 s durante 20 s y se detiene en cuanto ve `lecta_plus`.
- **Selector de pelaje**: `needsCoatChoice = plan === 'free' && !starterCoat
  && !pendingStarterCoat()`.

### Stripe sin SDK

- Todas las llamadas usan `fetch` con `Authorization: Bearer
  STRIPE_SECRET_KEY` y `Stripe-Version: 2025-03-31.basil`.
- **`POST /api/billing/checkout {period}`**
  - Parámetros: `mode=subscription`, Price ID por periodo,
    `client_reference_id=userId`,
    `subscription_data[metadata][user_id]=userId`, `customer` si ya existe,
    y `success_url`/`cancel_url` con `/?carne=1`.
  - Respuestas, evaluadas en este orden:
    1. `400` si el `period` no es válido.
    2. `503` si `loadUserPlan` devuelve `undefined` o `degraded`.
    3. `409` para un fundador o un `lecta_plus` vigente.
- **`POST /api/billing/portal`** responde `{url}`, o `404` si la cuenta no
  tiene cliente de Stripe.
- **`POST /api/billing/webhook`**
  1. Verifica la firma: HMAC-SHA256 con tolerancia de 300 s. Si falla, `400`.
  2. Abre una transacción y hace `INSERT lecta_stripe_events ON CONFLICT DO
     NOTHING`. Si el evento ya estaba, responde 200.
  3. Resuelve la cuenta:
     - `checkout.session.completed`: exige `status === 'complete'`, usa
       `client_reference_id` (comprobado contra `"user"`) y pide
       `GET /v1/subscriptions/:id`.
     - `customer.subscription.created|updated|deleted`: usa
       `metadata.user_id` y, si no está, `stripe_customer_id`.
     - Sin cuenta: ROLLBACK y `500`, para que Stripe reintente.
  4. `upsertPlanFromStripe` escribe `stripe_customer_id`,
     `stripe_subscription_id`, `plan = 'lecta_plus'` y `plan_expires_at`
     según el estado de la suscripción:
     - `active`, `trialing`, `past_due` y `unpaid`:
       `items.data[0].current_period_end*1000`.
     - `canceled`, `incomplete_expired` y `paused`:
       `(ended_at ?? now)*1000`.
     - `incomplete`: no escribe nada.
     - Evento `customer.subscription.deleted`: `(ended_at ?? now)*1000`.

     El endpoint del webhook se crea en Stripe con
     `api_version=2025-03-31.basil`, para que el payload traiga
     `items.data[].current_period_end`.

     Nunca rebaja una cuenta `founder_lifetime`. El paso a `free` lo decide
     solo `getUserPlan` con `PLAN_GRACE_MS`.
  5. Ante `42P01`: ROLLBACK y `503`.
- **Borrado de cuenta**: `beforeDelete` (auth.ts:148) lee
  `stripeSubscriptionId` y cancela la suscripción con
  `DELETE /v1/subscriptions/:id`.
  - Cuenta como éxito si Stripe responde 404 / `resource_missing` o si la
    suscripción ya está `canceled`.
  - La llamada se omite si no hay `stripeSubscriptionId`, o si el plan
    efectivo es `free` y `plan_expires_at` ya pasó.
  - Solo un error de otro tipo aborta el borrado.
- **Secrets**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_MONTHLY_ID` y `STRIPE_PRICE_YEARLY_ID`, en `secrets.required`
  y en `WorkerEnv`.

### Visual (Bloque 3)

Se conservan los tokens `--shadow-1`, `--shadow-2`, `--shadow-sheet` y
`--shadow-cover`. Las sombras escritas a mano pasan a filete o a su token.

«Auto oscuro» es `:root:not([data-theme])` dentro de la media query oscura
(tokens.css:347).

| Token | papel | blanco | noche | oled | auto oscuro |
| --- | --- | --- | --- | --- | --- |
| `--night` | `#141b2b` | `#141b2b` | `#141b2b` | `#0b0f18` | = noche |
| `--night-2` | `#1d2740` | `#1d2740` | `#1d2740` | `#141b2b` | = noche |
| `--night-ink` | `#efe6d6` | `#efe6d6` | `#efe6d6` | `#efe6d6` | = noche |
| `--night-soft` | `#b9b2c6` | `#b9b2c6` | `#b9b2c6` | `#b9b2c6` | = noche |
| `--moon` | `#f3c77a` | `#f3c77a` | `#f3c77a` | `#f3c77a` | = noche |
| `--mist` | `#6f8fa0` | `#6f8fa0` | `#8fb0c0` | `#8fb0c0` | = noche |
| `--rule` | `rgba(120,95,70,.14)` | `rgba(120,95,70,.14)` | sin cambio | sin cambio | sin cambio |

- `--ease-spring` conserva el valor de la app (tokens.css:75). El valor del
  landing entra como `--ease-bounce`.
- `--ochre-wash` conserva el rgba de la app.
- Tokens semánticos nuevos (lista cerrada):
  - `--surface-dock`: `--paper-raised`, o `--night` en modo audio;
  - `--surface-herbarium`;
  - `--surface-kindle`;
  - `--ink-on-night`.
- Los bloques por pelaje `.cat.cat--coat-*` de `game.css:619-699` (31
  definiciones `--cat-*`) se mueven tal cual a una sección «Pelajes» al
  final de `tokens.css`. Van fuera de los bloques de tema, para no pisar los
  `--cat-fur` de tema (tokens.css:188-191 y sus equivalentes en los otros
  temas).

Se hace un commit por hoja, en este orden: `tokens.css` → `notebook.css` →
`reader.css` → `shelf.css` → `components.css` → `app.css` → `game.css`. Cada
commit se cierra con `pnpm gate` y capturas a 390 y 1440 px en `papel` y en
`noche`.

## Alternatives Considered

### Alternative A: Columnas en `lecta_account_state`

*   **Pros**: No hace falta una tabla nueva.
*   **Cons**:
    *   La fila solo existe tras el primer write de sync (reset-guard.ts:84).
    *   Comparte el `FOR UPDATE` de la sync (reset-guard.ts:90).
*   **Reason for Rejection**: Rejected by author: bloqueo compartido y filas
    faltantes.

### Alternative B: Campos de Better Auth en `"user"`

*   **Pros**: El plan llega dentro de la sesión.
*   **Cons**:
    *   Acopla el modelo a las migraciones de Better Auth.
    *   La sesión cacheada puede mostrar un plan viejo.
*   **Reason for Rejection**: Rejected by author: acoplamiento con la
    librería y riesgo de datos viejos.

### Alternative C: Gating solo en el cliente

*   **Pros**: Menos código en el Worker.
*   **Cons**: Cualquiera puede llamar las rutas con `curl`.
*   **Reason for Rejection**: Rejected by author: la IA y R2 cuestan dinero.

### Alternative D: `@stripe/stripe-js`

*   **Pros**: Es el flujo oficial de Stripe.
*   **Cons**:
    *   Suma kB al bundle.
    *   Choca con la CSP `script-src 'self'`.
*   **Reason for Rejection**: Rejected by author: Checkout y Portal son
    redirecciones.

### Alternative E: CUJ 6 solo para cuentas que fueron Lecta+

*   **Pros**: No necesita columna nueva.
*   **Cons**: Rompe la promesa de Gratis entre dispositivos.
*   **Reason for Rejection**: Rejected by author: se registran solo los
    metadatos.

### Alternative F: Mock de `getUserPlan` en el mismo módulo que el middleware

*   **Cons**: `vi.mock` no intercepta llamadas dentro del mismo módulo.
*   **Reason for Rejection**: Rejected by author: se separa en
    `plan-store.ts` y `plan-middleware.ts`.

--------------------------------------------------------------------------------

## Non-Functional Requirements

- **Seguridad**
  - Los secrets solo viven en el Worker.
  - La firma del webhook se verifica antes de leer el JSON.
  - Los eventos son idempotentes por `event.id`.
  - El cliente solo envía `period`.
  - No se registra en logs ni `stripe_customer_id` ni el correo.
- **Rendimiento**
  - Cada ruta con gating cuesta un `pg.Client` extra, porque `withClient`
    abre una conexión por llamada (db.ts:64-80), más una consulta por PK.
  - `getSession` no se repite, gracias a `c.set("session")`.
- **Bundle**
  - `Welcome` es lazy.
  - `ReaderCard`, `AuthForms`, `PlanNote` y `WordPanel` viven en chunks que
    ya son lazy (`Account`, `Reader`).
  - En el chunk inicial entran el selector de pelaje (Shelf),
    `AttachBookSheet` (App), `account-plan.ts` y `epub-intake.ts`. Se
    estiman menos de 3 kB.
  - Se registra `check:size` en cada bloque. Partida: 201.97 kB; límite:
    `<=` 215 kB.
- **Rollout**
  1. `wrangler secret put` de los 4 secrets y `.dev.vars`.
  2. Deploy del Worker. La ventana previa a la 027 queda cubierta.
  3. 027 en `lecta_dev`. En `lecta`, solo con autorización y después del
     corte.
  4. Prueba de Stripe en modo test con `stripe listen`.

--------------------------------------------------------------------------------

### Future Improvements

*   Pasar a tokens los hex de `Companion*.tsx`, `ResetAccountSection.tsx`,
    `TtsDebugPanel.tsx` y `admin-insights.css`.
*   Unificar el `shouldAutoShowPreview` duplicado en
    `lib/chapter-analysis.ts:352`.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Cada bloque es un commit. El Bloque 3 son 7 sub-commits.

**Estrategia de mocks del Worker**
- Las pruebas de rutas con gating mockean `loadUserPlan`, de modo que la
  consulta del plan nunca pasa por `withClient`:
  `vi.mock("./plan-store", async (importOriginal) => ({ ...(await
  importOriginal()), loadUserPlan: vi.fn(async () => ({ plan:
  "founder_lifetime", degraded: false, … })) }))`, con la ruta relativa que
  corresponda.
- El middleware real llama a ese mock. Así no se consume ningún `Once` de
  `withClient`, por ejemplo el de explain-passage.test.ts:360.
- En esas rutas, las pruebas que hacían `getSession.mockResolvedValueOnce`
  pasan a `mockResolvedValue`.

### Bloque 1 — Base de datos, Fundadores y puente `?gato=`

1. **`db/migrations/027_user_plan.sql` (Create)**: el contenido de «Datos:
   migración 027».
2. **`db/migrations/README.md`, `db/README.md` (Modify)**: fila de la 027,
   corte y regla de rollout.
3. **`src/shared/plan.ts` + `plan.test.ts` (Create)**
   - Casos: los planes, la basura, los pelajes y la gracia.
   - Cobertura de `src/shared/**`: 85/90.
4. **`src/worker/plan-store.ts` + `plan-store.test.ts` (Create)**: exporta
   `getUserPlan`, `setStarterCoat`, `upsertPlanFromStripe` y `loadUserPlan`.
   Casos:
   - `loadUserPlan` sin cadena de conexión devuelve `undefined`;
   - sin fila;
   - vigente;
   - dentro de la gracia;
   - fuera de la gracia;
   - fundador;
   - `42P01` con `degraded`;
   - otro error;
   - `inTransaction` con `SAVEPOINT`;
   - `setStarterCoat` en sus 3 resultados;
   - `upsertPlanFromStripe` no rebaja a un fundador.
5. **`src/worker/plan-middleware.ts` + `plan-middleware.test.ts` (Create)**.
   Casos de `requireLectaPlus`: 401, 503 si `loadUserPlan` devuelve
   `undefined`, 503 ante un error de base, 402 con body, y paso con
   `c.get("session")`. Casos de `requireKindlePlan`: sin sesión llama a
   `next`, las rutas exentas no consultan el plan, `free` recibe HTML 402 y
   un fundador pasa.
6. **`src/worker/app.ts` + `app.test.ts`, `account-reset.test.ts`
   (Modify)**
   - `account/state` con `plan`; `PUT /api/account/starter-coat` (200 o
     503).
   - Casos: los campos nuevos, que se omita `plan` ante error, y que
     starter-coat dé 401, 400, `exists` y 503.
7. **`src/client/lib/account-plan.ts` + `account-plan.test.ts` (Create)**
   - Funciones: `planStore` (`get`/`subscribe`/`set`, clave por
     `getActiveUserId()`), `loadPlan` / `savePlan`
     (`account:plan:v1:<userId>`), `useUserPlan` (`useSyncExternalStore`,
     arranca en `null`), `pendingStarterCoat`, `claimStarterCoat` y
     `pollPlanUntilPlus({intervalMs: 2000, timeoutMs: 20000})`.
   - Casos: `null`, caché por cuenta, cambio de cuenta, fallo de red, una
     sola reclamación del pelaje, pelaje inválido, que todas las
     suscripciones reciban el `set`, y que el sondeo se detenga al ver
     `lecta_plus` o al agotar el tiempo.
8. **`src/client/lib/account-reset.ts` (Modify)**: `checkRemoteReset` llama a
   `savePlan(userId, body)`.
9. **`src/client/App.tsx` + `App.test.ts` (Modify)**
   - Cambios: el parser único, la tabla de decisión, `Welcome` lazy, y
     `claimStarterCoat()` en el efecto de sesión después de
     `checkRemoteReset` (App.tsx:930) y en `runFullSync`.
   - Con `carne=1`, se lanza `pollPlanUntilPlus()`.
   - Pruebas: cada fila de la tabla; `?gato=` se guarda antes de limpiar la
     URL; `?carne=1` abre «Tú». La prueba de App.test.ts:573 cambia: un
     token abre `Welcome` en modo reset. Las demás pruebas reciben sesión
     por defecto.
10. **`src/client/components/AuthForms.tsx` + `AuthForms.test.ts` (Create),
    `Account.tsx` + `Account.test.ts` (Modify)**
    - Se mueven de Account.tsx: el helper `run` (:452),
      `signInWithPassword` (:469-488), las funciones de `signUp` a
      `resetPassword` (:490-569), el JSX :779-1075 (título, pestañas,
      estado, formularios y reset) y el estado `authMode` (:243).
    - `changePassword` (:571-587) y `sendSetPasswordLink` (:589-599) se
      quedan en Account, porque necesitan sesión.
    - Props: `{ mode, resetToken?, onDone, onError }`.
11. **`src/client/components/Welcome.tsx` + `Welcome.test.ts` (Create)**
    - Muestra el pelaje pendiente (por defecto `ginger`), `AuthForms` en el
      modo de `authLink`, y el aviso offline.
    - Casos: el pelaje, el aviso offline y el modo reset.
12. **`src/client/components/Shelf.tsx` + `Shelf.test.ts` (Modify)**
    - `needsCoatChoice` se pinta antes del onboarding, con 5 opciones con
      `aria-pressed`.
    - Casos: aparece para `free` sin pelaje, no aparece para fundador ni
      Lecta+, y elegir llama a `claimStarterCoat`.
13. **`src/client/lib/companion-closet.ts` + test, `CompanionCloset.tsx`
    (147, 153, 415, 496), `CompanionPanel.tsx` (Modify)**
    - `closetRequirement(article, state, owned, ctx?)`: sin `ctx` se
      comporta igual que hoy.
    - Orden: inicial → plan → poseído → `!state` → logro → nivel.
    - Nuevo `{ kind: "plan"; text: "Lecta+" }`.
    - `nextUnlock(state, owned, candidates, ctx?)` omite `plan`.
    - Mapeo con `COMPANION_COATS[id].articleId`.
14. **`e2e/helpers/session.ts` (Create) y specs (Modify)**
    - `withTestSession` se extrae de `smoke-journeys.spec.ts:240-427`.
      Simula las rutas de sesión, de cuenta y de sync, incluido
      `/api/catalog**`, y exporta `TEST_USER_ID`.
    - Se aplica en `reader-position`, `word-card`, `reader-quote`,
      `critical-journeys`, `paper-reading`, `community` y en los Journeys 1
      (smoke-journeys:9) y 2 (:172-175) de `smoke-journeys`.
    - Se cambia la base que abren las specs, de `lecta` a
      `lecta:u:<TEST_USER_ID>`: reader-position:172, smoke-journeys:53 y
      critical-journeys:84, 210 y 409.
    - Spec nueva: `e2e/welcome.spec.ts`.
15. **`docs/sistema-lecta.md`, `PRODUCT.md` (Modify)**: cuenta obligatoria,
    CockroachDB en lugar de D1, y el copy de Gratis frente a Lecta+.

### Bloque 2 — Stripe sin SDK y gating

16. **`src/worker/billing.ts` + `billing.test.ts` (Create)**. Pruebas de la
    firma, del evento repetido, de la resolución por `client_reference_id`
    y por `metadata`, de los eventos fuera de orden, y del caso sin cuenta
    (500). También:
    - `created`, `updated` y `deleted` escriben `plan_expires_at`;
    - `incomplete` no escribe nada;
    - `incomplete_expired` y `paused` escriben `ended_at ?? now`;
    - un fundador nunca se rebaja;
    - 42P01 da 503;
    - el checkout responde en el orden 400 → 503 (`undefined` o
      `degraded`) → 409;
    - el portal da 404.
17. **`src/worker/app.ts` (Modify)**
    - `app.route("/api/billing", billing)`.
    - `requireLectaPlus` en las rutas de la tabla.
    - `requireKindlePlan` en `/kindle/priming/action` (:221).
    - Los handlers pasan a `c.get("session")`.
    - `PUT /api/user/books/:bookId/meta`.
    - `PUT /api/user/books/:bookId/meta` según su contrato: 400 si el hash
      no coincide, 413 por cuota y 503 ante 42703.
    - `recordUserBook` con `has_file = EXCLUDED.has_file` y la cadena de 3
      variantes.
    - Los listados con su respaldo ante 42703, consulta por consulta.
    - `listMetaOnlyRows`.
18. **Pruebas del Worker (Modify)**: `explain-passage.test.ts`,
    `books.test.ts`, `user-books.test.ts`, `app.test.ts` y
    `community-books.test.ts` mockean `loadUserPlan` de `./plan-store`.
    - **`user-books.test.ts`**: el almacén pasa en este paso a un mock pg en
      memoria, `withClient: (_e, cb) => cb({ query })`, como
      routes.test.ts:38-46. Debe emular:
      - el upsert;
      - `SUM(size_bytes)` y `COUNT`;
      - `SELECT r2_key`;
      - `book_id AS id`;
      - `r2_key NOT LIKE`;
      - `has_file`.

      El paso 40 solo retira los `DB: mockDb` que queden.
    - **`app.test.ts`**: los `it` de :192-240, 255-263, 278-300, 315-329 y
      353-357, que esperan 400/503, ahora mockean `getSession` y
      `loadUserPlan`, para que esos status sigan siendo alcanzables.
    - **`explain-passage.test.ts:360`**: queda intacto, porque la consulta
      del plan ya no pasa por `withClient`.

    Casos:
    - un 402 por ruta;
    - `/meta` crea la fila, no pisa `r2_key` y responde 503 ante 42703;
    - el listado da `hasFile: false` sin duplicados;
    - `GET /api/user/books` excluye las filas sin archivo;
    - `/community` no pasa por el gating.
19. **`src/worker/auth.ts` + `auth.test.ts` (Modify)**: `beforeDelete`
    cancela la suscripción en Stripe. Casos:
    - sin suscripción, no se llama a Stripe;
    - plan `free` ya vencido, se omite la llamada;
    - cancelación correcta;
    - 404 / `resource_missing`, cuenta como éxito;
    - la suscripción ya está `canceled`, cuenta como éxito;
    - otro error, aborta el borrado.
20. **`src/worker/db.ts`, `wrangler.jsonc` (Modify)**: los 4 secrets.
21. **`src/worker/kindle/routes.ts`, `views.ts` + `routes.test.ts`,
    `views.test.ts` (Modify)**
    - Se monta `requireKindlePlan`, también en `/kindle/priming/action`, y se agrega la comprobación en
      `handleKindleLinkAction`, `/api/kindle/prefs` responde 402 y se crea
      `renderKindlePlanRequiredView`.
    - Las pruebas mockean `loadUserPlan` de `../plan-store` y usan
      `getSessionMock.mockResolvedValue`.
    - Casos: `free` recibe la nota (402, `text/html`, sin `<script>`); el
      fundador entra; `/k` sin sesión sigue dando 302 (routes.test.ts:525);
      las rutas exentas no consultan el plan; vincular sin plan da 402; un
      `userId` vacío se rechaza; el formulario de priming sin sesión sigue
      procesando `mute_book`.
22. **`src/client/lib/lexicon.ts` + test (Modify)**: `code?:
    "LECTA_PLUS_REQUIRED"` en `ExplainInPassageResult` y en `fetchItems`.
23. **`src/client/components/PlanNote.tsx` + `PlanNote.test.ts` (Create)**:
    la nota de 2 líneas con enlace al Carné. Sus estilos van en
    `components.css`.
24. **`reader/ReaderOverlays.tsx` + `ReaderOverlays.test.ts`,
    `WordPanel.tsx` + `WordPanel.test.ts` (Modify)**
    - `ReaderOverlays` llama a `useUserPlan()` y pasa `planLocked`.
    - La ficha muestra `PlanNote` con `planLocked` o al recibir `code`.
    - Casos: nota en `free`, sin llamada en `free`, nota tras un 402, y el
      fundador sin cambios.
25. **`hooks/useReaderChapterPrep.ts` + test,
    `reader/ReaderNotices.tsx` + `ReaderNotices.test.ts` (Modify)**
    - `useReaderChapterPrep` llama a `useUserPlan()`.
    - `shouldAutoShowPreview(…, plan)` responde `false` en `free`.
    - La nota aparece una sola vez por libro, con la clave migrable
      `plan-note:prep:<hash>`.
    - Abrir la preparación a mano en `free` muestra `PlanNote`.
26. **`src/client/lib/books.ts`, `book-queue.ts`, `reading-sync.ts` +
    pruebas (Modify)**
    - `uploadBook` devuelve `{ok, status}`.
    - `downloadBook` devuelve `{file}` o `{status}`.
    - Se agrega `registerBookMeta()`.
    - `runBookQueue` gana la operación `meta`:
      - un 402 o un 4xx la descartan;
      - un 5xx o la falta de red la reintentan.
    - Un 402 en la subida saca la operación de la cola.
    - En `free` no se llama a `syncUserBookUpload`.
    - Al pasar a Lecta+, **solo App** encola una sola vez las filas remotas
      con `hasFile === false` cuyo libro existe en local.
    - Hay casos de prueba para cada punto.
27. **`src/client/lib/epub-intake.ts` + test (Create), `App.tsx`,
    `Shelf.tsx` (Modify)**
    - Se extrae la validación de `selectBook` (App.tsx:1230-1245). Corre las
      dos comprobaciones:
      - `EPUB_MAX_BYTES` y `checkEpubHeader` sobre los primeros 4096 bytes;
      - `checkEpubBuffer(await file.arrayBuffer())`, que ya existe en
        epub-check.ts:38 como alias.
    - Se agrega `hasFile` en `RemoteBook`, `ShelfItem` (Shelf.tsx:74-85),
      `refreshLibrary` (también en `localItems`), `openShelfItem` y
      `handlePaperBook`, y se ocultan las descargas.
    - `AttachBookSheet.tsx` + `AttachBookSheet.test.ts` (Create):
      - mismo `sha256Hex(file)`: `saveBook({hash, name: file.name, data:
        file, title, author, language, addedAt: Date.now()})`, luego
        `updateBookMeta` como en `selectBook`, `refreshLibrary` y
        `openStoredBook` (App.tsx:1328);
      - hash distinto: muestra «Este archivo es distinto al que abriste
        originalmente. Adjunta el mismo archivo EPUB o pasa a Lecta+ para
        sincronizar tus libros automáticamente.» y no escribe nada.
    - `openRemoteBook` (App.tsx:1395-1398) manda un 402 de descarga a la
      hoja.
    - App lanza `pollPlanUntilPlus()` con `?carne=1`.
    - Casos: hash igual, hash distinto sin escritura en IndexedDB, archivo
      demasiado grande o inválido, y el 402.
28. **`notebook/FreeModes.tsx` (Modify) + `FreeModes.test.ts` (Create),
    `hooks/useReviewSession.ts` (Modify) + `useReviewSession.test.ts`
    (Create)**
    - En `free`, los modos libres se ven deshabilitados y `startPractice` no
      llama a `fetchItems`.
    - Casos: `free`, «Repasar» y Lecta+.
29. **`Account.tsx`, `KindleAppearancePanel.tsx` +
    `KindleAppearancePanel.test.ts` (Modify), `ReaderCard.tsx` +
    `ReaderCard.test.ts` (Create)**
    - El Carné tiene 3 estados y el selector Mensual / Anual.
    - Casos: los 3 estados, `{period}`, el portal, el 409 y `?carne=1`.
    - El panel de Kindle muestra `PlanNote`.
30. **`marketing/landing/landing.js`, `index.html` (Modify)**
    - `setCoat` en la carga no guarda nada ni reescribe ningún `href`.
    - En `change`, guarda y reescribe.
    - El CTA de Lecta+ de index.html:561 pasa a `data-cta-plus` (Create),
      con `href=".../?carne=1"`.
    - En `change`, `setCoat` escribe `?gato=X&carne=1` en ese enlace y
      `?gato=X` en los demás.
    - Se quita el texto de «Muy pronto», y se ajusta el copy.
31. **`AGENTS.md`, `src/worker/README.md`, `src/worker/kindle/README.md`,
    `README.md` (Modify)**: secrets, `/api/billing/*`, los módulos de plan,
    la tabla de gating y la ventana previa a la 027.

### Bloque 3 — Unificación visual (7 sub-commits)

32. **`tokens.css` + `tokens.test.ts`**: la tabla de tokens,
    `--ease-bounce` y los 4 tokens semánticos.
    - Los bloques `.cat.cat--coat-*` (game.css:619-699) se mueven tal cual
      a la sección «Pelajes».
    - Se actualizan las pruebas de contraste.
33. **`notebook.css`**: `--surface-herbarium`, los 58 hex pasan a tokens, sin
    respaldos `#fed7aa`/`#fde68a`, con filetes y radios `--r-1`/`--r-2`.
34. **`reader.css`**: los docks (:3101 y :5155) con `--r-2` y
    `--surface-dock`, `--shadow-2`, y los 127 hex pasan a tokens.
35. **`shelf.css` + `Shelf.tsx`**:
    - repisas con filetes;
    - el gato se posa sobre el filete (Shelf.tsx:967, Shelf.tsx:1227);
    - los 64 hex pasan a tokens.
36. **`components.css` + `WordPanel.tsx`**: doble filete en `.sheet` (:202),
    microbrote con `prefers-reduced-motion`, y los 60 hex pasan a tokens.
37. **`app.css`**: `.kindle-panel` (:665) con `--surface-kindle` y
    `--ink-on-night`, y los 10 hex pasan a tokens.
38. **`game.css` + `Journey.tsx`**: el Guardarropa, el sol `--vermilion` en
    la etapa Bibliotecario, y los hex que quedan pasan a tokens.

### Bloque 4 — Deuda del bootstrap

39. **`Reader.tsx` + `Reader.test.ts`**: el título de la barra superior
    (:4106) pasa por `bookDisplayName`. Caso: nombre de archivo tipo hash.
40. **Un solo commit: `src/worker/db.ts`, `app.ts`, `kindle/routes.ts`,
    `kindle/routes.test.ts`, `user-books.test.ts`, `README.md`,
    `src/worker/README.md`, `src/worker/kindle/README.md`**
    - Se quitan `DB?`, `BOOKS_BUCKET?` y `MODELS_BUCKET?`.
    - Se quitan todas las ramas `env.DB`. El criterio `grep` del final es el
      que manda. Lista orientativa:
      - db.ts:180-190;
      - app.ts:1742, 1850-1890, 1926, 1949, 2326, 2579, 2621, 2648, 2681,
        2717, 2776, 2956, 3451, 3499, 3549-3556, 3586;
      - routes.ts:734, 749, 800, 836, 938-994, 1425, 1659, 1989.
    - Se quita el parámetro `db?: D1Database` (routes.ts:356, 415, 545), y
      las llamadas dejan de pasar el argumento `c.env?.DB`.
    - Los respaldos de bucket pasan a `env.BOOKS` (app.ts:318, 3352, 3470,
      3603; routes.ts:1638, 1712, 1747, 1785, 2299).
    - Se edita el comentario de routes.ts:77. `memoryCodeStore` se queda.
    - `routes.test.ts`: se borra el test de D1 (:240-314) y su reemplazo
      verifica en `dbQueryMock` el `INSERT INTO kindle_link_codes` y el
      `UPDATE … SET status = 'linked'`.
    - `user-books.test.ts`: el mock pg ya llegó en el paso 18. Aquí solo se
      quitan los `DB: mockDb` que queden.
    - Se quitan las notas de bindings de los READMEs.
    - Criterio de terminado: `grep -rE
      'env\??\.DB\b|D1Database|BOOKS_BUCKET|MODELS_BUCKET' --include='*.ts'
      src/worker` devuelve 0 líneas.

### Verification Plan

*   **Gate**: `pnpm gate` en cada bloque y en cada sub-commit del Bloque 3.
*   **Cobertura**: `pnpm vitest run --coverage`. Los umbrales de
    `vitest.config.ts` no bajan: global 75/72, `src/worker/**` 75/72,
    `src/client/lib/**` 75/72 y `src/shared/**` 85/90.
*   **Presupuesto**: se registra `check:size` en cada bloque.
*   **E2E**: `pnpm test:e2e` y `pnpm test:e2e:smoke`, ambos con
    `withTestSession`.
*   **Stripe**: en modo test con `stripe listen --forward-to
    localhost:<port>/api/billing/webhook`. Se prueban el checkout, la
    renovación, `past_due`, la cancelación, los eventos fuera de orden y la
    subida tras pasar a Lecta+.
*   **Migración**: `pnpm db:migrate` en `lecta_dev`. Se compara el número de
    filas `founder_lifetime` con el de `"user"` creados antes del corte.
*   **Visual**: capturas a 390 y 1440 px en `papel` y en `noche`, en cada
    sub-paso del Bloque 3.

--------------------------------------------------------------------------------

*Drafted with EGM*
