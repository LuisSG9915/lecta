Status: resolved (ronda 1: auto accept, 34 arreglos aplicados con las propuestas por defecto de D1–D4)

# Goldfish Annotated Review Report — Ronda 1

**Target:** `design_draft.md` (full file)

**Revisores:**
- `implementation_readiness` (completed): 3 Blockers, 15 Majors, 6 Nits.
- `codebase_details` (completed): 8 Blockers, 17 Majors, 6 Nits.

**Resultado:**
- La ronda **no está limpia**. Tras quitar duplicados quedan 34 hallazgos:
  9 Blockers, 18 Majors y 7 Nits.
- Ninguno se rebate. Todos se verificaron contra el código citado.
- Cuatro hallazgos piden una **decisión de autor**: D1–D4. Llevan una
  propuesta por defecto, que es la que se aplica con «auto accept».

Ids: `ir` = implementation_readiness, `cd` = codebase_details,
`<revisor>-1-<n>`.

---

## Decisiones de autor (PROPOSE FIX con propuesta por defecto)

### [D1] ir-1-B1 + cd-1-B1 — Blocker — El recorrido 6 no puede ocurrir

* **Affected Scope:** CUJ 6, Gating (fila R2), puntos 20 y 21.
* **Discrepancy:** `GET /api/books` arma la lista solo con objetos R2 de
  `books/{userId}/` y filas `paper_only` (app.ts:1965-2024). Una cuenta `free`
  nunca sube el archivo, así que el segundo dispositivo nunca ve el libro.
* **AI Suggestion:** PROPOSE FIX (decisión de autor).
* **Proposed Edit (por defecto):**
  - **Registro solo de metadatos, gratis:**
    - En la 027: `ALTER TABLE user_books ADD COLUMN IF NOT EXISTS has_file
      BOOL NOT NULL DEFAULT true`.
    - Ruta nueva sin gating: `PUT /api/user/books/:bookId/meta {title, author,
      language, name, size}`. Escribe la fila con `has_file = false`.
    - `GET /api/books` mezcla esas filas, igual que hace con
      `listPaperOnlyRows` (app.ts:2014).
  - **En el cliente:**
    - Se reutilizan `remoteOnly` y `openRemoteBook` (App.tsx:1469, 1556), con
      `hasFile: false` en vez de inventar `needsLocalFile`.
    - En `free`, `selectBook` llama a `/meta` en lugar de subir el archivo.
  - Pruebas para cada pieza.
* **Alternativa:** reducir el recorrido 6 a «cuenta Lecta+ que volvió a
  `free`», cuyos objetos R2 ya existen.

### [D2] ir-1-M1 + cd-1-M4 — Major — Once rutas de IA quedan sin gating

* **Affected Scope:** Tabla de gating, Alternative C, Goals.
* **AI Suggestion:** PROPOSE FIX (decisión de autor). Añadir una tabla
  explícita con cada ruta de IA.
* **Proposed Edit (por defecto):**
  - **Con gating (`requireLectaPlus`):** `/api/ai/explain-in-passage`,
    `/api/lexicon/explain`, `/api/ai/evaluate-sentence`, `/api/ai/micro-story`,
    `/api/ai/companion-note`, `/api/ai/page-recap`, `/api/ai/translate`,
    `/api/ai/character-recap`, `/api/lexicon/verify-sentence`,
    `/api/lexicon/items(/answer)`.
  - **Libres:** `/api/ai/enrich`, `/api/lexicon/enrich`,
    `/api/lexicon/enrich-batch`. Rellenan el catálogo compartido con
    significados que sirven a todos, y ya tienen cuota por hora
    (`lecta_ai_quota`). Se añaden a Non-Goals con esa razón.

### [D3] ir-1-M14 + cd-1-M14 — Major — Borrar la cuenta deja la suscripción cobrando

* **AI Suggestion:** PROPOSE FIX (decisión de autor).
* **Proposed Edit (por defecto):**
  - `beforeDelete` (auth.ts) cancela la suscripción con
    `DELETE /v1/subscriptions/:id` si existe `stripe_subscription_id`. Si
    Stripe falla, el borrado se aborta con un error en español.
  - Un webhook sin fila responde 200 sin cambios.
  - `resetAccountDataDb` (db.ts:127-167) **no** borra `lecta_user_plan`; se
    dice explícitamente.
  - Pruebas en `billing.test.ts` y `auth.test.ts`.

### [D4] cd-1-M1 — Major — El INSERT de fundadores corre una sola vez

* **Discrepancy:** si la 027 llega a `lecta` antes del corte, las cuentas
  creadas entre la migración y el corte quedan en `free`.
* **AI Suggestion:** PROPOSE FIX (decisión de autor).
* **Proposed Edit (por defecto):**
  - Regla de rollout: la 027 **no** se aplica en `lecta` antes de
    `2026-11-13T00:00:00Z`.
  - `db-migrate.mjs` no se modifica.
  - Alternativa: que `getUserPlan` trate «sin fila y `"createdAt"` antes del
    corte» como `founder_lifetime`. Cuesta un JOIN con `"user"` en cada
    lectura.

---

## Blockers (PROPOSE FIX)

### [1] ir-1-B2 + cd-1-B2 — Kindle: el gating apunta a otros handlers

* **Discrepancy:**
  - routes.ts:184 y :193 son `handleKindlePrefsApiGet` y `Put`, la API JSON
    del panel del celular.
  - Las páginas `/k` leen la sesión en unos 17 sitios.
  - `/kindle/verify` es el sondeo del dispositivo, que no lleva sesión.
