import { describe, expect, it } from "vitest";
import {
  CELEBRATE_MS,
  CURIOUS_MS,
  DEEP_FOCUS_AFTER_MS,
  initialCompanion,
  reduceCompanion,
  SLEEP_AFTER_IDLE_MS,
  YAWN_MS,
  type CompanionMachine,
  type CompanionSignal,
} from "../lib/companion-state";

const T0 = 1_000_000;

const run = (m: CompanionMachine, sigs: CompanionSignal[]) =>
  sigs.reduce(reduceCompanion, m);

const open = (m: CompanionMachine, at = T0) =>
  reduceCompanion(m, { kind: "book_opened", at });

const activity = (m: CompanionMachine, at: number) =>
  reduceCompanion(m, { kind: "reading_activity", at });

describe("companion: vigilia y lectura", () => {
  it("arranca dormido y despierta al abrir el libro", () => {
    let m = initialCompanion(T0);
    expect(m.state).toBe("sleep");
    m = open(m);
    expect(m.state).toBe("reading");
    expect(m.readingSince).toBe(T0);
  });

  it("la lectura continua corona en deep_focus al llegar al umbral", () => {
    let m = open(initialCompanion(T0));
    m = activity(m, T0 + DEEP_FOCUS_AFTER_MS - 1);
    expect(m.state).toBe("reading");
    m = activity(m, T0 + DEEP_FOCUS_AFTER_MS);
    expect(m.state).toBe("deep_focus");
    // Y se mantiene mientras siga la lectura.
    m = activity(m, T0 + DEEP_FOCUS_AFTER_MS + 60_000);
    expect(m.state).toBe("deep_focus");
  });

  it("cinco minutos sin señales lo duermen; la actividad lo despierta", () => {
    let m = open(initialCompanion(T0));
    m = reduceCompanion(m, { kind: "tick", at: T0 + SLEEP_AFTER_IDLE_MS - 1 });
    expect(m.state).toBe("reading");
    m = reduceCompanion(m, { kind: "tick", at: T0 + SLEEP_AFTER_IDLE_MS });
    expect(m.state).toBe("sleep");
    m = activity(m, T0 + SLEEP_AFTER_IDLE_MS + 100);
    expect(m.state).toBe("reading");
  });

  it("cerrar el libro lo duerme desde cualquier estado", () => {
    let m = open(initialCompanion(T0));
    m = reduceCompanion(m, { kind: "word_consulted", at: T0 + 1_000 });
    expect(m.state).toBe("curious");
    m = reduceCompanion(m, { kind: "book_closed", at: T0 + 2_000 });
    expect(m.state).toBe("sleep");
  });
});

describe("companion: curiosidad", () => {
  it("consultar el diccionario lo pone curioso unos segundos", () => {
    let m = open(initialCompanion(T0));
    m = reduceCompanion(m, { kind: "word_consulted", at: T0 + 1_000 });
    expect(m.state).toBe("curious");
    m = reduceCompanion(m, { kind: "tick", at: T0 + 1_000 + CURIOUS_MS - 1 });
    expect(m.state).toBe("curious");
    m = reduceCompanion(m, { kind: "tick", at: T0 + 1_000 + CURIOUS_MS });
    expect(m.state).toBe("reading");
  });

  it("otra consulta alarga la curiosidad desde la última", () => {
    let m = open(initialCompanion(T0));
    m = reduceCompanion(m, { kind: "word_consulted", at: T0 + 1_000 });
    m = reduceCompanion(m, {
      kind: "word_consulted",
      at: T0 + 1_000 + CURIOUS_MS - 100,
    });
    // El lapso corre desde la segunda consulta: aún sigue curioso.
    m = reduceCompanion(m, { kind: "tick", at: T0 + 1_000 + CURIOUS_MS + 1 });
    expect(m.state).toBe("curious");
  });

  it("la consulta rompe la racha de deep_focus y hay que rehacerla", () => {
    let m = open(initialCompanion(T0));
    m = activity(m, T0 + DEEP_FOCUS_AFTER_MS);
    expect(m.state).toBe("deep_focus");
    const consultedAt = T0 + DEEP_FOCUS_AFTER_MS + 500;
    m = reduceCompanion(m, { kind: "word_consulted", at: consultedAt });
    expect(m.state).toBe("curious");
    const resumedAt = consultedAt + CURIOUS_MS;
    m = reduceCompanion(m, { kind: "tick", at: resumedAt });
    expect(m.state).toBe("reading");
    // El tramo continuo empezó al caducar la curiosidad: los diez
    // minutos cuentan completos desde ahí.
    m = activity(m, resumedAt + DEEP_FOCUS_AFTER_MS - 1);
    expect(m.state).toBe("reading");
    m = activity(m, resumedAt + DEEP_FOCUS_AFTER_MS);
    expect(m.state).toBe("deep_focus");
  });
});

describe("companion: fatiga y celebración", () => {
  it("la fatiga detectada provoca el bostezo y luego vuelve a lectura", () => {
    let m = open(initialCompanion(T0));
    m = reduceCompanion(m, { kind: "fatigue_detected", at: T0 + 5_000 });
    expect(m.state).toBe("yawn");
    m = reduceCompanion(m, { kind: "tick", at: T0 + 5_000 + YAWN_MS });
    expect(m.state).toBe("reading");
  });

  it("la meta cumplida celebra y caduca a lectura", () => {
    let m = open(initialCompanion(T0));
    m = reduceCompanion(m, { kind: "goal_completed", at: T0 + 5_000 });
    expect(m.state).toBe("celebrating");
    m = reduceCompanion(m, {
      kind: "tick",
      at: T0 + 5_000 + CELEBRATE_MS - 1,
    });
    expect(m.state).toBe("celebrating");
    m = reduceCompanion(m, { kind: "tick", at: T0 + 5_000 + CELEBRATE_MS });
    expect(m.state).toBe("reading");
  });

  it("la consulta no interrumpe el bostezo ni la celebración", () => {
    let m = open(initialCompanion(T0));
    m = run(m, [
      { kind: "fatigue_detected", at: T0 + 1_000 },
      { kind: "word_consulted", at: T0 + 2_000 },
    ]);
    expect(m.state).toBe("yawn");
    m = run(m, [
      { kind: "goal_completed", at: T0 + 3_000 },
      { kind: "word_consulted", at: T0 + 4_000 },
    ]);
    expect(m.state).toBe("celebrating");
  });
});
