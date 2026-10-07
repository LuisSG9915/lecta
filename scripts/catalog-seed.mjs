#!/usr/bin/env node
// Seed del catálogo público de Lecta.
//
//   node scripts/catalog-seed.mjs            → verify: checa RDF + EPUB,
//                                              escribe catalog-seed/catalog.seed.json
//   node scripts/catalog-seed.mjs --seed     → además descarga EPUB + portada y
//                                              genera el manifiesto de vocabulario
//   node scripts/catalog-seed.mjs --only=quijote,regenta
//   node scripts/catalog-seed.mjs --limit=10 --concurrency=4 --delay=400
//
// Regla de dominio público: todos los creators/traductores/editores del
// RDF deben tener fecha de muerte ≤ deathYearMax (curación, 1924). Lo que
// no cumple queda en skipped.json con el motivo — no se publica.
//
// La subida a R2 NO es parte de este script: se hace aparte y solo con
// autorización explícita.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RDF_URL,
  EPUB3_URL,
  EPUB_URL,
  COVER_URL,
  parseRdf,
  rightsCheck,
  buildResolvedManifest,
  formsWithBases,
  tokenizeForms,
  loadStopwords,
  xhtmlToText,
  validateCurationItem,
} from "./catalog-seed-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CURATION_PATH = join(HERE, "catalog-curation.json");
const OUT_DIR = join(HERE, "..", "catalog-seed");

const args = process.argv.slice(2);
const MODE = args.includes("--seed") ? "seed" : "verify";
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.slice(8)) || null;
const CONCURRENCY =
  Number(args.find((a) => a.startsWith("--concurrency="))?.slice(14)) || 3;
const DELAY_MS =
  Number(args.find((a) => a.startsWith("--delay="))?.slice(8)) || 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOk(url, { as = "buffer", retries = 3 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "lecta-catalog-seed/1.0" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return { status: 404, data: null };
      if (!res.ok) {
        if (i < retries - 1 && res.status >= 500) {
          await sleep(800 * (i + 1));
          continue;
        }
        return { status: res.status, data: null };
      }
      const data = as === "text" ? await res.text() : await res.arrayBuffer();
      return { status: 200, data, bytes: as === "buffer" ? data.byteLength : null };
    } catch (err) {
      if (i === retries - 1) return { status: 0, data: null, error: String(err) };
      await sleep(800 * (i + 1));
    }
  }
  return { status: 0, data: null };
}

async function headOk(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "lecta-catalog-seed/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      return { ok: true, bytes: Number(res.headers.get("content-length")) || null };
    }
    // Algunos CDNs no sirven HEAD bien; un GET de rango corto confirma.
    if (res.status === 405 || res.status === 501) {
      const r = await fetch(url, {
        headers: { Range: "bytes=0-0", "User-Agent": "lecta-catalog-seed/1.0" },
        signal: AbortSignal.timeout(20_000),
      });
      return { ok: r.ok || r.status === 206, bytes: null };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false };
  }
}

async function resolveEpub(id) {
  for (const url of [EPUB3_URL(id), EPUB_URL(id)]) {
    const h = await headOk(url);
    if (h.ok) return { url, bytes: h.bytes };
  }
  return null;
}

async function epubText(buf) {
  const { ZipReader, Uint8ArrayReader, TextWriter } = await import(
    "@zip.js/zip.js"
  );
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(buf)));
  try {
    const entries = await reader.getEntries();
    const docs = entries
      .filter((e) => /\.(xhtml|html|htm)$/i.test(e.filename))
      .sort((a, b) => a.filename.localeCompare(b.filename));
    const parts = [];
    for (const e of docs) {
      const xhtml = await e.getData(new TextWriter());
      parts.push(xhtmlToText(xhtml));
    }
    return parts.join("\n");
  } finally {
    await reader.close();
  }
}

// ---------- Resolución léxica (solo --seed) ----------
//
// Misma consulta que el worker (findEntriesForForms) pero directa por
// pg y sin senses: la cobertura solo necesita id/lemma/pos/zipf. El
// catálogo léxico vive siempre en lecta_dev (nombre calificado — es la
// fuente única aunque la conexión apunte a lecta_dev).
const LEXICON_SQL = `
  SELECT f.form AS queried_form, e.id AS entry_id, e.lemma, e.pos, e.zipf
  FROM lecta_dev.lexicon_forms f
  JOIN lecta_dev.lexicon_entries e ON e.id = f.entry_id
  WHERE f.language = 'es' AND f.form = ANY($1)
  ORDER BY f.form, e.zipf DESC NULLS LAST
`;
const LEXICON_CHUNK = 2000;

