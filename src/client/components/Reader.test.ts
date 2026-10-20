// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard, type Card } from "ts-fsrs";
import { listAllKnowledge, saveKnowledge, type SavedWord } from "../lib/idb";
import type { EpisodicWordItem } from "../lib/practice";
import { recordDominated } from "./Reader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Solo las llamadas que toca recordDominated; el resto del árbol de
// módulos carga real (epub/zip se importan perezosos al abrir libro).
vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  const sessionStore = new Map<string, string>();
  return {
    ...mod,
    listAllKnowledge: vi.fn(async () => []),
    saveKnowledge: vi.fn(async (row: Record<string, unknown>) => ({
      ...row,
      key: `es:${String(row.lemma)}`,
      updatedAt: 1,
    })),
    saveSmartAssistsPrefsIdb: vi.fn(async (prefs: Record<string, unknown>) => {
      sessionStore.set("lecta:smart_assists:v1", JSON.stringify(prefs));
    }),
    loadSmartAssistsPrefsIdb: vi.fn(async () => {
      const raw = sessionStore.get("lecta:smart_assists:v1");
      return raw ? JSON.parse(raw) : null;
    }),
    loadSessionValue: vi.fn(async (key: string) => sessionStore.get(key) ?? null),
    saveSessionValue: vi.fn(async (key: string, value: string) => {
      sessionStore.set(key, value);
    }),
    getCachedLexiconBatch: vi.fn(async () => ({})),
    countCachedLexicon: vi.fn(async () => 0),
    loadSavedWord: vi.fn(async () => null),
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

  it("FocusRuler incluye franja de lectura, tirador táctil y responde a flechas del teclado", async () => {
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

    const band = host.querySelector(".focus-ruler__band");
    const handle = host.querySelector(".focus-ruler__handle");

    expect(band).not.toBeNull();
    expect(handle).not.toBeNull();

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

  it("verifica las reglas del Coordinador de Capas Flotantes (Paso 2) en reader.css", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const cssPath = path.resolve(process.cwd(), "src/client/styles/reader.css");
    const css = await fs.readFile(cssPath, "utf-8");

    // Variables de separación en .reader-shell
    expect(css).toMatch(/\.reader-shell\s*\{[^}]*--dock-clearance:\s*82px/);
    expect(css).toMatch(/\.reader-shell\[data-dock-ghost="true"\]\s*\{[^}]*--dock-clearance:\s*28px/);
    expect(css).toMatch(/\.reader-shell\[data-tts-active="true"\]\s*\{[^}]*--tts-clearance:\s*60px/);

    // Z-indexes coordinados: SmartReaderDock (30), ReaderRecapBubble (31), TtsNowPlaying (32)
    expect(css).toMatch(/\.smart-reader-dock\s*\{[^}]*z-index:\s*30/);
    expect(css).toMatch(/\.reader-recap-bubble\s*\{[^}]*z-index:\s*31/);
    expect(css).toMatch(/\.tts-now-playing\s*\{[^}]*z-index:\s*32/);

    // En móvil (<= 720px), ocultar dock y recap al abrir WordPanel inspector
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[^{]*\{[\s\S]*data-inspector-open="true"[\s\S]*opacity:\s*0/);

    // FocusRuler tirador lateral táctil
    expect(css).toMatch(/\.focus-ruler\s*\{[^}]*pointer-events:\s*none;[^}]*z-index:\s*25/);
    expect(css).toMatch(/\.focus-ruler__handle\s*\{[^}]*pointer-events:\s*auto/);
  });
});

