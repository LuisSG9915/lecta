// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createChapterAnalyzer } from "./chapter-analysis";
import type { ChapterCatalog, ChapterTarget } from "./chapters";
import type { EpubBook } from "./epub";

const target = (id: string, sectionIndex: number): ChapterTarget => ({
  id,
  label: id,
  href: id,
  sectionIndex,
  depth: 0,
  kind: "chapter",
});

// Un libro falso: cada sección produce un documento con su texto.
const fakeBook = (texts: string[]): EpubBook =>
  ({
    sections: texts.map(
      (text, index) =>
        ({
          id: `sec${index}.xhtml`,
          size: text.length,
          linear: "yes",
          createDocument: async () =>
            new DOMParser().parseFromString(
              `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${text}</p></body></html>`,
              "application/xhtml+xml",
            ),
        }) as unknown as EpubBook["sections"][number],
    ),
  }) as unknown as EpubBook;

const catalog = (ranges: [string, number, number][]): ChapterCatalog => {
  const targets = ranges.map(([id, start]) => target(id, start));
  return {
    targets,
    ranges: ranges.map(([id, start, end]) => ({
      target: target(id, start),
      startSection: start,
      endSection: end,
    })),
  };
};

const analyzer = (
  book: EpubBook,
  cat: ChapterCatalog,
  deps: {
    extractWords?: (text: string) => Promise<string[]>;
    lookup?: (forms: string[]) => Promise<{ ok: true; entries: Record<string, never[]> } | { ok: false; error: string; entries: Record<string, never> }>;
    isCurrent?: () => boolean;
  } = {},
) =>
  createChapterAnalyzer(cat, {
    book,
    language: "es",
    extractWords: deps.extractWords ?? (async () => []),
    lookup: deps.lookup ?? (async () => ({ ok: true, entries: {} })),
    isCurrent: deps.isCurrent,
  });

describe("createChapterAnalyzer", () => {
  it("analiza solo el texto del rango, no de las secciones vecinas", async () => {
    const book = fakeBook(["intro", "capítulo uno", "capítulo dos", "cierre"]);
    const cat = catalog([
      ["intro.xhtml", 0, 1],
      ["cap1.xhtml", 1, 3], // capítulo repartido: secciones 1 y 2
      ["cierre.xhtml", 3, 4],
    ]);
    const seen: string[] = [];
    const a = analyzer(book, cat, {
      extractWords: async (text) => {
        seen.push(text);
        return ["palabra"];
      },
    });
    await a.analyze(cat.ranges[1]);
    expect(seen[0]).toContain("capítulo uno");
    expect(seen[0]).toContain("capítulo dos");
    expect(seen[0]).not.toContain("intro");
    expect(seen[0]).not.toContain("cierre");
  });

  it("dos solicitudes del mismo destino comparten una sola corrida", async () => {
    const book = fakeBook(["texto del capítulo"]);
    const cat = catalog([["cap.xhtml", 0, 1]]);
    const lookup = vi.fn(async () => ({ ok: true as const, entries: {} }));
    const a = analyzer(book, cat, {
      extractWords: async () => ["perenne"],
      lookup,
    });
    const [r1, r2] = await Promise.all([
      a.analyze(cat.ranges[0]),
      a.analyze(cat.ranges[0]),
    ]);
    expect(r1).toBe(r2);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("el resultado listo queda en caché; el error se reintenta", async () => {
    const book = fakeBook(["texto"]);
    const cat = catalog([["cap.xhtml", 0, 1]]);
    const lookup = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: false as const,
        error: "caído",
        entries: {},
      }))
      .mockImplementation(async () => ({ ok: true as const, entries: {} }));
    const a = analyzer(book, cat, { extractWords: async () => ["casa"], lookup });

    expect((await a.analyze(cat.ranges[0])).state).toBe("error");
    const again = await a.analyze(cat.ranges[0]);
    expect(again.state).toBe("ready");
    expect(lookup).toHaveBeenCalledTimes(2);
    // La tercera viene de caché sin tocar la red.
    expect((await a.analyze(cat.ranges[0])).state).toBe("ready");
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("extracción fallida produce estado error, nunca lanza", async () => {
    const book = {
      sections: [
        {
          id: "sec0.xhtml",
          size: 1,
          linear: "yes",
          createDocument: async () => {
            throw new Error("archivo dañado");
          },
        },
      ],
    } as unknown as EpubBook;
    const cat = catalog([["cap.xhtml", 0, 1]]);
    const a = analyzer(book, cat);
    const result = await a.analyze(cat.ranges[0]);
    expect(result.state).toBe("error");
  });

  it("sin formas la consulta no sale a la red", async () => {
    const book = fakeBook(["solo puntuación"]);
    const cat = catalog([["cap.xhtml", 0, 1]]);
    const lookup = vi.fn(async () => ({ ok: true as const, entries: {} }));
    const a = analyzer(book, cat, { extractWords: async () => [], lookup });
    const result = await a.analyze(cat.ranges[0]);
    expect(result.state).toBe("ready");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("libro cambiado a mitad descarta el resultado como stale", async () => {
    const book = fakeBook(["texto del capítulo"]);
    const cat = catalog([["cap.xhtml", 0, 1]]);
    let current = true;
    const a = analyzer(book, cat, {
      extractWords: async () => {
        current = false;
        return ["casa"];
      },
      isCurrent: () => current,
    });
    const result = await a.analyze(cat.ranges[0]);
    expect(result.state).toBe("stale");
    expect(a.cached("cap.xhtml")).toBeUndefined();
  });

  it("precarga solo el siguiente destino real", async () => {
    const book = fakeBook(["intro", "cap uno", "cap dos", "cierre"]);
    const cat = catalog([
      ["intro.xhtml", 0, 1],
      ["cap1.xhtml", 1, 3],
      ["cierre.xhtml", 3, 4],
    ]);
    const seen: string[] = [];
    const a = analyzer(book, cat, {
      extractWords: async (text) => {
        seen.push(text);
        return [];
      },
    });
    // Estamos en la sección 1, dentro del rango cap1 [1,3): el
    // siguiente destino real es cierre, no la sección 2 (que es del
    // mismo capítulo).
    expect(a.nextRangeAfter(1)?.target.id).toBe("cierre.xhtml");
    await a.preloadNext(1);
    expect(seen[0]).toContain("cierre");
    expect(seen[0]).not.toContain("cap dos");
  });

  it("knownSection solo aplica si el rango es exactamente esa sección", async () => {
    const book = fakeBook(["texto real", "otro"]);
    const cat = catalog([
      ["uno.xhtml", 0, 1],
      ["dos.xhtml", 1, 2],
    ]);
    const a = analyzer(book, cat, {
      extractWords: async (text) => [text],
      lookup: async () => ({ ok: true, entries: {} }),
    });
    // Rango de una sección con texto conocido: no reextrae.
    const r1 = await a.analyze(cat.ranges[0], {
      knownSection: { index: 0, text: "texto ya renderizado" },
    });
    expect(r1.state).toBe("ready");
    if (r1.state === "ready") expect(r1.text).toBe("texto ya renderizado");
    // Rango distinto: el texto conocido no se reusa indebidamente.
    const r2 = await a.analyze(cat.ranges[1], {
      knownSection: { index: 0, text: "texto ya renderizado" },
    });
    if (r2.state === "ready") expect(r2.text).toContain("otro");
  });
});
