import { useEffect, useState } from "react";
import {
  captureDbScope,
  listIntervals,
  listReadingEvents,
  loadSessionValue,
  saveSessionValue,
  type SavedInterval,
  type SavedWord,
  type StoredBook,
} from "../lib/idb";
import { isDue } from "../lib/fsrs";
import {
  dayKeyOf,
  dayLabel,
  formatDuration,
  msByBook,
  timeByDay,
} from "../lib/reading-activity";
import {
  dayWpm,
  focusByDay,
  type DayFocus,
} from "../lib/focus-telemetry";
import {
  evaluateStreakProtection,
  MAX_STREAK_SHIELDS,
  parseReadingGoal,
  READING_GOAL_KEY,
  serializeReadingGoal,
  weeklyGoalProgress,
  type ReadingGoal,
} from "../lib/reading-goal";
import { loadActivityHidden, saveActivityHidden } from "../lib/settings";
import { activityToCsv, downloadText, type BookNamer } from "../lib/export";

type ReadingActivityProps = {
  // Igual que en Vocabulary: basta hash/título/nombre para nombrar.
  books: Pick<StoredBook, "hash" | "name" | "title">[];
  words: SavedWord[];
  // Sube cuando la sincronización trae intervalos nuevos: el panel
  // relee sin que el lector pierda su posición.
  activityVersion?: number;
  onOpenJourney?: () => void;
};

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

