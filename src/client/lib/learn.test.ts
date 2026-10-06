import { describe, expect, it } from "vitest";
import {
  emptyLearnExposure,
  isLearnPending,
  knownKeysFor,
  learnQueue,
  parseLearnExposure,
  withExposure,
} from "./learn";
import type { Card } from "./fsrs";
import type { KnownWord, SavedWord } from "./idb";

const word = (over: Partial<SavedWord> = {}): SavedWord => ({
  key: "es:casa",
  language: "es",
  form: "casa",
  lemma: "casa",
  savedAt: 1,
  updatedAt: 1,
  ...over,
});

const known = (lemma: string, over: Partial<KnownWord> = {}): KnownWord => ({
  key: `es:${lemma}`,
  language: "es",
  lemma,
  known: true,
  source: "declared",
  updatedAt: 1,
  ...over,
});

const reviewedCard = { reps: 1, stability: 3 } as Card;
const freshCard = { reps: 0, stability: 0 } as Card;

describe("parseLearnExposure", () => {
  it("acepta vacío, basura y entradas malformadas", () => {
    expect(parseLearnExposure(null)).toEqual(emptyLearnExposure());
    expect(parseLearnExposure("no json")).toEqual(emptyLearnExposure());
    const parsed = parseLearnExposure(
      JSON.stringify({
        version: 1,
        updatedAt: 5,
        seen: {
          "es:casa": { at: 1, verdict: "learn" },
          "es:mal": { at: 2, verdict: "??" },
          "es:peor": "nada",
        },
      }),
    );
    expect(parsed.seen["es:casa"]).toEqual({ at: 1, verdict: "learn" });
    expect(parsed.seen["es:mal"]).toBeUndefined();
    expect(parsed.seen["es:peor"]).toBeUndefined();
    expect(parsed.updatedAt).toBe(5);
  });

  it("una versión desconocida no se interpreta como v1", () => {
    const parsed = parseLearnExposure(
      JSON.stringify({ version: 2, seen: { "es:casa": { at: 1, verdict: "learn" } } }),
    );
    expect(parsed).toEqual(emptyLearnExposure());
  });
});

describe("withExposure", () => {
  it("registra el veredicto con sello nuevo", () => {
    const next = withExposure(emptyLearnExposure(), "es:casa", "learn", 42);
    expect(next.seen["es:casa"]).toEqual({ at: 42, verdict: "learn" });
    expect(next.updatedAt).toBe(42);
    expect(next.seen["es:casa"].verdict).toBe("learn");
  });
});

describe("learnQueue", () => {
  const exposure = withExposure(emptyLearnExposure(), "es:mesa", "learn", 10);

  it("excluye expuestas, conocidas, borradas y ya repasadas", () => {
    const words = [
      word(), // elegible
      word({ key: "es:mesa", form: "mesa", lemma: "mesa" }), // ya expuesta
      word({ key: "es:silla", form: "silla", lemma: "silla" }), // conocida por lema
      word({ key: "es:gato", form: "gato", lemma: "gato", deleted: true }),
      word({ key: "es:perro", form: "perro", lemma: "perro", card: reviewedCard }),
      word({ key: "es:flor", form: "flor", lemma: "flor", card: freshCard }), // card nueva sin reps: elegible
    ];
    const queue = learnQueue(words, [known("silla")], exposure);
    expect(queue.map((w) => w.key)).toEqual(["es:casa", "es:flor"]);
  });

  it("conoce por forma aunque el lema difiera (fila sin lematizar)", () => {
    const words = [word({ key: "es:casas", form: "casas", lemma: "casa" })];
    expect(learnQueue(words, [known("casas")], emptyLearnExposure())).toHaveLength(0);
    expect(learnQueue(words, [known("casa")], emptyLearnExposure())).toHaveLength(0);
  });

  it("una lápida o un desconocido no excluye", () => {
    const words = [word()];
    expect(
      learnQueue(words, [known("casa", { deleted: true })], emptyLearnExposure()),
    ).toHaveLength(1);
    expect(
      learnQueue(words, [known("casa", { known: false })], emptyLearnExposure()),
    ).toHaveLength(1);
  });

  it("isLearnPending coincide con la cola por palabra", () => {
    const w = word();
    expect(isLearnPending(w, knownKeysFor([]), exposure)).toBe(true);
  });
});
