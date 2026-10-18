# Track 6: Adaptive & Multilingual Pre-Chapter Vocabulary Priming

## Rules & Constraints
- Follow `.agents/rules/lecta-zero-friction.md` strictly: reading pleasure and flow come first.
- Never block the user. The pre-chapter space must be skippable in 1 click and 100% disableable (per book or globally).
- Limit pre-chapter words to 3–5 high-utility items (Cowan's working memory limit).

## Tasks
1. **Settings (`src/client/lib/settings.ts`)**:
   - Add `chapterPrimingMode: 'auto' | 'on-demand' | 'off'` (default `'auto'`), `maxPrimingWords: 3 | 4 | 5` (default `4`), and `mutedPrimingBookIds: string[]`.
   - Expose helpers to toggle mode and mute/unmute specific `bookId`s (`muteBookForPriming`, `unmuteBookForPriming`, `isPrimingMutedForBook`, `disablePrimingGlobally`).

2. **Language-Specific Psychometrics (`src/client/lib/profile-models.ts`)**:
   - Extend user profile state to store `thetaByLang: Record<string, number>` so native books (L1) and foreign language books (L2) maintain independent ability estimates.
   - Implement Rasch 1PL mastery probability `P(know) = 1 / (1 + exp(-(theta - beta)))` and online Elo/Rasch update `updateLanguageTheta(lang, beta, outcome)` that increments on known (outcome = 1) and decrements on lookups (outcome = 0).

3. **Scientific Word Selector (`src/client/lib/section-words.ts` & `src/client/lib/preparation.ts`)**:
   - Rank chapter candidate words using:
     `Utility = (1 - P(know)) * ln(1 + chapterFreq) * ZPD_Gaussian(theta, beta) * POS_Weight * FSRS_Retrievability_Boost`.
   - Extract the real sentence from the chapter (max 140 chars) for contextual priming.
   - Support L2 books by prioritizing phrases/locuciones (`phrases.ts`) and contextual glosses (`translate.ts`).

4. **Editorial Pre-Chapter UI (`src/client/components/SectionPreview.tsx` & `src/client/styles/reader.css`)**:
   - Render a calm, non-intrusive editorial card at the start of a chapter (`.lecta-chapter-priming`).
   - Include: word lemma, POS badge, 1-click TTS pronunciation (`speech.ts`), 1-line gloss/translation, real chapter quote, `✓ Ya la sé` button (triggers `outcome = 1` in `knowledge.ts` & `profile-models.ts`), and `+ Repasar` button (schedules in `fsrs.ts`).
   - Add an immediate `Opciones ▾` menu on the card with **"Ocultar en este libro"** and **"Desactivar pre-lectura siempre"**.

5. **Reader Integration & Passive Learning Loop (`src/client/components/Reader.tsx` & `ReaderMoreMenu.tsx`)**:
   - Add a toggle in `ReaderMoreMenu.tsx` to switch between Automático, Bajo demanda, and Desactivado (`segmented--priming`).
   - When a user finishes a chapter without tapping a frontier word (`theta ≈ beta`), record a gentle passive mastery gain and update `recordChapterCompleted(lang)`.
   - When a user taps an unpredicted word in `WordPanel.tsx`, record `outcome = 0` to recalibrate `thetaByLang` downward.
