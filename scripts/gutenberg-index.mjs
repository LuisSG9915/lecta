#!/usr/bin/env node
// Índice propio de Project Gutenberg para la búsqueda del catálogo
// ampliado («Más clásicos» de Explora). Dos pasos, siempre a mano:
//
//   node scripts/gutenberg-index.mjs --build
//     Baja el volcado oficial rdf-files.tar.bz2 a catalog-seed/.gutenberg/
//     (carpeta ignorada por git), lo extrae con tar y escribe
//     catalog-seed/gutenberg-index.ndjson + gutenberg-index.skipped.json.
//
//   node --env-file=.env scripts/gutenberg-index.mjs --load
//     UPSERT por lotes de 500 (jsonb_to_recordset) en
//     lecta_dev.gutenberg_books. Exige current_database() = 'lecta_dev'
//     — la misma guardia que scripts/db-migrate.mjs; nunca corre sobre
//     `lecta`. No borra filas: un libro que deja de cumplir la regla
//     queda en el índice hasta depurar a mano (el worker lo seguiría
//     ofreciendo, decisión consciente del volumen).
//
// Regla de entrada (las cuatro, todas): tipo «Text», idioma es/en,
// rightsCheck aprobado con el deathYearMax de catalog-curation.json y
// formato application/epub+zip. El EPUB en sí NO se descarga aquí: el
// worker lo trae bajo demanda y lo cachea en R2.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRdf, rightsCheck, searchTextOf } from "./catalog-seed-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const WORK_DIR = join(ROOT, "catalog-seed", ".gutenberg");
const EXTRACT_DIR = join(WORK_DIR, "extracted");
const TAR_PATH = join(WORK_DIR, "rdf-files.tar.bz2");
const RDF_TARBALL_URL =
  "https://www.gutenberg.org/cache/epub/feeds/rdf-files.tar.bz2";
const NDJSON_PATH = join(ROOT, "catalog-seed", "gutenberg-index.ndjson");
const SKIPPED_PATH = join(ROOT, "catalog-seed", "gutenberg-index.skipped.json");
const CURATION_PATH = join(HERE, "catalog-curation.json");

const LOAD_BATCH = 500;
const SUPPORTED_LANGUAGES = new Set(["es", "en"]);
const MAX_SUBJECTS = 8;
const MAX_SUBJECT_LEN = 80;

// Fila del índice (columnas de gutenberg_books, migración 029). Devuelve
// { ok: true, row } o { ok: false, reason } — la razón es la clave de
// conteo que va a gutenberg-index.skipped.json.
export function indexRowFromRdf(gutenbergId, xml, { deathYearMax = 1924 } = {}) {
  let meta;
  try {
    meta = parseRdf(xml);
  } catch {
    return { ok: false, reason: "xml inválido" };
  }
  if (!meta.title?.trim()) return { ok: false, reason: "sin título" };
  if (meta.type !== "Text") return { ok: false, reason: `tipo ${meta.type}` };
  const language = meta.languages.find((lang) =>
    SUPPORTED_LANGUAGES.has(lang),
  );
  if (!language) return { ok: false, reason: "idioma no es/en" };
  const rights = rightsCheck(meta.contributors, { deathYearMax });
  if (!rights.ok) return { ok: false, reason: "derechos" };
  if (!meta.formats.includes("application/epub+zip")) {
    return { ok: false, reason: "sin EPUB" };
  }
  const author =
    meta.contributors.find((c) => c.role === "creator")?.name ?? "";
  const subjects = [];
  for (const subject of meta.subjects) {
    const clean = subject.trim().slice(0, MAX_SUBJECT_LEN);
    if (clean && !subjects.includes(clean)) subjects.push(clean);
    if (subjects.length >= MAX_SUBJECTS) break;
  }
  return {
    ok: true,
    row: {
      gutenberg_id: gutenbergId,
      language,
      title: meta.title.trim(),
      author,
      subjects,
      downloads: meta.downloads,
      issued: meta.issued ?? null,
      search_text: searchTextOf(meta.title, author),
    },
  };
}

// Recorre el árbol extraído buscando pg<id>.rdf a cualquier profundidad:
// el volcado llega como cache/epub/<id>/pg<id>.rdf pero el id sale del
// nombre del archivo, no de la ruta, así que un cambio de estructura
// del tarball no rompe el importador.
function* walkRdfFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkRdfFiles(full);
    } else {
      const match = /^pg(\d+)\.rdf$/.exec(entry.name);
      if (match) yield { path: full, id: Number(match[1]) };
    }
  }
}

