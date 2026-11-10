import { beforeEach, describe, expect, it } from "vitest";
import type { R2Bucket } from "@cloudflare/workers-types";
import {
  KINDLE_CHAPTER_CACHE_V,
  getCachedChapter,
  getCachedResource,
  purgeKindleBookCache,
  putCachedChapter,
  putCachedResource,
  resetKindleCacheMemory,
} from "./cache";

type Stored = { bytes: Uint8Array; httpMetadata?: { contentType?: string; contentEncoding?: string } };

// Bucket en memoria con lo justo de la API de R2 que usa el caché.
function fakeBucket() {
  const store = new Map<string, Stored>();
  const bucket = {
    async get(key: string) {
      const hit = store.get(key);
      if (!hit) return null;
      return {
        httpMetadata: hit.httpMetadata,
        arrayBuffer: async () => hit.bytes.slice().buffer,
        text: async () => new TextDecoder().decode(hit.bytes),
      };
    },
    async put(key: string, data: Uint8Array | ArrayBuffer, opts?: { httpMetadata?: Stored["httpMetadata"] }) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      store.set(key, { bytes, httpMetadata: opts?.httpMetadata });
    },
    async list({ prefix }: { prefix: string }) {
      const objects = [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key }));
      return { objects, truncated: false };
    },
    async delete(keys: string[]) {
      for (const k of keys) store.delete(k);
    },
  };
  return { store, bucket: bucket as unknown as R2Bucket };
}

const CHAPTER = {
  bookTitle: "Pedro Páramo",
  bookAuthor: "Juan Rulfo",
  chapterTitle: "Uno",
  contentHtml: "<p>Vine a Comala porque me dijeron que acá vivía mi padre.</p>",
  sectionIndex: 3,
  totalSections: 12,
};

describe("caché de capítulos Kindle", () => {
  beforeEach(() => resetKindleCacheMemory());

  it("sin bucket no guarda ni lee", async () => {
    await putCachedChapter(undefined, "h1", CHAPTER);
    expect(await getCachedChapter(undefined, "h1", 3)).toBeNull();
  });

  it("guarda el capítulo comprimido en R2 y lo recupera sin la memoria del isolate", async () => {
    const { store, bucket } = fakeBucket();
    await putCachedChapter(bucket, "h1", CHAPTER);

    const stored = store.get("kcache/ch/h1/3.json");
    expect(stored?.httpMetadata?.contentEncoding).toBe("gzip");
    // Cabecera gzip: el JSON no viaja en claro.
    expect([stored?.bytes[0], stored?.bytes[1]]).toEqual([0x1f, 0x8b]);

    resetKindleCacheMemory();
    expect(await getCachedChapter(bucket, "h1", 3)).toEqual({ v: KINDLE_CHAPTER_CACHE_V, ...CHAPTER });
  });

  it("una entrada de otra versión de algoritmo lee miss", async () => {
    const { bucket } = fakeBucket();
    const old = JSON.stringify({ ...CHAPTER, v: KINDLE_CHAPTER_CACHE_V - 1 });
    await bucket.put("kcache/ch/h1/3.json", new TextEncoder().encode(old));
    expect(await getCachedChapter(bucket, "h1", 3)).toBeNull();
  });

  it("un objeto corrupto lee miss en vez de romper la lectura", async () => {
    const { bucket } = fakeBucket();
    await bucket.put("kcache/ch/h1/3.json", new TextEncoder().encode("no es json"));
    expect(await getCachedChapter(bucket, "h1", 3)).toBeNull();
  });
});

describe("caché de recursos Kindle", () => {
  it("guarda y devuelve el recurso con su tipo", async () => {
    const { bucket } = fakeBucket();
    await putCachedResource(bucket, "h1", "/OEBPS/img/portada.png", new Uint8Array([1, 2, 3]), "image/png");
    const hit = await getCachedResource(bucket, "h1", "OEBPS/img/portada.png");
    expect(hit?.contentType).toBe("image/png");
    expect([...new Uint8Array(hit!.body)]).toEqual([1, 2, 3]);
  });

  it("rechaza rutas que salen del libro", async () => {
    const { store, bucket } = fakeBucket();
    await putCachedResource(bucket, "h1", "../otro/secreto.png", new Uint8Array([1]), "image/png");
    expect(store.size).toBe(0);
    expect(await getCachedResource(bucket, "h1", "../otro/secreto.png")).toBeNull();
  });
});

describe("purgeKindleBookCache", () => {
  beforeEach(() => resetKindleCacheMemory());

  it("borra capítulos y recursos del libro, en R2 y en memoria, sin tocar otros libros", async () => {
    const { store, bucket } = fakeBucket();
    await putCachedChapter(bucket, "h1", CHAPTER);
    await putCachedResource(bucket, "h1", "img/a.png", new Uint8Array([1]), "image/png");
    await putCachedChapter(bucket, "h2", CHAPTER);

    await purgeKindleBookCache(bucket, "h1");

    expect([...store.keys()]).toEqual(["kcache/ch/h2/3.json"]);
    // Tampoco queda en la memoria del isolate.
    expect(await getCachedChapter(bucket, "h1", 3)).toBeNull();
    expect(await getCachedChapter(bucket, "h2", 3)).not.toBeNull();
  });
});
