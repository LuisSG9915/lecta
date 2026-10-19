// Panel del juego dentro del Cuaderno: el gato de biblioteca, nivel
// con su barra de tinta continua (ProgressInk), racha de días, cofres
// pendientes y la meta próxima hacia el siguiente rango de logro.
// Si la preferencia «Compañero y logros» está apagada en Cuenta, este
// panel no existe — ni compañero ni XP visible.
//
// El gato es un botón que abre la hoja del CompanionProvider (cuidado,
// nombre, armario, vitrina) — el estado lo comparte ese mismo proveedor,
// así que aquí solo se consume por contexto y no hay otra carga ni otro
// gato. Los cofres se comprometen ANTES de revelar: primero se persiste
// la recepción y solo entonces se muestra el contenido.

import { useEffect, useRef, useState } from "react";
import {
  loadGame,
  openGameChest,
  writeCompanionField,
  isConsolidationActive,
  muteConsolidationForBook,
  disableConsolidationGlobally,
} from "../lib/game";
import { captureDbScope } from "../lib/idb";
import { useCompanion } from "./CompanionProvider";
import { CompanionButton } from "./CompanionButton";
import { ProgressInk } from "./ProgressInk";
import { Seal, toRoman } from "./Seal";
import {
  COMPANION_ARTICLES,
  type CompanionArticle,
} from "../../shared/companion-data";
import {
  ACCESSORY_LABELS,
  levelProgress,
  listFamilyProgress,
  pendingChests,
  type GameChest,
} from "../lib/gamification";
import {
  evaluateSentenceWithAi,
  generateMicroStoryWithAi,
  type EvaluateSentenceResult,
  type MicroStoryResult,
} from "../lib/learn";
import { PracticeCompanionHeader } from "./PracticeCompanionHeader";
import { scheduleReview, Rating, type Card, type Grade } from "../lib/fsrs";

export type ReviewState = Card;
export { Rating };

export function simulateNextReview(
  currentReview: ReviewState | undefined,
  rating: Rating,
  now = new Date(),
): Card {
  return scheduleReview(currentReview, rating as unknown as Grade, now);
}

export function formatFsrsIntervalPreview(
  currentReview: ReviewState | undefined,
  rating: Rating,
): string {
  // Simula el siguiente intervalo usando el motor FSRS ya presente en la app
  const sim = simulateNextReview(currentReview, rating);
  const days = sim.scheduled_days;
  if (days === 0) return "Hoy (10 min)";
  if (days === 1) return "Mañana (1 d)";
  if (days < 30) return `En ${days} días`;
  const months = Math.round(days / 30);
  return `En ~${months} ${months === 1 ? "mes" : "meses"}`;
}

// Contenido recién abierto de un cofre: la ropa ofrece ponérsela sin
// salir del panel y el resto se retira solo a los segundos.
const REVEAL_MS = 2500;

export interface GamePanelProps {
  mode?:
    | "dashboard"
    | "adaptive_flow"
    | "ai_workshop"
    | "post_chapter_consolidation"
    | "quick_review"
    | "empty_review"
    | "round_finished";
  onStartAdaptiveFlow?: () => void;
  onStartConsolidation?: () => void;
  onSkipConsolidation?: () => void;
  onContinueNextChapter?: () => void;
  onReturnToReading?: () => void;
  words?: Array<{
    word: string;
    meaning?: string;
    bookTitle?: string;
    lemma?: string;
    context?: string;
  }>;
  consolidationQueue?: Array<{
    item: {
      lemma: string;
      surfaceForm: string;
      lang: string;
      chapterSentence?: string;
      shortGloss?: string;
      bookTitle?: string;
    };
    modality: string;
  }>;
  bookId?: string;
  onClose?: () => void;
  roundFinished?: boolean;
  wordsReviewedCount?: number;
  emptyReview?: boolean;
  currentBookTitle?: string;
  currentReview?: ReviewState;
  onRate?: (rating: Rating) => void;
}

