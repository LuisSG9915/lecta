# Track 11: Andamiaje Bilingüe L2 & Pre-Caché Predictivo

## Objective
Enable smooth, zero-friction foreign language ($L_2$) reading through adaptive 3-tier bilingual scaffolding that fades as user autonomy grows, combined with background predictive pre-caching of upcoming chapters ($c+1, c+2$) for resilient offline reading.

## Rules & Constraints
- **Zero Interruption**: Pre-caching and dictionary lookups occur strictly in the background without UI stutter, jank, or blocking spinners.
- **Dynamic Scaffolding Fading**: Scaffolding adapts to the reader's evolving competence, automatically reducing assistance as reading fluency increases.
- **Offline Resilience**: Offline dictionaries and cached translations persist in IndexedDB / CacheStorage for uninterrupted reading in transit.

## Key Components & Architecture

1. **3-Tier Bilingual Scaffolding (`src/client/lib/phrases.ts`)**:
   - **Tier 1 (Micro-glosas inline)**: Discreet inline glosses on frontier words and complex idioms without breaking paragraph layout.
   - **Tier 2 (Traducción por cláusulas)**: Targeted hints at the clause boundary for syntactically challenging sentences.
   - **Tier 3 (Párrafo espejo)**: Parallel translated paragraph for high-friction passages where comprehension breaks down.

2. **Optimal Tier Selection & Autonomy Adaptation (`selectOptimalScaffoldingTier`)**:
   - Computes effective friction from lexical difficulty (unknown word ratio $\times 4.5$), syntactic complexity (average words per clause), and user ability $\theta$.
   - Incorporates `autonomyBiasByLang`:
     - Escalation (`action = 'escalated'`): User manually requested deeper translation; bias increases ($+0.055$) to provide more scaffolding.
     - Autonomous reading (`action = 'read-autonomously'`): User completed the paragraph without expanding; bias decreases ($-0.015$), gradually fading assistance.

3. **Predictive Chapter Pre-cache (`src/client/lib/offline-dictionary.ts`)**:
   - `planPredictiveChapterPrecache(c, total, lookahead = 2)`: Identifies chapters $c+1$ and $c+2$.
   - `precachePredictiveChapters`: Parses upcoming sections in non-blocking event loop slices and fetches lexical definitions / translations before the reader arrives.
   - Triggered on chapter load in `Reader.tsx` when reading in an $L_2$ language and network is available.

4. **UI Components (`BilingueParagraph.tsx` & `OfflineDictionaryControl.tsx`)**:
   - `BilingueParagraph.tsx`: Renders paragraphs with initial tier, supports 1-tap escalation, and emits `onTierEscalated`.
   - `OfflineDictionaryControl.tsx`: Panel to inspect downloaded dictionaries, trigger full book pre-caching, and view local storage footprint.

5. **Settings & Persistence (`src/client/lib/settings.ts` & `idb.ts`)**:
   - Mode: `bilingualScaffoldingMode: 'auto' | 'tier-1-only' | 'tier-3-always' | 'off'`.
   - Muting: `mutedBilingualBookIds: string[]`.
   - Mode selector and toggle available directly in `ReaderMoreMenu.tsx`.
