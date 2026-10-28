import { describe, expect, it, vi } from "vitest";
import {
  emptyLearnExposure,
  isLearnPending,
  isWordKnownBy,
  knownKeysFor,
  learnQueue,
  parseLearnExposure,
  REVIEW_SESSION_SIZE,
  reviewQueue,
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

import {
  evaluateSentenceLocally,
  evaluateSentenceWithAi,
  generateMicroStoryLocally,
  generateMicroStoryWithAi,
} from "./learn";

describe("evaluateSentenceLocally", () => {
  it("da resultado positivo cuando la oración contiene la palabra y tiene al menos 5 palabras", () => {
    const res = evaluateSentenceLocally({
      word: "perenne",
      targetSense: "Que dura siempre",
      userSentence: "El bosque tiene una vegetación perenne y frondosa.",
    });
    expect(res.ok).toBe(true);
    expect(res.isCorrect).toBe(true);
    expect(res.score).toBe(95);
    expect(res.catReaction).toBe("purring");
    expect(res.feedback).toContain("perenne");
    expect(res.offlineFallback).toBe(true);
  });

  it("reconoce el lema si la forma flexionada no coincide exactamente", () => {
    const res = evaluateSentenceLocally({
      word: "cantó",
      lemma: "cantar",
      targetSense: "Emitir sonidos melodiosos",
      userSentence: "A todos nos gusta cantar bajo la lluvia.",
    });
    expect(res.ok).toBe(true);
    expect(res.isCorrect).toBe(true);
    expect(res.score).toBe(95);
  });

  it("rechaza si la palabra u oración no la contiene", () => {
    const res = evaluateSentenceLocally({
      word: "efímero",
      targetSense: "Pasajero",
      userSentence: "El cielo azul reflejaba la luz del sol.",
    });
    expect(res.ok).toBe(true);
    expect(res.isCorrect).toBe(false);
    expect(res.score).toBe(40);
    expect(res.catReaction).toBe("curious");
    expect(res.feedback).toContain("no veo la palabra «efímero»");
  });

  it("rechaza si la oración tiene menos de 5 palabras", () => {
    const res = evaluateSentenceLocally({
      word: "efímero",
      targetSense: "Pasajero",
      userSentence: "Es muy efímero.",
    });
    expect(res.ok).toBe(true);
    expect(res.isCorrect).toBe(false);
    expect(res.score).toBe(50);
    expect(res.catReaction).toBe("curious");
    expect(res.feedback).toContain("es un poco breve");
  });
});

describe("generateMicroStoryLocally", () => {
  it("genera un micro-relato poético con las palabras marcadas en [[palabra]]", () => {
    const res = generateMicroStoryLocally({
      words: [{ word: "antiguo" }, { word: "silencio" }],
    });
    expect(res.ok).toBe(true);
    expect(res.title).toBe("Cuento de Tinta y Sombras");
    expect(res.story).toContain("[[antiguo]]");
    expect(res.story).toContain("[[silencio]]");
    expect(res.wordsUsed).toEqual(["antiguo", "silencio"]);
    expect(res.offlineFallback).toBe(true);
  });

  it("maneja lista vacía de palabras con elegancia", () => {
    const res = generateMicroStoryLocally({ words: [] });
    expect(res.ok).toBe(true);
    expect(res.title).toBe("Página en Blanco");
    expect(res.wordsUsed).toEqual([]);
  });

  it("maneja hasta 4 palabras correctamente", () => {
    const res = generateMicroStoryLocally({
      words: [
        { word: "viento" },
        { word: "lejano" },
        { word: "libro" },
        { word: "dorado" },
      ],
    });
    expect(res.wordsUsed).toHaveLength(4);
    expect(res.story).toContain("[[viento]]");
    expect(res.story).toContain("[[lejano]]");
    expect(res.story).toContain("[[libro]]");
    expect(res.story).toContain("[[dorado]]");
  });
});

describe("evaluateSentenceWithAi", () => {
  it("llama a la API y devuelve la respuesta parseada cuando tiene éxito", async () => {
    const mockPayload = {
      isCorrect: true,
      score: 98,
      catReaction: "purring",
      feedback: "¡Sublime uso de la palabra!",
      improvedVersion: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const res = await evaluateSentenceWithAi({
      word: "efímero",
      targetSense: "Pasajero",
      userSentence: "El destello fue efímero en la noche.",
    });

    expect(res.ok).toBe(true);
    expect(res.isCorrect).toBe(true);
    expect(res.score).toBe(98);
    expect(res.catReaction).toBe("purring");
    expect(res.feedback).toBe("¡Sublime uso de la palabra!");
    expect(res.offlineFallback).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("degrada limpiamente al fallback local si la API devuelve error HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Saturado" }), {
          status: 502,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const res = await evaluateSentenceWithAi({
      word: "efímero",
      targetSense: "Pasajero",
      userSentence: "El destello fue efímero en la noche oscura.",
    });

    expect(res.ok).toBe(true);
    expect(res.offlineFallback).toBe(true);
    expect(res.isCorrect).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("generateMicroStoryWithAi", () => {
  it("llama a la API y devuelve el cuento", async () => {
    const mockStory = {
      title: "La lámpara del tiempo",
      story: "En el rincón más [[antiguo]] de la sala, un suspiro detuvo el reloj.",
      wordsUsed: ["antiguo"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockStory), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const res = await generateMicroStoryWithAi({
      words: [{ word: "antiguo" }],
    });

    expect(res.ok).toBe(true);
    expect(res.title).toBe("La lámpara del tiempo");
    expect(res.story).toContain("[[antiguo]]");
    expect(res.offlineFallback).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("degrada al cuento local si la red falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network down")),
    );

    const res = await generateMicroStoryWithAi({
      words: [{ word: "perenne" }, { word: "brisa" }],
    });

    expect(res.ok).toBe(true);
    expect(res.offlineFallback).toBe(true);
    expect(res.story).toContain("[[perenne]]");
    expect(res.story).toContain("[[brisa]]");
    vi.unstubAllGlobals();
  });
});



describe("isWordKnownBy", () => {
  it("reconoce la evidencia por lema y por forma", () => {
    const keys = knownKeysFor([known("correr")]);
    expect(isWordKnownBy(word({ form: "corrí", lemma: "correr" }), keys)).toBe(true);
    expect(isWordKnownBy(word({ form: "correr" }), keys)).toBe(true);
    expect(isWordKnownBy(word({ form: "cantar", lemma: "cantar" }), keys)).toBe(false);
  });

  it("una fila tombada no cuenta como conocida", () => {
    const keys = knownKeysFor([{ ...known("casa"), deleted: true }]);
    expect(isWordKnownBy(word({ form: "casa" }), keys)).toBe(false);
  });
});

describe("reviewQueue", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const past = new Date("2026-10-26T12:00:00Z").toISOString();
  const future = new Date("2026-10-29T12:00:00Z").toISOString();
  const reviewed = (over: Partial<SavedWord> = {}) =>
    word({ card: { reps: 2, stability: 5, due: past } as never, ...over });

  it("excluye las lápidas", () => {
    const keys = new Set<string>();
    expect(reviewQueue([reviewed({ deleted: true })], keys, emptyLearnExposure(), now)).toEqual([]);
  });

  it("excluye lo que el usuario declaró conocido por lema o por forma", () => {
    const keys = knownKeysFor([known("correr")]);
    const words = [
      reviewed({ key: "es:corrí", form: "corrí", lemma: "correr" }),
      reviewed({ key: "es:correr", form: "correr", lemma: "correr" }),
    ];
    expect(reviewQueue(words, keys, emptyLearnExposure(), now)).toEqual([]);
  });

  it("excluye la exposición con veredicto «known» aunque no haya fila de conocimiento", () => {
    const item = reviewed({ key: "es:casa", form: "casa" });
    const exposure = withExposure(emptyLearnExposure(), "es:casa", "known", 1);
    expect(reviewQueue([item], new Set(), exposure, now)).toEqual([]);
  });

  it("excluye reps 0 sin exposición: no se examina lo que no se presentó", () => {
    const item = word({ card: { reps: 0, stability: 0, due: past } as never });
    expect(reviewQueue([item], new Set(), emptyLearnExposure(), now)).toEqual([]);
  });

  it("incluye reps 0 con exposición «learn» y vencida", () => {
    const item = word({ card: { reps: 0, stability: 0, due: past } as never });
    const exposure = withExposure(emptyLearnExposure(), "es:casa", "learn", 1);
    expect(reviewQueue([item], new Set(), exposure, now).map((w) => w.key)).toEqual(["es:casa"]);
  });

  it("excluye lo que aún no vence y no inventa respaldo", () => {
    const item = reviewed({ card: { reps: 2, stability: 5, due: future } as never });
    expect(reviewQueue([item], new Set(), emptyLearnExposure(), now)).toEqual([]);
  });

  it("ordena por priority y después por lo más atrasado", () => {
    const words = [
      reviewed({ key: "es:b", form: "b", card: { reps: 2, stability: 5, due: past } as never }),
      reviewed({ key: "es:a", form: "a", card: { reps: 2, stability: 5, due: past } as never }),
      reviewed({
        key: "es:vieja",
        form: "vieja",
        card: { reps: 2, stability: 5, due: new Date("2026-10-20T12:00:00Z").toISOString() } as never,
      }),
      reviewed({ key: "es:prio", form: "prio", priority: true }),
    ];
    expect(reviewQueue(words, new Set(), emptyLearnExposure(), now).map((w) => w.key)).toEqual([
      "es:prio",
      "es:vieja",
      "es:a",
      "es:b",
    ]);
  });

  it("la sesión sirve como máximo REVIEW_SESSION_SIZE palabras", () => {
    expect(REVIEW_SESSION_SIZE).toBeGreaterThan(0);
    expect(REVIEW_SESSION_SIZE).toBeLessThanOrEqual(10);
  });
});

describe("presentedAt: la ficha no se repite en otro dispositivo", () => {
  it("una palabra con sello ya no está por aprender, aunque no tenga exposición local", () => {
    const item = word({ presentedAt: 1 });
    expect(isLearnPending(item, new Set(), emptyLearnExposure())).toBe(false);
  });

  it("una palabra con sello y reps 0 entra al repaso cuando vence", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    const item = word({
      presentedAt: 1,
      card: { reps: 0, stability: 0, due: "2026-10-26T12:00:00.000Z" } as never,
    });
    expect(
      reviewQueue([item], new Set(), emptyLearnExposure(), now).map((w) => w.key),
    ).toEqual(["es:casa"]);
  });

  it("un sello ausente o en cero no cambia nada", () => {
    expect(isLearnPending(word(), new Set(), emptyLearnExposure())).toBe(true);
    expect(isLearnPending(word({ presentedAt: 0 }), new Set(), emptyLearnExposure())).toBe(true);
  });
});
