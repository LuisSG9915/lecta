# src/client

## Overview

The Lecta browser client: a React 19 PWA built by Vite and served by the Cloudflare Worker.

- [main.tsx](./main.tsx) bootstraps the page.
- [App.tsx](./App.tsx) is the top-level shell. It handles session identity, the library, view
  switching (Shelf, Reader, Cuaderno, Journey, Account, PaperReading, Calibration),
  browser-history overlays, and background sync.
- Views and UI live in [components](./components/README.md), stateful reader and notebook
  logic in [hooks](./hooks/README.md), Web Workers in [workers](./workers/README.md), and
  domain logic, IndexedDB, sync and TTS engines in [lib](./lib/README.md).
- `styles/`, `fonts/` and `types/` hold no runtime code and are not documented here.

## Local Interface & Invariants

### main.tsx

- Startup runs `initCssGuard()`, `installClientErrorReporting()` and
  `applyTheme(loadTheme())`. It then renders
  `<StrictMode><ErrorBoundary><App/></ErrorBoundary></StrictMode>` into `#root`.
- The service worker:
  - In production (`import.meta.env.PROD` and `"serviceWorker" in navigator`),
    `registerServiceWorker()` runs after `load`, or right away if the document is already
    complete.
  - In development, `clearForeignServiceWorker()` removes a stale service worker on the same
    origin.

### App.tsx

- [App.tsx:App] (default export) wraps everything in a single `CompanionProvider`. `Reader`,
  `Vocabulary`, `Journey`, `PaperReading`, `CommunityShelf`, `Account`, `Calibration`,
  `RestoreBackupDialog`, `DiagnosticsModal` and `LegalNotice` are loaded with `React.lazy`.
  Shelf and Vocabulary stay mounted inside `<Activity mode="visible" | "hidden">`.
- Book open path (no full-screen interstitial):
  - Shelf `onSelect` calls [App.tsx:handleSelectBook], which calls [App.tsx:openShelfItem].
  - That calls [App.tsx:openStoredBook] or [App.tsx:openRemoteBook], then [App.tsx:openBook].
  - `openBook` calls `setBook` and mounts `<Reader>`.
- `openStoredBook` opens first and calls `syncPositions` afterwards («Lectura en 0
  segundos»). A remote conflict arrives later as a position prompt over the open book.
- `paperOnly` items go to `handlePaperBook` (PaperReading), never to the reader.
- [App.tsx:openBook] pushes one history overlay (`pushOverlay`). Its back callback runs
  [App.tsx:closeReader].
- Saving on exit has one path. [App.tsx:closeReader] awaits `positionFlushRef.current()`
  (the reader's last position) before teardown. Teardown releases the overlay, calls
  `setBook(null)`, then `syncPositions()`.
- Account isolation:
  - `<Reader>` is keyed `${sessionUserId ?? "anon"}:${book.hash}`.
  - It renders only when `canRenderCurrentBook` holds: `book.ownerUserId` is the current
    owner or `null`.
  - The shelf bootstrap waits until `dbUserId === sessionUserId` (after `setDbUser`).
  - `resetForIdentityChange` clears the open book, calibration and prompts.
- Calibration is opened only on request: `requestCalibration`, which loads the bank lazily
  from `../shared/calibration-bank`, or `showCalibration(words, null, lang)`. A book open
  never triggers it.
- Remote-only titles go through `bookDisplayName` and `isHashLikeIdentifier`
  (`./lib/cover.ts`) before they reach the shelf.

### App.tsx side effects

- Full sync when signed in (`runFullSync`): `checkRemoteReset`, `syncSavedWords`,
  `syncCompanion`, `syncKnowledge`, `syncPositions`, and more. It is registered with
  `registerReadingSyncRunner` and `registerSyncRetryRunner`, and runs again on `online`.
- It manages the session with `authClient.useSession()` (Better Auth). It switches the
  per-account IndexedDB with `setDbUser`, and writes calibration flags with
  `saveSessionValue`.

## Subdirectories & System Boundaries

- components: [./components/README.md](./components/README.md). The views, reader UI, the
  cat companion, minigames and primitives, with subfolders `charts/`, `notebook/` and
  `reader/`.
- hooks: [./hooks/README.md](./hooks/README.md). Reader hooks (persistence, navigation,
  section loading, selection, TTS) and notebook hooks (data, Herbario, learn, review).
- workers: [./workers/README.md](./workers/README.md). The `Intl.Segmenter` word worker and
  the ONNX TTS inference worker (Kitten and Piper).
- lib: [./lib/README.md](./lib/README.md). Domain logic, IndexedDB (`idb`), sync, the API
  client, EPUB parsing, FSRS, and the TTS engines. Documented separately.

## Global Invariants

- Reading starts with no step in between: a shelf tap goes straight to `Reader`. `Calibration`
  and `SectionPreview` are never full-screen gates on the open path.
- The reader has one bottom dock. `SmartReaderDock` is rendered only through
  `components/reader/ReaderDockHost.tsx`, once, and only while the reader is ready and not in
  deep-reading mode.
- Book identity: shelf and cover titles go through `bookDisplayName` or `displayTitle`
  (`lib/cover.ts`). Not covered: the reader top bar falls back to `fileName`
  (`components/Reader.tsx`).
- Local first: IndexedDB is the source of truth on the device, scoped per account. Server
  sync runs in the background and never blocks opening a book.

## Global Side Effects

- IndexedDB (`lecta` or `lecta:u:<id>`), localStorage and sessionStorage keys (listed in each
  child contract), CacheStorage (TTS models, through `lib` and `workers`), and the service
  worker registration.
- HTTP to the same-origin `/api/*` (auth, sync, AI, Kindle prefs, admin, error reports) and to
  static assets (`/libros/*.epub`, `/dict/*`, `/models/*`).
- One third-party origin: the ONNX runtime WASM fallback on `cdn.jsdelivr.net`
  (`workers/kitten-tts.worker.ts`).

## System Verification

- Run: `pnpm test` (Vitest; jsdom for `src/client/**`). `App.test.ts` covers this folder.
- The full gate is `pnpm gate`.