* **Proposed Edit (punto 16):**
  - Un solo `kindleRoutes.use("*", requireKindlePlan)` justo después del
    middleware de CSP (routes.ts:1068).
  - Rutas exentas: `/login`, `/logout`, `/kindle`, `/link`, `/verify`,
    `/api/kindle/status`.
  - Comprobación del plan dentro de `handleKindleLinkAction`
    (routes.ts:756), después de resolver `userId`; un `userId` vacío se
    rechaza.
  - La nota se sirve como HTML con status 402.
  - `/api/kindle/prefs` responde JSON 402.

### [2] ir-1-B3 + cd-1-B4 — Kindle: el plan de pruebas no coincide con las existentes

* **Discrepancy:** routes.test.ts ya simula `withClient` (líneas 38-46). La
  prueba de D1 (240-314) verifica `mockDb.prepare`, así que no puede conservar
  «las mismas aserciones».
* **Proposed Edit (punto 35):**
  - Borrar esa prueba.
  - Añadir una que verifique que `dbQueryMock` recibió `INSERT INTO
    kindle_link_codes` y `UPDATE kindle_link_codes SET status = 'linked'`.
  - Decidir el destino de `memoryCodeStore` (se queda como respaldo de
    pruebas).
  - Retirar el parámetro `db?: D1Database` de `createKindleLinkCode`,
    `linkKindleCodeFromMobile` y `consumeLinkedKindleCode` (routes.ts:355,
    414, 544).

### [3] cd-1-B3 + ir-1-M15 — Bloque 4: no compila y la lista de cambios está incompleta

* **Discrepancy:**
  - `src/worker/user-books.test.ts` usa `DB: mockDb as WorkerEnv["DB"]` 11
    veces.
  - `MODELS_BUCKET` se usa en app.ts:318.
  - El respaldo de bucket aparece en tres formas distintas, en app.ts:3352,
    3470 y 3603, y en routes.ts:1638, 1712, 1747, 1785 y 2299.
* **Proposed Edit (puntos 34 y 35):**
  - Añadir `user-books.test.ts` (Modify).
  - Fijar el criterio de terminado: `grep -E
    'env\??\.DB\b|D1Database|BOOKS_BUCKET|MODELS_BUCKET' src/worker` devuelve
    0 coincidencias.
  - Corregir las citas: app.ts:3549-3556, y las ramas reales de routes.ts en
    :734, :1425, :1659 y :1989.

### [4] cd-1-B5 + ir-1-B3 — Bloque 2 rompe pruebas existentes que no están en la lista

* **Discrepancy:** con `vi.mock("../db")`, `getUserPlan` lee `rows: []` y
  devuelve `free`. Eso cambia el resultado de unas 90 pruebas de Kindle y de
  `explain-passage.test.ts`, `books.test.ts`, `user-books.test.ts`,
  `app.test.ts` y `community-books.test.ts`.
* **Proposed Edit:**
  - Añadir esos archivos como Modify.
  - Estrategia única: `vi.mock("../plan")` (o `./plan`), que por defecto
    devuelve `founder_lifetime`.
  - Casos nuevos: `free` recibe 402 o la nota, el fundador pasa, y las rutas
    exentas no consultan el plan.

### [5] cd-1-B6 + ir-1-M9 — Bloque 1 rompe App.test.ts y otras specs

* **Discrepancy:**
  - App.test.ts usa `useSession → {data: null}` por defecto.
  - `paper-reading.spec.ts` importa sin sesión.
  - `community.spec.ts` no simula `/api/account/state`.
  - Con sesión, los datos viven en `lecta:u:<id>`, pero
    `reader-position.spec.ts:172` y `smoke-journeys.spec.ts:53` abren
    `"lecta"`.
  - Las rutas de sync sin simular devuelven 401, y `accountFetch` cierra la
    sesión.
* **Proposed Edit (punto 11):**
  - `withTestSession` se extrae de `smoke-journeys.spec.ts:241-420`, que ya
    simula las rutas de sync.
  - Simula: `get-session`, `account/state`, `/api/positions**`,
    `/api/annotations**`, `/api/activity**`, `/api/reviews**`,
    `/api/knowledge**`, `/api/vocab**`, `/api/companion**`,
    `/api/sync/counts**`, `/api/books**`, `/api/user/books**` y
    `/api/catalog**`.
  - Exporta `TEST_USER_ID`, y las specs abren `lecta:u:<id>`.
  - Añadir `paper-reading.spec.ts`, `community.spec.ts` y `App.test.ts`
    (Modify).

### [6] cd-1-B7 + ir-1-M2 — El costo de `requireLectaPlus` está mal descrito

* **Discrepancy:** cada `withClient` abre su propio `pg.Client`
  (db.ts:64-80), y `getSession` no está memorizado (session.ts:83).
* **Proposed Edit:**
  - Contrato del middleware: `createMiddleware<{ Bindings: WorkerEnv;
    Variables: { session } }>`.
    - Sin sesión: 401 `{error}`.
    - `withClient` devuelve `undefined`: 503.
    - Error de base distinto de 42P01: 503.
    - Sin plan: 402 `{ error: "Esta función es de Lecta+.", code:
      "LECTA_PLUS_REQUIRED" }`.
    - Si pasa: `c.set("session")`, y los handlers usan `c.get("session")`.
  - Se monta ruta por ruta, nunca con `app.use("/api/books/:hash")`, que
    también atraparía `/community`.
  - En Non-Functional Requirements: «una conexión y una consulta por PK
    extra».

### [7] cd-1-B8 + ir-1-M13 — Ratchet de cobertura mal citado

* **Discrepancy:** `src/worker/**` exige 75/72 y `src/shared/**` 85/90
  (vitest.config.ts:63-74). `pnpm gate` no corre cobertura.
* **Proposed Edit:**
  - Corregir las cifras.
  - Añadir `pnpm vitest run --coverage` al Verification Plan de cada bloque.

---

## Majors (PROPOSE FIX)

