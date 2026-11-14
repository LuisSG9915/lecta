# src/client/lib

## Overview

Non-React (mostly) client library for Lecta: local persistence in IndexedDB
scoped per account, EPUB parsing and reader position, lexicon lookups and
downloadable dictionary packs, the knowledge/psychometric model (Rasch θ,
FSRS scheduling, learn/review queues), incremental sync with the Worker API,
text-to-speech (system voices, Kitten TTS for English, Piper VITS for es_MX),
the companion cat and gamification, plus settings and UI helpers. UI code in
`src/client/components` and `src/client/hooks` composes these modules.

Test files (`*.test.ts`) and `__fixtures__/` are excluded from this contract.
Uncommitted TTS files (`normalizerEs.ts`, `piperModel.ts`,
`piperPhonemizer.ts`, `piper-plus-g2p.d.ts`) are documented as they exist on
disk.

## Interface

### IndexedDB, account scope and local state

- [idb.ts:DbScope], [idb.ts:captureDbScope], [idb.ts:isDbScopeActive], [idb.ts:StaleScopeError], [idb.ts:withDb], [idb.ts:setDbUser], [idb.ts:getActiveUserId], [idb.ts:resetDbConnection], [idb.ts:deleteAccountDb], [idb.ts:deleteLocalDb], [idb.ts:classifyDbError] - per-account database lifecycle.
- Books: [idb.ts:saveBook], [idb.ts:getStoredBook], [idb.ts:getBookData], [idb.ts:getBookWithData], [idb.ts:listStoredBooks], [idb.ts:listBooks], [idb.ts:updateBookMeta], [idb.ts:deleteStoredBook], [idb.ts:loadLatestBook], [idb.ts:loadShelfBootstrap].
- Positions: [idb.ts:SavedBookPosition], [idb.ts:saveBookPosition], [idb.ts:loadBookPosition], [idb.ts:listPositions].
- Words/annotations/activity/reviews/knowledge: [idb.ts:saveWord], [idb.ts:saveWordWithKnowledge], [idb.ts:listSavedWords], [idb.ts:putSavedWord], [idb.ts:saveAnnotation], [idb.ts:listAnnotations], [idb.ts:saveReadingInterval], [idb.ts:saveReview], [idb.ts:saveKnowledge], [idb.ts:mergeKnowledgeRecords], [idb.ts:mergeKnowledgeWrite], [idb.ts:recordPassiveExposure], [idb.ts:savePreparationBatch], [idb.ts:saveCalibrationBatch].
- Session KV: [idb.ts:saveSessionValue], [idb.ts:loadSessionValue], [idb.ts:listSessionKeys], [idb.ts:isMigratableSessionKey], [idb.ts:isBookScopedSessionKey].
- Book op queue: [idb.ts:enqueueBookOp], [idb.ts:listBookOps], [idb.ts:removeBookOp], [idb.ts:markBookOpError]; runner [book-queue.ts:queueBookUpload], [book-queue.ts:queueBookDelete], [book-queue.ts:runBookQueue].
- Companion event log: [idb.ts:appendCompanionEvents], [idb.ts:commitCompanionEvent], [idb.ts:CompanionEventConflictError], [idb.ts:migrateGameStateV1].
- Lexicon cache: [idb.ts:getCachedLexicon], [idb.ts:saveCachedLexiconBatch], [idb.ts:clearCachedLexicon].
- Backup: [idb.ts:validateBackupPayloadStrict], [idb.ts:restoreBackupToDb]; [export.ts:buildBackup], [export.ts:inspectBackupPayload], [export.ts:restoreBackupPayload], [export.ts:downloadBackup], [export.ts:wordsToAnkiTsv], [export.ts:fullNotebookToMarkdown].
- Account: [account-fetch.ts:accountFetch], [account-fetch.ts:registerAccountResetHandler], [account-reset.ts:checkRemoteReset], [account-reset.ts:applyRemoteReset], [account-reset.ts:startFromScratch], [account-cleanup.ts:decidePendingDelete], [account-cleanup.ts:clearAccountLocalKeys], [last-user.ts:loadLastUserId], [auth.ts:authClient], [ai-pref.ts:loadUseAi].

