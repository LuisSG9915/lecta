# components

## Overview

React components for the Lecta client (the PWA). [../App.tsx](../App.tsx) composes the
top-level views: Shelf, Reader, Cuaderno (`Vocabulary`), Journey, Account and PaperReading.
These views build on the shared primitives listed below (`Sheet`, `Dialog`, `Icon`, `Toggle`,
`Notice`), the cat companion system (`Companion*`), and the practice minigames. Most domain
logic lives in [../lib](../lib/README.md) and the stateful reader and notebook logic lives in
[../hooks](../hooks/README.md). Components call into them.

`Reader.tsx` (4 656 lines) is still a monolithic orchestrator. The refactor plan in
`AGENTS.md` («Deuda de complejidad») moves its pieces into `./reader/` and `../hooks/`.

## Interface

### Subdirectories

- [charts](./charts/README.md): dependency-free chart primitives for `AdminInsights`.
- [notebook](./notebook/README.md): presentational views of the Cuaderno, driven by the
  notebook hooks.
- [reader](./reader/README.md): reader subcomponents (top bar, content, dock host, overlays,
  sheets, selection menu).

### Top-level views

- [Shelf.tsx:Shelf] (default) Library. It exports the types
  [Shelf.tsx:ShelfItem], [Shelf.tsx:ShelfProps], [Shelf.tsx:ActiveRead],
  [Shelf.tsx:BookLike] and [Shelf.tsx:ShelfSortBy], plus the helpers
  [Shelf.tsx:takeShelfGreeting] and [Shelf.tsx:timeOfDayGreeting]. Its private
  `handleBookClick` routes a book tap.
- [Reader.tsx:Reader] (default, lazy-loaded by App) The EPUB reader. It exports the types
  [Reader.tsx:ReaderState], [Reader.tsx:ReaderSettingsTab], [Reader.tsx:NavIntent],
  [Reader.tsx:ReadyAnalysis] and [Reader.tsx:TocRow], plus [Reader.tsx:PRESET_LABELS],
  [Reader.tsx:recordDominated], and re-exports `markSectionPreviewed`,
  `shouldAutoShowPreview` and `BilingueParagraph`.
- [Vocabulary.tsx:Vocabulary] Cuaderno composer (see [notebook](./notebook/README.md)). It
  re-exports `findEpisodicHighlightRange`, `renderHighlightedContext`,
  `getStabilitySegments` and `safeStability`, which tests import from here.
- [Journey.tsx:Journey] (default) «Tu recorrido». It uses
  [JourneyFold.tsx:JourneyFold] (collapsible on mobile, always open at ≥64rem) and
  [JourneyInsights.tsx:JourneyInsights].
- [Account.tsx:Account] (default) «Tú»: the account cards, and the lazy-loaded
  [AdminInsights.tsx:AdminInsights] for the owner. Re-exports `PENDING_DELETE_KEY`.
- [PaperReading.tsx:PaperReading] / [PaperChapterSheet.tsx:PaperChapterSheet]
  «Leo este libro en papel»: a chapter index and a per-chapter word sheet.
- [ExploreShelf.tsx:ExploreShelf] (with [ExploreShelf.tsx:ExploreCommunityEmptyContext]),
  [CommunityShelf.tsx:CommunityShelf] and [DiscoverRail.tsx:DiscoverRail] (with
  [DiscoverRail.tsx:DISCOVER_MOOD_FILTERS] and [DiscoverRail.tsx:DISCOVER_PACE_FILTERS]):
  community guides and the public catalog.
