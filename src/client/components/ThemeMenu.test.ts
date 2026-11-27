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

    await act(async () => {
      (swatches[0] as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("renderiza controles con lenguaje humano sin jerga cognitiva cuando se proporcionan settings", () => {
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

    const menu = host.querySelector('.theme-menu[role="dialog"]');
    expect(menu).toBeTruthy();

    // Expone los 5 temas reales incluyendo Auto y Noche Tinta (OLED)
    const swatches = host.querySelectorAll<HTMLButtonElement>(".swatch");
    expect(swatches).toHaveLength(5);
    expect(host.textContent).toContain("Auto");
    expect(host.textContent).toContain("Noche Tinta");

    // Rótulos humanos de diseño
    expect(host.textContent).toContain("Color de página");
    expect(host.textContent).toContain("Letra");
    expect(host.textContent).toContain("Tamaño de letra");
    expect(host.textContent).toContain("Espacio entre líneas");
    expect(host.textContent).toContain("Ancho de página");

    // Switches con lenguaje claro (sin toggles muertos ni jerga)
    expect(host.textContent).toContain("Regla guía de lectura");
    expect(host.textContent).toContain("Ilumina la línea actual para no perder el renglón");

    expect(host.textContent).toContain("Un párrafo a la vez");
    expect(host.textContent).toContain("Atenúa el resto del texto para concentrarte en el bloque actual");

    expect(host.textContent).toContain("Resaltar inicio de palabra");
    expect(host.textContent).toContain("Destaca el inicio de cada palabra (alivio visual experimental)");

    expect(host.textContent).not.toContain("Dividir palabras largas");
    expect(host.textContent).not.toContain("Modo sin mascota");
    expect(host.textContent).not.toContain("búho");

    expect(host.textContent).toContain("Agrupar frases por idea");
    expect(host.textContent).toContain("Separa el texto en pausas naturales para facilitar la comprensión");

    expect(host.textContent).toContain("Traducción al inglés por párrafo");
    expect(host.textContent).toContain("Muestra una traducción discreta debajo de cada párrafo");

    expect(host.textContent).toContain("Sugerir palabras del capítulo");
    expect(host.textContent).toContain("Muestra un resumen de vocabulario clave al comenzar un nuevo capítulo");
  });

  it("permite seleccionar el tema Noche Tinta (oled) desde el selector de color", async () => {
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

    const oledSwatch = Array.from(host.querySelectorAll<HTMLButtonElement>(".swatch")).find((btn) =>
      btn.textContent?.includes("Noche Tinta"),
    );
    expect(oledSwatch).toBeTruthy();

    await act(async () => {
      oledSwatch!.click();
    });

    expect(onUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: "oled" }));
    expect(onChange).toHaveBeenCalledWith("oled");
  });

  it("cambiar los switches individuales actualiza settings adecuadamente", async () => {
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

    const switches = host.querySelectorAll<HTMLButtonElement>('button[role="switch"]');
    expect(switches.length).toBe(6);

    // Switch 0: Regla guía de lectura
    await act(async () => {
      switches[0].click();
    });
    expect(onToggleFocusRuler).toHaveBeenCalledWith(true);
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        focusRuler: true,
      }),
    );

    // Switch 1: Un párrafo a la vez
    await act(async () => {
      switches[1].click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        paragraphFocus: true,
      }),
    );

    // Switch 2: Resaltar inicio de palabra
    await act(async () => {
      switches[2].click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        bionicReading: true,
        bionicAnchors: true,
      }),
    );

    // Switch 5: Sugerir palabras del capítulo
    await act(async () => {
      switches[5].click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterPreview: false,
      }),
    );
  });

  it("expone Espaciado de texto anti-crowding y Sonido de fondo opcional", async () => {
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

    expect(host.textContent).toContain("Espaciado de texto");
    expect(host.textContent).toContain("Sonido de fondo (opcional)");

    const spacingBtns = host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Espaciado de texto"] button',
    );
    expect(spacingBtns).toHaveLength(3);
    expect(spacingBtns.length && Array.from(spacingBtns).map((b) => b.textContent)).toEqual([
      "Normal",
      "Holgado",
      "Amplio",
    ]);

    await act(async () => {
      spacingBtns[2].click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ textSpacing: "wide" }),
    );

    const soundBtns = host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Sonido de fondo"] button',
    );
    expect(soundBtns).toHaveLength(4);
    expect(Array.from(soundBtns).map((b) => b.textContent)).toEqual([
      "Silencio",
      "Biblioteca",
      "Lluvia",
      "Ronroneo",
    ]);

    await act(async () => {
      soundBtns[2].click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ soundscape: "rain", ambientPurr: false }),
    );
  });
});