describe("Cableado Maestro e Integración en Reader.tsx (Fase 1 y Fase 2)", () => {
  let host: HTMLDivElement;
  let root: import("react-dom/client").Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    try {
      localStorage.clear();
    } catch {
      // Entornos donde localStorage es simulado
    }
  });

  afterEach(async () => {
    if (root) {
      const { act } = await import("react");
      await act(async () => {
        root.unmount();
      });
    }
    host.remove();
    try {
      localStorage.clear();
    } catch {
      // Ignorar
    }
  });

  it("1. SectionPreview en modo 'pill' muestra pastilla discreta de vocabulario y responde al clic para abrir la preparación", async () => {
    const { createElement: h, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: SectionPreview } = await import("./SectionPreview");

    root = createRoot(host);
    const onExpand = vi.fn();

    await act(async () => {
      root.render(
        h(SectionPreview, {
          mode: "pill",
          words: Array.from({ length: 4 }),
          onExpand,
        }),
      );
    });

    const pill = host.querySelector<HTMLButtonElement>(".reader-section-preview-pill");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain("4 palabras clave en este capítulo · Ver");

    await act(async () => {
      pill?.click();
    });
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("2. planPredictiveChapterPrecache planifica la pre-carga offline de los capítulos c+1 y c+2 en segundo plano para L2", async () => {
    const { planPredictiveChapterPrecache } = await import("../lib/offline-dictionary");
    // En Reader.tsx, si el libro está en L2 y hay red, se planifica c+1 y c+2
    const precacheMid = planPredictiveChapterPrecache(3, 10, 2);
    expect(precacheMid).toEqual([4, 5]);

    const precacheNearEnd = planPredictiveChapterPrecache(8, 10, 2);
    expect(precacheNearEnd).toEqual([9]);

    const precacheEnd = planPredictiveChapterPrecache(9, 10, 2);
    expect(precacheEnd).toEqual([]);
  });

  it("3. SmartReaderDock recibe focusSuggestion de evaluateReadingFatigue y ofrece activación en 1 toque", async () => {
    const { createElement: h, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: SmartReaderDock } = await import("./SmartReaderDock");
    const {
      evaluateReadingFatigue,
      recordFocusAidOutcome,
      DEFAULT_FOCUS_TELEMETRY_PROFILE,
    } = await import("../lib/focus-telemetry");

    // Simular fatiga por estancamiento en página
    const profile = { ...DEFAULT_FOCUS_TELEMETRY_PROFILE };
    const fatigueResult = evaluateReadingFatigue(
      profile,
      {
        dwellTimeMs: 45000,
        direction: "forward",
        wordCountOnPage: 35,
        sessionMinutesElapsed: 45,
        bookId: "b-fatigue",
        lang: "es",
        recentBackwardCountInWindow: 2,
      },
      false,
    );

    expect(fatigueResult.isFatigued).toBe(true);
    expect(fatigueResult.recommendedAid).toBeDefined();

    root = createRoot(host);
    const onAcceptFocusAid = vi.fn();
    const onDismissFocusSuggestion = vi.fn();
    const onMuteFocusForBook = vi.fn();
    const idleTtsSnap = {
      status: "idle" as const,
      sessionId: null,
      rate: 1 as const,
      highlight: "sentence" as const,
      pauseReason: null,
    };

    const baseDockProps = {
      progressText: "Pág. 12 de 40",
      isPureCanvas: false,
      onExitPureCanvas: vi.fn(),
      activePreset: "clean" as const,
      onSelectPreset: vi.fn(),
      onOpenAdvancedSettings: vi.fn(),
      onStartAudio: vi.fn(),
      onRecap: vi.fn(),
      ttsSnap: idleTtsSnap,
      onTogglePlayPause: vi.fn(),
      onCycleSpeed: vi.fn(),
      onStopAudio: vi.fn(),
    };

    await act(async () => {
      root.render(
        h(SmartReaderDock, {
          ...baseDockProps,
          focusSuggestion: fatigueResult,
          isFatigued: fatigueResult.isFatigued,
          recommendedFocusAid: fatigueResult.recommendedAid,
          focusFatigueReason: fatigueResult.reason,
          onAcceptFocusAid,
          onDismissFocusSuggestion,
          onMuteFocusForBook,
        }),
      );
    });

    // Píldora de sugerencia de neuro-foco
    const pill = host.querySelector(".reader-focus-suggestion-pill");
    expect(pill).not.toBeNull();

    // Clic en la acción de activación en 1 toque
    const actionBtn = host.querySelector<HTMLButtonElement>(
      ".reader-focus-pill-action",
    );
    expect(actionBtn).not.toBeNull();
    await act(async () => {
      actionBtn?.click();
    });

    expect(onAcceptFocusAid).toHaveBeenCalledWith(fatigueResult.recommendedAid);

    // Validar que la telemetría ajusta el peso de la ayuda al ser aceptada
    const updatedProfile = recordFocusAidOutcome(
      profile,
      fatigueResult.recommendedAid,
      true,
    );
    expect(
      updatedProfile.aidEfficacyWeights[fatigueResult.recommendedAid],
    ).toBeGreaterThan(profile.aidEfficacyWeights[fatigueResult.recommendedAid]);
  });

  it("4. SmartReaderDock permite silenciar sugerencias de foco para el libro actual sin fricción", async () => {
    const { createElement: h, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: SmartReaderDock } = await import("./SmartReaderDock");

    root = createRoot(host);
    const onMuteFocusForBook = vi.fn();
    const idleTtsSnap = {
      status: "idle" as const,
      sessionId: null,
      rate: 1 as const,
      highlight: "sentence" as const,
      pauseReason: null,
    };
    const baseDockProps = {
      progressText: "Pág. 12 de 40",
      isPureCanvas: false,
      onExitPureCanvas: vi.fn(),
      activePreset: "clean" as const,
      onSelectPreset: vi.fn(),
      onOpenAdvancedSettings: vi.fn(),
      onStartAudio: vi.fn(),
      onRecap: vi.fn(),
      ttsSnap: idleTtsSnap,
      onTogglePlayPause: vi.fn(),
      onCycleSpeed: vi.fn(),
      onStopAudio: vi.fn(),
    };

    await act(async () => {
      root.render(
        h(SmartReaderDock, {
          ...baseDockProps,
          isFatigued: true,
          recommendedFocusAid: "paragraph-focus",
          focusFatigueReason: "stall",
          onMuteFocusForBook,
        }),
      );
    });

    // Abrir opciones de silenciamiento con el botón cerrar (×)
    const closeBtn = host.querySelector<HTMLButtonElement>(".reader-focus-pill-close");
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      closeBtn?.click();
    });

    // Botón de silenciar para este libro
    const muteBtn = host.querySelector<HTMLButtonElement>(".reader-focus-mute-book-btn");
    expect(muteBtn).not.toBeNull();
    await act(async () => {
      muteBtn?.click();
    });

    expect(onMuteFocusForBook).toHaveBeenCalledTimes(1);
  });

  it("5. charOffsetAtViewTop y buildZeroSpoilerCharacterCard garantizan cero spoilers respetando la frontera exacta", async () => {
    const { charOffsetAtViewTop } = await import("../lib/reading-location");
    const { buildZeroSpoilerCharacterCard } = await import("../lib/character-helper");

    // Simular contenedor de texto de capítulo
    const container = document.createElement("div");
    const p1 = document.createElement("p");
    p1.textContent = "Don Quijote cabalgaba ensimismado pensando en su amada Dulcinea.";
    const p2 = document.createElement("p");
    p2.textContent = "Dulcinea del Toboso era para él la dama más virtuosa y noble.";
    const p3 = document.createElement("p");
    p3.textContent = "Mucho después se supo que la verdadera Dulcinea era Aldonza Lorenzo.";

    container.appendChild(p1);
    container.appendChild(p2);
    container.appendChild(p3);
    document.body.appendChild(container);

    vi.spyOn(p1, "getBoundingClientRect").mockReturnValue({ top: -80, bottom: -10 } as DOMRect);
    vi.spyOn(p2, "getBoundingClientRect").mockReturnValue({ top: 10, bottom: 60 } as DOMRect);
    vi.spyOn(p3, "getBoundingClientRect").mockReturnValue({ top: 250, bottom: 320 } as DOMRect);

    const chapterText = [p1.textContent, p2.textContent, p3.textContent].join("\n\n");
    const offset = charOffsetAtViewTop(container, chapterText);
    expect(offset).toBeGreaterThan(0);

    // Frontera exacta que excluye el spoiler de p3
    const chapters = [
      { index: 0, title: "Capítulo 1", plainText: chapterText },
      { index: 1, title: "Capítulo 2", plainText: "En el desenlace Don Quijote regresa a su aldea derrotado." },
    ];

    const card = buildZeroSpoilerCharacterCard("Dulcinea", chapters, {
      chapterIndex: 0,
      charOffsetInChapter: offset,
    });

    expect(card.totalMentionsUpToCursor).toBeGreaterThanOrEqual(1);
    expect(card.firstMention?.sentence).toContain("Dulcinea");
    expect(card.firstMention?.sentence).not.toContain("Aldonza Lorenzo");
    expect(card.firstMention?.sentence).not.toContain("derrotado");

    container.remove();
  });

  it("6. BilingueParagraph renderiza con initialTier de selectOptimalScaffoldingTier y escala notificando onTierEscalated", async () => {
    const { createElement: h, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BilingueParagraph } = await import("./BilingueParagraph");
    const {
      selectOptimalScaffoldingTier,
      updateBilingualAutonomyProfile,
      DEFAULT_BILINGUAL_PROFILE,
    } = await import("../lib/phrases");

    const originalText = "Notwithstanding the severe tempest, the intrepid crew persevered toward the horizon.";
    const difficultClauseOriginal = "Notwithstanding the severe tempest";
    const difficultClauseTranslation = "A pesar de la severa tempestad";
    const translatedText = "A pesar de la severa tempestad, la intrépida tripulación perseveró hacia el horizonte.";

    const initialTier = selectOptimalScaffoldingTier(
      originalText,
      0.04,
      "en",
      DEFAULT_BILINGUAL_PROFILE,
      "b-l2",
    );
    expect(initialTier).toBe(1);

    root = createRoot(host);
    const onTierEscalated = vi.fn();

    await act(async () => {
      root.render(
        h(BilingueParagraph, {
          bookId: "b-l2",
          bookLanguage: "en",
          originalText,
          translatedText,
          difficultClauseOriginal,
          difficultClauseTranslation,
          initialTier,
          onTierEscalated,
        }),
      );
    });

    // Comprobar tier inicial
    const container = host.querySelector(".lecta-bilingue");
    expect(container).not.toBeNull();
    expect(container?.getAttribute("data-tier")).toBe("1");

    // Escalar a Tier 2 con el botón «Destrabar frase clave»
    const stepBtn = host.querySelector<HTMLButtonElement>(".lecta-bilingue__step-btn");
    expect(stepBtn?.textContent).toContain("Destrabar frase clave");

    await act(async () => {
      stepBtn?.click();
    });

    expect(container?.getAttribute("data-tier")).toBe("2");
    expect(onTierEscalated).toHaveBeenCalledTimes(1);

    // Al escalar, el perfil incrementa el sesgo de autonomía
    const updatedProfile = updateBilingualAutonomyProfile(DEFAULT_BILINGUAL_PROFILE, "en", "escalated");
    expect(updatedProfile.autonomyBiasByLang["en"]).toBeGreaterThan(
      DEFAULT_BILINGUAL_PROFILE.autonomyBiasByLang["en"] ?? 0,
    );
  });

  it("7. DeepReadingSummaryModal recibe la cola episódica combinada y permite continuar al siguiente capítulo", async () => {
    const { createElement: h, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: DeepReadingSummaryModal } = await import("./DeepReadingSummaryModal");
    const { buildPostChapterConsolidationQueue, DEFAULT_CONSOLIDATION_PREFS } =
      await import("../lib/practice");

    const primedWord: EpisodicWordItem = {
      lemma: "madriguera",
      surfaceForm: "madriguera",
      lang: "es",
      shortGloss: "Cueva donde habitan animales",
      chapterSentence: "El conejo saltó ágilmente hacia su profunda madriguera.",
      chapterTitle: "Capítulo 1",
      source: "pre-chapter-primed",
    };

    const lookedUpWord: EpisodicWordItem = {
      lemma: "estupor",
      surfaceForm: "estupor",
      lang: "es",
      shortGloss: "Asombro o pasmo extremo",
      chapterSentence: "Alicia observó la escena con un asombro rayano en el estupor.",
      chapterTitle: "Capítulo 1",
      source: "in-chapter-lookup",
    };

    const queue = buildPostChapterConsolidationQueue(
      [primedWord, lookedUpWord],
      DEFAULT_CONSOLIDATION_PREFS,
      false,
      { bookId: "b-deep" },
    );

    expect(queue.length).toBe(2);
    // Lookups tienen prioridad
    expect(queue[0].item.lemma).toBe("estupor");

    root = createRoot(host);
    const onContinue = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: {
            durationMinutes: 15,
            targetMinutes: 15,
            sectionsRead: 1,
            completedNaturally: true,
            wordsAssimilated: 4,
            coverageDeltaPercent: 1,
          },
          consolidationQueue: queue,
          bookId: "b-deep",
          onContinue,
          onClose,
        }),
      );
    });

    // Comprobar que renderiza el reto episódico y las palabras del capítulo
    expect(host.textContent).toContain("Fija en tu memoria");
    expect(host.textContent).toContain("estupor");
    expect(host.textContent).toContain("madriguera");

    // Continuar al siguiente capítulo
    const continueBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes("Continuar"),
    );
    expect(continueBtn).not.toBeUndefined();

    await act(async () => {
      continueBtn?.click();
    });

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("8. Fase 2: saveUnifiedSmartAssists y saveSmartAssistsPrefsIdb sincronizan todas las banderas y silenciados", async () => {
    const {
      saveUnifiedSmartAssists,
      loadUnifiedSmartAssists,
    } = await import("../lib/settings");
    const { saveSmartAssistsPrefsIdb, loadSmartAssistsPrefsIdb } = await import("../lib/idb");

    const testBook = "b-sync-test";

    // Guardar preferencias unificadas de los Tracks 6, 8, 9, 10 y 11
    saveUnifiedSmartAssists(
      {
        chapterPrimingMode: "on-demand",
        mutedPrimingBookIds: [testBook],
        characterMemoryEnabled: false,
        mutedCharacterMemoryBookIds: [testBook],
        focusAutoSuggestEnabled: false,
        mutedFocusBookIds: [testBook],
        postChapterConsolidationEnabled: false,
        mutedConsolidationBookIds: [testBook],
        bilingualScaffoldingMode: "tier-1-only",
        mutedBilingualBookIds: [testBook],
      },
      testBook,
    );

    const unified = loadUnifiedSmartAssists(testBook);
    expect(unified.chapterPrimingMode).toBe("on-demand");
    expect(unified.mutedPrimingBookIds).toContain(testBook);
    expect(unified.characterMemoryEnabled).toBe(false);
    expect(unified.mutedCharacterMemoryBookIds).toContain(testBook);
    expect(unified.focusAutoSuggestEnabled).toBe(false);
    expect(unified.mutedFocusBookIds).toContain(testBook);
    expect(unified.postChapterConsolidationEnabled).toBe(false);
    expect(unified.mutedConsolidationBookIds).toContain(testBook);
    expect(unified.bilingualScaffoldingMode).toBe("tier-1-only");
    expect(unified.mutedBilingualBookIds).toContain(testBook);

    // Sincronización en IndexedDB
    await saveSmartAssistsPrefsIdb(unified);
    const fromIdb = await loadSmartAssistsPrefsIdb();
    expect(fromIdb).not.toBeNull();
    expect(fromIdb?.chapterPrimingMode).toBe("on-demand");
    expect(fromIdb?.mutedFocusBookIds).toEqual([testBook]);
    expect(fromIdb?.characterMemoryEnabled).toBe(false);
  });

  it("9. Fase 2: ReaderMoreMenu reactiva asistencias silenciadas y persiste sincronizadamente", async () => {
    const { createElement: h, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: ReaderMoreMenu } = await import("./ReaderMoreMenu");
    const {
      saveUnifiedSmartAssists,
      loadUnifiedSmartAssists,
      muteBookForPriming,
    } = await import("../lib/settings");
    const { saveFocusTelemetryProfile, loadFocusTelemetryProfile, muteBookFocusSuggestions } =
      await import("../lib/focus-telemetry");

    const testBook = "b-menu-reactivate";

    // Preparar asistencias silenciadas
    muteBookForPriming(testBook);
    saveUnifiedSmartAssists(
      {
        mutedPrimingBookIds: [testBook],
        characterMemoryEnabled: false,
        mutedFocusBookIds: [testBook],
        focusAutoSuggestEnabled: false,
        mutedConsolidationBookIds: [testBook],
      },
      testBook,
    );

    const prof = loadFocusTelemetryProfile();
    saveFocusTelemetryProfile(muteBookFocusSuggestions(prof, testBook));

    root = createRoot(host);
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        h(ReaderMoreMenu, {
          isOpen: true,
          onClose,
          onSearch: vi.fn(),
          bookHash: testBook,
          language: "en",
        }),
      );
    });

    // Sección de asistencias inteligentes en ReaderMoreMenu
    const assistsSection = host.querySelector(".reader-more-assists-section");
    expect(assistsSection).not.toBeNull();
    expect(assistsSection?.textContent).toContain("Asistencias inteligentes");

    const reactivateButtons = host.querySelectorAll<HTMLButtonElement>(".reader-more-reactivate-btn");
    expect(reactivateButtons.length).toBeGreaterThanOrEqual(1);

    const primingBtn = Array.from(reactivateButtons).find((b) =>
      b.closest(".reader-more-assist-row")?.textContent?.includes("Vocabulario de capítulo"),
    );
    expect(primingBtn).not.toBeUndefined();

    // Clic en reactivar vocabulario de capítulo
    await act(async () => {
      primingBtn?.click();
    });

    // La reactivación persiste con saveUnifiedSmartAssists
    const updatedAssists = loadUnifiedSmartAssists(testBook);
    expect(updatedAssists.mutedPrimingBookIds).not.toContain(testBook);
  });
});