### EPUB, reader position and reading surface

- [epub.ts:openEpub], [epub.ts:createEpubLoader], [epub.ts:extractChapters], [epub.ts:detectBookLanguage], [epub.ts:injectReaderStyles], [sanitize.ts:sanitizeSectionDocument], [sanitize.ts:isSafeInternalEpubHref].
- [reading-location.ts:viewTopAnchor], [reading-location.ts:scrollToAnchor], [reading-location.ts:keepAnchorStable], [reading-location.ts:scrollToFragment], [reading-location.ts:getBookLocation], [reading-location.ts:saveBookLocation].
- [book-start.ts:resolveEntryTarget], [book-start.ts:loadBookStart], [book-start.ts:saveBookStart].
- [pagination.ts:pageLayout], [pagination.ts:pageForText], [pagination.ts:buildFragmentPageMap], [page-gesture.ts:tapZone], [page-gesture.ts:swipeOutcome], [use-page-gesture.ts:usePageGesture], [scroll-fragments.ts:activeFragmentAt].
- [chapters.ts:buildChapterCatalog], [chapters.ts:suggestedChapterTarget], [chapter-analysis.ts:createChapterAnalyzer], [chapter-follow.ts:saveChapterFollowAnswer], [mid-chapter-recall.ts:pickMidChapterRecall], [page-recap.ts:requestPageRecap], [character-helper.ts:getCharactersOnPageWithoutSpoilers].
- Text hit-testing and marks: [words.ts:extractWordAtPoint], [words.ts:sentenceRangeForHit], [tap-intent-guard.ts:validateTapIntent], [tap-intent-guard.ts:classifySelection], [marks.ts:applyChapterMarks], [passage-marks.ts:applyPassageMarks], [annotations.ts:mergeAnnotation], [annotations.ts:makePassage].
- Reading aids: [paragraph-focus.ts:focusBlock], [syntactic-lines.ts:applySyntacticLines], [deep-reading.ts:requestScreenWakeLock], [focus-telemetry.ts:evaluateReadingFatigue], [translate.ts:translateParagraph], [fullscreen.ts:toggleFullscreen].
- Books and covers: [books.ts:uploadBook], [books.ts:downloadBook], [books.ts:attachCommunityBook], [cover.ts:bookDisplayName], [cover.ts:coverPalette], [book-search.ts:searchBookSections], [book-search.ts:searchBookSpoilerFree], [catalog.ts:listCatalog], [catalog.ts:downloadCatalogEpub], [paper-guide.ts:buildPaperBookGuide], [paper-reading.ts:savePaperReading].
- Progress: [progress.ts:bookProgress], [progress.ts:minutesLeft], [reading-activity.ts:mergeIntervals], [reading-events.ts:trackReadingEvent], [reading-goal.ts:weeklyGoalProgress], [reader-presence.ts:useReaderPresence].

### Lexicon and dictionary packs

- [lexicon.ts:lookupWord], [lexicon.ts:batchLookup], [lexicon.ts:enrichWord], [lexicon.ts:enrichBatch], [lexicon.ts:explainInContext], [lexicon.ts:explainInPassage], [lexicon.ts:requestCharacterRecap], [lexicon.ts:fetchItems], [lexicon.ts:verifySentence], [lexicon.ts:primeLexiconMemoryCache].
- [dictionaryPack.ts:DICTIONARY_PACKS], [dictionaryPack.ts:ensureDictionaryPack], [dictionaryPack.ts:lookupDictionaryPack], [dictionaryPack.ts:dictionaryPackStatus].
- [offline-dictionary.ts:precacheBookDictionary], [offline-dictionary.ts:prefetchUpcomingChaptersLexicon], [book-vocab.ts:buildBookVocabManifest], [book-vocab.ts:analyzeStoredBook], [catalog.ts:LEXICON_CATALOG_REV], [phrases.ts:buildPhraseIndex], [phrases.ts:matchPhrase], [phrases.ts:applyPhraseMarks], [glossary.ts:extractGlossaryTerms], [book-glossary.ts:recordBookConsultedWord], [segmenter.ts:extractUniqueWords], [search-text.ts:normalizeSearchText], [word-meanings.ts:backfillWordMeanings], [enrichment-candidates.ts:selectEnrichmentCandidates], [grammar.ts:GRAMMAR_CATEGORIES].

