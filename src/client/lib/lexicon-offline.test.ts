// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCachedMap = new Map<string, unknown>();
const mockSavedMap = new Map<string, unknown>();

vi.mock("./idb", () => ({
  getCachedLexicon: vi.fn(async (lang: string, form: string) => {
    return mockCachedMap.get(`${lang}:${form.toLowerCase()}`) ?? null;
  }),
  saveCachedLexicon: vi.fn(async (lang: string, form: string, entries: unknown) => {
    mockCachedMap.set(`${lang}:${form.toLowerCase()}`, entries);
  }),
  getCachedLexiconBatch: vi.fn(async (lang: string, forms: string[]) => {
    const result: Record<string, unknown> = {};
    for (const f of forms) {
      const val = mockCachedMap.get(`${lang}:${f.toLowerCase()}`);
      if (val) result[f] = val;
    }
    return result;
  }),
  saveCachedLexiconBatch: vi.fn(async (lang: string, entriesByForm: Record<string, unknown>) => {
    for (const [f, entries] of Object.entries(entriesByForm)) {
      mockCachedMap.set(`${lang}:${f.toLowerCase()}`, entries);
    }
  }),
  loadSavedWord: vi.fn(async (lang: string, form: string) => {
    return mockSavedMap.get(`${lang}:${form.toLowerCase()}`) ?? null;
  }),
}));

import { lookupWord, batchLookup, type LexiconEntry } from "./lexicon";

describe("lexicon offline", () => {
  beforeEach(() => {
    mockCachedMap.clear();
    mockSavedMap.clear();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sampleEntry: LexiconEntry = {
    entryId: "1001",
    lemma: "ataraxia",
    pos: "sustantivo",
    freqRank: 5000,
    zipf: 3.2,
    senses: [
      {
        definition: "Imperturbabilidad, serenidad del alma.",
        example: null,
        senseOrder: 1,
      },
    ],
  };

  it("recupera la definición de la memoria local cuando el servidor no responde", async () => {
    mockCachedMap.set("es:ataraxia", [sampleEntry]);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("Network down"))));

    const result = await lookupWord("ataraxia", "es");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.found).toBe(true);
      expect(result.offline).toBe(true);
      expect(result.entries[0]?.lemma).toBe("ataraxia");
      expect(result.entries[0]?.senses[0]?.definition).toBe(
        "Imperturbabilidad, serenidad del alma.",
      );
    }
  });

  it("resuelve de inmediato desde la memoria local si navigator.onLine es false", async () => {
    mockCachedMap.set("es:ataraxia", [sampleEntry]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

    const result = await lookupWord("ataraxia", "es");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offline).toBe(true);
      expect(result.entries[0]?.lemma).toBe("ataraxia");
    }
  });

  it("utiliza savedWords como respaldo si no está en la caché del léxico", async () => {
    mockSavedMap.set("es:efímero", {
      form: "efímero",
      lemma: "efímero",
      meaning: "Que dura poco tiempo.",
      senseEntryId: "2002",
      senseOrder: 1,
    });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("Offline"))));

    const result = await lookupWord("efímero", "es");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.found).toBe(true);
      expect(result.offline).toBe(true);
      expect(result.entries[0]?.senses[0]?.definition).toBe("Que dura poco tiempo.");
    }
  });

  it("informa claramente si la palabra no está ni en la red ni en memoria local", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("Offline"))));

    const result = await lookupWord("desconocida", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.offline).toBe(true);
      expect(result.error).toContain("Sin conexión con el catálogo");
    }
  });

  it("batchLookup devuelve las palabras cacheadas cuando está sin conexión", async () => {
    mockCachedMap.set("es:palabra", [sampleEntry]);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

    const result = await batchLookup(["palabra", "otra"], "es");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries["palabra"]).toBeDefined();
      expect(result.entries["otra"]).toBeUndefined();
    }
  });
});
