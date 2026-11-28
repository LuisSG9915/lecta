import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../styles/notebook.css";
import {
  isReviewDueWord,
  loadRetentionHorizon,
  Rating,
  saveRetentionHorizon,
  scheduleReview,
  type RetentionHorizon,
} from "../lib/fsrs";
import {
  captureDbScope,
  getActiveUserId,
  listAnnotations,
  putSavedWord,
  updateAnnotation,
  updateSavedWord,
  type SavedAnnotation,
  type SavedWord,
  type StoredBook,
} from "../lib/idb";
const QuoteCardModal = lazy(() => import("./QuoteCardModal"));
import BookGlossaryModal from "./BookGlossaryModal";
import Notice from "./Notice";
import {
  isLearnPending,
  LEARN_SESSION_SIZE,
  reviewQueue,
} from "../lib/learn";
import { pushWordsToServer, removeWord } from "../lib/vocab";
import { recordReview } from "../lib/reviews";
import {
  findEpisodicHighlightRange,
  renderHighlightedContext,
} from "../lib/word-highlight";
import {
  type PracticeMode,
  MODES,
  ratingString,
  GROUP_PAGE,
  UNDO_MS,
  retentionCheckAged,
  isEligible,
} from "../lib/notebook-model";
import { PracticeCard } from "./notebook/PracticeCard";
import { FreeModes } from "./notebook/FreeModes";
import { HerbarioPanel } from "./notebook/HerbarioPanel";
import { LearnSessionView } from "./notebook/LearnSessionView";
import { NotebookHero } from "./notebook/NotebookHero";
import AudioReviewPlayer from "./notebook/AudioReviewPlayer";
import { QuotesPanel, type QuoteCardRequest } from "./notebook/QuotesPanel";
import { ReviewDone } from "./notebook/ReviewDone";
import { isSpeechAvailable } from "../lib/speech";


