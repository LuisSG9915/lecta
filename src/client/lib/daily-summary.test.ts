import { describe, expect, it } from "vitest";
import { computeDailySummaries } from "./daily-summary";
import type { ReadingEvent, SavedInterval, SavedReview } from "./idb";

const MIN = 60_000;
const DAY = 86_400_000;
// Mediodía UTC fija: las claves de día no dependen de la hora local.
const NOW = Date.UTC(2026, 10, 20, 12, 0);
const TZ = "UTC";
const DAY_KEY = "2026-11-20";

let seq = 0;
const interval = (start: number, end: number, bookHash = "b1"): SavedInterval => ({
  id: `i${seq++}`,
  bookHash,
  startedAt: NOW + start,
  endedAt: NOW + end,
});

const review = (at: number, kind: SavedReview["kind"], rating: SavedReview["rating"]): SavedReview => ({
  id: `r${seq++}`,
  language: "es",
  form: "palabra",
  kind,
  rating,
  hints: 0,
  createdAt: NOW + at,
});

const event = (kind: ReadingEvent["kind"], at: number, extra: object = {}): ReadingEvent =>
  ({
    id: `e${seq++}`,
    version: 1,
    visitId: "v1",
    bookHash: "b1",
    kind,
    createdAt: NOW + at,
    ...extra,
  }) as ReadingEvent;

describe("computeDailySummaries", () => {
  it("agrega foco, repasos y extras del día en una sola fila", () => {
    const rows = computeDailySummaries(
      [
        event("section_dwell", 0, { sectionIndex: 0, ms: 2 * MIN, words: 300 }),
        event("section_dwell", 30 * MIN, { sectionIndex: 1, ms: MIN, words: 150 }),
        event("word_consulted", MIN, { sectionIndex: 0, form: "x", origin: "text" }),
        event("page_regressed", 2 * MIN, { sectionIndex: 0 }),
        event("fatigue_flag", 3 * MIN, { sectionIndex: 0, regressions: 4, moves: 10 }),
        event("word_saved", 4 * MIN, { sectionIndex: 0, form: "x", origin: "text" }),
        event("preparation_answered", 5 * MIN, {
          targetId: "t",
          presentationId: "p",
          key: "es:x",
          answer: "known",
        }),
        event("preparation_answered", 6 * MIN, {
          targetId: "t",
          presentationId: "p",
          key: "es:y",
          answer: "unknown",
        }),
        event("tts_session_end", 7 * MIN, {
          sessionId: "s",
          targetId: "t",
          sectionIndex: 0,
          endReason: "done",
          rate: 1,
          ms: 5 * MIN,
          sentenceCount: 30,
          lookupCount: 0,
          savedWordCount: 0,
          resumedCount: 0,
          sectionAdvances: 1,
        }),
        event("tip_shown", 8 * MIN, { tipDay: DAY_KEY, action: "a", promptVersion: "v1" }),
        event("tip_accepted", 9 * MIN, { tipDay: DAY_KEY, action: "a" }),
      ],
      [interval(0, 30 * MIN)],
      [
        review(10 * MIN, "meaning", "good"),
        review(11 * MIN, "meaning", "again"),
        review(12 * MIN, "declared", "known"), // excluida de aciertos
      ],
      TZ,
      "desktop",
      NOW,
    );

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.day).toBe(DAY_KEY);
    expect(row.device).toBe("desktop");
    expect(row.tz).toBe(TZ);
    expect(row.minutes).toBe(30);
    expect(row.dwellMs).toBe(3 * MIN);
    expect(row.wordsRead).toBe(450);
    expect(row.wpm).toBe(150); // 450 palabras / 3 min
    expect(row.consults).toBe(1);
    expect(row.regressions).toBe(1);
    expect(row.fatigue).toBe(1);
    expect(row.wordsSaved).toBe(1);
    // Solo repasos verificados (no «declared»): 2 reseñas, 1 acierto.
    expect(row.reviews).toBe(2);
    expect(row.reviewHits).toBe(1);
    expect(row.prepAnswered).toBe(2);
    expect(row.prepKnown).toBe(1);
    expect(row.ttsMs).toBe(5 * MIN);
    expect(row.tipsShown).toBe(1);
    expect(row.tipsAccepted).toBe(1);
  });

  it("no duplica minutos cuando los intervalos se empalman", () => {
    const rows = computeDailySummaries(
      [],
      [interval(0, 40 * MIN), interval(20 * MIN, 60 * MIN)],
      [],
      TZ,
      "phone",
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.minutes).toBe(60);
  });

  it("omite días sin nada medido y días fuera de la ventana", () => {
    const rows = computeDailySummaries(
      [
        // Un evento que solo abre la app no genera fila.
        event("tip_shown", 0, { tipDay: DAY_KEY, action: "a", promptVersion: "v" }),
        // Fuera de la ventana de 35 días.
        event("word_saved", -40 * DAY, {
          sectionIndex: 0,
          form: "x",
          origin: "text",
        }),
      ],
      [],
      [],
      TZ,
      "desktop",
      NOW,
    );
    // tip_shown sí cuenta como actividad; el evento viejo no.
    expect(rows.map((r) => r.day)).toEqual([DAY_KEY]);
  });

  it("reparte cada dato a su día local, no al UTC absoluto", () => {
    const rows = computeDailySummaries(
      [
        event("word_saved", -MIN, { sectionIndex: 0, form: "x", origin: "text" }),
        event("word_saved", MIN, { sectionIndex: 0, form: "x", origin: "text" }),
      ],
      [],
      [],
      "America/Mexico_City", // UTC-6: NOW es 06:00 local del 20
      "desktop",
      NOW,
    );
    // Los dos eventos caen en el mismo día local (6:00 de la mañana).
    expect(rows).toHaveLength(1);
    expect(rows[0]!.day).toBe(DAY_KEY);
    expect(rows[0]!.wordsSaved).toBe(2);
    expect(rows[0]!.tz).toBe("America/Mexico_City");
  });
});
