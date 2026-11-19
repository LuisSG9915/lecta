import { describe, expect, it } from "vitest";
import type { SavedWord } from "./idb";
import {
  clozeTextFor,
  isEligible,
  isPlusOnlyMode,
  matchesFilter,
  matchesQuery,
  searchHaystack,
  stateOf,
  wordOrigin,
  wordStage,
  type WordLifecycle,
} from "./notebook-model";

const word = (over: Partial<SavedWord> = {}): SavedWord => ({
  key: "es:casa",
  language: "es",
  form: "casa",
  lemma: "casa",
  savedAt: 1,
  updatedAt: 1,
  ...over,
});
const past = () => new Date(Date.now() - 86_400_000).toISOString();
const future = () => new Date(Date.now() + 5 * 86_400_000).toISOString();
const card = (stability: number, due: string, reps = 3) =>
  ({ reps, stability, due }) as never;
const life = (over: Partial<WordLifecycle> = {}): WordLifecycle => ({
  pending: false,
  known: false,
  ...over,
});

describe("wordStage", () => {
  it("pendiente de ficha es «new» sin importar la tarjeta", () => {
    expect(wordStage(word({ card: card(30, future()) }), life({ pending: true }))).toBe("new");
  });

  it("declarada conocida cuenta como «settled»", () => {
    expect(wordStage(word(), life({ known: true }))).toBe("settled");
  });

  it("ya presentada sin repasos, o con S < 14, está «learning»", () => {
    expect(wordStage(word(), life())).toBe("learning");
    expect(wordStage(word({ card: card(1, past(), 0) }), life())).toBe("learning");
    expect(wordStage(word({ card: card(13.9, future()) }), life())).toBe("learning");
  });

  it("S >= 14 es «settled»", () => {
    expect(wordStage(word({ card: card(14, future()) }), life())).toBe("settled");
  });

  it("una estabilidad corrupta no rompe la clasificación", () => {
    expect(wordStage(word({ card: card(Number.NaN, future()) }), life())).toBe("learning");
  });
});

describe("stateOf", () => {
  it("etiqueta en singular, la misma que la etapa", () => {
    expect(stateOf(word(), life({ pending: true }))).toEqual({ label: "Nueva", level: "new" });
    expect(stateOf(word({ card: card(5, future()) }), life())).toEqual({
      label: "En Práctica",
      level: "learning",
    });
    expect(stateOf(word({ card: card(20, future()) }), life())).toEqual({
      label: "Dominada",
      level: "settled",
    });
  });

  it("«Para hoy» se superpone a las etapas con tarjeta vencida", () => {
    expect(stateOf(word({ card: card(20, past()) }), life()).label).toBe("Para hoy");
  });

  it("una declarada conocida nunca sale «Para hoy», aunque su tarjeta esté vencida", () => {
    expect(stateOf(word({ card: card(1, past()) }), life({ known: true })).label).toBe(
      "Dominada",
    );
  });
});

describe("matchesFilter", () => {
  const nueva = { w: word(), l: life({ pending: true }) };
  const practica = { w: word({ card: card(2, future()) }), l: life() };
  const vencida = { w: word({ card: card(2, past()) }), l: life() };
  const conocida = { w: word({ card: card(1, past()) }), l: life({ known: true }) };

  it("«all» acepta todo", () => {
    for (const x of [nueva, practica, vencida, conocida]) {
      expect(matchesFilter(x.w, "all", x.l)).toBe(true);
    }
  });

  it("«due» solo lo presentado, no conocido y vencido", () => {
    expect(matchesFilter(vencida.w, "due", vencida.l)).toBe(true);
    expect(matchesFilter(practica.w, "due", practica.l)).toBe(false);
    expect(matchesFilter(nueva.w, "due", nueva.l)).toBe(false);
    expect(matchesFilter(conocida.w, "due", conocida.l)).toBe(false);
  });

  it("«new», «learning» y «settled» reparten sin solaparse", () => {
    const todas = [nueva, practica, vencida, conocida];
    for (const x of todas) {
      const hits = (["new", "learning", "settled"] as const).filter((f) =>
        matchesFilter(x.w, f, x.l),
      );
      expect(hits).toHaveLength(1);
    }
  });
});