### [8] ir-1-M3 + cd-1-M5 — WordPanel: el gating vive en otros archivos

* **Discrepancy:**
  - `canExplain` se calcula en `ReaderOverlays.tsx:286`.
  - `explainInPassage` pierde el 402 (lexicon.ts:608-610).
  - El texto actual dice «Inicia sesión…» (WordPanel.tsx:988-1000).
* **Proposed Edit:**
  - Añadir ReaderOverlays.tsx y lexicon.ts.
  - Prop nueva `planLocked`.
  - `ExplainInPassageResult` gana `code?: "LECTA_PLUS_REQUIRED"`, y lo mismo
    `fetchItems`.
  - Texto de `.plan-note`: «La explicación en contexto es de Lecta+.» /
    «El significado de arriba siempre es tuyo.»

### [9] cd-1-M6 + ir-1-M3 — Falta la ruta de subida directa

* **Discrepancy:** `selectBook` también sube por `syncUserBookUpload`
  (reading-sync.ts:909-931). Además, `uploadBook` devuelve un booleano, así
  que un 402 no se distingue de otro error.
* **Proposed Edit:**
  - Añadir reading-sync.ts.
  - `uploadBook` devuelve `{ok, status}`.
  - Un 402 saca la operación de la cola.
  - En `free` no se llama a `syncUserBookUpload`.

### [10] ir-1-M4 — El pelaje y el plan no se reclaman al iniciar sesión

* **Discrepancy:** `runFullSync` solo corre con el evento `online`.
* **Proposed Edit:**
  - Llamar `claimStarterCoat()` y `refreshPlan()` en el efecto de sesión,
    después de `checkRemoteReset(scope,{force:true})` (App.tsx:930), y
    también en `runFullSync`.
  - `checkRemoteReset` (account-reset.ts:84) pasa el cuerpo ya leído a
    `savePlan`, para no pedirlo dos veces.

### [11] ir-1-M5 + cd-1-M10 — Parámetros de URL sin un único dueño

* **Proposed Edit:**
  - Un solo parser en `authLink` para `token`, `error`, `cuenta`, `gato` y
    `carne`.
  - `gato` se valida y se guarda en `localStorage` **antes** de limpiar la
    URL, para que sobreviva al magic link (`callbackURL: "/"`).
  - `carne=1` hace `showAccount=true`.
  - `pendingStarterCoat()` solo lee `localStorage`.

### [12] ir-1-M6 + cd-1-M10 — Arranque del plan y caso «sesión inválida» sin definir

* **Proposed Edit:**
  - Snapshot inicial `null` (plan desconocido): la UI no muestra notas ni hace
    llamadas premium. Si no hay caché ni red, se sigue en `null`.
  - Condición del caso 3: `!isPending && !error && !session &&
    navigator.onLine` → `Welcome`. En ese momento se borra `lastUserId`.

### [13] ir-1-M7 + cd-1-M13 — Webhook: orden de eventos, periodo y gracia

* **Proposed Edit:**
  - El checkout envía `subscription_data[metadata][user_id]`.
  - La cuenta se resuelve por `metadata.user_id` y luego por
    `stripe_customer_id`.
  - Si no hay coincidencia: ROLLBACK, sin registrar el evento, y respuesta
    500 para que Stripe reintente.
  - Se fija la cabecera `Stripe-Version`. El fin de periodo se lee de
    `items.data[0].current_period_end`.
  - En `checkout.session.completed` se comprueba `status === 'complete'` y se
    pide `GET /v1/subscriptions/:id` para fijar `plan_expires_at`.
  - Gracia de 3 días sobre `plan_expires_at`.
  - 42P01 → ROLLBACK + 503.
  - Todo con pruebas.

### [14] ir-1-M8 + cd-1-M7 — Reglas del guardarropa incompletas

* **Proposed Edit:**
  - Nuevo miembro `{ kind: "plan"; text: "Lecta+" }` en `ClosetRequirement`,
    con orden de chequeo: `starter` → `plan` → `owned` → nivel.
  - En `free`, lo poseído que no sea el pelaje inicial queda bloqueado pero
    se conserva.
  - Mapeo de id a artículo con `COMPANION_COATS[id].articleId`
    (companion-data.ts:311).
  - `nextUnlock`, `distanceOf` y `kindRank` ignoran el tipo `plan`.
  - Equipar el pelaje inicial con la escritura de campos del compañero al
    reclamarlo.
  - Añadir `CompanionCloset.tsx` (147, 415, 496) y `CompanionPanel.tsx`.

### [15] cd-1-M8 — El paso «Elige a tu gato» nunca aparece en cuentas nuevas

* **Discrepancy:** `showOnboarding` exige `!isFirstTimeReader`
  (Shelf.tsx:770-773).
* **Proposed Edit:** condición propia `needsCoatChoice = plan !== null &&
  !starterCoat && !pendingStarterCoat()`. Se pinta antes del bloque de
  onboarding, sea o no la primera lectura.

### [16] cd-1-M9 — El landing siempre escribe un pelaje y pisa `&carne=1`

* **Proposed Edit (punto 24):**
  - `setCoat` solo guarda en `localStorage` ante una elección explícita
    (evento `change`).
  - El CTA de Lecta+ lleva `data-cta-plus`, y `setCoat` le conserva
    `&carne=1`.

### [17] ir-1-M10 + cd-1-M15 — Valores de tokens sin definir

* **Proposed Edit (punto 26):** una tabla con el valor por bloque de
  `tokens.css` (`papel`, `blanco`, `noche`, `oled`, y
  `:root:not([data-theme])`) para `--night`, `--night-2`, `--night-ink`,
  `--night-soft`, `--moon`, `--mist` y `--rule`.
  - **`--ease-spring`:** la app conserva su valor actual (tokens.css:75). El
    del landing entra como `--ease-bounce`.
  - **`--ochre-wash`:** se conserva el rgba de la app.
  - **`--rule` en `blanco`:** `rgba(120,95,70,.14)` sobre blanco.
  - Lista cerrada de tokens semánticos nuevos.

