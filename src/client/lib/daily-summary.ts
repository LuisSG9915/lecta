// Resumen diario por dispositivo (telemetría de la fase de análisis).
//
// Convierte los eventos locales (readingEvents), los intervalos y los
// repasos del día en UNA fila por día con conteos y totales — nunca
// texto ni palabras — y la empuja a /api/daily-summaries una vez por
// ciclo de sincronización. Cada día lleva una huella del contenido:
// si nada cambió no se reenvía, y si el servidor rechaza (tabla sin
// migrar, sin red) el siguiente ciclo lo reintenta sin más trabajo.

import {
  captureDbScope,
  isDbScopeActive,
  listIntervals,
  listAllReviews,
  listReadingEvents,
  loadSessionValue,
  saveSessionValue,
  type DbScope,
  type ReadingEvent,
  type SavedInterval,
  type SavedReview,
} from "./idb";
import { accountFetch } from "./account-fetch";
import { isSyncPaused } from "./sync-state";
import { dayKeyOf, mergeIntervals, timeByDay } from "./reading-activity";
import { dayWpm, focusByDay } from "./focus-telemetry";
import { isRecallHit, isVerifiedReview, classifyDevice } from "../../shared/admin-insights";

// Días hacia atrás que el push considera: suficiente para cubrir un
// dispositivo que estuvo un mes apagado sin mandar toda la historia.
const PUSH_WINDOW_DAYS = 35;
// No más de un envío por ciclo cada este tiempo si nada cambió.
const PUSH_INTERVAL_MS = 12 * 3_600_000;
const PUSH_STATE_KEY = "dailySummaryPush:v1";

export type DailySummaryRow = {
  day: string;
  tz: string;
  device: string;
  minutes: number;
  dwellMs: number;
  wordsRead: number;
  /** Palabras por minuto del día (0 = sin muestra suficiente). */
  wpm: number;
  consults: number;
  regressions: number;
  fatigue: number;
  wordsSaved: number;
  reviews: number;
  reviewHits: number;
  prepAnswered: number;
  prepKnown: number;
  ttsMs: number;
  tipsShown: number;
  tipsAccepted: number;
};

// Agrega el día completo de un dispositivo. Los minutos salen de los
// intervalos unidos (misma regla que el recorrido); el foco y la voz,
// de los eventos locales; los repasos, de las filas del cuaderno con
// la misma regla de aciertos que usa todo lo demás.
export function computeDailySummaries(
  events: ReadingEvent[],
  intervals: SavedInterval[],
  reviews: SavedReview[],
  timeZone: string,
  device: string,
  nowMs = Date.now(),
  days = PUSH_WINDOW_DAYS,
): DailySummaryRow[] {
  const firstDay = dayKeyOf(nowMs - (days - 1) * 86_400_000, timeZone);
  const inWindow = (ts: number) => dayKeyOf(ts, timeZone) >= firstDay;

  const windowEvents = events.filter((e) => inWindow(e.createdAt));
  const windowIntervals = intervals.filter(
    (i) => inWindow(i.startedAt) || inWindow(i.endedAt),
  );
  const windowReviews = reviews.filter((r) => inWindow(r.createdAt));

  const minutesByDay = new Map<string, number>();
  for (const d of timeByDay(mergeIntervals(windowIntervals), timeZone)) {
    minutesByDay.set(d.dayKey, Math.round(d.ms / 60_000));
  }

  const focusDays = new Map(focusByDay(windowEvents, timeZone).map((d) => [d.dayKey, d]));

  const reviewsByDay = new Map<string, { n: number; hits: number }>();
  for (const r of windowReviews) {
    if (!isVerifiedReview(r.kind)) continue;
    const key = dayKeyOf(r.createdAt, timeZone);
    const slot = reviewsByDay.get(key) ?? { n: 0, hits: 0 };
    slot.n += 1;
    if (isRecallHit(r.rating)) slot.hits += 1;
    reviewsByDay.set(key, slot);
  }

  // Conteos de eventos que no son de foco: guardados, preparación,
  // voz y consejos.
  const extra = new Map<
    string,
    { saved: number; prepAnswered: number; prepKnown: number; ttsMs: number; tipsShown: number; tipsAccepted: number }
  >();
  const slot = (dayKey: string) => {
    let s = extra.get(dayKey);
    if (!s) {
      s = { saved: 0, prepAnswered: 0, prepKnown: 0, ttsMs: 0, tipsShown: 0, tipsAccepted: 0 };
      extra.set(dayKey, s);
    }
    return s;
  };
  for (const e of windowEvents) {
    const key = dayKeyOf(e.createdAt, timeZone);
    switch (e.kind) {
      case "word_saved":
        slot(key).saved += 1;
        break;
      case "preparation_answered":
        slot(key).prepAnswered += 1;
        if (e.answer === "known") slot(key).prepKnown += 1;
        break;
      case "tts_paused":
      case "tts_section_advance":
      case "tts_session_end":
        slot(key).ttsMs += e.ms;
        break;
      case "tip_shown":
        slot(key).tipsShown += 1;
        break;
      case "tip_accepted":
        slot(key).tipsAccepted += 1;
        break;
      default:
        break;
    }
  }

  const dayKeys = new Set<string>([
    ...minutesByDay.keys(),
    ...focusDays.keys(),
    ...reviewsByDay.keys(),
    ...extra.keys(),
  ]);
  const rows: DailySummaryRow[] = [];
  for (const day of dayKeys) {
    const focus = focusDays.get(day);
    const rev = reviewsByDay.get(day);
    const ex = extra.get(day);
    const minutes = minutesByDay.get(day) ?? 0;
    const wordsSaved = ex?.saved ?? 0;
    const dwellMs = Math.round(focus?.dwellMs ?? 0);
    const wordsRead = Math.round(focus?.words ?? 0);
    const row: DailySummaryRow = {
      day,
      tz: timeZone,
      device,
      minutes,
      dwellMs,
      wordsRead,
      wpm: focus ? dayWpm(focus) : 0,
      consults: focus?.consults ?? 0,
      regressions: focus?.regressions ?? 0,
      fatigue: focus?.fatigue ?? 0,
      wordsSaved,
      reviews: rev?.n ?? 0,
      reviewHits: rev?.hits ?? 0,
      prepAnswered: ex?.prepAnswered ?? 0,
      prepKnown: ex?.prepKnown ?? 0,
      ttsMs: Math.round(ex?.ttsMs ?? 0),
      tipsShown: ex?.tipsShown ?? 0,
      tipsAccepted: ex?.tipsAccepted ?? 0,
    };
    // Un día sin nada medido no se sube: evita filas de solo ceros por
    // haber abierto la app sin leer ni tocar el cuaderno.
    const hasActivity =
      minutes > 0 ||
      dwellMs > 0 ||
      (rev?.n ?? 0) > 0 ||
      wordsSaved > 0 ||
      (ex?.prepAnswered ?? 0) > 0 ||
      (ex?.ttsMs ?? 0) > 0 ||
      (ex?.tipsShown ?? 0) > 0;
    if (hasActivity) rows.push(row);
  }
  return rows.sort((a, b) => (a.day < b.day ? -1 : 1));
}

