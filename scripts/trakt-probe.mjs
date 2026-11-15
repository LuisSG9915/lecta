#!/usr/bin/env node
// Sonda de Trakt para los rieles de «Series y películas» (fase F5 del
// plan Gutenberg+pantalla). Hace UNA llamada real a cada endpoint y
// muestra solo el estado HTTP y la forma de la respuesta: nombres de
// campos y valores recortados a 40 caracteres. Jamás imprime la llave.
//
//   node --env-file=.env scripts/trakt-probe.mjs
//
// Lo esperado (documentación pública; la sonda lo confirma):
//   trending → [{ watchers, movie|show: { title, year, ids: { imdb } } }]
//   popular  → [{ title, year, ids }] · years acepta rango "2025-2026"
//   related  → [{ title, year, ids }] aceptando id de IMDb en la ruta
//
// Si la forma real difiere de la esperada, se anota en el plan y se
// ajusta solo el parser tolerante de src/worker/screen.ts — este
// script no decide nada por sí solo.

const TRAKT_BASE = "https://api.trakt.tv";
const KEY = process.env.TRACKT_API_KEY;

const clip = (value) => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  let s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > 40 ? `"${s.slice(0, 40)}…"` : JSON.stringify(s);
};

// Describe la forma de un JSON sin volcar contenido: objetos con
// sus claves, arreglos con longitud y la forma del primer elemento.
const shape = (value, depth = 0) => {
  if (depth > 3) return "…";
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[${value.length}× ${shape(value[0], depth + 1)}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    return `{ ${entries
      .map(([k, v]) => `${k}: ${shape(v, depth + 1)}`)
      .join(", ")} }`;
  }
  return clip(value);
};

const headers = {
  "trakt-api-key": KEY ?? "",
  "trakt-api-version": "2",
  "Content-Type": "application/json",
  "User-Agent": "Lecta/1.0",
};

const currentYear = new Date().getUTCFullYear();
const years = `${currentYear - 1}-${currentYear}`;

const calls = [
  ["movies trending", `/movies/trending?limit=3`],
  ["shows popular", `/shows/popular?limit=3`],
  ["movies popular (año)", `/movies/popular?years=${years}&limit=3`],
  ["related de tt0133093", `/movies/tt0133093/related?limit=3`],
];

if (!KEY) {
  console.log("Sonda trakt-probe — TRACKT_API_KEY no está en .env; omitida");
  process.exit(0);
}

console.log("Sonda trakt-probe — Trakt (solo forma, sin contenido)");
for (const [label, path] of calls) {
  const url = `${TRAKT_BASE}${path}`;
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* cuerpo no-JSON: se muestra recortado abajo */
    }
    console.log(`\n■ ${label}\n  HTTP ${response.status}`);
    console.log(`  ${data ? shape(data) : clip(text)}`);
  } catch (error) {
    console.log(`\n■ ${label}\n  sin respuesta — ${error.message}`);
  }
}
