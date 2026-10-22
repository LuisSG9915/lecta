// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KITTEN_MODEL_FALLBACK_URLS,
  KITTEN_MODEL_URL,
  getKittenModelBuffer,
  kittenTtsEngine,
} from "./kittenTtsEngine";

describe("KittenTTS Network, Cache & Storage Isolation (Fase 3)", () => {
  let fakeCacheStorage: Map<string, Response>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fakeCacheStorage = new Map<string, Response>();

    const fakeCache = {
      match: vi.fn(async (key: string | Request) => {
        const url = typeof key === "string" ? key : key.url;
        return fakeCacheStorage.get(url) || null;
      }),
      put: vi.fn(async (key: string | Request, response: Response) => {
        const url = typeof key === "string" ? key : key.url;
        fakeCacheStorage.set(url, response);
      }),
      delete: vi.fn(async (key: string | Request) => {
        const url = typeof key === "string" ? key : key.url;
        return fakeCacheStorage.delete(url);
      }),
    };

    const cachesMock = {
      open: vi.fn(async () => fakeCache),
      match: vi.fn(async (req: string | Request) => fakeCache.match(req)),
      delete: vi.fn(async () => true),
    };

    vi.stubGlobal("caches", cachesMock);
  });

  describe("downloadModelWithProgress anti-corruption", () => {
    it("rechaza respuestas HTTP 206 Partial Content para no guardar modelos incompletos", async () => {
      const partialResponse = new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        statusText: "Partial Content",
        headers: { "Content-Type": "application/octet-stream" },
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(partialResponse));

      await expect(
        kittenTtsEngine.downloadModelWithProgress(undefined, KITTEN_MODEL_URL),
      ).rejects.toThrow(/206/);

      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(false);
    });

    it("rechaza respuestas con Content-Type text/html (SPA fallback en 404)", async () => {
      const htmlFallbackResponse = new Response("<!DOCTYPE html><html><body>404</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlFallbackResponse));

      await expect(
        kittenTtsEngine.downloadModelWithProgress(undefined, KITTEN_MODEL_URL),
      ).rejects.toThrow();

      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(false);
    });

    it("rechaza y no cachea descargas cortadas o truncadas (< 10 MB)", async () => {
      // Simular un stream truncado de 100 KB
      const smallChunk = new Uint8Array(100 * 1024);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(smallChunk);
          controller.close();
        },
      });

      const truncatedResponse = new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": "24000000",
        },
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(truncatedResponse));

      await expect(
        kittenTtsEngine.downloadModelWithProgress(undefined, KITTEN_MODEL_URL),
      ).rejects.toThrow(/incompleto/);

      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(false);
    });

    it("guarda exitosamente en CacheStorage cuando el archivo es íntegro (>= 10 MB)", async () => {
      const validSize = 12 * 1024 * 1024; // 12 MB
      const bigChunk = new Uint8Array(validSize);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(bigChunk);
          controller.close();
        },
      });

      const validResponse = new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(validSize),
        },
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(validResponse));

      await kittenTtsEngine.downloadModelWithProgress(undefined, KITTEN_MODEL_URL);

      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(true);
      expect(await kittenTtsEngine.isModelDownloaded(KITTEN_MODEL_URL)).toBe(true);
    });

    it("descarga directamente desde el origen primario sin consultar Hugging Face cuando el modelo existe", async () => {
      const validSize = 12 * 1024 * 1024;
      const bigChunk = new Uint8Array(validSize);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(bigChunk);
          controller.close();
        },
      });

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === KITTEN_MODEL_URL) {
          return Promise.resolve(
            new Response(stream, {
              status: 200,
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": String(validSize),
              },
            }),
          );
        }
        return Promise.reject(new Error("Should not be called"));
      });

      vi.stubGlobal("fetch", fetchMock);

      await kittenTtsEngine.downloadModelWithProgress(undefined, KITTEN_MODEL_URL);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(KITTEN_MODEL_URL);
      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(true);
    });

    it("hace fallback automático al repositorio oficial en Hugging Face si modelUrl da 404", async () => {
      const validSize = 12 * 1024 * 1024;
      const bigChunk = new Uint8Array(validSize);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(bigChunk);
          controller.close();
        },
      });

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/models/")) {
          return Promise.resolve(new Response("404 Not Found", { status: 404 }));
        }
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(validSize),
            },
          }),
        );
      });

      vi.stubGlobal("fetch", fetchMock);

      await kittenTtsEngine.downloadModelWithProgress(undefined, KITTEN_MODEL_URL);
      expect(fetchMock).toHaveBeenCalledWith(KITTEN_MODEL_URL);
      expect(fetchMock).toHaveBeenCalledWith(KITTEN_MODEL_FALLBACK_URLS[0]);
      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(true);
    });
  });

  describe("getKittenModelBuffer & isModelDownloaded validation", () => {
    it("purga de CacheStorage buffers cacheados truncados o corruptos (< 10 MB)", async () => {
      // Poner en caché un archivo corrupto de 500 bytes
      const corruptData = new Uint8Array(500);
      fakeCacheStorage.set(
        KITTEN_MODEL_URL,
        new Response(corruptData, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream", "Content-Length": "500" },
        }),
      );

      const buffer = await getKittenModelBuffer(KITTEN_MODEL_URL);
      expect(buffer).toBeNull();
      // Debe haber sido purgado del caché
      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(false);
    });

    it("isModelDownloaded devuelve false si el archivo cacheado tiene estado 206 o es HTML", async () => {
      // 1. Caso 206 Partial Content en caché
      fakeCacheStorage.set(
        KITTEN_MODEL_URL,
        new Response(new Uint8Array(100), {
          status: 206,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
      expect(await kittenTtsEngine.isModelDownloaded(KITTEN_MODEL_URL)).toBe(false);

      // 2. Caso SPA HTML fallback en caché
      fakeCacheStorage.set(
        KITTEN_MODEL_URL,
        new Response("<!DOCTYPE html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      );
      expect(await kittenTtsEngine.isModelDownloaded(KITTEN_MODEL_URL)).toBe(false);
    });
  });
});
