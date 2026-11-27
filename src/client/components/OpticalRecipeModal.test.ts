// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OpticalRecipeModal from "./OpticalRecipeModal";
import { DEFAULT_SETTINGS, type ReaderSettings } from "../lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("OpticalRecipeModal", () => {
  let container: HTMLDivElement;
  let root: Root;

  const baseSettings: ReaderSettings = {
    ...DEFAULT_SETTINGS,
    textSpacing: "normal",
    measure: 65,
    font: "literata",
    layout: "scroll",
  };

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

  const renderModal = (
    overrides: Partial<{
      sampleText: string;
      language: string;
      initialSettings: ReaderSettings;
      onApply: (patch: Partial<ReaderSettings>, opts: { alsoGlobal: boolean }) => void;
      onClose: () => void;
    }> = {},
  ) => {
    const onApply = overrides.onApply ?? vi.fn();
    const onClose = overrides.onClose ?? vi.fn();
    act(() => {
      root.render(
        h(OpticalRecipeModal, {
          sampleText:
            overrides.sampleText ??
            "El viento movió despacio las ramas del patio mientras la tarde caía sobre las baldosas antiguas de la galería.",
          language: overrides.language ?? "es",
          initialSettings: overrides.initialSettings ?? baseSettings,
          onApply,
          onClose,
        }),
      );
    });
    return { onApply, onClose };
  };

  it("completa los 4 pasos A/B y aplica la receta a todos los libros", () => {
    const { onApply, onClose } = renderModal();

    expect(container.textContent).toContain("Paso 1 de 4");
    expect(container.textContent).toContain("¿En cuál descansan más tus ojos?");

    // Paso 1: Holgado (b)
    const step1B = container.querySelector('.optical-recipe-card[data-option="b"]') as HTMLButtonElement;
    act(() => step1B.click());

    expect(container.textContent).toContain("Paso 2 de 4");
    // Paso 2: Compacto (b)
    const step2B = container.querySelector('.optical-recipe-card[data-option="b"]') as HTMLButtonElement;
    act(() => step2B.click());

    expect(container.textContent).toContain("Paso 3 de 4");
    // Paso 3: Atkinson Next (b)
    const step3B = container.querySelector('.optical-recipe-card[data-option="b"]') as HTMLButtonElement;
    act(() => step3B.click());

    expect(container.textContent).toContain("Paso 4 de 4");
    // Paso 4: Por páginas (a)
    const step4A = container.querySelector('.optical-recipe-card[data-option="a"]') as HTMLButtonElement;
    act(() => step4A.click());

    // Resumen
    expect(container.textContent).toContain("Tu receta visual está lista");
    expect(container.textContent).toContain("Holgado");
    expect(container.textContent).toContain("Compacta (55)");
    expect(container.textContent).toContain("Atkinson Next");
    expect(container.textContent).toContain("Por páginas");

    const applyAllBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Aplicar a todos mis libros"),
    ) as HTMLButtonElement;
    expect(applyAllBtn).toBeDefined();

    act(() => applyAllBtn.click());
    expect(onApply).toHaveBeenCalledWith(
      {
        textSpacing: "relaxed",
        measure: 55,
        margins: "wide",
        font: "atkinson",
        layout: "pages",
      },
      { alsoGlobal: true },
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("permite volver atrás con Anterior y aplicar solo a este libro", () => {
    const { onApply, onClose } = renderModal();

    // Paso 1 -> A (Normal)
    act(() => {
      (container.querySelector('.optical-recipe-card[data-option="a"]') as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain("Paso 2 de 4");

    // Volver al paso 1 y elegir B (Holgado)
    const backBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Anterior"),
    ) as HTMLButtonElement;
    act(() => backBtn.click());
    expect(container.textContent).toContain("Paso 1 de 4");

    act(() => {
      (container.querySelector('.optical-recipe-card[data-option="b"]') as HTMLButtonElement).click();
    });
    // Pasos 2, 3, 4 -> A, A, B
    act(() => {
      (container.querySelector('.optical-recipe-card[data-option="a"]') as HTMLButtonElement).click();
    });
    act(() => {
      (container.querySelector('.optical-recipe-card[data-option="a"]') as HTMLButtonElement).click();
    });
    act(() => {
      (container.querySelector('.optical-recipe-card[data-option="b"]') as HTMLButtonElement).click();
    });

    const bookOnlyBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Solo a este libro"),
    ) as HTMLButtonElement;
    act(() => bookOnlyBtn.click());

    expect(onApply).toHaveBeenCalledWith(
      {
        textSpacing: "relaxed",
        measure: 65,
        margins: "medium",
        font: "literata",
        layout: "scroll",
      },
      { alsoGlobal: false },
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
