// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChapterEndCard } from "./ChapterEndCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChapterEndCard", () => {
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
  });

  const render = (wordCount: number, onFixWords = vi.fn()) => {
    act(() => {
      root.render(
        h(ChapterEndCard, {
          label: "Capítulo 1",
          summaryParts: "2 consultas",
          wordCount,
          onFixWords,
          onOpenNotebook: vi.fn(),
        }),
      );
    });
    return onFixWords;
  };
  const chip = () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Fijar"));

  it("muestra el chip con el conteo y lo dispara al pulsar", () => {
    const onFix = render(3);
    expect(chip()?.textContent).toBe("Fijar 3 palabras (≈25 s)");
    act(() => chip()?.click());
    expect(onFix).toHaveBeenCalledTimes(1);
  });

  it("singular con una palabra", () => {
    render(1);
    expect(chip()?.textContent).toBe("Fijar 1 palabra (≈25 s)");
  });

  it("sin cola no hay chip pero sí el cierre y «Ver Cuaderno»", () => {
    render(0);
    expect(chip()).toBeUndefined();
    expect(host.textContent).toContain("Cerraste «Capítulo 1» — 2 consultas");
    expect(host.textContent).toContain("Ver Cuaderno");
  });
});
