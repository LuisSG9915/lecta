# Track 7: Kindle & E-Ink Adaptive Pre-Chapter Vocabulary Priming

## Objective
Extend the scientific pre-chapter vocabulary priming space to the Kindle / E-Ink web reader (`src/worker/kindle/`) in 4 clean phases, respecting E-Ink hardware constraints (zero CSS animations/transitions, high-contrast monochrome, 44px+ tap targets, progressive enhancement with HTML forms) and `.agents/rules/lecta-zero-friction.md`.

## Phase Breakdown for gemini-3.8-flash

### Phase 1: Edge Lexical Extraction & Rasch ZPD Selector (`src/worker/kindle/epub-reader.ts`)
- Implement `estimateThetaFromD1Knowledge` using Rasch 1PL (`1 / (1 + exp(-(theta - beta)))`) over D1 `user_knowledge` records.
- Implement `selectKindleChapterPrimingWords` to select 3 to 5 optimal words per chapter using:
  `Utility = (1 - P(know)) * ln(1 + chapterFreq) * ZPD_Gaussian(theta, beta)`.
- Extract the exact chapter sentence (max 140 chars) via `extractCompactContextSentence`.
- Support both native language books (L1) and foreign language books (L2).

### Phase 2: Zero-Friction Routes, 1-Click Disable & D1 Sync (`src/worker/kindle/routes.ts`)
- When entering `page === 0` of a chapter and priming is enabled (neither `lecta_k_priming_off` nor `lecta_k_mute_:bookId` cookie is set, and `?primed=1` is not set), render the Kindle pre-chapter priming view if there are >= 1 high-utility words.
- Add `POST /kindle/priming/action` to handle:
  - `known`: Upsert `status = 'known'` in `user_knowledge` and recalibrate user theta upward.
  - `save`: Upsert `status = 'learning'` in `user_knowledge` and schedule in `user_reviews` (FSRS).
  - `mute_book`: Set cookie to hide priming for this `bookId` and redirect immediately to `?primed=1`.
  - `disable_all`: Set cookie to disable priming globally and redirect immediately to `?primed=1`.
- Add a toggle link in the Kindle reader top/bottom bar so the user can re-enable or disable pre-reading anytime.

### Phase 3: High-Contrast E-Ink UI & In-Chapter Anchors (`src/worker/kindle/views.ts`)
- Implement `renderKindleChapterPrimingView` with strict E-Ink CSS (`transition: none !important`, `#000` on `#fff`, 2px solid borders, 44px+ buttons) and progressive enhancement (`window.lectaKindleAction` via `fetch` to hide cards without full E-Ink page flash).
- Implement `injectKindlePrimedAnchors` so the 3–5 pre-read words appear in the chapter HTML with a dashed underline and compact inline gloss.

### Phase 4: Vitest Unit & Route Tests (`epub-reader.test.ts` & `routes.test.ts`)
- Add unit tests for `selectKindleChapterPrimingWords`, `estimateThetaFromD1Knowledge`, and `extractCompactContextSentence`.
- Add route tests in `routes.test.ts` verifying:
  1. Rendering of the pre-chapter view on chapter start.
  2. Immediate bypass when `?primed=1` or `mute_book` / `disable_all` is triggered.
  3. D1 `user_knowledge` updates when marking a word as `known` or `save`.
