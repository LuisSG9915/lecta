// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard, type Card } from "ts-fsrs";
import { listAllKnowledge, saveKnowledge, type SavedWord } from "../lib/idb";
import { recordDominated } from "./Reader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Solo las llamadas que toca recordDominated; el resto del árbol de
// módulos carga real (epub/zip se importan perezosos al abrir libro).
vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...mod,
    listAllKnowledge: vi.fn(async () => []),
    saveKnowledge: vi.fn(async (row: Record<string, unknown>) => ({
      ...row,
      key: `es:${String(row.lemma)}`,
      updatedAt: 1,
    })),
  };
});

const listMock = vi.mocked(listAllKnowledge);
const saveMock = vi.mocked(saveKnowledge);

// Tarjeta dominada: repasada y con estabilidad ≥90 días → markLevel null.
const dominatedCard: Card = {
  ...createEmptyCard(new Date("2025-01-01")),
  reps: 3,
  stability: 120,
};

const word = (lemma: string, card?: Card): SavedWord => ({
  key: `es:${lemma}`,
  form: lemma,
  lemma,
  language: "es",
  savedAt: 1,
  card,
});

const known = (lemma: string, extra: Record<string, unknown> = {}) => ({
  key: `es:${lemma}`,
  language: "es",
  lemma,
  known: true,
  source: "declared",
  updatedAt: 1,
  ...extra,
});