### [18] ir-1-M11 — La meta «sin hex» no coincide con el alcance

* **Proposed Edit:** acotar la meta a «las 7 hojas listadas». Los hex de los
  TSX del gato (`Companion*.tsx`) y de `admin-insights.css` pasan a Future
  Improvements.

### [19] ir-1-M12 + cd-1-M16 — Etiquetas de archivos incorrectas

* **Proposed Edit:**
  - `Account.tsx` (Modify, ya lazy).
  - `ReaderCard.tsx` (Create, import estático desde Account).
  - Añadir `KindleAppearancePanel.tsx` (Modify).
  - Casos de prueba de ReaderCard: los 3 estados, el cuerpo `{period}`, el
    portal, el 409 y el refresco con `?carne=1`.

### [20] cd-1-M11 + ir-1-N6 — Welcome duplica los formularios de auth

* **Proposed Edit:** extraer los formularios de Account.tsx:481-591 a
  `src/client/components/AuthForms.tsx` (Create), que usan Welcome y
  Account.

### [21] cd-1-M12 — `shouldAutoShowPreview` existe dos veces

* **Proposed Edit:**
  - Se modifica el de `hooks/useReaderChapterPrep.ts:40`, que gana el
    parámetro `plan: UserPlan | null`.
  - La copia de `lib/chapter-analysis.ts:352` no se toca. Se menciona como
    código duplicado.
  - Abrir la preparación a mano en `free` muestra la misma nota.

### [22] cd-1-M2 + ir-1-N2 — Comparación del corte de fundadores

* **Proposed Edit:**
  - `WHERE "createdAt" < to_timestamp(1794528000)`, en la misma forma que
    admin.ts:203.
  - Lista de columnas explícita: `(user_id, plan, created_at, updated_at)`.

### [23] cd-1-M3 + ir-1 (foco 2) — Rutas de 42P01 y «sin base» por decidir

* **Proposed Edit:**
  - `/api/account/state`: ante un error distinto de 42P01 omite `plan`, y el
    cliente conserva su caché.
  - Si `getUserPlan` corre dentro de un `BEGIN`, va envuelto en un SAVEPOINT,
    igual que `lockResetMarker`.
  - El resto, según [6].

### [24] ir-1-M13 — Cada módulo con sus casos de prueba nombrados

* **Proposed Edit:** una línea de casos para cada uno de estos módulos:
  - app.ts: los campos de `account/state`; el PUT de `starter-coat` (401,
    400, escritura única, 503); un 402 por ruta con gating.
  - account-plan.ts.
  - La puerta de cuenta en App.
  - El selector de pelaje en Shelf.
  - ReaderNotices y useReaderChapterPrep.
  - El 402 en books.ts.
  - views.ts.
  - FreeModes y useReviewSession.

### [25] cd-1-M17 + ir-1-N1 — Validación del EPUB adjunto incompleta

* **Proposed Edit:**
  - Extraer la validación de `selectBook` (App.tsx:1230-1245):
    `EPUB_MAX_BYTES`, `checkEpubHeader` y luego `checkEpubBuffer(await
    file.arrayBuffer())`.
  - `sha256Hex(file)`.
  - Abrir con `openStoredBook` (App.tsx:1328) para que se reconcilie la
    posición.

---

## Nits

* **[26] ir-1-N3 (DECLINE → PROPOSE FIX):** la prueba «no monta la
  estantería» pasa a App.test.ts.
* **[27] ir-1-N4 (PROPOSE FIX):** clave `plan-note:prep:<hash>` en la session
  KV, migrable.
* **[28] ir-1-N5 + cd-1-N2 (PROPOSE FIX):** paso de rollout: `wrangler secret
  put` de los 4 secrets antes del deploy, más las entradas en `.dev.vars`.
* **[29] cd-1-N1 (PROPOSE FIX):** absorbido por [3].
* **[30] cd-1-N3 (PROPOSE FIX):** seguir la convención de la 026: comentar el
  paso manual de `schema_locked` y no activar RLS.
* **[31] cd-1-N4 (PROPOSE FIX):** `pnpm gate` corre `scripts/test-trace.mjs`.
* **[32] cd-1-N5 (PROPOSE FIX):** absorbido por [13].
* **[33] cd-1-N6 (PROPOSE FIX):** absorbido por [19].

---

Status: resolved (ronda 2: auto accept, 28 arreglos aplicados con E1–E4 por defecto)

# Goldfish Annotated Review Report — Ronda 2

**Target:** `design_draft.md` (full file)

**Revisores:**

- `implementation_readiness` (completed): 2 Blockers, 14 Majors, 11 Nits.
- `codebase_details` (completed): 2 Blockers, 13 Majors, 10 Nits.

**Resultado:** ronda **no limpia**.

- Sin duplicados quedan 28 hallazgos: 3 Blockers, 15 Majors y 10 Nits.
- No hay churn. Ningún hallazgo nuevo se resuelve revirtiendo un arreglo de
  la ronda 1. Los arreglos de la ronda 1 dejaron ver capas más profundas.
- Ninguno se rebate.
- Cuatro hallazgos son **decisiones de autor (E1–E4)**. Cada uno trae una
  propuesta por defecto.

## Decisiones de autor (PROPOSE FIX con propuesta por defecto)

### [E1] ir-2-M7 — Major — Contradicción en la regla de cancelación

Las Goals y `getUserPlan` dicen «fin de periodo + 3 días». En cambio, el
webhook pasa a `free` de inmediato con `deleted` y con cualquier estado
distinto de `active`.

**Por defecto:**

