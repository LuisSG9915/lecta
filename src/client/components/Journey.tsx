import { useEffect, useMemo, useRef, useState } from "react";
import { useModalBehavior } from "../lib/modal";
import { reportClientError } from "../lib/client-errors";
import {
  captureDbScope,
  listAllReviews,
  listIntervals,
  listKnowledge,
  listPositions,
  listSavedWords,
  loadSessionValue,
  saveSessionValue,
  type KnownWord,
  type SavedBookPosition,
  type SavedInterval,
  type SavedReview,
  type SavedWord,
  type StoredBook,
} from "../lib/idb";
import { useCompanionSafe } from "./CompanionProvider";
import { levelProgress, listFamilyProgress } from "../lib/gamification";
import {
  bookLabel,
  calculateInkPoints,
  computeLanguageLexicalGrowth,
  computeRetentionSummary,
  finishedBookHashes,
  inkPathNodes,
  literaryRankFor,
  readingRecords,
  totalReadingMs,
  weeksHistory,
  wordStages,
  type InkMilestoneNode,
  type LanguageLexicalCurvePoint,
} from "../lib/journey";
import {
  Seal,
  FAMILY_TO_SEAL_CATEGORY,
  SEAL_CATEGORY_LABELS,
  type SealCategory,
} from "./Seal";
import { ProgressInk } from "./ProgressInk";
import BookCover from "./BookCover";
import { displayTitle } from "../lib/cover";
import { CompanionStage } from "./CompanionStage";
import ReadingActivity from "./ReadingActivity";
import { dayKeyOf } from "../lib/reading-activity";
import { summarizeChapterFollows } from "../lib/chapter-follow";
import {
  parseReadingGoal,
  READING_GOAL_KEY,
  serializeReadingGoal,
} from "../lib/reading-goal";
import {
  COMPANION_LETTERS_KEY,
  generateDeterministicCompanionLetter,
  parseCompanionLetters,
  type CompanionLetter,
} from "../lib/companion-inbox";

export interface JourneyProps {
  onClose: () => void;
  books: Pick<
    StoredBook,
    "hash" | "name" | "title" | "author" | "language" | "cover"
  >[];
}

function formatMinutes(min: number): string {
  if (min <= 0) return "0 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function formatDate(dayKey: string): string {
  const parts = dayKey.split("-").map(Number);
  if (parts.length !== 3 || parts.some((p) => isNaN(p))) return dayKey;
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d, 12);
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

// Coordenadas relativas en porcentaje para los 7 hitos a lo largo del sendero
// Clamped entre 24% y 74% para evitar desbordamientos en pantallas móviles estrechas
const NODE_COORDINATES: { x: number; y: number }[] = [
  { x: 50, y: 8 },
  { x: 74, y: 22 },
  { x: 26, y: 36 },
  { x: 74, y: 50 },
  { x: 26, y: 64 },
  { x: 72, y: 78 },
  { x: 50, y: 92 },
];

function LexicalCurveSparkline({
  points,
  lang,
  label,
}: {
  points: LanguageLexicalCurvePoint[];
  lang: string;
  label: string;
}) {
  const safePoints: LanguageLexicalCurvePoint[] =
    points && points.length >= 2
      ? points
      : points && points.length === 1
        ? [
            { ...points[0], index: 0 },
            { ...points[0], index: 1 },
          ]
        : [
            { index: 0, theta: 0, normalizedScore: 50 },
            { index: 1, theta: 0, normalizedScore: 50 },
          ];

  const paddingX = 14;
  const paddingTop = 10;
  const paddingBottom = 14;
  const plotWidth = 240 - 2 * paddingX;
  const plotHeight = 64 - paddingTop - paddingBottom;

  const coords = safePoints.map((p, i) => {
    const x = Number(
      (paddingX + (i / (safePoints.length - 1)) * plotWidth).toFixed(1),
    );
    const rawScore = p.normalizedScore;
    const scoreVal =
      typeof rawScore === "number" && !Number.isNaN(rawScore) ? rawScore : 50;
    const scoreClamped = Math.max(5, Math.min(100, scoreVal));
    const y = Number(
      (64 - paddingBottom - ((scoreClamped - 5) / 95) * plotHeight).toFixed(1),
    );
    return { x, y };
  });

  const pathD = coords.reduce(
    (acc, pt, idx) => (idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`),
    "",
  );
  const areaD = `${pathD} L ${coords[coords.length - 1].x} 64 L ${coords[0].x} 64 Z`;
  const gradientId = `lexical-curve-grad-${lang}`;
  const lastPt = coords[coords.length - 1];

  return (
    <div className="journey-lexical-curve-wrap">
      <svg
        viewBox="0 0 240 64"
        className="journey-lexical-curve"
        role="img"
        aria-label={label}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--accent, #d97757)"
              stopOpacity="0.22"
            />
            <stop
              offset="100%"
              stopColor="var(--accent, #d97757)"
              stopOpacity="0.0"
            />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradientId})`} />
        <path
          d={pathD}
          fill="none"
          stroke="var(--accent, #d97757)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={lastPt.x}
          cy={lastPt.y}
          r="7"
          fill="var(--accent, #d97757)"
          opacity="0.2"
        />
        <circle
          cx={lastPt.x}
          cy={lastPt.y}
          r="4"
          fill="var(--accent, #d97757)"
        />
      </svg>
    </div>
  );
}