async function resolveForms(client, forms) {
  // Map, no objeto plano: formas como «constructor» o «toString» son
  // propiedades heredadas de Object.prototype y romperían el ??=.
  const out = new Map();
  for (let i = 0; i < forms.length; i += LEXICON_CHUNK) {
    const chunk = forms.slice(i, i + LEXICON_CHUNK);
    const { rows } = await client.query(LEXICON_SQL, [chunk]);
    for (const row of rows) {
      const list = out.get(row.queried_form) ?? [];
      if (!out.has(row.queried_form)) out.set(row.queried_form, list);
      // groupEntries del worker agrupa por lemma::pos dentro de la
      // forma — aquí la deduplicación global sale en el manifest.
      if (!list.some((e) => e.lemma === row.lemma && e.pos === row.pos)) {
        list.push({
          entryId: row.entry_id != null ? String(row.entry_id) : null,
          lemma: row.lemma,
          pos: row.pos,
          zipf: row.zipf != null ? Number(row.zipf) : null,
        });
      }
    }
  }
  return Object.fromEntries(out);
}

// ctx en modo seed: { client: pg.Client, stopwords: Set<string> }
async function processItem(item, deathYearMax, ctx) {
  const out = { id: item.id, gutenbergId: item.gutenbergId, title: item.title, author: item.author };

  const invalid = validateCurationItem(item);
  if (invalid.length) return { status: "skipped", ...out, reasons: invalid };

  const rdf = await fetchOk(RDF_URL(item.gutenbergId), { as: "text" });
  if (rdf.status !== 200) {
    return { status: "skipped", ...out, reasons: [`RDF no disponible (HTTP ${rdf.status})`] };
  }
  const meta = parseRdf(rdf.data);

  if (!meta.languages.includes("es")) {
    return { status: "skipped", ...out, reasons: [`idioma no es 'es': ${meta.languages.join(", ")}`] };
  }

  const rights = rightsCheck(meta.contributors, { deathYearMax });
  if (!rights.ok && !item.allowContributors) {
    return {
      status: "skipped",
      ...out,
      reasons: rights.blocking.map((b) => `${b.name} (${b.role}): ${b.reason}`),
      advisory: rights.advisory,
    };
  }

  const epub = await resolveEpub(item.gutenbergId);
  if (!epub) {
    return { status: "skipped", ...out, reasons: ["sin EPUB disponible"] };
  }

  const cover = await headOk(COVER_URL(item.gutenbergId));

  const entry = {
    status: "ok",
    ...out,
    language: "es",
    issued: meta.issued,
    subjects: meta.subjects,
    epubUrl: epub.url,
    epubBytes: epub.bytes,
    coverUrl: cover.ok ? COVER_URL(item.gutenbergId) : null,
    contributors: meta.contributors,
    advisory: rights.advisory.length ? rights.advisory : undefined,
    forcedThrough: !rights.ok && item.allowContributors ? true : undefined,
  };

  if (MODE === "seed") {
    const epubFile = await fetchOk(epub.url);
    if (epubFile.status !== 200) {
      return { status: "skipped", ...out, reasons: [`EPUB no descargó (HTTP ${epubFile.status})`] };
    }
    const text = await epubText(epubFile.data);
    // El manifiesto resuelve las formas contra el léxico (formas del
    // libro + bases clíticas/«-mente») — la cobertura del cliente se
    // calcula en local sin más consultas por libro.
    const forms = [...new Set(tokenizeForms(text))];
    const resolved = await resolveForms(ctx.client, formsWithBases(forms));
    const manifest = buildResolvedManifest(text, resolved, {
      stopwords: ctx.stopwords,
    });
    if (manifest.wordCount < 2000) {
      return { status: "skipped", ...out, reasons: [`demasiado corto (${manifest.wordCount} palabras)`] };
    }
    writeFileSync(join(OUT_DIR, `${item.id}.epub`), Buffer.from(epubFile.data));
    writeFileSync(
      join(OUT_DIR, `${item.id}.vocab.json`),
      JSON.stringify(manifest),
    );
    if (cover.ok) {
      const img = await fetchOk(COVER_URL(item.gutenbergId));
      if (img.status === 200) {
        writeFileSync(join(OUT_DIR, `${item.id}.cover.jpg`), Buffer.from(img.data));
      }
    }
    Object.assign(entry, {
      wordCount: manifest.wordCount,
      uniqueForms: manifest.uniqueForms,
      // El cliente detecta «ya lo tienes» comparando este sha256 con el
      // hash del libro guardado — misma función que sha256Hex de
      // src/client/lib/hash.ts.
      epubSha256: createHash("sha256")
        .update(Buffer.from(epubFile.data))
        .digest("hex"),
      epubKey: `catalog/${item.id}.epub`,
      vocabKey: `catalog/${item.id}.vocab.json`,
      coverKey: cover.ok ? `catalog/${item.id}.cover.jpg` : null,
      epubFileBytes: epubFile.data.byteLength,
    });
  }

  return entry;
}

