import type { WordHit } from "../../lib/words";
import type { SavedWord, KnownWord } from "../../lib/idb";
import type { SearchSection } from "../../lib/book-search";
import type { DeepReadingSummary, DeepReadingConfig } from "../../lib/deep-reading";
import type { ConsolidationModality, EpisodicWordItem } from "../../lib/practice";
import { isFeatureFlagEnabled, type StrategyPreset } from "../../lib/settings";
import type { TtsEngineMode } from "../../lib/ttsTypes";
import type { PageRecapResult } from "../../lib/page-recap";
import type { ChapterTarget } from "../../lib/chapters";
import type { PreparationAnswers } from "../../lib/preparation";

import WordPanel from "../WordPanel";
import SectionPreview, { type SectionPreviewRow } from "../SectionPreview";
import QuoteCardModal from "../QuoteCardModal";
import DeepReadingModal from "../DeepReadingModal";
import DeepReadingSummaryModal from "../DeepReadingSummaryModal";
import BookGlossaryModal from "../BookGlossaryModal";
import TtsConsentDialog from "../TtsConsentDialog";
import ReaderMoreMenu from "../ReaderMoreMenu";
import Dialog from "../Dialog";
import Icon from "../Icon";

export interface PrepState {
  target: ChapterTarget;
  analysis: "loading" | "ready" | "error";
  rows: SectionPreviewRow[];
  uncertain: SectionPreviewRow[];
  deferred: SectionPreviewRow[];
  answers: PreparationAnswers;
  saving: boolean;
}

export interface QuoteCardState {
  text: string;
  bookTitle?: string;
  author?: string;
  chapterTitle?: string;
  alreadySaved?: boolean;
}

export interface PageRecapState {
  loading: boolean;
  data: PageRecapResult | null;
  error: string | null;
}

export interface CatPassageExplanationState {
  passage: string;
  word?: string;
  dictEntry?: {
    lemma: string;
    pos?: string | null;
    definition: string;
  } | null;
  loading: boolean;
  data: {
    contextualMeaning: string;
    toneAndNuance: string;
    catTip: string;
    directMeaning?: string;
  } | null;
  error: string | null;
}

export interface ReaderOverlaysProps {
  bookHash: string;
  bookTitle?: string;
  author?: string;
  language?: string;
  sectionIndex?: number;
  signedIn?: boolean;

  // WordPanel
  selection: WordHit | null;
  onCloseSelection: () => void;
  onWordSaved?: (word: SavedWord) => void;
  onWordRemoved?: (word: SavedWord) => void;
  onKnowledgeChanged?: (
    row: KnownWord,
    opts: { form: string; kind: "saved" | "declared" },
  ) => void;
  bookSections?: SearchSection[];
  toc?: Array<{ index: number; label: string }>;
  charOffsetInChapter?: number;
  currentChapterTitle?: string;
  currentChapterId?: string;
  compactMode?: boolean;
  wordCapsuleHost?: HTMLElement | null;

  // SectionPreview
  prep: PrepState | null;
  onRowsPresented?: (rows: SectionPreviewRow[]) => void;
  onAnswerPrep?: (lemma: string, answer: "known" | "unknown") => void;
  onConfirmPrep?: () => void;
  onSkipPrep?: () => void;
  onRetryPrep?: () => void;
  onClosePrep?: () => void;
  onDiscardPrep?: () => void;
  initialStrategy?: StrategyPreset;
  onSelectStrategy?: (preset: StrategyPreset) => void;
  onMarkKnown?: (lemma: string, beta: number) => void;
  onSaveToPractice?: (lemma: string, beta: number) => void;
  onMuteForBook?: (id: string) => void;
  onDisableGlobally?: () => void;
  onStartReading?: () => void;

  // QuoteCardModal
  quoteCard: QuoteCardState | null;
  onCloseQuoteCard: () => void;
  onSaveQuoteCardPassage?: (text: string) => void;

  // DeepReadingModal
  deepModal?: boolean;
  onStartDeepReading?: (config: DeepReadingConfig) => void;
  onCloseDeepModal?: () => void;

  // DeepReadingSummaryModal
  deepSummary?: DeepReadingSummary | null;
  postChapterQueue?: Array<{ item: EpisodicWordItem; modality: ConsolidationModality }>;
  onShareDeepSummaryQuote?: (quote?: string) => void;
  onContinueDeepSummary?: () => void;
  onCloseDeepSummary?: () => void;
  onWordConsolidated?: (word: SavedWord) => void;

