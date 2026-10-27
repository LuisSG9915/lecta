// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeStoredBook,
  bookVocabKey,
  buildBookVocabManifest,
  loadBookVocab,
} from "./book-vocab";
import type { LexiconEntry } from "./lexicon";
import type { StoredBook } from "./idb";

const store = vi.hoisted(() => new Map<string, string>());
const booksMock = vi.hoisted(() => ({
  books: new Map<string, StoredBook>(),
}));

vi.mock("./idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./idb")>();
  return {
    ...mod,
    getStoredBook: vi.fn(async (hash: string) => booksMock.books.get(hash)),
    loadSessionValue: vi.fn(async (key: string) => store.get(key) ?? null),
    saveSessionValue: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
});

const entry = (
  lemma: string,
  zipf: number | null,
  pos = "sustantivo",
  entryId: string | null = `id-${lemma}`,
): LexiconEntry => ({
  entryId,
  lemma,
  pos,
  freqRank: null,
  zipf,
  senses: [],
});

describe("buildBookVocabManifest", () => {
  it("deduplica fichas por entryId y arma byForm con índices", () => {
    const manifest = buildBookVocabManifest(
      ["casa", "casas"],
      {
        casa: [entry("casa", 6)],
        casas: [entry("casa", 6), entry("casar", 3, "verbo")],
      },
      5000,
    );
    expect(manifest.v).toBe(1);
    expect(manifest.forms).toEqual(["casa", "casas"]);
    expect(manifest.wordCount).toBe(5000);
    // «casa» compartida entre las dos formas entra una sola vez.
    expect(manifest.entries).toHaveLength(2);
    expect(manifest.byForm.casas).toEqual([0, 1]);
    expect(manifest.missing).toEqual([]);
  });

  it("sin ficha propia ni base verificada la forma va a missing", () => {
    const manifest = buildBookVocabManifest(
      ["casa", "xing"],
      { casa: [entry("casa", 6)], xing: [] },
      10,
    );
    expect(manifest.missing).toEqual(["xing"]);
  });

  it("una base clítica con ficha rescata la forma (abrirlo → abrir)", () => {
    const manifest = buildBookVocabManifest(
      ["abrirlo"],
      { abrirlo: [], abrir: [entry("abrir", 6.5, "verbo")] },
      10,
    );
    expect(manifest.missing).toEqual([]);
    // La base queda como llave de byForm para que predictSection la resuelva.
    expect(manifest.byForm.abrir).toHaveLength(1);
    expect(manifest.byForm.abrirlo).toBeUndefined();
  });
});

// Un libro falso de dos secciones con documentos DOM reales: el mismo
// saneamiento del lector corre de verdad (jsdom), solo la apertura del
// zip y la consulta al catálogo van inyectadas.
const fakeOpen = (texts: string[]) =>
  (async () => ({
    book: {
      sections: texts.map((text, i) => ({
        id: `s${i}.xhtml`,
        createDocument: async () =>
          new DOMParser().parseFromString(
            `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${text}</p></body></html>`,
            "application/xhtml+xml",
          ),
      })),
      metadata: { language: "es" },
    },
    close: async () => undefined,
    loadBlob: async () => null,
  })) as never;

describe("analyzeStoredBook", () => {
  beforeEach(() => {
    store.clear();
    booksMock.books.clear();
    booksMock.books.set("h1", {
      hash: "h1",
      name: "libro.epub",
      addedAt: 1,
      data: new Blob(["epub"]),
    } as StoredBook);
  });

  it("produce el manifiesto del libro y lo guarda en session", async () => {
    const manifest = await analyzeStoredBook("h1", undefined, {
      open: fakeOpen(["La casa era perenne y bonita"]),
      extractWords: async () => ["La", "casa", "era", "perenne", "y", "bonita"],
      lookup: async (forms) => ({
        ok: true as const,
        entries: {
          casa: [entry("casa", 6.1)],
          perenne: [entry("perenne", 2.1, "adjetivo")],
          bonita: [entry("bonito", 4.4, "adjetivo")],
          era: [entry("ser", 7.9, "verbo")],
          // Las consultadas sin ficha devuelven lista vacía.
          ...Object.fromEntries(
            forms.filter((f) => !["casa", "perenne", "bonita", "era"].includes(f)).map((f) => [f, []]),
          ),
        },
      }),
    });

    expect(manifest).not.toBeNull();
    expect(manifest!.wordCount).toBe(6);
    // «la», «y» y «era» son stopwords: fuera; quedan las 3 de
    // vocabulario real.
    expect(manifest!.forms.sort()).toEqual(["bonita", "casa", "perenne"]);
    expect(manifest!.byForm.casa[0]).toBe(0);
    expect(store.has(bookVocabKey("h1"))).toBe(true);

    // El guardado re-lee igual que el lector la insignia.
    const cached = await loadBookVocab("h1");
    expect(cached?.uniqueForms).toBe(manifest!.uniqueForms);
  });

  it("guarda cuántas veces aparece cada forma propia del libro", async () => {
    const manifest = await analyzeStoredBook("h1", undefined, {
      open: fakeOpen(["casa casa perenne"]),
      extractWords: async () => ["casa", "casa", "perenne", "la"],
      lookup: async () => ({
        ok: true as const,
        entries: {
          casa: [entry("casa", 6.1)],
          perenne: [entry("perenne", 2.1, "adjetivo")],
        },
      }),
    });
    expect(manifest!.occurrences).toEqual({ casa: 2, perenne: 1 });
  });

  it("sin libro guardado devuelve null sin escribir nada", async () => {
    const manifest = await analyzeStoredBook("falta");
    expect(manifest).toBeNull();
    expect(store.size).toBe(0);
  });

  it("si el catálogo no responde devuelve null y no cachea", async () => {
    const manifest = await analyzeStoredBook("h1", undefined, {
      open: fakeOpen(["La casa"]),
      extractWords: async () => ["casa"],
      lookup: async () => ({ ok: false as const, error: "sin red", entries: {} }),
    });
    expect(manifest).toBeNull();
    expect(store.has(bookVocabKey("h1"))).toBe(false);
  });

  it("un EPUB que no abre devuelve null", async () => {
    const manifest = await analyzeStoredBook("h1", undefined, {
      open: (async () => {
        throw new Error("zip roto");
      }) as never,
    });
    expect(manifest).toBeNull();
  });
});

describe("loadBookVocab", () => {
  beforeEach(() => store.clear());

  it("sin análisis devuelve null; con basura guardada también", async () => {
    expect(await loadBookVocab("x")).toBeNull();
    store.set(bookVocabKey("x"), "{roto");
    expect(await loadBookVocab("x")).toBeNull();
    store.set(bookVocabKey("x"), JSON.stringify({ v: 2 }));
    expect(await loadBookVocab("x")).toBeNull();
  });
});
