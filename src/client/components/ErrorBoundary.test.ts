// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorBoundary,
  ERROR_LOG_STORAGE_KEY,
  ERROR_LOG_MAX_ENTRIES,
  getStoredErrorLogs,
  logErrorToStorage,
  clearActiveBookState,
} from "./ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const render = (node: ReactNode) => act(() => root.render(node));

function Bomb({ shouldThrow, message }: { shouldThrow: boolean; message?: string }) {
  if (shouldThrow) {
    throw new Error(message || "Error fatal simulado");
  }
  return h("div", { className: "safe-content" }, "Todo correcto");
}

describe("ErrorBoundary", () => {
  it("renderiza a los hijos normalmente cuando no hay error", () => {
    render(
      h(
        ErrorBoundary,
        null,
        h(Bomb, { shouldThrow: false }),
      ),
    );
    expect(host.querySelector(".safe-content")?.textContent).toBe("Todo correcto");
    expect(host.querySelector(".error-boundary-screen")).toBeNull();
  });

  it("captura errores de renderizado y muestra la pantalla sobria", () => {
    render(
      h(
        ErrorBoundary,
        null,
        h(Bomb, { shouldThrow: true, message: "Fallo en render" }),
      ),
    );

    const screen = host.querySelector(".error-boundary-screen");
    expect(screen).not.toBeNull();
    expect(screen?.textContent).toContain("Interrupción inesperada");
    expect(screen?.textContent).toContain("Volver a la biblioteca");
    expect(screen?.textContent).toContain("Recargar");

    // Estilo sobrio: cero emojis
    const text = screen?.textContent || "";
    const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(text);
    expect(hasEmoji).toBe(false);
  });

  it("registra el error en localStorage bajo lecta_error_log_v1 con estructura requerida", () => {
    expect(ERROR_LOG_STORAGE_KEY).toBe("lecta_error_log_v1");
    render(
      h(
        ErrorBoundary,
        null,
        h(Bomb, { shouldThrow: true, message: "Error de prueba" }),
      ),
    );

    const logs = getStoredErrorLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Error de prueba");
    expect(typeof logs[0].timestamp).toBe("number");
    expect(typeof logs[0].url).toBe("string");
    expect(logs[0].url).toBe(window.location.pathname);
    expect(logs[0].url).not.toContain("http");
    expect(logs[0].url).not.toContain(window.location.origin);
    expect(logs[0].stack).toBeDefined();
  });

  it("mantiene un anillo de como máximo 5 errores en localStorage", () => {
    for (let i = 1; i <= 7; i++) {
      logErrorToStorage(new Error(`Error ${i}`));
    }

    const logs = getStoredErrorLogs();
    expect(logs.length).toBe(ERROR_LOG_MAX_ENTRIES);
    expect(logs.map((l) => l.message)).toEqual([
      "Error 3",
      "Error 4",
      "Error 5",
      "Error 6",
      "Error 7",
    ]);
  });

  it("el botón Volver a la biblioteca ejecuta onReset y limpia estado de libro activo", () => {
    sessionStorage.setItem("activeBook", "hash123");
    sessionStorage.setItem("lecta:active-book", "hash123");
    const onReset = vi.fn();

    render(
      h(
        ErrorBoundary,
        { onReset },
        h(Bomb, { shouldThrow: true, message: "Crash" }),
      ),
    );

    const backBtn = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Volver a la biblioteca"),
    );
    expect(backBtn).toBeDefined();

    act(() => {
      backBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("activeBook")).toBeNull();
    expect(sessionStorage.getItem("lecta:active-book")).toBeNull();
  });

  it("limpia el estado de libro activo correctamente con clearActiveBookState", () => {
    sessionStorage.setItem("activeBook", "test");
    clearActiveBookState();
    expect(sessionStorage.getItem("activeBook")).toBeNull();
  });

  it("sanitiza la URL al guardar el error recortando query params y hash para no filtrar tokens", () => {
    const originalHref = window.location.href;
    try {
      window.history.pushState({}, "", "/reader?token=secret-token-123#frag");
      logErrorToStorage(new Error("Error con token en url"));
      const logs = getStoredErrorLogs();
      const last = logs[logs.length - 1];
      expect(last.url).not.toContain("token=secret-token-123");
      expect(last.url).not.toContain("#frag");
      expect(last.url).not.toContain(window.location.origin);
      expect(last.url).toBe("/reader");
    } finally {
      window.history.pushState({}, "", originalHref);
    }
  });

  it("renderiza el fallback personalizado si se proporciona", () => {
    render(
      h(
        ErrorBoundary,
        { fallback: h("div", { className: "custom-fallback" }, "Fallback custom") },
        h(Bomb, { shouldThrow: true }),
      ),
    );

    expect(host.querySelector(".custom-fallback")?.textContent).toBe("Fallback custom");
    expect(host.querySelector(".error-boundary-screen")).toBeNull();
  });
});
