# scripts — herramientas de operación, datos y verificación

## Overview

Scripts Node (`.mjs`/`.ts`/`.mts`), dos de Python y uno de shell que no
entran al bundle. Cubren la base de datos (esquema, migraciones), el
catálogo léxico y los diccionarios descargables, el catálogo público de
libros, pruebas de humo contra un server vivo, mediciones y calibración del
portal Kindle, el presupuesto de bundle, la desminificación de errores, la
subida del modelo de Kitten TTS y auditorías. Los que tienen alias en
`package.json` se listan con su comando `pnpm`.

Subdirectorio: [landing-art/README.md](./landing-art/README.md) — render de
las imágenes de la landing con el gato real de la app.

## Interface

### Base de datos

| Script | Comando | Qué hace |
| --- | --- | --- |
| `db-setup.mjs` | `pnpm db:setup` | Aplica `db/schema.sql` y `db/seed.sql` a `DATABASE_URL` y cuenta `lexicon_entries/forms/senses`. |
| `auth-migrate.mjs` | `pnpm db:auth` | Tablas de Better Auth con `getMigrations` de la versión instalada (solo crea lo que falta). |
| `db-migrate.mjs` | `pnpm db:migrate` | Aplica `db/migrations/*.sql` en orden y registra en `lecta_schema_migrations`. Exporta [`db-migrate.mjs:migrate`], [`db-migrate.mjs:extractDdlTable`], [`db-migrate.mjs:assertTableUnlocked`]. Flags `--remote`/`--prod` (objetivo `lecta`, usa `DATABASE_URL_PROD` o reescribe `/lecta_dev` → `/lecta`) y `--local`/`--dev`. |
| `apply-phase4-d1.mjs` | — | Histórico: sincroniza la migración 010 con `db/schema.sql`. |
| `diagnose-words.mjs` | — | Diagnóstico de palabras de un usuario/libro en transacción `BEGIN READ ONLY` ([`diagnose-words.mjs:diagnose`], `DIAGNOSE_WORDS_SQL`). |

### Catálogo léxico y diccionarios

| Script | Qué hace |
| --- | --- |
| `lexicon-export.py` | Exporta `data/lexicon/{lang}-forms.tsv` y `{lang}-lemmas.tsv` (simplemma + wordfreq). |
| `lexicon-load.mjs` | Carga esos TSV a `DATABASE_URL` (idempotente, `ON CONFLICT DO NOTHING`). |
| `lexicon-wiktionary.mjs` | Carga acepciones del dump kaikki `data/lexicon/<lang>-wiktionary.jsonl.gz` (`--lang=es\|en`). |
| `lexicon-phrases.mjs` | Genera `public/lexicon/locuciones.es.json`. |
| `lexicon-export-senses.mjs` | Exporta acepciones `source='wiktionary'` a `public/lexicon/senses-es.csv.gz`. |
| `lexicon-pack.mjs` | Genera `public/dict/dict-<lang>-v${VERSION}.bin` (TSV+gzip) desde el catálogo; `VERSION = 5`. |
| `lexicon-enrich.mjs`, `repair-enrich.ts` | Enriquecen fichas sin acepciones con DeepSeek (misma validación que el worker). |
| `enrich-english-core.mjs` | Genera `src/shared/english-core-lexicon.generated.ts` con IA. |
| `enrich-english-ia.mjs`, `enrich-stubs-catalogo.mjs` | Enriquecimiento IA del catálogo inglés (dump y stubs de manifiestos). |
| `fix-lexicon-pos.mjs`, `merge-lexicon-ia-dupes.mjs` | Reparaciones puntuales de POS y duplicados del catálogo inglés. |
| `sync-lexicon-en-prod.mjs`, `sync-stubs-enrich-prod.mjs` | Copian el catálogo inglés de `lecta_dev` a `lecta` (`en_new` + `--swap`). |
| `ai-token-audit.mjs` | Auditoría de consumo DeepSeek; dry-run por defecto, `--live` ≤40 llamadas ([`ai-token-audit.mjs:runZeroFrictionTokenAudit`]). |

### Catálogo público de libros

