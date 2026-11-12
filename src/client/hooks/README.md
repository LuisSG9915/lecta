# hooks

## Overview

Custom React hooks. They fall into three groups:

1. **Reader hooks** (`useReader*`), extracted from
   [../components/Reader.tsx](../components/Reader.tsx) in the refactor phases R1/R3 and
   Fase 7. `Reader.tsx` still composes them and passes refs and setters.
2. **Notebook hooks**, extracted from [../components/Vocabulary.tsx](../components/Vocabulary.tsx)
   in Fase 5 V1. Their result objects drive [../components/notebook](../components/notebook/README.md).
3. Two standalone hooks: `usePaperReading` and `useMediaQuery`.

Domain logic lives in [../lib](../lib/README.md).

## Interface

### Reader

- [useReaderPersistence.ts:useReaderPersistence] Position saving and reading-activity
  segments. Returns `saveSoon` (debounced, 400 ms), `saveImmediate`, `saveLatest` (no
  re-measure), `loadSavedPosition`, `noteActivity`, `closeActivity`, `latestPositionRef` and
  `activityRef`. Types: [useReaderPersistence.ts:ActivitySegment],
  [useReaderPersistence.ts:DayGoalTracker].
- [useReaderNavigation.ts:useReaderNavigation] `navigate` between destinations, with an
  intent. [useReaderNavigation.ts:useReaderPagination] provides `goPage` and
  `completeChapterTo`. Types: [useReaderNavigation.ts:ReaderNavRestore],
  [useReaderNavigation.ts:ReaderNavDestination], [useReaderNavigation.ts:ReaderNavigate].
- [useReaderSectionLoader.ts:useReaderSectionLoader] Parses and sanitizes a section, applies
  marks and syntactic lines, hydrates images, measures, restores the position, and sets the
  ready or error state.
- [useReaderSelection.ts:useReaderSelection] Opens and closes the word card (overlay history
  entry, profile evidence, `word_consulted` journal event).
- [useReaderTts.ts:useReaderTts] Read-aloud: the controller, consent dialog, neural model
  download/delete, rate, voice and sentence navigation. Type:
  [useReaderTts.ts:ReaderNavigateFn].
- [useReaderChapterPrep.ts:useReaderChapterPrep] Chapter preparation (SectionPreview state).
  Also exports [useReaderChapterPrep.ts:shouldAutoShowPreview] and
  [useReaderChapterPrep.ts:markSectionPreviewed].
- [useReaderAnnotationsAndSearch.ts:useReaderAnnotationsAndSearch] Passage marks
  (annotations), the quote card, book search, and the cat's passage explanation.
- [useReaderSettings.ts:useReaderSettings] Applies a settings patch, resolves the focus mode,
  and persists it per book.
- [useReaderShortcutsAndGestures.ts:useReaderShortcutsAndGestures] Keyboard shortcuts,
  gestures, and the screen wake lock.
- [useReaderCompanion.ts:useReaderCompanion] Visible state of the reading cat
  (`signalCompanion`).
- [useReaderDeepReading.ts:useReaderDeepReading] and
  [useReaderDeepReadingCycle.ts:useReaderDeepReadingCycle] Deep-reading (Retiro) state, plus
  the start and finish cycle and its timer.
- [useReaderTrackMove.ts:useReaderTrackMove] Regression and fatigue telemetry on each
  page or section move.
- [useReaderResizeRemeasure.ts:useReaderResizeRemeasure] Re-measures in page mode on
  `ResizeObserver` and `document.fonts.ready`.
- [useReaderChrome.ts:useReaderChrome] and [useReaderUiState.ts:useReaderUiState] Plain state
  containers (bars, zen, stall, pacer, notices, sheets). The effects that use them stay in
  `Reader.tsx`.

### Notebook

- [useNotebookData.ts:useNotebookData] Saved words, the «Usar IA» preference, declared
  knowledge, and first exposures.
- [useHerbarioView.ts:useHerbarioView] Filters, ordering, search, language/book scope and
  derived lists.
- [useLearnSession.ts:useLearnSession] The guided «Aprender» batch
  ([useLearnSession.ts:LearnState]).
- [useReviewSession.ts:useReviewSession] The review session and free modes: queue, grading,
  hints, rescue, and close.
- [usePracticeCompanion.ts:usePracticeCompanion] The cat's mode, pose, phrase and streak
  during practice.

### Other

- [usePaperReading.ts:usePaperReading] Controller for «Leo este libro en papel». Types:
  [usePaperReading.ts:PaperChapterEntry], [usePaperReading.ts:PaperSheetState],
  [usePaperReading.ts:ManualSaveOutcome].
- [useMediaQuery.ts:useMediaQuery] A reactive `matchMedia` built on `useSyncExternalStore`.

## Invariants

- Position on close ([useReaderPersistence.ts:useReaderPersistence]):
  - `saveLatest` writes the last captured position (`latestPositionRef`) without measuring
    the DOM again.
  - It also sets `closedRef`, which cancels the pending lazy save and the unmount save.
    Measuring after the book leaves the screen would save `scrollY = 0`.
