// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReaderMoreMenu, { type ReaderMoreMenuProps } from "./ReaderMoreMenu";
import { READER_DEFAULTS } from "../lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ReaderMoreMenu", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  const defaultProps: ReaderMoreMenuProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSearch: vi.fn(),
    onToggleTts: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onOpenRetreat: vi.fn(),
  };

  const render = (props: Partial<ReaderMoreMenuProps> = {}) => {
    act(() => {
      root.render(h(ReaderMoreMenu, { ...defaultProps, ...props }));
    });
  };

  it("no renderiza nada cuando isOpen es false", () => {
    render({ isOpen: false });
    expect(host.querySelector(".reader-more-menu")).toBeNull();
  });

  it("renderiza todos los items por defecto y enfoca el primero", () => {
    render();
    const menu = host.querySelector(".reader-more-menu");
    expect(menu).toBeTruthy();
    const items = host.querySelectorAll(".reader-more-item");
    expect(items.length).toBe(4);

    expect(items[0].textContent).toContain("Buscar en el libro");
    expect(items[1].textContent).toContain("Leer en voz alta");
    expect(items[2].textContent).toContain("Pantalla completa");
    expect(items[3].textContent).toContain("Retiro de lectura");

    expect(document.activeElement).toBe(items[0]);
  });

  it("Buscar invoca onSearch y onClose", async () => {
    const onSearch = vi.fn();
    const onClose = vi.fn();
    render({ onSearch, onClose });

    const btn = host.querySelectorAll<HTMLButtonElement>(".reader-more-item")[0];
    await act(async () => btn.click());

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Pantalla completa invoca onToggleFullscreen sincrónicamente antes de onClose", async () => {
    const calls: string[] = [];
    const onToggleFullscreen = vi.fn(() => calls.push("fullscreen"));
    const onClose = vi.fn(() => calls.push("close"));
    render({ onToggleFullscreen, onClose });

    const btn = host.querySelectorAll<HTMLButtonElement>(".reader-more-item")[2];
    await act(async () => btn.click());

    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["fullscreen", "close"]);
  });

  it("Escuchar invoca onToggleTts y onClose", async () => {
    const onToggleTts = vi.fn();
    const onClose = vi.fn();
    render({ onToggleTts, onClose, ttsActive: true });

    const btn = host.querySelectorAll<HTMLButtonElement>(".reader-more-item")[1];
    expect(btn.textContent).toContain("Detener voz");
    await act(async () => btn.click());

    expect(onToggleTts).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Retiro invoca onOpenRetreat y onClose", async () => {
    const onOpenRetreat = vi.fn();
    const onClose = vi.fn();
    render({ onOpenRetreat, onClose });

    const btn = host.querySelectorAll<HTMLButtonElement>(".reader-more-item")[3];
    await act(async () => btn.click());

    expect(onOpenRetreat).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape cierra el menú", () => {
    const onClose = vi.fn();
    render({ onClose });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clic en el scrim cierra el menú", async () => {
    const onClose = vi.fn();
    render({ onClose });

    const scrim = host.querySelector<HTMLDivElement>(".reader-more-scrim");
    expect(scrim).toBeTruthy();
    await act(async () => scrim!.click());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("oculta opciones cuando ttsSupported o fullscreenSupported son false", () => {
    render({ ttsSupported: false, fullscreenSupported: false });
    const items = host.querySelectorAll(".reader-more-item");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("Buscar en el libro");
    expect(items[1].textContent).toContain("Retiro de lectura");
  });

  it("renderiza Glosario, Tarjeta de cita y Exportar cuando se proporcionan los callbacks", async () => {
    const onOpenGlossary = vi.fn();
    const onCreateQuoteCard = vi.fn();
    const onExportBook = vi.fn();
    const onClose = vi.fn();
    render({ onOpenGlossary, onCreateQuoteCard, onExportBook, onClose });

    const items = host.querySelectorAll<HTMLButtonElement>(".reader-more-item");
    expect(items.length).toBe(7);

    expect(items[0].textContent).toContain("Glosario del libro");
    expect(items[2].textContent).toContain("Crear tarjeta de cita");
    expect(items[3].textContent).toContain("Exportar notas y vocabulario");

    await act(async () => items[0].click());
    expect(onOpenGlossary).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => items[2].click());
    expect(onCreateQuoteCard).toHaveBeenCalledTimes(1);

    await act(async () => items[3].click());
    expect(onExportBook).toHaveBeenCalledTimes(1);
  });

  it("renderiza el selector de contraste de ayudas con las 3 píldoras (Suave, Nítido, Intenso AAA)", async () => {
    const onStrategyContrastChange = vi.fn();
    render({ strategyContrast: "high", onStrategyContrastChange });

    const pills = host.querySelectorAll<HTMLButtonElement>(".segmented--contrast .segmented-btn");
    expect(pills.length).toBe(3);
    expect(pills[0].textContent).toContain("Suave");
    expect(pills[1].textContent).toContain("Nítido");
    expect(pills[2].textContent).toContain("Intenso (AAA)");

    // La píldora 'high' debe estar activa
    expect(pills[2].getAttribute("aria-pressed")).toBe("true");
    expect(pills[0].getAttribute("aria-pressed")).toBe("false");

    // Al hacer clic en 'soft' se invoca el callback
    await act(async () => pills[0].click());
    expect(onStrategyContrastChange).toHaveBeenCalledWith("soft");

    // Al hacer clic en 'balanced' se invoca el callback
    await act(async () => pills[1].click());
    expect(onStrategyContrastChange).toHaveBeenCalledWith("balanced");
  });

  it("renderiza los 3 botones rápidos de presets y llama a onUpdateSettings con el preset aplicado", async () => {
    const onUpdateSettings = vi.fn();
    render({ settings: READER_DEFAULTS, onUpdateSettings });

    const cards = host.querySelectorAll<HTMLButtonElement>(".reader-mode-card");
    expect(cards.length).toBe(3);
    expect(cards[0].textContent).toContain("Lectura Limpia");
    expect(cards[1].textContent).toContain("Enfoque TDAH");
    expect(cards[2].textContent).toContain("Ritmo Guiado");

    await act(async () => cards[1].click());
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        readingPreset: "adhd",
        paragraphFocus: true,
        syntacticLines: false,
      }),
    );
  });

  it("cambiar cualquiera de los switches individuales establece readingPreset: 'custom'", async () => {
    const onUpdateSettings = vi.fn();
    render({ settings: READER_DEFAULTS, onUpdateSettings });

    const focusRulerSwitch = host.querySelector<HTMLInputElement>('input[aria-label="focusRuler"]');
    expect(focusRulerSwitch).toBeTruthy();

    await act(async () => {
      focusRulerSwitch!.click();
    });

    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        focusRuler: true,
        readingPreset: "custom",
      }),
    );
  });

  it("renderiza el selector de preparación de capítulo con las 3 opciones (Auto, Bajo demanda, Desactivado)", async () => {
    const onChapterPrimingModeChange = vi.fn();
    render({ chapterPrimingMode: "on-demand", onChapterPrimingModeChange });

    const pills = host.querySelectorAll<HTMLButtonElement>(".segmented--priming .segmented-btn");
    expect(pills.length).toBe(3);
    expect(pills[0].textContent).toContain("Auto");
    expect(pills[1].textContent).toContain("Bajo demanda");
    expect(pills[2].textContent).toContain("Desactivado");

    expect(pills[1].getAttribute("aria-pressed")).toBe("true");
    expect(pills[0].getAttribute("aria-pressed")).toBe("false");

    await act(async () => pills[0].click());
    expect(onChapterPrimingModeChange).toHaveBeenCalledWith("auto");

    await act(async () => pills[2].click());
    expect(onChapterPrimingModeChange).toHaveBeenCalledWith("off");
  });
});