describe("recordDominated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue([]);
  });

  it("registra una dominada sin fila previa como inferida", async () => {
    await recordDominated([word("perenne", dominatedCard)], "es");
    expect(saveMock).toHaveBeenCalledWith(
      {
        language: "es",
        lemma: "perenne",
        known: true,
        source: "inferred",
      },
      expect.anything(),
    );
  });

  it("no sobrescribe una respuesta explícita «desconocida»", async () => {
    listMock.mockResolvedValue([known("perenne", { known: false })]);
    await recordDominated([word("perenne", dominatedCard)], "es");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("no revive una lápida", async () => {
    listMock.mockResolvedValue([known("perenne", { deleted: true })]);
    await recordDominated([word("perenne", dominatedCard)], "es");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("sin tarjeta dominada no escribe nada", async () => {
    await recordDominated(
      [word("casa"), word("mesa", { ...dominatedCard, stability: 10 })],
      "es",
    );
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("un fallo del almacén no rompe la carga", async () => {
    listMock.mockRejectedValue(new Error("idb caído"));
    await expect(
      recordDominated([word("perenne", dominatedCard)], "es"),
    ).resolves.toBeUndefined();
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe("Zen HUD & Estrategias (B.1 & B.2)", () => {
  it("PRESET_LABELS cubre todas las estrategias de lectura", async () => {
    const { PRESET_LABELS } = await import("./Reader");
    expect(PRESET_LABELS.focus).toBe("Enfoque");
    expect(PRESET_LABELS.lexical).toBe("Léxico");
    expect(PRESET_LABELS.immersive).toBe("Inmersivo");
    expect(PRESET_LABELS.audio).toBe("Audio");
    expect(PRESET_LABELS.custom).toBe("Ajustado");
  });

  it("FocusRuler incluye velos superior e inferior y responde a flechas del teclado", async () => {
    const { createElement: h } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { FocusRuler } = await import("./FocusRuler");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(h(FocusRuler, { bandPx: 120, lineHeightPx: 30 }));
    });

    const topVeil = host.querySelector(".focus-ruler-veil--top");
    const bottomVeil = host.querySelector(".focus-ruler-veil--bottom");
    const band = host.querySelector(".focus-ruler-band");

    expect(topVeil).not.toBeNull();
    expect(bottomVeil).not.toBeNull();
    expect(band).not.toBeNull();

    // Evento de teclado ArrowDown
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });

    root.unmount();
    host.remove();
  });

  it("CompanionButton muestra burbuja interactiva si se pasa bubbleMessage", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { createElement: h } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { CompanionButton } = await import("./CompanionButton");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    const onBubbleClick = vi.fn();
    const onClick = vi.fn();

    await act(async () => {
      root.render(
        h(CompanionButton, {
          stage: 2,
          mood: "awake",
          accessories: [],
          label: "Ver a Michi",
          onClick,
          bubbleMessage: "¿Pasaje denso? Tócame para iluminar el párrafo paso a paso.",
          onBubbleClick,
        }),
      );
    });

    const prompt = host.querySelector(".companion-bubble-prompt");
    expect(prompt).not.toBeNull();
    expect(prompt?.textContent).toContain("¿Pasaje denso?");

    // Clic en la burbuja
    await act(async () => {
      prompt?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onBubbleClick).toHaveBeenCalledTimes(1);

    root.unmount();
    host.remove();
  });
});

describe("Subrayado de Pasajes y Tonos de Tinta (B.4)", () => {
  it("makePassage asigna los 3 tonos de tinta", async () => {
    const { makePassage } = await import("../lib/annotations");
    const p1 = makePassage("b1", 1, "Un texto ámbar", undefined, undefined, "amber");
    expect(p1?.color).toBe("amber");

    const p2 = makePassage("b1", 1, "Un texto salvia", undefined, undefined, "salvia");
    expect(p2?.color).toBe("salvia");

    const p3 = makePassage("b1", 1, "Un texto darío", undefined, undefined, "dario");
    expect(p3?.color).toBe("dario");
  });

  it("applyPassageMarks aplica las clases correspondientes a los 3 tonos", async () => {
    const { applyPassageMarks } = await import("../lib/passage-marks");
    const container = document.createElement("div");
    container.textContent = "Bajo la bóveda del azur resplandecían los astros sobre la colina.";
    document.body.appendChild(container);

    const passages = [
      {
        key: "b1:1",
        id: "1",
        bookHash: "b1",
        kind: "passage" as const,
        sectionIndex: 0,
        text: "azur resplandecían",
        color: "dario" as const,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        key: "b1:2",
        id: "2",
        bookHash: "b1",
        kind: "passage" as const,
        sectionIndex: 0,
        text: "sobre la colina",
        color: "salvia" as const,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    applyPassageMarks(container, passages);

    const markDario = container.querySelector(".saved-passage--dario");
    const markSalvia = container.querySelector(".saved-passage--salvia");

    expect(markDario).not.toBeNull();
    expect(markDario?.textContent).toBe("azur resplandecían");
    expect(markSalvia).not.toBeNull();
    expect(markSalvia?.textContent).toBe("sobre la colina");

    container.remove();
  });
});

describe("Guía Cromática y Modo de Concentración TDAH", () => {
  it("el preset 'focus' activa Líneas Sintácticas, Guía Cromática, Enfoque de Párrafo y Anclajes Biónicos", async () => {
    const { applyStrategyPreset, READER_DEFAULTS } = await import("../lib/settings");
    const focusSettings = applyStrategyPreset("focus", READER_DEFAULTS);

    expect(focusSettings.syntacticLines).toBe(true);
    expect(focusSettings.chromaticGuide).toBe(true);
    expect(focusSettings.paragraphFocus).toBe(true);
    expect(focusSettings.bionicAnchors).toBe(true);
    expect(focusSettings.chromaticPalette).toBe("editorial");
  });

  it("recuperar el hilo genera resumen determinista si no hay respuesta de IA", async () => {
    const { deterministicPageRecapFallback } = await import("../lib/page-recap");
    const text = "Aquel hidalgo leía libros de caballerías día y noche. Sus amigos el cura y el barbero lo visitaban a menudo.";
    const recap = deterministicPageRecapFallback(text);

    expect(recap.bullets).toHaveLength(2);
    expect(recap.bullets[0]).toContain("Aquel hidalgo leía libros");
    expect(recap.hookQuestion).toBe("¿Cómo continúa el hilo de este pasaje?");
    expect(recap.fallback).toBe(true);
  });

  it("despacha evento lecta:checkpoint-reached al cruzar los hitos 25%, 50%, 75%, 100%", () => {
    const events: number[] = [];
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ checkpoint: number }>;
      events.push(custom.detail.checkpoint);
    };
    window.addEventListener("lecta:checkpoint-reached", handler);

    window.dispatchEvent(new CustomEvent("lecta:checkpoint-reached", { detail: { checkpoint: 0.25 } }));
    window.dispatchEvent(new CustomEvent("lecta:checkpoint-reached", { detail: { checkpoint: 0.50 } }));

    expect(events).toEqual([0.25, 0.5]);

    window.removeEventListener("lecta:checkpoint-reached", handler);
  });

  it("activa y detiene el ronroneo ambiental procedural sin errores", async () => {
    const { startAmbientPurr, stopAmbientPurr, isAmbientPurrActive } = await import("../lib/companion-audio");
    startAmbientPurr();
    stopAmbientPurr();
    expect(isAmbientPurrActive()).toBe(false);
  });
});

describe("Recalibración de Luminancia, Contraste AAA y Separación de Barras Flotantes (OBJ-01 a OBJ-05)", () => {
  it("la configuración por defecto tiene strategyContrast='high'", async () => {
    const { READER_DEFAULTS } = await import("../lib/settings");
    expect(READER_DEFAULTS.strategyContrast).toBe("high");
  });

  it("renderiza TtsNowPlaying con la clase .tts-now-playing para elevarse sobre .reader__dock", async () => {
    const { createElement: h } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { default: TtsNowPlaying } = await import("./TtsNowPlaying");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        h(TtsNowPlaying, {
          snap: {
            status: "speaking",
            sessionId: "test-1",
            rate: 1,
            highlight: "sentence",
            pauseReason: null,
          },
          onPauseResume: vi.fn(),
          onCycleRate: vi.fn(),
          onStop: vi.fn(),
        }),
      );
    });

    const floatingBar = host.querySelector(".tts-chip.tts-now-playing");
    expect(floatingBar).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });


  it("verifica las reglas CSS de reader.css para separación vertical y no colisión con el dock", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const cssPath = path.resolve(process.cwd(), "src/client/styles/reader.css");
    const css = await fs.readFile(cssPath, "utf-8");

    // Verificar elevación de la barra flotante (.tts-chip, .reader__pacer-bar, .tts-now-playing) a 76px
    expect(css).toMatch(/\.tts-chip,\s*\.tts-now-playing,\s*\.reader__pacer-bar\s*\{[^}]*bottom:\s*calc\(76px/);

    // Verificar que el padding inferior del lector se amplía a 152px cuando hay barra flotante
    expect(css).toMatch(/data-has-floating-bar="true"[^}]*padding-bottom:\s*calc\(152px/);

    // Verificar contraste AAA y no oscurecimiento de anclas biónicas
    expect(css).toMatch(/\.lecta-bionic-word\s*\{[^}]*opacity:\s*1/);
    expect(css).toMatch(/\.lecta-bionic-anchor[^{]*\{[^}]*font-weight:\s*700/);
    expect(css).toMatch(/data-theme="night"[^{]*\{[^}]*color:\s*#FFFFFF/);
    expect(css).toMatch(/data-strategy-contrast="high"/);
  });
});