// Estadísticas discretas: tiempo real medido por el lector, por día y
// por libro. La meta semanal es opcional y cuenta días, no rachas.
export default function ReadingActivity({
  books,
  words,
  activityVersion = 0,
  onOpenJourney,
}: ReadingActivityProps) {
  const [intervals, setIntervals] = useState<SavedInterval[] | null>(null);
  const [goal, setGoal] = useState<ReadingGoal | null>(null);
  const [shieldMsg, setShieldMsg] = useState<string | null>(null);
  // Atención por día desde el trayecto local (readingEvents).
  const [focusDays, setFocusDays] = useState<DayFocus[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [hidden, setHidden] = useState(() => loadActivityHidden());
  // «Ahora» se captura al cargar los datos, no en cada render: la
  // meta y la semana se recalculan solo cuando llegan datos nuevos.
  const [now, setNow] = useState(() => Date.now());
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void Promise.all([
      listIntervals(scope),
      loadSessionValue(READING_GOAL_KEY, scope),
      listReadingEvents(undefined, scope),
    ])
      .then(([list, rawGoal, events]) => {
        if (cancelled) return;
        setNow(Date.now());
        setIntervals(list);
        const parsedGoal = parseReadingGoal(rawGoal);
        let activeGoal = parsedGoal;
        if (parsedGoal) {
          const readDays = new Set(
            timeByDay(list, timeZone)
              .filter((d) => d.ms >= 60_000)
              .map((d) => d.dayKey),
          );
          const today = dayKeyOf(Date.now(), timeZone);
          const [y, m, d] = today.split("-").map(Number);
          const yesterday = dayKeyOf(Date.UTC(y, m - 1, d - 1, 12), timeZone);
          const { updatedGoal, protectedYesterday, catMessage } = evaluateStreakProtection(
            parsedGoal,
            readDays,
            today,
            yesterday,
          );
          if (protectedYesterday && catMessage) {
            setShieldMsg(catMessage);
            if (updatedGoal && updatedGoal !== parsedGoal) {
              activeGoal = updatedGoal;
              void saveSessionValue(
                READING_GOAL_KEY,
                serializeReadingGoal(
                  updatedGoal.daysPerWeek,
                  updatedGoal.updatedAt,
                  updatedGoal.streakShields,
                  updatedGoal.lastShieldUsedDay,
                ),
                scope,
              );
            }
          }
        }
        setGoal(activeGoal);
        setFocusDays(
          focusByDay(
            events,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activityVersion, timeZone]);

  const toggleHidden = () => {
    const next = !hidden;
    setHidden(next);
    saveActivityHidden(next);
  };

  const bookName: BookNamer = (hash) => {
    if (!hash) return undefined;
    const found = books.find((item) => item.hash === hash);
    return found ? (found.title ?? found.name) : "Libro que ya no está";
  };

  if (hidden) {
    return (
      <section aria-label="Actividad">
        <p className="nb-empty">
          Tu actividad está oculta. Los datos se siguen guardando en este
          dispositivo por si cambias de idea.
        </p>
        <button type="button" className="btn--quiet" onClick={toggleHidden}>
          Mostrar actividad
        </button>
      </section>
    );
  }

  if (loadError) {
    return (
      <p className="nb-empty" role="alert">
        No se pudo leer tu actividad en este dispositivo.
      </p>
    );
  }
  if (intervals === null) return <p className="meta">Leyendo tu actividad…</p>;

  const days = timeByDay(intervals, timeZone);
  // Últimos 7 días naturales, haya o no lectura: los días vacíos también
  // se muestran, igual que los puntos de la estantería.
  const week: { dayKey: string; ms: number }[] = [];
  const todayKey = dayKeyOf(now, timeZone);
  {
    const byKey = new Map(days.map((day) => [day.dayKey, day.ms]));
    const cursor = new Date(now);
    cursor.setHours(0, 0, 0, 0);
    for (let i = WEEK_DAYS - 1; i >= 0; i -= 1) {
      const day = new Date(cursor.getTime() - i * DAY_MS);
      const key = [
        day.getFullYear(),
        String(day.getMonth() + 1).padStart(2, "0"),
        String(day.getDate()).padStart(2, "0"),
      ].join("-");
      week.push({ dayKey: key, ms: byKey.get(key) ?? 0 });
    }
  }
  const maxDay = Math.max(...week.map((day) => day.ms), 1);

  // Mapa de tinta: últimos 28 días naturales (4 semanas compactas)
  const monthDays: { dayKey: string; ms: number }[] = [];
  {
    const byKey = new Map(days.map((day) => [day.dayKey, day.ms]));
    const cursor = new Date(now);
    cursor.setHours(0, 0, 0, 0);
    for (let i = 27; i >= 0; i -= 1) {
      const day = new Date(cursor.getTime() - i * DAY_MS);
      const key = [
        day.getFullYear(),
        String(day.getMonth() + 1).padStart(2, "0"),
        String(day.getDate()).padStart(2, "0"),
      ].join("-");
      monthDays.push({ dayKey: key, ms: byKey.get(key) ?? 0 });
    }
  }

  // Meta de la semana (lunes a domingo): días con al menos un minuto
  // acumulado. Es una vista distinta de «Últimos 7 días»: rótulo propio.
  const goalProgress =
    goal?.daysPerWeek != null
      ? weeklyGoalProgress(intervals, now, timeZone, goal.daysPerWeek)
      : null;

  const byBook = msByBook(intervals);
  const bookRows = [...byBook.entries()].sort((a, b) => b[1] - a[1]);
  const countFor = (hash: string) => {
    const own = words.filter((word) => word.bookHash === hash);
    return { total: own.length, due: own.filter((word) => isDue(word.card)).length };
  };

  const exportCsv = () =>
    downloadText(
      `actividad-lecta-${new Date().toISOString().slice(0, 10)}.csv`,
      activityToCsv(intervals, bookName, timeZone),
      "text/csv;charset=utf-8",
    );

  return (
    <section aria-label="Actividad" className="act">
      {goal ? (
        <section className="act-streak-shield" aria-label="Escudo de Ronroneo">
          <div className="act-shield-badge">
            <span className="act-shield-icon" aria-hidden="true">🛡️ 🐾</span>
            <div className="act-shield-details">
              <strong className="act-shield-title">
                Escudo de Ronroneo: {goal.streakShields ?? 0}/{MAX_STREAK_SHIELDS}
              </strong>
              {shieldMsg ? (
                <p className="act-shield-quote" role="status">{shieldMsg}</p>
              ) : (
                <p className="meta">
                  {(goal.streakShields ?? 0) > 0
                    ? "Tu racha está protegida si un día no puedes leer."
                    : "Completa 3 días seguidos de lectura para recargar un escudo."}
                </p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {goalProgress ? (
        <section aria-label="Meta de la semana">
          <h2 className="eyebrow act-eyebrow">Meta de la semana</h2>
          <div className="act-goal-track" style={{ display: "flex", alignItems: "center", gap: "var(--s-4)", marginBlock: "var(--s-2)" }}>
            <div
              className="progress-ring shelf-goal-ring-widget"
              role="progressbar"
              aria-label="Meta semanal de lectura"
              aria-valuenow={Math.min(100, Math.round((goalProgress.readDays / Math.max(1, goalProgress.target)) * 100))}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ width: "40px", height: "40px", flexShrink: 0 }}
            >
              <svg className="shelf-goal-ring-svg" viewBox="0 0 36 36" aria-hidden="true" style={{ width: "100%", height: "100%" }}>
                <path
                  className="goal-ring-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="goal-ring-fill"
                  strokeDasharray={`${Math.min(100, Math.round((goalProgress.readDays / Math.max(1, goalProgress.target)) * 100))}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
            </div>
            <div className="dots act-ink-drops" role="list" aria-label="Lunes a domingo" style={{ flex: 1 }}>
              {goalProgress.days.map(({ dayKey, read }) => {
                const dayMs = days.find((d) => d.dayKey === dayKey)?.ms ?? 0;
                const fillPct = Math.min(100, Math.round((dayMs / (15 * 60_000)) * 100));
                return (
                  <span
                    key={dayKey}
                    role="img"
                    className={`dot dot--day act-ink-drop${read ? " dot--done act-ink-drop--read" : ""}`}
                    title={`${dayLabel(dayKey)}: ${formatDuration(dayMs)}`}
                    aria-label={`${dayLabel(dayKey)}: ${read ? "con lectura" : "sin lectura"}`}
                    data-fill={fillPct}
                  />
                );
              })}
            </div>
          </div>
          <p className="meta">
            {goalProgress.readDays} de {goalProgress.target} días con lectura
            {goalProgress.met ? " · cumplida" : ""}
          </p>
        </section>
      ) : null}
      {intervals.length === 0 ? (
        <p className="nb-empty">
          Aún no hay lectura registrada.
          <br />
          El tiempo empieza a contarse desde esta versión, solo mientras lees.
        </p>
      ) : (
        <>
          <section aria-label="Últimos siete días">
            <h2 className="eyebrow act-eyebrow">Últimos 7 días</h2>
            <ul className="act-days">
              {week.map(({ dayKey, ms }) => (
                <li key={dayKey} className="act-day">
                  <span className="act-day-label">
                    {dayKey === todayKey ? "hoy" : dayLabel(dayKey)}
                  </span>
                  <span
                    className="act-day-bar"
                    role="img"
                    aria-label={ms ? formatDuration(ms) : "sin lectura"}
                  >
                    <span
                      className="act-day-fill"
                      style={{ inlineSize: `${Math.round((ms / maxDay) * 100)}%` }}
                      data-empty={ms === 0 || undefined}
                    />
                  </span>
                  <span className="act-day-time meta">
                    {ms ? formatDuration(ms) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Mapa de tinta: últimos 28 días con 4 tonos de terracota según intensidad */}
          <section aria-label="Mapa de tinta mensual" className="act-month-map-section">
            <h2 className="eyebrow act-eyebrow">Mapa de tinta (últimos 28 días)</h2>
            <div className="act-month-grid" role="grid" aria-label="Mapa de calor de lectura">
              {monthDays.map(({ dayKey, ms }) => {
                const intensity =
                  ms === 0 ? 0 : ms < 10 * 60_000 ? 1 : ms < 30 * 60_000 ? 2 : 3;
                return (
                  <div
                    key={dayKey}
                    className={`act-month-cell act-month-cell--level-${intensity}`}
                    title={`${dayLabel(dayKey)}: ${ms ? formatDuration(ms) : "sin lectura"}`}
                    role="gridcell"
                  />
                );
              })}
            </div>
            <div className="act-month-legend">
              <span className="meta">Menos</span>
              <span className="act-month-swatch act-month-cell--level-0" title="Sin lectura" />
              <span className="act-month-swatch act-month-cell--level-1" title="1-10 min" />
              <span className="act-month-swatch act-month-cell--level-2" title="10-30 min" />
              <span className="act-month-swatch act-month-cell--level-3" title="Más de 30 min" />
              <span className="meta">Más tinta</span>
            </div>
          </section>

          {(() => {
            // Atención y ritmo: dwell real por sección, retrocesos y
            // consultas del trayecto local. Solo se muestra si algún
            // día de la semana tiene datos — con el trayecto apagado
            // la sección simplemente no aparece.
            const focusMap = new Map(focusDays.map((d) => [d.dayKey, d]));
            const rows = week.map(
              ({ dayKey }) =>
                focusMap.get(dayKey) ?? {
                  dayKey,
                  dwellMs: 0,
                  words: 0,
                  regressions: 0,
                  consults: 0,
                  fatigue: 0,
                },
            );
            if (!rows.some((d) => d.dwellMs > 0 || d.regressions > 0 || d.consults > 0))
              return null;
            const maxDwell = Math.max(...rows.map((d) => d.dwellMs), 1);
            return (
              <section aria-label="Atención y ritmo">
                <h2 className="eyebrow act-eyebrow">Atención y ritmo</h2>
                <ul className="act-days">
                  {rows.map((day) => {
                    const w = dayWpm(day);
                    const bits = [
                      day.dwellMs ? formatDuration(day.dwellMs) : "—",
                      day.regressions
                        ? `${day.regressions} retroceso${day.regressions === 1 ? "" : "s"}`
                        : null,
                      day.consults
                        ? `${day.consults} consulta${day.consults === 1 ? "" : "s"}`
                        : null,
                      w ? `≈${w} ppm` : null,
                      day.fatigue ? "fatiga" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={day.dayKey} className="act-day">
                        <span className="act-day-label">
                          {day.dayKey === todayKey ? "hoy" : dayLabel(day.dayKey)}
                        </span>
                        <span
                          className="act-day-bar"
                          role="img"
                          aria-label={bits || "sin lectura"}
                        >
                          <span
                            className="act-day-fill"
                            style={{
                              inlineSize: `${Math.round((day.dwellMs / maxDwell) * 100)}%`,
                            }}
                            data-empty={day.dwellMs === 0 || undefined}
                          />
                        </span>
                        <span className="act-day-time meta">{bits}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="meta">
                  Tiempo con el texto en pantalla, retrocesos y consultas
                  del diccionario. Solo en este dispositivo.
                </p>
              </section>
            );
          })()}

          <section aria-label="Por libro">
            <h2 className="eyebrow act-eyebrow">Por libro</h2>
            <ul className="act-books">
              {bookRows.map(([hash, ms]) => {
                const { total, due } = countFor(hash);
                return (
                  <li key={hash} className="act-book">
                    <span className="act-book-title">{bookName(hash)}</span>
                    <span className="meta">
                      {formatDuration(ms)}
                      {total
                        ? ` · ${total} con ficha${due ? ` · ${due} para hoy` : ""}`
                        : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <div className="nb-export act-actions">
        {onOpenJourney ? (
          <button type="button" className="btn--quiet" onClick={onOpenJourney}>
            Ver recorrido completo…
          </button>
        ) : null}
        {intervals.length > 0 ? (
          <button type="button" className="btn--quiet" onClick={exportCsv}>
            Exportar actividad CSV
          </button>
        ) : null}
        <button type="button" className="btn--quiet" onClick={toggleHidden}>
          Ocultar actividad
        </button>
      </div>
    </section>
  );
}
