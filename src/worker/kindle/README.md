# Kindle portal (`src/worker/kindle`)

## Overview

Server-rendered portal for e-ink readers, mounted by the main worker at `/k`
(`app.route("/k", kindleRoutes)` in [`../app.ts`](../app.ts)). Pages are inline
HTML+CSS with minimal ES5 JavaScript and progressive enhancement: every flow
works with plain links and forms. The module reads EPUBs from R2, parses and
sanitizes chapters, paginates them for the device viewport, and caches the
derived artifacts back in R2.

| File | Role |
| --- | --- |
| `routes.ts` | Hono router `kindleRoutes`, account linking by 4-letter code, prefs API handlers, EPUB loading |
| `views.ts` | HTML renderers and the inline stylesheet `KINDLE_CSS` |
| `epub-reader.ts` | ZIP/EPUB parsing, sanitizing, TOC, pagination, word wrapping, Rasch priming helpers |
| `cache.ts` | R2 + isolate-memory cache of parsed chapters and extracted resources |
| `timing.ts` | Per-stage `Server-Timing` builder |

## Interface

### Routes (`[routes.ts:kindleRoutes]`, paths relative to the `/k` mount)

| Method | Path | Handler |
| --- | --- | --- |
| GET | `/kindle`, `/link` | `[routes.ts:handleKindleLinkPage]` |
| GET | `/verify`, `/api/kindle/status` | `[routes.ts:handleKindleStatus]` |
| POST | `/api/kindle/link` | `[routes.ts:handleKindleLinkAction]` |
| POST | `/priming/action`, `/kindle/priming/action` | `[routes.ts:handleKindlePrimingAction]` |
| GET, POST | `/ajustes` | `kindleSettingsGet` / `kindleSettingsPost` (module-private) |
| GET | `/preview`, `/preview/page` | inline handlers (frame + real reader page with overrides) |
| GET | `/` | shelf / "Seguir leyendo" (redirects to `/kindle` without session) |
| GET, POST | `/login`; GET `/logout` | inline handlers |
| GET | `/read/:hash` | reader (`?section`, `?page`, `?mode`, `?size`, `?margin`, `?layout`, `?toc=1`, `?prep=1`) |
| GET | `/read/:hash/resource` | EPUB asset passthrough, restricted to `[routes.ts:SAFE_EPUB_ASSET_MIMES]` |
| GET | `/lookup` | inline word lookup |
| POST | `/vocab/add`, `/highlight/add`, `/knowledge/mark` | write actions |
| GET | `/practice`; POST `/practice/answer` | FSRS practice (`ts-fsrs`) |

The main app also wires these exports at top level ([`../app.ts`](../app.ts)):
`GET /kindle`, `GET /kindle/verify`, `GET /api/kindle/status`,
`GET /api/kindle/prefs` (`[routes.ts:handleKindlePrefsApiGet]`),
`PUT /api/kindle/prefs` (`[routes.ts:handleKindlePrefsApiPut]`),
`POST /api/kindle/link`, `POST /kindle/priming/action`.

### Exported symbols

- `routes.ts`: `kindleRoutes`, `KindleCodeRecord`, `memoryCodeStore`,
  `safeKindleReturn`, `correctKeyFor`, `KINDLE_DUE_SQL`, `loadKindlePrefs`,
  `KINDLE_HTML_CSP`, `KINDLE_HTML_CSP_FRAMED`, `kindleHtmlCspFor`,
  `allowKindleStatus`, `normalizeMargin`, `generateFourCharKindleCode`,
  `createKindleLinkCode`, `linkKindleCodeFromMobile`, `consumeLinkedKindleCode`,
  `KINDLE_MAX_EPUB_BYTES` (40 MB), `loadEpubObjectForKindle`,
  `loadEpubBufferForKindle`, `parseKindleViewportCookie`.
- `epub-reader.ts`: `parseZipEntries`, `readZipEntryBytes`, `readZipEntryText`,
  `parseEpub`, `getEpubChapter`, `getEpubResource`, `sanitizeKindleHtml`,
  `parseNavTocLinks`, `parseNcxTocLinks`, `rewriteInternalLinks`,
  `paginateChapter`, `kindleViewportScale`, `kindleWidthScale`,
  `KINDLE_PAGE_BUDGETS`, `KINDLE_MARGIN_MULTIPLIERS`, `KINDLE_REFERENCE_VIEWPORT`,
  `BLOCK_BREAK_PENALTY`, `PARAGRAPH_MODE_BREAK_PENALTY`, `KINDLE_SCROLL_BUDGET`,
  `formatChapterHtmlForMode`, `wrapWordsWithLinks`, `extractPageWords`,
  `applyHighlights`, `computeRaschMastery`, `estimateThetaFromD1Knowledge`,
  `selectKindleChapterPrimingWords`, `extractChapterPrepCandidates`.
