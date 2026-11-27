// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CarneSheet from "./CarneSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CarneSheet", () => {
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
    vi.restoreAllMocks();
  });

  it("muestra el Carné de Lector dentro de una hoja modal y llama onClose al cerrar", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    act(() => {
      root.render(
        h(CarneSheet, {
          plan: { plan: "free", starterCoat: null, expiresAt: null },
          onClose,
        }),
      );
    });
    expect(host.querySelector('[role="dialog"][aria-label="Lecta+"]')).not.toBeNull();
    expect(host.textContent).toContain("Carné de Lector");
    expect(host.textContent).toContain("Hacerme Lecta+");
    const closeBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!;
    act(() => {
      closeBtn.click();
      vi.advanceTimersByTime(250);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