- `active` y `trialing` dejan `lecta_plus`.
- `past_due` y `unpaid` conservan `lecta_plus`. `getUserPlan` aplica la
  gracia de 3 días sobre `plan_expires_at`.
- `canceled` y `customer.subscription.deleted` hacen
  `plan_expires_at = ended_at*1000` y dejan `lecta_plus`. Así, «vencido más
  3 días» lo lleva a `free` en una sola regla.

### [E2] ir-2-M9 — Major — El selector de pelaje aparece a todos los fundadores

La 027 deja `starter_coat` en NULL.

**Por defecto:** `needsCoatChoice` aplica solo cuando `plan === 'free'`.
Fundadores y Lecta+ ya tienen todos los pelajes.

### [E3] ir-2-M3 — Major — Qué pasa con los libros sin archivo al pasar a Lecta+

**Por defecto:**

- Al cambiar `plan` a Lecta+, el cliente encola `queueBookUpload` de cada
  libro local cuya fila remota tenga `has_file = false`.
- La subida pone `has_file = true`.

### [E4] ir-2-M13 — Major — Los `--cat-*` contradicen la meta de «sin hex»

game.css tiene 31 definiciones `--cat-*: #…`.

**Por defecto:**

- Los `--cat-*` se mueven a `tokens.css`, porque son tokens del gato.
- La meta queda sin excepción.

## Blockers (PROPOSE FIX)

### [1] ir-2-B1 + cd-2-B1 — El mock de plan no llega al middleware

Ubicación: líneas 241-262, 475-478, 607 y 622.

**Discrepancia:**

- Las llamadas dentro del mismo módulo no se interceptan.
- Como el middleware ya hace `getSession`, cualquier
  `mockResolvedValueOnce` de `getSession` en las pruebas deja al handler
  con `undefined`, y el handler responde 401.

**Arreglo:**

- `getUserPlan` y `setStarterCoat` van en `src/worker/plan-store.ts`.
- `requireLectaPlus` y `requireKindlePlan` van en
  `src/worker/plan-middleware.ts` e importan `./plan-store`.
- Las pruebas mockean `./plan-store` con `importOriginal`.
- Lista explícita de handlers que pasan a `c.get("session")`:
  `handleBookUpload` (app.ts:2144, retipado con
  `Variables: { session: Session }`), `/api/books/:hash`,
  `/api/user/books/:bookId/file` y las 9 rutas de IA.
- Las pruebas que usan `mockResolvedValueOnce` de `getSession` en esas
  rutas pasan a `mockResolvedValue`.
- `Session` se define como
  `NonNullable<Awaited<ReturnType<typeof getSession>>>`.

### [2] cd-2-B2 + ir-2-M11 — user-books.test.ts se queda sin almacén de datos al quitar D1

El mock de D1 (líneas 53-134) es el único almacén de datos de esa prueba.

**Arreglo:**

- Reescribir ese almacén como un mock en memoria de
  `withClient: (_e, cb) => cb({ query })`, igual que
  kindle/routes.test.ts:38-46.
- El mock tiene que cubrir:
  - el INSERT con upsert;
  - `SUM(size_bytes)`;
  - `SELECT r2_key`;
  - `book_id AS id`;
  - `r2_key NOT LIKE`;
  - el filtro `has_file`.
- Va en el mismo commit que el punto 39. Las pruebas nuevas de `/meta`
  usan ese mismo mock.

### [3] ir-2-B2 — El webhook no encuentra la cuenta en el primer checkout

**Arreglo:**

- `checkout.session.completed` resuelve la cuenta por
  `client_reference_id`.
- Ese id se comprueba contra `"user"`.
- Se hace UPSERT en `lecta_user_plan`, escribiendo
  `stripe_customer_id = session.customer` y
  `stripe_subscription_id = session.subscription`.
- Los eventos `customer.subscription.*` resuelven por `metadata.user_id`,
  luego por `stripe_customer_id`, y hacen UPSERT.
- Se agrega `customer.subscription.created`.
- `getUserPlan` devuelve también `stripeSubscriptionId`.
- Se fija `Stripe-Version: 2025-03-31.basil`.

## Majors (PROPOSE FIX)

### [4] ir-2-M1 + cd-2-M12 — Falta la columna `has_file` (42703) antes de la 027

Se sigue el patrón `isMissingColumnError` que ya existe (app.ts:2574, 2616
y 2678):

- `/meta` responde 503.
- Las consultas de listado vuelven a la consulta actual.
- Los upserts usan la variante sin `has_file`.

### [5] cd-2-M1 + ir-2-M2 — Las filas solo de metadatos se filtran al listado legado

**Arreglo:**

- `listUserBooksOutsidePrefix` (app.ts:2611) y `GET /api/user/books`
  (app.ts:3435) añaden `AND has_file = true`, con respaldo ante 42703.
- Nuevo `listMetaOnlyRows`:
  - se ejecuta después de las filas paper-only;
  - descarta duplicados contra `listed`, actualizando `listed` en cada
    ciclo.

### [6] cd-2-M2 + ir-2-M3 — Contrato de `PUT /meta` y `recordUserBook`

**Contrato de `PUT /meta`:**

- Body: `{title, author, language, sha256, size}`.
- `bookId` se valida con `HASH_PATTERN` (app.ts:1963).
- Usa `withResetGuard` / `resetAck` y `checkUserBooksQuota`.
- El SQL es `ON CONFLICT (user_id, book_id) DO UPDATE SET title, author,
  language, updated_at`. No toca `r2_key` ni `has_file`.

**`recordUserBook` (app.ts:1796-1818, 1867-1878):** pone `has_file = true`,
con variante ante 42703.

### [7] cd-2-M3 — El pull de archivos pide filas sin archivo