describe("isEligible", () => {
  it("«elegir palabra» y «oración» piden una oración con hueco", () => {
    expect(isEligible(word({ context: "Una casa vieja." }), "choose")).toBe(true);
    expect(isEligible(word(), "choose")).toBe(false);
    expect(isEligible(word({ context: "Sin la forma." }), "cloze")).toBe(false);
  });

  it("«significado» y «palabra» piden significado guardado", () => {
    expect(isEligible(word({ meaning: "hogar" }), "meaning")).toBe(true);
    expect(isEligible(word(), "form")).toBe(false);
  });

  it("«descifrar» pide significado y al menos 2 letras", () => {
    expect(isEligible(word({ meaning: "x", form: "a" }), "scramble")).toBe(false);
    expect(isEligible(word({ meaning: "hogar" }), "scramble")).toBe(true);
  });

  it("«acepción» pide la ficha; «contexto» y «oración nueva» también el orden", () => {
    expect(isEligible(word({ senseEntryId: "7" }), "sense")).toBe(true);
    expect(isEligible(word({ senseEntryId: "7" }), "context")).toBe(false);
    expect(isEligible(word({ senseEntryId: "7", senseOrder: 1 }), "clozeNew")).toBe(true);
    expect(isEligible(word(), "sense")).toBe(false);
  });
});

describe("búsqueda", () => {
  it("ignora mayúsculas y tildes y pide todas las partes", () => {
    const hay = searchHaystack(word({ form: "murciélago", meaning: "mamífero volador" }));
    expect(matchesQuery(hay, "MURCIELAGO")).toBe(true);
    expect(matchesQuery(hay, "mamifero vol")).toBe(true);
    expect(matchesQuery(hay, "murcielago perro")).toBe(false);
    expect(matchesQuery(hay, "")).toBe(true);
  });

  it("clozeTextFor abre el hueco sobre la forma", () => {
    expect(clozeTextFor(word({ context: "Una casa vieja." }))).toContain("_");
    expect(clozeTextFor(word())).toBeNull();
  });
});

describe("wordOrigin", () => {
  const kinds = new Map<string, "movie" | "tv">([
    ["hash-serie", "tv"],
    ["hash-pelicula", "movie"],
  ]);

  it("deduce series y películas del mediaKind del libro local", () => {
    expect(wordOrigin(word({ bookHash: "hash-serie" }), kinds)).toBe("series");
    expect(wordOrigin(word({ bookHash: "hash-pelicula" }), kinds)).toBe(
      "movies",
    );
  });

  it("libros, libros borrados y palabras sin libro caen en «books»", () => {
    expect(wordOrigin(word({ bookHash: "hash-libro" }), kinds)).toBe("books");
    expect(wordOrigin(word({ bookHash: "hash-borrado" }), kinds)).toBe(
      "books",
    );
    expect(wordOrigin(word(), kinds)).toBe("books");
    expect(wordOrigin(word({ bookHash: undefined }), kinds)).toBe("books");
  });

  it("sin obras de pantalla instaladas todo es «books»", () => {
    expect(wordOrigin(word({ bookHash: "hash-serie" }), new Map())).toBe(
      "books",
    );
  });
});

describe("isPlusOnlyMode", () => {
  it("solo Acepción, Contexto y Oración nueva son de Lecta+; los modos locales son libres", () => {
    for (const m of ["sense", "context", "clozeNew"] as const) expect(isPlusOnlyMode(m)).toBe(true);
    for (const m of ["cloze", "scramble", "syntax", "match", "meaning", "form", "choose", "grammar"] as const)
      expect(isPlusOnlyMode(m)).toBe(false);
  });
});
