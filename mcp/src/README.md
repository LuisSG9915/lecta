# mcp/src — servidor MCP de Lecta (fuente)

## Overview

Código del servidor MCP local (stdio) que expone la API HTTP de Lecta a
agentes de IA. Cuatro módulos: configuración por entorno (`config.ts`),
cliente HTTP con tarro de cookies en memoria (`api.ts`), registro de las 11
herramientas de solo lectura (`tools.ts`) y punto de entrada que conecta el
transporte stdio (`index.ts`). Guía de uso y configuración de clientes en
[../README.md](../README.md).

## Interface

- [`index.ts:main`] crea `McpServer({ name: "lecta", version: "0.2.0" })`,
  llama `registerTools` y conecta `StdioServerTransport`. Error fatal →
  `process.exit(1)`.
- [`config.ts:loadConfig(env)`] → `LectaConfig { baseUrl, cookie?, email?,
  password?, timeoutMs }`. Lee `LECTA_BASE_URL` (default
  [`config.ts:DEFAULT_BASE_URL`] `https://lecta.luis-sg9915.workers.dev`),
  `LECTA_COOKIE`, `LECTA_EMAIL`, `LECTA_PASSWORD`, `LECTA_TIMEOUT_MS`.
- [`api.ts:LectaApi`]: `request`, `getJson`, `postJson`, `getSession`
  (`/api/auth/get-session`), getters `baseUrl`, `hasCredentials`,
  `canSignIn`. Opciones por petición: `anonymous`, `allowStatus`.
- [`api.ts:LectaApiError`] (`status`, `payload`) y
  [`api.ts:LectaAuthError`] (subclase, 401 por defecto).
- [`api.ts:parseCookieHeader(raw, sessionCookieName)`]: acepta `Cookie:`
  completo, pares `a=b; c=d` o un token pelado (se guarda bajo el nombre de
  cookie de sesión).
- [`tools.ts:registerTools(server, api, config)`] registra: `lookup`,
  `lookup_many`, `catalog`, `catalog_vocab`, `whoami`, `my_books`,
  `my_words`, `reading_stats`, `search_annotations`, `my_knowledge`,
  `health`.
- Endpoints que consume `tools.ts`: `GET /api/lexicon/lookup`,
  `POST /api/lexicon/batch`, `GET /api/catalog`,
  `GET /api/catalog/{id}/vocab`, `GET /api/books`, `GET /api/vocab?lang=`,
  `GET /api/activity?since=`, `GET /api/reviews?since=`,
  `GET /api/positions`, `GET /api/annotations`, `GET /api/knowledge`,
  `GET /api/health`.

## Invariants

- **Solo lectura.** Ninguna herramienta escribe; el único `POST` de datos es
  `/api/lexicon/batch` (consulta) y el inicio de sesión
  `/api/auth/sign-in/email`. Herramientas de escritura futuras deben pasar
  por la API y respetar el sello `updatedAt` (ver AGENTS.md §MCP).
- stdout es del protocolo JSON-RPC: todo aviso va a `console.error`
  ([`index.ts:main`]).
- Credenciales solo por entorno, nunca por argumentos
  ([`config.ts:loadConfig`]); `LECTA_BASE_URL` debe ser `http:`/`https:` o
  lanza error; `LECTA_TIMEOUT_MS` < 1000 o no numérico cae a `20_000`.
- Con `LECTA_COOKIE` sobre `https:` el token pelado se guarda como
  `__Secure-better-auth.session_token`; sobre `http:`, como
  `better-auth.session_token` ([`api.ts:LectaApi` constructor]).
- Un 401 en petición autenticada reintenta **una** vez con login forzado si
  hay correo+contraseña; sin ellos lanza `LectaAuthError`
  ([`api.ts:LectaApi.request`]). Los logins concurrentes se deduplican con
  `loginPromise` ([`api.ts:LectaApi.ensureAuth`]).
- `Set-Cookie` vacía o con `max-age=0` borra la cookie del tarro
  ([`api.ts:ingestSetCookies`]).
- Límites de entrada (zod): `lookup` texto ≤100; `lookup_many` ≤200 formas
  de ≤100 caracteres; `limitOf` acota a `[1, max]` ([`tools.ts:limitOf`]).
- Caché de manifiestos de `catalog_vocab`: TTL
  [`tools.ts:VOCAB_CACHE_TTL_MS`] = 10 min, máximo
  [`tools.ts:VOCAB_CACHE_MAX`] = 3 libros.
- `reading_stats` marca `partial: true` si `activity.hasMore` o
  `reviews.hasMore`.
- Versiones: `user-agent` `lecta-mcp/0.2.15` en `api.ts`; el `serverInfo` de
  `index.ts` declara `0.2.0` (no se sube junto con `APP_VERSION`).

## Side Effects

- Red: `fetch` a `config.baseUrl` con `AbortSignal.timeout(timeoutMs)`
  ([`api.ts:LectaApi.send`]). Timeout/abort → `LectaApiError` con `status 0`.
- Memoria del proceso: tarro de cookies ([`api.ts:LectaApi.jar`]) y
  `vocabCache` ([`tools.ts:vocabCache`]); nada se escribe en disco.
- stdio: lee/escribe JSON-RPC por stdin/stdout; mensajes de estado por
  stderr.

## Verification

- Run: `pnpm mcp:typecheck`
- Run: `pnpm test` (incluye `mcp/src/*.test.ts`)
