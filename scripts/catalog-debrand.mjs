#!/usr/bin/env node
// Quita la marca Project Gutenberg de los EPUB del catálogo curado.
//
//   node scripts/catalog-debrand.mjs              → todos los de index.json
//   node scripts/catalog-debrand.mjs --only=marianela,quijote
//
// Lee catalog-seed/<id>.epub (lo que dejó `catalog-seed.mjs --seed`),
// escribe catalog-seed/v2/<id>.epub y actualiza epubBytes/epubSha256 en
// catalog-seed/index.json. Corre después del seed: el seed reescribe
// index.json con los datos del EPUB original.
//
// Sale con 1 si algún EPUB conserva la marca («Project Gutenberg»,
// gutenberg.org, «-tm»). Las menciones sueltas de «Gutenberg» (el
// inventor) se listan para revisarlas a mano, no fallan.
//
// Publicar es aparte y solo con autorización: subir catalog-seed/v2/*.epub
// a R2 como catalog/v2/<id>.epub y luego index.json como
// catalog/index.json. El worker sirve los EPUB curados desde catalog/v2/.
// Ver docs/designs/2026-11-15-explora-derechos.md (R4, M4c).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { debrandGutenbergEpub } from "../src/shared/gutenberg-debrand.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(HERE, "..", "catalog-seed");
const OUT_DIR = join(SEED_DIR, "v2");
const INDEX_PATH = join(SEED_DIR, "index.json");

const only = process.argv
  .find((arg) => arg.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",");

const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
const books = index.books.filter((book) => !only || only.includes(book.id));
mkdirSync(OUT_DIR, { recursive: true });

const branded = [];
const mentions = [];
for (const book of books) {
  const source = join(SEED_DIR, `${book.id}.epub`);
  if (!existsSync(source)) {
    branded.push(`${book.id}: falta ${source}`);
    continue;
  }
  const { bytes, residual } = await debrandGutenbergEpub(
    new Uint8Array(readFileSync(source)),
    book.id,
  );
  for (const hit of residual) {
    const line = `${book.id}: ${hit.where} en ${hit.file}`;
    (hit.where === "mention" ? mentions : branded).push(line);
  }
  writeFileSync(join(OUT_DIR, `${book.id}.epub`), bytes);
  book.epubBytes = bytes.byteLength;
  book.epubSha256 = createHash("sha256").update(bytes).digest("hex");
}

writeFileSync(INDEX_PATH, JSON.stringify(index));
console.log(`${books.length} EPUB limpios → catalog-seed/v2/ · index.json actualizado`);
if (mentions.length) {
  console.log(`\nMenciones sueltas de «Gutenberg» (revisar a mano):\n  ${mentions.join("\n  ")}`);
}
if (branded.length) {
  console.error(`\nConservan la marca:\n  ${branded.join("\n  ")}`);
  process.exit(1);
}