- [PlanNote.tsx:PlanNote] Nota al margen de Lecta+ (2 líneas + enlace `/?carne=1`), sin estado: la usan WordPanel, ReaderNotices, FreeModes y la tarjeta de Kindle en «Tú».
- [ReaderCard.tsx:ReaderCard] Carné de Lector en «Tú» (import estático dentro del chunk lazy de Account): estados free / Lecta+ / Mecenas, selector Mensual / Anual y botones a `/api/billing/checkout` y `/portal`.
- [AttachBookSheet.tsx:AttachBookSheet] (lazy) «Adjunta tu archivo o pasa a Lecta+»: empareja el EPUB por `sha256` exacto (`lib/epub-intake.ts`) y, si coincide, lo guarda y abre el libro.
- [Welcome.tsx:Welcome] (lazy) Bienvenida sin sesión: la cuenta es obligatoria. Muestra el gato del landing, [AuthForms.tsx:AuthForms] y, sin red, el aviso de conexión única. App la elige con la tabla de decisión de `App.tsx`.
- [AuthForms.tsx:AuthForms] Formularios de acceso (entrar, crear cuenta, enlace, recuperar, restablecer) compartidos por Account y Welcome; exporta `translateAuthError`.
- [CoatChoice.tsx:CoatChoice] Paso «Elige a tu gato» en la estantería, solo para cuentas `free` sin pelaje inicial (`needsCoatChoice`).
- [AppNav.tsx:AppNav] Main navigation. [AppNav.tsx:NavDestination] is
  `"shelf" | "vocabulary" | "vocab" | "journey" | "account"`.
- [Calibration.tsx:Calibration] Vocabulary calibration test.
  [SectionPreview.tsx:SectionPreview] Chapter preparation (re-exports `Row` as
  `PreparationAnswerRow`).

### Reader satellites

- [SmartReaderDock.tsx:SmartReaderDock] (default) The single bottom dock. It switches between
  reading, audio/TTS and pure-canvas modes. Also exports
  [SmartReaderDock.tsx:FocusSuggestion], [SmartReaderDock.tsx:formatCompactProgress] and
  [SmartReaderDock.tsx:getCoverageBandClass].
- [WordPanel.tsx:WordPanel] (memo, default) The single word card. Exports the types
  [WordPanel.tsx:UnifiedWordPanelProps], [WordPanel.tsx:LocalLexiconEntry] and
  [WordPanel.tsx:ContextualMeaningResult].
- [TtsConsentDialog.tsx:TtsConsentDialog] Consent and preparation for «Leer en voz alta»
  (neural voice download versus system voice).
- [TtsDebugPanel.tsx:TtsDebugPanel] Temporary TTS diagnostics. This file is uncommitted on
  disk and marked `TODO: retirar`.
- [TtsNowPlaying.tsx:TtsNowPlaying] TTS session chip. Only its test imports it; no production
  code references it.
- [ReaderMoreMenu.tsx:ReaderMoreMenu], [ReaderRecapBubble.tsx:ReaderRecapBubble] (with
  [ReaderRecapBubble.tsx:formatTimeAway]),
  [ResumeSessionOverlay.tsx:ResumeSessionOverlay] (with
  [ResumeSessionOverlay.tsx:extractLastSentences] and
  [ResumeSessionOverlay.tsx:formatSceneRecapOneLine]),
  [BilingueParagraph.tsx:BilingueParagraph], [FocusRuler.tsx:FocusRuler] (with
  [FocusRuler.tsx:rulerBandPx], [FocusRuler.tsx:clampRulerY] and
  [FocusRuler.tsx:RULER_PARAGRAPH_LINES]), [ProgressInk.tsx:ProgressInk],
  [BookGlossaryModal.tsx:BookGlossaryModal], [QuoteCardModal.tsx:QuoteCardModal],
  [DeepReadingModal.tsx:DeepReadingModal] and
  [DeepReadingSummaryModal.tsx:DeepReadingSummaryModal].

### Companion (the cat)

- [CompanionProvider.tsx:CompanionProvider] The single provider, mounted once in
  `App.tsx`. Also exports [CompanionProvider.tsx:useCompanion],
  [CompanionProvider.tsx:useCompanionSafe], [CompanionProvider.tsx:ownedArticles],
  [CompanionProvider.tsx:effectiveEquipped], [CompanionProvider.tsx:drawableAccessories],
  [CompanionProvider.tsx:lastCareOf], and the types
  [CompanionProvider.tsx:CompanionContextValue] and
  [CompanionProvider.tsx:CompanionReaderContext].
- [Companion.tsx:Companion] SVG cat. Exports [Companion.tsx:CompanionPose],
  [Companion.tsx:CompanionMood] and [Companion.tsx:WEAR_LAYERS]. The geometry is in
  [companion-sprites.ts:STAGES], [companion-sprites.ts:PROPS] and
  [companion-sprites.ts:CAT_BOX].