### Knowledge, psychometrics, FSRS and learning

- [profile-models.ts:betaFromZipf], [profile-models.ts:loadUserLanguageProfile], [profile-models.ts:saveUserLanguageProfile], [profile-models.ts:predictWordMasteryProbability], [profile-models.ts:migrateLegacyTheta], [profile-models.ts:estimateProfile].
- [knowledge.ts:predictSection], [knowledge.ts:resolveEvidence], [knowledge.ts:applyWordPanelLookupSignal], [knowledge.ts:markWordStatus], [knowledge.ts:computeRequiredDwellMs], [reader-evidence.ts:checkPassiveExposure].
- [calibration.ts:initCatSession], [calibration.ts:submitCatAnswer], [calibration.ts:selectNextCatItem], [calibration.ts:needsLanguageCalibration], [calibration.ts:fetchCalibrationSample].
- [fsrs.ts:scheduleReview], [fsrs.ts:newCard], [fsrs.ts:isDue], [fsrs.ts:isReviewDueWord], [fsrs.ts:loadRetentionHorizon]; [reviews.ts:recordReview], [reviews.ts:consolidateEpisodicWord].
- [learn.ts:reviewQueue], [learn.ts:learnQueue], [learn.ts:isLearnPending], [learn.ts:evaluateSentenceLocally], [learn.ts:generateMicroStoryWithAi]; [notebook-model.ts:isEligible], [notebook-model.ts:wordStage], [notebook-model.ts:matchesFilter]; [practice.ts:buildAdaptivePracticeQueue], [practice.ts:buildPostChapterConsolidationQueue], [practice.ts:generateClozeOptions]; [episodic-cloze.ts:episodicClozeOptions].
- [preparation.ts:decidePreparation], [preparation.ts:confirmPreparation], [preparation-rows.ts:buildChapterSuggestionRows], [section-words.ts:buildSuggestionRows], [section-words.ts:nextChapterUtility], [attention-budget.ts:computeAttentionBudget], [coverage.ts:coverageOfBook], [word-level.ts:classifyWordLevel], [vocab-level.ts:vocabLevelOf].
- Journey: [journey.ts:literaryRankFor], [journey.ts:computeLanguageLexicalGrowth], [journey-insights.ts:readingHabits], [journey-insights.ts:upcomingReviews], [tips.ts:composeTip], [tips.ts:loadDailyTip], [habitWindow.ts:calculateHabitWindow].

### Sync (`*-sync.ts` and helpers)

- [positions-sync.ts:syncPositions], [positions-sync.ts:pushPosition], [positions-sync.ts:flushPendingPositions].
- [reading-sync.ts:syncAnnotations], [reading-sync.ts:syncActivity], [reading-sync.ts:syncReviews], [reading-sync.ts:syncKnowledge], [reading-sync.ts:scheduleReadingSyncPush], [reading-sync.ts:pullMissingUserBooksFromCloud], [reading-sync.ts:forceFullResyncFromServer].
- [vocab.ts:syncSavedWords], [vocab.ts:pushWordsToServer], [vocab.ts:saveVocabEntry], [vocab.ts:removeVocabEntry].
- [companion-sync.ts:syncCompanion], [companion-sync.ts:scheduleCompanionSync], [companion-sync.ts:pushCompanionChanges].
- [sync-cursors.ts:getSyncCursor], [sync-cursors.ts:advanceSyncCursor], [sync-cursors.ts:advanceSyncCompoundCursor], [sync-cursors.ts:resetPullCursors], [sync-push.ts:maxStamp], [sync-state.ts:getSyncState], [sync-state.ts:useSyncState], [sync-state.ts:scheduleSyncRetry], [sync-state.ts:pauseSync], [daily-summary.ts:pushDailySummaries].

