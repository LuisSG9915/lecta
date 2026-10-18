# Track 8: Zero-Spoiler Character Memory & Scene Recap

## Objective
Provide instant, zero-spoiler character recall and scene reconstruction when the reader encounters a proper name or resumes reading after a break, strictly bound to the exact cursor reading location (`charOffsetInChapter`) and respecting `.agents/rules/lecta-zero-friction.md`.

## Rules & Constraints
- **Zero Spoilers (Strict Boundary)**: Never expose narrative facts, character roles, or quotes that occur after the current reading cursor (`charOffsetInChapter`) or in subsequent chapters ($c > c_{\text{current}}$).
- **Invisible Intelligence (1-Touch)**: Tapping a character name in `WordPanel.tsx` opens the memory card immediately without blocking reader flow.
- **1-Click Disable & Mute**: The user can toggle character memory globally or mute it for specific books in `settings.ts` / `idb.ts` and `ReaderMoreMenu.tsx`.

## Key Components & Architecture

1. **Exact Viewport Boundary & Offsets (`src/client/lib/reading-location.ts`)**:
   - `charOffsetAtViewTop(container, chapterText)`: Computes the precise character offset of the visible text boundary based on top elements in the viewport.
   - `charOffsetOfElementInChapter(container, targetElement, chapterText)`: Resolves element-level character offset within the active chapter.

2. **Zero-Spoiler Character Card Engine (`src/client/lib/character-helper.ts`)**:
   - `buildZeroSpoilerCharacterCard(characterName, chapters, boundary)`:
     - Scans chapters up to `boundary.chapterIndex`, cutting the active chapter text strictly at `boundary.charOffsetInChapter`.
     - Extracts:
       - `totalMentionsUpToCursor`: Total occurrences up to the reader's exact page.
       - `firstMention`: Chapter title, sentence quote, and approximate percentage where the character was introduced.
       - `recentMention`: The most recent mention prior to current offset (if $> 1$ mentions).
       - `recentSceneMentions`: Character interactions in the recent reading window.
     - Guarantees future plot events, deaths, betrayals, or identity reveals are strictly invisible.

3. **Contextual Scene & Return Recap (`src/client/lib/page-recap.ts`)**:
   - `generateZeroSpoilerSceneRecap(textBeforeCursor, lastReadTimestamp, currentTimestamp, lang)`: Extracts active characters in the scene, hours elapsed since last read session, and a contextual non-spoiler anchor snippet.
   - Persistence helpers: `saveCharacterMemoryEnabled(enabled)` and `loadCharacterMemoryEnabled()`.

4. **Reader UI Integration (`src/client/components/WordPanel.tsx` & `ReaderRecapBubble.tsx`)**:
   - When a proper noun is tapped, `WordPanel.tsx` receives `charOffsetInChapter` and renders `.character-memory-card` with security badge (`🔒 Hasta el Cap. X · Cero Spoilers`).
   - Provides 1-click quote translations for foreign language books ($L_2$).
   - Synchronized toggle available in `ReaderMoreMenu.tsx`.
