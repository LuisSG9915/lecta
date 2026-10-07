import { describe, expect, it, vi } from "vitest";
import { catalog } from "./catalog";

// El índice se cachea en memoria del isolate ~5 min: las pruebas que
// dependen de una lectura fría reimportan el módulo limpio.
async function freshCatalog() {
  vi.resetModules();
  return (await import("./catalog")).catalog;
}

// Bucket R2 falso: un Map clave→contenido con la forma que el endpoint
// usa (`body` para streams de archivo, `text()` para el índice). Lo
// que importa es el contrato HTTP y qué clave se pide — nunca R2 real.
function fakeBucket(objects: Record<string, string>) {
  const gets: string[] = [];
  return {
    gets,
    bucket: {
      async get(key: string) {
        gets.push(key);
        const body = objects[key];
        if (body == null) return null;
        return {
          body,
          text: async () => body,
        };
      },
    },
  };
}

const env = (objects: Record<string, string>) => {
  const fake = fakeBucket(objects);
  return { fake, env: { BOOKS: fake.bucket } };
};

const INDEX = JSON.stringify({
  bookCount: 1,
  books: [{ id: "quijote", title: "Don Quijote", author: "Cervantes" }],
});

const get = (env: unknown, path: string, app = catalog) =>
  app.fetch(new Request(`https://t${path}`), env as never);

describe("GET /api/catalog", () => {
  it("sirve el índice con JSON y cache-control corto", async () => {
    const { env: e } = env({ "catalog/index.json": INDEX });
    const res = await get(e, "/api/catalog");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toContain("public");
    const body = (await res.json()) as { bookCount: number; books: { id: string }[] };
    expect(body.bookCount).toBe(1);
    expect(body.books[0].id).toBe("quijote");
  });

  it("cachea el índice en el isolate: dos lecturas, una ida a R2", async () => {
    const app = await freshCatalog();
    const { env: e, fake } = env({ "catalog/index.json": INDEX });
    await get(e, "/api/catalog", app);
    await get(e, "/api/catalog", app);
    expect(fake.gets).toEqual(["catalog/index.json"]);
  });

  it("404 cuando el índice no existe en el bucket", async () => {
    const app = await freshCatalog();
    const res = await get(env({}).env, "/api/catalog", app);
    expect(res.status).toBe(404);
  });

  it("503 sin binding", async () => {
    const res = await get({}, "/api/catalog");
    expect(res.status).toBe(503);
  });
});

describe("GET /api/catalog/:id/:kind", () => {
  it("sirve el epub con tipo e inmutabilidad", async () => {
    const { env: e, fake } = env({ "catalog/quijote.epub": "PKFAKE" });
    const res = await get(e, "/api/catalog/quijote/epub");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("PKFAKE");
    expect(fake.gets).toEqual(["catalog/quijote.epub"]);
  });

  it("sirve el manifiesto de vocabulario", async () => {
    const { env: e } = env({ "catalog/quijote.vocab.json": '{"forms":[]}' });
    const res = await get(e, "/api/catalog/quijote/vocab");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("sirve la portada como jpeg", async () => {
    const { env: e } = env({ "catalog/quijote.cover.jpg": "JPEG" });
    const res = await get(e, "/api/catalog/quijote/cover");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("404 limpio cuando el objeto no existe", async () => {
    const { env: e } = env({});
    const res = await get(e, "/api/catalog/quijote/cover");
    expect(res.status).toBe(404);
  });

  it("404 en kind desconocido (no consulta el bucket)", async () => {
    const { env: e, fake } = env({});
    const res = await get(e, "/api/catalog/quijote/manifesto");
    expect(res.status).toBe(404);
    expect(fake.gets).toEqual([]);
  });

  it("400 en id que rompe el patrón (nada de path traversal)", async () => {
    const { env: e, fake } = env({});
    // Un solo segmento pero fuera del patrón → el handler responde 400.
    for (const bad of ["a_b", "ABC123", "x y", "a".repeat(65), "quijote!"]) {
      const res = await get(e, `/api/catalog/${encodeURIComponent(bad)}/epub`);
      expect(res.status, bad).toBe(400);
    }
    // Un id que al decodificarse rompe el segmento ni siquiera llega a
    // la ruta: 404 del router. En ambos casos el bucket no se toca.
    const traversal = await get(e, "/api/catalog/..%2Fadmin/epub");
    expect(traversal.status).not.toBe(200);
    expect(fake.gets).toEqual([]);
  });

  it("503 sin binding", async () => {
    const res = await get({}, "/api/catalog/quijote/epub");
    expect(res.status).toBe(503);
  });
});
