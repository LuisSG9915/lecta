# Cloudflare Worker (`src/worker`)

## Overview

Server side of Lecta: a single Cloudflare Worker (`main: ./src/worker/index.ts` in
`wrangler.jsonc`) built on Hono. It serves the JSON API (`/api/*`), Better Auth
(`/api/auth/*`), the TTS model passthrough (`/models/*`), the e-ink portal (`/k*`,
see [`./kindle/README.md`](./kindle/README.md)), a daily cron and one Cloudflare
Workflow. Static assets and the SPA are served by Workers Assets; the worker runs
first only for `/api/*`, `/k`, `/k/*`, `/kindle`, `/kindle/*`, `/models/*`
(`assets.run_worker_first`).

### Bindings (`wrangler.jsonc`, typed by `[db.ts:WorkerEnv]`)

| Binding | Kind | Notes |
| --- | --- | --- |
| `HYPERDRIVE` | Hyperdrive | Postgres/CockroachDB, cache off. Default for auth, sessions, user sync |
| `HYPERDRIVE_CACHED` | Hyperdrive | Cache on. Only `/api/lexicon/lookup` and `/api/lexicon/sample` pass `cached=true` (`[app.ts]`) |
| `BOOKS` | R2 (`lecta-books`) | User EPUBs, catalog, models, Kindle cache |
| `ENRICHMENT_WORKFLOW` | Workflow `lecta-enrichment` | class `[enrichment-workflow.ts:EnrichmentWorkflow]` |
| cron `0 5 * * *` | trigger | `[index.ts:handler.scheduled]` |

## Interface

### Entry and modules

- `[index.ts:handler]` — `fetch` delegates to `[app.ts:app]`; `scheduled` purges
  expired `"session"`/`"verification"` rows, `lecta_rate_log` older than 48 h,
  `lecta_ai_quota` older than 30 days, then `purgeErrorSignatures`,
  `collectErrorDigest`, `sendErrorDigest`. Re-exports `EnrichmentWorkflow`.
- `[db.ts]` — `WorkerEnv`, `getConnectionString(env, cached)`,
  `withClient(env, run, cached)`, `SYNC_CHUNK_ROWS` (120), `chunks`,
  `logPostgresError`, `isMissingTableError` (42P01), `isMissingColumnError`
  (42703), `readAccountResetAt`, `resetAccountDataDb`.
- `[auth.ts]` — `createScopedAuth` (Better Auth + Kysely over a per-call
  `pg.Pool({ max: 1 })`), `closePoolSafe`, `createAuth`, `purgeUserData`,
  `purgeR2Prefix`.
- `[session.ts]` — `getSession`, `getSessionUser`, `hasSessionCookie`,
  `SessionInfraError`, `isSessionInfraError`.
- `[reset-guard.ts]` — `RESET_ACK_HEADER` (`x-lecta-reset`), `RESET_STALE_ERROR`,
  `withResetGuard`, `lockResetMarker`, `staleResetAt`, `StaleResetError`,
  `resetBlockedResponse`.
- `[ai.ts]` — `callDeepSeek`, `requestEnrichment`, `createTtlCache`,
  `AI_CALL_TIMEOUT_MS` (8000), `AI_MAX_ATTEMPTS` (3), `AI_TASK_BUDGETS`, prompt
  builders/parsers (`build*Prompt`, `parse*`) and `*_PROMPT_VERSION` constants.
- `[lexicon.ts]` — `CATALOG = "lecta_dev."`, `findEntries`, `findEntriesForForms`,
  `sampleForCalibration`, `insertEnrichment`, `pendingEnrichmentJobs`,
  `groupEntries`.
- `[client-errors.ts]` — `parseClientErrorReport`, `sanitizeRoute`,
  `normalizeRouteForSignature`, `sanitizeFrame`, `allowClientError`, limits
  `CLIENT_ERROR_LIMIT_PER_MINUTE` (30) / `_PER_HOUR` (300).
- `[error-signatures.ts]` — `fingerprint`, `recordErrorSignature`,
  `listErrorSignatures`, `purgeErrorSignatures`, `collectErrorDigest`,
  `sendErrorDigest`, `ERROR_DIGEST_MIN_HITS` (5), `ERROR_SIGNATURE_KEEP_DAYS` (30).
- `[community-guides.ts]` — `publishedGuideHashes`, `invalidateCommunityGuides`.
- `[plan-store.ts]` — `getUserPlan` (sin fila → `free`; `lecta_plus` vencido
  más `PLAN_GRACE_MS` → `free`; 42P01 → `founder_lifetime` con `degraded`),
  `loadUserPlan(env, userId)` (única puerta de middlewares y rutas; `undefined`
  sin base), `setStarterCoat` (`written` / `exists` / `unavailable`),
  `upsertPlanFromStripe` (nunca rebaja a `founder_lifetime`). Tabla
  `lecta_user_plan` (migración 027).
