# Track 9: Neuro-Foco en Vivo & Telemetría de Fatiga Cognitiva

## Objective
Detect cognitive reading fatigue and loss of reading flow in real time without cognitive friction or blocking modals, offering calm 1-touch visual aids through the single bottom dock (`SmartReaderDock.tsx`) in strict accordance with `.agents/rules/lecta-zero-friction.md`.

## Rules & Constraints
- **Invisible Intelligence (1-Touch)**: Never interrupt the reader with modal popups or technical psychometric metrics ($F_t$, WPM, logit values).
- **Single Dock Architecture**: Suggestions appear solely as a subtle, tap-to-activate pill inside `SmartReaderDock.tsx`.
- **Zero Friction Dismissal**: The reader can ignore the pill, dismiss it in 1 tap, mute suggestions for the current book, or disable auto-suggestions globally.

## Key Components & Architecture

1. **Telemetry & Cognitive Model (`src/client/lib/focus-telemetry.ts`)**:
   - Tracks page dwell time ($\text{sec}/100\text{ words}$), reading direction (`forward` vs `backward`), regression frequency in sliding window, and session elapsed time.
   - Maintains language-specific baseline pace (`paceByLang: { meanSecPer100Words, madSecPer100Words }`), initialized at ~22 s/100w for native ($L_1$) and ~34 s/100w for foreign languages ($L_2$).
   - Calculates Cognitive Fatigue Index $F_t$ using logistic regression:
     $$F_t = \sigma(-2.2 + 0.85 \cdot z_{\text{stall}} + 1.15 \cdot \text{regressions} + 0.45 \cdot \text{sessionLoad})$$
   - Classifies primary friction cause: `'stall'`, `'regressions'`, or `'sustained-load'`.
   - Triggers fatigue suggestion when $F_t \ge 0.68$, `autoSuggestEnabled` is true, and the book is not muted.
   - Recommends optimal visual aid (`paragraph-focus`, `syntactic-lines`, `focus-ruler`) based on adaptive efficacy weights and language context (syntactic cadence boosted in $L_2$).

2. **Adaptive Learning Loop (`recordFocusAidOutcome`)**:
   - `recordFocusAidOutcome(profile, aid, recoveredFlow)`: Adapts tool efficacy weights based on user recovery. If the user recovers normal pace, the aid is rewarded ($1.5$); if disabled immediately, priority is dampened ($0.4$).

3. **Dock Integration (`src/client/components/SmartReaderDock.tsx`)**:
   - Renders `.focus-aid-pill` inside the reader dock when `isFatigued` is active.
   - 1-touch activation toggles the recommended aid immediately.
   - Provides quick contextual menu: "Ocultar en este libro" and "Desactivar avisos de foco".

4. **Settings & Persistence (`src/client/lib/settings.ts` & `idb.ts`)**:
   - Properties: `focusAutoSuggestEnabled: boolean`, `mutedFocusBookIds: string[]`.
   - Helpers: `muteBookForFocus`, `unmuteBookForFocus`, `isFocusMutedForBook`.
   - Full toggle and reactivation controls available in `ReaderMoreMenu.tsx`.
