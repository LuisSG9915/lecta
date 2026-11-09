// Caché de artefactos Kindle (K4).
//
// El paso de página descargaba el EPUB completo de R2 y re-parseaba el ZIP en
// cada request (también por cada <img>). Este módulo guarda los artefactos
// derivados del CONTENIDO del libro — nada por usuario — en el propio bucket:
//
//   kcache/ch/{hash}/{sección}.json   capítulo parseado+sanitizado (con versión)
//   kcache/res/{hash}/{ruta}          recurso extraído (imagen, css…)
//
// El hash es sha256 del contenido: un libro nuevo/actualizado invalida solo.
// La versión de algoritmo viaja dentro del JSON (campo `v`) para que un cambio
// de pipeline lea «miss» y reescriba, sin dejar claves huérfanas por prefijo.
// Nota de acceso: la clave funciona como capacidad — quien conoce el hash ya
// podía leer el libro; no se guarda nada específico de la cuenta.
//
// Además hay una memoria corta por isolate (Map) para los toques consecutivos
// dentro del mismo capítulo: solo guarda objetos ya parseados, nunca
// conexiones pg ni streams.

import type { R2Bucket } from "@cloudflare/workers-types";

export const KINDLE_CHAPTER_CACHE_V = 2;
export const KINDLE_RESOURCE_CACHE_PREFIX = "kcache/res/";


async function gzipBytes(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const writePromise = writer.write(data as unknown as BufferSource).then(() => writer.close());
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  await writePromise.catch(() => {});
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function gunzipBytes(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  const writePromise = writer.write(data as unknown as BufferSource).then(() => writer.close());
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  await writePromise.catch(() => {});
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}


const CHAPTER_MEM_TTL_MS = 30 * 60 * 1000;
const CHAPTER_MEM_MAX = 24;

export interface CachedChapter {
  v: number;
  bookTitle: string;
  bookAuthor: string;
  chapterTitle: string;
  contentHtml: string;
  sectionIndex: number;
  totalSections: number;
  language?: string;
  toc?: { title: string; sectionIndex: number }[];
}

const chapterMem = new Map<string, { at: number; chapter: CachedChapter }>();

function chapterKey(hash: string, section: number): string {
  return `kcache/ch/${hash}/${section}.json`;
}

function touchChapterMem(key: string, chapter: CachedChapter) {
  chapterMem.set(key, { at: Date.now(), chapter });
  if (chapterMem.size > CHAPTER_MEM_MAX) {
    // FIFO simple: el Map itera en orden de inserción
    const oldest = chapterMem.keys().next().value;
    if (oldest !== undefined) chapterMem.delete(oldest);
  }
}

/** Capítulo cacheado: primero memoria del isolate, luego R2. */
export async function getCachedChapter(
  bucket: R2Bucket | undefined,
  hash: string,
  section: number,
): Promise<CachedChapter | null> {
  if (!bucket) return null;
  const key = chapterKey(hash, section);
  const hit = chapterMem.get(key);
  if (hit && Date.now() - hit.at < CHAPTER_MEM_TTL_MS) {
    return hit.chapter;
  }
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    let raw: string;
    if (obj.httpMetadata?.contentEncoding === "gzip") {
      const buf = await obj.arrayBuffer();
      const dec = await gunzipBytes(new Uint8Array(buf));
      raw = new TextDecoder().decode(dec);
    } else {
      raw = await obj.text();
    }
    const parsed = JSON.parse(raw) as CachedChapter;
    if (parsed?.v !== KINDLE_CHAPTER_CACHE_V || typeof parsed.contentHtml !== "string") {
      return null;
    }
    touchChapterMem(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function putCachedChapter(
  bucket: R2Bucket | undefined,
  hash: string,
  chapter: Omit<CachedChapter, "v">,
): Promise<void> {
  if (!bucket) return;
  const key = chapterKey(hash, chapter.sectionIndex);
  const full: CachedChapter = { v: KINDLE_CHAPTER_CACHE_V, ...chapter };
  touchChapterMem(key, full);
  try {
    const gz = await gzipBytes(new TextEncoder().encode(JSON.stringify(full)));
    await bucket.put(key, gz, {
      httpMetadata: { contentType: "application/json; charset=utf-8", contentEncoding: "gzip" },
    });
  } catch {
    // Cache best-effort: la lectura nunca falla por el caché
  }
}

// ── Recursos (imágenes, css, portadas internas) ────────────────────────────

function normalizeResourcePath(path: string): string | null {
  const p = decodeURIComponent(path).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.includes("..") || p.length > 600) return null;
  return p;
}

export async function getCachedResource(
  bucket: R2Bucket | undefined,
  hash: string,
  path: string,
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  if (!bucket) return null;
  const norm = normalizeResourcePath(path);
  if (!norm) return null;
  try {
    const obj = await bucket.get(`kcache/res/${hash}/${norm}`);
    if (!obj) return null;
    return {
      body: await obj.arrayBuffer(),
      contentType: obj.httpMetadata?.contentType || "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export async function putCachedResource(
  bucket: R2Bucket | undefined,
  hash: string,
  path: string,
  data: Uint8Array | ArrayBuffer,
  contentType: string,
): Promise<void> {
  if (!bucket) return;
  const norm = normalizeResourcePath(path);
  if (!norm) return;
  try {
    await bucket.put(`kcache/res/${hash}/${norm}`, data, {
      httpMetadata: { contentType },
    });
  } catch {
    // best-effort
  }
}

// ── Purga ─────────────────────────────────────────────────────────────────

/** Borra todos los artefactos cacheados de un libro (capítulos y recursos).
 * Llamar al eliminar el libro de R2 o al borrar la cuenta. */
export async function purgeKindleBookCache(
  bucket: R2Bucket | undefined,
  hash: string,
): Promise<void> {
  if (!bucket) return;
  for (const prefix of [`kcache/ch/${hash}/`, `kcache/res/${hash}/`]) {
    try {
      let cursor: string | undefined;
      do {
        const listed = await bucket.list({ prefix, cursor, limit: 200 });
        const keys = listed.objects.map((o) => o.key);
        if (keys.length) await bucket.delete(keys);
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
    } catch {
      // best-effort: la purga se reintenta en el próximo borrado/versión
    }
  }
  // Limpiar también la memoria del isolate
  for (const key of [...chapterMem.keys()]) {
    if (key.includes(`/${hash}/`)) chapterMem.delete(key);
  }
}

/** Solo para tests. */
export function resetKindleCacheMemory(): void {
  chapterMem.clear();
}
