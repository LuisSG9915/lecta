// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeepReadingSummaryModal from "./DeepReadingSummaryModal";
import type { DeepReadingSummary } from "../lib/deep-reading";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DeepReadingSummaryModal", () => {
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

  const baseSummary: DeepReadingSummary = {
    durationMinutes: 20,
    targetMinutes: 20,
    sectionsRead: 3,
    completedNaturally: true,
    wordsAssimilated: 12,
    coverageDeltaPercent: 2,
  };

  it("muestra la duración, palabras asimiladas y cobertura del libro", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(h(DeepReadingSummaryModal, { summary: baseSummary, onClose }));
    });

    const text = host.textContent ?? "";
    expect(text).toContain("20 minutos");
    expect(text).toContain("3");
    expect(text).toContain("Secciones leídas");
    expect(text).toContain("+12");
    expect(text).toContain("Palabras asimiladas");
    expect(text).toContain("+2%");
    expect(text).toContain("Incremento de cobertura");
    expect(text).toContain("celebra tu lectura");
  });

  it("permite cerrar y continuar la lectura", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          onClose,
          onContinue,
        }),
      );
    });

    const continueBtn = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Continuar"),
    )!;
    expect(continueBtn).toBeTruthy();

    act(() => {
      continueBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onContinue).toHaveBeenCalled();
  });
});
