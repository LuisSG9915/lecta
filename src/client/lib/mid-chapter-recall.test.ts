import { describe, expect, it } from "vitest";
import { State, type Card } from "ts-fsrs";
import type { SavedWord } from "./idb";
import { isForwardStepIntoSection, midChapterRecallKey, pickMidChapterRecall } from "./mid-chapter-recall";

describe("isForwardStepIntoSection", () => {
  it("solo cuenta el paso de una sección a la siguiente", () => {
    expect(isForwardStepIntoSection(2, 3)).toBe(true);
    expect(isForwardStepIntoSection(3, 2)).toBe(false);
    expect(isForwardStepIntoSection(2, 5)).toBe(false);
    expect(isForwardStepIntoSection(-1, 0)).toBe(false);
  });
});

const NOW = new Date("2026-10-27T12:00:00Z");
const PAST = new Date("2026-10-20T12:00:00Z");
const FUTURE = new Date("2026-11-20T12:00:00Z");
const TEXT = "El camino era largo. La quimera desapareció al amanecer. Nadie la volvió a ver.";

const cardAt = (due: Date, reps: number): Card => ({
  due,
  stability: 10,
  difficulty: 5,
  elapsed_days: 0,
  scheduled_days: 0,
  reps,
  lapses: 0,
  state: State.Review,
  last_review: due,
  learning_steps: 0,
});

const word = (form: string, over: Partial<SavedWord> & { due?: Date; reps?: number } = {}): SavedWord => {
  const { due = PAST, reps = 2, ...rest } = over;
  return {
    key: `es:${form}`,
    form,
    language: "es",
    meaning: "ilusión o sueño",
    savedAt: 1,
    card: cardAt(due, reps),
    ...rest,
  };
};

describe("pickMidChapterRecall", () => {
  it("elige una palabra vencida del cuaderno que aparece en la sección", () => {
    const item = pickMidChapterRecall([word("quimera")], TEXT, "es", NOW);
    expect(item?.surfaceForm).toBe("quimera");
    expect(item?.chapterSentence).toBe("La quimera desapareció al amanecer.");
    expect(item?.source).toBe("notebook-reencounter");
  });

  it("ignora tarjetas nuevas, las que aún no vencen, borradas, sin significado y las que no aparecen", () => {
    const words = [
      word("quimera", { reps: 0 }),
      word("quimera", { due: FUTURE }),
      word("quimera", { deleted: true }),
      word("quimera", { meaning: "" }),
      word("dragón"),
    ];
    expect(pickMidChapterRecall(words, TEXT, "es", NOW)).toBeNull();
  });

  it("ignora palabras de otro idioma", () => {
    expect(pickMidChapterRecall([word("quimera", { language: "en" })], TEXT, "es", NOW)).toBeNull();
  });

  it("prefiere la que venció antes", () => {
    const text = "La quimera y el dragón volvieron.";
    const items = pickMidChapterRecall(
      [word("dragón", { due: new Date("2026-10-25T00:00:00Z") }), word("quimera", { due: new Date("2026-10-21T00:00:00Z") })],
      text,
      "es",
      NOW,
    );
    expect(items?.surfaceForm).toBe("quimera");
  });

  it("devuelve null cuando no hay nada que repasar", () => {
    expect(pickMidChapterRecall([], TEXT, "es", NOW)).toBeNull();
  });
});

describe("midChapterRecallKey", () => {
  it("una clave por libro y capítulo, con identificadores codificados", () => {
    expect(midChapterRecallKey("libro1", "OEBPS/cap.xhtml#sec")).toBe(
      "midChapterRecall:v1:libro1:OEBPS%2Fcap.xhtml%23sec",
    );
  });
});