### TTS (`tts*`, `kitten*`, `piper*`, `normalizerEs`)

- Controller: [ttsController.ts:createTtsController], [ttsController.ts:playSentencesLoop], [ttsController.ts:stopAllTtsPlayback], [ttsController.ts:TtsAudioController]; types [ttsTypes.ts:TtsSnapshot], [ttsTypes.ts:TtsEngineMode], [ttsTypes.ts:KITTEN_VOICES], [ttsTypes.ts:TTS_RATES].
- System voices: [ttsSpeech.ts:createSpeaker], [ttsSpeech.ts:pickVoiceForLanguage], [ttsSpeech.ts:splitForSpeech], [ttsSpeech.ts:speakWithSystemVoice], [speech.ts:speakWord].
- Sentences/marks: [ttsSentences.ts:buildSentenceMap], [ttsSentences.ts:sentenceFingerprint], [ttsMarks.ts:markSentence], [ttsGuards.ts:withTtsProgrammaticNav], [tts-landing.ts:saveTtsLandingPosition], [tts-landing.ts:applyTtsLandingMarker].
- Settings/consent: [ttsSettings.ts:loadTtsSettings], [ttsSettings.ts:hasKittenConsent], [ttsSettings.ts:setKittenConsent], [ttsSettings.ts:isTtsSupported].
- Neural engine: [kittenTtsEngine.ts:KittenTtsEngine], [kittenTtsEngine.ts:getKittenTtsEngine], [kittenTtsEngine.ts:neuralModelConfig], [kittenTtsEngine.ts:downloadKittenModel], [kittenTtsEngine.ts:isKittenModelCached], [kittenTtsEngine.ts:sanitizeAudioSamples], [kittenTtsEngine.ts:PIPER_INFERENCE_TIMEOUT_MS].
- Kitten (English): [kittenModel.ts:KITTEN_MODEL_URL], [kittenModel.ts:KITTEN_MODEL_SHA256], [kittenModel.ts:KITTEN_CACHE_NAME], [kittenModel.ts:LEGACY_KITTEN_CACHE_NAMES], [kittenNormalize.ts:normalizeEnglishText], [kittenPhonemizer.ts:prepareKittenInputIds], [kittenPhonemizer.ts:phonemizeText], [kittenVoicesData.ts:getVoiceEmbedding], [kittenVoicesData.ts:loadVoicesFromNpz].
- Piper (es_MX, uncommitted): [piperModel.ts:PIPER_MODEL_URL], [piperModel.ts:PIPER_CONFIG_URL], [piperModel.ts:PIPER_MODEL_SHA256], [piperModel.ts:PIPER_MODEL_BYTES], [piperModel.ts:PIPER_CACHE_NAME], [piperModel.ts:PIPER_VOICE_ID]; [piperPhonemizer.ts:textToPiperIds], [piperPhonemizer.ts:parsePiperModelConfig], [piperPhonemizer.ts:PiperModelConfig]; [normalizerEs.ts:normalizeSpanishText], [normalizerEs.ts:numberToSpanishWords], [normalizerEs.ts:ordinalToSpanishWords], [normalizerEs.ts:romanToNumber], [normalizerEs.ts:applyMexicanXExceptions]; ambient types [piper-plus-g2p.d.ts:SpanishG2P], [piper-plus-g2p.d.ts:Encoder].

### Companion and game

