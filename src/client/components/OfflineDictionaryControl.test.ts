// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock de offline-dictionary
vi.mock("../lib/offline-dictionary", () => ({
  getBookDictionaryStatus: vi.fn(),
  precacheBookDictionary: vi.fn(),
  isAutoPrecacheEnabled: vi.fn(() => true),
  setAutoPrecacheEnabled: vi.fn(),
}));

import OfflineDictionaryControl from "./OfflineDictionaryControl";
import {
  getBookDictionaryStatus,
  precacheBookDictionary,
  isAutoPrecacheEnabled,
  setAutoPrecacheEnabled,
} from "../lib/offline-dictionary";

// @ts-expect-error test act environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OfflineDictionaryControl", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAutoPrecacheEnabled).mockReturnValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("muestra el estado inicial cuando aún no hay palabras en caché", async () => {
    vi.mocked(getBookDictionaryStatus).mockResolvedValueOnce({
      total: 150,
      cached: 0,
      percent: 0,
    });

    await act(async () => {
      root.render(
        h(OfflineDictionaryControl, {
          bookHash: "hash-123",
          language: "es",
        }),
      );
    });

    expect(host.textContent).toContain("Guardar diccionario de este libro");
    expect(host.textContent).toContain("Pre-cargar próximos capítulos automáticamente");
  });

  it("muestra 'Vocabulario listo sin conexión' con rango de capítulos cuando hay palabras parciales", async () => {
    vi.mocked(getBookDictionaryStatus).mockResolvedValueOnce({
      total: 100,
      cached: 40,
      percent: 40,
    });

    await act(async () => {
      root.render(
        h(OfflineDictionaryControl, {
          bookHash: "hash-123",
          language: "en",
          currentChapterIndex: 1, // Cap 2
          totalChapters: 8,
        }),
      );
    });

    expect(host.textContent).toContain("Vocabulario listo sin conexión (Capítulos 1–4)");
    expect(host.textContent).toContain("Guardar libro entero para viaje");
  });

  it("permite guardar el libro entero para viaje en 1 clic", async () => {
    vi.mocked(getBookDictionaryStatus)
      .mockResolvedValueOnce({
        total: 100,
        cached: 40,
        percent: 40,
      })
      .mockResolvedValueOnce({
        total: 100,
        cached: 100,
        percent: 100,
      });

    vi.mocked(precacheBookDictionary).mockResolvedValueOnce({
      total: 100,
      cached: 100,
    });

    await act(async () => {
      root.render(
        h(OfflineDictionaryControl, {
          bookHash: "hash-123",
          language: "en",
        }),
      );
    });

    const button = host.querySelector<HTMLButtonElement>("button.btn--quiet");
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("Guardar libro entero para viaje");

    await act(async () => {
      button?.click();
    });

    expect(precacheBookDictionary).toHaveBeenCalledWith(
      "hash-123",
      expect.any(Function),
      expect.anything(),
    );

    expect(host.textContent).toContain("Diccionario completo guardado (100 palabras en memoria local)");
  });

  it("permite alternar la pre-carga automática para ahorrar batería/datos", async () => {
    vi.mocked(getBookDictionaryStatus).mockResolvedValueOnce({
      total: 50,
      cached: 0,
      percent: 0,
    });

    await act(async () => {
      root.render(
        h(OfflineDictionaryControl, {
          bookHash: "hash-123",
        }),
      );
    });

    const checkbox = host.querySelector<HTMLInputElement>(
      "input[type='checkbox']",
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(true);

    await act(async () => {
      checkbox?.click();
    });

    expect(setAutoPrecacheEnabled).toHaveBeenCalledWith(false);
  });
});
