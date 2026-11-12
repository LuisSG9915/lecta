# marketing

## Overview

Material de marketing fuera de la app. Hoy solo contiene la landing
estática que se publica en `/inicio/`.

## Subdirectories & Boundaries

- landing: [./landing/README.md](./landing/README.md) — página estática
  (`index.html` + `landing.js`) copiada a `dist/client/inicio/` por
  `landingPage()` de `vite.config.ts`; fuera del bundle, del precaché del
  service worker y de `check:size`.
