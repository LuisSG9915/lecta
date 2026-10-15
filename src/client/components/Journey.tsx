import { useEffect, useMemo, useRef, useState } from "react";
import { useModalBehavior } from "../lib/modal";
import {
  captureDbScope,
  listAllReviews,
  listIntervals,
  listPositions,
  listSavedWords,
  loadSessionValue,
  saveSessionValue,
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
  finishedBookHashes,
  inkPathNodes,
  literaryRankFor,
  readingRecords,
  totalReadingMs,
  weeksHistory,
  wordStages,
  type InkMilestoneNode,
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

export default function Journey({ onClose, books }: JourneyProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);

  const [loading, setLoading] = useState(true);
  const [intervals, setIntervals] = useState<SavedInterval[]>([]);
  const [words, setWords] = useState<SavedWord[]>([]);
  const [positions, setPositions] = useState<SavedBookPosition[]>([]);
  const [reviews, setReviews] = useState<SavedReview[]>([]);

  // Estados interactivos para hitos y modales
  const [activeMilestone, setActiveMilestone] =
    useState<InkMilestoneNode | null>(null);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [selectedGoalMinutes, setSelectedGoalMinutes] = useState(15);

  const companion = useCompanionSafe();
  const companionEnabled = Boolean(companion?.enabled && companion?.state);

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
      listIntervals(scope).catch(() => []),
      listSavedWords(undefined, scope).catch(() => []),
      listPositions(scope).catch(() => []),
      listAllReviews(scope).catch(() => []),
      Promise.resolve(loadSessionValue(COMPANION_LETTERS_KEY, scope)).catch(() => null),
      Promise.resolve(loadSessionValue(READING_GOAL_KEY, scope)).catch(() => null),
    ]).then(([ints, wrds, pos, revs, rawLetters, rawGoal]) => {
      if (cancelled) return;
      setIntervals(ints);
      setWords(wrds.filter((w) => !w.deleted));
      setPositions(pos);
      setReviews(revs);
      const parsedLetters = parseCompanionLetters(rawLetters);
      if (parsedLetters.length > 0) {
        setLetters(parsedLetters);
      }
      const parsedGoal = parseReadingGoal(rawGoal);
      if (parsedGoal) {
        setSelectedGoalMinutes(15);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalMs = useMemo(() => totalReadingMs(intervals), [intervals]);
  const totalMinutes = useMemo(
    () => Math.round(totalMs / 60_000),
    [totalMs],
  );
  const stages = useMemo(() => wordStages(words), [words]);
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
                  </>
                ) : (
                  <p className="meta">
                    Aún no has guardado palabras en tu cuaderno. Toca cualquier palabra mientras lees.
                  </p>
                )}
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
