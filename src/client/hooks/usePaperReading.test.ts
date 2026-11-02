// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  usePaperReading,
  type ManualSaveOutcome,
} from "./usePaperReading";
import { buildChapterSuggestionRows } from "../lib/preparation-rows";
import { preparationRecordKey } from "../lib/preparation";
import {
  firstAppearance,
  paperReadingKey,
  splitPaperRows,
} from "../lib/paper-reading";
import { savedFormLevels } from "../lib/word-level";
import type { ChapterAnalysis } from "../lib/chapter-analysis";
import type { EpubBook, EpubTocItem } from "../lib/epub";
import type { LexiconEntry } from "../lib/lexicon";
import type { SavedWord } from "../lib/idb";
import { openEpub } from "../lib/epub";
import { fetchBookGuide } from "../lib/books";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type ReadyAnalysis = Extract<ChapterAnalysis, { state: "ready" }>;

// Estado compartido de los mocks: el store «session» real (un Map) para
// que paperReading y preparation corran de verdad contra él.
const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  storedBook: {
    hash: "h1",
    name: "libro.epub",
    data: new Blob(),
    language: "es",
  } as {
    hash: string;
    name: string;
    data: Blob;
    language: string;
    [k: string]: unknown;
  } | null,
  detectLang: "es",
  storedWords: [] as SavedWord[],
  savedWordByKey: new Map<string, SavedWord>(),
  knowledgeRows: [] as { lemma: string; known: boolean }[],
  profile: { threshold: 2.5, confidence: 0.5 } as {
    threshold: number;
    confidence: number;
  } | null,
  analyzerResult: null as ReadyAnalysis | null,
  analyzerError: false,
  confirmCalls: [] as {
    record: { disposition: string; updatedAt: number };
    recordKey: string;
  }[],
  confirmSaved: true,
  pushWords: vi.fn(async () => ({ ok: true })),
  pushKnowledge: vi.fn(async () => ({ ok: true })),
  saveWordCalls: [] as {
    word: Record<string, unknown>;
    knowledge: Record<string, unknown>;
  }[],
  lookupResult: null as {
    ok: boolean;
    found?: boolean;
    entries?: {
      lemma?: string;
      pos?: string;
      zipf?: number | null;
      entryId?: string;
      senses?: { definition?: string; senseOrder?: number }[];
    }[];
  } | null,
  removeWordCalls: [] as string[],
  scopeActive: true,
  remoteGuide: null as unknown,
}));

vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...mod,
    captureDbScope: vi.fn(() => ({ userId: "u1", generation: 0 })),
    isDbScopeActive: vi.fn(() => mocks.scopeActive),
    getStoredBook: vi.fn(async () => mocks.storedBook ?? undefined),
    listSavedWords: vi.fn(async () => mocks.storedWords),
    loadSavedWord: vi.fn(async (language: string, form: string) =>
      mocks.savedWordByKey.get(`${language}:${form.toLowerCase()}`),
    ),
    saveWordWithKnowledge: vi.fn(async (input: never) => {
      const { word, knowledge } = input as {
        word: Record<string, unknown> & { language: string; form: string };
        knowledge: Record<string, unknown>;
      };
      mocks.saveWordCalls.push(input as never);
      return {
        word: {
          ...word,
          key: `${word.language}:${word.form.toLowerCase()}`,
          savedAt: 100,
          updatedAt: 100,
        } as SavedWord,
        knowledge,
      };
    }),
    loadSessionValue: vi.fn(async (key: string) =>
      mocks.store.get(key) ?? null,
    ),
    saveSessionValue: vi.fn(async (key: string, value: string) => {
      mocks.store.set(key, value);
    }),
  };
});

vi.mock("../lib/epub", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/epub")>();
  return {
    ...mod,
    openEpub: vi.fn(async () => ({
      book: fakeBook,
      close: vi.fn(async () => undefined),
      loadBlob: async () => null,
    })),
    detectBookLanguage: vi.fn(async () => mocks.detectLang),
    getBookLanguage: vi.fn(() => mocks.detectLang),
    getBookTitle: vi.fn(() => "Libro de prueba"),
    getBookAuthor: vi.fn(() => "Autora"),
  };
});

