# public — assets estáticos y service worker

## Overview

Archivos que Vite copia tal cual a `dist/client/` y que Cloudflare sirve
como assets estáticos. El único código es `sw.js`, el service worker de la
PWA: precachea el shell y los assets del deploy vigente, sirve la app sin
conexión y rota cachés por versión. El resto son datos y recursos:
`_headers` (cabeceras y CSP de Cloudflare), `manifest.webmanifest`,
`icons/`, `fonts/` (tipografías auto-hospedadas del portal Kindle),
`audio/`, `dict/` (diccionarios descargables `dict-<lang>-vN.bin`),
`lexicon/` (tablas léxicas publicadas por licencia; ver
[lexicon/README.md](./lexicon/README.md)) y `libros/` (EPUB incluido).

## Interface

- [`sw.js`] eventos: `install`, `activate`, `fetch`, `message` (dos
  manejadores), `periodicsync`, `notificationclick`.
- Constantes: `SW_VERSION` (`"auto"`; el plugin `lecta-sw-manifest` de
  `vite.config.ts` la reescribe en el build con la versión de
  `sw-manifest.json`), `CACHE_PREFIX = "lecta-v2-"`,
  `MANIFEST_URL = "/sw-manifest.json"`, `NAVIGATION_TIMEOUT_MS = 3500`,
  `KITTEN_TTS_CACHE = 'lecta-kitten-tts-v2'`, `SHELL_URL =
  "/__lecta_shell__"`, `PERSISTENT_DLC_CACHES` =
  {`lecta-kitten-tts-v2`, `lecta-offline-dict-v1`}.
- Funciones: `lectaCache`, `isValidAssetResponse`, `manifestRequest`,
  `shellRequest`, `refillable`, `isKittenModelRequest`.
- Mensajes recibidos: `SKIP_WAITING`, `POST_HABIT_NOTIFICATION`
  (`payload: { title, subtitle?, body, tag, bookHash }`).
- Mensajes enviados a clientes: `LECTA_NAV_STALE`, `ASSET_MISMATCH_RELOAD`,
  `CHECK_HABIT_NOTIFICATION` (consumidos en
  `src/client/lib/sw-register.ts` y
  `src/client/lib/localNotificationScheduler.ts`).
- `periodicsync` con tag `lecta-habit-reminder`.

## Invariants

- Solo intercepta `GET` del mismo origen. Nunca maneja ni cachea `/api/*`,
  `/kindle/*`, `/k`, `/k/*`, `/inicio`, `/inicio/*`, `/sw.js`,
  `/sw-manifest.json` ni `/manifest.webmanifest`.
- Install: pide el manifiesto con `?v=<ts>` (`manifestRequest`) para que el
  SW viejo no le sirva el de su caché; no precachea `/`, `/index.html`,
  el manifiesto, `/manifest.webmanifest` ni `/sw.js`; precachea con
  `cache.add` por archivo tolerando fallos (nunca `cache.addAll`); el
  shell llega por `/__lecta_shell__?v=<ts>` y se guarda con `cache.put` bajo
  `/index.html` y `/` solo si es `text/html`.
- Activate: `clients.claim()` y borra toda caché `lecta-*` salvo la
  `lecta-v2-<version>` vigente y las de `PERSISTENT_DLC_CACHES` (la vieja
  `lecta-kitten-tts-v1` sí se borra).
- Navegación (`mode === "navigate"`, `/`, `/index.html`): red primero con
  `cache: "no-store"`; a los 3500 ms sirve la copia guardada **sin abortar
  el fetch**; si la fresca llega después, la guarda y avisa
  `LECTA_NAV_STALE`.
- Modelos (`*.onnx` o rutas con `/models/`): servidos desde
  `lecta-kitten-tts-v2` si hay respuesta 200 no-HTML; sintetiza `206` para
  cabeceras `Range`; purga entradas HTML o `206` cacheadas; si no hay,
  pasa a la red sin almacenar.
- Resto: cache-first; nunca acepta `text/html` para `.js`, `/assets/*`,
  `.wasm`, `.onnx`, ni no-`text/css` para `.css`
  (`isValidAssetResponse`). Reintenta una vez con `cache: "reload"`; si
  un `/assets/*` sigue inválido borra la caché vigente, avisa
  `ASSET_MISMATCH_RELOAD` y responde 404.
- Solo rellena caché para `/assets/`, `/libros/`, `/lexicon/`, `/icons/`,
  `/audio/` (`refillable`); `/dict/` queda fuera a propósito (el cliente lo
  guarda en IndexedDB).
- El nombre de caché del modelo debe coincidir con
  `KITTEN_CACHE_NAME` de `src/client/lib/kittenModel.ts`
  (`lecta-kitten-tts-v2`).
- `lecta-offline-dict-v1` está en la lista persistente pero ningún código
  de `src/` lo usa.
- La notificación usa `badge: "/icons/badge-72.png"`, que no existe en
  `public/icons/`.

## Side Effects

- Cache Storage: crea `lecta-v2-<version>`, escribe `/`, `/index.html` y
  assets rellenables; borra cachés `lecta-*` obsoletas.
- Red: `fetch` del manifiesto, del shell y de cada asset del precaché.
- Clientes: `postMessage` a todas las ventanas (`includeUncontrolled`);
  `showNotification`; `clearAppBadge`; `clients.focus`/`openWindow("/")`.
- `skipWaiting()` en install: un SW nuevo toma control sin esperar (el
  cliente solo recarga si la página ya estaba controlada, ver AGENTS.md).

## Verification

- Run: `pnpm test` (incluye `src/client/lib/sw-register.test.ts`).
- Run: `pnpm build` y revisar `dist/client/sw.js` (`SW_VERSION` igual a
  `sw-manifest.json`).
