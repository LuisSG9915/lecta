// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerServiceWorker,
  shouldAllowReload,
  PERSISTENT_DLC_CACHE_NAMES,
  isPersistentDlcCache,
} from "./sw-register";

class MockServiceWorker extends EventTarget {
  state: ServiceWorkerState = "installing";
  postMessage = vi.fn();
}

class MockServiceWorkerRegistration extends EventTarget {
  installing: MockServiceWorker | null = null;
  waiting: MockServiceWorker | null = null;
  active: MockServiceWorker | null = null;
  update = vi.fn().mockResolvedValue(undefined);
}

class MockServiceWorkerContainer extends EventTarget {
  controller: MockServiceWorker | null = null;
  register = vi.fn();
}

describe("registerServiceWorker", () => {
  let mockContainer: MockServiceWorkerContainer;
  let mockRegistration: MockServiceWorkerRegistration;
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    mockContainer = new MockServiceWorkerContainer();
    mockRegistration = new MockServiceWorkerRegistration();
    mockContainer.register.mockResolvedValue(mockRegistration);

    Object.defineProperty(navigator, "serviceWorker", {
      value: mockContainer,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
    if (originalVisibilityState) {
      Object.defineProperty(document, "visibilityState", originalVisibilityState);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("registra /sw.js con updateViaCache: 'none' e invoca update() inmediatamente", async () => {
    const reg = await registerServiceWorker();

    expect(reg).toBe(mockRegistration);
    expect(mockContainer.register).toHaveBeenCalledWith("/sw.js", {
      updateViaCache: "none",
    });
    expect(mockRegistration.update).toHaveBeenCalledTimes(1);
  });

  it("invoca registration.update() cuando visibilitychange pasa a 'visible'", async () => {
    await registerServiceWorker();
    expect(mockRegistration.update).toHaveBeenCalledTimes(1);

    // Cambiar a visible
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRegistration.update).toHaveBeenCalledTimes(2);

    // Cambiar a hidden no debe llamar a update()
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRegistration.update).toHaveBeenCalledTimes(2);
  });

  it("invoca registration.update() cuando se dispara el evento 'online' en window", async () => {
    await registerServiceWorker();
    expect(mockRegistration.update).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("online"));
    expect(mockRegistration.update).toHaveBeenCalledTimes(2);
  });

  it("envía postMessage({ type: 'SKIP_WAITING' }) al worker en waiting si existe al registrar", async () => {
    const waitingWorker = new MockServiceWorker();
    mockRegistration.waiting = waitingWorker;

    await registerServiceWorker();

    expect(waitingWorker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("envía postMessage({ type: 'SKIP_WAITING' }) cuando el installing worker pasa a 'installed' y hay un controlador", async () => {
    const installingWorker = new MockServiceWorker();
    mockRegistration.installing = installingWorker;
    mockContainer.controller = new MockServiceWorker();

    await registerServiceWorker();

    // Notificar que hay actualización
    mockRegistration.dispatchEvent(new Event("updatefound"));

    // El worker termina de instalarse
    installingWorker.state = "installed";
    installingWorker.dispatchEvent(new Event("statechange"));

    expect(installingWorker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("invoca el callback de recarga una única vez al dispararse controllerchange", async () => {
    const onReload = vi.fn();
    await registerServiceWorker({ onReload });

    expect(onReload).not.toHaveBeenCalled();

    // Simular múltiples eventos de controllerchange
    mockContainer.dispatchEvent(new Event("controllerchange"));
    mockContainer.dispatchEvent(new Event("controllerchange"));

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("invoca el callback de recarga ante mensaje ASSET_MISMATCH_RELOAD del Service Worker", async () => {
    const onReload = vi.fn();
    await registerServiceWorker({ onReload });

    const messageEvent = new MessageEvent("message", {
      data: { type: "ASSET_MISMATCH_RELOAD" },
    });
    mockContainer.dispatchEvent(messageEvent);

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("previene bucles de recarga con shouldAllowReload dentro de la ventana de 15 segundos", () => {
    const storage = window.sessionStorage;
    const key = "test_reload_key";

    expect(shouldAllowReload(key, storage)).toBe(true);
    // Segundo intento inmediato dentro de los 15s debe ser rechazado
    expect(shouldAllowReload(key, storage)).toBe(false);

    // Tras simular paso del tiempo > 15s
    storage.setItem(key, String(Date.now() - 16_000));
    expect(shouldAllowReload(key, storage)).toBe(true);
  });

  it("devuelve undefined sin lanzar errores si serviceWorker no está soportado", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");

    const result = await registerServiceWorker();
    expect(result).toBeUndefined();
  });

  describe("PERSISTENT_DLC_CACHE_NAMES", () => {
    it("incluye 'lecta-kitten-tts-v2' y 'lecta-offline-dict-v1'", () => {
      expect(PERSISTENT_DLC_CACHE_NAMES).toContain("lecta-kitten-tts-v2");
      expect(PERSISTENT_DLC_CACHE_NAMES).toContain("lecta-offline-dict-v1");
      expect(isPersistentDlcCache("lecta-kitten-tts-v2")).toBe(true);
      expect(isPersistentDlcCache("lecta-offline-dict-v1")).toBe(true);
      expect(isPersistentDlcCache("lecta-v2-shell")).toBe(false);
      expect(isPersistentDlcCache("lecta-v2-123")).toBe(false);
    });

    it("la estrategia de limpieza de cachés preserva siempre lecta-kitten-tts-v2 y lecta-offline-dict-v1", () => {
      const activeKeys = [
        "lecta-v2-10",
        "lecta-v2-11",
        "lecta-kitten-tts-v2",
        "lecta-offline-dict-v1",
        "unrelated-cache",
      ];
      const keep = "lecta-v2-11";
      const persistentSet = new Set<string>(PERSISTENT_DLC_CACHE_NAMES);

      const deleted: string[] = [];
      for (const key of activeKeys) {
        if (
          !persistentSet.has(key) &&
          (key.startsWith("lecta-") || key.startsWith("lecta-v2-")) &&
          (!keep || key !== keep)
        ) {
          deleted.push(key);
        }
      }

      expect(deleted).toEqual(["lecta-v2-10"]);
      expect(deleted).not.toContain("lecta-kitten-tts-v2");
      expect(deleted).not.toContain("lecta-offline-dict-v1");
    });

    it("public/sw.js incluye la protección de PERSISTENT_DLC_CACHES y el atajo para modelos .onnx", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const swPath = path.resolve(process.cwd(), "public/sw.js");
      const swCode = await fs.readFile(swPath, "utf-8");

      expect(swCode).toContain("const KITTEN_TTS_CACHE = 'lecta-kitten-tts-v2';");
      expect(swCode).toContain("const PERSISTENT_DLC_CACHES = new Set([");
      expect(swCode).toContain("KITTEN_TTS_CACHE,");
      expect(swCode).toContain("'lecta-offline-dict-v1',");
      expect(swCode).toContain("!PERSISTENT_DLC_CACHES.has(key)");
      expect(swCode).toContain("isKittenModelRequest(url)");
      expect(swCode).toContain("caches.open(KITTEN_TTS_CACHE)");
    });
  });
});
