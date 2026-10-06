import { describe, expect, it } from "vitest";
import {
  detectFatigue,
  FATIGUE_AFTER_MS,
  FATIGUE_COOLDOWN_MS,
  FATIGUE_MIN_MOVES,
  FATIGUE_WINDOW_MS,
  dayWpm,
  focusByDay,
  newFocusTracker,
  recordMove,
  TRACK_GAP_MS,
} from "./focus-telemetry";
import type { ReadingEvent } from "./idb";

const T0 = 1_000_000;
const TZ = "America/Mexico_City";

let seq = 0;
const event = (partial: Partial<ReadingEvent>): ReadingEvent =>
  ({
    id: `e${(seq += 1)}`,
    version: 1,
    visitId: "v1",
    bookHash: "b1",
    kind: "word_consulted",
    sectionIndex: 0,
    form: "x",
    origin: "text",
    createdAt: T0,
    ...partial,
  }) as ReadingEvent;

const moves = (t: ReturnType<typeof newFocusTracker>, at: number, pattern: boolean[]) => {
  for (const back of pattern) recordMove(t, at, back);
};

// Tramo continuo: actividad cada poco para que el hueco no reinicie
// la medición (así llega a 25+ min de lectura real).
const keepAlive = (
  t: ReturnType<typeof newFocusTracker>,
  until: number,
) => {
  for (let at = t.lastMoveAt; at <= until; at += TRACK_GAP_MS - 60_000)
    recordMove(t, at, false);
};

describe("registro de movimientos", () => {
  it("un hueco largo reinicia tramo y muestra", () => {
    const t = newFocusTracker(T0);
    moves(t, T0, [true, true, true]);
    recordMove(t, T0 + TRACK_GAP_MS + 1, false);
    expect(t.startedAt).toBe(T0 + TRACK_GAP_MS + 1);
    expect(t.moves).toHaveLength(1);
    expect(t.moves[0].back).toBe(false);
  });

  it("poda la ventana deslizante", () => {
    const t = newFocusTracker(T0);
    recordMove(t, T0, true);
    recordMove(t, T0 + FATIGUE_WINDOW_MS + 1, false);
    expect(t.moves).toHaveLength(1);
  });
});

describe("detectFatigue", () => {
  it("pide tramo largo, muestra suficiente y tasa alta", () => {
    // Antes del tramo mínimo: por más regresiones que haya, no avisa.
    const t = newFocusTracker(T0);
    moves(t, T0, [true, true, true, true, true, true, true, true]);
    expect(detectFatigue(t, T0 + 1000)).toBeNull();

    // Tramo de 25+ min con mayoría de retrocesos: avisa.
    const t2 = newFocusTracker(T0);
    const at = T0 + FATIGUE_AFTER_MS + 1000;
    keepAlive(t2, at);
    moves(t2, at, [false, true, false, true, true, false, true, true]);
    const hit = detectFatigue(t2, at);
    expect(hit).not.toBeNull();
    expect(hit!.backs).toBe(5);
    expect(hit!.moves).toBeGreaterThanOrEqual(FATIGUE_MIN_MOVES);
  });

  it("tasa baja de retrocesos no es fatiga", () => {
    const t = newFocusTracker(T0);
    const at = T0 + FATIGUE_AFTER_MS + 1000;
    keepAlive(t, at);
    moves(t, at, [false, false, false, true, false, false, false, true]);
    expect(detectFatigue(t, at)).toBeNull();
  });

  it("enfriamiento entre avisos y segundo aviso tras el lapso", () => {
    const t = newFocusTracker(T0);
    const at = T0 + FATIGUE_AFTER_MS + 1000;
    keepAlive(t, at);
    moves(t, at, [true, true, true, true, true, true, true, true]);
    expect(detectFatigue(t, at)).not.toBeNull();
    // Enfriamiento: aun con racha alta no vuelve a avisar.
    moves(t, at + 1, [true, true, true, true]);
    expect(detectFatigue(t, at + 2)).toBeNull();
    // Tras el enfriamiento (con el tramo aún vivo) vuelve a avisar.
    const later = at + FATIGUE_COOLDOWN_MS + 1;
    keepAlive(t, later);
    moves(t, later, [true, true, true, true, true, true, true, true]);
    expect(detectFatigue(t, later + 1)).not.toBeNull();
  });
});

describe("focusByDay", () => {
  it("agrega dwell, retrocesos, consultas y fatiga por día", () => {
    const day = focusByDay(
      [
        event({ kind: "section_dwell", ms: 60_000, words: 240 }),
        event({ kind: "section_dwell", ms: 60_000, words: 60 }),
        event({ kind: "page_regressed" }),
        event({ kind: "word_consulted" }),
        event({ kind: "fatigue_flag", regressions: 5, moves: 8 }),
        // Los demás tipos de evento no cuentan aquí.
        event({ kind: "word_saved", form: "y" }),
      ],
      TZ,
    );
    expect(day).toHaveLength(1);
    expect(day[0].dwellMs).toBe(120_000);
    expect(day[0].words).toBe(300);
    expect(day[0].regressions).toBe(1);
    expect(day[0].consults).toBe(1);
    expect(day[0].fatigue).toBe(1);
    // 300 palabras en 2 min ≈ 150 ppm.
    expect(dayWpm(day[0])).toBe(150);
  });

  it("wpm pide muestra suficiente", () => {
    expect(dayWpm({ dwellMs: 5_000, words: 500 })).toBe(0);
    expect(dayWpm({ dwellMs: 60_000, words: 10 })).toBe(0);
    expect(dayWpm({ dwellMs: 60_000, words: 300 })).toBe(300);
  });
});