- `views.ts`: `KINDLE_CSS`, `escapeHtml`, `renderHomeView`, `renderLoginView`,
  `renderKindleLinkView`, `renderReaderView`, `renderLookupView`,
  `renderPracticeView`, `renderKindleChapterPrimingView`, `renderKindleTocView`,
  `renderKindleSettingsView`, `renderKindleCatSvg`.
- `cache.ts`: `KINDLE_CHAPTER_CACHE_V` (currently 2), `getCachedChapter`,
  `putCachedChapter`, `getCachedResource`, `putCachedResource`,
  `purgeKindleBookCache`, `resetKindleCacheMemory`.
- `timing.ts`: `createTimer`, `KindleTimer`.

## Invariants

- Prefs precedence in `/k/read`: explicit query parameter > account row
  (`lecta_kindle_prefs`) > device cookie > default (`[routes.ts]` comment at the
  `/read/:hash` handler). Prefs vocabulary comes only from
  [`../../shared/kindle-prefs.ts`](../../shared/README.md) (`normalizeKindlePrefs`).
- HTML responses carry `no-store`, `X-Content-Type-Options: nosniff` and the CSP
  from `[routes.ts:kindleHtmlCspFor]`: `frame-ancestors 'self'` for paths under
  `/k`, `'none'` elsewhere.
- Changing sanitize, pagination or the chapter artifact shape requires bumping
  `[cache.ts:KINDLE_CHAPTER_CACHE_V]`; old entries read as a miss and are rewritten.
- The isolate memory cache holds only parsed text artifacts (TTL 30 min, max 24
  chapters, `[cache.ts]` `CHAPTER_MEM_TTL_MS`/`CHAPTER_MEM_MAX`), never `pg`
  connections or request objects.
- ZIP entries are capped at 10 MB uncompressed (`MAX_UNCOMPRESSED_ENTRY_BYTES` in
  `[epub-reader.ts:readZipEntryBytes]`); EPUB objects above
  `[routes.ts:KINDLE_MAX_EPUB_BYTES]` are rejected.
- Link codes use `SAFE_CHARS` (no I/1/O/0) and expire after `CODE_TTL_SECONDS`
  (600 s). `/api/kindle/status` is limited to 20 requests/min per IP per isolate
  (`[routes.ts:allowKindleStatus]`).
- The `lecta_k_vp` viewport cookie is accepted only in strict `WxH` form within
  bounds (`[routes.ts:parseKindleViewportCookie]`).
- Database access goes through `withClient` from [`../db.ts`](../db.ts)
  (Postgres/CockroachDB via Hyperdrive). Several handlers also contain a fallback
  branch for `env.DB` (`D1Database` type, `.prepare()`); `wrangler.jsonc` declares
  no D1 binding, so that branch is not the production path. `memoryCodeStore` is
  the in-memory fallback when no database is configured (unit tests).

## Side Effects

- Postgres reads/writes on `kindle_link_codes`, `lecta_kindle_prefs`,
  `user_books`, `lecta_user_positions`, `lecta_user_activity` (one point event per
  page turn), `lecta_user_words`, `lecta_user_knowledge`, `lecta_user_reviews`,
  `lecta_user_highlights`, `lecta_user_companion_events`; lexicon lookups via
  `findEntries`/`findEntriesForForms` ([`../lexicon.ts`](../lexicon.ts)).
- R2 (`env.BOOKS_BUCKET ?? env.BOOKS`): reads `books/{userId}/…` EPUBs; writes
  best-effort cache keys `kcache/ch/{hash}/{section}.json` and
  `kcache/res/{hash}/{path}` (via `waitUntil`); `/k` shelf may write EPUB metadata
  back to the object.
- Creates Better Auth sessions on link/login (`createScopedAuth`, signed cookies
  via `setSignedCookie`).
- Sets device cookies (`lecta_k_vp`, `lecta_k_margin`, `lecta_k_layout`,
  `lecta_k_invert`, `lecta_k_priming_off`, `lecta_k_mute_*`, `lecta_eink_turns`).
- Emits `Server-Timing` headers (`db`, `r2`, `parse`, `render`, `total`).
- Module-level state per isolate: `memoryCodeStore`, `statusBuckets`, chapter
  memory map.

## Verification

- Run: `pnpm test` (Vitest; `routes.test.ts`, `views.test.ts`, `epub-reader.test.ts`, `cache.test.ts`, `timing.test.ts`)
- Coverage ratchet: `pnpm coverage:ratchet`
- CPU benchmark: `pnpm bench:kindle`; layout calibration: `pnpm calibrate:kindle`
