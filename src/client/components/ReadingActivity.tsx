import { useEffect, useState } from "react";
import {
  captureDbScope,
  listIntervals,
  loadSessionValue,
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
  parseReadingGoal,
  READING_GOAL_KEY,
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
};

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

// Estadísticas discretas: tiempo real medido por el lector, por día y
// por libro. La meta semanal es opcional y cuenta días, no rachas.
export default function ReadingActivity({
  books,
  words,
  activityVersion = 0,
}: ReadingActivityProps) {
  const [intervals, setIntervals] = useState<SavedInterval[] | null>(null);
  const [goal, setGoal] = useState<ReadingGoal | null>(null);
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
    ])
      .then(([list, rawGoal]) => {
        if (cancelled) return;
        setNow(Date.now());
        setIntervals(list);
        setGoal(parseReadingGoal(rawGoal));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activityVersion]);

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
      {goalProgress ? (
        <section aria-label="Meta de la semana">
          <h2 className="eyebrow act-eyebrow">Meta de la semana</h2>
          <div className="dots" role="list" aria-label="Lunes a domingo">
            {goalProgress.days.map(({ dayKey, read }) => (
              <span
                key={dayKey}
                role="img"
                className={`dot dot--day${read ? " dot--done" : ""}`}
                title={dayLabel(dayKey)}
                aria-label={`${dayLabel(dayKey)}: ${read ? "con lectura" : "sin lectura"}`}
              />
            ))}
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
