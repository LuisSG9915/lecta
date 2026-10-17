// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BilingueParagraph } from "./BilingueParagraph";

// @ts-expect-error test act environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("BilingueParagraph", () => {
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

  it("despliega la traducción al hacer doble toque en un libro en inglés", async () => {
    const fetchMock = vi.fn().mockResolvedValue("El sol salía sobre el horizonte.");

    await act(async () => {
      root.render(
        h(BilingueParagraph, {
          originalText: "The sun was rising over the horizon.",
          bookLanguage: "en",
          fetchParagraphTranslation: fetchMock,
        }),
      );
    });

    const p = host.querySelector<HTMLParagraphElement>(".reader-text-paragraph");
    expect(p).not.toBeNull();
    expect(host.textContent).toContain("The sun was rising over the horizon.");
    expect(host.querySelector(".paragraph-inline-translation")).toBeNull();

    // Disparar doble clic (doble toque)
    await act(async () => {
      p?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledWith("The sun was rising over the horizon.");
    expect(host.querySelector(".paragraph-inline-translation")).not.toBeNull();
    expect(host.textContent).toContain("El sol salía sobre el horizonte.");

    // Segundo doble clic oculta la traducción
    await act(async () => {
      p?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(host.querySelector(".paragraph-inline-translation")).toBeNull();
  });

  it("no traduce si el libro ya está en español (bookLanguage === 'es')", async () => {
    const fetchMock = vi.fn();

    await act(async () => {
      root.render(
        h(BilingueParagraph, {
          originalText: "El sol salía sobre el horizonte.",
          bookLanguage: "es",
          fetchParagraphTranslation: fetchMock,
        }),
      );
    });

    const p = host.querySelector<HTMLParagraphElement>(".reader-text-paragraph");
    await act(async () => {
      p?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
