import { useEffect, useMemo, useRef, useState } from "react";
import { useModalBehavior } from "../lib/modal";
import {
  captureDbScope,
  listAllReviews,
  listIntervals,
  listPositions,
  listSavedWords,
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
  finishedBookHashes,
  readingRecords,
  totalReadingMs,
  weeksHistory,
  wordStages,
} from "../lib/journey";
import { Seal } from "./Seal";
import { ProgressInk } from "./ProgressInk";
import BookCover from "./BookCover";
import { displayTitle } from "../lib/cover";

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

export default function Journey({ onClose, books }: JourneyProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);

  const [loading, setLoading] = useState(true);
  const [intervals, setIntervals] = useState<SavedInterval[]>([]);
  const [words, setWords] = useState<SavedWord[]>([]);
  const [positions, setPositions] = useState<SavedBookPosition[]>([]);
  const [reviews, setReviews] = useState<SavedReview[]>([]);

  const companion = useCompanionSafe();
  const companionEnabled = Boolean(companion?.enabled && companion?.state);

  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    Promise.all([
      listIntervals(scope).catch(() => []),
      listSavedWords(undefined, scope).catch(() => []),
      listPositions(scope).catch(() => []),
      listAllReviews(scope).catch(() => []),
    ]).then(([ints, wrds, pos, revs]) => {
      if (cancelled) return;
      setIntervals(ints);
      setWords(wrds.filter((w) => !w.deleted));
      setPositions(pos);
      setReviews(revs);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalMs = useMemo(() => totalReadingMs(intervals), [intervals]);
  const stages = useMemo(() => wordStages(words), [words]);
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
    return Math.max(max, 30); // escala mínima para barras visibles
  }, [weeks]);

  // Mapa de libros por hash para resolver títulos y portadas
  const booksByHash = useMemo(
    () => new Map(books.map((b) => [b.hash, b])),
    [books],
  );

  const familyList = companion?.state ? listFamilyProgress(companion.state) : [];
  const companionLevel = companion?.state ? levelProgress(companion.state.xp) : null;

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
            {/* 1. Métricas clave en resumen */}
            <section
              className="journey-summary"
              aria-label="Resumen de lectura"
            >
              <div className="journey-stat-card">
                <span className="journey-stat-value">
                  {formatMinutes(Math.round(totalMs / 60_000))}
                </span>
                <span className="journey-stat-label">Tiempo leído</span>
              </div>
              <div className="journey-stat-card">
                <span className="journey-stat-value">
                  {finishedHashes.length}
                </span>
                <span className="journey-stat-label">
                  {finishedHashes.length === 1
                    ? "Libro terminado"
                    : "Libros terminados"}
                </span>
              </div>
              <div className="journey-stat-card">
                <span className="journey-stat-value">{words.length}</span>
                <span className="journey-stat-label">Palabras guardadas</span>
              </div>
            </section>

            {/* 2. Vocabulario por etapas FSRS */}
            <section
              className="journey-section"
              aria-label="Vocabulario por etapas"
            >
              <div className="journey-section-head">
                <h2 className="journey-section-title">Vocabulario por etapas</h2>
                <span className="meta">{stages.total} palabras en total</span>
              </div>
              <p className="meta">
                Estado de consolidación de tus palabras según el algoritmo de
                repetición espaciada FSRS.
              </p>

              <div className="journey-stages-grid">
                <div className="journey-stage-item">
                  <span className="journey-stage-count">
                    {stages.masteredCount}
                  </span>
                  <span className="journey-stage-name">Dominadas</span>
                </div>
                <div className="journey-stage-item">
                  <span className="journey-stage-count">
                    {stages.settledCount}
                  </span>
                  <span className="journey-stage-name">En consolidación</span>
                </div>
                <div className="journey-stage-item">
                  <span className="journey-stage-count">
                    {stages.learningCount}
                  </span>
                  <span className="journey-stage-name">En aprendizaje</span>
                </div>
                <div className="journey-stage-item">
                  <span className="journey-stage-count">{stages.newCount}</span>
                  <span className="journey-stage-name">Por repasar</span>
                </div>
              </div>
            </section>

            {/* 3. Récords personales */}
            <section
              className="journey-section"
              aria-label="Récords personales"
            >
              <h2 className="journey-section-title">Récords personales</h2>
              <div className="journey-records-grid">
                <div className="journey-record-card">
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

                <div className="journey-record-card">
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

                <div className="journey-record-card">
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

                <div className="journey-record-card">
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

            {/* 6. Sección de Compañero (solo si está activo) */}
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

                <h3 className="eyebrow" style={{ marginTop: "var(--s-3)" }}>
                  Sellos obtenidos
                </h3>
                <div
                  className="journey-seals-row"
                  role="list"
                  aria-label="Sellos de familias"
                >
                  {familyList.map((fam) => (
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
                      />
                      <span className="journey-seal-label">
                        {fam.info.name}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