`GET /api/user/books` filtra `has_file = true` (ver [5]), así que
`pullMissingUserBooksFromCloud` no pide `/file` de filas sin archivo.

Se agrega el caso de prueba.

### [8] ir-2-M4 — Subida con plan desconocido (`null`)

`selectBook` cambia de orden:

1. Siempre llama primero a `registerBookMeta` (en `books.ts`).
2. Solo con `hasLectaPlus(plan)` encola la subida.
3. Si `runBookQueue` recibe 402, saca la operación de la cola. La fila
   remota ya existe.

### [9] cd-2-M4 + ir-2-M5 — `hasFile` no llega a la UI

**Archivos y cambios:**

- `RemoteBook` (books.ts:5-24) y `ShelfItem` (Shelf.tsx:71-78) ganan
  `hasFile?: boolean`.
- El mapeo de `refreshLibrary` (App.tsx:723-753) lo copia.
- `openShelfItem` (App.tsx:1461-1471) y `handlePaperBook` (App.tsx:1556)
  abren la hoja de adjuntar cuando se cumple
  `hasFile === false || (plan === 'free' && remoteOnly)`.
- Las acciones de descarga (App.tsx:1920, Shelf.tsx:1631) se ocultan en
  esos casos.
- Una descarga que recibe 402 abre la misma hoja, en vez de «Revisa tu
  conexión».

### [10] cd-2-M5 + ir-2-M6 — `requireKindlePlan` mal especificado

- Sin sesión, llama a `next()`, porque los handlers redirigen solos.
- Las rutas exentas se escriben completas: `/k/login`, `/k/logout`,
  `/k/kindle`, `/k/link`, `/k/verify`, `/k/api/kindle/status` y
  `/k/api/kindle/link`.
- Priming: `/k/priming/action` y `/k/kindle/priming/action` quedan con
  gating, porque son de lectura en Kindle.
- `/kindle/priming/action`, a nivel app, también recibe `requireLectaPlus`.

### [11] cd-2-M6 + ir-2-N11 — Firma de `closetRequirement` y orden de chequeo

- `closetRequirement(article, state, owned, ctx?)`: con `ctx` ausente se
  comporta igual que hoy.
- `nextUnlock(state, owned, candidates, ctx?)` omite `kind === "plan"`.
- El orden de chequeo queda así:
  1. inicial
  2. plan
  3. poseído
  4. `!state` → `null`
  5. logro
  6. nivel
- Se actualiza CompanionCloset.tsx:153.

### [12] cd-2-M7 + ir-2-M9 — El landing pone `?gato=` siempre

- `setCoat` en la carga de página no reescribe los `href` ni guarda nada.
- Los CTA llevan `?gato=` solo después de un `change` o si hay una
  elección guardada.

### [13] cd-2-M8 + ir-2-M8 — Precedencia de la puerta de cuenta

Tabla de decisión (gana la primera fila que aplica):

| Condición | Qué se muestra |
| --- | --- |
| Hay `authLink` (token, error o cuenta) | `Welcome` en el modo correspondiente (reset, error o eliminada) |
| Hay sesión | La app |
| `isPending` | Lo de hoy (carga) |
| `error` | Base local si hay `lastUserId`; si no, `Welcome` con un aviso |
| Sin sesión, en línea | `Welcome` y se borra `lastUserId` |
| Sin sesión, sin red, con `lastUserId` | Base local |
| Sin sesión, sin red, sin `lastUserId` | `Welcome` con el aviso offline |

Pruebas: se modifica App.test.ts:573.

### [14] cd-2-M9 + ir-2-N5 — Alcance de `AuthForms`

- Se extraen los handlers de Account.tsx:481-599: `signIn`, `signUp`,
  `sendMagicLink`, `sendResetLink`, `resetPassword` y
  `sendSetPasswordLink`.
- Se extrae el JSX de Account.tsx:849-1060 y el estado `authMode` (:243).
- `changePassword` se queda en Account.
- Props de `AuthForms`: `{ mode, resetToken?, onDone, onError }`.

### [15] cd-2-M10 + ir-2-M10 — Faltan specs e2e

Se agregan:

- `critical-journeys.spec.ts`: :84, :210 y :409.
- smoke Journey 2 (smoke-journeys.spec.ts:172-175).

### [16] cd-2-M11 — Pruebas con la etiqueta equivocada o que faltan

Se crean:

- `src/client/components/notebook/FreeModes.test.ts`
- `src/client/hooks/useReviewSession.test.ts`

Se modifican:

- `reader/ReaderOverlays.test.ts`
- `Account.test.ts`
- `KindleAppearancePanel.test.ts`

### [17] cd-2-M13 + ir-2-N8 — La caché del plan no distingue cuentas

- La clave pasa a `account:plan:v1:<userId>`.
- Al punto 9 se le quita `refreshPlan()` después de `checkRemoteReset`,
  que ya pasa el cuerpo de la respuesta.

### [18] ir-2-M12 + cd-2-N2 — Marcador `<now_ms>` en el SQL

`<now_ms>` se reemplaza por `(extract(epoch from now())*1000)::INT8`.

### [19] ir-2-M14 — Falta dónde viven `.plan-note` y `registerBookMeta`

- Componente nuevo `src/client/components/PlanNote.tsx` (Create), con sus
  estilos en `components.css`.
- `registerBookMeta` va en `books.ts`.

## Nits (PROPOSE FIX)

- **[20] ir-2-N1** — `getUserPlan(client, userId, { inTransaction? })`.
- **[21] ir-2-N2** — `getUserPlan` devuelve `degraded: true` ante 42P01, y
  el checkout responde 503 si `degraded`.
- **[22] ir-2-N3** — `setStarterCoat` devuelve
  `'written' | 'exists' | 'unavailable'`. El PUT responde
  `200 {starterCoat}` o `503`.
