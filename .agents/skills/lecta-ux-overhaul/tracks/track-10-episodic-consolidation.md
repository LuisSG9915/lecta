# Track 10: Consolidación Episódica y Cierre de Capítulo

## Objective
Consolidate vocabulary encountered during chapter reading through a rapid, optional 25-second micro-challenge at chapter completion, backed by latency-based implicit FSRS grading and passive vocabulary gain for untroubled frontier words.

## Rules & Constraints
- **Zero-Friction Completion**: Chapter transition is never blocked. The consolidation micro-challenge can be skipped instantly with 1 tap or bypassed completely.
- **Implicit FSRS Grading (Zero Technical Jargon)**: The user is never asked to self-rate "Again / Hard / Good / Easy". Grading is automatically derived from typing latency ($ms/\text{char}$) and error count.
- **Episodic Cues (Real Context)**: Prompts use the exact sentences read in the chapter, anchoring retrieval to episodic memory.

## Key Components & Architecture

1. **Passive Learning Loop (`src/client/lib/knowledge.ts` & `profile-models.ts`)**:
   - At the end of chapter $c$, unconsulted frontier words ($\theta \approx \beta$) receive a gentle passive familiarity boost.
   - `recordChapterCompleted(lang)` updates the user's language mastery profile without requiring explicit flashcard testing.

2. **Episodic Consolidation Queue (`src/client/lib/practice.ts`)**:
   - `buildPostChapterConsolidationQueue(candidates, prefs, isForeignLanguage, options)`:
     - Merges words tapped in `WordPanel.tsx` (`in-chapter-lookup`) and pre-chapter primed words (`pre-chapter-primed`).
     - Prioritizes words the reader actually struggled with during reading over primed words.
     - Selects the top 2–3 items (`maxExercisesPerChapter: 2 | 3`).
     - Assigns exercise modality: `sentence-cloze` (contextual gap fill) and `word-scramble` (orthographic reconstruction in $L_2$).

3. **Latency-Based Implicit FSRS (`calculateImplicitFsrsGrade`)**:
   - Evaluates response time per character ($ms/\text{char}$):
     - $\le 650\text{ ms/char}$ and 0 errors: Grade 4 (Easy), stability multiplier $\times 1.35$, $\Delta\theta = +0.14$.
     - Fluent response and 0 errors: Grade 3 (Good), stability multiplier $\times 1.20$, $\Delta\theta = +0.09$.
     - 1 error or hint used: Grade 2 (Hard), stability multiplier $\times 1.00$, $\Delta\theta = +0.02$.
     - $\ge 2$ errors: Grade 1 (Again), stability multiplier $\times 1.00$, $\Delta\theta = -0.08$.
   - Schedules next review interval via FSRS algorithm seamlessly in the background.

4. **Micro-Challenge UI (`src/client/components/DeepReadingSummaryModal.tsx`)**:
   - Calm post-chapter celebration card showing chapter progress, reading time, and the optional 25s micro-challenge.
   - Quick "Continuar al siguiente capítulo" button for instant bypass.
   - Quick mute options: "Ocultar en este libro" and "Desactivar repasos post-capítulo".

5. **Settings & Persistence (`src/client/lib/settings.ts` & `idb.ts`)**:
   - Properties: `postChapterConsolidationEnabled: boolean`, `mutedConsolidationBookIds: string[]`.
   - Reactivation and configuration accessible via `ReaderMoreMenu.tsx`.