// Reexportados desde lib/word-highlight: los tests y el herbario los
// consumen por esta vía histórica.
export { findEpisodicHighlightRange, renderHighlightedContext };
export { getStabilitySegments, safeStability } from "../lib/notebook-model";
const GamePanel = lazy(() => import("./GamePanel").then((m) => ({ default: m.GamePanel })));
import {
  downloadNotebookMarkdown,
  downloadText,
  passagesToCsv,
  exportAnkiTsv,
  wordsToCsv,
} from "../lib/export";
import { useModalBehavior } from "../lib/modal";
import { triggerHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";
import ReadingActivity from "./ReadingActivity";
import { isFeatureFlagEnabled } from "../lib/settings";
import { useCompanionSafe } from "./CompanionProvider";
import { usePracticeCompanion } from "../hooks/usePracticeCompanion";
import { useNotebookData } from "../hooks/useNotebookData";
import { useHerbarioView } from "../hooks/useHerbarioView";
import { useLearnSession } from "../hooks/useLearnSession";
import { useReviewSession } from "../hooks/useReviewSession";
import Icon from "./Icon";
import { useUserPlan } from "../lib/account-plan";

export type VocabularyProps = {
  onClose?: () => void;
  // Solo se usa hash/título/nombre/idioma para nombrar y filtrar libros:
  // la estantería manda ShelfItem, que no carga el archivo.
  books?: Pick<
    StoredBook,
    "hash" | "name" | "title" | "author" | "language" | "mediaKind"
  >[];
  // Sube cuando la sincronización trae intervalos nuevos; la pestaña
  // de actividad relee su progreso sin remontar el panel.
  activityVersion?: number;
  // Sube cuando el vocabulario cambia fuera del cuaderno (lector,
  // sincronización, calibración): recarga la lista sin remontar.
  vocabVersion?: number;
  // Avisa al padre tras cada mutación local (guardar, borrar, calificar,
  // aprender) para que el globo de pendientes se actualice al instante.
  onVocabChange?: () => void;
  onOpenJourney?: () => void;
  presentation?: "overlay" | "page";
  backLabel?: string;
  // Abrir ya filtrado por una obra (p. ej. desde «Leo este libro en
  // papel»). El padre remonta la vista en cada petición: la semilla
  // solo se aplica al montar y el select queda libre después.
  initialBookFilter?: string;
};

export function Vocabulary({
  onClose = () => {},
  books = [],
  activityVersion,
  vocabVersion,
  onVocabChange,
  onOpenJourney,
  presentation = "overlay",
  backLabel,
  initialBookFilter,
}: VocabularyProps) {
  const userPlan = useUserPlan();
  const ref = useRef<HTMLDivElement>(null);
  const isOverlay = presentation !== "page";
  useModalBehavior(ref, onClose, { enabled: isOverlay });

  const {
    words,
    setWords,
    wordsRef,
    loadError,
    useAi,
    knowledge,
    setKnowledge,
    exposure,
    setExposure,
    notifyVocabChange,
  } = useNotebookData({ vocabVersion, onVocabChange });
  const [tab, setTab] = useState<"words" | "quotes" | "activity">("words");
  const [quotes, setQuotes] = useState<SavedAnnotation[] | null>(null);
  const [quoteModal, setQuoteModal] = useState<QuoteCardRequest | null>(null);
  const [glossaryBookHash, setGlossaryBookHash] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [undo, setUndo] = useState<{ word: SavedWord } | null>(null);
  // Cita recién quitada: se puede recuperar unos segundos, igual que una palabra.
  const [quoteUndo, setQuoteUndo] = useState<SavedAnnotation | null>(null);
  const quoteUndoTimer = useRef<number | undefined>(undefined);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [audioReviewOpen, setAudioReviewOpen] = useState(false);
  const [retentionHorizon, setRetentionHorizon] = useState<RetentionHorizon>(() =>
    loadRetentionHorizon(),
  );

  const workshopAnchorRef = useRef<HTMLDivElement>(null);
  // Palabras del taller ya acreditadas en este montaje: superar el
  // reto califica una sola vez — reintentarlo en la misma sesión no
  // debe inflar la estabilidad FSRS como si fueran repasos espaciados.
  const workshopCreditedRef = useRef<Set<string>>(new Set());
  const undoTimer = useRef<number | undefined>(undefined);
  const companion = useCompanionSafe();

  // Compañero en juegos y repasos (animado / tranquilo / oculto) y su interactividad.
  const practiceCompanion = usePracticeCompanion();
  const {
    catPose,
    setCatPose,
    catSpeech,
    setCatSpeech,
    combo,
  } = practiceCompanion;

  // Los avisos de deshacer y el destello de parejas se limpian al desmontar.
  useEffect(
    () => () => {
      window.clearTimeout(undoTimer.current);
      window.clearTimeout(quoteUndoTimer.current);
    },
    [],
  );

  const all = useMemo(() => words ?? [], [words]);

  const view = useHerbarioView({ all, books, knowledge, exposure, initialBookFilter });
  const {
    bookAuthor,
    bookName,
    bookTitle,
    collapsed,
    filter,
    filtered,
    isWordKnown,
    knownKeys,
    learnPending,
    nextDueTs,
    order,
    progressStats,
    scopedWords,
    setBookFilter,
    setCollapsed,
    setExpanded,
    setFilter,
    setLanguageFilter,
    setListLimit,
    setOpenWords,
    setOrder,
    setQuery,
    wordBookTitle,
  } = view;

  const recentWords = useMemo(() => {
    return [...all]
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
      .slice(0, 8);
  }, [all]);

  const handleRecentChipClick = (word: SavedWord) => {
    if (tab !== "words") setTab("words");
    // La palabra tiene que quedar a la vista: un filtro, la búsqueda, otro
    // idioma/libro o el orden por estado podían dejarla fuera de la lista.
    setFilter("all");
    setQuery("");
    setLanguageFilter("all");
    setBookFilter("all");
    if (order === "estado") setOrder("fecha");
    setListLimit(GROUP_PAGE);
    const bh = word.bookHash ?? "";
    setExpanded((prev) => new Set(prev).add(bh));
    if (bh && collapsed.has(bh)) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(bh);
        return next;
      });
    }
    setOpenWords((prev) => new Set(prev).add(word.key));
    setTimeout(() => {
      const detailId = `word-detail-${word.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      const el = document.getElementById(detailId)?.parentElement || document.getElementById(detailId);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  };

  // La corrección IA de «escribir» pide sesión; sin ella el ejercicio
  // queda en autocalificación directa.
  const hasSession = Boolean(getActiveUserId());
  // La pista del gato llama a la IA: pide sesión y la preferencia «Usar IA».
  // En free no hay pista: llama a /api/lexicon/explain (Lecta+) y daría 402.
  const canHint = hasSession && useAi && userPlan?.plan !== "free";
  // Todo lo que pregunta (la sesión y los modos libres) sale de aquí: solo
  // palabras que ya pasaron por la ficha o por un repaso real. Depende de la
  // hora, así que se calcula en cada render.
  // Se recalcula al cambiar las palabras o la evidencia, y cada minuto porque
  // «vencida» depende de la hora (nowTick): no en cada render ni cada tecla.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const reviewWords = useMemo(
    () => reviewQueue(scopedWords, knownKeys, exposure),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowTick fuerza la relectura de la hora
    [scopedWords, knownKeys, exposure, nowTick],
  );
  // Cuántas palabras de la cola puede cumplir cada modo: un solo recorrido,
  // no un filter con regex por botón y por render.
  const eligibleCount = useMemo(() => {
    const counts = Object.fromEntries(MODES.map(({ id }) => [id, 0])) as Record<
      PracticeMode,
      number
    >;
    for (const word of reviewWords) {
      for (const { id } of MODES) if (isEligible(word, id)) counts[id] += 1;
    }
    return counts;
  }, [reviewWords]);
  // Toda palabra pendiente es aprendible: si no tiene significado se
  // resuelve en la ficha (IA si hay sesión, o escrito a mano) antes de
  // «Quiero aprenderla». Ninguna queda bloqueada por falta de datos.
  const learnable = learnPending;
  // La ficha sirve tandas de LEARN_SESSION_SIZE: el botón dice cuántas
  // abre de verdad y de cuántas pendientes, no promete todas.
  const learnBatch = Math.min(LEARN_SESSION_SIZE, learnable.length);
  const learnNoun = learnable.length === 1 ? "palabra nueva" : "palabras nuevas";
  const learnLabel =
    learnable.length > learnBatch
      ? `Aprender ${learnBatch} de ${learnable.length} ${learnNoun}`
      : `Aprender ${learnBatch} ${learnNoun}`;

  // Chequeo de retención a 30 días: palabras ya consolidadas (asentadas
  // o dominadas) cuya última revisión es la más antigua. No bloquea el
  // repaso normal; es una comprobación opcional de memoria a largo plazo.
  const retentionCheckCandidates = useMemo(
    () =>
      scopedWords
        .filter(
          (word) =>
            !word.deleted &&
            !isWordKnown(word) &&
            (word.card?.reps ?? 0) > 0 &&
            (word.card?.stability ?? 0) >= 21 &&
            retentionCheckAged(word.card),
        )
        .sort((a, b) => {
          const aLast = a.card?.last_review ? new Date(a.card.last_review).getTime() : 0;
          const bLast = b.card?.last_review ? new Date(b.card.last_review).getTime() : 0;
          return aLast - bLast;
        })
        .slice(0, 10),
    [scopedWords, isWordKnown],
  );

  // El gato de la portada solo se pinta con el compañero activado (igual que en
  // las sesiones); clic y teclado hacen exactamente lo mismo.
  const heroCompanion = companion?.enabled && companion.state ? companion : null;
  const petHeroCat = () => {
    triggerHaptic("selection");
    playCompanionSound("purr");
    setCatPose((p) => (p === "idle" ? "greet" : "idle"));
    setCatSpeech(
      combo > 0 ? `¡Llevas racha x${combo}!` : "¡A leer y repasar con ganas!",
    );
  };

  // ---------- Repaso y modos libres ----------
  const review = useReviewSession({
    reviewWords,
    scopedWords,
    all,
    retentionCheckCandidates,
    useAi,
    canHint,
    setWords,
    wordsRef,
    notifyVocabChange,
    setSaveError,
    practiceCompanion,
  });
  const {
    current,
    done,
    handleQuickGame,
    practiceNote,
    queue,
    revealButtonRef,
    startAdaptiveFlow,
    startPractice,
    startRetentionCheck30d,
  } = review;

  const reviewKeys = useMemo(() => new Set(reviewWords.map((word) => word.key)), [reviewWords]);
  const handleWorkshopComplete = (wordKey: string) => {
    if (workshopCreditedRef.current.has(wordKey)) return;
    const target = all.find((w) => w.key === wordKey && !w.deleted);
    if (!target || isLearnPending(target, knownKeys, exposure)) return;
    // Escribir una oración propia es producción: vale `Good`, nunca `Easy`
    // por la nota de la IA (la IA no califica FSRS). Y solo si la tarjeta
    // ya tocaba: adelantar un repaso no es espaciar.
    if (!isReviewDueWord(target)) return;
    workshopCreditedRef.current.add(wordKey);
    const rating = Rating.Good;
    void (async () => {
      try {
        const scope = captureDbScope();
        const card = scheduleReview(target.card, rating);
        const stored = await updateSavedWord({ ...target, card }, scope);
        void pushWordsToServer([stored], scope);
        void recordReview(
          {
            language: target.language,
            form: target.form,
            kind: "write",
            rating: ratingString(rating),
            hints: 0,
          },
          scope,
        ).catch(() => {
          /* el historial es auxiliar; no deshace la calificación */
        });
        setWords((list) =>
          list?.map((w) => (w.key === stored.key ? stored : w)) ?? list,
        );
        notifyVocabChange();
      } catch {
        /* el taller no bloquea por un fallo de guardado */
      }
    })();
  };

  const changeRetentionHorizon = (next: RetentionHorizon) => {
    void saveRetentionHorizon(next).catch(() => {});
    setRetentionHorizon(next);
  };

  // ---------- Aprender (primera exposición guiada) ----------
  const learnSession = useLearnSession({
    learnPending,
    learnable,
    setWords,
    setKnowledge,
    exposure,
    setExposure,
    notifyVocabChange,
  });
  const { learn, startLearn } = learnSession;

  // El taller se monta debajo del héroe: al abrirlo lo traemos a la vista en
  // vez de dejar que el lector adivine que apareció más abajo.
  const toggleWorkshop = () => {
    const opening = !workshopOpen;
    setWorkshopOpen(opening);
    if (opening) {
      requestAnimationFrame(() =>
        workshopAnchorRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
    }
  };

  const remove = async (word: SavedWord) => {
    try {
      await removeWord(word.key, captureDbScope());
      setWords((list) => list?.filter((w) => w.key !== word.key) ?? list);
      notifyVocabChange();
      window.clearTimeout(undoTimer.current);
      setUndo({ word });
      undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
    } catch {
      setSaveError(`No se pudo quitar «${word.form}». Intenta de nuevo.`);
    }
  };

  const restore = async () => {
    if (!undo) return;
    window.clearTimeout(undoTimer.current);
    const restored = { ...undo.word, deleted: false, deletedAt: null, updatedAt: Date.now() };
    setUndo(null);
    try {
      const scope = captureDbScope();
      await putSavedWord(restored, scope);
      void pushWordsToServer([restored], scope);
      setWords((list) =>
        list ? [...list.filter((w) => w.key !== restored.key), restored] : [restored],
      );
      notifyVocabChange();
    } catch {
      setSaveError(`No se pudo recuperar «${undo.word.form}».`);
    }
  };

  useEffect(() => {
    if (tab !== "quotes" || quotes !== null) return;
    let cancelled = false;
    const scope = captureDbScope();
    void listAnnotations(undefined, scope)
      .then((stored) => {
        if (cancelled) return;
        const list = stored.filter((item) => item.kind === "passage" && !item.deleted);
        list.sort((a, b) => b.createdAt - a.createdAt);
        setQuotes(list);
      })
      .catch(() => {
        if (!cancelled) setQuotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, quotes]);

  const removeQuote = async (item: SavedAnnotation) => {
    triggerHaptic("light");
    const scope = captureDbScope();
    try {
      await updateAnnotation({ ...item, deleted: true }, scope);
    } catch {
      // Si no se pudo guardar, la cita se queda en la lista y se dice.
      setSaveError("No se pudo quitar la cita. Intenta de nuevo.");
      return;
    }
    setSaveError("");
    setQuotes((prev) => (prev ? prev.filter((q) => q.key !== item.key) : []));
    window.clearTimeout(quoteUndoTimer.current);
    setQuoteUndo(item);
    quoteUndoTimer.current = window.setTimeout(() => setQuoteUndo(null), UNDO_MS);
  };

  const restoreQuote = async () => {
    if (!quoteUndo) return;
    window.clearTimeout(quoteUndoTimer.current);
    const item = quoteUndo;
    setQuoteUndo(null);
    try {
      const restored = await updateAnnotation({ ...item, deleted: false }, captureDbScope());
      setQuotes((prev) =>
        prev
          ? [...prev.filter((q) => q.key !== item.key), restored].sort(
              (a, b) => b.createdAt - a.createdAt,
            )
          : [restored],
      );
    } catch {
      setSaveError("No se pudo recuperar la cita.");
    }
  };

  const copyQuoteText = async (text: string) => {
    triggerHaptic("selection");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // noop
    }
  };

  const exportCsv = () =>
    downloadText(
      `cuaderno-lecta-${new Date().toISOString().slice(0, 10)}.csv`,
      wordsToCsv(filtered.filter((w) => !w.deleted), bookName),
      "text/csv;charset=utf-8",
    );
  const exportAnkiCloze = () =>
    downloadText(
      `cuaderno-lecta-cloze-${new Date().toISOString().slice(0, 10)}.txt`,
      exportAnkiTsv(filtered.filter((w) => !w.deleted), bookName, { cloze: true }),
      "text/plain;charset=utf-8",
    );
  const exportPassages = async () => {
    const stored = await listAnnotations(undefined, captureDbScope()).catch(
      () => [],
    );
    const passages = stored.filter((item) => item.kind === "passage" && !item.deleted);
    downloadText(
      `pasajes-lecta-${new Date().toISOString().slice(0, 10)}.csv`,
      passagesToCsv(passages, bookName),
      "text/csv;charset=utf-8",
    );
  };
  const exportMarkdownNotebook = () => {
    triggerHaptic("selection");
    void downloadNotebookMarkdown();
  };

  const audioReviewWords = useMemo(
    () =>
      (reviewWords.length > 0 ? reviewWords : all)
        .filter((w) => Boolean(w.meaning?.trim()))
        .slice(0, 15),
    [reviewWords, all],
  );

  // La sesión solo cuenta mientras hay ejercicios o fichas por resolver: en la
  // pantalla de cierre la barra de navegación ya debe estar disponible.
  const sessionKind =
    queue && queue.items.length > 0
      ? "queue"
      : learn && !learn.done && learn.items.length > 0
        ? "learn"
        : undefined;
  // Al empezar una sesión: arriba de todo (la portada pudo quedar desplazada y
  // el gato quedaría bajo la barra fija) y el gato sin la frase ni la racha
  // de la sesión anterior.
  const { resetCat, setCombo } = practiceCompanion;
  const prevSessionRef = useRef<typeof sessionKind>(undefined);
  useEffect(() => {
    const started = sessionKind !== undefined && prevSessionRef.current === undefined;
    prevSessionRef.current = sessionKind;
    if (!started) return;
    resetCat();
    setCombo(0);
    setCatSpeech("");
    if (isOverlay) ref.current?.scrollTo?.({ top: 0 });
    else window.scrollTo({ top: 0 });
  }, [sessionKind, isOverlay, resetCat, setCombo, setCatSpeech]);
  // Calificación, revisión IA o tanda de parejas guardándose: salir ahora
  // dejaría trabajo a medias.
  const exitBusy =
    review.grading ||
    review.verifying ||
    Boolean(learnSession.learnBusy) ||
    (review.tanda.length > 0 && review.matchDone.size === review.tanda.length);
  // Aprender: muestra la pantalla final (conserva learn.kept); sin ninguna
  // ficha vista vuelve a la portada, como el repaso.
  const exitLearn = () => {
    if (!learn) return;
    if (learn.items.length === learn.total) learnSession.setLearn(null);
    else learnSession.setLearn({ ...learn, done: true });
  };

  return (
    <div
      ref={ref}
      className={`notebook ${isOverlay ? "notebook--overlay" : "notebook--page"} vocab`}
      role={isOverlay ? "dialog" : undefined}
      aria-modal={isOverlay ? "true" : undefined}
      aria-label="Herbario"
      // La sesión solo cuenta mientras hay ejercicios o fichas por
      // resolver: en la pantalla de cierre la barra de navegación
      // ya debe estar disponible para irse a otra sección.
      data-session={sessionKind}
    >
      {undo ? (
        <Notice
          message={`«${undo.word.form}» se quitó del Herbario.`}
          actionLabel="Deshacer"
          onAction={() => void restore()}
          onDismissMessage={() => setUndo(null)}
        />
      ) : null}
      {quoteUndo ? (
        <Notice
          message="La cita se quitó del Herbario."
          actionLabel="Deshacer"
          onAction={() => void restoreQuote()}
          onDismissMessage={() => setQuoteUndo(null)}
        />
      ) : null}
      <header className="notebook-bar">
        {isOverlay ? (
          <button
            type="button"
            className="btn--quiet"
            onClick={onClose}
            aria-label="Volver"
            data-autofocus
          >
            {backLabel ?? "‹ Volver"}
          </button>
        ) : null}
        {sessionKind ? (
          // Única forma de terminar la sesión: arriba y siempre a la vista
          // (la barra es sticky durante la sesión).
          <button
            type="button"
            className="btn--quiet nb-exit"
            disabled={exitBusy}
            onClick={sessionKind === "queue" ? () => void review.exitSession() : exitLearn}
          >
            Terminar por hoy
          </button>
        ) : null}
        <h1 className="notebook-title">
          {learn ? "Aprender" : queue ? "Repaso" : "Herbario"}
        </h1>
        <span className="notebook-count">
          {learn
            ? `${Math.min(learn.total - learn.items.length + 1, learn.total)} de ${learn.total}`
            : queue
              ? `${Math.min(done + 1, queue.total)} de ${queue.total}`
              : words
                ? `${scopedWords.length === all.length ? all.length : `${scopedWords.length} de ${all.length}`} guardadas${
                    learnable.length > 0 ? ` · ${learnable.length} por aprender` : ""
                  } · ${reviewWords.length} para repasar`
                : ""}
        </span>
      </header>

      <div className="notebook-main">
        {!queue && !learn ? (
          <>
            {/* Hero Card: "La Mesa de Estudio con el Gato" */}
            <NotebookHero
              wordCount={all.length}
              learnableCount={learnable.length}
              reviewWordCount={reviewWords.length}
              learnLabel={learnLabel}
              nextDueTs={nextDueTs}
              progressStats={progressStats}
              filter={filter}
              setFilter={setFilter}
              setTab={setTab}
              heroCompanion={heroCompanion}
              catPose={catPose}
              catSpeech={catSpeech}
              onPetCat={petHeroCat}
              startLearn={() => startLearn()}
              startAdaptiveFlow={() => startAdaptiveFlow()}
              onStartAudioReview={
                audioReviewWords.length > 0 && isSpeechAvailable()
                  ? () => setAudioReviewOpen(true)
                  : undefined
              }
              onClose={onClose}
            >
              {/* Modos libres: un solo plegable, cerrado por defecto. El héroe
                  se queda con un botón principal; lo demás está a un toque. */}
              {isFeatureFlagEnabled("vocabGames") && (
                <FreeModes
                  eligibleCount={eligibleCount}
                  reviewWordCount={reviewWords.length}
                  learnableCount={learnable.length}
                  practiceNote={practiceNote}
                  onStartPractice={startPractice}
                  onToggleWorkshop={toggleWorkshop}
                  locked={userPlan?.plan === "free"}
                />
              )}
            </NotebookHero>

            {recentWords.length > 0 ? (
              <div className="nb-recent-rail" aria-label="Guardadas recientemente en tu lectura">
                <div className="nb-recent-head">
                  <span className="nb-recent-label">Guardadas recientemente en tu lectura</span>
                  <button
                    type="button"
                    className="btn--quiet nb-recent-all-btn"
                    onClick={() => setTab("words")}
                    aria-label={`Ver todas las ${all.length} palabras en Mi Herbario`}
                  >
                    {`Ver todas (${all.length}) →`}
                  </button>
                </div>
                <ul className="nb-recent-track">
                  {recentWords.slice(0, 5).map((w) => (
                    <li key={w.key}>
                      <button
                        type="button"
                        className="nb-recent-chip"
                        onClick={() => handleRecentChipClick(w)}
                        title={w.meaning ? `${w.lemma || w.form}: ${w.meaning}` : `Ver ficha de ${w.lemma || w.form}`}
                      >
                        <span className="nb-recent-chip-star" aria-hidden="true">
                          <Icon name="star" size={12} />
                        </span>
                        <span className="nb-recent-chip-text">{w.lemma || w.form}</span>
                        {w.meaning ? (
                          <span className="nb-recent-chip-meaning">· {w.meaning}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {isFeatureFlagEnabled("vocabGames") && (
              <div ref={workshopAnchorRef}>
                <Suspense fallback={null}>
                  <GamePanel
                    mode={workshopOpen ? "ai_workshop" : "dashboard"}
                    onStartAdaptiveFlow={() => startAdaptiveFlow()}
                    // El taller solo trabaja con palabras ya expuestas:
                    // nunca examina ni produce sobre palabras sin ficha.
                    // Las más afianzadas primero: para escribir una
                    // oración hace falta recordar la palabra, así que la
                    // cola «más atrasada» del repaso no sirve aquí.
                    words={[...reviewWords]
                      .sort(
                        (a, b) =>
                          (b.card?.stability ?? 0) - (a.card?.stability ?? 0),
                      )
                      .map((w) => ({
                        word: w.form,
                        meaning: w.meaning,
                        bookTitle: wordBookTitle(w),
                        lemma: w.lemma,
                        key: w.key,
                        context: w.context,
                      }))}
                    onChallengeComplete={handleWorkshopComplete}
                    showIdentity={false}
                    onClose={() => setWorkshopOpen(false)}
                  />
                </Suspense>
              </div>
            )}

            <div className="segmented nb-tabs" role="group" aria-label="Secciones del Herbario">
              <button
                type="button"
                data-active={tab === "words" || undefined}
                aria-pressed={tab === "words"}
                onClick={() => setTab("words")}
              >
                Mi Herbario de Palabras
              </button>
              <button
                type="button"
                data-active={tab === "quotes" || undefined}
                aria-pressed={tab === "quotes"}
                onClick={() => setTab("quotes")}
              >
                Citas y Hallazgos
              </button>
              {onOpenJourney || activityVersion ? (
                <button
                  type="button"
                  data-active={tab === "activity" || undefined}
                  aria-pressed={tab === "activity"}
                  onClick={() => setTab("activity")}
                >
                  Actividad
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {tab === "activity" && !queue && !learn ? (
          <ReadingActivity
            books={books}
            words={all}
            activityVersion={activityVersion}
            onOpenJourney={onOpenJourney}
          />
        ) : null}

        {tab === "quotes" && !queue && !learn ? (
          <QuotesPanel
            quotes={quotes}
            bookTitle={bookTitle}
            bookAuthor={bookAuthor}
            onExport={() => void exportPassages()}
            onCopy={(text) => void copyQuoteText(text)}
            onRemove={(item) => void removeQuote(item)}
            onQuoteCard={setQuoteModal}
          />
        ) : null}

        {!queue && !learn ? (
          <>
            {loadError ? (
              <p className="nb-empty" role="alert">
                No se pudo abrir tu Herbario en este dispositivo.
              </p>
            ) : null}
            {words === null && !loadError ? (
              <p className="meta">Abriendo tu Herbario…</p>
            ) : null}
            {saveError ? (
              <p className="status" role="alert">
                {saveError}
              </p>
            ) : null}
          </>
        ) : null}

        {tab === "words" && !queue && !learn ? (
          <HerbarioPanel
            view={view}
            all={all}
            wordsEmpty={words?.length === 0}
            books={books}
            retentionCheckCandidates={retentionCheckCandidates}
            retentionHorizon={retentionHorizon}
            changeRetentionHorizon={changeRetentionHorizon}
            startRetentionCheck30d={startRetentionCheck30d}
            reviewKeys={reviewKeys}
            handleQuickGame={handleQuickGame}
            startLearn={startLearn}
            remove={remove}
            setGlossaryBookHash={setGlossaryBookHash}
            onQuoteCard={setQuoteModal}
            bookAuthor={bookAuthor}
            exportCsv={exportCsv}
            exportAnkiCloze={exportAnkiCloze}
            exportMarkdownNotebook={exportMarkdownNotebook}
          />
        ) : null}

        {learn ? (
          <LearnSessionView
            learn={learn}
            session={learnSession}
            practiceCompanion={practiceCompanion}
            hasSession={hasSession}
            useAi={useAi}
            learnPending={learnPending}
            wordBookTitle={wordBookTitle}
            startAdaptiveFlow={startAdaptiveFlow}
            revealButtonRef={revealButtonRef}
            onCatTap={petHeroCat}
          />
        ) : null}

        {queue && !current ? (
          <ReviewDone
            review={review}
            practiceCompanion={practiceCompanion}
            streakDays={companion?.enabled ? companion.state?.stats?.streakDays : undefined}
            pendingCount={reviewWords.length}
            onClose={onClose}
          />
        ) : null}

        {current ? (
          <PracticeCard
            current={current}
            review={review}
            practiceCompanion={practiceCompanion}
            hasSession={hasSession}
            canHint={canHint}
            useAi={useAi}
            wordBookTitle={wordBookTitle}
          />
        ) : null}
      </div>

      {quoteModal ? (
        <Suspense fallback={null}>
          <QuoteCardModal
            text={quoteModal.text}
            bookTitle={quoteModal.bookTitle}
            author={quoteModal.author}
            chapterTitle={quoteModal.chapterTitle}
            highlightWord={quoteModal.highlightWord}
            gloss={quoteModal.gloss}
            alreadySaved={true}
            onClose={() => setQuoteModal(null)}
          />
        </Suspense>
      ) : null}
      {glossaryBookHash ? (
        <BookGlossaryModal
          bookHash={glossaryBookHash}
          bookTitle={bookTitle(glossaryBookHash)}
          onClose={() => setGlossaryBookHash(null)}
          onWordSaved={(savedWord) => {
            setWords((prev) =>
              prev
                ? [savedWord, ...prev.filter((w) => w.key !== savedWord.key)]
                : [savedWord],
            );
            notifyVocabChange();
          }}
        />
      ) : null}
      {audioReviewOpen && audioReviewWords.length > 0 ? (
        <AudioReviewPlayer
          words={audioReviewWords}
          onClose={() => setAudioReviewOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default Vocabulary;

