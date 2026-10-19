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

    // Rótulos humanos de diseño
    expect(host.textContent).toContain("Color de página");
    expect(host.textContent).toContain("Letra");
    expect(host.textContent).toContain("Tamaño de letra");
    expect(host.textContent).toContain("Espacio entre líneas");
    expect(host.textContent).toContain("Ancho de página");

    // Switches con lenguaje claro (sin jerga psicométrica ni biónica)
    expect(host.textContent).toContain("Regla guía de lectura");
    expect(host.textContent).toContain("Ilumina la línea actual para no perder el renglón");

    expect(host.textContent).toContain("Un párrafo a la vez");
    expect(host.textContent).toContain("Atenúa el resto del texto para concentrarte en el bloque actual");

    expect(host.textContent).toContain("Guía visual de sílabas");
    expect(host.textContent).toContain("Destaca el inicio de cada palabra para leer con más agilidad");

    expect(host.textContent).toContain("Dividir palabras largas");
    expect(host.textContent).toContain("Separa con guiones sutiles las palabras complejas");

    expect(host.textContent).toContain("Agrupar frases por idea");
    expect(host.textContent).toContain("Separa el texto en pausas naturales para facilitar la comprensión");

    expect(host.textContent).toContain("Traducción al inglés por párrafo");
    expect(host.textContent).toContain("Muestra una traducción discreta debajo de cada párrafo");

    expect(host.textContent).toContain("Sugerir palabras del capítulo");
    expect(host.textContent).toContain("Muestra un resumen de vocabulario clave al comenzar un nuevo capítulo");

    expect(host.textContent).toContain("Modo sin mascota");
    expect(host.textContent).toContain("Oculta las animaciones del búho para una lectura completamente sobria");
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
    expect(switches.length).toBe(8);

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

    // Switch 2: Guía visual de sílabas
    await act(async () => {
      switches[2].click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        bionicReading: true,
        bionicAnchors: true,
      }),
    );

    // Switch 7: Modo sin mascota (companionEnabled = false)
    await act(async () => {
      switches[7].click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        companionEnabled: false,
      }),
    );
  });
});
