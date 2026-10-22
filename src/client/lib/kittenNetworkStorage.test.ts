// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KITTEN_CACHE_NAME,
  KITTEN_MODEL_SHA256,
  KITTEN_MODEL_URL,
  getKittenModelBuffer,
  kittenTtsEngine,
} from "./kittenTtsEngine";

const MODEL_BYTES = 12 * 1024 * 1024; // > 10 MB, el mínimo anti-truncamiento

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function streamOf(bytes: Uint8Array) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function modelResponse(bytes: Uint8Array, overrides: Record<string, string> = {}) {
  return new Response(streamOf(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      ...overrides,
    },
  });
}

describe("KittenTTS Network, Cache & Storage Isolation (Fase 2)", () => {
  let fakeCacheStorage: Map<string, Response>;

  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom no implementa SubtleCrypto; el motor hashea con crypto.subtle.
    vi.stubGlobal("crypto", webcrypto);
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
      const truncatedResponse = new Response(streamOf(new Uint8Array(100 * 1024)), {
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

    it("guarda en caché el modelo íntegro y sella el hash verificado en la respuesta", async () => {
      const bytes = new Uint8Array(MODEL_BYTES);
      const digest = sha256Hex(bytes);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelResponse(bytes)));

      await kittenTtsEngine.downloadModelWithProgress(undefined, KITTEN_MODEL_URL, digest);

      const cached = fakeCacheStorage.get(KITTEN_MODEL_URL);
      expect(cached).toBeDefined();
      expect(cached?.headers.get("x-model-sha256")).toBe(digest);
      expect(await kittenTtsEngine.isModelDownloaded(KITTEN_MODEL_URL, digest)).toBe(true);
    });

    it("no cachea nada si el SHA-256 no coincide con el esperado", async () => {
      const bytes = new Uint8Array(MODEL_BYTES);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelResponse(bytes)));

      await expect(
        kittenTtsEngine.downloadModelWithProgress(
          undefined,
          KITTEN_MODEL_URL,
          "0".repeat(64),
        ),
      ).rejects.toThrow(/Integridad del modelo inválida/);

      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(false);
      expect(await kittenTtsEngine.isModelDownloaded(KITTEN_MODEL_URL, "0".repeat(64))).toBe(false);
    });

    it("no cae a Hugging Face: un 404 del binario versionado es un error de despliegue", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response("404 Not Found", { status: 404 }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        kittenTtsEngine.downloadModelWithProgress(undefined, KITTEN_MODEL_URL),
      ).rejects.toThrow(/404/);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(KITTEN_MODEL_URL);
      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(false);
    });

    it("usa la caché versionada y no consulta la red si el modelo ya está descargado", async () => {
      const bytes = new Uint8Array(MODEL_BYTES);
      const digest = sha256Hex(bytes);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelResponse(bytes)));
      await kittenTtsEngine.downloadModelWithProgress(undefined, KITTEN_MODEL_URL, digest);

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await kittenTtsEngine.downloadModelWithProgress(undefined, KITTEN_MODEL_URL, digest);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(KITTEN_CACHE_NAME).toBe("lecta-kitten-tts-v2");
      expect(KITTEN_MODEL_SHA256).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("getKittenModelBuffer & isModelDownloaded validation", () => {
    it("purga de CacheStorage buffers cacheados truncados o corruptos (< 10 MB)", async () => {
      fakeCacheStorage.set(
        KITTEN_MODEL_URL,
        new Response(new Uint8Array(500), {
          status: 200,
          headers: { "Content-Type": "application/octet-stream", "Content-Length": "500" },
        }),
      );

      const buffer = await getKittenModelBuffer(KITTEN_MODEL_URL, "0".repeat(64));
      expect(buffer).toBeNull();
      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(false);
    });

    it("purga la entrada si el sello de hash no coincide con el esperado", async () => {
      const bytes = new Uint8Array(MODEL_BYTES);
      const digest = sha256Hex(bytes);
      const seed = () =>
        fakeCacheStorage.set(
          KITTEN_MODEL_URL,
          new Response(bytes, {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(bytes.byteLength),
              "x-model-sha256": digest,
            },
          }),
        );

      seed();
      expect(await getKittenModelBuffer(KITTEN_MODEL_URL, "1".repeat(64))).toBeNull();
      expect(fakeCacheStorage.has(KITTEN_MODEL_URL)).toBe(false);

      seed();
      const buffer = await getKittenModelBuffer(KITTEN_MODEL_URL, digest);
      expect(buffer?.byteLength).toBe(MODEL_BYTES);
    });

    it("isModelDownloaded devuelve false si el archivo cacheado tiene estado 206 o es HTML", async () => {
      fakeCacheStorage.set(
        KITTEN_MODEL_URL,
        new Response(new Uint8Array(100), {
          status: 206,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
      expect(await kittenTtsEngine.isModelDownloaded(KITTEN_MODEL_URL)).toBe(false);

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