async function main() {
  const curation = JSON.parse(readFileSync(CURATION_PATH, "utf8"));
  const deathYearMax = curation.deathYearMax ?? 1924;
  let items = curation.items;
  if (ONLY) items = items.filter((i) => ONLY.includes(i.id));
  if (LIMIT) items = items.slice(0, LIMIT);

  mkdirSync(OUT_DIR, { recursive: true });
  const books = [];
  const skipped = [];

  // En modo seed se resuelve el vocabulario contra lecta_dev: sin la
  // cadena de conexión no hay manifest que escribir — falla claro.
  let ctx = null;
  if (MODE === "seed") {
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.error(
        "Falta DATABASE_URL (corre con node --env-file=.env …). El seed " +
          "resuelve el vocabulario contra lecta_dev.lexicon_*.",
      );
      process.exit(1);
    }
    const { default: pg } = await import("pg");
    // Pool, no Client suelto: los workers consultan en paralelo y un
    // cliente único encola client.query (patrón obsoleto en pg ≥9).
    const client = new pg.Pool({
      connectionString: url,
      max: Math.max(2, CONCURRENCY),
    });
    await client.query("SELECT 1");
    const stopwords = loadStopwords(
      readFileSync(join(HERE, "..", "src", "shared", "stopwords.ts"), "utf8"),
    );
    ctx = { client, stopwords };
  }

  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      process.stdout.write(`→ ${item.id} (g${item.gutenbergId})… `);
      const r = await processItem(item, deathYearMax, ctx);
      if (r.status === "ok") {
        books.push(r);
        console.log(`ok${MODE === "seed" ? ` · ${r.wordCount} palabras, ${r.uniqueForms} formas` : ""}`);
      } else {
        skipped.push(r);
        console.log(`SALTADO — ${r.reasons.join("; ")}`);
      }
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await ctx?.client.end();

  books.sort((a, b) => items.findIndex((i) => i.id === a.id) - items.findIndex((i) => i.id === b.id));

  // Las corridas parciales (--only/--limit) no pisan el catálogo: se
  // fusionan con lo ya generado reemplazando solo los ids de esta vuelta.
  const runIds = new Set(items.map((i) => i.id));
  let prevBooks = [];
  let prevSkipped = [];
  const prevPath = join(OUT_DIR, "catalog.seed.json");
  if (existsSync(prevPath)) {
    const prev = JSON.parse(readFileSync(prevPath, "utf8"));
    prevBooks = (prev.books ?? []).filter((b) => !runIds.has(b.id));
  }
  const prevSkippedPath = join(OUT_DIR, "skipped.json");
  if (existsSync(prevSkippedPath)) {
    prevSkipped = JSON.parse(readFileSync(prevSkippedPath, "utf8"))
      .filter((b) => !runIds.has(b.id));
  }
  const allBooks = [...prevBooks, ...books];
  allBooks.sort(
    (a, b) =>
      curation.items.findIndex((i) => i.id === a.id) -
      curation.items.findIndex((i) => i.id === b.id),
  );

  const seed = {
    generatedAt: new Date().toISOString(),
    deathYearMax,
    bookCount: allBooks.length,
    books: allBooks,
  };
  skipped.push(...prevSkipped);

  // Índice público que se sirve como catalog/index.json en R2: solo
  // campos de exhibición — contributors/advisory quedan como auditoría
  // interna en catalog.seed.json y nunca se publican.
  const index = {
    generatedAt: seed.generatedAt,
    bookCount: allBooks.length,
    books: allBooks.map((b) => ({
      id: b.id,
      gutenbergId: b.gutenbergId,
      title: b.title,
      author: b.author,
      language: b.language,
      issued: b.issued,
      subjects: b.subjects,
      wordCount: b.wordCount,
      uniqueForms: b.uniqueForms,
      epubBytes: b.epubBytes,
      epubSha256: b.epubSha256,
      cover: Boolean(b.coverUrl),
    })),
  };
  writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify(index));
  writeFileSync(join(OUT_DIR, "catalog.seed.json"), JSON.stringify(seed, null, 2));
  writeFileSync(join(OUT_DIR, "skipped.json"), JSON.stringify(skipped, null, 2));

  console.log(
    `\n${books.length} verificados esta corrida · ${allBooks.length} total en catálogo · ${skipped.length} saltados → catalog-seed/catalog.seed.json`,
  );
  if (skipped.length) console.log(`   Motivos en catalog-seed/skipped.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
