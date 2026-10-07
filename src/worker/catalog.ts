import { Hono } from "hono";
import type { WorkerEnv } from "./db";
import { createTtlCache } from "./ai";

// Catálogo público de Lecta: clásicos en dominio público servidos desde
// el bucket compartido bajo el prefijo `catalog/` (nada que ver con
// `books/{userId}/`, que es privado y se purga al borrar la cuenta).
//
//   GET /api/catalog          → índice curado (index.json)
//   GET /api/catalog/:id/epub → el EPUB completo, inmutable
//   GET /api/catalog/:id/vocab→ manifiesto de vocabulario precomputado
//   GET /api/catalog/:id/cover→ portada JPG (404 si el título no tiene)
//
// Sin sesión: es contenido de lectura compartido, no datos del usuario.
// El índice se cachea en el isolate ~5 min para no pegarle a R2 en cada
// apertura de la estantería; los objetos del catálogo son inmutables —
// un libro nuevo estrena id, nunca se sobrescribe el mismo.
export const catalog = new Hono<{ Bindings: WorkerEnv }>();

// Solo minúsculas, dígitos y guiones: los ids salen de la curación y
// sirven como llave R2 — el patrón impide path traversal a otros
// prefijos del bucket.
const CATALOG_ID = /^[a-z0-9-]{1,64}$/;
const INDEX_KEY = "catalog/index.json";
const IMMUTABLE = "public, max-age=31536000, immutable";
const INDEX_CACHE_CONTROL = "public, max-age=300";

// Índice en memoria del isolate (~5 min): es un JSON compartido que
// solo cambia al resembrar el catálogo — el TTL basta para no pegarle
// a R2 en cada apertura de la estantería.
const indexCache = createTtlCache<string>({ maxEntries: 1, ttlMs: 5 * 60_000 });
const INDEX_CACHE_KEY = "catalog-index";

const key = (id: string, suffix: string) => `catalog/${id}.${suffix}`;

catalog.get("/api/catalog", async (context) => {
  const bucket = context.env.BOOKS;
  if (!bucket) {
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  }

  const cached = indexCache.get(INDEX_CACHE_KEY);
  if (cached != null) {
    return new Response(cached, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": INDEX_CACHE_CONTROL,
      },
    });
  }

  const object = await bucket.get(INDEX_KEY);
  if (!object) {
    return context.json({ error: "El catálogo no está disponible." }, 404);
  }
  const body = await object.text();
  indexCache.set(INDEX_CACHE_KEY, body);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": INDEX_CACHE_CONTROL,
    },
  });
});

// Las tres rutas de objeto comparten validación y 404 limpio.
catalog.get("/api/catalog/:id/:kind", async (context) => {
  const bucket = context.env.BOOKS;
  if (!bucket) {
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  }
  const id = context.req.param("id");
  const kind = context.req.param("kind");
  if (!CATALOG_ID.test(id)) {
    return context.json({ error: "Identificador inválido." }, 400);
  }
  const file =
    kind === "epub"
      ? { key: key(id, "epub"), type: "application/epub+zip" }
      : kind === "vocab"
        ? { key: key(id, "vocab.json"), type: "application/json; charset=utf-8" }
        : kind === "cover"
          ? { key: key(id, "cover.jpg"), type: "image/jpeg" }
          : null;
  if (!file) {
    return context.json({ error: "Recurso desconocido." }, 404);
  }

  const object = await bucket.get(file.key);
  if (!object) {
    return context.json({ error: "No encontrado." }, 404);
  }
  return new Response(object.body, {
    headers: { "content-type": file.type, "cache-control": IMMUTABLE },
  });
});