async function ensureTarball() {
  try {
    const res = await fetch(RDF_TARBALL_URL, {
      headers: { "User-Agent": "lecta-catalog-index/1.0" },
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(TAR_PATH, buf);
    console.log(
      `✓ volcado descargado (${(buf.length / 1e6).toFixed(1)} MB)`,
    );
  } catch (err) {
    if (!existsSync(TAR_PATH)) throw err;
    console.warn(
      `⚠ no se pudo descargar el volcado (${err?.message ?? err}); ` +
        "se usa la copia local.",
    );
  }
}

function extractTarball() {
  rmSync(EXTRACT_DIR, { recursive: true, force: true });
  mkdirSync(EXTRACT_DIR, { recursive: true });
  const result = spawnSync("tar", ["-xjf", TAR_PATH, "-C", EXTRACT_DIR], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`tar -xjf terminó con código ${result.status}`);
  }
}

async function build() {
  const curation = JSON.parse(readFileSync(CURATION_PATH, "utf8"));
  const deathYearMax = curation.deathYearMax ?? 1924;

  mkdirSync(WORK_DIR, { recursive: true });
  await ensureTarball();
  extractTarball();

  const rows = [];
  const skipped = {};
  let total = 0;
  for (const { path, id } of walkRdfFiles(EXTRACT_DIR)) {
    total += 1;
    const result = indexRowFromRdf(id, readFileSync(path, "utf8"), {
      deathYearMax,
    });
    if (result.ok) rows.push(result.row);
    else skipped[result.reason] = (skipped[result.reason] ?? 0) + 1;
    if (total % 5000 === 0) console.log(`  … ${total} RDF leídos`);
  }
  rows.sort((a, b) => a.gutenberg_id - b.gutenberg_id);

  writeFileSync(
    NDJSON_PATH,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  writeFileSync(
    SKIPPED_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        deathYearMax,
        total,
        accepted: rows.length,
        skipped,
      },
      null,
      2,
    ),
  );

  const byLang = {};
  for (const row of rows) {
    byLang[row.language] = (byLang[row.language] ?? 0) + 1;
  }
  const langSummary = Object.entries(byLang)
    .map(([lang, n]) => `${lang}: ${n}`)
    .join(", ");
  const skipSummary = Object.entries(skipped)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${reason}: ${n}`)
    .join(", ");
  console.log(
    `\n${total} RDF leídos · ${rows.length} aceptados (${langSummary})`,
  );
  console.log(`descartados → ${SKIPPED_PATH}`);
  if (skipSummary) console.log(`   ${skipSummary}`);
}

const UPSERT_SQL = `
  INSERT INTO lecta_dev.gutenberg_books
    (gutenberg_id, language, title, author, subjects, downloads, issued, search_text)
  SELECT gutenberg_id, language, title, author, subjects, downloads, issued, search_text
  FROM jsonb_to_recordset($1::jsonb) AS x(
    gutenberg_id INT4,
    language STRING,
    title STRING,
    author STRING,
    subjects STRING[],
    downloads INT4,
    issued STRING,
    search_text STRING
  )
  ON CONFLICT (gutenberg_id) DO UPDATE SET
    language = EXCLUDED.language,
    title = EXCLUDED.title,
    author = EXCLUDED.author,
    subjects = EXCLUDED.subjects,
    downloads = EXCLUDED.downloads,
    issued = EXCLUDED.issued,
    search_text = EXCLUDED.search_text
`;

async function load() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "Falta DATABASE_URL (corre con node --env-file=.env …).",
    );
    process.exit(1);
  }
  if (!existsSync(NDJSON_PATH)) {
    console.error(`No existe ${NDJSON_PATH}: corre --build primero.`);
    process.exit(1);
  }
  const rows = readFileSync(NDJSON_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: dbRows } = await client.query(
      "SELECT current_database() AS db",
    );
    const db = dbRows[0]?.db;
    if (db !== "lecta_dev") {
      throw new Error(
        `El índice de Gutenberg solo carga en lecta_dev; la conexión apunta a ${db}.`,
      );
    }
    console.log(`Cargando ${rows.length} títulos en lecta_dev.gutenberg_books`);
    for (let i = 0; i < rows.length; i += LOAD_BATCH) {
      const batch = rows.slice(i, i + LOAD_BATCH);
      await client.query(UPSERT_SQL, [JSON.stringify(batch)]);
      console.log(
        `  … ${Math.min(i + LOAD_BATCH, rows.length)}/${rows.length}`,
      );
    }
    console.log(`✓ ${rows.length} títulos en lecta_dev.gutenberg_books`);
  } finally {
    await client.end();
  }
}

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const args = process.argv.slice(2);
  const run = args.includes("--build")
    ? build
    : args.includes("--load")
      ? load
      : null;
  if (!run) {
    console.error(
      "Uso: node scripts/gutenberg-index.mjs --build | --load",
    );
    process.exit(1);
  }
  run().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
