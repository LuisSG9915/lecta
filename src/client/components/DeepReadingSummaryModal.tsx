import { useMemo, useState } from "react";
import Dialog from "./Dialog";
import { triggerHaptic, type DeepReadingSummary } from "../lib/deep-reading";
import { useCompanionSafe } from "./CompanionProvider";
import { Companion } from "./Companion";
import type { ConsolidationModality, EpisodicWordItem } from "../lib/practice";
import {
  isConsolidationActive,
  muteConsolidationForBook,
  disableConsolidationGlobally,
  awardEpisodicConsolidation,
} from "../lib/game";
import { SentenceBuilderGame } from "./SentenceBuilderGame";
import { WordScrambleGame } from "./WordScrambleGame";
import { consolidateEpisodicWord, type EpisodicOutcome } from "../lib/reviews";
import type { SavedWord } from "../lib/idb";
import Icon from "./Icon";
import { isFeatureFlagEnabled } from "../lib/settings";
import {
  CHAPTER_FOLLOW_OPTIONS,
  saveChapterFollowAnswer,
  type ChapterFollowLevel,
} from "../lib/chapter-follow";

export interface DeepReadingSummaryModalProps {
  summary: DeepReadingSummary;
  consolidationQueue?: Array<{ item: EpisodicWordItem; modality: ConsolidationModality }>;
  onStartConsolidation?: () => void;
  onContinue?: () => void;
  onClose: () => void;
  bookId?: string;
  onSkipConsolidation?: () => void;
  harvestWords?: string[];
  featuredQuote?: string;
  bookTitle?: string;
  author?: string;
  chapterTitle?: string;
  chapterId?: string;
  onShareQuote?: (quote?: string) => void;
  onWordConsolidated?: (word: SavedWord) => void;
  /** Cuenta free con la cortesía de IA de hoy agotada: avisa sin llamar a la IA. */
  aiCourtesyExhausted?: boolean;
}