  // BookGlossaryModal
  glossaryOpen?: boolean;
  onCloseGlossary?: () => void;
  onSelectGlossaryTerm?: (word: string) => void;
  onGlossaryWordSaved?: (word: SavedWord) => void;

  // TtsConsentDialog
  ttsConsentOpen?: boolean;
  onTtsConsentAccept?: (engine?: TtsEngineMode) => void;
  onTtsConsentDismiss?: () => void;
  ttsDownloadProgress?: number | null;
  isKittenModelDownloaded?: boolean;
  onDeleteTtsModel?: () => void;

  // PageRecap Dialog
  pageRecap?: PageRecapState | null;
  onClosePageRecap?: () => void;

  // CatPassageExplanation Dialog
  catPassageExplanation?: CatPassageExplanationState | null;
  onCloseCatExplanation?: () => void;

  // Standalone ReaderMoreMenu
  moreMenuOpen?: boolean;
  onCloseMoreMenu?: () => void;
  onSearch?: () => void;
  onOpenNotebook?: () => void;
  onCreateQuoteCard?: () => void;
  onExportBook?: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  fullscreenSupported?: boolean;
}

export function ReaderOverlays({
  bookHash,
  bookTitle,
  author,
  language = "es",
  sectionIndex = 0,
  signedIn = false,

  selection,
  onCloseSelection,
  onWordSaved,
  onWordRemoved,
  onKnowledgeChanged,
  bookSections,
  toc,
  charOffsetInChapter = 0,
  currentChapterTitle,
  currentChapterId,
  compactMode = false,
  wordCapsuleHost = null,

  prep,
  onRowsPresented,
  onAnswerPrep,
  onConfirmPrep,
  onSkipPrep,
  onRetryPrep,
  onClosePrep,
  onDiscardPrep,
  initialStrategy,
  onSelectStrategy,
  onMarkKnown,
  onSaveToPractice,
  onMuteForBook,
  onDisableGlobally,
  onStartReading,

  quoteCard,
  onCloseQuoteCard,
  onSaveQuoteCardPassage,

  deepModal = false,
  onStartDeepReading,
  onCloseDeepModal,

  deepSummary = null,
  postChapterQueue = [],
  onShareDeepSummaryQuote,
  onContinueDeepSummary,
  onCloseDeepSummary,
  onWordConsolidated,

  glossaryOpen = false,
  onCloseGlossary,
  onSelectGlossaryTerm,
  onGlossaryWordSaved,

  ttsConsentOpen = false,
  onTtsConsentAccept,
  onTtsConsentDismiss,
  ttsDownloadProgress,
  isKittenModelDownloaded = false,
  onDeleteTtsModel,

  pageRecap = null,
  onClosePageRecap,

  catPassageExplanation = null,
  onCloseCatExplanation,

  moreMenuOpen = false,
  onCloseMoreMenu,
  onSearch,
  onOpenNotebook,
  onCreateQuoteCard,
  onExportBook,
  onToggleFullscreen,
  isFullscreen = false,
  fullscreenSupported = false,
}: ReaderOverlaysProps) {
  return (
    <>
      {prep && isFeatureFlagEnabled("chapterPriming") ? (
        <SectionPreview
          mode="modal"
          title={prep.target.label}
          chapterTitle={prep.target.label}
          bookId={bookHash}
          bookLang={language}
          analysis={prep.analysis}
          rows={prep.rows}
          uncertainRows={prep.uncertain}
          deferredRows={prep.deferred}
          onRowsPresented={onRowsPresented ?? (() => {})}
          answers={prep.answers}
          saving={prep.saving}
          onAnswer={onAnswerPrep ?? (() => {})}
          onConfirm={onConfirmPrep ?? (() => {})}
          onSkip={onSkipPrep ?? (() => {})}
          onRetry={onRetryPrep ?? (() => {})}
          onClose={onClosePrep ?? (() => {})}
          onDiscard={onDiscardPrep ?? (() => {})}
          initialStrategy={initialStrategy}
          onSelectStrategy={onSelectStrategy}
          onMarkKnown={onMarkKnown}
          onSaveToPractice={onSaveToPractice}
          onMuteForBook={onMuteForBook}
          onDisableGlobally={onDisableGlobally}
          onStartReading={onStartReading ?? (() => {})}
        />
      ) : null}

      {selection ? (
        <WordPanel
          key={selection.word}
          word={selection.word}
          context={selection.context}
          phrase={selection.phrase}
          canExplain={signedIn}
          language={language}
          bookHash={bookHash}
          bookTitle={bookTitle}
          author={author}
          sections={bookSections}
          toc={toc}
          currentSectionIndex={sectionIndex}
          charOffsetInChapter={charOffsetInChapter}
          currentChapterTitle={currentChapterTitle}
          compactMode={compactMode}
          capsuleHost={wordCapsuleHost}
          onClose={onCloseSelection}
          onSaved={onWordSaved}
          onRemoved={onWordRemoved}
          onKnowledgeChanged={onKnowledgeChanged}
        />
      ) : null}

      {pageRecap && onClosePageRecap ? (
        <Dialog
          label="Recuperar el hilo"
          onClose={onClosePageRecap}
          className="dialog--page-recap"
        >
          <div className="sheet-head">
            <h2 className="sheet-title">
              <span aria-hidden="true" style={{ display: "inline-flex", verticalAlign: "middle", marginRight: "var(--s-1)" }}>
                <Icon name="journey" size={16} />
              </span>
              Recuperar el hilo
            </h2>
            <button
              type="button"
              className="btn--quiet"
              onClick={onClosePageRecap}
              aria-label="Cerrar hilo"
            >
              Cerrar
            </button>
          </div>

          {pageRecap.loading ? (
            <div className="cat-passage-loading">
              <span className="cat-spinner" aria-hidden="true">
                <Icon name="journey" size={20} />
              </span>
              <p className="meta">Reconstruyendo el hilo de atención de esta página…</p>
            </div>
          ) : pageRecap.data ? (
            <div className="page-recap-content">
              <ul className="page-recap-bullets">
                {pageRecap.data.bullets.map((b, idx) => (
                  <li key={idx} className="page-recap-bullet">
                    <span className="bullet-dot" aria-hidden="true">
                      •
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              {pageRecap.data.hookQuestion ? (
                <div className="page-recap-hook">
                  <span className="hook-icon" aria-hidden="true">
                    <Icon name="sparkles" size={16} />
                  </span>
                  <p className="hook-text">
                    <em>{pageRecap.data.hookQuestion}</em>
                  </p>
                </div>
              ) : null}
              <div
                className="page-recap-actions"
                style={{ marginTop: "1rem", textAlign: "right" }}
              >
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={onClosePageRecap}
                  autoFocus
                >
                  Continuar leyendo →
                </button>
              </div>
            </div>
          ) : (
            <p role="alert" className="status">
              {pageRecap.error ?? "No se pudo recuperar el hilo."}
            </p>
          )}
        </Dialog>
      ) : null}

      {catPassageExplanation && onCloseCatExplanation ? (
        <Dialog
          label={catPassageExplanation.word ? `Apunte: «${catPassageExplanation.word}»` : "El apunte del Gato"}
          onClose={onCloseCatExplanation}
          className="dialog--cat-explanation"
        >
          <div className="sheet-head">
            <h2 className="sheet-title">
              <span className="cat-dialog-avatar" aria-hidden="true" style={{ display: "inline-flex", verticalAlign: "middle", marginRight: "var(--s-1)" }}>
                <Icon name="sparkles" size={16} />
              </span>{" "}
              {catPassageExplanation.word ? `Apunte: «${catPassageExplanation.word}»` : "El apunte del Gato"}
            </h2>
            <button
              type="button"
              className="btn--quiet"
              onClick={onCloseCatExplanation}
              aria-label="Cerrar apunte"
            >
              Cerrar
            </button>
          </div>

          <div className="cat-passage-quote">“{catPassageExplanation.passage}”</div>

          {/* Bloque 1: Diccionario Offline Instantáneo */}
          {catPassageExplanation.word || catPassageExplanation.dictEntry ? (
            <div className="cat-explanation-dict-block" data-testid="cat-explanation-dict-block">
              {catPassageExplanation.dictEntry ? (
                <>
                  <div className="cat-explanation-dict-header">
                    <span className="cat-explanation-dict-lemma">{catPassageExplanation.dictEntry.lemma}</span>
                    {catPassageExplanation.dictEntry.pos ? (
                      <span className="cat-explanation-dict-pos">{catPassageExplanation.dictEntry.pos}</span>
                    ) : null}
                    <span className="cat-explanation-dict-badge">Diccionario</span>
                  </div>
                  <p className="cat-explanation-dict-definition">
                    {catPassageExplanation.dictEntry.definition}
                  </p>
                </>
              ) : catPassageExplanation.loading ? (
                <div className="cat-explanation-dict-skeleton" aria-hidden="true">
                  <div className="cat-skeleton-line cat-skeleton-line--short" />
                  <div className="cat-skeleton-line" />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Bloque 2: Matiz Contextual del Gato */}
          {catPassageExplanation.loading ? (
            <div className="cat-passage-loading">
              <span className="cat-spinner" aria-hidden="true">
                <Icon name="sparkles" size={20} />
              </span>
              <p className="meta">El gato está leyendo con atención el pasaje…</p>
            </div>
          ) : catPassageExplanation.data ? (
            <div className="cat-passage-result cat-explanation-nuance-block" data-testid="cat-explanation-nuance-block">
              <div className="passage-badge-tone-row">
                <span className="passage-badge-tone">
                  {catPassageExplanation.data.toneAndNuance}
                </span>
                <span className="cat-nuance-badge">Matiz en contexto</span>
              </div>
              {!catPassageExplanation.dictEntry && catPassageExplanation.data.directMeaning ? (
                <p className="passage-direct-meaning-text">
                  {catPassageExplanation.data.directMeaning}
                </p>
              ) : null}
              <p className="passage-meaning-text">
                {catPassageExplanation.data.contextualMeaning}
              </p>
              <div className="cat-literary-tip">
                <span className="cat-tip-icon" aria-hidden="true">
                  <Icon name="sparkles" size={16} />
                </span>
                <p className="cat-tip-text">
                  <em>Michi:</em> «{catPassageExplanation.data.catTip}»
                </p>
              </div>
            </div>
          ) : (
            <p role="alert" className="status">
              {catPassageExplanation.error ?? "No se pudo obtener la explicación."}
            </p>
          )}
        </Dialog>
      ) : null}

      {quoteCard ? (
        <QuoteCardModal
          text={quoteCard.text}
          bookTitle={quoteCard.bookTitle ?? bookTitle}
          author={quoteCard.author ?? author}
          chapterTitle={quoteCard.chapterTitle ?? currentChapterTitle}
          alreadySaved={quoteCard.alreadySaved}
          onClose={onCloseQuoteCard}
          onSavePassage={
            quoteCard.alreadySaved || !onSaveQuoteCardPassage
              ? undefined
              : () => onSaveQuoteCardPassage(quoteCard.text)
          }
        />
      ) : null}

      {deepModal && onStartDeepReading && onCloseDeepModal ? (
        <DeepReadingModal onStart={onStartDeepReading} onClose={onCloseDeepModal} />
      ) : null}

      {deepSummary && onCloseDeepSummary ? (
        <DeepReadingSummaryModal
          summary={deepSummary}
          consolidationQueue={postChapterQueue}
          bookId={bookHash}
          bookTitle={bookTitle}
          author={author}
          chapterTitle={currentChapterTitle}
          chapterId={currentChapterId}
          onShareQuote={onShareDeepSummaryQuote}
          onContinue={onContinueDeepSummary}
          onClose={onCloseDeepSummary}
          onWordConsolidated={onWordConsolidated}
        />
      ) : null}

      {glossaryOpen && onCloseGlossary && onSelectGlossaryTerm ? (
        <BookGlossaryModal
          bookHash={bookHash}
          bookTitle={bookTitle}
          language={language}
          onClose={onCloseGlossary}
          onSelectTerm={onSelectGlossaryTerm}
          onWordSaved={onGlossaryWordSaved}
        />
      ) : null}

      {ttsConsentOpen && onTtsConsentAccept && onTtsConsentDismiss ? (
        <TtsConsentDialog
          onAccept={onTtsConsentAccept}
          onDismiss={onTtsConsentDismiss}
          downloadProgress={ttsDownloadProgress}
          isModelDownloaded={isKittenModelDownloaded}
          onDeleteModel={onDeleteTtsModel}
        />
      ) : null}

      {moreMenuOpen && onCloseMoreMenu && onSearch ? (
        <ReaderMoreMenu
          isOpen={true}
          onClose={onCloseMoreMenu}
          onSearch={onSearch}
          onOpenGlossary={() => {
            onCloseMoreMenu();
            onSelectGlossaryTerm?.("");
          }}
          onOpenNotebook={onOpenNotebook}
          onCreateQuoteCard={onCreateQuoteCard}
          onExportBook={onExportBook}
          bookHash={bookHash}
          language={language}
          onToggleFullscreen={onToggleFullscreen}
          isFullscreen={isFullscreen}
          fullscreenSupported={fullscreenSupported}
        />
      ) : null}
    </>
  );
}

export default ReaderOverlays;
