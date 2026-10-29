// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiagnosticsModal from "./DiagnosticsModal";
import { deleteLocalDb } from "../lib/idb";
import { APP_VERSION } from "../../shared/app-version";

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    expect(host.textContent).toContain(`Lecta v${APP_VERSION}`);
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
    expect(copiedJson.version).toBe(APP_VERSION);
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

  it("muestra el agregado del servidor cuando el dueño tiene acceso", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            days: 7,
            rows: [
              {
                signature: "abcd1234ef567890",
                day: "2026-10-29",
                route: "/reader/*",
                name: "TypeError",
                code: "window.error",
                version: "prod",
                hits: 12,
                sampleFrames: "index-ABC.js:1:234",
                lastMessage: null,
                firstSeen: "2026-10-29T10:00:00Z",
                lastSeen: "2026-10-29T12:00:00Z",
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(h(DiagnosticsModal, { onClose: vi.fn() }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/error-reports?days=7",
      expect.anything(),
    );
    expect(host.textContent).toContain("Salud de la aplicación (servidor)");
    expect(host.textContent).toContain("12× TypeError en /reader/*");
    expect(host.textContent).toContain("abcd1234ef567890");
    expect(host.textContent).toContain("index-ABC.js:1:234");
  });

  it("dice que el agregado es solo del dueño cuando la ruta responde 404", async () => {
    await act(async () => {
      root.render(h(DiagnosticsModal, { onClose: vi.fn() }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(host.textContent).toContain("Visible solo para la cuenta del dueño.");
  });
});
