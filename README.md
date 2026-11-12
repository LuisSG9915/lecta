# Lecta Blueprint

## System Overview

Lecta es un lector de EPUB con aprendizaje de vocabulario integrado: la
persona lee, toca una palabra, ve su significado, la guarda en el Cuaderno con
la frase del libro y la repasa con FSRS. Es una PWA local-first (IndexedDB por
cuenta) que se sincroniza con un único Cloudflare Worker.

```
navegador (src/client, React 19 + Vite, IndexedDB, service worker public/sw.js)
   │  fetch /api/*  (cookie Better Auth)
   ▼
Cloudflare Worker (src/worker, Hono)  ── /k portal e-ink (src/worker/kindle)
   │ Hyperdrive (pg por request)      │ R2 BOOKS (lecta-books)   │ DeepSeek / Resend
   ▼                                   ▼
CockroachDB: lecta (prod) / lecta_dev (dev + catálogo léxico compartido)
```

### Fuentes de verdad (Elefante)

Estos documentos fijan la intención del producto. Cuando contradicen al
código, gana el código y la diferencia se registra como drift.

- [PRODUCT.md](./PRODUCT.md): usuarios, posicionamiento, planes Gratis y
  Lecta+, reglas de producto inquebrantables y dirección visual de la app.
- [docs/sistema-lecta.md](./docs/sistema-lecta.md): arquitectura, modelo de
  datos, flujos y reglas que no se negocian.
- [marketing/landing/index.html](./marketing/landing/index.html): mundo
  visual aprobado («El sendero del gato») y promesa pública al usuario.
- [DESIGN.md](./DESIGN.md): sistema visual «Cuaderno de lector»; tokens en
  `src/client/styles/tokens.css`.
- Divergencias medidas: [2026-11-12_DRIFT_REPORT.md](./2026-11-12_DRIFT_REPORT.md).

## Subdirectories & System Boundaries

- src: [./src/README.md](./src/README.md) - Cliente, Worker, código
  compartido y taller de desarrollo.
- db: [./db/README.md](./db/README.md) - `schema.sql`, `seed.sql` y 26
  migraciones idempotentes de CockroachDB (`db/migrations/`).
- scripts: [./scripts/README.md](./scripts/README.md) - Migraciones,
  paquetes de diccionario, catálogo, smoke, presupuesto de bundle, modelos
  TTS, auditorías y arte del landing.
- mcp: [./mcp/README.md](./mcp/README.md) - Servidor MCP local (stdio, solo
  lectura) sobre la API HTTP.
- e2e: [./e2e/README.md](./e2e/README.md) - Playwright contra `vite preview`;
  guardias `@smoke` y de posición del lector.
- marketing: [./marketing/README.md](./marketing/README.md) - Landing
  estática publicada en `/inicio/`.
- public: [./public/README.md](./public/README.md) - Assets estáticos y el
  service worker `sw.js`.

## Global Invariants

Restricciones duras. Cada una cita dónde la impone el código.

- **Presupuesto de bundle: 215 kB gzip de JS inicial.**
  `scripts/check-bundle-budget.mjs:MAX_JS_GZIP_KB = 215` (CSS
  `MAX_CSS_GZIP_KB = 55`, aviso a `WARN_THRESHOLD_RATIO = 0.90`). Lo corre
  `pnpm check:size`, último paso de `pnpm gate`. Nada pesado entra al bundle
  principal: modelos `.onnx` y paquetes de diccionario se descargan aparte
  (`/models/*`, `/dict/*`).
- **Cero modales bloqueantes en lectura.** Tocar un libro abre el lector de
  inmediato: `App.tsx:openBook` hace `setBook(...)` sin pasar por
  `Calibration`, `BookStart` ni `SectionPreview` a pantalla completa. Ninguna
  función psicométrica muestra jerga ni bloquea la lectura. En el lector hay
  un solo dock inferior (`SmartReaderDock`), que alterna entre lectura y
  audio. Los avisos de pago van como notas al margen y no como modales
  (PRODUCT.md).
- **Temas `papel` y `noche` como referencia.** `ThemeChoice = "auto" |
  "blanco" | "papel" | "noche" | "oled"` (`src/client/lib/settings.ts:3`).
  `src/client/styles/tokens.css` define `[data-theme="papel"]`, `"blanco"`,
  `"noche"` y `"oled"`. Ningún componente escribe colores fijos, y cada
  cambio de estilo se revisa en `papel` y `noche`.
- **Stack: React 19 + Cloudflare Workers + Hyperdrive/CockroachDB + R2.**
  - Cliente: `react` 19.3.0 (`package.json`).
  - Worker: Hono (`src/worker/index.ts`).
  - Base: Postgres/CockroachDB por Hyperdrive, con una conexión `pg` por
    petición y ningún pool global (`src/worker/db.ts:getConnectionString`,
    `withClient`). Binding `HYPERDRIVE` sin caché para auth y sync de
    usuario; `HYPERDRIVE_CACHED` solo para lecturas del catálogo.
  - Archivos: R2, binding `BOOKS` (`lecta-books`).
  - **D1 no es la base de datos.** PRODUCT.md menciona D1, pero
    `wrangler.jsonc` no declara `d1_databases`. `DB?: D1Database`
    (`src/worker/db.ts:23`) es un tipo sin binding, y las ramas
    `env.DB.prepare` de `app.ts` y `kindle/routes.ts` nunca corren en
    producción.
- **El catálogo léxico vive solo en `lecta_dev`** y se consulta como
  `lecta_dev.lexicon_*` (`src/worker/lexicon.ts:CATALOG`).
- **Datos de usuario por merge y nunca reescritos.** Se sincronizan por
  `updatedAt` con lápidas, y el cursor avanza al sello confirmado
  (`src/client/lib/sync-cursors.ts`). IndexedDB va separado por cuenta y
  protegido con `DbScope` (`src/client/lib/idb.ts`).
- **Identidad limpia.** Nunca se pintan hashes, ids ni nombres de archivo
  técnicos (`bookDisplayName`, `isHashLikeIdentifier` / `humanizeFilename`
  en `src/shared/epub-meta.ts`). Hueco conocido: el título de la barra
  superior del lector cae a `fileName` (`Reader.tsx:4106`) sin pasar por
  `bookDisplayName`.
- **Migraciones nuevas solo a `lecta_dev`.** `scripts/db-migrate.mjs` exige
  que `current_database()` sea igual a `LECTA_MIGRATE_TARGET`. Producción
  requiere autorización expresa.

## Global Side Effects

- CockroachDB (`lecta` / `lecta_dev`): tablas `lecta_user_*`, `user_books`,
  `kindle_link_codes`, `lecta_kindle_prefs`, `lecta_ai_quota`,
  `lecta_error_signatures`, `lecta_account_state`, tablas de Better Auth y
  `lecta_dev.lexicon_*`.
- R2 `lecta-books`: `books/<userId>/`, `user-books/<userId>/`, `catalog/`,
  `models/` y `kcache/`.
- HTTP saliente: DeepSeek (directo o por AI Gateway) y Resend.
- En el navegador: IndexedDB `lecta` / `lecta:u:<id>` / `lecta-dict-<lang>`,
  Cache Storage del service worker y de los modelos TTS, y `localStorage`.

## System Verification

- Run: `pnpm gate` (typecheck + lint con 0 warnings + `vitest` + build +
  `check:size`).
- E2E: `pnpm test:e2e` y `pnpm test:e2e:smoke`.
