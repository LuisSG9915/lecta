import { useMemo, type ReactNode } from "react";
import type {
  SavedBookPosition,
  SavedInterval,
  SavedReview,
  SavedWord,
  StoredBook,
} from "../lib/idb";
import {
  booksInProgress,
  readingHabits,
  recallByWeek,
  upcomingReviews,
  yearSummary,
} from "../lib/journey-insights";
import { formatDuration } from "../lib/reading-activity";

// «Tu análisis»: cifras personales dentro de «Tu recorrido». Reusa las
// clases de barras del recorrido (journey-weeks-chart) para no inventar
// un lenguaje visual nuevo, y cada bloque cuenta lo medido en texto —
// las barras son apoyo, no el único canal.

type JourneyInsightsProps = {
  intervals: SavedInterval[];
  positions: SavedBookPosition[];
  reviews: SavedReview[];
  words: SavedWord[];
  books: Pick<StoredBook, "hash" | "name" | "title" | "author">[];
  // Gráfica «Últimas 8 semanas» del recorrido: se pinta como primer
  // bloque para emparejarla con «Cuándo lees» en la cuadrícula.
  weeksChart?: ReactNode;
};

const BAR_COLS = "journey-weeks-chart";

export default function JourneyInsights({
  intervals,
  positions,
  reviews,
  words,
  books,
  weeksChart,
}: JourneyInsightsProps) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const habits = useMemo(
    () => readingHabits(intervals, timeZone),
    [intervals, timeZone],
  );
  const inProgress = useMemo(
    () => booksInProgress(intervals, positions, books),
    [intervals, positions, books],
  );
  const recall = useMemo(
    () => recallByWeek(reviews, 8),
    [reviews],
  );
  const upcoming = useMemo(
    () => upcomingReviews(words, 14, timeZone),
    [words, timeZone],
  );
  const year = useMemo(
    () => yearSummary(intervals, timeZone),
    [intervals, timeZone],
  );

  const maxHourMin = Math.max(...habits.byHour, 0);
  const maxRecall = Math.max(
    ...recall.map((w) => w.verified),
    0,
  );
  const maxDue = Math.max(...upcoming.byDay.map((d) => d.count), 0);
  const maxMonthMin = Math.max(...year.months.map((m) => m.minutes), 0);

  const hoursText =
    habits.topHours.length > 0
      ? habits.topHours
          .map((h) => `de ${h}:00 a ${(h + 1) % 24}:00`)
          .join(", ")
      : null;

  return (
    <section
      className="journey-section journey-insights"
      aria-label="Tu análisis"
      data-testid="journey-insights"
    >
      <h2 className="journey-section-title">Tu análisis</h2>
      <p className="meta">
        Cifras medidas en este dispositivo y en tu cuenta. Lo estimado
        va marcado como estimado.
      </p>

      {weeksChart ? (
        <div className="journey-insight-block">
          <h3 className="journey-insight-title">Últimas 8 semanas</h3>
          {weeksChart}
        </div>
      ) : null}

      {habits.totalMin > 0 ? (
        <div className="journey-insight-block">
          <h3 className="journey-insight-title">Cuándo lees</h3>
          <div
            className={`${BAR_COLS} journey-weeks-chart--dense`}
            role="region"
            aria-label="Minutos leídos por hora del día"
          >
            {habits.byHour.map((min, hour) => {
              const pct =
                maxHourMin > 0 ? Math.round((min / maxHourMin) * 100) : 0;
              return (
                <div
                  key={hour}
                  className="journey-week-col"
                  title={`${hour}:00–${(hour + 1) % 24}:00 · ${formatDuration(min * 60_000)}`}
                >
                  <span className="journey-week-time">
                    {min > 0 ? `${min}m` : ""}
                  </span>
                  <div className="journey-week-bar-wrap">
                    <div
                      className="journey-week-bar"
                      style={{
                        height: `${pct}%`,
                        minHeight: min > 0 ? "4px" : "1px",
                      }}
                    />
                  </div>
                  <span className="journey-week-label">
                    {hour % 3 === 0 ? hour : ""}
                  </span>
                </div>
              );
            })}
          </div>
          {hoursText ? (
            <p className="meta">
              Sueles leer {hoursText}. Es una hora según tu reloj.
            </p>
          ) : null}
        </div>
      ) : null}

      {inProgress.length > 0 ? (
        <div className="journey-insight-block">
          <h3 className="journey-insight-title">Libros en curso</h3>
          <ul className="journey-insight-list">
            {inProgress.map((b) => (
              <li key={b.bookHash} className="journey-insight-item">
                <span className="journey-insight-book">
                  <strong>{b.title}</strong>
                  {b.author ? <span className="meta">{b.author}</span> : null}
                </span>
                <span className="meta">
                  {Math.round(b.progress * 100)}% ·{" "}
                  {formatDuration(b.minutes * 60_000)} leídos
                  {b.remainingMin != null
                    ? ` · te faltan aprox. ${formatDuration(b.remainingMin * 60_000)} (estimado)`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {maxRecall > 0 ? (
        <div className="journey-insight-block">
          <h3 className="journey-insight-title">Aciertos por semana</h3>
          <div
            className={BAR_COLS}
            role="region"
            aria-label="Porcentaje de aciertos por semana"
          >
            {recall.map((w) => {
              const pct = w.pct ?? 0;
              return (
                <div
                  key={w.weekIndex}
                  className="journey-week-col"
                  title={`${w.label}: ${w.pct ?? "—"}% (${w.hits} de ${w.verified} repasos)`}
                >
                  <span className="journey-week-time">
                    {w.pct != null ? `${w.pct}%` : ""}
                  </span>
                  <div className="journey-week-bar-wrap">
                    <div
                      className="journey-week-bar journey-week-bar--recall"
                      style={{
                        height: `${pct}%`,
                        minHeight: w.verified > 0 ? "4px" : "1px",
                      }}
                    />
                  </div>
                  <span className="journey-week-label">{w.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {upcoming.dueNow > 0 || upcoming.totalAhead > 0 ? (
        <div className="journey-insight-block">
          <h3 className="journey-insight-title">
            Próximos repasos (14 días)
          </h3>
          <div
            className={`${BAR_COLS} journey-weeks-chart--dense`}
            role="region"
            aria-label="Repasos que vencen cada día"
          >
            {upcoming.byDay.map((d) => {
              const pct =
                maxDue > 0 ? Math.round((d.count / maxDue) * 100) : 0;
              return (
                <div
                  key={d.dayKey}
                  className="journey-week-col"
                  title={`${d.label}: ${d.count} repasos`}
                >
                  <span className="journey-week-time">
                    {d.count > 0 ? d.count : ""}
                  </span>
                  <div className="journey-week-bar-wrap">
                    <div
                      className="journey-week-bar"
                      style={{
                        height: `${pct}%`,
                        minHeight: d.count > 0 ? "4px" : "1px",
                      }}
                    />
                  </div>
                  <span className="journey-week-label">{d.label}</span>
                </div>
              );
            })}
          </div>
          <p className="meta">
            {upcoming.dueNow > 0
              ? `Hoy te esperan ${upcoming.dueNow} repasos.`
              : "Hoy no te espera ningún repaso."}
            {upcoming.totalAhead > 0
              ? ` En los próximos 13 días vencen ${upcoming.totalAhead} más.`
              : ""}
          </p>
        </div>
      ) : null}

      {year.totalMinutes > 0 ? (
        <div className="journey-insight-block">
          <h3 className="journey-insight-title">Tu año de lectura</h3>
          <div
            className={`${BAR_COLS} journey-weeks-chart--dense`}
            role="region"
            aria-label="Minutos leídos por mes"
          >
            {year.months.map((m) => {
              const pct =
                maxMonthMin > 0
                  ? Math.round((m.minutes / maxMonthMin) * 100)
                  : 0;
              return (
                <div
                  key={m.monthKey}
                  className="journey-week-col"
                  title={`${m.label}: ${formatDuration(m.minutes * 60_000)} en ${m.daysActive} días`}
                >
                  <span className="journey-week-time">
                    {m.minutes > 0 ? `${m.minutes}m` : ""}
                  </span>
                  <div className="journey-week-bar-wrap">
                    <div
                      className="journey-week-bar"
                      style={{
                        height: `${pct}%`,
                        minHeight: m.minutes > 0 ? "4px" : "1px",
                      }}
                    />
                  </div>
                  <span className="journey-week-label">{m.label}</span>
                </div>
              );
            })}
          </div>
          <p className="meta">
            {formatDuration(year.totalMinutes * 60_000)} en{" "}
            {year.daysActive}{" "}
            {year.daysActive === 1 ? "día" : "días"} del último año.
          </p>
        </div>
      ) : null}

      {habits.totalMin === 0 &&
      inProgress.length === 0 &&
      maxRecall === 0 &&
      year.totalMinutes === 0 ? (
        <p className="meta">
          Aquí verás tus horarios, libros en curso y repasos cuando haya
          lectura registrada.
        </p>
      ) : null}
    </section>
  );
}