- **[23] cd-2-N1** — Se citan 016 y 026 para `schema_locked`.
- **[24] cd-2-N3 + ir-2-N4** — routes.ts:356, 415 y 545.
- **[25] cd-2-N4 + ir-2-N9** — El grep se hace con `--include='*.ts'` y se
  edita el comentario de routes.ts:77. El punto 41 entra en el commit del
  punto 39.
- **[26] cd-2-N5** — El presupuesto es `<=` 215 / 55.
- **[27] cd-2-N6** — smoke-journeys.spec.ts:240-427.
- **[28] cd-2-N7 + ir-2-N6** — Revisión completa con `checkEpubBuffer`:
  - Es nueva, aunque hoy es un alias de `checkEpubHeader`.
  - `saveBook` recibe `{name, title, author}` de la fila remota y luego se
    llama `refreshLibrary`.
- **[29] cd-2-N8 + ir-2-N10** — `useUserPlan()` se llama dentro de
  ReaderOverlays y useReaderChapterPrep. Se elimina el paso «sin base → 503»
  del middleware, porque no se puede alcanzar.
- **[30] cd-2-N10 + ir-2-N7** — Los casos 402 van en app.test.ts y
  explain-passage.test.ts. La cobertura incluye `src/client/lib/**` (75/72)
  y el global (75/72).

---

Status: resolved (ronda 3: 25 arreglos aplicados; diseño aceptado por el autor sin ronda 4, con churn registrado en [1] y [18]; E4 corregido por [11])

# Goldfish Annotated Review Report — Ronda 3

**Target:** `design_draft.md` (full file)

**Revisores:**

- `implementation_readiness` (completed): 0 Blockers, 7 Majors, 4 Nits.
- `codebase_details` (completed): 1 Blocker, 13 Majors, 7 Nits.

**Resultado:** la ronda **no está limpia**. Sin duplicados quedan 25
hallazgos: 1 Blocker, 16 Majors y 8 Nits. Ninguno se rebate.

**Tendencia:**

- Blockers: 9 → 3 → 1.
- Majors: 18 → 15 → 16.

**Churn detectado:** dos hallazgos nuevos caen sobre arreglos ya aplicados.

- [1]: la ronda 2 quitó la rama «`withClient` sin base → 503» (r2 [29],
  marcada como inalcanzable). Ahora hace falta. Revertir ese arreglo resuelve
  la mitad del hallazgo.
- [18]: la excepción de bundle de `PlanNote`, añadida en la ronda 2, es
  incorrecta.

## Blocker

### [1] cd-3-B1 + ir-3-M1 + ir-3-M3 — La consulta del plan sigue pasando por `withClient`

**Qué falla:**

- `requireLectaPlus` envuelve `getUserPlan` en `withClient`, así que el mock
  de `./plan-store` no aísla la conexión.
- En user-books.test.ts el `withClient` real intenta conectar con
  `postgres://mock` y devuelve 503.
- En explain-passage.test.ts:360, el `Once` lo consume la consulta del plan y
  la prueba recibe 200 en vez de 429.
- El caso `withClient → undefined` sigue sin definirse.

**Edit:**

- `plan-store` exporta `loadUserPlan(env, userId, opts?)`, que envuelve
  `withClient` + `getUserPlan`.
- El middleware solo llama a `loadUserPlan`.
- Las pruebas mockean `loadUserPlan`; `getUserPlan` se prueba aparte.
- `withClient → undefined` responde `503 {error:"El almacenamiento no está
  configurado."}`. Esto revierte r2 [29].
- Orden final en las rutas con gating: middleware (401 / 503 / 402) → 400 del
  body → 503 de config.

## Majors

### [2] ir-3-M2 — Las pruebas de app.test.ts que esperan 400/503 recibirán 401

**Edit:** el paso 18 lista los `it` de app.test.ts:192-240, 255-263, 278-300,
315-329 y 353-357. En esos `describe` se mockean `getSession` y
`loadUserPlan`, para que el 400/503 siga siendo alcanzable.

### [3] ir-3-M4 — El mock pg de user-books llega tarde

**Edit:**

- El mock en memoria `withClient: (_e, cb) => cb({query})` de
  user-books.test.ts pasa del paso 40 al paso 18 (Bloque 2).
- Emula: upsert, `SUM(size_bytes)`, `COUNT`, `SELECT r2_key`, `book_id AS id`,
  `r2_key NOT LIKE` y `has_file`.
- `/meta` no tiene rama D1.
- El paso 40 solo retira los `DB: mockDb` restantes.

### [4] ir-3-M5 + cd-3-M8 — La subida al pasar a Lecta+ selecciona un conjunto vacío

**Edit:**

- `refreshLibrary` copia `hasFile` también en `localItems`, con
  `remoteByHash.get(hash)?.hasFile`.
- Algoritmo: `listRemoteBooks()` → filas con `hasFile === false` cuyo hash
  existe en local → `queueBookUpload` → `runBookQueue`.
- Corre una sola vez, en App, cuando el plan pasa de no Lecta+ a Lecta+.

### [5] ir-3-M6 + cd-3-N2 — `useUserPlan()` no tiene fuente ni estado compartido

**Edit:**

- Un store de módulo en `account-plan.ts`:
  - `planStore.get()`, `planStore.subscribe()`, `planStore.set(userId, plan)`.
  - Clave por `getActiveUserId()` (idb.ts:664).
- `useUserPlan()` usa `useSyncExternalStore` sobre ese store.
- Solo App hace `set`: tras `checkRemoteReset`, `refreshPlan` y el sondeo de
  [16].
- Solo App corre el efecto de [4].

### [6] ir-3-M7 + cd-3-M12 — Contrato de `/meta`

**Edit:**