- [game.ts:award], [game.ts:loadGame], [game.ts:subscribeGame], [game.ts:openGameChest], [game.ts:awardEpisodicConsolidation]; [gamification.ts] re-exports `src/shared/gamification`.
- [companion-state.ts:reduceCompanion], [companion-presence.ts:createPresence], [companion-stage.ts:classifyGesture], [companion-interactions.ts:startCare], [companion-closet.ts:closetRequirement], [companion-inbox.ts:pendingCelebrations], [companion-portrait.ts:buildPortraitPng], [companion-audio.ts:playCompanionSound], [cat-motion.ts:applyCatMotion], [companionNotification.ts:buildCompanionNotification], [localNotificationScheduler.ts:scheduleHabitReminder], [quote-card.ts:generateQuoteCardBlob], [haptics.ts:triggerHaptic].

### Misc

- [settings.ts:loadReaderSettings], [settings.ts:saveReaderSettings], [settings.ts:applyTheme], [settings.ts:readerCssVars], [settings.ts:loadFeatureFlags], [settings.ts:READING_PRESETS].
- [sw-register.ts:registerServiceWorker], [sw-register.ts:shouldAllowReload], [sw-register.ts:PERSISTENT_DLC_CACHE_NAMES], [css-guard.ts:initCssGuard], [client-errors.ts:installClientErrorReporting], [client-errors.ts:reportClientError].
- [history.ts:pushOverlay], [modal.ts:useModalBehavior], [view-transition.ts:startSafeViewTransition], [relative-time.ts:timeAgo], [hash.ts:sha256Hex].

## Invariants

- Per-account IndexedDB: database name is `lecta:u:<userId>`, or `lecta` when anonymous ([idb.ts:dbNameFor], `DB_VERSION = 10`). Multi-step operations capture a [idb.ts:DbScope] before the first `await` and pass it through; [idb.ts:withDb] with a stale scope opens a private connection to the owning database, and remote calls with a stale scope throw [idb.ts:StaleScopeError]. Nothing is pushed under the newly activated account.
- Account transitions are serialized (`transitionPromise` in `idb.ts`); `dbGeneration` increases on every switch so an A→B→A scope still reads as stale.
- Sync cursors only advance ([sync-cursors.ts] header): push cursor advances to the max server-confirmed stamp ([sync-push.ts:maxStamp]), never to `Date.now()`; pull cursor advances to server `nextCursor`/`serverTime`.
- Position pull merge ([positions-sync.ts:syncPositions]): a valid remote `anchorOffset` (finite, 0..1) wins; otherwise the local `anchorOffset` is kept only when the remote row points to the same anchor.
- [reading-location.ts:keepAnchorStable] corrects drift for `ANCHOR_KEEP_MS = 2_500` with a `ANCHOR_SETTLE_MS = 400` per-frame window (extended `MEDIA_LATE_REFLOW_MS` for late media).
- Single Rasch scale: [profile-models.ts:betaFromZipf] returns `4.0 - zipf` clamped to [-3.0, 3.5], `0.5` when zipf is missing.
- [fsrs.ts:isReviewDueWord] requires prior exposure (`card.reps > 0` or `presentedAt > 0`) and excludes deleted words; [learn.ts:reviewQueue] feeds review sessions and free modes.
- Downloaded binaries are verified before persisting: dictionary packs check SHA-256 against [dictionaryPack.ts:DICTIONARY_PACKS] and the header line `#lecta-dict v<version> <lang>` before writing, and the install meta is written last; neural models are cached only when SHA-256 matches ([kittenTtsEngine.ts:KittenTtsEngine], stamp header `x-model-sha256`).
- Model URLs and cache names are versioned because `/models/*` is served `immutable`: changing a model requires a new URL and cache name ([kittenModel.ts:KITTEN_CACHE_NAME], [piperModel.ts:PIPER_CACHE_NAME]). Kitten serves English and Piper serves Spanish ([kittenTtsEngine.ts:neuralModelConfig]).
- [piperPhonemizer.ts:textToPiperIds] always runs [normalizerEs.ts:normalizeSpanishText] first and returns `[]` when nothing pronounceable remains; its `Encoder` is reused only while the same `phoneme_id_map` object is passed.
- [books.ts:registerBookMeta] registers a free account's own EPUB with metadata only (`PUT /api/user/books/:hash/meta`); [book-queue.ts:queueBookSync] always queues `meta` and, with Lecta+, `upload`. A 402 on upload returns `null` (op leaves the queue); [books.ts:downloadBookWithStatus] exposes the 402 so App opens the attach sheet. [epub-intake.ts:checkEpubFile] / `matchAttachedEpub` validate size, header and full buffer, then pair by exact `sha256Hex`.
- [lexicon.ts:explainInPassage] and `fetchItems` return `code: "LECTA_PLUS_REQUIRED"` on a 402.
- [account-plan.ts:planStore] is the single client store for the account plan: `useUserPlan()` reads it (`null` = unknown, no gating), only App writes it (`checkRemoteReset` → `savePlan`, `runFullSync`, `pollPlanUntilPlus` on `?carne=1`). Cache per account in session KV `account:plan:v1:<userId>`. `claimStarterCoat` claims `lecta:gato` once via `PUT /api/account/starter-coat`.
- [companion-closet.ts:closetRequirement] takes an optional `ClosetPlanContext`: order starter coat → plan (`{kind: "plan", text: "Lecta+"}` in `free`, except `chaleco`) → owned → level/achievement; `planOwnedArticles` filters what `free` can wear.
- [account-fetch.ts:accountFetch] is the scoped fetch path for account APIs (used by `vocab.ts`, `reading-sync.ts`, `companion-sync.ts`, `lexicon.ts`).