vi.mock("../lib/paper-guide", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/paper-guide")>();
  return {
    ...mod,
    createGuideChapterAnalyzer: vi.fn(() => ({
      analyze: vi.fn(async () =>
        mocks.analyzerError
          ? ({ state: "error", error: "fallo" } as ChapterAnalysis)
          : mocks.analyzerResult,
      ),
      cached: vi.fn(() => undefined),
      preloadNext: vi.fn(async () => undefined),
    })),
  };
});

vi.mock("../lib/books", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/books")>();
  return {
    ...mod,
    fetchBookGuide: vi.fn(async () => mocks.remoteGuide),
  };
});

vi.mock("../lib/chapter-analysis", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../lib/chapter-analysis")>();
  return {
    ...mod,
    createChapterAnalyzer: vi.fn(() => ({
      analyze: vi.fn(async () =>
        mocks.analyzerError
          ? ({ state: "error", error: "fallo" } as ChapterAnalysis)
          : mocks.analyzerResult,
      ),
      cached: vi.fn(() => undefined),
      preloadNext: vi.fn(async () => undefined),
    })),
  };
});

vi.mock("../lib/reader-evidence", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/reader-evidence")>();
  return {
    ...mod,
    refreshProfile: vi.fn(
      async (
        refs: {
          profileRef: { current: unknown };
          knowledgeMapRef: {
            current: Map<string, { lemma: string; known: boolean }>;
          };
        },
      ) => {
        refs.profileRef.current = mocks.profile;
        for (const row of mocks.knowledgeRows) {
          refs.knowledgeMapRef.current.set(row.lemma, row);
        }
      },
    ),
  };
});

vi.mock("../lib/lexicon", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/lexicon")>();
  return {
    ...mod,
    lookupWord: vi.fn(async () => mocks.lookupResult ?? { ok: false }),
  };
});

vi.mock("../lib/reading-sync", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/reading-sync")>();
  return { ...mod, pushKnowledgeToServer: mocks.pushKnowledge };
});

vi.mock("../lib/vocab", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/vocab")>();
  return {
    ...mod,
    pushWordsToServer: mocks.pushWords,
    removeWord: vi.fn(async (key: string) => {
      mocks.removeWordCalls.push(key);
      return { key, form: key.split(":")[1] ?? key };
    }),
  };
});

vi.mock("../lib/preparation", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/preparation")>();
  return {
    ...mod,
    confirmPreparation: vi.fn(async (input: never) => {
      mocks.confirmCalls.push(input as never);
      const typed = input as {
        knowledge: { language: string; lemma: string; known: boolean }[];
        words: { language: string; form: string }[];
      };
      return {
        saved: mocks.confirmSaved,
        synced: true,
        knowledge: typed.knowledge.map((k) => ({
          ...k,
          key: `${k.language}:${k.lemma}`,
          source: "preparation",
          updatedAt: 1,
        })),
        words: typed.words.map((w) => ({
          ...w,
          key: `${w.language}:${w.form.toLowerCase()}`,
          savedAt: 1,
          updatedAt: 1,
        })),
      };
    }),
  };
});

vi.mock("../lib/game", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/game")>();
  return { ...mod, award: vi.fn(async () => undefined) };
});

// Libro sintético: dos capítulos tras una portada.
const fakeBook = {
  sections: [
    { id: "s0.xhtml" },
    { id: "s1.xhtml" },
    { id: "s2.xhtml" },
  ],
  toc: [
    { label: "Portada", href: "s0.xhtml" },
    { label: "Capítulo 1", href: "s1.xhtml" },
    { label: "Capítulo 2", href: "s2.xhtml" },
  ] as EpubTocItem[],
  landmarks: [],
  metadata: { language: "es" },
} as unknown as EpubBook;

const entry = (lemma: string, zipf = 1.5): LexiconEntry => ({
  entryId: `id-${lemma}`,
  lemma,
  pos: "sustantivo",
  freqRank: null,
  zipf,
  senses: [],
});

const analysis = (
  forms: string[],
  text: string,
  extra: Partial<ReadyAnalysis> = {},
): ReadyAnalysis => ({
  state: "ready",
  forms,
  entries: Object.fromEntries(forms.map((f) => [f, [entry(f)]])),
  capitalOnly: new Set<string>(),
  text,
  ...extra,
});