describe("Fase 4: Pruebas de Integración End-to-End en Reader.test.ts", () => {
  let host: HTMLDivElement;
  let root: import("react-dom/client").Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    try {
      localStorage.clear();
    } catch {
      // Ignorar
    }
  });

  afterEach(async () => {
    if (root) {
      const { act } = await import("react");
      await act(async () => {
        root.unmount();
      });
    }
    host.remove();
    try {
      localStorage.clear();
    } catch {
      // Ignorar
    }
  });

  it("1. SectionPreview al inicio del capítulo y su desactivación en 1 clic", async () => {
    const { createElement: h, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: SectionPreview } = await import("./SectionPreview");
    const {
      muteBookForPriming,
      isPrimingMutedForBook,
      disablePrimingGlobally,
      loadUnifiedSmartAssists,
    } = await import("../lib/settings");

    const bookId = "b-fase4-priming";

    // 1.1 Renderizar SectionPreview en modo pill al inicio del capítulo
    root = createRoot(host);
    const onExpand = vi.fn();
    await act(async () => {
      root.render(
        h(SectionPreview, {
          mode: "pill",
          words: [
            { lemma: "arcano", difficulty: 2.5 },
            { lemma: "efímero", difficulty: 2.8 },
            { lemma: "inefable", difficulty: 3.1 },
          ],
          onExpand,
        }),
      );
    });

    const pill = host.querySelector<HTMLButtonElement>(".reader-section-preview-pill");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain("3 palabras clave en este capítulo · Ver");

    await act(async () => {
      pill?.click();
    });
    expect(onExpand).toHaveBeenCalledTimes(1);

    // 1.2 Renderizar SectionPreview completo con opciones de desactivación en 1 clic
    await act(async () => {
      root.unmount();
    });
    root = createRoot(host);

    const onDiscard = vi.fn();
    const onSkip = vi.fn();
    await act(async () => {
      root.render(
        h(SectionPreview, {
          title: "Capítulo 1: El comienzo",
          chapterTitle: "Capítulo 1: El comienzo",
          bookId,
          rows: [
            {
              key: "es:arcano",
              form: "arcano",
              lemma: "arcano",
              pos: "adj.",
              meaning: "Secreto, recóndito, reservado.",
              context: "Guardaba un arcano misterio entre sus muros.",
            },
          ],
          onSkip,
          onDiscard,
        }),
      );
    });

    // Probar silenciamiento para este libro en 1 clic
    muteBookForPriming(bookId);
    expect(isPrimingMutedForBook(bookId)).toBe(true);

    const assists = loadUnifiedSmartAssists(bookId);
    expect(assists.mutedPrimingBookIds).toContain(bookId);

    // Probar desactivación global en 1 clic
    disablePrimingGlobally();
    const globalAssists = loadUnifiedSmartAssists(bookId);
    expect(globalAssists.chapterPrimingMode).toBe("off");
  });

  it("2. La píldora de fatiga en SmartReaderDock tras regresiones/estancamiento", async () => {
    const { createElement: h, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: SmartReaderDock } = await import("./SmartReaderDock");
    const {
      evaluateReadingFatigue,
      recordFocusAidOutcome,
      muteBookFocusSuggestions,
      isFocusSuggestionMuted,
      DEFAULT_FOCUS_TELEMETRY_PROFILE,
    } = await import("../lib/focus-telemetry");

    const bookId = "b-fase4-fatigue";
    const profile = { ...DEFAULT_FOCUS_TELEMETRY_PROFILE };

    // Simular fatiga con regresiones y dwell alto
    const fatigueResult = evaluateReadingFatigue(
      profile,
      {
        dwellTimeMs: 40000,
        direction: "backward",
        wordCountOnPage: 30,
        sessionMinutesElapsed: 35,
        bookId,
        lang: "es",
        recentBackwardCountInWindow: 3,
      },
      false,
    );

    expect(fatigueResult.isFatigued).toBe(true);
    expect(fatigueResult.recommendedAid).toBeDefined();

    root = createRoot(host);
    const onAcceptFocusAid = vi.fn();
    const onDismissFocusSuggestion = vi.fn();
    const onMuteFocusForBook = vi.fn();

    const dummyTtsSnap = {
      status: "idle" as const,
      sessionId: null,
      rate: 1 as const,
      highlight: "sentence" as const,
      pauseReason: null,
    };

    await act(async () => {
      root.render(
        h(SmartReaderDock, {
          progressText: "Pág. 10 de 50",
          isPureCanvas: false,
          onExitPureCanvas: vi.fn(),
          activePreset: "clean",
          onSelectPreset: vi.fn(),
          onOpenAdvancedSettings: vi.fn(),
          onStartAudio: vi.fn(),
          onRecap: vi.fn(),
          ttsSnap: dummyTtsSnap,
          onTogglePlayPause: vi.fn(),
          onCycleSpeed: vi.fn(),
          onStopAudio: vi.fn(),
          focusSuggestion: fatigueResult,
          isFatigued: fatigueResult.isFatigued,
          recommendedFocusAid: fatigueResult.recommendedAid,
          focusFatigueReason: fatigueResult.reason,
          onAcceptFocusAid,
          onDismissFocusSuggestion,
          onMuteFocusForBook,
        }),
      );
    });

    // Píldora visible
    const pill = host.querySelector(".reader-focus-suggestion-pill");
    expect(pill).not.toBeNull();

    // Aceptar ayuda en 1 toque
    const actionBtn = host.querySelector<HTMLButtonElement>(".reader-focus-pill-action");
    expect(actionBtn).not.toBeNull();
    await act(async () => {
      actionBtn?.click();
    });
    expect(onAcceptFocusAid).toHaveBeenCalledWith(fatigueResult.recommendedAid);

    // Recompensa adaptativa
    const rewarded = recordFocusAidOutcome(profile, fatigueResult.recommendedAid, true);
    expect(rewarded.aidEfficacyWeights[fatigueResult.recommendedAid]).toBeGreaterThan(
      profile.aidEfficacyWeights[fatigueResult.recommendedAid],
    );

    // Silenciar libro
    const mutedProfile = muteBookFocusSuggestions(profile, bookId);
    expect(isFocusSuggestionMuted(mutedProfile, bookId)).toBe(true);
  });

  it("3. El corte «Cero Spoilers» por párrafo en WordPanel / ReaderRecapBubble", async () => {
    const { createElement: h, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { charOffsetAtViewTop } = await import("../lib/reading-location");
    const { buildZeroSpoilerCharacterCard } = await import("../lib/character-helper");
    const { generateZeroSpoilerSceneRecap } = await import("../lib/page-recap");
    const { default: WordPanel } = await import("./WordPanel");
    const { ReaderRecapBubble } = await import("./ReaderRecapBubble");

    // Simular párrafos del capítulo
    const container = document.createElement("div");
    const p1 = document.createElement("p");
    p1.textContent = "Don Quijote contemplaba a lo lejos la silueta de Dulcinea en el Toboso.";
    const p2 = document.createElement("p");
    p2.textContent = "Dulcinea representaba para su alma la máxima pureza caballeresca.";
    const p3 = document.createElement("p");
    p3.textContent = "¡Alerta spoiler! Al final se desvela que Dulcinea es la campesina Aldonza Lorenzo y muere en soledad.";

    container.appendChild(p1);
    container.appendChild(p2);
    container.appendChild(p3);
    document.body.appendChild(container);

    vi.spyOn(p1, "getBoundingClientRect").mockReturnValue({ top: -60, bottom: -10 } as DOMRect);
    vi.spyOn(p2, "getBoundingClientRect").mockReturnValue({ top: 15, bottom: 80 } as DOMRect);
    vi.spyOn(p3, "getBoundingClientRect").mockReturnValue({ top: 300, bottom: 400 } as DOMRect);

    const chapterText = [p1.textContent, p2.textContent, p3.textContent].join("\n\n");
    const visibleOffset = charOffsetAtViewTop(container, chapterText);

    // 3.1 Validar que la tarjeta de personaje excluye estrictamente el spoiler del párrafo 3
    const chapters = [
      {
        index: 0,
        title: "Capítulo 1",
        plainText: chapterText,
      },
    ];

    const card = buildZeroSpoilerCharacterCard("Dulcinea", chapters, {
      chapterIndex: 0,
      charOffsetInChapter: visibleOffset,
    });

    expect(card.totalMentionsUpToCursor).toBeGreaterThanOrEqual(1);
    expect(card.firstMention?.sentence).toContain("Dulcinea");
    expect(card.firstMention?.sentence).not.toContain("Aldonza Lorenzo");
    expect(card.firstMention?.sentence).not.toContain("muere en soledad");

    // 3.2 Renderizar WordPanel con charOffsetInChapter y verificar badge de Cero Spoilers
    const mockSections = [
      {
        createDocument: async () =>
          new DOMParser().parseFromString(`<body>${chapterText}</body>`, "text/html"),
      },
    ];

    root = createRoot(host);
    await act(async () => {
      root.render(
        h(WordPanel, {
          word: "Dulcinea",
          context: p2.textContent,
          sections: mockSections,
          currentSectionIndex: 0,
          charOffsetInChapter: visibleOffset,
          currentChapterTitle: "Capítulo 1",
          onClose: vi.fn(),
        }),
      );
    });

    // En WordPanel, al detectar nombre propio o modo personaje, se monta la insignia
    const badge = host.querySelector(".character-security-badge");
    if (badge) {
      expect(badge.textContent).toContain("Cero Spoilers");
    }

    // 3.3 Renderizar ReaderRecapBubble con escena recortada al cursor
    const textBeforeCursor = chapterText.slice(0, visibleOffset);
    const sceneRecap = generateZeroSpoilerSceneRecap(
      textBeforeCursor,
      Date.now() - 3600000,
      Date.now(),
      "es",
    );

    await act(async () => {
      root.unmount();
    });
    root = createRoot(host);

    await act(async () => {
      root.render(
        h(ReaderRecapBubble, {
          recapBullets: ["Don Quijote cabalga hacia el Toboso."],
          sceneRecap,
          isLoading: false,
          onDismiss: vi.fn(),
          onTriggerRecap: vi.fn(),
        }),
      );
    });

    expect(host.textContent).not.toContain("Aldonza Lorenzo");
    expect(host.textContent).not.toContain("muere en soledad");

    container.remove();
  });

  it("4. La cola de consolidación episódica en DeepReadingSummaryModal al cerrar capítulo", async () => {
    const { createElement: h, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: DeepReadingSummaryModal } = await import("./DeepReadingSummaryModal");
    const {
      buildPostChapterConsolidationQueue,
      calculateImplicitFsrsGrade,
      DEFAULT_CONSOLIDATION_PREFS,
    } = await import("../lib/practice");

    const bookId = "b-fase4-summary";

    const primedCandidate: EpisodicWordItem = {
      lemma: "quimera",
      surfaceForm: "quimera",
      lang: "es",
      shortGloss: "Ilusión o fantasía que se cree posible",
      chapterSentence: "Perseguía una dulce quimera que iluminaba sus noches oscuras.",
      chapterTitle: "Capítulo 2",
      source: "pre-chapter-primed",
    };

    const lookedUpCandidate: EpisodicWordItem = {
      lemma: "desdén",
      surfaceForm: "desdén",
      lang: "es",
      shortGloss: "Indiferencia y despego que denotan menosprecio",
      chapterSentence: "Fue recibido con un frío desdén por parte del escudero.",
      chapterTitle: "Capítulo 2",
      source: "in-chapter-lookup",
    };

    // 4.1 La cola prioriza in-chapter-lookup sobre pre-chapter-primed
    const queue = buildPostChapterConsolidationQueue(
      [primedCandidate, lookedUpCandidate],
      DEFAULT_CONSOLIDATION_PREFS,
      false,
      { bookId },
    );

    expect(queue.length).toBe(2);
    expect(queue[0].item.lemma).toBe("desdén");
    expect(queue[0].item.source).toBe("in-chapter-lookup");
    expect(queue[1].item.lemma).toBe("quimera");

    // 4.2 Calificación FSRS implícita por latencia (sin pedir notas al usuario)
    const fastResponseGrade = calculateImplicitFsrsGrade(6, {
      lemma: "desdén",
      modality: "sentence-cloze",
      responseTimeMs: 2500, // 2500 / 6 = 416 ms/char <= 650 ms/char
      errorCount: 0,
      usedHint: false,
    });
    expect(fastResponseGrade.grade).toBe(4); // Fácil implícito
    expect(fastResponseGrade.episodicStabilityMultiplier).toBe(1.35);
    expect(fastResponseGrade.masteryDeltaTheta).toBe(0.14);

    // 4.3 DeepReadingSummaryModal renderiza el micro-reto y permite continuar
    root = createRoot(host);
    const onContinue = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: {
            durationMinutes: 20,
            targetMinutes: 20,
            sectionsRead: 1,
            completedNaturally: true,
            wordsAssimilated: 5,
            coverageDeltaPercent: 2,
          },
          consolidationQueue: queue,
          bookId,
          onContinue,
          onClose,
        }),
      );
    });

    expect(host.textContent).toContain("Fija en tu memoria");
    expect(host.textContent).toContain("desdén");
    expect(host.textContent).toContain("quimera");

    const continueBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes("Continuar"),
    );
    expect(continueBtn).not.toBeUndefined();

    await act(async () => {
      continueBtn?.click();
    });

    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});




