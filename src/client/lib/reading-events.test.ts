import { describe, expect, it } from "vitest";
import {
  chapterSummary,
  hasChapterSummary,
  summarizeReadingEvents,
} from "./reading-events";
import type { ReadingEvent } from "./idb";

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
    createdAt: seq * 1000,
    ...partial,
  }) as ReadingEvent;

describe("summarizeReadingEvents", () => {
  it("agrupa el trayecto de una visita", () => {
    const summary = summarizeReadingEvents([
      event({ kind: "target_entered", targetId: "t1" }),
      event({
        kind: "preparation_presented",
        targetId: "t1",
        presentationId: "p1",
        rows: [
          { key: "es:rara", form: "rara", reason: "rarity", zipf: 2.0 },
          { key: "es:comun", form: "común", reason: "rarity", zipf: 2.5 },
        ],
      }),
      event({
        kind: "preparation_answered",
        targetId: "t1",
        presentationId: "p1",
        key: "es:rara",
        answer: "unknown",
      }),
      event({
        kind: "preparation_answered",
        targetId: "t1",
        presentationId: "p1",
        key: "es:comun",
        answer: "known",
      }),
      event({ kind: "word_consulted", form: "curiosa" }),
      event({
        kind: "word_saved",
        form: "agregada",
        lemma: "agregada",
      }),
      event({ kind: "target_entered", targetId: "t1" }),
      event({ kind: "target_entered", targetId: "t2" }),
    ]);

    expect(summary.targetsEntered).toEqual(["t1", "t2"]);
    expect(summary.presented).toHaveLength(2);
    expect(summary.answeredUnknown).toBe(1);
    expect(summary.answeredKnown).toBe(1);
    expect(summary.consulted).toBe(1);
    expect(summary.saved).toBe(1);
    // «agregada» nunca fue sugerida: señal de lo que se escapó al modelo.
    expect(summary.savedNotPresented).toEqual(["agregada"]);
  });

  it("la guardada que sí fue sugerida no cuenta como escapada", () => {
    const summary = summarizeReadingEvents([
      event({
        kind: "preparation_presented",
        rows: [{ key: "es:meollo", form: "meollo", lemma: "meollo", reason: "rarity" }],
      }),
      event({ kind: "word_saved", form: "meollo", lemma: "meollo" }),
      event({
        kind: "word_saved",
        form: "turrón",
        // Sin lema: se compara solo por forma.
      }),
    ]);
    // meollo estaba presentada; turrón no.
    expect(summary.savedNotPresented).toEqual(["turrón"]);
    expect(summary.saved).toBe(2);
  });

  it("la última respuesta por clave gana, como en el registro", () => {
    const summary = summarizeReadingEvents([
      event({
        kind: "preparation_answered",
        key: "es:a",
        answer: "unknown",
      }),
      event({
        kind: "preparation_answered",
        key: "es:a",
        answer: "known",
      }),
      event({ kind: "preparation_skipped" }),
    ]);
    expect(summary.answeredKnown).toBe(1);
    expect(summary.answeredUnknown).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  it("presentadas deduplica por clave entre lotes repetidos", () => {
    const summary = summarizeReadingEvents([
      event({
        kind: "preparation_presented",
        presentationId: "p1",
        rows: [{ key: "es:a", form: "a", reason: "rarity" }],
      }),
      event({
        kind: "preparation_presented",
        presentationId: "p1",
        rows: [
          { key: "es:a", form: "a", reason: "rarity" },
          { key: "es:b", form: "b", reason: "learning" },
        ],
      }),
    ]);
    expect(summary.presented.map((row) => row.key)).toEqual(["es:a", "es:b"]);
  });
});

describe("chapterSummary", () => {
  const range = { startSection: 2, endSection: 5 };

  it("cuenta solo el tramo del capítulo en esta visita", () => {
    const summary = chapterSummary(
      [
        event({ kind: "word_saved", form: "rara", sectionIndex: 3 }),
        // La misma forma guardada dos veces cuenta una.
        event({ kind: "word_saved", form: "Rara", sectionIndex: 3 }),
        event({ kind: "word_consulted", form: "x", sectionIndex: 4 }),
        event({ kind: "word_consulted", form: "y", sectionIndex: 4 }),
        event({ kind: "word_declared_known", lemma: "fácil", sectionIndex: 2 }),
        event({ kind: "section_dwell", sectionIndex: 3, ms: 40_000, words: 300 }),
        event({ kind: "section_dwell", sectionIndex: 4, ms: 30_000, words: 280 }),
        // Fuera del tramo: no cuenta.
        event({ kind: "word_saved", form: "otra", sectionIndex: 1 }),
        event({ kind: "word_consulted", form: "z", sectionIndex: 5 }),
        // Otra visita del mismo tramo: tampoco.
        event({ kind: "word_saved", form: "vieja", sectionIndex: 3, visitId: "v0" }),
      ],
      range,
      "v1",
    );
    expect(summary).toEqual({
      saved: 1,
      consulted: 2,
      declaredKnown: 1,
      dwellMs: 70_000,
    });
  });

  it("eventos sin sectionIndex no aplican al tramo", () => {
    const summary = chapterSummary(
      [
        event({ kind: "target_entered", targetId: "t1", sectionIndex: 3 }),
        event({ kind: "preparation_answered", key: "k", answer: "known" }),
      ],
      range,
      "v1",
    );
    expect(summary.saved).toBe(0);
    expect(summary.consulted).toBe(0);
    expect(hasChapterSummary(summary)).toBe(false);
  });

  it("sin nada útil no hay tarjeta; un minuto de lectura basta", () => {
    const empty = chapterSummary([], range, "v1");
    expect(hasChapterSummary(empty)).toBe(false);
    const onlyDwell = chapterSummary(
      [event({ kind: "section_dwell", sectionIndex: 3, ms: 61_000, words: 400 })],
      range,
      "v1",
    );
    expect(hasChapterSummary(onlyDwell)).toBe(true);
  });
});