- The unmount cleanup effect depends only on `[bookHash]`. The functions it calls are read
  through refs (`saveLatestRef`, `closeActivityRef`). With the functions in the dependency
  array, the effect wrote to IndexedDB on every render.
- Chapter close goes through `completeChapterTo`
  ([useReaderNavigation.ts:useReaderPagination]).
- Review queue ([useReviewSession.ts:useReviewSession]):
  - `reviewWords` holds only words that have been presented, are due, and are not known.
  - `Vocabulary.tsx` builds that list with `reviewQueue` from `../lib` and passes it in.
  - The mode is chosen with `isEligible`; a word that is not eligible for its mode falls back
    to `"choose"`.
- Neural TTS ([useReaderTts.ts:useReaderTts]):
  - The model is downloaded only after consent: `hasKittenConsent()` or the consent dialog
    first, and only when `isFeatureFlagEnabled('neuralTts')`. A failed download falls back to
    the system voice with a notice.
  - The first play with `consentedAt === null` opens the consent dialog.
  - Uncommitted change on disk: the neural engine is chosen by book language. `es` uses
    `"piper"`; anything else uses `"kitten"`. `isEngineModelDownloaded` and
    `removeDownloadedModel` receive that kind.
- [useMediaQuery.ts:useMediaQuery] returns `false` when `matchMedia` is missing (jsdom).
  Callers treat `false` as mobile.
- [useReaderChapterPrep.ts:shouldAutoShowPreview] returns `false` in three cases: the mode
  is `"off"`, there are no unknown key words, or the key `lecta:previewed:<book>:<section>`
  is set in sessionStorage or localStorage.

## Side Effects

- IndexedDB (through `../lib/idb`):
  - `saveBookPosition` and `saveReadingInterval` in
    [useReaderPersistence.ts:useReaderPersistence] and
    [useReaderSectionLoader.ts:useReaderSectionLoader].
  - `saveAnnotation` and `removeAnnotation` in
    [useReaderAnnotationsAndSearch.ts:useReaderAnnotationsAndSearch].
  - `saveKnowledge`, `recordReview` and `saveSessionValue` in
    [useLearnSession.ts:useLearnSession].
  - `recordReview` and `scheduleReview` in [useReviewSession.ts:useReviewSession].
  - `savePaperReading`, `saveWordWithKnowledge` and `removeWord` in
    [usePaperReading.ts:usePaperReading].
  - `saveReaderSettings` in [useReaderSettings.ts:useReaderSettings].
- Server sync pushes:
  - `pushActivityToServer` ([useReaderPersistence.ts:useReaderPersistence]).
  - `pushWordsToServer` and `pushKnowledgeToServer` ([useLearnSession.ts:useLearnSession],
    [useReviewSession.ts:useReviewSession], [usePaperReading.ts:usePaperReading]).
  - `pushAnnotationsToServer`
    ([useReaderAnnotationsAndSearch.ts:useReaderAnnotationsAndSearch]).
  - `fetchBookGuide` ([usePaperReading.ts:usePaperReading]).
- AI endpoints: `explainInPassage`
  ([useReaderAnnotationsAndSearch.ts:useReaderAnnotationsAndSearch]) and `explainInContext`
  ([useReviewSession.ts:useReviewSession]).
- Browser history: `pushOverlay` in [useReaderSelection.ts:useReaderSelection],
  [useReaderChapterPrep.ts:useReaderChapterPrep] and [usePaperReading.ts:usePaperReading].
- Web storage: [useReaderChapterPrep.ts:markSectionPreviewed] writes sessionStorage.
- Screen wake lock: `navigator.wakeLock.request("screen")` in
  [useReaderShortcutsAndGestures.ts:useReaderShortcutsAndGestures].
- Timers:
  - 1 s `setInterval` for activity roll and idle in
    [useReaderPersistence.ts:useReaderPersistence].
  - 10 s in [useReaderCompanion.ts:useReaderCompanion].
  - An interval in [useReaderDeepReadingCycle.ts:useReaderDeepReadingCycle].
- TTS: `downloadKittenModel` (network to CacheStorage), `removeDownloadedModel`,
  `saveTtsSettings` and `trackEvent` in [useReaderTts.ts:useReaderTts].
- Telemetry: `trackEvent` and `recordMove` in [useReaderTrackMove.ts:useReaderTrackMove],
  [useReaderSelection.ts:useReaderSelection] and
  [useReaderSectionLoader.ts:useReaderSectionLoader].
- Persistence: `savePracticeCompanionMode` in
  [usePracticeCompanion.ts:usePracticeCompanion].

## Verification

- Run: `pnpm test`. Tests: `hooks.test.ts`, `usePaperReading.test.ts`,
  `useReaderAnnotationsAndSearch.test.ts`, `useReaderChapterPrep.test.ts`,
  `useReaderNavigation.test.ts`, `useReaderPersistence.test.ts`,
  `useReaderSectionLoader.test.ts`, `useReaderSelection.test.ts`, `useReaderSettings.test.ts`
  and `useReaderShortcutsAndGestures.test.ts`.