export function GamePanel(props: GamePanelProps) {
  const {
    mode = "dashboard",
    onStartAdaptiveFlow,
    onStartConsolidation,
    onSkipConsolidation,
    onContinueNextChapter,
    onReturnToReading,
    words,
    consolidationQueue,
    bookId,
    onClose,
    roundFinished,
    wordsReviewedCount,
    emptyReview,
    currentBookTitle,
    currentReview,
    onRate,
  } = props;
  const {
    enabled,
    state,
    name,
    accessories,
    mood,
    stage,
    openPanel,
    reducedMotion = false,
  } = useCompanion();
  const [chestBusy, setChestBusy] = useState<string | null>(null);
  const [chestError, setChestError] = useState("");
  const [revealed, setRevealed] = useState<GameChest | null>(null);
  const [wearBusy, setWearBusy] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRevealTimer = () => {
    if (revealTimer.current !== null) {
      clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  };
  useEffect(() => clearRevealTimer, []);

  const [workshopTab, setWorkshopTab] = useState<"challenge" | "story">("challenge");
  const [selectedWordIndex, setSelectedWordIndex] = useState(0);
  const [sentenceInput, setSentenceInput] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<EvaluateSentenceResult | null>(null);
  const [styleHint, setStyleHint] = useState("Poético y misterioso");
  const [generatingStory, setGeneratingStory] = useState(false);
  const [storyResult, setStoryResult] = useState<MicroStoryResult | null>(null);

  const [isConsolidationMuted, setIsConsolidationMuted] = useState(
    () => !isConsolidationActive(bookId),
  );
  const [showConsolidationOptions, setShowConsolidationOptions] = useState(false);

  if (!enabled || !state) return null;

  const prog = levelProgress(state.xp);
  const chests = pendingChests(state);
  const revealedArticle =
    revealed && Object.hasOwn(COMPANION_ARTICLES, revealed.reward)
      ? (revealed.reward as CompanionArticle)
      : null;

  // Meta próxima: familia con mayor progreso relativo al siguiente rango
  const pendingFamilies = listFamilyProgress(state).filter(
    (f) => f.nextAchievement !== null,
  );
  const nextGoal =
    pendingFamilies.length > 0
      ? [...pendingFamilies].sort((a, b) => b.ratio - a.ratio)[0]
      : null;

  const open = (chest: GameChest) => {
    if (chestBusy) return;
    const scope = captureDbScope();
    setChestBusy(chest.id);
    setChestError("");
    clearRevealTimer();
    setRevealed(null);
    void (async () => {
      // El compromiso manda: la recepción del cofre se persiste y se
      // relee la proyección — solo una apertura REAL se revela; un
      // commit que no aterrizó muestra el error, nunca el contenido.
      await openGameChest(chest.id, scope);
      const fresh = await loadGame(scope);
      const opened =
        fresh.chests.find((c) => c.id === chest.id)?.openedAt != null;
      if (!opened) {
        setChestError("No se pudo abrir el cofre. Intenta de nuevo.");
        return;
      }
      setRevealed(chest);
      // La ropa espera la decisión «Ponérselo / Después»; las demás
      // recompensas se anuncian un momento y se retiran solas.
      if (!Object.hasOwn(COMPANION_ARTICLES, chest.reward)) {
        revealTimer.current = setTimeout(() => {
          revealTimer.current = null;
          setRevealed(null);
        }, REVEAL_MS);
      }
    })()
      .catch(() => {
        setChestError("No se pudo abrir el cofre. Intenta de nuevo.");
      })
      .finally(() => setChestBusy(null));
  };

  const wear = (article: CompanionArticle) => {
    if (wearBusy) return;
    const scope = captureDbScope();
    setWearBusy(true);
    setChestError("");
    void writeCompanionField(`equipped.${COMPANION_ARTICLES[article]}`, article, scope)
      .then(() => {
        clearRevealTimer();
        setRevealed(null);
      })
      .catch(() => {
        setChestError("No se pudo poner la prenda. Intenta de nuevo.");
      })
      .finally(() => setWearBusy(false));
  };

  if (mode === "ai_workshop") {
    const availableWords =
      props?.words && props.words.length > 0
        ? props.words
        : [{ word: "perenne", meaning: "Que dura siempre o mucho tiempo" }];
    const currentWord = availableWords[selectedWordIndex] ?? availableWords[0];

    const handleEvaluate = async () => {
      const sentence = sentenceInput.trim();
      if (!sentence || evaluating) return;
      setEvaluating(true);
      setEvalResult(null);
      const scope = captureDbScope();
      try {
        const result = await evaluateSentenceWithAi(
          {
            word: currentWord.word,
            targetSense: currentWord.meaning ?? "",
            userSentence: sentence,
            bookTitle: currentWord.bookTitle,
            lemma: currentWord.lemma,
          },
          scope,
        );
        setEvalResult(result);
      } finally {
        setEvaluating(false);
      }
    };

    const handleGenerateStory = async () => {
      if (generatingStory) return;
      setGeneratingStory(true);
      setStoryResult(null);
      const scope = captureDbScope();
      try {
        const result = await generateMicroStoryWithAi(
          {
            words: availableWords.slice(0, 4).map((w) => ({
              word: w.word,
              meaning: w.meaning,
            })),
            styleHint: styleHint.trim() || undefined,
          },
          scope,
        );
        setStoryResult(result);
      } finally {
        setGeneratingStory(false);
      }
    };

    const catBubbleText = evaluating
      ? "Leyendo tu frase con atención..."
      : generatingStory
        ? "Tejiendo un cuento con tus palabras..."
        : evalResult
          ? evalResult.feedback
          : workshopTab === "challenge"
            ? `¡Bienvenido al Reto del Escritor! Escribe una oración con «${currentWord.word}» y la revisamos juntos 🐾`
            : "Selecciona el tono e hilvanemos un microrrelato con las palabras de tu cuaderno 🐾";

    return (
      <section
        className="game game-ai-workshop cat-anim"
        aria-label="Taller con el Gato IA"
        data-mode="ai_workshop"
      >
        <div className="game-ai-header">
          <CompanionButton
            stage={stage}
            mood={mood}
            pose={evalResult?.catReaction === "purring" ? "celebrate" : undefined}
            accessories={accessories}
            name={name}
            label={`Ver a ${name}`}
            onClick={openPanel}
          />
          <div className="game-ai-speech-bubble" role="status">
            {catBubbleText}
          </div>
          {props?.onClose ? (
            <button
              type="button"
              className="btn--quiet"
              onClick={props.onClose}
              aria-label="Cerrar taller"
            >
              ✕
            </button>
          ) : null}
        </div>

        <div className="game-ai-tabs" role="tablist" aria-label="Modos del taller">
          <button
            type="button"
            role="tab"
            aria-selected={workshopTab === "challenge"}
            data-active={workshopTab === "challenge"}
            className="game-ai-tab-btn"
            onClick={() => {
              setWorkshopTab("challenge");
            }}
          >
            ✍️ El Reto del Escritor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workshopTab === "story"}
            data-active={workshopTab === "story"}
            className="game-ai-tab-btn"
            onClick={() => {
              setWorkshopTab("story");
            }}
          >
            📜 Cuento de Tinta
          </button>
        </div>

        {workshopTab === "challenge" ? (
          <div className="ai-challenge-container">
            <div className="ai-word-banner">
              <div className="game-book-eco-row">
                <span className="game-book-eco-pill">
                  {currentWord.bookTitle
                    ? `📖 Eco de: ${currentWord.bookTitle}`
                    : "📖 De tus lecturas recientes"}
                </span>
              </div>
              <h3 className="ai-word-title">{currentWord.word}</h3>
              {currentWord.meaning ? (
                <p className="ai-word-meaning">
                  <strong>Sentido:</strong> {currentWord.meaning}
                </p>
              ) : null}
              {availableWords.length > 1 ? (
                <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                  {availableWords.map((w, idx) => (
                    <button
                      key={w.word + idx}
                      type="button"
                      className="btn--quiet"
                      style={{
                        padding: "0.2rem 0.5rem",
                        fontSize: "0.8rem",
                        fontWeight: idx === selectedWordIndex ? "700" : "normal",
                        textDecoration: idx === selectedWordIndex ? "underline" : "none",
                      }}
                      onClick={() => {
                        setSelectedWordIndex(idx);
                        setEvalResult(null);
                        setSentenceInput("");
                      }}
                    >
                      {w.word}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div>
              <label htmlFor="ai-writer-sentence" className="visually-hidden">
                Tu oración con «{currentWord.word}»
              </label>
              <textarea
                id="ai-writer-sentence"
                className="ai-sentence-textarea"
                rows={3}
                placeholder={`Escribe aquí una oración utilizando «${currentWord.word}»…`}
                value={sentenceInput}
                onChange={(e) => {
                  setSentenceInput(e.target.value);
                  if (evalResult) setEvalResult(null);
                }}
                disabled={evaluating}
              />
            </div>

            <div className="ai-actions-row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleEvaluate}
                disabled={evaluating || !sentenceInput.trim()}
              >
                {evaluating ? "El gato está leyendo…" : "Revisar con el Gato"}
              </button>
              {evalResult?.offlineFallback ? (
                <span className="ai-fallback-badge">Modo sin conexión</span>
              ) : null}
            </div>

            {evalResult ? (
              <div className="ai-result-panel" role="region" aria-label="Resultado de la evaluación">
                <div className="ai-result-badges">
                  <span
                    className={`ai-score-pill ${evalResult.score >= 60 ? "is-good" : "is-poor"}`}
                  >
                    {evalResult.score} / 100
                  </span>
                  <span className="ai-reaction-pill">
                    {evalResult.catReaction === "purring"
                      ? "😻 Ronroneo"
                      : evalResult.catReaction === "curious"
                        ? "😺 Curioso"
                        : "🤔 Pensativo"}
                  </span>
                </div>
                <p className="ai-feedback">{evalResult.feedback}</p>
                {evalResult.improvedVersion ? (
                  <div className="ai-improved-box">
                    <span className="ai-improved-title">Propuesta de estilo del gato:</span>
                    <p className="ai-improved-text">«{evalResult.improvedVersion}»</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="ai-story-container">
            <div>
              <p className="meta" style={{ marginBottom: "0.5rem" }}>
                Palabras del cuaderno que se integrarán en el cuento:
              </p>
              <div className="ai-story-chips">
                {availableWords.slice(0, 4).map((w, i) => (
                  <span key={w.word + i} className="ai-story-chip">
                    «{w.word}»
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label htmlFor="ai-story-style" className="meta" style={{ whiteSpace: "nowrap" }}>
                Tono o atmósfera:
              </label>
              <input
                id="ai-story-style"
                type="text"
                className="ai-sentence-textarea"
                style={{ minHeight: "auto", padding: "0.35rem 0.65rem", fontSize: "0.9rem" }}
                value={styleHint}
                onChange={(e) => setStyleHint(e.target.value)}
                placeholder="Ej. Misterio, Poético, Aventura..."
              />
            </div>

            <div className="ai-actions-row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleGenerateStory}
                disabled={generatingStory}
              >
                {generatingStory ? "Tejiendo historia…" : "Tejer Cuento con el Gato"}
              </button>
              {storyResult?.offlineFallback ? (
                <span className="ai-fallback-badge">Modo sin conexión</span>
              ) : null}
            </div>

            {storyResult ? (
              <div className="ai-story-card" role="region" aria-label="Cuento generado">
                <h3 className="ai-story-title">{storyResult.title}</h3>
                <p className="ai-story-body">
                  {storyResult.story.split(/(\[\[.+?\]\])/g).map((part, i) => {
                    if (part.startsWith("[[") && part.endsWith("]]")) {
                      return (
                        <mark key={i} className="ai-story-highlight">
                          {part.slice(2, -2)}
                        </mark>
                      );
                    }
                    return part;
                  })}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className="game cat-anim"
      aria-label="Tu compañero y progreso"
      data-mode={mode}
    >
      {/* Estado: Ronda rápida terminada con celebración del compañero */}
      {roundFinished || mode === "round_finished" ? (
        <div className="game-round-finished" role="status">
          <PracticeCompanionHeader
            pose="celebrate"
            speech={`¡Excelente ronda! Afianzaste ${wordsReviewedCount ?? 5} palabras para tu próximo capítulo 🐾`}
            combo={0}
            mode="animated"
            onModeChange={() => {}}
          />
          <div className="game-round-finished-content">
            <h3 className="game-round-finished-title">🌱 Ecos de tus lecturas afianzados</h3>
            <p className="game-round-finished-text">
              Afianzaste {wordsReviewedCount ?? 5} palabras para tu próximo capítulo. {name} celebra tu avance y que tu próxima lectura sea aún más fluida.
            </p>
            <div className="game-round-actions">
              <button
                type="button"
                className="btn btn--primary game-return-reading-btn"
                onClick={onReturnToReading ?? onContinueNextChapter ?? onClose}
              >
                Volver a mi lectura
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Estado: Sin palabras pendientes de repaso */}
      {emptyReview || mode === "empty_review" || ((mode === "adaptive_flow" || mode === "quick_review") && words && words.length === 0) ? (
        <div className="game-empty-review" role="status">
          <p className="game-empty-review-text">
            ✨ Tu memoria está al día. Sigue disfrutando tu libro; Lecta guardará aquí los momentos y palabras que quieras conservar.
          </p>
          <div className="game-empty-actions">
            <button
              type="button"
              className="btn btn--primary game-return-reading-btn"
              onClick={onReturnToReading ?? onClose}
            >
              Volver a mi lectura
            </button>
          </div>
        </div>
      ) : null}

      {onRate ? (
        <div className="game-rating-bar" role="group" aria-label="Calificar dificultad de recuerdo">
          <span className="game-rating-prompt">¿Qué tan bien la recordaste?</span>
          <div className="game-rating-buttons">
            {(
              [
                { rating: Rating.Again, label: "1 · Otra vez", tone: "again" },
                { rating: Rating.Hard, label: "2 · Difícil", tone: "hard" },
                { rating: Rating.Good, label: "3 · Bien", tone: "good" },
                { rating: Rating.Easy, label: "4 · Fácil", tone: "easy" },
              ] as const
            ).map(({ rating, label, tone }) => (
              <button
                key={rating}
                type="button"
                className={`game-rate-btn game-rate-${tone}`}
                onClick={() => onRate(rating)}
              >
                <span className="game-rate-label">{label}</span>
                <span className="game-rate-sub">{formatFsrsIntervalPreview(currentReview, rating)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "adaptive_flow" && onStartAdaptiveFlow ? (
        <div className="game-adaptive-flow-cta">
          <div className="game-book-eco-row">
            <span className="game-book-eco-pill">
              {currentBookTitle || (words && words[0]?.bookTitle)
                ? `📖 Eco de: ${currentBookTitle ?? words?.[0]?.bookTitle}`
                : "📖 De tus lecturas recientes"}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onStartAdaptiveFlow}
          >
            Iniciar Sesión Fluida
          </button>
        </div>
      ) : null}
      {mode === "post_chapter_consolidation" &&
      !isConsolidationMuted &&
      consolidationQueue &&
      consolidationQueue.length > 0 ? (
        <div className="consolidation-card game-post-chapter-consolidation">
          <div className="game-book-eco-row">
            <span className="game-book-eco-pill">
              {currentBookTitle || (consolidationQueue[0]?.item?.bookTitle)
                ? `📖 Eco de: ${currentBookTitle ?? consolidationQueue[0]?.item?.bookTitle}`
                : "📖 De tus lecturas recientes"}
            </span>
          </div>
          <div className="consolidation-card-header">
            <h3 className="consolidation-card-title">
              Fija en tu memoria {consolidationQueue.length} palabras de este capítulo (~25 s)
            </h3>
            <div className="consolidation-options-wrapper">
              <button
                type="button"
                className="btn--quiet consolidation-options-toggle"
                onClick={() => setShowConsolidationOptions((prev) => !prev)}
                aria-label="Opciones de consolidación"
              >
                Opciones ▾
              </button>
              {showConsolidationOptions ? (
                <div className="consolidation-options-dropdown" role="menu">
                  {bookId ? (
                    <button
                      type="button"
                      className="consolidation-option-item"
                      role="menuitem"
                      onClick={() => {
                        muteConsolidationForBook(bookId);
                        setIsConsolidationMuted(true);
                        setShowConsolidationOptions(false);
                      }}
                    >
                      ✕ Ocultar en este libro
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="consolidation-option-item"
                    role="menuitem"
                    onClick={() => {
                      disableConsolidationGlobally();
                      setIsConsolidationMuted(true);
                      setShowConsolidationOptions(false);
                    }}
                  >
                    🚫 Desactivar consolidación al final de capítulo siempre
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="consolidation-word-chips">
            {consolidationQueue.map(({ item }) => (
              <span key={item.lemma} className="consolidation-word-chip">
                {item.surfaceForm || item.lemma}
              </span>
            ))}
          </div>

          <div
            className="consolidation-actions"
            style={{
              display: "flex",
              gap: "0.5rem",
              marginTop: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            {onStartConsolidation ? (
              <button
                type="button"
                className="btn btn--accent consolidation-start-btn"
                onClick={onStartConsolidation}
              >
                Fijar palabras (~25 s)
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--primary consolidation-skip-btn"
              onClick={onContinueNextChapter ?? onSkipConsolidation ?? onClose}
              data-autofocus
            >
              Continuar al siguiente capítulo →
            </button>
          </div>
        </div>
      ) : mode === "post_chapter_consolidation" && onStartConsolidation ? (
        <div className="game-adaptive-flow-cta">
          <button
            type="button"
            className="btn btn--primary"
            onClick={onStartConsolidation}
          >
            Fijar Palabras del Capítulo
          </button>
        </div>
      ) : null}
      <div className="game-head">
        <CompanionButton
          stage={stage}
          mood={mood}
          accessories={accessories}
          name={name}
          label={`Ver a ${name}`}
          onClick={openPanel}
        />
        <div className="game-meta">
          <p className="game-level">
            Nivel {prog.level + 1} · {prog.name}
          </p>
          <ProgressInk
            value={state.xp}
            max={prog.ceil ?? state.xp}
            floor={prog.floor}
            level={prog.level}
            label="Progreso al siguiente nivel"
            variant="vermilion"
            reducedMotion={reducedMotion}
          />
          <p className="meta">
            {Math.floor(state.xp)} puntos
            {prog.ceil !== null
              ? ` · ${prog.ceil - Math.floor(state.xp)} para el siguiente`
              : " · nivel máximo"}
            {state.stats.streakDays > 1
              ? ` · racha de ${state.stats.streakDays} días`
              : ""}
          </p>
          {mood === "asleep" ? (
            <p className="meta">El gato duerme; una lectura lo despierta.</p>
          ) : null}
        </div>
      </div>

      {revealed ? (
        <div
          className={`game-reveal ${reducedMotion ? "" : "game-reveal-stamped"}`.trim()}
        >
          <p role="status">
            El cofre tenía: {ACCESSORY_LABELS[revealed.reward] ?? revealed.reward}.
          </p>
          {revealedArticle ? (
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={wearBusy}
                onClick={() => wear(revealedArticle)}
              >
                Ponérselo
              </button>
              <button
                type="button"
                className="btn--quiet"
                disabled={wearBusy}
                onClick={() => {
                  clearRevealTimer();
                  setRevealed(null);
                }}
              >
                Después
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {chestError ? (
        <p className="status" role="alert">
          {chestError}
        </p>
      ) : null}

      {chests.length ? (
        <ul className="game-chests" aria-label="Cofres por abrir">
          {chests.map((chest) => (
            <li key={chest.id}>
              <button
                type="button"
                className="game-chest"
                disabled={chestBusy !== null}
                onClick={() => open(chest)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  className={`game-chest-svg ${chestBusy === chest.id ? "is-opening" : ""}`.trim()}
                  aria-hidden="true"
                >
                  <path
                    d="M3 10 H21 V19 C21 20.1 20.1 21 19 21 H5 C3.9 21 3 20.1 3 19 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                  <rect
                    x="10.5"
                    y="10"
                    width="3"
                    height="4"
                    rx="0.5"
                    fill="currentColor"
                  />
                  <path
                    className="game-chest-lid"
                    d="M2.5 10 C2.5 7 5 5 12 5 C19 5 21.5 7 21.5 10 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>
                  <span className="game-chest-label">{chest.label}</span>
                  <span className="meta">Toca para abrir</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {nextGoal ? (
        <div
          className="game-next-goal"
          aria-label={`Siguiente meta: ${nextGoal.info.name}`}
        >
          <Seal
            family={nextGoal.family}
            rank={nextGoal.ranksEarned}
            maxRank={nextGoal.ranksTotal}
            size={40}
          />
          <div className="game-next-goal-meta">
            <div className="game-next-goal-title">
              <span>{nextGoal.info.name}</span>
              <span className="game-next-goal-rank">
                Rango {toRoman(nextGoal.ranksEarned + 1)}
              </span>
            </div>
            <ProgressInk
              value={nextGoal.current}
              max={nextGoal.goal}
              variant="ochre"
              reducedMotion={reducedMotion}
            />
            <p className="game-next-goal-hint">
              {Math.floor(nextGoal.current)} de {nextGoal.goal}{" "}
              {nextGoal.goal === 1
                ? nextGoal.info.unit.singular
                : nextGoal.info.unit.plural}
              {nextGoal.nextAchievement
                ? ` · «${nextGoal.nextAchievement.title}»`
                : ""}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
