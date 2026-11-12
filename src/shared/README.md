# Shared modules (`src/shared`)

## Overview

Pure TypeScript shared by the browser client (`src/client`), the worker
(`src/worker`) and scripts. Holds the sync contract validators, the companion
(cat) game model, Kindle preference vocabulary, lexicon/word-form helpers, the
calibration bank and IRT math, EPUB checks/metadata, and the app version. No
module here imports from `src/client` or `src/worker`; imports are only between
files of this directory.

## Interface

| File | Key exports |
| --- | --- |
| `app-version.ts` | `APP_VERSION` (`"0.2.15"`) |
| `reading-data.ts` | Sync limits and cleaners: `ANNOTATION_LIMITS`/`cleanAnnotation`, `ACTIVITY_LIMITS`/`cleanActivity`, `REVIEW_LIMITS`/`REVIEW_KINDS`/`REVIEW_RATINGS`/`cleanReview`, `POSITION_LIMITS`/`cleanPosition`, `KNOWLEDGE_LIMITS`/`KNOWLEDGE_SOURCES`/`KNOWLEDGE_SOURCE_STRENGTH`/`cleanKnowledge`, `knowledgeArbKey`, `knowledgeArbWins`, `knowledgeArbSql`, `isFsrsCardShape`, `DAILY_SUMMARY_LIMITS`/`DAILY_SUMMARY_DEVICES`/`cleanDailySummary` |
| `companion-data.ts` | `CompanionSnapshot`, `CompanionBatch`, `COMPANION_FIELDS`, `RECEIPT_KINDS`, `receiptIdFor`/`parseReceiptId`, `COMPANION_ARTICLES`, `COMPANION_COATS`/`COMPANION_COAT_IDS`/`resolveCoatId`, `mergeLegacyBaselines`, `mergeCompanionRegister`, `getEquippedItems`, `projectGame`, `projectChests`, `pendingAchievementCredits`, `bestStreak`, `validateCompanionBatch`, `COMPANION_BATCH_LIMIT` (120), `COMPANION_ID_LIMIT` (200) |
| `gamification.ts` | `GameState`, `GameEvent`, `emptyGameState`, `LEVELS`, `levelFor`, `levelProgress`, `XP_REVIEW`, `RARE_ZIPF_BELOW`, `catMood`, `catStageForLevel`, `ACHIEVEMENTS`, `ACHIEVEMENT_FAMILIES`, `familyProgress`, `dayKeyOf`, `daysBetween` |
| `kindle-prefs.ts` | `KindlePrefs`, `DEFAULT_KINDLE_PREFS`, value lists `KINDLE_FONT_FAMILIES`/`_FONT_SIZES`/`_LINE_HEIGHTS`/`_MARGINS`/`_ALIGNS`/`_APPROACHES`/`_LAYOUTS`, `normalizeKindlePrefs`, `prefsFromRow`, `KINDLE_PREF_LABELS`, `KINDLE_PREF_FIELDS`, `KINDLE_PRESETS`, `matchKindlePreset`, `KINDLE_PREVIEW_*` |
| `admin-insights.ts` | `ADMIN_PERIOD_DAYS`, `normalizeAdminDays`, `normalizeTimeZone`, `classifyDevice`, `isTestAccount`, `isRecallHit`, `isVerifiedReview`, `recallPct`, `fsrsStage`, `FSRS_NUM_SQL`, `FSRS_STAGE_SQL`, `KINDLE_GAP_MS`, `Admin*` result types |
| `calibration-bank.ts` | `CALIBRATION_BANK_VERSION` (`es-bank-v3`), `CALIBRATION_BANK_EN_VERSION` (`en-bank-v1`), bands/banks (`CALIBRATION_BANDS_*`, `CALIBRATION_BANK_*`, `ENGLISH_CALIBRATION_BANK`), `calibrationBandsFor`, `calibrationBankFor`, `calibrationBank`, `calibrationBankVersion`, `calibrationBankZipf`, `calibrationSampleContext`, `calibrationFallbackDefinition`; re-exports IRT functions |
| `irt.ts` | `itemResponseProbability`, `itemFisherInformation` |
| `lexicon.ts` | `LexiconEntry`, `hasUsableDefinition`, `measuredZipf`, `isLearnablePos` |
| `english-core-lexicon.ts` | `ENGLISH_CORE_LEXICON`, `getEnglishCoreEntry`, `isCommonEnglishWord` |
| `word-form.ts` | `isWordToken`, `menteBaseForms`, `cliticBaseForms`, `dedupeKey`, `inferContextualPos`, `findLexicalFamily`, `generateLookupCandidates`, `normalizeWordForm` |
| `stopwords.ts` | `SPANISH_STOPWORDS`, `ENGLISH_STOPWORDS`, `isStopword` |
| `epub-check.ts` | `EPUB_MAX_BYTES` (50 MB), `checkEpubHeader`, `checkEpubBuffer` |
| `epub-meta.ts` | `extractEpubMeta`, `extractEpubCover`, `detectBookLanguage`, `isHashLikeIdentifier`, `humanizeFilename` |
| `paper-guide.ts` | `PAPER_GUIDE_VERSION`, `PAPER_GUIDE_MAX_CHAPTERS`, `PAPER_GUIDE_MAX_FORMS_PER_CHAPTER`, `paperGuideSessionKey`, `sanitizePaperBookGuide` |
| `book-genres.ts` | `BOOK_GENRES`, `isBookGenre`, `genreFromSubjects` |
| `plan.ts` | `UserPlan`, `USER_PLANS`, `PLAN_GRACE_MS` (3 días), `hasLectaPlus`, `normalizePlan` (desconocido → `free`), `isStarterCoat`, `effectivePlan` |

## Invariants

- Side-effect free: no network, storage, DOM or database access, and no npm
  package imports. The only runtime API beyond plain JS is the web-standard
  `DecompressionStream` in `[epub-meta.ts]` (ZIP inflate). Safe in both the
  `node` (worker) and `jsdom` (client) Vitest environments.
- `reading-data.ts` cleaners are the single validation point for the sync payloads
  of `/api/{annotations,activity,reviews,positions,knowledge,daily-summaries}`;
  `[reading-data.ts:knowledgeArbSql]` must stay equivalent to
  `[reading-data.ts:knowledgeArbWins]` (weight, timestamp, tombstone, verdict).
- `kindle-prefs.ts` is the only source of Kindle option values and labels for the
  client panel, `/k/ajustes`, `/api/kindle/prefs` and the reader;
  `normalizeKindlePrefs` falls back to `DEFAULT_KINDLE_PREFS` per field.
- `companion-data.ts` derives credits from the `ACHIEVEMENTS` catalog, never from
  the client payload; `validateCompanionBatch` bounds batch size and ids.
- Bumping the visible version means editing `[app-version.ts:APP_VERSION]`
  together with `package.json` and `mcp/package.json`.

## Side Effects

- None.

## Verification

- Run: `pnpm test` (Vitest, `node` environment for `src/shared/**`)
