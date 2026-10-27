// Retrato de lectura: lo puro (cifras, reparto del lienzo, nombre del
// archivo y texto al compartir). La rasterización vive en el navegador y se
// verificó a mano: el PNG de 1080×1350 sale con el gato en sus colores, lo
// que confirma que `inlineSvgMarkup` copia el estilo computado.
import { describe, expect, it } from "vitest";
import {
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  portraitFigures,
  portraitFilename,
  portraitLayout,
  portraitShareText,
  themeColor,
} from "./companion-portrait";
import { emptyGameState, type GameState } from "./gamification";

const state = (over: Partial<GameState> = {}): GameState => ({
  ...emptyGameState(),
  ...over,
  stats: { ...emptyGameState().stats, ...(over.stats ?? {}) },
});

describe("cifras del retrato", () => {
  it("sin estado devuelve sólo el nombre", () => {
    expect(portraitFigures(null, "Miso")).toEqual({
      name: "Miso",
      level: "Lecta",
      lines: [],
    });
  });

  it("cuenta horas, palabras, libros y racha con su plural", () => {
    const figs = portraitFigures(
      state({
        xp: 1150,
        stats: {
          ...emptyGameState().stats,
          minutes: 1500,
          saved: 312,
          booksFinished: 3,
          streakDays: 1,
        },
      }),
      "Miso",
    );
    // 1500 min = 25 h exactas: sin «0 min» de cola.
    expect(figs.lines).toEqual([
      "25 h leídas",
      "312 palabras guardadas",
      "3 libros terminados",
    ]);
    // `levelProgress` es 0-based: 1150 puntos son el nivel 8 visible.
    expect(figs.level).toBe("Nivel 8 · Bibliófilo");
  });

  it("no presume de ceros", () => {
    const figs = portraitFigures(
      state({ stats: { ...emptyGameState().stats, minutes: 42, saved: 1 } }),
      "Miso",
    );
    expect(figs.lines).toEqual(["42 min leídas", "1 palabra guardada"]);
  });

  it("una sola racha se dice en singular y con dos días aparece", () => {
    const unDia = portraitFigures(
      state({ stats: { ...emptyGameState().stats, streakDays: 1 } }),
      "Miso",
    );
    expect(unDia.lines).toEqual([]);
    const dos = portraitFigures(
      state({ stats: { ...emptyGameState().stats, streakDays: 2 } }),
      "Miso",
    );
    expect(dos.lines).toEqual(["2 días de racha"]);
  });
});

describe("reparto del lienzo", () => {
  it("4:5 fijo (1080×1350) y el gato centrado", () => {
    const layout = portraitLayout(0);
    expect(layout.width).toBe(PORTRAIT_WIDTH);
    expect(layout.height).toBe(PORTRAIT_HEIGHT);
    expect(layout.catX * 2 + layout.catSize).toBe(PORTRAIT_WIDTH);
  });

  it("el pie queda anclado abajo y el texto no lo pisa", () => {
    for (const lines of [0, 1, 4]) {
      const l = portraitLayout(lines);
      expect(l.footerY).toBe(PORTRAIT_HEIGHT - 84);
      const lastLine = l.firstLineY + Math.max(0, lines - 1) * l.lineGap;
      expect(lastLine).toBeLessThan(l.footerY);
      expect(l.catY).toBeGreaterThanOrEqual(90);
      expect(l.catY + l.catSize).toBeLessThan(l.nameY);
    }
  });

  it("con más cifras el bloque sube para no dejar hueco", () => {
    expect(portraitLayout(4).catY).toBeLessThan(portraitLayout(0).catY);
  });
});

describe("nombre del archivo y texto al compartir", () => {
  it("limpia tildes, espacios y símbolos", () => {
    expect(portraitFilename("Miso", new Date("2026-10-26T10:00:00"))).toBe(
      "lecta-miso-2026-10-26.png",
    );
    expect(portraitFilename("Señor Gato Ñandú", new Date("2026-01-02T10:00:00"))).toBe(
      "lecta-senor-gato-nandu-2026-01-02.png",
    );
    // Un nombre sin letras útiles no deja un archivo sin nombre.
    expect(portraitFilename("!!!", new Date("2026-01-02T10:00:00"))).toBe(
      "lecta-gato-2026-01-02.png",
    );
  });

  it("el texto de compartir lleva nivel y cifras, sin emojis", () => {
    const figs = portraitFigures(
      state({ stats: { ...emptyGameState().stats, minutes: 90, saved: 12 } }),
      "Miso",
    );
    const text = portraitShareText(figs);
    expect(text).toContain("Miso y yo: Nivel 1 · Inicio");
    expect(text).toContain("1 h 30 min leídas");
    expect(text).toContain("12 palabras guardadas");
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe("tema", () => {
  it("sin documento cae al color de respaldo", () => {
    expect(themeColor("--paper", "#f6efe3")).toBe("#f6efe3");
  });
});
