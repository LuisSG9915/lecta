// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCssGuard, triggerSafeAssetRecovery } from "./css-guard";

describe("css-guard", () => {
  let mockReload: () => void;
  let mockCachesDelete: ReturnType<typeof vi.fn>;
  let mockCachesKeys: ReturnType<typeof vi.fn>;
  let mockUnregister: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    mockReload = vi.fn();

    // Mock caches API
    mockCachesDelete = vi.fn().mockResolvedValue(true);
    mockCachesKeys = vi.fn().mockResolvedValue(["lecta-v2-12345", "lecta-shell"]);
    Object.defineProperty(window, "caches", {
      value: {
        keys: mockCachesKeys,
        delete: mockCachesDelete,
      },
      configurable: true,
      writable: true,
    });

    // Mock service worker getRegistrations
    mockUnregister = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        getRegistrations: vi.fn().mockResolvedValue([{ unregister: mockUnregister }]),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  describe("triggerSafeAssetRecovery", () => {
    it("limpia cachés, desregistra service workers y ejecuta recarga", async () => {
      const recovered = await triggerSafeAssetRecovery({
        onReload: mockReload,
        storage: sessionStorage,
      });

      expect(recovered).toBe(true);
      expect(mockCachesKeys).toHaveBeenCalled();
      expect(mockCachesDelete).toHaveBeenCalledWith("lecta-v2-12345");
      expect(mockCachesDelete).toHaveBeenCalledWith("lecta-shell");
      expect(mockUnregister).toHaveBeenCalled();
      expect(mockReload).toHaveBeenCalledTimes(1);
    });

    it("rechaza ejecuciones repetidas dentro de la ventana de 15 segundos (anti-bucle)", async () => {
      const first = await triggerSafeAssetRecovery({
        onReload: mockReload,
        storage: sessionStorage,
      });
      expect(first).toBe(true);
      expect(mockReload).toHaveBeenCalledTimes(1);

      // Segundo intento inmediato dentro del umbral de 15s
      const second = await triggerSafeAssetRecovery({
        onReload: mockReload,
        storage: sessionStorage,
      });
      expect(second).toBe(false);
      expect(mockReload).toHaveBeenCalledTimes(1);
    });

    it("permite una nueva recuperación si transcurrieron más de 15 segundos", async () => {
      sessionStorage.setItem("lecta_css_recovery_ts", String(Date.now() - 16_000));

      const recovered = await triggerSafeAssetRecovery({
        onReload: mockReload,
        storage: sessionStorage,
      });
      expect(recovered).toBe(true);
      expect(mockReload).toHaveBeenCalledTimes(1);
    });
  });

  describe("initCssGuard", () => {
    it("dispara recuperación ante evento 'vite:preloadError' en window", async () => {
      const cleanup = initCssGuard({ onReload: mockReload, storage: sessionStorage });

      const event = new Event("vite:preloadError", { cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      await vi.waitFor(() => {
        expect(mockReload).toHaveBeenCalled();
      });

      cleanup();
    });

    it("dispara recuperación cuando un <link rel='stylesheet'> emite error", async () => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/assets/index-missing.css";
      document.head.appendChild(link);

      const cleanup = initCssGuard({ onReload: mockReload, storage: sessionStorage });

      link.dispatchEvent(new Event("error"));

      await vi.waitFor(() => {
        expect(mockReload).toHaveBeenCalled();
      });

      cleanup();
    });

    it("el cleanup retira los event listeners correctamente", async () => {
      const cleanup = initCssGuard({ onReload: mockReload, storage: sessionStorage });
      cleanup();

      const event = new Event("vite:preloadError", { cancelable: true });
      window.dispatchEvent(event);

      // Dar tiempo para posibles ejecuciones asíncronas
      await new Promise((r) => setTimeout(r, 20));
      expect(mockReload).not.toHaveBeenCalled();
    });
  });
});
