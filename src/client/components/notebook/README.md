# components/notebook

## Overview

Presentational views of the Cuaderno (notebook). They were split out of
[Vocabulary.tsx](../Vocabulary.tsx) in Fase 5 (V2). `Vocabulary.tsx` is the composer: it
mounts the hooks in [../../hooks](../../hooks/README.md) (`useNotebookData`,
`useHerbarioView`, `useLearnSession`, `useReviewSession`, `usePracticeCompanion`), decides
which view to show, and passes each view the hook's result object (`view`, `learn`, `review`,
`practiceCompanion`).

## Interface

- [NotebookHero.tsx:NotebookHero] Cover of the Cuaderno: today's summary, progress by
  stage, the primary button (review or learn), and a slot for the free modes.
  [NotebookHero.tsx:NotebookTab] is `"words" | "quotes" | "activity"`.
- [FreeModes.tsx:FreeModes] Collapsible «Más formas de practicar» grid with the free modes
  and the workshop with the cat.
- [HerbarioPanel.tsx:HerbarioPanel] «Mi Herbario de Palabras» tab: the 30-day check-up,
  filters (`FILTERS`), ordering (`ORDERS`), export, and the word list (flat, or grouped by book
  in pages of `GROUP_PAGE`). It receives `UseHerbarioViewResult`.
- [WordRow.tsx:WordRow] One word row. It renders the highlighted context
  (`renderHighlightedContext`) and the stability segments (`getStabilitySegments`,
  `safeStability`).
- [LearnSessionView.tsx:LearnSessionView] Guided «Aprender» card (first exposure). Its
  actions are «Ya la conozco», «Quiero aprenderla» and «Pasar por ahora». It also renders
  the end screen and the bridge to review. It receives `UseLearnSessionResult`.
- [PracticeCard.tsx:PracticeCard] One review exercise. It renders the current mode (pairs,
  scramble via `WordScrambleGame`, category via `GrammarGame`, sentence ordering via
  `SentenceBuilderGame`, write, choose/sense, self-rating) and wires its actions to
  `UseReviewSessionResult`.
- [ReviewDone.tsx:ReviewDone] «Terminado por hoy.» session close: how many words were
  reviewed, the next due time (`formatInterval`), and the companion streak. It also
  re-exports `findEpisodicHighlightRange`, `renderHighlightedContext`,
  `getStabilitySegments` and `safeStability`.
- [QuotesPanel.tsx:QuotesPanel] «Citas y Hallazgos» tab: saved passages with CSV export,
  copy, remove, and quote-card actions. [QuotesPanel.tsx:QuoteCardRequest] is the payload
  that `onQuoteCard` receives.

## Invariants

- These views do not own state. No file in this directory calls a React hook
  (`useState`/`useEffect`/…). Everything comes from props or from the hook result objects
  typed as `UseHerbarioViewResult`, `UseLearnSessionResult`, `UseReviewSessionResult` and
  `UsePracticeCompanionResult`.
- Exercise eligibility and queue rules are decided by `useReviewSession` and
  `src/client/lib/notebook-model.ts`, not by these views. `PracticeCard` only renders
  `review`'s current item.
- `scripts/audit-cuaderno.mjs` searches the `@notebook` group, which includes these files.
  Moving code between them does not break the audit, but removing a pattern it checks for
  does.

## Side Effects

- Text-to-speech: [HerbarioPanel.tsx:HerbarioPanel], [LearnSessionView.tsx:LearnSessionView]
  and [PracticeCard.tsx:PracticeCard] call `speakWord` (`src/client/lib/speech.ts`).
- Haptics: `triggerHaptic` in [NotebookHero.tsx:NotebookHero],
  [HerbarioPanel.tsx:HerbarioPanel] and [QuotesPanel.tsx:QuotesPanel].
- File download: [HerbarioPanel.tsx:HerbarioPanel] calls `downloadBookMarkdown`
  (`src/client/lib/export.ts`). That function reads the book, its position, words,
  annotations and intervals from IndexedDB, then downloads a Markdown file.
- Copy, CSV export, and removal in [QuotesPanel.tsx:QuotesPanel] go through the parent
  callbacks `onCopy`, `onExport` and `onRemove`. The component itself does not write.

## Verification

- Run: `pnpm test`. This directory has no test files of its own; it is covered through
  `src/client/components/Vocabulary.test.ts` and `pnpm audit:cuaderno`.