- [CompanionButton.tsx:CompanionButton], [CompanionCelebration.tsx:CompanionCelebration]
  (with [CompanionCelebration.tsx:CELEBRATION_MS]),
  [CompanionCloset.tsx:CompanionCloset], [CompanionStage.tsx:CompanionStage],
  [CompanionPanel.tsx:CompanionPanel] and [CompanionPanel.tsx:CatCornerSheet] (with
  [CompanionPanel.tsx:COMPANION_TABS]), [GamePanel.tsx:GamePanel] (with
  [GamePanel.tsx:simulateNextReview] and [GamePanel.tsx:formatFsrsIntervalPreview]),
  [Seal.tsx:Seal] (with [Seal.tsx:toRoman], [Seal.tsx:FAMILY_TO_SEAL_CATEGORY] and
  [Seal.tsx:SEAL_CATEGORY_LABELS]).

### Practice minigames

- [WordScrambleGame.tsx:WordScrambleGame] (with
  [WordScrambleGame.tsx:splitWordIntoSyllables] and
  [WordScrambleGame.tsx:scrambleChunks]),
  [SentenceBuilderGame.tsx:SentenceBuilderGame] (with
  [SentenceBuilderGame.tsx:glossRevealsTarget] and
  [SentenceBuilderGame.tsx:splitSentenceAtTarget]),
  [GrammarGame.tsx:GrammarGame], [PracticeContext.tsx:PracticeContext] and
  [PracticeCompanionHeader.tsx:PracticeCompanionHeader] (with
  [PracticeCompanionHeader.tsx:getProgressEncouragement]).

### Settings and account pieces

- [KindleAppearancePanel.tsx:KindleAppearancePanel] «Tu Kindle»: a local preview, saved
  to the account.
- [OfflineDictionaryControl.tsx:OfflineDictionaryControl],
  [ThemeMenu.tsx:ThemeMenu], [DiagnosticsModal.tsx:DiagnosticsModal],
  [RestoreBackupDialog.tsx:RestoreBackupDialog],
  [ResetAccountSection.tsx:ResetAccountSection], [LegalNotice.tsx:LegalNotice] and
  [ReadingActivity.tsx:ReadingActivity] (also rendered from Journey; it imports
  `../styles/notebook.css` itself).

### Primitives

- [Sheet.tsx:Sheet], [Dialog.tsx:Dialog], [Notice.tsx:Notice], [Toggle.tsx:Toggle],
  [Icon.tsx:Icon] (with [Icon.tsx:IconName]) and [BookCover.tsx:BookCover].
- [ErrorBoundary.tsx:ErrorBoundary] (class component), with
  [ErrorBoundary.tsx:logErrorToStorage], [ErrorBoundary.tsx:getStoredErrorLogs],
  [ErrorBoundary.tsx:clearActiveBookState], [ErrorBoundary.tsx:ERROR_LOG_STORAGE_KEY] and
  [ErrorBoundary.tsx:ERROR_LOG_MAX_ENTRIES].

## Invariants

- Tapping a book opens the reader directly. The path is: [Shelf.tsx:Shelf]
  `handleBookClick` calls `onSelect`, which is `App.tsx` `handleSelectBook`. That calls
  `openShelfItem`, then `openStoredBook` / `openRemoteBook`, then `openBook`, which calls
  `setBook` and mounts `<Reader>`. There is no full-screen `Calibration` or `SectionPreview`
  step on this path:
  - `Calibration` only opens through `requestCalibration` / `showCalibration(words, null, …)`.
  - `SectionPreview` only renders inside the reader's `ReaderOverlays` as a modal, behind the
    `chapterPriming` flag.
- `handleBookClick` has two documented exceptions:
  - A `paperOnly` book goes to `onPaperBook` (PaperReading).
  - A `remoteOnly` book whose title is missing, «Libro en la nube», or hash-like
    (`isHashLikeIdentifier`) is first repaired with `repairRemoteBook`, then opens the
    options sheet instead of the reader.
- One bottom dock in the reader. `SmartReaderDock` is rendered only by
  `reader/ReaderDockHost.tsx`. [Reader.tsx:Reader] mounts `ReaderDockHost` once, under
  `state === "ready" && !isDeepReading`.