| Script | Qué hace |
| --- | --- |
| `catalog-seed.mjs` | CLI: verifica RDF/EPUB de Gutenberg; `--seed` descarga EPUB + portada y genera manifiestos en `catalog-seed/` (gitignored). No sube a R2. |
| `catalog-debrand.mjs` | CLI: quita la marca Project Gutenberg de los EPUB curados (`catalog-seed/v2/<id>.epub`) con `debrandGutenbergEpub` y actualiza `epubBytes`/`epubSha256` en `index.json`. Sale 1 si queda la marca. No sube a R2. |
| `catalog-seed-lib.mjs` | Funciones puras: [`parseRdf`], [`rightsCheck`] (`deathYearMax = 1924`), [`buildVocabManifest`], [`buildResolvedManifest`], [`formsWithBases`], [`validateCurationItem`]. Datos en `catalog-curation.json`. |
| `generate-paper-guide.mts` | Guía de papel desde un EPUB local con `buildPaperBookGuide` (solo índice + formas). |

### Pruebas de humo y medición

| Script | Comando | Qué hace |
| --- | --- | --- |
| `smoke-auth.mjs` | `pnpm smoke:auth` | Dos cuentas temporales (plan free); verifica aislamiento de vocab y sync, 402 `LECTA_PLUS_REQUIRED` al subir/descargar libros y vincular Kindle, y 401 sin sesión. `SMOKE_URL` (default `http://127.0.0.1:5174`). Exporta [`waitForHealth`], [`verifyKindleLinkSmokeTest`], [`runSmokeTests`]. |
| `smoke-sync.mjs` | `pnpm smoke:sync` | Contrato de sync incremental (`syncedAt`, cursor). Cuenta canónica `SMOKE_SYNC_EMAIL`. |
| `measure-open-latency.mjs` | `pnpm measure:open` | Apertura de libro con `/api/positions` frenado. |
| `bench-kindle.mjs` | `pnpm bench:kindle` | CPU del pipeline Kindle; `--save` → `artifacts/kindle-bench/baseline.txt`. |
| `calibrate-kindle.ts` | `pnpm calibrate:kindle` | Arnés Playwright de paginación Kindle (`--epub`, `--sections`, `--sizes`, `--vp`). |
| `visual-audit.mjs`, `visual-cat.mjs`, `visual-probe.mjs` | — | Capturas Playwright contra el dev server (`http://[::1]:5173/`). |

### Puerta de calidad, errores y modelo

| Script | Comando | Qué hace |
| --- | --- | --- |
| `test-trace.mjs` | parte de `pnpm gate` | Corre `npx vitest run`; si falla deja el log en `artifacts/test-failures/` y resume archivo y prueba. |
| `check-bundle-budget.mjs` | `pnpm check:size` | Suma gzip de scripts y `modulepreload` de `dist/client/index.html`: `MAX_JS_GZIP_KB = 215`, `MAX_CSS_GZIP_KB = 55`, aviso en `WARN_THRESHOLD_RATIO = 0.90`; falla si `lexicon-banks` aparece en un `modulepreload`. |
| `symbolicate.mjs` | `pnpm symbols` | Resuelve frames con `artifacts/sourcemaps/index.json` ([`parseArgs`], [`loadIndex`], [`resolveFrame`], [`splitFrames`]); `--db [--days N] [--json]` lee `lecta_error_signatures`. |
| `upload-model.mjs` | `pnpm model:upload` | Descarga Kitten TTS ([`DEFAULT_SOURCE_URL`]) y sube con `wrangler r2 object put` a `models/<archivo>` en `R2_BUCKET_NAME` (default `lecta-books`). [`resolveChecksumPolicy`], [`ensureModelDownloaded`], [`uploadToR2`]. |
| `check-model.mjs` | — | Verifica desde fuera `/models/…` (tamaño `DEFAULT_MODEL_BYTES = 24_369_971`, tolerancia 2 %) contra `src/client/lib/kittenModel.ts` ([`verifyModelEndpoint`], [`readClientModelConfig`]). |

### Fixtures, auditorías y herramientas de agente