- `[billing.ts]` — router `billing`: `POST /api/billing/checkout {period}`
  (400 → 503 → 409; solo `monthly`/`yearly`, nunca montos), `POST
  /api/billing/portal` (404 sin cliente) y `POST /api/billing/webhook`
  (firma HMAC con tolerancia de 300 s, idempotente por `lecta_stripe_events`,
  cuenta por `client_reference_id` / `metadata.user_id` /
  `stripe_customer_id`; sin cuenta → ROLLBACK + 500; 42P01 → 503).
  Exporta `verifyStripeSignature` y `expiresAtForSubscription`.
- `[stripe.ts]` — `stripeRequest` (fetch a `api.stripe.com/v1` con
  `Stripe-Version` fija), `cancelSubscriptionForDeletion` (404 /
  `resource_missing` / ya cancelada = éxito) y `cancelBillingForDeletion`,
  que `auth.ts` llama en `beforeDelete` antes de purgar.
- `[plan-middleware.ts]` — `requireLectaPlus` (401 / 503 / 402
  `{ code: "LECTA_PLUS_REQUIRED" }`, deja la sesión en `c.get("session")`) y
  `createRequireKindlePlan` (sin sesión deja pasar; rutas exentas
  `KINDLE_PLAN_EXEMPT_PATHS`; HTML 402). Se montan ruta por ruta en el
  Bloque 2 del diseño `docs/designs/2026-11-12-planes-y-landing.md`.
- `[screen.ts:screen]` — «Series y películas»: OMDb (búsqueda, detalle de
  serie, episodios como solo números, póster proxied con allowlist de hosts)
  y `POST /api/screen/guide`, que baja un .srt de SubDL **solo en memoria** y
  guarda en R2 el índice «solo palabras» (`screen-guides/v1/…`, nunca diálogo
  ni timestamps). Exige sesión en todo; `OMDB_API_KEY`/`SUBDL_API_KEY` en
  `WorkerEnv` ([db.ts]); sin la llave que necesita → 503.
- `[admin.ts]` — `admin` router, `ownerUser`, `assembleOverview`,
  `assembleUserDetail`.
- `[app.ts]` — `app`, `consumeRateUnits`, `checkUserBooksQuota`
  (`MAX_USER_BOOKS` 100, `MAX_USER_STORAGE_BYTES` 500 MB), `recordUserBook`,
  `setUserBookCover`, `deleteUserBookRecord`, `computeAiCacheKey`,
  `getCachedAiText`/`setCachedAiText`, `clearExplainPassageCache`.
- Subdirectory: [`./kindle/README.md`](./kindle/README.md) — e-ink portal
  `kindleRoutes`, EPUB parsing/pagination, R2 chapter cache.

### Routes

| Router | Paths |
| --- | --- |
| `[app.ts:app]` | `GET /api/health`; `POST /api/client-errors`; `GET /api/error-reports`; `GET,HEAD /models/:filename`; `GET,POST /api/auth/*`; `GET /api/lexicon/lookup`, `GET /api/lexicon/sample`, `POST /api/lexicon/{batch,enrich,enrich-batch,report,items,items/answer,verify-sentence,explain}`; `POST /api/ai/{enrich,evaluate-sentence,micro-story,explain-in-passage,companion-note,page-recap,translate,character-recap}`; `GET /api/books`, `PUT,POST /api/books/:hash`, `POST /api/books`, `GET /api/books/community`, `GET,DELETE /api/books/:hash`, `GET /api/books/:hash/guide`, `PUT,GET /api/books/:hash/cover`, `PUT,DELETE /api/books/:hash/share`, `GET /api/books/community/:hash/cover`, `POST /api/books/community/:hash/attach`, `POST /api/books/:hash/repair`; `GET,PUT /api/vocab`; `GET /api/sync/counts`; `PUT,GET /api/user/books/:bookId/file`, `GET /api/user/books`; `GET /api/account/state` (con `plan`, `starterCoat`, `planExpiresAt`; omite `plan` ante un error que no sea 42P01), `PUT /api/account/starter-coat` (escritura única; 400 pelaje inválido, 503 sin tabla), `POST /api/account/reset`; Kindle top-level wiring (`/kindle`, `/kindle/verify`, `/api/kindle/{status,prefs,link}`, `/kindle/priming/action`, `/kindle/*` rewritten to `/k/*`); `app.route("/k", kindleRoutes)` |
| `[reading-data.ts:readingData]` | `GET,PUT /api/{annotations,activity,reviews,positions,knowledge}`; `PUT /api/daily-summaries` |
| `[companion.ts:companion]` | `GET,PUT /api/companion` |
| `[billing.ts:billing]` | `POST /api/billing/checkout`, `POST /api/billing/portal`, `POST /api/billing/webhook` |
| `[app.ts:app]` (027) | `PUT /api/user/books/:bookId/meta` (gratis: fila solo de metadatos, `r2_key = ''`, `has_file = false`; 400 si `sha256 ≠ bookId`, 413 por tope de libros, 503 ante 42703). `GET /api/books` suma esas filas con `hasFile: false`; `GET /api/user/books` las excluye. |
| `[catalog.ts:catalog]` | `GET /api/catalog`, `GET /api/catalog/search`, `GET /api/catalog/:id/:kind` (`epub`/`vocab`/`cover`) |
| `[screen.ts:screen]` | `GET /api/screen/search`, `GET /api/screen/tv/:imdbId`, `GET /api/screen/tv/:imdbId/season/:n`, `GET /api/screen/poster`, `POST /api/screen/guide` — todas con sesión |
| `[admin.ts:admin]` | `GET /api/admin/access`, `GET /api/admin/insights`, `GET /api/admin/users/:id` |

