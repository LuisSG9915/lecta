// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderFloatingBars } from "./ReaderFloatingBars";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ReaderFloatingBars — resumen post-audio (M3)", () => {
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

  it("oculta el resumen mientras el audio suena y lo muestra al detenerse con acciones de Herbario y cierre", () => {
    const onOpenNotebook = vi.fn();
    const onDismissAudioSummary = vi.fn();

    act(() => {
      root.render(
        h(ReaderFloatingBars, {
          ttsCapturedToast: null,
          ttsSessionCaptures: ["efímero", "terso"],
          ttsActive: true,
          onOpenNotebook,
          onDismissAudioSummary,
          activeBilingualParagraph: null,
          bookHash: "h1",
          language: "es",
          setBilingualMode: vi.fn(),
        }),
      );
    });
    expect(host.textContent).toBe("");

    act(() => {
      root.render(
        h(ReaderFloatingBars, {
          ttsCapturedToast: null,
          ttsSessionCaptures: ["efímero", "terso"],
          ttsActive: false,
          onOpenNotebook,
          onDismissAudioSummary,
          activeBilingualParagraph: null,
          bookHash: "h1",
          language: "es",
          setBilingualMode: vi.fn(),
        }),
      );
    });

    expect(host.textContent).toContain("Capturaste 2 palabras al escuchar: efímero, terso");
    const openBtn = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Ver en Herbario",
    )!;
    expect(openBtn).toBeTruthy();
    act(() => openBtn.click());
    expect(onDismissAudioSummary).toHaveBeenCalledTimes(1);
    expect(onOpenNotebook).toHaveBeenCalledTimes(1);

    const closeBtn = host.querySelector<HTMLButtonElement>('[aria-label="Cerrar resumen de audio"]')!;
    act(() => closeBtn.click());
    expect(onDismissAudioSummary).toHaveBeenCalledTimes(2);
  });
});
