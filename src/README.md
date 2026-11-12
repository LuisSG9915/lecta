# src

## Overview

Código de producción de Lecta. Un solo despliegue de Cloudflare Workers sirve
la SPA (`client/`, React 19 + Vite) como assets estáticos y la API, el portal
Kindle y el cron desde `worker/`. `shared/` es TypeScript puro que importan
los dos lados. `dev/` es una mesa de trabajo local que no entra al build.

## Subdirectories & Boundaries

- client: [./client/README.md](./client/README.md) - PWA local-first: vistas,
  hooks, librerías (IndexedDB por cuenta, lector EPUB, ficha de palabra,
  Cuaderno FSRS, TTS, sync contra `/api/*`) y workers de inferencia TTS.
- worker: [./worker/README.md](./worker/README.md) - Worker Hono: Better Auth,
  API JSON de sync, IA (DeepSeek), R2 `BOOKS`, cron `0 5 * * *`,
  `EnrichmentWorkflow` y el portal e-ink `/k`. Base Postgres/CockroachDB vía
  Hyperdrive.
- shared: [./shared/README.md](./shared/README.md) - Contratos y lógica pura
  sin red ni almacenamiento: limpiadores de sync, modelo del gato, prefs
  Kindle, banco de calibración, `APP_VERSION`.
- dev: [./dev/README.md](./dev/README.md) - Taller «Sastrería» del arte del
  gato, solo en `pnpm dev`.