// Una lectura de IndexedDB que no se resuelve no puede dejar la vista en
// «Cargando tu recorrido…» para siempre: cada trabajo caduca, el recorrido
// se pinta con lo que haya y se ofrece reintentar. El caso real que lo
// motivó: la base queda encolada detrás de un `deleteDatabase` bloqueado
// por otra pestaña y no hay ningún evento que despierte la promesa.
const JOURNEY_READ_TIMEOUT_MS = 6_000;

type DeadlineResult<T> = { value: T; timedOut: boolean };

function withDeadline<T>(
  work: Promise<T>,
  fallback: T,
): Promise<DeadlineResult<T>> {
  return new Promise<DeadlineResult<T>>((resolve) => {
    let done = false;
    const finish = (value: T, timedOut: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ value, timedOut });
    };
    const timer = setTimeout(
      () => finish(fallback, true),
      JOURNEY_READ_TIMEOUT_MS,
    );
    work.then(
      (value) => finish(value, false),
      () => finish(fallback, true),
    );
  });
}

export default function Journey({ onClose, books }: JourneyProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);

  const [loading, setLoading] = useState(true);
  const [loadIssue, setLoadIssue] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [intervals, setIntervals] = useState<SavedInterval[]>([]);
  const [words, setWords] = useState<SavedWord[]>([]);
  const [knownWords, setKnownWords] = useState<KnownWord[]>([]);
  const [positions, setPositions] = useState<SavedBookPosition[]>([]);
  const [reviews, setReviews] = useState<SavedReview[]>([]);
  const [chapterFollows, setChapterFollows] = useState({ answered: 0, atEase: 0 });

  // Estados interactivos para hitos y modales
  const [activeMilestone, setActiveMilestone] =
    useState<InkMilestoneNode | null>(null);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [selectedGoalMinutes, setSelectedGoalMinutes] = useState(15);
  const [selectedLang, setSelectedLang] = useState<string>("all");

  const companion = useCompanionSafe();
  const companionEnabled = Boolean(companion?.enabled && companion?.state);

  // Reintento manual: vuelve a leer el dispositivo sin cerrar el recorrido.
  const retryLoad = () => {
    setLoadIssue(false);
    setLoading(true);
    setReloadToken((token) => token + 1);
  };

  // Cartas del compañero cargadas desde la sesión
  const [letters, setLetters] = useState<CompanionLetter[]>(() => [
    generateDeterministicCompanionLetter({
      catName: companion?.name || "Michi",
      rankName: "Caminante de Papel",
    }),
  ]);

  const unreadLettersCount = useMemo(
    () => letters.filter((l) => !l.read).length,
    [letters],
  );

  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    Promise.all([
      withDeadline(listIntervals(scope), [] as SavedInterval[]),
      withDeadline(listSavedWords(undefined, scope), [] as SavedWord[]),
      withDeadline(listPositions(scope), [] as SavedBookPosition[]),
      withDeadline(listAllReviews(scope), [] as SavedReview[]),
      withDeadline(listKnowledge(undefined, scope), [] as KnownWord[]),
      withDeadline(Promise.resolve(loadSessionValue(COMPANION_LETTERS_KEY, scope)), null),
      withDeadline(Promise.resolve(loadSessionValue(READING_GOAL_KEY, scope)), null),
    ])
      .then(([ints, wrds, pos, revs, knw, rawLetters, rawGoal]) => {
        if (cancelled) return;
        setIntervals(ints.value);
        setWords(wrds.value.filter((w) => !w.deleted));
        setPositions(pos.value);
        setReviews(revs.value);
        setKnownWords(knw.value || []);
        const parsedLetters = parseCompanionLetters(rawLetters.value);
        if (parsedLetters.length > 0) {
          setLetters(parsedLetters);
        }
        const parsedGoal = parseReadingGoal(rawGoal.value);
        if (parsedGoal) {
          setSelectedGoalMinutes(15);
        }
        // Alguna lectura caducó o falló: el recorrido se pinta igual, con un
        // aviso discreto y la opción de reintentar. Se reporta el hecho (sin
        // mensaje libre) para poder diagnosticarlo desde los logs.
        const degraded = [ints, wrds, pos, revs, knw, rawLetters, rawGoal].some(
          (item) => item.timedOut,
        );
        if (!cancelled) setLoadIssue(degraded);
        if (degraded) {
          reportClientError({ name: "Recorrido", code: "idb_load_incompleto" });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadIssue(true);
      })
      .finally(() => {
        // Pase lo que pase, el mensaje de carga no se queda para siempre.
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const totalMs = useMemo(() => totalReadingMs(intervals), [intervals]);
  const totalMinutes = useMemo(
    () => Math.round(totalMs / 60_000),
    [totalMs],
  );
  useEffect(() => {
    let cancelled = false;
    summarizeChapterFollows(captureDbScope())
      .then((summary) => {
        if (!cancelled) setChapterFollows(summary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const stages = useMemo(() => wordStages(words), [words]);
  const retention = useMemo(
    () => computeRetentionSummary(words, reviews),
    [words, reviews],
  );
  const settledTotal = stages.settledCount + stages.masteredCount;
  const settledPct =
    stages.total > 0 ? Math.round((settledTotal / stages.total) * 100) : 0;
  const learningPct =
    stages.total > 0
      ? Math.round((stages.learningCount / stages.total) * 100)
      : 0;
  const newPct =
    stages.total > 0 ? Math.max(0, 100 - settledPct - learningPct) : 0;

  const records = useMemo(
    () => readingRecords(intervals, words, reviews),
    [intervals, words, reviews],
  );
  const finishedHashes = useMemo(
    () => finishedBookHashes(positions),
    [positions],
  );
  const weeks = useMemo(() => weeksHistory(intervals, 8), [intervals]);

  const maxWeekMinutes = useMemo(() => {
    const max = Math.max(...weeks.map((w) => w.minutes), 0);
    return Math.max(max, 30);
  }, [weeks]);

  const booksByHash = useMemo(
    () => new Map(books.map((b) => [b.hash, b])),
    [books],
  );

  const familyList = useMemo(
    () => (companion?.state ? listFamilyProgress(companion.state) : []),
    [companion],
  );
  const companionLevel = companion?.state
    ? levelProgress(companion.state.xp)
    : null;

  // Cálculo de puntos de tinta y rango literario
  const strategiesCount = useMemo(
    () => Math.max(1, Math.min(6, reviews.length > 0 ? 3 : 1)),
    [reviews.length],
  );
  const inkPoints = useMemo(
    () =>
      calculateInkPoints(
        totalMinutes,
        stages.masteredCount,
        strategiesCount,
      ),
    [totalMinutes, stages.masteredCount, strategiesCount],
  );
  const rankProgress = useMemo(
    () => literaryRankFor(inkPoints),
    [inkPoints],
  );
  const currentRank = rankProgress.currentRank;
  const nextRank = rankProgress.nextRank;
  const inkPath = useMemo(
    () => inkPathNodes(inkPoints),
    [inkPoints],
  );

  const lexicalGrowths = useMemo(
    () =>
      computeLanguageLexicalGrowth({
        knownWords,
        savedWords: words,
        books,
      }),
    [knownWords, words, books],
  );

  const displayedGrowths = useMemo(() => {
    if (selectedLang === "all") return lexicalGrowths;
    const filtered = lexicalGrowths.filter((g) => g.lang === selectedLang);
    return filtered.length > 0 ? filtered : lexicalGrowths;
  }, [lexicalGrowths, selectedLang]);

  // Agrupación de sellos en las 3 grandes categorías
  const sealsByCategory = useMemo(() => {
    const map: Record<SealCategory, typeof familyList> = {
      strategies: [],
      words: [],
      companion: [],
    };
    for (const fam of familyList) {
      const cat = FAMILY_TO_SEAL_CATEGORY[fam.family] || "strategies";
      map[cat].push(fam);
    }
    return map;
  }, [familyList]);

  // Acciones del buzón de cartas
  const handleMarkAllLettersRead = () => {
    const updated = letters.map((l) => ({ ...l, read: true }));
    setLetters(updated);
    try {
      const scope = captureDbScope();
      if (typeof saveSessionValue === "function") {
        void saveSessionValue(COMPANION_LETTERS_KEY, JSON.stringify(updated), scope);
      }
    } catch {
      // Ignorar errores de guardado en test
    }
  };

  const handleMarkSingleLetterRead = (id: string) => {
    const updated = letters.map((l) =>
      l.id === id ? { ...l, read: true } : l,
    );
    setLetters(updated);
    try {
      const scope = captureDbScope();
      if (typeof saveSessionValue === "function") {
        void saveSessionValue(COMPANION_LETTERS_KEY, JSON.stringify(updated), scope);
      }
    } catch {
      // Ignorar errores de guardado en test
    }
  };

  // Ajuste de meta de lectura diaria
  const handleSaveGoal = async (minutes: number) => {
    setSelectedGoalMinutes(minutes);
    setIsGoalModalOpen(false);
    try {
      const scope = captureDbScope();
      const raw =
        typeof loadSessionValue === "function"
          ? await loadSessionValue(READING_GOAL_KEY, scope)
          : null;
      const parsed = parseReadingGoal(raw);
      const serialized = serializeReadingGoal(
        parsed?.daysPerWeek ?? 5,
        Date.now(),
        parsed?.streakShields ?? 0,
        parsed?.lastShieldUsedDay ?? null,
      );
      if (typeof saveSessionValue === "function") {
        await saveSessionValue(READING_GOAL_KEY, serialized, scope);
      }
    } catch {
      // Ignorar
    }
  };

  const [todayKey] = useState(() =>
    dayKeyOf(
      Date.now(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
  );

  return (
    <div
      ref={ref}
      className="journey-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Tu recorrido"
    >
      <header className="journey-head">
        <div>
          <p className="eyebrow">Panorama de lectura</p>
          <h1 className="journey-title">Tu recorrido</h1>
        </div>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar recorrido"
          data-autofocus
        >
          Cerrar
        </button>
      </header>

      <main className="journey-content">
        {loading ? (
          <p className="meta" role="status">
            Cargando tu recorrido…
          </p>
        ) : (
          <>
            {loadIssue && (
              <p className="meta" role="status">
                No pudimos leer todo lo guardado en este dispositivo.{" "}
                <button type="button" className="btn--quiet" onClick={retryLoad}>
                  Reintentar
                </button>
              </p>
            )}
            {/* ======================================================== */}
            {/* BLOQUE SUPERIOR: Santuario del Gato y Rango Literario    */}
            {/* ======================================================== */}
            {companionEnabled && companion?.state ? (
              <section
                className="journey-sanctuary"
                aria-label="Santuario del Gato"
              >
                <div className="journey-sanctuary-scene">
                  <CompanionStage
                    name={companion.name}
                    stage={companion.stage}
                    mood={companion.mood}
                    accessories={companion.accessories ?? []}
                    activeCare={companion.activeCare ?? null}
                    onCare={(k) => void companion?.care?.(k)}
                    reducedMotion={Boolean(companion.reducedMotion)}
                    streakDays={companion.state.stats.streakDays ?? 0}
                    hasReadToday={
                      Boolean(todayKey) &&
                      companion.state.stats.lastDayKey === todayKey
                    }
                    greetingText={`¡Bienvenido a tu santuario de lectura, lector!`}
                    careStatusText={null}
                    tryOnArticle={null}
                    tryOnLevel={null}
                    onClearTryOn={() => {}}
                  />
                </div>

                <div className="journey-sanctuary-actions" role="toolbar" aria-label="Acciones del santuario">
                  <button
                    type="button"
                    className="btn journey-action-btn"
                    onClick={() => {
                      if (companion?.openPanel) {
                        // Una sola capa modal: el vestidor no se apila
                        // sobre el recorrido (dos aria-modal a la vez y el
                        // texto del recorrido filtrándose por la hoja).
                        onClose();
                        companion.openPanel("closet");
                      }
                    }}
                    aria-label="Abrir vestidor del gato"
                  >
                    <span aria-hidden="true">👕</span> Vestidor del Gato
                  </button>
                  <button
                    type="button"
                    className="btn journey-action-btn"
                    onClick={() => setIsInboxOpen(true)}
                    aria-label={`Buzón del Gato${unreadLettersCount > 0 ? ` (${unreadLettersCount} sin leer)` : ""}`}
                  >
                    <span aria-hidden="true">💌</span> Buzón del Gato
                    {unreadLettersCount > 0 ? (
                      <span className="journey-badge-count">
                        {unreadLettersCount}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="btn journey-action-btn"
                    onClick={() => setIsGoalModalOpen(true)}
                    aria-label="Ajustar meta de lectura diaria"
                  >
                    <span aria-hidden="true">🎯</span> Ajustar Meta Diaria
                  </button>
                </div>
              </section>
            ) : null}

            {/* Tarjeta de Rango Literario */}
            <section
              className="journey-rank-card"
              aria-label="Rango Literario"
            >
              <div className="journey-rank-head">
                <div>
                  <p className="eyebrow" style={{ margin: 0 }}>Rango Literario</p>
                  <h2 className="journey-rank-name">
                    Nivel {currentRank.level} · {currentRank.name}
                  </h2>
                </div>
                <span className="journey-rank-points-badge">
                  {inkPoints} pts de tinta
                </span>
              </div>
              <p className="meta" style={{ margin: "var(--s-1) 0 var(--s-3)" }}>
                {currentRank.description}
              </p>

              <div className="journey-rank-progress">
                <ProgressInk
                  value={inkPoints}
                  floor={currentRank.minInkPoints}
                  max={
                    nextRank
                      ? nextRank.minInkPoints
                      : currentRank.minInkPoints
                  }
                  level={currentRank.level}
                  label="Puntos de tinta para el siguiente rango"
                  variant="vermilion"
                />
                <div className="journey-rank-progress-labels">
                  <span className="meta">{inkPoints} pts</span>
                  <span className="meta">
                    {nextRank
                      ? `Siguiente: ${nextRank.name} (${nextRank.minInkPoints} pts)`
                      : "¡Rango Máximo Alcanzado!"}
                  </span>
                </div>
              </div>
            </section>

            {/* ======================================================== */}
            {/* BLOQUE CENTRAL: El Sendero de Tinta (Hitos Estilo Odisea)*/}
            {/* ======================================================== */}
            <section
              className="journey-section journey-ink-section"
              aria-label="Sendero de Tinta"
            >
              <div className="journey-section-head journey__intro">
                <h2 className="journey-section-title">El Sendero de Tinta</h2>
                <span className="meta">
                  Hito {inkPath.nodes.findIndex((n) => n.id === inkPath.currentNode.id) + 1} de {inkPath.nodes.length}
                </span>
              </div>
              <p className="meta journey__intro">
                Tu odisea literaria: cada minuto de lectura y palabra dominada
                traza tu avance en el mapa de sabiduría.
              </p>

              {/* Banner de requerimiento para el siguiente hito */}
              <div className="journey-milestone-banner" role="status">
                <span className="milestone-banner-icon" aria-hidden="true">📜</span>
                <p className="milestone-banner-text">{inkPath.remainingText}</p>
              </div>

              {/* Mapa de Sendero con curva SVG y Nodos interactivos */}
              <div className="journey-ink-path journey__trail-map" role="region" aria-label="Mapa de hitos">
                <svg
                  className="ink-path-svg journey-path"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d="M 50 8 C 78 8, 78 22, 74 22 C 66 22, 22 36, 26 36 C 32 36, 78 50, 74 50 C 68 50, 22 64, 26 64 C 32 64, 76 78, 72 78 C 66 78, 50 88, 50 92"
                    fill="none"
                    stroke="var(--vermilion, #b83d1c)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeDasharray="4 3"
                    className="ink-path-stroke"
                  />
                </svg>

                <div className="ink-path-nodes">
                  {inkPath.nodes.map((node, idx) => {
                    const coords = NODE_COORDINATES[idx] || { x: 50, y: 50 };
                    const isCompleted = node.status === "completed";
                    const isCurrent = node.status === "current";

                    return (
                      <div
                        key={node.id}
                        className={`ink-node-wrapper ink-node-wrapper--${node.status}`}
                        style={{
                          left: `${coords.x}%`,
                          top: `${coords.y}%`,
                        }}
                      >
                        <button
                          type="button"
                          className={`ink-node-btn ink-node-btn--${node.status}`}
                          onClick={() => setActiveMilestone(node)}
                          aria-label={`Hito: ${node.title} (${node.requiredInk} pts) - ${isCompleted ? "Completado" : isCurrent ? "Hito actual" : "Bloqueado"}`}
                        >
                          {isCompleted ? (
                            <span className="ink-node-badge ink-node-badge--completed" aria-hidden="true">
                              ✓
                            </span>
                          ) : isCurrent ? (
                            <span className="ink-node-badge ink-node-badge--current" aria-hidden="true">
                              🐾
                            </span>
                          ) : (
                            <span className="ink-node-badge ink-node-badge--upcoming" aria-hidden="true">
                              🔒
                            </span>
                          )}
                        </button>
                        <span className="ink-node-label journey__node-label journey-node-label">{node.title}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Popover / Ficha flotante al tocar un hito */}
                {activeMilestone ? (
                  <div
                    className="ink-node-popover"
                    role="dialog"
                    aria-modal="false"
                    aria-label={`Detalle del hito: ${activeMilestone.title}`}
                  >
                    <div className="ink-popover-head">
                      <h3 className="ink-popover-title">{activeMilestone.title}</h3>
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={() => setActiveMilestone(null)}
                        aria-label="Cerrar detalle de hito"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="ink-popover-meta">
                      <span className="companion-item-badge">
                        {activeMilestone.status === "completed"
                          ? "Completado"
                          : activeMilestone.status === "current"
                            ? "Hito Actual"
                            : "Bloqueado"}
                      </span>
                      <span className="meta">{activeMilestone.requiredInk} puntos de tinta</span>
                    </div>
                    <p className="ink-popover-reward">
                      🎁 <strong>Recompensa:</strong> {activeMilestone.reward}
                    </p>
                    <p className="ink-popover-tip">
                      💡 <em>{activeMilestone.tip}</em>
                    </p>
                  </div>
                ) : null}
              </div>
            </section>

            {/* ======================================================== */}
            {/* BLOQUE INFERIOR: Pasaporte de Sellos y Métricas         */}
            {/* ======================================================== */}

            {/* Actividad Empática con Racha Viva y Gotas Semanales */}
            <section className="journey-section" aria-label="Actividad de lectura">
              <ReadingActivity books={books} words={words} />
            </section>

            {/* 1. Métricas clave en resumen */}
            <section
              className="journey-hero-card"
              aria-label="Resumen de lectura"
            >
              <div className="journey-hero-stat">
                <span className="journey-hero-value">
                  {formatMinutes(totalMinutes)}
                </span>
                <span className="journey-hero-label">Tiempo leído</span>
              </div>
              <div className="journey-hero-stat">
                <span className="journey-hero-value">
                  {finishedHashes.length}
                </span>
                <span className="journey-hero-label">
                  {finishedHashes.length === 1
                    ? "Libro terminado"
                    : "Libros terminados"}
                </span>
              </div>
              <div className="journey-hero-stat">
                <span className="journey-hero-value">{words.length}</span>
                <span className="journey-hero-label">Palabras guardadas</span>
              </div>
            </section>

            {/* 2. Vocabulario por etapas FSRS */}
            <section
              className="journey-section"
              aria-label="Vocabulario por etapas"
            >
              <div className="journey-section-head">
                <h2 className="journey-section-title">Vocabulario por etapas</h2>
                <span className="meta">
                  {stages.total} {stages.total === 1 ? "palabra" : "palabras"} en total
                </span>
              </div>
              <p className="meta">
                Estado de consolidación de tus palabras según el algoritmo de
                repetición espaciada FSRS.
              </p>

              <div className="vocab-progress-card">
                {stages.total > 0 ? (
                  <>
                    <div
                      className="vocab-progress-track"
                      role="progressbar"
                      aria-valuenow={settledTotal}
                      aria-valuemax={stages.total}
                      aria-label="Progreso de vocabulario"
                    >
                      {settledPct > 0 ? (
                        <div
                          className="vocab-progress-seg vocab-progress-seg--settled"
                          style={{ inlineSize: `${settledPct}%` }}
                          title={`Asentada: ${settledTotal}`}
                        />
                      ) : null}
                      {learningPct > 0 ? (
                        <div
                          className="vocab-progress-seg vocab-progress-seg--learning"
                          style={{ inlineSize: `${learningPct}%` }}
                          title={`Aprendiendo: ${stages.learningCount}`}
                        />
                      ) : null}
                      {newPct > 0 ? (
                        <div
                          className="vocab-progress-seg vocab-progress-seg--new"
                          style={{ inlineSize: `${newPct}%` }}
                          title={`Nueva: ${stages.newCount}`}
                        />
                      ) : null}
                    </div>

                    <div className="vocab-progress-legend">
                      <span className="vocab-progress-item vocab-progress-item--settled">
                        <span className="vocab-progress-dot" aria-hidden="true" />
                        <span className="vocab-progress-name">Asentada</span>
                        <strong className="vocab-progress-count">{settledTotal}</strong>
                      </span>
                      <span className="vocab-progress-item vocab-progress-item--learning">
                        <span className="vocab-progress-dot" aria-hidden="true" />
                        <span className="vocab-progress-name">Aprendiendo</span>
                        <strong className="vocab-progress-count">{stages.learningCount}</strong>
                      </span>
                      <span className="vocab-progress-item vocab-progress-item--new">
                        <span className="vocab-progress-dot" aria-hidden="true" />
                        <span className="vocab-progress-name">Nueva</span>
                        <strong className="vocab-progress-count">{stages.newCount}</strong>
                      </span>
                    </div>
                    <p className="meta journey-retention-summary">
                      {retention.recallRatePct !== null
                        ? `Retención en repasos: ${retention.recallRatePct}% · ${retention.retained30dCount} con memoria estimada de 30+ días (${retention.retained7dCount} de 7+ días)`
                        : `${retention.retained30dCount} con memoria estimada de 30+ días · Haz tu primer repaso en el Cuaderno para medir tu retención`}
                    </p>
                    <p className="meta journey-follow-summary">
                      {chapterFollows.answered > 0
                        ? `Seguiste el hilo en ${chapterFollows.atEase} de ${chapterFollows.answered} capítulos · tu propia valoración`
                        : "Al cerrar un capítulo puedes marcar si seguiste el hilo; tu valoración aparecerá aquí"}
                    </p>
                  </>
                ) : (
                  <p className="meta">
                    Aún no has guardado palabras en tu cuaderno. Toca cualquier palabra mientras lees.
                  </p>
                )}
              </div>
            </section>

            {/* ======================================================== */}
            {/* BLOQUE: Tu Horizonte de Palabras (Crecimiento Léxico)   */}
            {/* ======================================================== */}
            <section
              className="journey-section journey-lexical-section"
              aria-label="Tu horizonte de palabras"
            >
              <div className="journey-section-head">
                <h2 className="journey-section-title">Tu horizonte de palabras</h2>
                <span className="meta">
                  {lexicalGrowths.length === 1
                    ? "1 idioma activo"
                    : `${lexicalGrowths.length} idiomas`}
                </span>
              </div>
              <p className="meta">
                Descubre cómo evoluciona tu vocabulario en cada idioma y el
                impacto de la lectura fluida sin fricción.
              </p>

              {lexicalGrowths.length > 1 ? (
                <div
                  className="journey-lang-pills"
                  role="tablist"
                  aria-label="Idiomas de lectura"
                >
                  {lexicalGrowths.map((g) => {
                    const isSelected = selectedLang === g.lang;
                    return (
                      <button
                        key={g.lang}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        className={`journey-lang-pill ${isSelected ? "journey-lang-pill--active" : ""}`}
                        onClick={() =>
                          setSelectedLang(selectedLang === g.lang ? "all" : g.lang)
                        }
                      >
                        {g.langLabel}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedLang === "all"}
                    className={`journey-lang-pill ${selectedLang === "all" ? "journey-lang-pill--active" : ""}`}
                    onClick={() => setSelectedLang("all")}
                  >
                    Todos
                  </button>
                </div>
              ) : null}

              <div className="journey-lang-grid">
                {displayedGrowths.map((g) => (
                  <article
                    key={g.lang}
                    className="journey-lang-card"
                    aria-label={`Evolución en ${g.langLabel}`}
                  >
                    <div className="journey-lang-card-header">
                      <div className="journey-lang-card-title-row">
                        <h3 className="journey-lang-stage-title">{g.stageTitle}</h3>
                        <span className="journey-lang-badge">{g.langLabel}</span>
                      </div>
                      <p className="journey-lang-stage-sub meta">{g.stageSubtitle}</p>
                      <span className="journey-lang-score-label meta">
                        Nivel léxico · {g.normalizedLevel}/100
                      </span>
                    </div>

                    <LexicalCurveSparkline
                      points={g.curvePoints}
                      lang={g.lang}
                      label={`Curva de crecimiento léxico en ${g.langLabel}: ${g.stageTitle}, nivel ${g.normalizedLevel}/100`}
                    />

                    <div
                      className="journey-mastery-split-bar"
                      role="progressbar"
                      aria-valuenow={g.passiveRatioPercent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Proporción de dominio en ${g.langLabel}: ${g.passiveRatioPercent}% de corrido`}
                    >
                      <div
                        className="journey-mastery-passive-fill"
                        style={{
                          width: `${g.totalMasteredCount > 0 ? g.passiveRatioPercent : 0}%`,
                        }}
                        title={`Leídas de corrido: ${g.passiveMasteredCount}`}
                      />
                      <div
                        className="journey-mastery-active-fill"
                        style={{
                          width: `${g.totalMasteredCount > 0 ? 100 - g.passiveRatioPercent : 0}%`,
                        }}
                        title={`Exploradas al tocar: ${g.activeQueriedCount}`}
                      />
                    </div>

                    <div className="journey-mastery-legend">
                      <div className="journey-mastery-card journey-mastery-card--passive">
                        <div className="journey-mastery-card-head">
                          <span aria-hidden="true">🌊</span>
                          <strong>Absorbidas de corrido ({g.passiveMasteredCount})</strong>
                        </div>
                        <p className="journey-mastery-card-desc meta">
                          Palabras integradas sin detener tu lectura gracias a la preparación previa.
                        </p>
                      </div>

                      <div className="journey-mastery-card journey-mastery-card--active">
                        <div className="journey-mastery-card-head">
                          <span aria-hidden="true">🔍</span>
                          <strong>Exploradas al tocar ({g.activeQueriedCount})</strong>
                        </div>
                        <p className="journey-mastery-card-desc meta">
                          Palabras consultadas y guardadas mientras leías.
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* 3. Récords personales */}
            <section
              className="journey-section"
              aria-label="Récords personales"
            >
              <h2 className="journey-section-title">Récords personales</h2>
              <div className="journey-records-card">
                <div className="journey-record-item">
                  <span className="journey-record-title">Día más lector</span>
                  <span className="journey-record-value">
                    {records.bestReadingDay
                      ? formatMinutes(records.bestReadingDay.minutes)
                      : "—"}
                  </span>
                  {records.bestReadingDay ? (
                    <span className="journey-record-sub meta">
                      {formatDate(records.bestReadingDay.dayKey)}
                    </span>
                  ) : null}
                </div>

                <div className="journey-record-item">
                  <span className="journey-record-title">
                    Sesión más larga
                  </span>
                  <span className="journey-record-value">
                    {records.longestSessionMinutes > 0
                      ? formatMinutes(records.longestSessionMinutes)
                      : "—"}
                  </span>
                  <span className="journey-record-sub meta">
                    Lectura continua
                  </span>
                </div>

                <div className="journey-record-item">
                  <span className="journey-record-title">
                    Día con más palabras
                  </span>
                  <span className="journey-record-value">
                    {records.bestWordsDay
                      ? `${records.bestWordsDay.count} ${records.bestWordsDay.count === 1 ? "palabra" : "palabras"}`
                      : "—"}
                  </span>
                  {records.bestWordsDay ? (
                    <span className="journey-record-sub meta">
                      {formatDate(records.bestWordsDay.dayKey)}
                    </span>
                  ) : null}
                </div>

                <div className="journey-record-item">
                  <span className="journey-record-title">
                    Día con más repasos
                  </span>
                  <span className="journey-record-value">
                    {records.bestReviewsDay
                      ? `${records.bestReviewsDay.count} ${records.bestReviewsDay.count === 1 ? "repaso" : "repasos"}`
                      : "—"}
                  </span>
                  {records.bestReviewsDay ? (
                    <span className="journey-record-sub meta">
                      {formatDate(records.bestReviewsDay.dayKey)}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>

            {/* 4. Historial de las últimas 8 semanas */}
            <section
              className="journey-section"
              aria-label="Historial de lectura"
            >
              <h2 className="journey-section-title">Últimas 8 semanas</h2>
              <div className="journey-chart-card">
                <div
                  className="journey-weeks-chart"
                  role="region"
                  aria-label="Minutos leídos por semana"
                >
                  {weeks.map((item) => {
                    const percent = Math.round(
                      (item.minutes / maxWeekMinutes) * 100,
                    );
                    return (
                      <div
                        key={item.weekIndex}
                        className="journey-week-col"
                        title={`${item.label}: ${formatMinutes(item.minutes)}`}
                      >
                        <span className="journey-week-time">
                          {item.minutes > 0 ? `${item.minutes}m` : ""}
                        </span>
                        <div className="journey-week-bar-wrap">
                          <div
                            className="journey-week-bar"
                            style={{
                              height: `${percent}%`,
                              minHeight: item.minutes > 0 ? "4px" : "1px",
                            }}
                          />
                        </div>
                        <span className="journey-week-label">{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* 5. Libros concluidos (Exlibris) */}
            <section
              className="journey-section"
              aria-label="Libros concluidos"
            >
              <h2 className="journey-section-title">Libros concluidos</h2>
              {finishedHashes.length === 0 ? (
                <p className="meta">
                  Aún no has terminado ningún libro. Cada sesión suma a tu
                  recorrido.
                </p>
              ) : (
                <div className="exlibris-grid">
                  {finishedHashes.map((hash) => {
                    const book = booksByHash.get(hash);
                    const label = bookLabel(book);
                    return (
                      <article key={hash} className="exlibris-card">
                        <div className="exlibris-frame">
                          {book ? (
                            <BookCover book={book} />
                          ) : (
                            <div
                              className="exlibris-seal-icon"
                              role="img"
                              aria-label="Sello de libro concluido"
                            >
                              <Seal
                                family="libros"
                                rank={1}
                                maxRank={3}
                                size={44}
                              />
                            </div>
                          )}
                        </div>
                        <div className="exlibris-meta">
                          <h3
                            className="exlibris-title"
                            title={displayTitle(book?.name ?? "", label.title)}
                          >
                            {displayTitle(book?.name ?? "", label.title)}
                          </h3>
                          {label.author ? (
                            <p className="exlibris-author">{label.author}</p>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 6. Sección de Compañero y Pasaporte de Sellos en 3 Categorías */}
            {companionEnabled && companion?.state && companionLevel ? (
              <section
                className="journey-section journey-companion-section"
                aria-label="Progreso del compañero"
              >
                <div className="journey-section-head">
                  <h2 className="journey-section-title">
                    Compañero · {companion.name}
                  </h2>
                  <span className="meta">
                    Nivel {companionLevel.level + 1} · {companionLevel.name}
                  </span>
                </div>

                <div className="journey-companion-stats">
                  <p className="meta">
                    {companion.state.stats.streakDays > 0
                      ? `${companion.state.stats.streakDays} ${companion.state.stats.streakDays === 1 ? "día seguido" : "días seguidos"} de lectura`
                      : "Sin racha activa"}
                    {" · "}
                    {companion.state.xp} puntos acumulados
                  </p>
                  <ProgressInk
                    value={companion.state.xp}
                    max={companionLevel.ceil ?? companionLevel.floor}
                    floor={companionLevel.floor}
                    level={companionLevel.level}
                    label="Puntos para el siguiente nivel"
                  />
                </div>

                <h3 className="eyebrow" style={{ marginTop: "var(--s-4)" }}>
                  Sellos obtenidos
                </h3>

                {/* Sellos agrupados en las 3 grandes categorías */}
                <div className="journey-seals-categories" role="list" aria-label="Sellos de familias">
                  {(["strategies", "words", "companion"] as SealCategory[]).map(
                    (cat) => {
                      const fams = sealsByCategory[cat];
                      if (!fams || fams.length === 0) return null;
                      return (
                        <div key={cat} className="journey-seals-category-block">
                          <h4 className="journey-category-title">
                            {SEAL_CATEGORY_LABELS[cat]}
                          </h4>
                          <div
                            className="journey-seals-row"
                            role="group"
                            aria-label={`Categoría: ${SEAL_CATEGORY_LABELS[cat]}`}
                          >
                            {fams.map((fam) => (
                              <div
                                key={fam.family}
                                className="journey-seal-item"
                                title={`${fam.info.name}: rango ${fam.ranksEarned} de ${fam.ranksTotal}`}
                              >
                                <Seal
                                  family={fam.family}
                                  rank={fam.ranksEarned}
                                  maxRank={fam.ranksTotal}
                                  size={48}
                                  category={cat}
                                  progressText={
                                    fam.nextAchievement
                                      ? `${Math.floor(fam.current)} / ${fam.goal}`
                                      : undefined
                                  }
                                  rewardIcon={
                                    fam.ranksEarned > 0 ? "✨" : undefined
                                  }
                                  onClick={() => {}}
                                />
                                <span className="journey-seal-label">
                                  {fam.info.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>

      {/* ======================================================== */}
      {/* MODAL 1: Buzón de Cartas del Gato                        */}
      {/* ======================================================== */}
      {isInboxOpen ? (
        <div
          className="journey-inbox-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Buzón del Gato"
        >
          <div className="journey-inbox-card">
            <div className="journey-inbox-head">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>Correspondencia</p>
                <h3 className="journey-inbox-title">Buzón de Tinta 💌</h3>
              </div>
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setIsInboxOpen(false)}
                aria-label="Cerrar buzón"
              >
                ✕
              </button>
            </div>

            <div className="journey-inbox-list">
              {letters.map((letter) => (
                <article
                  key={letter.id}
                  className={`journey-letter-card ${letter.read ? "" : "journey-letter-card--unread"}`}
                >
                  <div className="journey-letter-head">
                    <span className="journey-letter-title">{letter.title}</span>
                    <span className="meta">
                      {new Date(letter.date).toLocaleDateString("es-MX", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>
                  <p className="journey-letter-body">{letter.note}</p>
                  <div className="journey-letter-footer">
                    <span className="journey-letter-sign">{letter.signOff}</span>
                    {!letter.read ? (
                      <button
                        type="button"
                        className="btn--quiet journey-letter-read-btn"
                        onClick={() => handleMarkSingleLetterRead(letter.id)}
                      >
                        Marcar leída
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            <div className="journey-inbox-actions">
              {unreadLettersCount > 0 ? (
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={handleMarkAllLettersRead}
                >
                  Marcar todas como leídas
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => setIsInboxOpen(false)}
              >
                Cerrar buzón
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ======================================================== */}
      {/* MODAL 2: Ajuste de Meta Diaria                           */}
      {/* ======================================================== */}
      {isGoalModalOpen ? (
        <div
          className="journey-goal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Ajustar Meta Diaria"
        >
          <div className="journey-goal-card">
            <div className="journey-goal-head">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>Hábito Sostenible</p>
                <h3 className="journey-goal-title">Meta de Lectura Diaria 🎯</h3>
              </div>
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setIsGoalModalOpen(false)}
                aria-label="Cerrar selector de meta"
              >
                ✕
              </button>
            </div>

            <p className="meta" style={{ margin: "var(--s-2) 0 var(--s-4)" }}>
              ¿Cuántos minutos al día deseas dedicarle a la lectura? Una meta
              corta y constante alimenta el vínculo con tu gato y protege tu
              racha.
            </p>

            <div className="journey-goal-options" role="radiogroup" aria-label="Minutos diarios">
              {[5, 10, 15, 20, 30].map((mins) => {
                const isSelected = selectedGoalMinutes === mins;
                return (
                  <button
                    key={mins}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    className={`journey-goal-pill ${isSelected ? "journey-goal-pill--active" : ""}`}
                    onClick={() => setSelectedGoalMinutes(mins)}
                  >
                    <span className="goal-pill-mins">{mins}</span>
                    <span className="goal-pill-unit">min / día</span>
                  </button>
                );
              })}
            </div>

            <div className="journey-goal-quote">
              <span aria-hidden="true">🐾</span>
              <em>«Incluso 5 minutos al día llenan el tintero de grandes historias.»</em>
            </div>

            <div className="journey-goal-actions">
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setIsGoalModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => handleSaveGoal(selectedGoalMinutes)}
              >
                Guardar meta
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
