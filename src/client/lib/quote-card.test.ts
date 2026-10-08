// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  FORMAT_DIMENSIONS,
  THEME_PALETTES,
  wrapCanvasText,
  copyQuoteCardToClipboard,
  downloadQuoteCard,
  shareQuoteCard,
  type QuoteCardConfig,
} from "./quote-card";

describe("quote-card", () => {
  it("contiene dimensiones correctas para historias (9:16) y cuadrado (1:1)", () => {
    expect(FORMAT_DIMENSIONS.story.width).toBe(1080);
    expect(FORMAT_DIMENSIONS.story.height).toBe(1920);
    expect(FORMAT_DIMENSIONS.square.width).toBe(1080);
    expect(FORMAT_DIMENSIONS.square.height).toBe(1080);
  });

  it("define paletas completas para cada tema", () => {
    const themes = ["papel", "blanco", "noche", "bermellon"] as const;
    for (const theme of themes) {
      const palette = THEME_PALETTES[theme];
      expect(palette).toBeDefined();
      expect(palette.bg).toMatch(/^#/);
      expect(palette.text).toMatch(/^#/);
      expect(palette.quoteMark).toMatch(/^#/);
    }
  });

  it("divide texto en líneas según ancho medido", () => {
    const mockCtx = {
      measureText: (str: string) => ({ width: str.length * 10 }),
    } as unknown as CanvasRenderingContext2D;

    const text = "En un lugar de la Mancha de cuyo nombre no quiero acordarme";
    // Si el ancho maximo es 150 px, cada palabra de ~5 letras tiene 50 px, caben ~2-3 palabras por línea
    const lines = wrapCanvasText(mockCtx, text, 150);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(text);
  });

  it("copia al portapapeles si ClipboardItem existe", async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { write: writeMock },
    });
    // Simular ClipboardItem
    (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = class {
      constructor(public data: Record<string, Blob>) {}
    };

    const blob = new Blob(["fake-image"], { type: "image/png" });
    const success = await copyQuoteCardToClipboard(blob);
    expect(success).toBe(true);
    expect(writeMock).toHaveBeenCalled();
  });

  it("shareQuoteCard llama a navigator.share si está disponible", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    const canShareMock = vi.fn().mockReturnValue(true);
    Object.assign(navigator, {
      share: shareMock,
      canShare: canShareMock,
    });

    const config: QuoteCardConfig = {
      text: "Una frase hermosa",
      bookTitle: "Azul…",
      author: "Rubén Darío",
      format: "story",
      theme: "papel",
      showAuthor: true,
      showBookTitle: true,
      showChapter: false,
      showBranding: true,
    };

    const blob = new Blob(["fake-image"], { type: "image/png" });
    const result = await shareQuoteCard(blob, config);
    expect(result).toBe("shared");
    expect(shareMock).toHaveBeenCalled();
  });

  it("downloadQuoteCard crea un enlace de descarga en el DOM", () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    URL.revokeObjectURL = vi.fn();

    const clickMock = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === "a") {
        el.click = clickMock;
      }
      return el;
    });

    const blob = new Blob(["image-content"], { type: "image/png" });
    downloadQuoteCard(blob, "mi-cita.png");
    expect(clickMock).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });
});
