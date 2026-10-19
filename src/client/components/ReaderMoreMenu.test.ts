// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReaderMoreMenu, { type ReaderMoreMenuProps } from "./ReaderMoreMenu";

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
    onToggleFullscreen: vi.fn(),
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
    expect(items.length).toBe(2);

    expect(items[0].textContent).toContain("Buscar en el libro");
    expect(items[1].textContent).toContain("Pantalla completa");

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

    const btn = host.querySelectorAll<HTMLButtonElement>(".reader-more-item")[1];
    await act(async () => btn.click());

    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["fullscreen", "close"]);
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

  it("oculta opciones cuando fullscreenSupported es false", () => {
    render({ fullscreenSupported: false });
    const items = host.querySelectorAll(".reader-more-item");
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain("Buscar en el libro");
  });

  it("renderiza Glosario, Cuaderno, Tarjeta de cita y Exportar cuando se proporcionan los callbacks", async () => {
    const onOpenGlossary = vi.fn();
    const onOpenNotebook = vi.fn();
    const onCreateQuoteCard = vi.fn();
    const onExportBook = vi.fn();
    const onClose = vi.fn();
    render({ onOpenGlossary, onOpenNotebook, onCreateQuoteCard, onExportBook, onClose });

    const items = host.querySelectorAll<HTMLButtonElement>(".reader-more-item");
    expect(items.length).toBe(6);

    expect(items[0].textContent).toContain("Buscar en el libro");
    expect(items[1].textContent).toContain("Personajes y glosario");
    expect(items[2].textContent).toContain("Cuaderno de notas");
    expect(items[3].textContent).toContain("Crear tarjeta de cita");
    expect(items[4].textContent).toContain("Exportar notas y vocabulario");
    expect(items[5].textContent).toContain("Pantalla completa");

    await act(async () => items[1].click());
    expect(onOpenGlossary).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => items[2].click());
    expect(onOpenNotebook).toHaveBeenCalledTimes(1);

    await act(async () => items[3].click());
    expect(onCreateQuoteCard).toHaveBeenCalledTimes(1);

    await act(async () => items[4].click());
    expect(onExportBook).toHaveBeenCalledTimes(1);
  });

  it("permite ver y reactivar asistencias silenciadas para el libro actual (Track 12)", async () => {
    // Simular que el libro tiene asistencias silenciadas
    const testBook = "book-mute-test";
    const { muteBookForPriming, isPrimingMutedForBook } = await import("../lib/settings");
    const { muteBookFocusSuggestions, loadFocusTelemetryProfile, saveFocusTelemetryProfile } = await import("../lib/focus-telemetry");
    const { muteConsolidationForBook, isConsolidationActive } = await import("../lib/practice");
    const { saveCharacterMemoryEnabled, loadCharacterMemoryEnabled } = await import("../lib/page-recap");

    muteBookForPriming(testBook);
    const focusProf = loadFocusTelemetryProfile();
    saveFocusTelemetryProfile(muteBookFocusSuggestions(focusProf, testBook));
    muteConsolidationForBook(testBook);
    saveCharacterMemoryEnabled(false);

    expect(isPrimingMutedForBook(testBook)).toBe(true);
    expect(isConsolidationActive(testBook)).toBe(false);
    expect(loadCharacterMemoryEnabled()).toBe(false);

    render({ bookHash: testBook, language: "en" });

    // Verificar que la sección de asistencias inteligentes existe
    const section = host.querySelector(".reader-more-assists-section");
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("Asistencias inteligentes");
    expect(section?.textContent).toContain("Silenciado en este libro");

    const reactivateButtons = host.querySelectorAll<HTMLButtonElement>(
      ".reader-more-reactivate-btn",
    );
    expect(reactivateButtons.length).toBeGreaterThanOrEqual(3);

    // Reactivar vocabulario de capítulo
    await act(async () => {
      reactivateButtons[0].click();
    });
    expect(isPrimingMutedForBook(testBook)).toBe(false);

    // Reactivar sugerencias de foco
    await act(async () => {
      reactivateButtons[1].click();
    });
    const updatedProf = loadFocusTelemetryProfile();
    expect(updatedProf.mutedBookIds).not.toContain(testBook);

    // Reactivar memoria de personajes
    const charBtn = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".reader-more-reactivate-btn"),
    ).find((b) => b.closest(".reader-more-assist-row")?.textContent?.includes("Memoria de personajes"));
    expect(charBtn).not.toBeUndefined();
    await act(async () => {
      charBtn?.click();
    });
    expect(loadCharacterMemoryEnabled()).toBe(true);
  });
});