- Book identity:
  - [BookCover.tsx:BookCover] titles go through `bookDisplayName` (`../lib/cover.ts`).
  - [Shelf.tsx:Shelf] uses `displayTitle` and `isHashLikeIdentifier`.
  - Not covered: the reader top bar title in [Reader.tsx:Reader] is
    `currentChapterTarget?.label || sectionTitle || title || fileName`, and it does not go
    through `bookDisplayName`.
- Word card ([WordPanel.tsx:WordPanel]):
  - On open, the card only queries the dictionary. If there is no `shortDefinition`, it
    makes one AI call, and only when `canExplain && useAi`.
  - The variant is `"compact"` only when `localDefinition` is present; otherwise it is
    `"full"`.
  - Results are cached under `passage_meaning:v2:<variant>:<key>`.
- The companion is mounted once: one [CompanionProvider.tsx:CompanionProvider] wraps
  `App`. `setReaderContext` skips identical writes (`sameReaderContext`).
- `Sheet` and `Dialog` share focus trapping, Escape handling and focus return through
  `useModalBehavior` (`../lib/modal.ts`).

## Side Effects

- HTTP calls to the `/api/*` endpoints:
  - [Account.tsx:Account] calls `GET /api/admin/access` (204 = owner), `POST`
    `/api/kindle/link` (via `accountFetch`) and `/api/auth/list-accounts`.
  - [AdminInsights.tsx:AdminInsights] calls `/api/admin/insights` and
    `/api/admin/users/:id`.
  - [DiagnosticsModal.tsx:DiagnosticsModal] calls `/api/error-reports?days=7`.
  - [KindleAppearancePanel.tsx:KindleAppearancePanel] calls `GET` and `PUT`
    `/api/kindle/prefs`.
  - [Shelf.tsx:Shelf] fetches `SAMPLE_BOOK_URL` (`/libros/azul-ruben-dario.epub`).
- AI: [WordPanel.tsx:WordPanel] calls `explainInPassage` (`/api/ai/explain-in-passage`
  through lib) and writes the result to the session cache (`saveSessionValue`).
- localStorage:
  - [Shelf.tsx:Shelf] writes `lecta:calibration-banner-dismissed` and
    `lecta_onboarding_dismissed`.
  - [Reader.tsx:Reader] writes `lecta_active_book_context`.
  - [Account.tsx:Account] writes `PENDING_DELETE_KEY`.
  - [ErrorBoundary.tsx:logErrorToStorage] writes `lecta_error_log_v1` (at most 5 entries).
  - [TtsDebugPanel.tsx:TtsDebugPanel] reads and writes `lecta:ttsdebug`.
- sessionStorage: [ErrorBoundary.tsx:clearActiveBookState] calls `sessionStorage.clear()`.
- Navigation and reload:
  - [ErrorBoundary.tsx:ErrorBoundary] sets `window.location.href` and calls `reload()`.
  - [ResetAccountSection.tsx:ResetAccountSection] calls `window.location.assign("/")`
    after `startFromScratch`.
- Clipboard: [DiagnosticsModal.tsx:DiagnosticsModal], [Vocabulary.tsx:Vocabulary] and
  [TtsDebugPanel.tsx:TtsDebugPanel].
- IndexedDB, sync, TTS, audio and haptics go through `../lib`. The most used modules are
  `idb`, `haptics`, `settings`, `companion-audio`, `gamification`, `game` and `export`.
- Uncommitted TTS edits on disk:
  - [SmartReaderDock.tsx:SmartReaderDock] treats `activeEngine === "piper-neural"` as
    neural voice and mounts `<TtsDebugPanel>` (active only with `?ttsdebug=1`).
  - [TtsConsentDialog.tsx:TtsConsentDialog] describes Kitten (~24 MB, English) and Piper VITS
    (~63 MB, Spanish) downloads.

## Verification

- Run: `pnpm test`. This directory has 51 `*.test.ts` files, for example `Shelf.test.ts`,
  `Reader.test.ts`, `SmartReaderDock.test.ts` and `WordPanel.test.ts`, which run under jsdom.
