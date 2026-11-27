// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  buildExlibrisData,
  collectBookExlibrisStats,
  EXLIBRIS_HEIGHT,
  EXLIBRIS_WIDTH,
  exlibrisFilename,
  formatExlibrisDuration,
  renderExlibrisToCanvas,
} from "./exlibris-card";
import { THEME_PALETTES } from "./quote-card";

describe("exlibris-card", () => {
  it("formatExlibrisDuration omite ceros e inválidos y formatea horas y minutos reales", () => {
    expect(formatExlibrisDuration(undefined)).toBeNull();
    expect(formatExlibrisDuration(0)).toBeNull();
    expect(formatExlibrisDuration(-12)).toBeNull();
    expect(formatExlibrisDuration(Number.NaN)).toBeNull();
    expect(formatExlibrisDuration(45)).toBe("45 min");
    expect(formatExlibrisDuration(60)).toBe("1 h");
    expect(formatExlibrisDuration(135)).toBe("2 h 15 min");
  });

  it("buildExlibrisData normaliza título, deduce hasta 5 palabras únicas y omite ceros", () => {
    const clean = buildExlibrisData({
      bookName: "el_principito-edition.epub",
      author: "  Antoine de Saint-Exupéry ",
      readingMinutes: 0,
      words: ["Aurora", "aurora", "baobab", "crepusculo", "espejismo", "lámpara", "sexta"],
      companionStage: 9,
    });

    expect(clean.title).toBe("El Principito Edition");
    expect(clean.author).toBe("Antoine de Saint-Exupéry");
    expect(clean.readingTimeLabel).toBeNull();
    expect(clean.words).toEqual(["Aurora", "baobab", "crepusculo", "espejismo", "lámpara"]);
    expect(clean.companionStage).toBe(3);
    expect(clean.theme).toBe("papel");
  });

  it("buildExlibrisData sustituye nombres con forma de hash por título legible", () => {
    const data = buildExlibrisData({
      bookTitle: "fb2503e949cf6187c07e78b70c755ee4",
      readingMinutes: 90,
      words: [],
      theme: "noche",
    });

    expect(data.title).toBe("Libro sin título");
    expect(data.readingTimeLabel).toBe("1 h 30 min");
    expect(data.words).toEqual([]);
    expect(data.theme).toBe("noche");
  });

  it("collectBookExlibrisStats filtra estrictamente por bookHash y nunca inventa métricas", () => {
    const empty = collectBookExlibrisStats(
      "book-a",
      [{ bookHash: "book-other", form: "efimero", savedAt: 100 }],
      [{ bookHash: "book-other", startedAt: 0, endedAt: 3_600_000 }],
    );
    expect(empty).toEqual({ words: [], readingMinutes: 0 });

    const stats = collectBookExlibrisStats(
      "book-a",
      [
        { bookHash: "book-a", lemma: "alborada", form: "alborada", savedAt: 200 },
        { bookHash: "book-a", form: "umbral", savedAt: 100 },
        { bookHash: "book-a", lemma: "alborada", form: "Alborada", savedAt: 50 },
        { bookHash: "book-a", form: "borrada", savedAt: 300, deleted: true },
      ],
      [
        { bookHash: "book-a", startedAt: 0, endedAt: 45 * 60_000 },
        { bookHash: "book-other", startedAt: 0, endedAt: 99 * 60_000 },
      ],
    );

    expect(stats.words).toEqual(["alborada", "umbral"]);
    expect(stats.readingMinutes).toBe(45);
  });

  it("exlibrisFilename genera un nombre seguro sin acentos ni espacios", () => {
    expect(exlibrisFilename("Cien años de soledad")).toBe("exlibris-cien-anos-de-soledad.png");
    expect(exlibrisFilename("")).toBe("exlibris-lecta.png");
  });

  function createMockCanvas() {
    const fills: Array<{ text: string; fillStyle: string }> = [];
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "center",
      lineCap: "butt",
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      measureText: (s: string) => ({ width: s.length * 12 }),
      fillText: vi.fn((text: string) => {
        fills.push({ text, fillStyle: String(ctx.fillStyle) });
      }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    return { canvas, fills };
  }

  it("renderExlibrisToCanvas pinta 1080×1920 con tiempo real, palabras y firma lectal.app", async () => {
    const { canvas, fills } = createMockCanvas();
    await renderExlibrisToCanvas(
      {
        bookTitle: "Pedro Páramo",
        author: "Juan Rulfo",
        readingMinutes: 130,
        words: ["murmullo", "comala", "páramo"],
        theme: "papel",
        includeCompanion: true,
        coatId: "tuxedo",
        companionStage: 2,
      },
      canvas,
    );

    expect(canvas.width).toBe(EXLIBRIS_WIDTH);
    expect(canvas.height).toBe(EXLIBRIS_HEIGHT);
    expect(fills.some((f) => f.text === "EXLIBRIS" && f.fillStyle === THEME_PALETTES.papel.brand)).toBe(true);
    expect(fills.some((f) => f.text === "Pedro Páramo")).toBe(true);
    expect(fills.some((f) => f.text === "Juan Rulfo")).toBe(true);
    expect(fills.some((f) => f.text === "Tiempo de lectura")).toBe(true);
    expect(fills.some((f) => f.text === "2 h 10 min")).toBe(true);
    expect(fills.some((f) => f.text === "PALABRAS GUARDADAS")).toBe(true);
    expect(fills.some((f) => f.text.includes("murmullo · comala · páramo"))).toBe(true);
    expect(fills.some((f) => f.text === "Lecta · lectal.app")).toBe(true);
  });

  it("renderExlibrisToCanvas omite bloques de tiempo y palabras cuando no hay registros reales", async () => {
    const { canvas, fills } = createMockCanvas();
    await renderExlibrisToCanvas(
      {
        bookTitle: "El túnel",
        author: "Ernesto Sabato",
        readingMinutes: 0,
        words: [],
        theme: "noche",
        includeCompanion: false,
      },
      canvas,
    );

    expect(fills.some((f) => f.text === "EXLIBRIS")).toBe(true);
    expect(fills.some((f) => f.text === "El túnel")).toBe(true);
    expect(fills.some((f) => f.text === "Tiempo de lectura")).toBe(false);
    expect(fills.some((f) => f.text === "PALABRAS GUARDADAS")).toBe(false);
    expect(fills.some((f) => f.text === "Lecta · lectal.app")).toBe(true);
  });
});
