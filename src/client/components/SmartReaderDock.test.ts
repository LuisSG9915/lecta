// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SmartReaderDock, { type SmartReaderDockProps } from "./SmartReaderDock";
import type { TtsSnapshot } from "../lib/ttsTypes";

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

    expect(container.textContent).toContain("Pág. 14 de 62 · ~4 min");
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
    expect(container.textContent).toContain("✨ Voz HD");

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
});

