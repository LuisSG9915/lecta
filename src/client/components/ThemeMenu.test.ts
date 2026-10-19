// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeMenu from "./ThemeMenu";
import { READER_DEFAULTS } from "../lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ThemeMenu", () => {
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

  it("renderiza variante swatches simple sin settings (retrocompatibilidad Account.tsx)", async () => {
    const onChange = vi.fn();
    act(() => {
      root.render(h(ThemeMenu, { value: "papel", onChange, variant: "swatches" }));
    });

    const swatches = host.querySelectorAll(".swatch");
    expect(swatches.length).toBeGreaterThanOrEqual(4);
    expect(host.querySelector(".theme-sheet-container")).toBeNull();

    await act(async () => {
      (swatches[0] as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("renderiza los 3 bloques visuales cuando se proporcionan settings", () => {
    const onChange = vi.fn();
    const onUpdateSettings = vi.fn();
    act(() => {
      root.render(
        h(ThemeMenu, {
          value: "blanco",
          onChange,
          settings: READER_DEFAULTS,
          onUpdateSettings,
        }),
      );
    });

    const container = host.querySelector(".theme-sheet-container");
    expect(container).toBeTruthy();

    const sections = host.querySelectorAll(".theme-sheet-section");
    expect(sections.length).toBe(3);

    // Bloque 1: Tema y color
    expect(sections[0].textContent).toContain("Tema y color");
    expect(sections[0].querySelectorAll(".swatch").length).toBeGreaterThanOrEqual(4);

    // Bloque 2: Tipografía y ritmo
    expect(sections[1].textContent).toContain("Tipografía y ritmo");
    expect(sections[1].querySelector(".font-carousel")).toBeTruthy();
    expect(sections[1].textContent).toContain("Tamaño de letra");
    expect(sections[1].textContent).toContain("Interlineado");
    expect(sections[1].textContent).toContain("Márgenes");

    // Bloque 3: Ayudas de enfoque
    expect(sections[2].textContent).toContain("Ayudas de enfoque");
    const cards = sections[2].querySelectorAll(".reader-mode-card");
    expect(cards.length).toBe(3);
    expect(cards[0].textContent).toContain("Lectura Limpia");
    expect(cards[1].textContent).toContain("Enfoque TDAH");
    expect(cards[2].textContent).toContain("Ritmo Guiado");

    expect(sections[2].textContent).toContain("Regla de lectura");
    expect(sections[2].textContent).toContain("Ilumina solo la línea actual");
    expect(sections[2].textContent).toContain("Párrafos por bloques");
    expect(sections[2].textContent).toContain("Agrupa frases largas para leer sin fatiga");
    expect(sections[2].textContent).toContain("Apoyo bilingüe");
    expect(sections[2].textContent).toContain("Muestra traducciones suaves en pasajes difíciles");
  });

  it("seleccionar un preset en el Bloque 3 actualiza settings", async () => {
    const onUpdateSettings = vi.fn();
    act(() => {
      root.render(
        h(ThemeMenu, {
          value: "blanco",
          onChange: vi.fn(),
          settings: READER_DEFAULTS,
          onUpdateSettings,
        }),
      );
    });

    const cards = host.querySelectorAll<HTMLButtonElement>(".reader-mode-card");
    // Clic en Enfoque TDAH
    await act(async () => {
      cards[1].click();
    });

    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        readingPreset: "adhd",
        paragraphFocus: true,
        bionicAnchors: true,
      }),
    );
  });

  it("cambiar los switches individuales en el Bloque 3 conmuta a custom", async () => {
    const onUpdateSettings = vi.fn();
    const onToggleFocusRuler = vi.fn();
    act(() => {
      root.render(
        h(ThemeMenu, {
          value: "blanco",
          onChange: vi.fn(),
          settings: READER_DEFAULTS,
          onUpdateSettings,
          onToggleFocusRuler,
        }),
      );
    });

    const switches = host.querySelectorAll<HTMLButtonElement>('.theme-focus-switches button[role="switch"]');
    expect(switches.length).toBe(3);

    // Switch 0: Regla de lectura
    await act(async () => {
      switches[0].click();
    });
    expect(onToggleFocusRuler).toHaveBeenCalledWith(true);
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        focusRuler: true,
        readingPreset: "custom",
      }),
    );

    // Switch 1: Párrafos por bloques
    await act(async () => {
      switches[1].click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        paragraphFocus: true,
        readingPreset: "custom",
      }),
    );

    // Switch 2: Apoyo bilingüe
    await act(async () => {
      switches[2].click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        bilingualScaffoldingMode: "off",
      }),
    );
  });
});
