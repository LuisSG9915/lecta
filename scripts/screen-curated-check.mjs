#!/usr/bin/env node
// Verifica la lista curada de rieles (src/worker/screen-curated.ts)
// contra OMDb: una llamada ?i= por entrada y solo imprime las que no
// cuadran (título, tipo o año distinto). ~27 llamadas, una sola vez;
// necesita OMDB_API_KEY en .env.
//
//   node --env-file=.env scripts/screen-curated-check.mjs
//
// Si algo falla: corregir el imdbId/título/año en screen-curated.ts o
// quitar la entrada. Nunca imprime la llave.

import { CURATED_SCREEN } from "../src/worker/screen-curated.ts";

const OMDB_BASE = "https://www.omdbapi.com/";
const KEY = process.env.OMDB_API_KEY;

if (!KEY) {
  console.log("screen-curated-check — OMDB_API_KEY no está en .env; omitido");
  process.exit(0);
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const yearOf = (year) => String(year ?? "").slice(0, 4);

let mismatches = 0;
let checked = 0;

for (const entry of CURATED_SCREEN) {
  checked += 1;
  const url = `${OMDB_BASE}?i=${encodeURIComponent(entry.imdbId)}&apikey=${KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => null);
    if (!res.ok || String(data?.Response).toLowerCase() !== "true") {
      mismatches += 1;
      console.log(`✗ ${entry.imdbId} ${entry.title} — OMDb: ${data?.Error ?? `HTTP ${res.status}`}`);
      continue;
    }
    const omdbType = data.Type === "series" ? "tv" : data.Type === "movie" ? "movie" : data.Type;
    const problems = [];
    if (norm(data.Title) !== norm(entry.title))
      problems.push(`título OMDb «${data.Title}»`);
    if (omdbType !== entry.type) problems.push(`tipo OMDb «${data.Type}»`);
    if (yearOf(data.Year) !== entry.year) problems.push(`año OMDb «${yearOf(data.Year)}»`);
    if (problems.length) {
      mismatches += 1;
      console.log(`✗ ${entry.imdbId} ${entry.title} — ${problems.join("; ")}`);
    }
  } catch (error) {
    mismatches += 1;
    console.log(`✗ ${entry.imdbId} ${entry.title} — ${error.message}`);
  }
}

console.log(`\n${checked - mismatches}/${checked} entradas cuadran con OMDb`);
process.exit(mismatches ? 1 : 0);