| Script | Comando | Qué hace |
| --- | --- | --- |
| `make-fixture.mjs` | — | Genera `fixtures/minimal.epub` con cargas XSS que escriben `window.__xss`. |
| `make-scroll-fixture.mjs` | — | Genera `fixtures/scroll.epub` (párrafos `P07 · …`) para `e2e/reader-position.spec.ts`. |
| `audit-investigacion.mjs` | `pnpm audit:investigacion[:online]` | Audita `docs/estrategia-aprendizaje-2026-10-24.md` contra `docs/auditoria/claims.json`; escribe `docs/auditoria/reporte.*` ([`runAudit`], [`checkReachable`], [`main`]). |
| `audit-cuaderno.mjs` | `pnpm audit:cuaderno[:online\|:brief]` | Audita el Cuaderno; escribe `docs/auditoria/cuaderno/evidencia.*` ([`CLAIMS`], [`runClaim`], [`notebookFiles`]). |
| `pack-gemini.mjs` | `pnpm gemini[:clip]` | Empaqueta el repo (ZIP) y un dossier para Gemini. |
| `generar-auditoria-argon.mjs`, `generar-auditoria-acompanante.mjs`, `audit-kindle-argon.mjs`, `audit_kindle_argon.py` | — | Dossiers y auditorías externas con Gemini. |
| `find-free-vars.mjs` | — | Variables libres de un rango de líneas de un `.ts/.tsx`. |
| `egm-review.sh` | — | Revisión EGM de documentos con informe en `docs/egm/reviews/`. |
| `apply-audit-fixes.mjs`, `setup-antigravity.mjs` | — | Históricos: **reescriben archivos del árbol** (`patchFile`, `write`). |

## Invariants

- `db-migrate.mjs` exige que `current_database()` coincida con
  `LECTA_MIGRATE_TARGET` (default `lecta_dev`) antes de escribir; producción
  solo con autorización expresa.
- `db-migrate.mjs` falla rápido si una tabla destino tiene
  `schema_locked=true` ([`assertTableUnlocked`]); `CREATE TABLE` no cuenta.
  `statement_timeout` = `LECTA_MIGRATE_TIMEOUT_MS` (default `120_000`).
- `symbolicate.mjs` y `diagnose-words.mjs` solo leen; `check-model.mjs` no
  necesita credenciales ni modifica nada.
- `upload-model.mjs --verify` exige `MODEL_SHA256` válido (64 hex) y aborta
  si falta o no coincide; sin `--verify` avisa y sube.
- `catalog-seed.mjs` no sube a R2; `rightsCheck` aplica dominio público por
  año de muerte ≤ 1924.
- `lexicon-pack.mjs` usa extensión `.bin` a propósito (con `.gz`, vite sirve
  `Content-Encoding: gzip` y rompe el SHA-256 del cliente). Regenerar exige
  subir la versión y pegar el hash en `DICTIONARY_PACKS`.
- El catálogo léxico vive en `lecta_dev`: las escrituras del catálogo desde
  estos scripts afectan a lo que sirve producción.
- AGENTS.md dice que `check:size` avisa al 95 %; el código usa
  `WARN_THRESHOLD_RATIO = 0.90`.

## Side Effects

- Base de datos (`DATABASE_URL`): `db-setup`, `auth-migrate`, `db-migrate`,
  `lexicon-load`, `lexicon-wiktionary`, `lexicon-enrich`, `repair-enrich`,
  `enrich-*`, `fix-lexicon-pos`, `merge-lexicon-ia-dupes`, `sync-*-prod`
  (escriben en `lecta`).
- Red y servidor vivo: `smoke-auth` (dos cuentas, EPUB en R2, vocab) y
  `smoke-sync` escriben en el server apuntado; Gutenberg
  (`catalog-seed`), DeepSeek (`*enrich*`, `ai-token-audit --live`), Gemini
  (`*argon*`), Hugging Face y R2 (`upload-model`).
- Archivos: `public/dict/`, `public/lexicon/`, `fixtures/*.epub`,
  `catalog-seed/`, `docs/auditoria/`, `artifacts/` (test-failures,
  kindle-bench, visual-audit), `src/shared/english-core-lexicon.generated.ts`.
- Procesos: `test-trace` lanza `vitest`; `calibrate-kindle`, `visual-*` y
  `measure-open-latency` lanzan Chromium.

## Verification

- Run: `pnpm test` (incluye `scripts/*.test.mjs`: `db-migrate`,
  `catalog-seed`, `check-model`, `diagnose-words`, `pack-gemini`,
  `symbolicate`, `test-trace`, `upload-model`, `audit-*`).
- Run: `pnpm gate` para `test-trace.mjs` y `check-bundle-budget.mjs`.