const savedWord = (form: string, extra: Partial<SavedWord> = {}): SavedWord => ({
  key: `es:${form}`,
  form,
  lemma: form,
  language: "es",
  savedAt: 1,
  updatedAt: 1,
  ...extra,
});

describe("usePaperReading", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = () => {
    let result!: ReturnType<typeof usePaperReading>;
    const statuses: string[] = [];
    function C() {
      result = usePaperReading("h1", { onStatus: (m) => statuses.push(m) });
      return null;
    }
    act(() => {
      root.render(h(C));
    });
    return {
      get result() {
        return result;
      },
      statuses,
    };
  };

  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  const openAndFlush = async () => {
    const view = render();
    await flush();
    expect(view.result.phase).toBe("ready");
    return view;
  };

  const firstChapter = async (
    view: Awaited<ReturnType<typeof openAndFlush>>,
  ) => {
    const entry = view.result.entries[0];
    expect(entry).toBeDefined();
    await act(async () => {
      await view.result.openChapter(entry);
    });
    expect(view.result.sheet?.analysis).toBe("ready");
    return view.result.sheet!;
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.store.clear();
    mocks.savedWordByKey.clear();
    mocks.storedWords = [];
    mocks.knowledgeRows = [];
    mocks.profile = { threshold: 2.5, confidence: 0.5 };
    mocks.storedBook = {
      hash: "h1",
      name: "libro.epub",
      data: new Blob(),
      language: "es",
    };
    mocks.detectLang = "es";
    mocks.analyzerResult = analysis(
      ["zenit", "casa", "brújula"],
      "La casa era bella. El zenit marcaba el cielo. La brújula giraba.",
    );
    mocks.analyzerError = false;
    mocks.confirmCalls.length = 0;
    mocks.confirmSaved = true;
    mocks.saveWordCalls.length = 0;
    mocks.removeWordCalls.length = 0;
    mocks.lookupResult = null;
    mocks.scopeActive = true;
    mocks.remoteGuide = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("1. produce filas idénticas a buildChapterSuggestionRows con los mismos datos", async () => {
    const view = await openAndFlush();
    const sheet = await firstChapter(view);
    const expected = buildChapterSuggestionRows(
      mocks.analyzerResult!,
      "es",
      {
        saved: savedFormLevels(mocks.storedWords),
        knowledge: new Map(
          mocks.knowledgeRows.map((k) => [k.lemma, { ...k }]),
        ),
        threshold: 2.5,
      },
    );
    const shown = new Set(
      [...sheet.main, ...sheet.more, ...sheet.uncertain].map((r) => r.key),
    );
    const want = new Set(
      [...expected.rows, ...expected.deferred, ...expected.uncertain].map(
        (r) => r.key,
      ),
    );
    expect(shown).toEqual(want);
  });

  it("2. las principales van en orden de aparición y el resto en «más»", async () => {
    const forms = [
      "alfa",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "etala",
      "theta",
      "iota",
      "kappa",
      "lambda",
      "muro",
      "nube",
      "xilo",
    ];
    // Texto que menciona la segunda mitad primero: el orden visible
    // sigue al capítulo, no al de la selección.
    const text = `${[...forms].reverse().join(" ")}.`;
    mocks.analyzerResult = analysis(forms, text);
    const view = await openAndFlush();
    const sheet = await firstChapter(view);
    expect(sheet.main).toHaveLength(12);
    // Las principales siguen el orden del capítulo: cada forma aparece
    // en el texto no después que la siguiente.
    const appearances = sheet.main.map((r) =>
      firstAppearance(text, r.form),
    );
    for (let i = 1; i < appearances.length; i += 1) {
      expect(appearances[i]).toBeGreaterThanOrEqual(appearances[i - 1]);
    }
    // Y la partición coincide con la selección real: las 12 primeras
    // filas suyas, reordenadas por aparición; el resto en «más».
    const expected = splitPaperRows(
      buildChapterSuggestionRows(mocks.analyzerResult!, "es", {
        saved: savedFormLevels(mocks.storedWords),
        knowledge: new Map(),
        threshold: 2.5,
      }),
      text,
    );
    expect(sheet.main.map((r) => r.key)).toEqual(
      expected.main.map((r) => r.key),
    );
    expect(sheet.more.map((r) => r.key)).toEqual(
      expected.more.map((r) => r.key),
    );
  });

  it("3. salir con respuestas confirma una sola vez con disposition «reviewed»", async () => {
    const view = await openAndFlush();
    const sheet = await firstChapter(view);
    const key = sheet.main[0].key;
    await act(async () => {
      view.result.answerWord(key, "unknown");
    });
    // El borrador queda persistido al tocar.
    const draft = mocks.store.get(
      preparationRecordKey("h1", sheet.target.id),
    );
    expect(draft).toBeTruthy();
    expect(JSON.parse(draft!).answers[key]).toBe("unknown");

    await act(async () => {
      await view.result.closeChapter();
    });
    expect(mocks.confirmCalls).toHaveLength(1);
    expect(mocks.confirmCalls[0].record.disposition).toBe("reviewed");
    expect(mocks.confirmCalls[0].recordKey).toBe(
      preparationRecordKey("h1", sheet.target.id),
    );
  });

  it("4. salir sin respuestas no escribe nada", async () => {
    const view = await openAndFlush();
    await firstChapter(view);
    await act(async () => {
      await view.result.closeChapter();
    });
    expect(mocks.confirmCalls).toHaveLength(0);
  });

  it("5. el alta manual adjunta la frase solo si la palabra está en el capítulo", async () => {
    const view = await openAndFlush();
    await firstChapter(view);
    let outcome: ManualSaveOutcome | undefined;
    await act(async () => {
      outcome = await view.result.addManualWord("zenit");
    });
    expect(outcome?.kind).toBe("saved");
    const present = mocks.saveWordCalls.at(-1)!.word;
    expect(present.context).toContain("zenit");

    await act(async () => {
      outcome = await view.result.addManualWord("inexistente");
    });
    expect(outcome?.kind).toBe("saved");
    const absent = mocks.saveWordCalls.at(-1)!.word;
    expect(absent.context).toBeUndefined();
  });

  it("6. en un libro en inglés la palabra manual queda con language «en»", async () => {
    mocks.storedBook = {
      hash: "h1",
      name: "libro.epub",
      data: new Blob(),
      language: "en",
    };
    mocks.detectLang = "en";
    const view = await openAndFlush();
    expect(view.result.language).toBe("en");
    await firstChapter(view);
    await act(async () => {
      await view.result.addManualWord("zenit");
    });
    const call = mocks.saveWordCalls.at(-1)!;
    expect(call.word.language).toBe("en");
    expect(call.knowledge.language).toBe("en");
  });

  it("7. una palabra ya guardada no se escribe de nuevo", async () => {
    mocks.savedWordByKey.set("es:zenit", savedWord("zenit"));
    const view = await openAndFlush();
    await firstChapter(view);
    let outcome: ManualSaveOutcome | undefined;
    await act(async () => {
      outcome = await view.result.addManualWord("zenit");
    });
    expect(outcome?.kind).toBe("already");
    expect(mocks.saveWordCalls).toHaveLength(0);
  });

  it("8. deshacer retira solo lo creado por esta alta", async () => {
    const view = await openAndFlush();
    await firstChapter(view);
    let outcome: ManualSaveOutcome | undefined;
    await act(async () => {
      outcome = await view.result.addManualWord("zenit");
    });
    const key = outcome?.kind === "saved" ? outcome.wordKey : "";
    await act(async () => {
      await view.result.undoManualWord(key);
      // Una clave ajena jamás se borra.
      await view.result.undoManualWord("es:otra");
    });
    expect(mocks.removeWordCalls).toEqual([key]);
  });

  it("9. si la cuenta cambió no se empuja nada al servidor", async () => {
    mocks.scopeActive = false;
    const view = await openAndFlush();
    await firstChapter(view);
    await act(async () => {
      await view.result.addManualWord("zenit");
    });
    expect(mocks.pushWords).not.toHaveBeenCalled();
    expect(mocks.pushKnowledge).not.toHaveBeenCalled();
  });

  it("10. «Terminé» marca el capítulo como leído y «desmarcar» lo quita", async () => {
    const view = await openAndFlush();
    const sheet = await firstChapter(view);
    await act(async () => {
      await view.result.finishChapter();
    });
    expect(view.result.sheet?.finished).toBe(true);
    const saved = JSON.parse(mocks.store.get(paperReadingKey("h1"))!);
    expect(saved.readTargetIds).toContain(sheet.target.id);
    expect(
      view.result.entries.find((e) => e.target.id === sheet.target.id)
        ?.status,
    ).toBe("read");

    await act(async () => {
      view.result.toggleRead();
    });
    const after = JSON.parse(mocks.store.get(paperReadingKey("h1"))!);
    expect(after.readTargetIds).not.toContain(sheet.target.id);
  });

  it("un capítulo sin candidatas llega a «ready» con listas vacías", async () => {
    mocks.analyzerResult = analysis([], "Texto sin palabras.");
    const view = await openAndFlush();
    const sheet = await firstChapter(view);
    expect(sheet.analysis).toBe("ready");
    expect(sheet.main).toHaveLength(0);
    expect(sheet.more).toHaveLength(0);
  });

  it("un fallo del análisis deja la hoja en «error» y reintentar la recupera", async () => {
    mocks.analyzerError = true;
    const view = await openAndFlush();
    const entry = view.result.entries[0];
    await act(async () => {
      await view.result.openChapter(entry);
    });
    expect(view.result.sheet?.analysis).toBe("error");
    mocks.analyzerError = false;
    await act(async () => {
      view.result.retryAnalysis();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(view.result.sheet?.analysis).toBe("ready");
  });

  // --- Modelo A1: guía comunitaria sin EPUB -------------------------

  const guideJson = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      version: 1,
      bookHash: "h1",
      title: "Guía compartida",
      author: "Autora",
      language: "es",
      updatedAt: 1,
      chapters: [
        {
          id: "cap/uno.xhtml",
          label: "Capítulo 1",
          depth: 0,
          kind: "chapter",
          forms: ["zenit"],
          capitalOnly: [],
        },
        {
          id: "cap/dos.xhtml",
          label: "Capítulo 2",
          depth: 0,
          kind: "chapter",
          forms: ["brújula"],
          capitalOnly: [],
        },
      ],
      ...overrides,
    });

  const installGuide = () => {
    mocks.storedBook = {
      hash: "h1",
      name: "guia.epub",
      data: new Blob([]), // 0 bytes: solo hay guía, no EPUB
      paperOnly: true,
      title: "Guía compartida",
      language: "es",
    };
    mocks.store.set("paperGuide:v1:h1", guideJson());
    mocks.analyzerResult = analysis(["zenit"], "");
  };

  it("una guía paperOnly abre el modo papel sin tocar el EPUB", async () => {
    installGuide();
    const view = await openAndFlush();
    expect(view.result.phase).toBe("ready");
    expect(openEpub).not.toHaveBeenCalled();
    expect(view.result.entries.map((e) => e.target.id)).toEqual([
      "cap/uno.xhtml",
      "cap/dos.xhtml",
    ]);
    // La hoja corre con el mismo pipeline y sin texto fuente.
    const sheet = await firstChapter(view);
    expect(sheet.analysis).toBe("ready");
    expect(sheet.text).toBe("");
  });

  it("la guía se recupera del servidor si IndexedDB la perdió", async () => {
    installGuide();
    mocks.store.delete("paperGuide:v1:h1");
    mocks.remoteGuide = JSON.parse(guideJson());
    const view = await openAndFlush();
    expect(view.result.phase).toBe("ready");
    expect(fetchBookGuide).toHaveBeenCalledWith(
      "h1",
      expect.objectContaining({ userId: "u1" }),
    );
    // Y quedó persistida de nuevo para el modo offline.
    expect(mocks.store.get("paperGuide:v1:h1")).toBeTruthy();
  });

  it("sin guía local ni remota la pantalla queda en error, no en el lector", async () => {
    installGuide();
    mocks.store.delete("paperGuide:v1:h1");
    mocks.remoteGuide = null;
    const view = render();
    await flush();
    expect(view.result.phase).toBe("error");
    expect(openEpub).not.toHaveBeenCalled();
  });

  it("el alta manual sobre guía no adjunta contexto (no hay texto fuente)", async () => {
    installGuide();
    const view = await openAndFlush();
    await firstChapter(view);
    let outcome: ManualSaveOutcome | undefined;
    await act(async () => {
      outcome = await view.result.addManualWord("palabrareal");
    });
    expect(outcome?.kind).toBe("saved");
    const call = mocks.saveWordCalls.at(-1)!;
    expect(call.word.context).toBeUndefined();
    expect(call.word.bookHash).toBe("h1");
  });
});
