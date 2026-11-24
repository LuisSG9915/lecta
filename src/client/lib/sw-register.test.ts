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

  it("no recarga la primera vez que un service worker toma el control", async () => {
    // Primera visita: no había controlador, el SW se instala y llama a
    // clients.claim(). Recargar aquí no actualiza nada y sí interrumpe la
    // importación o la sección que se acaba de abrir.
    const onReload = vi.fn();
    await registerServiceWorker({ onReload });

    mockContainer.dispatchEvent(new Event("controllerchange"));

    expect(onReload).not.toHaveBeenCalled();
  });

  it("invoca el callback de recarga una única vez al dispararse controllerchange", async () => {
    const onReload = vi.fn();
    // Página ya controlada: aquí sí hay una versión nueva que aplicar.
    mockContainer.controller = new MockServiceWorker();
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

  it("recarga ante LECTA_NAV_STALE dentro de la ventana inicial de la sesión", async () => {
    const onReload = vi.fn();
    await registerServiceWorker({ onReload });

    mockContainer.dispatchEvent(
      new MessageEvent("message", { data: { type: "LECTA_NAV_STALE" } }),
    );

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("ignora LECTA_NAV_STALE si la página ya lleva más de 45s cargada", async () => {
    const onReload = vi.fn();
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(60_000);
    try {
      await registerServiceWorker({ onReload });

      mockContainer.dispatchEvent(
        new MessageEvent("message", { data: { type: "LECTA_NAV_STALE" } }),
      );

      expect(onReload).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("aplica debounce a recargas consecutivas por LECTA_NAV_STALE", async () => {
    const onReload = vi.fn();
    await registerServiceWorker({ onReload });

    const message = () =>
      mockContainer.dispatchEvent(
        new MessageEvent("message", { data: { type: "LECTA_NAV_STALE" } }),
      );
    message();
    message();

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

    it("la lista blanca del SW protege las cachés de los modelos de voz (Piper y Kitten)", async () => {
      // Sin esto el activate borra el modelo (~63 MB) en cada deploy y la voz
      // neural cae en silencio a la del sistema.
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const { PIPER_CACHE_NAME } = await import("./piperModel");
      const { KITTEN_CACHE_NAME } = await import("./kittenModel");
      const swCode = await fs.readFile(path.resolve(process.cwd(), "public/sw.js"), "utf-8");
      const block = swCode.slice(
        swCode.indexOf("const PERSISTENT_DLC_CACHES = new Set(["),
        swCode.indexOf("]);", swCode.indexOf("const PERSISTENT_DLC_CACHES")),
      );
      expect(block).toContain(`'${PIPER_CACHE_NAME}'`);
      expect(block).toContain("KITTEN_TTS_CACHE");
      expect(KITTEN_CACHE_NAME).toBe("lecta-kitten-tts-v2");
    });
  });
});

describe("precaché del install en public/sw.js", () => {
  // El install se ejecuta con el SW viejo aún activo: sus fetch los
  // intercepta el manejador del viejo. Para "/" e "/index.html" ese
  // manejador puede responder con su copia cacheada del deploy anterior
  // (fallback de red lenta) — y ese HTML viejo quedaba precacheado en la
  // nueva versión de forma permanente. La app se quedaba pegada a la
  // versión anterior hasta borrar el caché del navegador.
  it("guarda el shell FRESCO aunque el SW viejo sirva '/' e '/index.html' desde su caché", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const vm = await import("node:vm");
    const swPath = path.resolve(process.cwd(), "public/sw.js");
    const swCode = await fs.readFile(swPath, "utf-8");

    type Listener = (event: { waitUntil: (p: Promise<unknown>) => void }) => void;
    const listeners: Record<string, Listener[]> = {};
    const stores = new Map<string, Map<string, Response>>();
    const urlOf = (req: string | Request) =>
      typeof req === "string" ? new URL(req, "https://app.test").href : req.url;

    const OLD_HTML = "<html><body>shell VIEJO /assets/app-OLD.js</body></html>";
    const NEW_HTML = "<html><body>shell NUEVO /assets/app-NEW.js</body></html>";
    const requested: string[] = [];

    // Simula la red vista a través del SW viejo: "/" e "/index.html" salen
    // de su caché (shell viejo); cualquier ruta desconocida cae a la red,
    // donde el fallback SPA del servidor devuelve el shell del deploy
    // vigente.
    const mockFetch = vi.fn(async (req: Request) => {
      const u = new URL(req.url);
      requested.push(u.pathname);
      if (u.pathname === "/sw-manifest.json") {
        return new Response(
          JSON.stringify({ version: "vNEW", assets: ["/assets/app-NEW.js"] }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (u.pathname === "/" || u.pathname === "/index.html") {
        return new Response(OLD_HTML, { headers: { "content-type": "text/html" } });
      }
      if (u.pathname === "/__lecta_shell__") {
        return new Response(NEW_HTML, { headers: { "content-type": "text/html" } });
      }
      if (u.pathname === "/assets/app-NEW.js") {
        return new Response("console.log('nuevo')", {
          headers: { "content-type": "text/javascript" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const cacheApi = (name: string) => ({
      add: vi.fn(async (req: string | Request) => {
        const res = await mockFetch(new Request(urlOf(req)));
        stores.get(name)!.set(urlOf(req), res);
      }),
      put: vi.fn(async (req: string | Request, res: Response) => {
        stores.get(name)!.set(urlOf(req), res);
      }),
      match: vi.fn(async (req: string | Request) => stores.get(name)!.get(urlOf(req))),
      delete: vi.fn(async (req: string | Request) => stores.get(name)!.delete(urlOf(req))),
    });

    const cachesMock = {
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        return cacheApi(name);
      },
      match: async (req: string | Request) => {
        for (const m of stores.values()) {
          const hit = m.get(urlOf(req));
          if (hit) return hit;
        }
        return undefined;
      },
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    };

    const selfMock = {
      location: { origin: "https://app.test" },
      addEventListener: (type: string, fn: Listener) => {
        (listeners[type] ||= []).push(fn);
      },
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []) },
      registration: {},
      navigator: {},
    };

    const sandbox = {
      self: selfMock,
      caches: cachesMock,
      fetch: mockFetch,
      Request,
      Response,
      URL,
      Promise,
      console,
      Date,
      setTimeout,
      clearTimeout,
    };
    vm.createContext(sandbox);
    vm.runInContext(swCode, sandbox);

    let installPromise: Promise<unknown> | undefined;
    for (const fn of listeners["install"] ?? []) {
      fn({
        waitUntil: (p: Promise<unknown>) => {
          installPromise = p;
        },
      });
    }
    await installPromise;

    const newCache = stores.get("lecta-v2-vNEW");
    expect(newCache).toBeDefined();

    const indexRes = newCache!.get("https://app.test/index.html");
    const rootRes = newCache!.get("https://app.test/");
    expect(indexRes).toBeDefined();
    expect(rootRes).toBeDefined();
    expect(await indexRes!.text()).toBe(NEW_HTML);
    expect(await rootRes!.text()).toBe(NEW_HTML);
    expect(newCache!.get("https://app.test/assets/app-NEW.js")).toBeDefined();

    // El install nunca pide las rutas que el SW viejo puede responder con
    // el shell del deploy anterior.
    expect(requested.filter((p) => p === "/" || p === "/index.html")).toEqual([]);
  });
});
