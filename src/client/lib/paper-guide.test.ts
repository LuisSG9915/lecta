// jsdom no implementa Blob.arrayBuffer (que pide zip.js al abrir el
// EPUB). FileReader sí existe: polyfill solo para estas pruebas.
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolvePromise, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolvePromise(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  sanitizePaperBookGuide,
  PAPER_GUIDE_LABEL_MAX,
  type PaperBookGuide,
} from "../../shared/paper-guide";
import {
  buildPaperBookGuide,
  catalogFromPaperGuide,
  createGuideChapterAnalyzer,
} from "./paper-guide";

const HASH = "a".repeat(64);

const baseGuide = (): PaperBookGuide => ({
  version: 1,
  bookHash: HASH,
  title: "Libro guía",
  author: "Autora",
  language: "es",
  updatedAt: 1,
  chapters: [
    {
      id: "cap/uno.xhtml",
      label: "Capítulo uno",
      depth: 0,
      kind: "chapter",
      forms: ["antigua", "casa", "perenne"],
      capitalOnly: [],
    },
    {
      id: "cap/dos.xhtml",
      label: "Capítulo dos",
      depth: 0,
      kind: "chapter",
      forms: ["meridiano"],
      capitalOnly: ["maría"],
    },
  ],
});

describe("sanitizePaperBookGuide (contrato A1: solo palabras)", () => {
  it("acepta una guía válida y la normaliza", () => {
    const guide = sanitizePaperBookGuide(baseGuide(), HASH);
    expect(guide).not.toBeNull();
    expect(guide!.title).toBe("Libro guía");
    expect(guide!.chapters).toHaveLength(2);
    expect(guide!.chapters[0].forms).toEqual(["antigua", "casa", "perenne"]);
  });

  it("rechaza hash distinto, versión distinta o sin capítulos", () => {
    expect(sanitizePaperBookGuide(baseGuide(), "b".repeat(64))).toBeNull();
    expect(
      sanitizePaperBookGuide({ ...baseGuide(), version: 2 }, HASH),
    ).toBeNull();
    expect(
      sanitizePaperBookGuide({ ...baseGuide(), chapters: [] }, HASH),
    ).toBeNull();
    expect(sanitizePaperBookGuide("no-json", HASH)).toBeNull();
  });

  it("descarta campos extra y ordena/filtra las formas", () => {
    const dirty = {
      ...baseGuide(),
      text: "oración completa del libro que no debe viajar",
      chapters: [
        {
          id: "a.xhtml",
          label: "Largo ".padEnd(120, "x"),
          depth: 0,
          kind: "chapter",
          forms: ["zeta", "Ámbar", "la", "12345", "casa"],
          capitalOnly: ["zeta"],
          context: "frase del libro",
        },
      ],
    };
    const guide = sanitizePaperBookGuide(dirty, HASH);
    expect(guide).not.toBeNull();
    expect((guide as unknown as Record<string, unknown>).text).toBeUndefined();
    const ch = guide!.chapters[0];
    expect((ch as unknown as Record<string, unknown>).context).toBeUndefined();
    expect(ch.label.length).toBeLessThanOrEqual(PAPER_GUIDE_LABEL_MAX);
    // «la» es stopword y «12345» no es palabra; las demás ordenadas A–Z.
    expect(ch.forms).toEqual(["casa", "zeta", "ámbar"].sort((a, b) => a.localeCompare(b)));
    expect(ch.forms).not.toContain("la");
    expect(ch.forms).not.toContain("12345");
  });
});

describe("buildPaperBookGuide (generación en el dispositivo del donante)", () => {
  const epubPath = resolve(__dirname, "../../../fixtures/minimal.epub");

  it("extrae capítulos y formas alfabéticas sin texto del libro", async () => {
    const data = new Uint8Array(readFileSync(epubPath));
    // Segmentador síncrono: jsdom no tiene Web Worker.
    const segmenter = new Intl.Segmenter("es", { granularity: "word" });
    const extractWords = async (text: string) =>
      [...segmenter.segment(text)]
        .filter((s) => s.isWordLike)
        .map((s) => s.segment);
    const guide = await buildPaperBookGuide(
      HASH,
      data,
      { title: "Mínimo", language: "es" },
      extractWords,
    );
    expect(guide).not.toBeNull();
    expect(guide!.bookHash).toBe(HASH);
    expect(guide!.language).toBe("es");
    expect(guide!.chapters.length).toBeGreaterThanOrEqual(2);

    const labels = guide!.chapters.map((ch) => ch.label);
    expect(labels.some((l) => l.includes("Capítulo uno"))).toBe(true);

    for (const ch of guide!.chapters) {
      const sorted = [...ch.forms].sort((a, b) => a.localeCompare(b));
      expect(ch.forms).toEqual(sorted);
      expect(ch.label.length).toBeLessThanOrEqual(PAPER_GUIDE_LABEL_MAX);
      // El contrato no tiene campo de texto: nada que reconstruir.
      expect(
        Object.prototype.hasOwnProperty.call(ch, "text"),
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(ch, "context"),
      ).toBe(false);
    }
    // Palabras del fixture llegan a algún capítulo.
    const all = new Set(guide!.chapters.flatMap((ch) => ch.forms));
    expect(all.has("casa")).toBe(true);
  });
});

describe("createGuideChapterAnalyzer (modo papel sin EPUB)", () => {
  it("produce el ChapterAnalysis listo con text vacío", async () => {
    const guide = baseGuide();
    const analyzer = createGuideChapterAnalyzer(guide, {
      language: "es",
      lookup: async (forms) => ({
        ok: true as const,
        entries: Object.fromEntries(
          forms.map((f) => [
            f,
            [
              {
                entryId: `e-${f}`,
                lemma: f,
                pos: "sust.",
                freqRank: null,
                zipf: 1.9,
                senses: [{ senseOrder: 1, definition: `d ${f}`, example: "" }],
              },
            ],
          ]),
        ),
      }),
    });
    const catalog = catalogFromPaperGuide(guide);
    const range = catalog.ranges[0];
    const result = await analyzer.analyze(range);
    expect(result.state).toBe("ready");
    if (result.state !== "ready") return;
    expect(result.text).toBe("");
    expect(result.forms).toEqual(["antigua", "casa", "perenne"]);
    expect(result.entries["casa"]?.[0]?.lemma).toBe("casa");
    // La segunda llamada sale de caché sin re-consultar.
    const again = await analyzer.analyze(range);
    expect(again).toBe(result);
  });
});