## Side Effects

- IndexedDB: per-account `lecta` / `lecta:u:<id>` stores (`books`, `positions`, `session`, `savedWords`, `annotations`, `activity`, `reviews`, `knowledge`, `readingEvents`, `bookOps`, `companionEvents`, `companionReceipts`, `lexiconCache`) in [idb.ts]; shared per-language `lecta-dict-<lang>` in [dictionaryPack.ts].
- CacheStorage: neural model binaries in `KITTEN_CACHE_NAME` / `PIPER_CACHE_NAME` ([kittenTtsEngine.ts:KittenTtsEngine]); service worker registration and cache handling in [sw-register.ts:registerServiceWorker].
- localStorage: sync cursors under `lecta_sync_cursors_v1:<userId>` ([sync-cursors.ts]), account keys `lecta:pending-delete`, `lecta:account-reset:<userId>` and others cleared by [account-cleanup.ts:clearAccountLocalKeys]; settings in [settings.ts].
- Network: `/api/positions` ([positions-sync.ts]); `/api/annotations`, `/api/activity`, `/api/reviews`, `/api/knowledge`, `/api/user/books/<id>/file` ([reading-sync.ts]); `/api/vocab` ([vocab.ts]); `/api/companion` ([companion-sync.ts]); `/api/lexicon/*` and `/api/ai/*` ([lexicon.ts]); `/api/client-errors` ([client-errors.ts:CLIENT_ERROR_ENDPOINT]); pack and model downloads from `/dict/` and `/models/`.
- Web Worker: [kittenTtsEngine.ts:KittenTtsEngine] spawns the inference worker (`src/client/workers/kitten-tts.worker.ts`).
- DOM and browser APIs: reader marks and focus classes ([marks.ts], [ttsMarks.ts], [paragraph-focus.ts], [syntactic-lines.ts]), scroll restoration ([reading-location.ts]), Web Speech ([ttsSpeech.ts]), Web Audio ([companion-audio.ts]), wake lock and fullscreen ([deep-reading.ts], [fullscreen.ts]), notifications and app badge ([localNotificationScheduler.ts]), history entries ([history.ts:pushOverlay]).

## Verification

- Run: `pnpm test`
- Targeted: `pnpm vitest run src/client/lib`