- INSERT con columnas `(user_id, book_id, title, author, language, r2_key,
  size_bytes, sha256, has_file, created_at, updated_at)` y valores
  `'' / 0 / sha256 / false`.
- `sha256 !== bookId` → 400.
- `checkUserBooksQuota(env, userId, bookId, 0)`: solo cuenta libros. Si se
  pasa, 413.
- `recordUserBook` sobrescribe `size_bytes` al subir.

### [7] cd-3-M1 + ir-3-N2 — Respaldo ante 42703, consulta por consulta

**Edit:**

| Consulta | Ante 42703 |
| --- | --- |
| `listUserBooksOutsidePrefix` (función app.ts:2606) | Reintenta sin `has_file` |
| `GET /api/user/books` (ruta :3412) | Reintenta sin `has_file` (código nuevo) |
| `listMetaOnlyRows` | Devuelve `[]` |

El patrón citado es solo app.ts:2574.

### [8] cd-3-M2 — La cadena de `recordUserBook` pierde `genre`

**Edit:**

- Cadena de 3 variantes: genre + `has_file` → genre → base.
- El DO UPDATE fija `has_file = EXCLUDED.has_file`.
- Se quita la cita :1867-1878, que es la rama D1.

### [9] cd-3-M3 — `/kindle/priming/action` es un formulario HTML

**Edit:**

- app.ts:221 usa `requireKindlePlan`, no `requireLectaPlus`.
- Sin sesión, la petición sigue (`mute_book`, `disable_all`, `enable_all`).
- Con prueba.

### [10] cd-3-M4 — Los rangos de Account.tsx son incorrectos

**Edit:**

- Se mueven `signInWithPassword` (:469-488), `signUp`…`resetPassword`
  (:490-569) y el helper `run` (:452).
- Se mueve el JSX :779-1075 (título, pestañas, estado, formularios y reset).
- `changePassword` y `sendSetPasswordLink` se quedan en Account.

### [11] cd-3-M5 — Los `--cat-*` son por pelaje, no por tema (corrige E4)

**Edit:**

- Los bloques `.cat.cat--coat-*` (game.css:619-699) se mueven tal cual a
  `tokens.css`, en una sección «Pelajes».
- No se mezclan con los `--cat-fur` de tema (tokens.css:188-191 y sus
  equivalentes en los otros temas).

### [12] cd-3-M6 — `data-cta-plus` todavía no existe

**Edit:**

- Se crea en index.html:561, con `href=".../?carne=1"`.
- En `change`, `setCoat` escribe `?gato=X&carne=1` en ese enlace y
  `?gato=X` en los demás.

### [13] cd-3-M7 — Un 402 al descargar no se puede detectar

**Edit:**

- `downloadBook` (books.ts:91-106) devuelve `{file}` o `{status}`.
- `openRemoteBook` (App.tsx:1395-1398) manda el 402 a la hoja de adjuntar.
- Con prueba.

### [14] cd-3-M9 — El borrado de cuenta puede quedar bloqueado para siempre

**Edit:**

- Si Stripe responde 404 / `resource_missing` o la suscripción ya está
  `canceled`, cuenta como éxito.
- Se omite la llamada si `plan === 'free'` y `plan_expires_at` ya pasó.
- Con prueba.

### [15] cd-3-M10 — La forma del payload del webhook no está fijada

**Edit:**

- El endpoint del webhook se crea con `api_version=2025-03-31.basil`, y las
  pruebas usan `stripe listen --latest`.
- Mapa de estados:

| Estado | Efecto |
| --- | --- |
| `incomplete` | Sin escritura |
| `incomplete_expired`, `paused` | `plan_expires_at = ended_at ?? now` |

- `deleted` es un evento, no un estado.

### [16] cd-3-M11 — Carrera entre la vuelta de Checkout y el webhook

**Edit:**

- Con `carne=1`, App consulta `/api/account/state` cada 2 s durante 20 s,
  hasta ver `lecta_plus`.
- Con prueba.

### [17] cd-3-M13 — Lista de sitios con `env.DB` incompleta

**Edit:**

- El criterio de `grep` es la referencia.
- La lista se completa: db.ts:180-190; app.ts:1742, 1850-1890, 1926, 1949,
  2326, 2579, 2621, 2648, 2681, 2717, 2776, 2956, 3451, 3499, 3586;
  routes.ts:749, 800, 836, 938-994.
- Las llamadas pierden el argumento `c.env?.DB`.

## Nits

- **[18] ir-3-N1 (churn).** `PlanNote` y `WordPanel` ya están en chunks lazy.
  En el chunk inicial sí entran el selector de pelaje (Shelf), la hoja de
  adjuntar (App), `account-plan.ts` y `epub-intake.ts`: se estiman < 3 kB.
- **[19] ir-3-N3 + cd-3-N3.**
  - `saveBook({hash, name: file.name, data: file, title, author, language,
    addedAt: Date.now()})`, seguido de `updateBookMeta` como en `selectBook`.
  - La hoja de adjuntar vive en `AttachBookSheet.tsx` (Create).
  - `epub-intake` corre las dos validaciones: la de 4096 bytes y la del buffer
    completo.
- **[20] ir-3-N4.** `registerBookMeta` entra en `runBookQueue` como operación
  `meta`: un 402 o un 4xx la descarta; un 5xx u offline la reintenta.
- **[21] cd-3-N1.** Orden del checkout: `degraded` → 503 → 409.
- **[22] cd-3-N4.** :967 y :1227 son líneas de `Shelf.tsx`.
- **[23] cd-3-N5.** Las funciones están en app.ts:2606 y :3412; :2611 y :3435
  son líneas del SQL.
- **[24] cd-3-N6.** Journey 1 empieza en smoke-journeys:9; Journey 2 cubre
  :172-175.
- **[25] cd-3-N7.** `ShelfItem` está en Shelf.tsx:74-85.
