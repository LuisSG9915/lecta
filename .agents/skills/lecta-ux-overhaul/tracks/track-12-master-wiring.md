# Track 12: Ensamblaje Maestro en Reader.tsx y Validación Global

## Objective
Harmonize and wire all intelligent subsystems (Tracks 6 through 11) into the central reading lifecycle (`Reader.tsx` and `ReaderMoreMenu.tsx`), ensuring zero-friction reading, unified settings persistence in IndexedDB, and global validation across the entire test suite.

## Rules & Constraints
- **Zero-Friction UX (`.agents/rules/lecta-zero-friction.md`)**:
  - No blocking popups or modals during page navigation or chapter transitions.
  - A single unified bottom dock in `Reader.tsx` that smoothly hosts reading and audio modes.
  - 100% 1-click muting and global disablement for all assists, with full reactivation in `ReaderMoreMenu.tsx`.
- **Zero Test Regressions**: All existing unit and integration tests must pass without errors or type warnings.

## Architecture & Integration in Reader.tsx

1. **Chapter Lifecycle & Pre-Cache (Tracks 6 & 11)**:
   - On chapter load ($c$), candidate frontier words are fetched from `section-words.ts` / `preparation.ts` filtered by user $\theta_{u,L}$ and stored in `currentChapterPrimedWords`.
   - If the book is in a foreign language ($L_2$) and online, background predictive pre-caching (`planPredictiveChapterPrecache`) triggers for chapters $c+1$ and $c+2$.
   - Bilingual paragraphs (`BilingueParagraph.tsx`) receive `initialTier` computed by `selectOptimalScaffoldingTier` and adapt user autonomy via `updateBilingualAutonomyProfile(..., 'escalated')`.

2. **Live Neuro-Focus & Dock Telemetry (Track 9)**:
   - On each page turn, dwell time and direction are evaluated via `evaluateReadingFatigue(profile, input, isForeignLanguage)`.
   - When `isFatigued === true`, a calm pill suggestion appears in `SmartReaderDock.tsx`.
   - Aid activation or dismissal updates efficacy weights via `recordFocusAidOutcome` and persists in settings.

3. **Zero-Spoiler Character Memory (Track 8)**:
   - Exact cursor character offset (`charOffsetInChapter`) is captured from the viewport via `reading-location.ts`.
   - Passed to `WordPanel.tsx` and `ReaderRecapBubble.tsx`, driving `buildZeroSpoilerCharacterCard` and `generateZeroSpoilerSceneRecap` to eliminate spoilers.
   - Lookups inside the chapter are added to `currentChapterLookups` with real sentence context and recalibrate $\theta_{u,L}$.

4. **Chapter Completion & Episodic Consolidation (Tracks 6 & 10)**:
   - At chapter conclusion, unconsulted frontier words receive a gentle passive familiarity gain in `knowledge.ts`.
   - `buildPostChapterConsolidationQueue` combines in-chapter lookups with primed words to feed the optional 25s micro-challenge in `DeepReadingSummaryModal.tsx` with latency-based implicit FSRS grading.

5. **Unified Settings & Reader Menu (`settings.ts`, `idb.ts`, `ReaderMoreMenu.tsx`)**:
   - Persists all preferences: `chapterPrimingMode`, `characterMemoryEnabled`, `focusAutoSuggestEnabled`, `postChapterConsolidationEnabled`, `bilingualScaffoldingMode`, and their book muting lists.
   - `ReaderMoreMenu.tsx` provides instant toggles to reactivate any silenced assists.