## Invariants

- No global `pg` pool: `withClient` opens a `pg.Client` per call and `end()`s it in
  `finally`; `createScopedAuth` builds a `max: 1` pool per request that callers
  close with `closePoolSafe`.
- `HYPERDRIVE_CACHED` (`cached=true`) is only for stale-tolerant shared catalog
  reads; never auth, sessions, permissions or user sync (`[db.ts:WorkerEnv]` doc).
- Without a Hyperdrive binding `getConnectionString` falls back to `DATABASE_URL`;
  with neither, `withClient` returns `undefined` and auth routes answer 503.
- The lexicon catalog is read by qualified name `CATALOG = "lecta_dev."`
  (`[lexicon.ts:CATALOG]`); it is not duplicated in the `lecta` database.
- Sync writes run through `[reset-guard.ts:withResetGuard]`: the transaction locks
  the `lecta_account_state` row `FOR UPDATE` and rejects writes whose
  `x-lecta-reset` ack predates the latest reset. Missing table (42P01) degrades to
  unguarded writes via a savepoint.
- `/api/ai/*` bodies are capped at 64 KB (`bodyLimit`). `onError` never returns
  the raw error; `SessionInfraError` / `DB_UNAVAILABLE` map to 503.
- HTML responses get `no-store`, `nosniff` and `[kindle/routes.ts:kindleHtmlCspFor]` CSP.
- `/api/error-reports` and `/api/admin/*` answer 404 unless the session email
  equals `LECTA_OWNER_EMAIL` and is verified (`[admin.ts:ownerUser]`).
- `POST /api/client-errors` always answers 204; signature persistence runs in
  `waitUntil` and swallows its errors.
- `/models/:filename` rejects `..` and `/`; serves `models/{filename}` with
  `Cache-Control: public, max-age=31536000, immutable`.
- Catalog ids must match `^[a-z0-9-]{1,64}$` (`[catalog.ts]` `CATALOG_ID`).
- `/api/books/community` is registered before `/api/books/:hash` (order matters).

## Side Effects

- Postgres tables written/read: `user_books`, `kindle_link_codes`,
  `lecta_user_words`, `lecta_user_reviews`, `lecta_user_knowledge`,
  `lecta_user_annotations`, `lecta_user_positions`, `lecta_user_activity`,
  `lecta_daily_summaries`, `lecta_user_companion_{baselines,events,fields,receipts}`,
  `lecta_account_state`, `lecta_ai_quota` (atomic UPSERT in
  `[app.ts:consumeRateUnits]`), `lecta_rate_log`, `lecta_error_signatures`,
  Better Auth `"session"`/`"verification"`, and `lecta_dev.lexicon_*` (catalog,
  written by enrichment via `insertEnrichment`).
- `[db.ts:resetAccountDataDb]` deletes all user progress tables, `user_books`
  and `kindle_link_codes` in one transaction and stamps `lecta_account_state`.
- R2 `BOOKS`: `books/{userId}/`, `user-books/{userId}/`, `catalog/`,
  `screen-guides/v1/`, `models/`, `kcache/`; `purgeUserData` deletes both
  user prefixes on account deletion.
- Outbound HTTP: DeepSeek (directly or via `AI_GATEWAY_URL`), Resend
  (magic link, password reset, delete verification, error digest), OMDb
  (`omdbapi.com`), SubDL (`api.subdl.com` + `dl.subdl.com`, zip ≤ 2 MB) and
  Gutenberg (`gutenberg.org`, EPUB `pg-` ≤ 25 MB).
- Starts `ENRICHMENT_WORKFLOW` instances (`POST /api/lexicon/enrich-batch`).
- Per-isolate memory: AI text LRU (300), catalog index TTL cache (5 min),
  OMDb detail/season/search caches (1 h / 1 h / 10 min), SubDL guide-miss
  negatives (30 min), community guides cache, client-error and Kindle
  status rate limiters.
- `console.error` structured logs (Workers Logs enabled).

## Verification

- Run: `pnpm test` (Vitest, `node` environment for `src/worker/**`)
- Coverage ratchet: `pnpm coverage:ratchet` (worker lines/functions >= 70%)
