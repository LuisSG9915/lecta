// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Notice, { type NoticeProps } from "./Notice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Notice", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const render = (props: NoticeProps) => {
    act(() => {
      root.render(h(Notice, props));
    });
  };

  it("no renderiza nada si message y error están vacíos", () => {
    render({});
    expect(host.children).toHaveLength(0);
  });

  it("role='status' se oculta a los 5 segundos", () => {
    const onDismiss = vi.fn();
    render({ message: "Libro añadido", onDismissMessage: onDismiss });

    const statusEl = host.querySelector("[role='status']");
    expect(statusEl).not.toBeNull();
    expect(statusEl?.textContent).toContain("Libro añadido");

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("role='status' pausa el temporizador con foco o hover", () => {
    const onDismiss = vi.fn();
    render({ message: "Guardado", onDismissMessage: onDismiss });

    const statusEl = host.querySelector<HTMLElement>("[role='status']")!;
    expect(statusEl).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
      statusEl.focus();
    });

    // Avanza más de 5 segundos mientras está pausado con foco
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    // Reanuda al perder el foco
    act(() => {
      statusEl.blur();
    });

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("role='alert' no se retira automáticamente y tiene botón cerrar", () => {
    const onDismissError = vi.fn();
    render({ error: "Fallo de conexión", onDismissError });

    const alertEl = host.querySelector("[role='alert']");
    expect(alertEl).not.toBeNull();
    expect(alertEl?.textContent).toContain("Fallo de conexión");

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onDismissError).not.toHaveBeenCalled();

    const closeBtn = host.querySelector<HTMLButtonElement>(".app-notice-close")!;
    expect(closeBtn).not.toBeNull();
    expect(closeBtn.getAttribute("aria-label")).toBe("Cerrar aviso");

    act(() => {
      closeBtn.click();
    });
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});
