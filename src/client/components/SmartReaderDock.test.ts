// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SmartReaderDock, {
  formatCompactProgress,
  getCoverageBandClass,
  type SmartReaderDockProps,
} from "./SmartReaderDock";
import type { TtsSnapshot } from "../lib/ttsTypes";
import { saveFeatureFlags } from "../lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SmartReaderDock (Track 2: Dock Inteligente Único)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const idleSnap: TtsSnapshot = {
    status: "idle",
    sessionId: null,
    rate: 1,
    highlight: "sentence",
    pauseReason: null,
  };

  const speakingSnap: TtsSnapshot = {
    status: "speaking",
    sessionId: "sess-1",
    rate: 1.15,
    highlight: "sentence",
    pauseReason: null,
    activeEngine: "kitten-neural",
  };

  const defaultProps: SmartReaderDockProps = {
    progressText: "Pág. 14 de 62 · ~4 min",
    isPureCanvas: false,
    onExitPureCanvas: vi.fn(),
    activePreset: "clean",
    onSelectPreset: vi.fn(),
    onOpenAdvancedSettings: vi.fn(),
    onStartAudio: vi.fn(),
    onRecap: vi.fn(),
    ttsSnap: idleSnap,
    onTogglePlayPause: vi.fn(),
    onPrevSentence: vi.fn(),
    onNextSentence: vi.fn(),
    onCycleSpeed: vi.fn(),
    onOpenVoiceSelector: vi.fn(),
    onCaptureWord: vi.fn(),
    onStopAudio: vi.fn(),
  };

  const render = (props: Partial<SmartReaderDockProps> = {}) => {
    act(() => {
      root.render(h(SmartReaderDock, { ...defaultProps, ...props }));
    });
  };

  it("renderiza el modo lectura con progreso, preset activo, escuchar y botón de hilo", () => {
    render();

    expect(container.textContent).toContain("Pág. 14 · ~4m");
    const progressEl = container.querySelector(".dock-progress-meta") as HTMLElement;
    expect(progressEl?.title).toBe("Página 14 de 62 — ~4 min restantes");
    expect(container.textContent).toContain("Limpia");
    expect(container.textContent).toContain("Escuchar");
    expect(container.textContent).toContain("Hilo");

    // Botón escuchar dispara onStartAudio
    const listenBtn = container.querySelector(".dock-listen-trigger") as HTMLButtonElement;
    expect(listenBtn).not.toBeNull();
    act(() => listenBtn.click());
    expect(defaultProps.onStartAudio).toHaveBeenCalledTimes(1);

    // Botón hilo dispara onRecap
    const recapBtn = container.querySelector(".dock-recap-trigger") as HTMLButtonElement;
    expect(recapBtn).not.toBeNull();
    act(() => recapBtn.click());
    expect(defaultProps.onRecap).toHaveBeenCalledTimes(1);
  });

  it("abre el popover con los 3 Modos Humanos de 1 Clic y permite seleccionarlos", () => {
    const onSelectPreset = vi.fn();
    const onOpenAdvancedSettings = vi.fn();
    render({ onSelectPreset, onOpenAdvancedSettings });

    // Clic en el disparador de modo
    const modeBtn = container.querySelector(".dock-mode-trigger") as HTMLButtonElement;
    act(() => modeBtn.click());

    // El popover debe aparecer con las 3 tarjetas humanas
    const popover = container.querySelector(".reader-mode-popover");
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain("Lectura Limpia");
    expect(popover?.textContent).toContain("Enfoque TDAH");
    expect(popover?.textContent).toContain("Ritmo Guiado");

    // Seleccionar Enfoque TDAH
    const adhdCard = container.querySelectorAll(".reader-mode-card")[1] as HTMLButtonElement;
    act(() => adhdCard.click());
    expect(onSelectPreset).toHaveBeenCalledWith("adhd");

    // Reabrir y tocar personalizar opciones avanzadas
    act(() => modeBtn.click());
    const customizeBtn = container.querySelector(".reader-mode-customize-link") as HTMLButtonElement;
    expect(customizeBtn).not.toBeNull();
    act(() => customizeBtn.click());
    expect(onOpenAdvancedSettings).toHaveBeenCalledTimes(1);
  });

  it("muta al Modo Audio en el mismo dock cuando ttsSnap está activo", () => {
    const onTogglePlayPause = vi.fn();
    const onPrevSentence = vi.fn();
    const onNextSentence = vi.fn();
    const onCycleSpeed = vi.fn();
    const onCaptureWord = vi.fn();
    const onStopAudio = vi.fn();

    render({
      ttsSnap: speakingSnap,
      onTogglePlayPause,
      onPrevSentence,
      onNextSentence,
      onCycleSpeed,
      onCaptureWord,
      onStopAudio,
    });

    const dock = container.querySelector(".reader-smart-dock");
    expect(dock?.classList.contains("is-audio-mode")).toBe(true);

    // Play/Pausa
    const playBtn = container.querySelector(".dock-audio-play-btn") as HTMLButtonElement;
    expect(playBtn.textContent).toContain("Pausa");
    act(() => playBtn.click());
    expect(onTogglePlayPause).toHaveBeenCalledTimes(1);

    // Navegación frases
    const stepBtns = container.querySelectorAll(".dock-audio-step-btn");
    expect(stepBtns).toHaveLength(2);
    act(() => (stepBtns[0] as HTMLButtonElement).click());
    expect(onPrevSentence).toHaveBeenCalledTimes(1);
    act(() => (stepBtns[1] as HTMLButtonElement).click());
    expect(onNextSentence).toHaveBeenCalledTimes(1);

    // Velocidad
    expect(container.textContent).toContain("1.15×");

    // Motor HD badge
    expect(container.textContent).toContain("Voz HD");
    expect(container.querySelector(".icon--sparkles")).toBeTruthy();

    // Capturar joya léxica al Cuaderno
    const captureBtn = container.querySelector(".dock-audio-capture-btn") as HTMLButtonElement;
    expect(captureBtn).not.toBeNull();
    act(() => captureBtn.click());
    expect(onCaptureWord).toHaveBeenCalledTimes(1);
    expect(captureBtn.textContent).toContain("Guardada");

    // Salir del modo audio
    const closeBtn = container.querySelector(".dock-audio-close-btn") as HTMLButtonElement;
    act(() => closeBtn.click());
    expect(onStopAudio).toHaveBeenCalledTimes(1);
  });

  it("activa Modo Lienzo Puro ocultando el dock y mostrando al michi discreto", () => {
    const onExitPureCanvas = vi.fn();
    const onOpenCatCorner = vi.fn();
    render({
      isPureCanvas: true,
      onExitPureCanvas,
      onOpenCatCorner,
    });

    const dockWrapper = container.querySelector(".reader-smart-dock-wrapper");
    expect(dockWrapper?.classList.contains("is-pure-canvas")).toBe(true);
    expect(dockWrapper?.getAttribute("data-hidden")).toBe("true");

    const miniCat = container.querySelector(".reader-pure-canvas-cat");
    expect(miniCat?.classList.contains("is-visible")).toBe(true);

    const miniCatBtn = container.querySelector(".reader-mini-cat-btn") as HTMLButtonElement;
    act(() => miniCatBtn.click());
    expect(onOpenCatCorner).toHaveBeenCalledTimes(1);
  });

  describe("Fase 3: Sugerencia Silenciosa de Neuro-Foco en SmartReaderDock", () => {
    it("no muestra la píldora si isFatigued es false", () => {
      render({ isFatigued: false });
      expect(container.querySelector(".reader-focus-suggestion-pill")).toBeNull();
    });

    it("no muestra la píldora si featureFlags.focusTelemetry está desactivado", () => {
      saveFeatureFlags({ focusTelemetry: false });
      try {
        render({
          focusSuggestion: {
            isFatigued: true,
            reason: "regressions",
            recommendedAid: "paragraph-focus",
          },
        });
        expect(container.querySelector(".reader-focus-suggestion-pill")).toBeNull();
      } finally {
        saveFeatureFlags({ focusTelemetry: true });
      }
    });

    it("muestra la píldora contextual por releídas (regressions) y la activa en 1 toque", () => {
      const onAcceptFocusAid = vi.fn();
      render({
        focusSuggestion: {
          isFatigued: true,
          reason: "regressions",
          recommendedAid: "paragraph-focus",
        },
        onAcceptFocusAid,
      });

      const pill = container.querySelector(".reader-focus-suggestion-pill");
      expect(pill).not.toBeNull();
      expect(pill?.textContent).toContain("¿Enfocar párrafo actual?");

      // Tocar el botón principal activa la ayuda en 1 toque
      const actionBtn = container.querySelector(".reader-focus-pill-action") as HTMLButtonElement;
      expect(actionBtn).not.toBeNull();
      act(() => actionBtn.click());

      expect(onAcceptFocusAid).toHaveBeenCalledWith("paragraph-focus");
      // Queda cerrada tras aceptar
      expect(container.querySelector(".reader-focus-suggestion-pill")).toBeNull();
    });

    it("muestra la píldora contextual para cadencia sintáctica en L2 o fraseo denso", () => {
      const onAcceptFocusAid = vi.fn();
      render({
        focusSuggestion: {
          isFatigued: true,
          reason: "stall",
          recommendedAid: "syntactic-lines",
        },
        onAcceptFocusAid,
      });

      const pill = container.querySelector(".reader-focus-suggestion-pill");
      expect(pill?.textContent).toContain("¿Activar cadencia por frases?");

      const actionBtn = container.querySelector(".reader-focus-pill-action") as HTMLButtonElement;
      act(() => actionBtn.click());
      expect(onAcceptFocusAid).toHaveBeenCalledWith("syntactic-lines");
    });

    it("muestra la píldora contextual para regla de lectura", () => {
      const onAcceptFocusAid = vi.fn();
      render({
        focusSuggestion: {
          isFatigued: true,
          reason: "stall",
          recommendedAid: "focus-ruler",
        },
        onAcceptFocusAid,
      });

      const pill = container.querySelector(".reader-focus-suggestion-pill");
      expect(pill?.textContent).toContain("¿Activar regla de lectura?");

      const actionBtn = container.querySelector(".reader-focus-pill-action") as HTMLButtonElement;
      act(() => actionBtn.click());
      expect(onAcceptFocusAid).toHaveBeenCalledWith("focus-ruler");
    });


    it("ofrece escuchar los próximos 5 min ante fatiga cognitiva/visual (Fase 3)", () => {
      const onStartAudio5Min = vi.fn();
      render({
        focusSuggestion: {
          isFatigued: true,
          reason: "regressions",
          recommendedAid: "paragraph-focus",
        },
        onStartAudio5Min,
      });

      const audioBtn = container.querySelector(".reader-focus-pill-audio") as HTMLButtonElement;
      expect(audioBtn).not.toBeNull();
      expect(audioBtn.textContent).toContain("Escuchar 5 min 🎧");

      act(() => audioBtn.click());
      expect(onStartAudio5Min).toHaveBeenCalled();
      expect(container.querySelector(".reader-focus-suggestion-pill")).toBeNull();
    });

    it("al tocar ✕ en la píldora ofrece opciones para silenciar en este libro o siempre", () => {
      const onMuteFocusForBook = vi.fn();
      const onDisableFocusGlobally = vi.fn();

      render({
        focusSuggestion: {
          isFatigued: true,
          reason: "regressions",
          recommendedAid: "paragraph-focus",
        },
        onMuteFocusForBook,
        onDisableFocusGlobally,
      });

      // Tocar el botón ✕ de la píldora
      const closeBtn = container.querySelector(".reader-focus-pill-close") as HTMLButtonElement;
      expect(closeBtn).not.toBeNull();
      act(() => closeBtn.click());

      // Deben aparecer las opciones de silenciado
      const muteBookBtn = container.querySelector(".reader-focus-mute-book-btn") as HTMLButtonElement;
      const disableAlwaysBtn = container.querySelector(".reader-focus-disable-always-btn") as HTMLButtonElement;
      expect(muteBookBtn).not.toBeNull();
      expect(disableAlwaysBtn).not.toBeNull();
      expect(muteBookBtn.textContent).toContain("No sugerir en este libro");
      expect(disableAlwaysBtn.textContent).toContain("Desactivar sugerencias de enfoque siempre");

      // Tocar silenciar en este libro
      act(() => muteBookBtn.click());
      expect(onMuteFocusForBook).toHaveBeenCalledTimes(1);
      expect(container.querySelector(".reader-focus-suggestion-pill")).toBeNull();
    });

    it("permite desactivar sugerencias siempre desde las opciones de la píldora", () => {
      const onDisableFocusGlobally = vi.fn();

      render({
        isFatigued: true,
        recommendedFocusAid: "syntactic-lines",
        onDisableFocusGlobally,
      });

      const closeBtn = container.querySelector(".reader-focus-pill-close") as HTMLButtonElement;
      act(() => closeBtn.click());

      const disableAlwaysBtn = container.querySelector(".reader-focus-disable-always-btn") as HTMLButtonElement;
      act(() => disableAlwaysBtn.click());
      expect(onDisableFocusGlobally).toHaveBeenCalledTimes(1);
      expect(container.querySelector(".reader-focus-suggestion-pill")).toBeNull();
    });

    it("no interrumpe en modo audio ni en lienzo puro", () => {
      render({
        isFatigued: true,
        ttsSnap: speakingSnap,
      });
      // En modo audio no se muestra la píldora de lectura
      expect(container.querySelector(".reader-focus-suggestion-pill")).toBeNull();

      render({
        isFatigued: true,
        isPureCanvas: true,
      });
      // En lienzo puro tampoco
      expect(container.querySelector(".reader-focus-suggestion-pill")).toBeNull();
    });
  });

  describe("Fase 1: Geometría Responsiva, Popover sin Colisión y Cápsula", () => {
    it("formatCompactProgress formatea texto largo a versión compacta y genera title accesible", () => {
      const capResult = formatCompactProgress("Cap. 13 de 96 · ~5 min");
      expect(capResult.compact).toBe("Cap. 13 · ~5m");
      expect(capResult.title).toBe("Capítulo 13 de 96 — ~5 min restantes");

      const pagResult = formatCompactProgress("Pág. 14 de 62 · ~4 min");
      expect(pagResult.compact).toBe("Pág. 14 · ~4m");
      expect(pagResult.title).toBe("Página 14 de 62 — ~4 min restantes");

      const noMinResult = formatCompactProgress("Cap. 5 de 20");
      expect(noMinResult.compact).toBe("Cap. 5");
      expect(noMinResult.title).toBe("Capítulo 5 de 20");
    });

    it("incluye etiquetas colapsables dock-action-label-collapsible en botones de acción", () => {
      render();

      const listenLabel = container.querySelector(".dock-listen-trigger .dock-action-label-collapsible");
      expect(listenLabel).not.toBeNull();
      expect(listenLabel?.textContent).toBe("Escuchar");

      const recapLabel = container.querySelector(".dock-recap-trigger .dock-action-label-collapsible");
      expect(recapLabel).not.toBeNull();
      expect(recapLabel?.textContent).toBe("Hilo");
    });

    it("el popover incluye dock-mode-popover-footer y botón con dock-mode-customize-btn", () => {
      render();

      const modeBtn = container.querySelector(".dock-mode-trigger") as HTMLButtonElement;
      act(() => modeBtn.click());

      const popover = container.querySelector(".dock-mode-popover");
      expect(popover).not.toBeNull();

      const footer = container.querySelector(".dock-mode-popover-footer");
      expect(footer).not.toBeNull();

      const customizeBtn = footer?.querySelector(".dock-mode-customize-btn") as HTMLButtonElement;
      expect(customizeBtn).not.toBeNull();
      expect(customizeBtn.textContent).toContain("Personalizar opciones avanzadas");
    });
  });

  describe("Fase 3: Acoplamiento del Gato (Perch Mode) y Backdrop de Inmersión", () => {
    it("posa al gato en dock-companion-perch sobre la repisa de la cápsula sin invadir dock-actions-group", () => {
      const companionNode = h("div", { "data-testid": "mock-cat" }, "Michi");
      render({ companionSlot: companionNode });

      const perchSlot = container.querySelector(".dock-companion-slot.dock-companion-perch");
      expect(perchSlot).not.toBeNull();
      expect(perchSlot?.textContent).toContain("Michi");

      // dock-actions-group NO contiene el slot del gato (libera 40px horizontales)
      const actionsGroup = container.querySelector(".dock-actions-group");
      expect(actionsGroup?.querySelector(".dock-companion-slot")).toBeNull();
    });

    it("oculta suavemente al gato con data-popover-open cuando el popover de modos se abre", () => {
      const companionNode = h("div", { "data-testid": "mock-cat" }, "Michi");
      render({ companionSlot: companionNode });

      const perchSlot = container.querySelector(".dock-companion-perch");
      expect(perchSlot?.getAttribute("data-popover-open")).toBeNull();

      // Abrir popover
      const modeBtn = container.querySelector(".dock-mode-trigger") as HTMLButtonElement;
      act(() => modeBtn.click());

      // El slot recibe data-popover-open="true" para su transición de opacidad
      expect(perchSlot?.getAttribute("data-popover-open")).toBe("true");

      // Cerrar popover
      act(() => modeBtn.click());
      expect(perchSlot?.getAttribute("data-popover-open")).toBeNull();
    });

    it("renderiza backdrop transparente que cierra el popover sin disparar eventos de navegación", () => {
      render();

      const modeBtn = container.querySelector(".dock-mode-trigger") as HTMLButtonElement;
      act(() => modeBtn.click());

      const backdrop = container.querySelector(".dock-mode-popover-backdrop") as HTMLDivElement;
      expect(backdrop).not.toBeNull();

      // Al hacer clic en el backdrop, el popover se cierra
      act(() => backdrop.click());
      expect(container.querySelector(".dock-mode-popover")).toBeNull();
    });
  });

  describe("Fase 2: Desambiguación del Porcentaje de Cobertura Léxica", () => {
    it("getCoverageBandClass asigna las clases semánticas correctas según umbral", () => {
      expect(getCoverageBandClass(96)).toBe("is-easy");
      expect(getCoverageBandClass(95)).toBe("is-easy");
      expect(getCoverageBandClass(92)).toBe("is-moderate");
      expect(getCoverageBandClass(90)).toBe("is-moderate");
      expect(getCoverageBandClass(89)).toBe("is-challenging");
      expect(getCoverageBandClass(75)).toBe("is-challenging");
    });

    it("renderiza la píldora de vocabulario del capítulo con el prefijo Vocab. y clase semántica", () => {
      const onOpenGlossary = vi.fn();
      render({ coveragePct: 92, onOpenGlossary });

      const pill = container.querySelector(".smart-dock-pill") as HTMLButtonElement;
      expect(pill).not.toBeNull();
      expect(pill.classList.contains("is-moderate")).toBe(true);
      expect(pill.getAttribute("aria-label")).toBe(
        "Vocabulario conocido del capítulo: 92%. Toca para abrir el glosario",
      );
      expect(pill.textContent).toContain("Vocab.");
      expect(pill.textContent).toContain("92%");

      act(() => pill.click());
      expect(onOpenGlossary).toHaveBeenCalledTimes(1);
    });
  });

  describe("Fase 1: Píldora de Progreso Invisible y Récord Contextual (Anti-Abandono)", () => {
    it("renderiza la píldora de progreso con el formato exacto 'Llevas {progress}% · {weeklyWords} palabras nuevas esta semana'", () => {
      render({
        bookProgressPct: 42,
        weeklyWordsCount: 7,
      });

      const pill = container.querySelector(".reader-progress-invisible-pill");
      expect(pill).not.toBeNull();
      expect(pill?.textContent?.trim()).toBe("Llevas 42% · 7 palabras nuevas esta semana");
    });

    it("auto-oculta la píldora cuando isReadingActive es true", () => {
      render({
        bookProgressPct: 60,
        weeklyWordsCount: 12,
        isReadingActive: true,
      });

      const pill = container.querySelector(".reader-progress-invisible-pill");
      expect(pill).not.toBeNull();
      expect(pill?.classList.contains("is-hidden")).toBe(true);
    });

    it("muestra el toast sutil de récord mensual cuando recordToast está presente", () => {
      render({
        recordToast: "Nuevo récord: tu lectura más larga este mes",
      });

      const toast = container.querySelector(".reader-record-toast");
      expect(toast).not.toBeNull();
      expect(toast?.textContent).toContain("Nuevo récord: tu lectura más larga este mes");
      expect(toast?.textContent).toContain("🏆");
    });
  });
});


