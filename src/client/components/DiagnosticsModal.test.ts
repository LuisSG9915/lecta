// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiagnosticsModal from "./DiagnosticsModal";
import { deleteLocalDb } from "../lib/idb";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...actual,
    captureDbScope: vi.fn(() => ({ userId: null, generation: 0 })),
    deleteLocalDb: vi.fn(async () => true),
    listStoredBooks: vi.fn(async () => [{ hash: "b1" }]),
    listSavedWords: vi.fn(async () => [{ key: "w1" }, { key: "w2" }]),
    listPositions: vi.fn(async () => []),
    listAnnotations: vi.fn(async () => []),
    listIntervals: vi.fn(async () => []),
  };
});

describe("DiagnosticsModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    localStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("renderiza el modal con versión, datos de almacenamiento y colecciones", async () => {
    localStorage.setItem(
      "lecta_error_log_v1",
      JSON.stringify([
        { message: "Prueba de error", timestamp: Date.now(), url: "http://localhost" },
      ]),
    );

    await act(async () => {
      root.render(h(DiagnosticsModal, { onClose: vi.fn() }));
    });
    // Flush promises
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(host.textContent).toContain("Acerca de y Diagnóstico");
    expect(host.textContent).toContain("Lecta v0.1.0");
    expect(host.textContent).toContain("Libros en dispositivo: 1");
    expect(host.textContent).toContain("Palabras en cuaderno: 2");
    expect(host.textContent).toContain("Registro de errores recientes (1)");
    expect(host.textContent).toContain("Prueba de error");
  });

  it("permite copiar el reporte de diagnóstico al portapapeles", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    await act(async () => {
      root.render(h(DiagnosticsModal, { onClose: vi.fn() }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const copyBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Copiar reporte de diagnóstico"),
    );
    expect(copyBtn).toBeTruthy();

    await act(async () => {
      copyBtn!.click();
    });

    expect(writeText).toHaveBeenCalled();
    const copiedJson = JSON.parse(writeText.mock.calls[0][0]);
    expect(copiedJson.app).toBe("Lecta");
    expect(copiedJson.version).toBe("0.1.0");
    expect(copiedJson.collections.books).toBe(1);
    expect(copiedJson.collections.words).toBe(2);
  });

  it("borra los datos locales solo tras confirmar", async () => {
    await act(async () => {
      root.render(h(DiagnosticsModal, { onClose: vi.fn() }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const wipe = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Borrar datos locales de este dispositivo"),
    );
    expect(wipe).toBeTruthy();

    await act(async () => wipe!.click());
    expect(deleteLocalDb).not.toHaveBeenCalled();
    expect(wipe?.textContent).toContain("Confirmar borrado local");

    await act(async () => wipe!.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(deleteLocalDb).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Datos locales borrados");
  });

  it("muestra y permite conmutar los interruptores de función (kill-switches)", async () => {
    await act(async () => {
      root.render(h(DiagnosticsModal, { onClose: vi.fn() }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(host.textContent).toContain("Interruptores de función (kill-switches locales)");
    expect(host.textContent).toContain("Voz Neural HD Offline");
    expect(host.textContent).toContain("Minijuegos del Cuaderno");

    const ttsToggle = Array.from(host.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(ttsToggle).toBeTruthy();
    expect(ttsToggle?.textContent).toBe("Activo");

    await act(async () => {
      ttsToggle?.click();
    });

    expect(ttsToggle?.textContent).toBe("Desactivado");
    expect(ttsToggle?.getAttribute("aria-pressed")).toBe("false");
  });
});