export default function DeepReadingSummaryModal({
  summary,
  consolidationQueue,
  onStartConsolidation,
  onContinue,
  onClose,
  bookId,
  onSkipConsolidation,
  harvestWords,
  featuredQuote, bookTitle, author, chapterTitle,
  chapterId,
  onShareQuote,
  onWordConsolidated,
  aiCourtesyExhausted,
}: DeepReadingSummaryModalProps) {
  const companion = useCompanionSafe();
  const durationText =
    summary.durationMinutes === 1
      ? "1 minuto"
      : `${summary.durationMinutes} minutos`;
  const handleContinue = onContinue ?? onClose;
  const isChapter = summary.source === "chapter";

  const [isMuted, setIsMuted] = useState(() => !isConsolidationActive(bookId));
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [activeWordIndex, setActiveWordIndex] = useState<number | null>(
    summary.startInRunner ? 0 : null,
  );
  const [consolidationCompleted, setConsolidationCompleted] = useState(false);
  const [followAnswer, setFollowAnswer] = useState<ChapterFollowLevel | null>(null);

  // Solo cifras medidas: `wordsAssimilated` trae las palabras leídas del
  // capítulo (no «asimiladas»); la cobertura no se mide aquí, así que no se
  // muestra un incremento inventado.
  const wordsRead = summary.wordsAssimilated ?? null;

  const queue = useMemo(() => consolidationQueue ?? [], [consolidationQueue]);
  const allowVocabGames = isFeatureFlagEnabled("vocabGames");
  const hasConsolidation = !isMuted && queue.length > 0 && allowVocabGames;

  const harvestList = useMemo(() => {
    if (harvestWords && harvestWords.length > 0) return harvestWords;
    const wordsFromQueue = queue.map((q) => q.item.surfaceForm || q.item.lemma);
    return Array.from(new Set(wordsFromQueue.filter(Boolean)));
  }, [harvestWords, queue]);

  const defaultQuote =
    featuredQuote?.trim() ||
    queue.find((q) => q.item.chapterSentence?.trim())?.item.chapterSentence?.trim() ||
    "La lectura profunda transforma el tiempo en memoria viva.";

  const handleCreatePostal = () => {
    triggerHaptic("selection");
    onShareQuote?.(defaultQuote);
  };

  const handleSkip = () => {
    triggerHaptic("selection");
    onSkipConsolidation?.();
    handleContinue();
  };

  const answerFollow = (level: ChapterFollowLevel) => {
    triggerHaptic("selection");
    setFollowAnswer(level);
    if (bookId && chapterId) {
      void saveChapterFollowAnswer(bookId, chapterId, level).catch(() => {});
    }
  };

  const handleMuteThisBook = () => {
    triggerHaptic("selection");
    if (bookId) muteConsolidationForBook(bookId);
    setIsMuted(true);
    setShowOptionsMenu(false);
  };

  const handleDisableGlobally = () => {
    triggerHaptic("selection");
    disableConsolidationGlobally();
    setIsMuted(true);
    setShowOptionsMenu(false);
  };

  const handleStartConsolidation = () => {
    triggerHaptic("selection");
    if (onStartConsolidation) {
      onStartConsolidation();
    } else {
      setActiveWordIndex(0);
    }
  };

  const handleSolveStep = (metrics?: EpisodicOutcome) => {
    const current = activeWordIndex !== null ? queue[activeWordIndex] : undefined;
    if (current) {
      // El reto se califica por lo que pasó antes de acertar: error o
      // pista = Again, primer intento = Hard. Una palabra nueva solo se
      // codifica (sin nota) y una no vencida acertada no se adelanta.
      void consolidateEpisodicWord(current.item, bookId, undefined, metrics)
        .then((word) => {
          if (word) onWordConsolidated?.(word);
        })
        .catch(() => {});
    } else {
      void awardEpisodicConsolidation(3).catch(() => {});
    }
    if (activeWordIndex !== null && activeWordIndex + 1 < queue.length) {
      setActiveWordIndex(activeWordIndex + 1);
    } else {
      setActiveWordIndex(null);
      setConsolidationCompleted(true);
    }
  };

  // -------------------------------------------------------------------------
  // VISTA: PANTALLA DE CELEBRACIÓN DE CONSOLIDACIÓN COMPLETADA
  // -------------------------------------------------------------------------
  if (consolidationCompleted) {
    return (
      <Dialog label="Repaso del capítulo hecho" onClose={handleContinue}>
        <div className="sheet-head">
          <h2 className="sheet-title">Repaso del capítulo hecho</h2>
          <button
            type="button"
            className="btn--quiet"
            onClick={handleContinue}
            aria-label="Continuar"
          >
            ✕
          </button>
        </div>

        <div className="deep-summary-companion">
          <div className="deep-summary-companion-avatar">
            {companion ? (
              <Companion
                stage={companion.stage}
                mood="awake"
                accessories={companion.accessories}
                pose="celebrate"
              />
            ) : (
              <div className="deep-summary-center" aria-hidden="true">
                <Icon name="sparkles" size={32} />
              </div>
            )}
          </div>
        </div>

        <div className="deep-summary-lead">
          <p className="card-context deep-summary-headline">
            Practicaste {queue.length} {queue.length === 1 ? "palabra" : "palabras"} de este capítulo
          </p>
          <p className="meta deep-summary-subquote">
            «{companion?.name ?? "Michi"} las guarda: volverán a tu repaso cuando toque.»
          </p>
        </div>

        <div className="deep-summary-footer">
          <button
            type="button"
            className="btn--quiet deep-summary-quote-btn"
            onClick={handleCreatePostal}
          >
            Crear postal del capítulo
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleContinue}
            data-autofocus
          >
            Continuar al siguiente capítulo →
          </button>
        </div>
      </Dialog>
    );
  }

  // -------------------------------------------------------------------------
  // VISTA: JUGAR MICRO-RETO DIRECTO DENTRO DEL MODAL (SI CORRE IN-SITU)
  // -------------------------------------------------------------------------
  if (activeWordIndex !== null && activeWordIndex < queue.length) {
    const active = queue[activeWordIndex];
    return (
      <Dialog label="Fijar palabras del capítulo" onClose={handleSkip}>
        <div className="sheet-head consolidation-runner-head">
          <span className="consolidation-badge">
            Palabra {activeWordIndex + 1} de {queue.length}
          </span>
          <button
            type="button"
            className="btn--quiet consolidation-skip-link"
            onClick={handleSkip}
          >
            Saltar al siguiente capítulo →
          </button>
        </div>

        <div className="consolidation-runner-body">
          {/* Sin opciones reales para el hueco (<2) se ordena la palabra:
              un cloze sin elección se resolvería sin leer. */}
          {active.modality === "word-scramble" || (active.item.options?.length ?? 0) < 2 ? (
            <WordScrambleGame
              key={`scramble-${active.item.lemma}`}
              targetWord={active.item.surfaceForm || active.item.lemma}
              chapterSentence={active.item.chapterSentence}
              shortGloss={active.item.shortGloss}
              language={active.item.lang}
              timeLimitSeconds={10}
              onSolve={handleSolveStep}
            />
          ) : (
            <SentenceBuilderGame
              key={`cloze-${active.item.lemma}`}
              targetWord={active.item.surfaceForm || active.item.lemma}
              chapterSentence={active.item.chapterSentence}
              shortGloss={active.item.shortGloss}
              language={active.item.lang}
              mode="cloze"
              options={active.item.options}
              targetLemma={active.item.lemma}
              onSolve={handleSolveStep}
            />
          )}
        </div>
      </Dialog>
    );
  }

  // -------------------------------------------------------------------------
  // VISTA: RESUMEN DEL CAPÍTULO + TARJETA DE CONSOLIDACIÓN (25 SEGUNDOS)
  // -------------------------------------------------------------------------
  const postalAttribution = [bookTitle, author, chapterTitle].filter(Boolean).join(" · ");

  return (
    <Dialog label={isChapter ? "Capítulo cerrado" : "Retiro de lectura completado"} onClose={onClose}>
      <div className="sheet-head">
        <h2 className="sheet-title">
          {isChapter ? "Cerraste el capítulo" : "Retiro completado"}
        </h2>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar resumen"
        >
          Cerrar
        </button>
      </div>

      {/* Celebración con el Gato */}
      <div className="deep-summary-companion">
        <div className="deep-summary-companion-avatar">
          {companion ? (
            <Companion
              stage={companion.stage}
              mood="awake"
              accessories={companion.accessories}
              pose="celebrate"
            />
          ) : (
            <div className="deep-summary-center" aria-hidden="true">
              <Icon name="sparkles" size={28} />
            </div>
          )}
        </div>
      </div>

      <div className="deep-summary-lead">
        <p className="card-context deep-summary-headline">
          {durationText} {isChapter ? "de lectura" : "de inmersión profunda"}
        </p>
        <p className="meta deep-summary-subquote">
          «{companion?.name ?? "Michi"} celebra tu lectura{wordsRead ? `: ${wordsRead.toLocaleString("es")} palabras leídas` : ""}.»
        </p>
      </div>

      {aiCourtesyExhausted && isChapter ? (
        <p className="meta deep-summary-ai-note">
          Hoy ya usaste tus explicaciones con IA. Con Lecta+ habríamos explicado en este capítulo qué quiere decir cada palabra difícil en su frase.{" "}
          <a
            href="/?carne=1"
            onClick={(e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent("lecta:open-carne"));
            }}
          >
            Ver Lecta+
          </a>
        </p>
      ) : null}

      <div className="deep-summary-stats-grid">
        <div>
          <strong className="deep-summary-stat-value">
            {summary.durationMinutes} min
          </strong>
          <span className="meta deep-summary-stat-label">
            {isChapter ? "Tiempo de lectura" : "Tiempo en retiro"}
          </span>
        </div>
        <div>
          <strong className="deep-summary-stat-value">
            {summary.sectionsRead}
          </strong>
          <span className="meta deep-summary-stat-label">
            {summary.sectionsRead === 1 ? "Sección leída" : "Secciones leídas"}
          </span>
        </div>
        {wordsRead ? (
          <div>
            <strong className="deep-summary-stat-value is-accent">
              {wordsRead.toLocaleString("es")}
            </strong>
            <span className="meta deep-summary-stat-label">Palabras leídas</span>
          </div>
        ) : null}
      </div>

      {bookId && chapterId ? (
        <section
          aria-label="Hilo del capítulo"
          className="deep-summary-follow"
        >
          <p className="meta deep-summary-follow-prompt">
            ¿Seguiste el hilo de este capítulo?
          </p>
          {followAnswer ? (
            <p className="meta deep-summary-follow-done" role="status">
              Anotado. Tu recorrido lo muestra como tu propia valoración.
            </p>
          ) : (
            <div
              role="group"
              aria-label="Tu respuesta"
              className="deep-summary-follow-options"
            >
              {CHAPTER_FOLLOW_OPTIONS.map(({ level, label }) => (
                <button
                  key={level}
                  type="button"
                  className="theme-option"
                  onClick={() => answerFollow(level)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* Sección: Tu Cosecha en este Capítulo */}
      <div className="deep-summary-harvest" aria-label="Tu cosecha del capítulo">
        <div className="deep-summary-harvest-header">
          <div className="deep-summary-harvest-title-row">
            <h3 className="deep-summary-harvest-title">Tu Cosecha en este Capítulo</h3>
            <span className="deep-summary-harvest-count">
              {harvestList.length} {harvestList.length === 1 ? "palabra" : "palabras"}
            </span>
          </div>
          <p className="deep-summary-harvest-desc">
            Las palabras que tocaste o volviste a encontrar en este capítulo.
          </p>
        </div>
        {harvestList.length > 0 ? (
          <div className="deep-summary-harvest-chips" aria-label="Palabras integradas en el capítulo">
            {harvestList.map((word) => (
              <span key={word} className="deep-summary-harvest-chip">
                {word}
              </span>
            ))}
          </div>
        ) : null}
        <div className="deep-summary-postal-preview">
          <blockquote className="deep-summary-postal-quote">
            «{defaultQuote}»
          </blockquote>
          {postalAttribution ? (
            <p className="meta deep-summary-postal-meta">{postalAttribution}</p>
          ) : null}
          <div className="deep-summary-harvest-actions">
            <button
              type="button"
              className="deep-summary-quote-btn"
              onClick={handleCreatePostal}
            >
              Crear postal del capítulo
            </button>
          </div>
        </div>
      </div>

      {/* Tarjeta Limpia de Consolidación Episódica (~25 segundos) */}
      {hasConsolidation ? (
        <div className="consolidation-card deep-summary-consolidation">
          <div className="consolidation-card-header">
            <h3 className="consolidation-card-title">
              Fija en tu memoria {queue.length} palabras de este capítulo (~25 s)
            </h3>
            <div className="consolidation-options-wrapper">
              <button
                type="button"
                className="btn--quiet consolidation-options-toggle"
                onClick={() => setShowOptionsMenu((prev) => !prev)}
                aria-label="Opciones de consolidación"
                title="Opciones de consolidación"
              >
                Opciones ▾
              </button>
              {showOptionsMenu ? (
                <div className="consolidation-options-dropdown" role="menu">
                  {bookId ? (
                    <button
                      type="button"
                      className="consolidation-option-item"
                      role="menuitem"
                      onClick={handleMuteThisBook}
                    >
                      ✕ Ocultar en este libro
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="consolidation-option-item"
                    role="menuitem"
                    onClick={handleDisableGlobally}
                  >
                    Desactivar consolidación al final de capítulo siempre
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="consolidation-word-chips">
            {queue.map(({ item }) => (
              <span key={item.lemma} className="consolidation-word-chip">
                {item.surfaceForm || item.lemma}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="deep-summary-footer">
        <button
          type="button"
          className="btn--quiet"
          onClick={() => {
            triggerHaptic("selection");
            onClose();
          }}
        >
          Cerrar
        </button>

        {hasConsolidation ? (
          <button
            type="button"
            className="btn btn--accent consolidation-start-btn"
            onClick={handleStartConsolidation}
          >
            Fijar en memoria (~25 s)
          </button>
        ) : null}

        {/* Botón principal prominente para saltar sin fricción */}
        <button
          type="button"
          className="btn btn--primary consolidation-skip-btn"
          onClick={handleSkip}
          data-autofocus
        >
          Continuar al siguiente capítulo →
        </button>
      </div>
    </Dialog>
  );
}