// Huella del contenido del día: si coincide con la última empujada el
// servidor ya tiene estos números y no hace falta reenviarlos.
const fingerprint = (row: DailySummaryRow): string =>
  [
    row.minutes,
    row.dwellMs,
    row.wordsRead,
    row.wpm,
    row.consults,
    row.regressions,
    row.fatigue,
    row.wordsSaved,
    row.reviews,
    row.reviewHits,
    row.prepAnswered,
    row.prepKnown,
    row.ttsMs,
    row.tipsShown,
    row.tipsAccepted,
    row.tz,
    row.device,
  ].join("|");

type PushState = {
  lastPushAt: number;
  /** Huella por día empujado con éxito. */
  pushed: Record<string, string>;
};

const loadPushState = async (bound?: DbScope): Promise<PushState> => {
  try {
    const raw = await loadSessionValue(PUSH_STATE_KEY, bound);
    const parsed = raw ? (JSON.parse(raw) as Partial<PushState>) : null;
    return {
      lastPushAt: Number(parsed?.lastPushAt ?? 0) || 0,
      pushed: parsed?.pushed && typeof parsed.pushed === "object" ? parsed.pushed : {},
    };
  } catch {
    return { lastPushAt: 0, pushed: {} };
  }
};

// Empuja los días del dispositivo a la cuenta. Devuelve true cuando
// no queda nada pendiente (todo enviado o nada que enviar); false si
// el ciclo quedó a medias y conviene reintentarlo luego.
export async function pushDailySummaries(scope?: DbScope): Promise<boolean> {
  if (isSyncPaused()) return false;
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return false;

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const device = classifyDevice(
    typeof navigator === "undefined" ? null : navigator.userAgent,
  );

  const [events, intervals, reviews, state] = await Promise.all([
    listReadingEvents(undefined, bound),
    listIntervals(bound),
    listAllReviews(bound),
    loadPushState(bound),
  ]);
  if (!isDbScopeActive(bound)) return false;

  const rows = computeDailySummaries(events, intervals, reviews, timeZone, device);
  const pending = rows.filter((r) => state.pushed[r.day] !== fingerprint(r));

  // Nada cambió y se empujó hace poco: no hay trabajo de red que hacer.
  if (pending.length === 0) {
    if (Date.now() - state.lastPushAt < PUSH_INTERVAL_MS) return true;
    // Refresco periódico ligero: los días viejos no cambian, pero si el
    // servidor perdió filas un reenvío completo las repone (idempotente
    // por updated_at, que solo gana lo más reciente).
    if (rows.length === 0) return true;
  }

  const toSend = pending.length > 0 ? pending : rows;
  const updatedAt = Date.now();
  const res = await accountFetch(
    "/api/daily-summaries",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summaries: toSend.map((r) => ({ ...r, updatedAt })),
      }),
      keepalive: true,
    },
    bound,
  ).catch(() => null);
  if (!res?.ok) return false;
  if (!isDbScopeActive(bound)) return false;

  const pushed = { ...state.pushed };
  for (const r of toSend) pushed[r.day] = fingerprint(r);
  await saveSessionValue(
    PUSH_STATE_KEY,
    JSON.stringify({ lastPushAt: updatedAt, pushed } satisfies PushState),
    bound,
  );
  return true;
}
