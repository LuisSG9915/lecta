# components/reader

## Overview

Subcomponents of the reading view, extracted from [Reader.tsx](../Reader.tsx) (Fase 7 and the
work that followed). `Reader.tsx` is still the orchestrator: it owns state, refs, effects and
the reader hooks in [../../hooks](../../hooks/README.md), and passes values and callbacks down.
Most files here only render (several say «Solo pinta» in their header comment). The exceptions
are listed under Side Effects.

## Interface

- [ReaderTopBar.tsx:ReaderTopBar] (memo) Top bar: back, title/author, `ProgressInk`, and
  buttons for the table of contents, appearance and «more».
- [ReaderContent.tsx:ReaderContent] Reading area: the section content, highlights, the
  `ReaderRecapBubble`, the end-of-chapter card, the section nav footer and
  [MidChapterRecallCard.tsx:MidChapterRecallCard]. Exports
  [ReaderContent.tsx:ReaderSectionRow] and [ReaderContent.tsx:ReaderContentProps].
- [MidChapterRecallCard.tsx:MidChapterRecallCard] (memo) «Repaso antes de leer»: a
  `SentenceBuilderGame` for one `EpisodicWordItem`, with `onSolve` and `onSkip`.
- [ReaderDockHost.tsx:ReaderDockHost] Host for the single bottom dock. It maps reader
  state into [../SmartReaderDock.tsx](../SmartReaderDock.tsx) props (progress text, TTS
  controls, focus suggestion, cat lane via `CompanionButton`).
- [ReaderFloatingLane.tsx:ReaderFloatingLane] (memo) The single column
  (`.reader-floating-lane`) where everything that floats above the dock stacks.
- [ReaderFloatingBars.tsx:ReaderFloatingBars] (memo) TTS «word captured»
  notice, and the bilingual paragraph (`BilingueParagraph`).
- [ReaderFocusLayers.tsx:ReaderFocusLayers] (memo) The `FocusRuler` with the cat paw, and
  the deep-reading (Retiro) indicator.
- [ReaderNotices.tsx:ReaderNotices] (memo) Notice strip: the resume marker
  ([ReaderNotices.tsx:ReaderResumeCard]), the chapter-prep suggestion, the calibration
  invitation, and the regressions notice.
- [ReaderSelectionBar.tsx:ReaderSelectionBar] (memo) Selection action menu (ink, reflection,
  postcard, ask the companion, «Copiar», and «Significado» first on touch) with custom
  drag handles. [ReaderSelectionBar.tsx:ReaderSelectionButton] describes one button.
- [ReaderOverlays.tsx:ReaderOverlays] (named and default export) Modal layer: `WordPanel`,
  `SectionPreview` (as `mode="modal"`), `QuoteCardModal`, `DeepReadingModal`,
  `DeepReadingSummaryModal`, `BookGlossaryModal`, `TtsConsentDialog`, `ReaderMoreMenu` and
  `Dialog`. It exports the state types [ReaderOverlays.tsx:PrepState],
  [ReaderOverlays.tsx:QuoteCardState], [ReaderOverlays.tsx:PageRecapState] and
  [ReaderOverlays.tsx:CatPassageExplanationState].
- [ReaderSearchAndTocSheet.tsx:ReaderSearchAndTocSheet] `Sheet` for the table of contents,
  search and marks. [ReaderSearchAndTocSheet.tsx:SheetKind] is
  `"toc" | "settings" | "search" | "marks"`. Also exports
  [ReaderSearchAndTocSheet.tsx:TocRow].
- [ReaderSettingsSheet.tsx:ReaderSettingsSheet] (default export) «Opciones de lectura» sheet,
  built from `ThemeMenu`, `Toggle` and `ReaderMoreMenu`.

## Invariants

- One bottom dock. [ReaderDockHost.tsx:ReaderDockHost] is the only place that renders
  `SmartReaderDock`. `Reader.tsx` mounts `ReaderDockHost` once, only when
  `state === "ready" && !isDeepReading`.
- Floating elements above the dock go inside [ReaderFloatingLane.tsx:ReaderFloatingLane]
  and are never positioned by hand with `bottom` (see the header comment).
- Mouse versus touch word lookup ([ReaderContent.tsx:ReaderContent],
  [ReaderSelectionBar.tsx:ReaderSelectionBar]):
  - With a mouse, a click on a word opens the word card directly.
  - On touch, a sustained press selects the word and opens the selection menu instead. The
    press lasts [ReaderContent.tsx:LONG_PRESS_MS] = 480 ms, with a movement tolerance of
    [ReaderContent.tsx:LONG_PRESS_SLOP_PX] = 12 px. The native selection gets
    [ReaderContent.tsx:NATIVE_SELECTION_GRACE_MS] = 300 ms to appear before the word is
    selected by code.
  - The capture-phase scroll listeners ignore scrolling of the menu's own row.
- `SectionPreview` is not a separate route. It renders inside
  [ReaderOverlays.tsx:ReaderOverlays] as `mode="modal"`, and only when there is `prep`
  state and `isFeatureFlagEnabled("chapterPriming")` is on.
- Presentational components receive state through props and do not read stores themselves,
  except for the persistence calls listed below.

## Side Effects

- IndexedDB: [ReaderContent.tsx:ReaderContent] calls
  `saveSessionValue("hint:longPress:v1", "1", captureDbScope())` once the long-press hint
  has been shown, and `saveCharacterMemoryEnabled(false)` from the recap bubble.
- sessionStorage: [ReaderNotices.tsx:ReaderNotices] calls `markSectionPreviewed`
  (`src/client/lib/chapter-analysis.ts`) when the chapter-prep suggestion is used.
- Clipboard: [ReaderSelectionBar.tsx:ReaderSelectionBar] writes the selection with
  `navigator.clipboard.writeText` («Copiar»).
- DOM selection: [ReaderSelectionBar.tsx:ReaderSelectionBar] and
  [ReaderContent.tsx:ReaderContent] call `window.getSelection()` `removeAllRanges` and
  `addRange`, and attach `selectionchange`, `scroll`, `resize` and `pointer*` listeners.
- File download: [ReaderSearchAndTocSheet.tsx:ReaderSearchAndTocSheet] calls
  `downloadBookMarkdown(bookHash, title)`.
- [MidChapterRecallCard.tsx:MidChapterRecallCard] calls `scrollIntoView({ block: "nearest" })`
  on mount.
- Uncommitted change on disk: [ReaderOverlays.tsx:ReaderOverlays] now passes
  `bookLanguage={language}` to `TtsConsentDialog`.

## Verification

- Run: `pnpm test`. Tests in this directory: `MidChapterRecallCard.test.ts`,
  `ReaderNotices.test.ts`, `ReaderOverlays.test.ts`, `ReaderSearchAndTocSheet.test.ts` and
  `ReaderSelectionBar.test.ts`. For end-to-end checks, see `e2e/smoke-journeys.spec.ts` and
  `e2e/reader-position.spec.ts`.
