#!/usr/bin/env node
// Sonda de las APIs de «Series y películas» (fase P1 del plan
// Gutenberg+pantalla). Hace UNA llamada real a cada servicio y
// muestra solo el estado HTTP y la forma de la respuesta: nombres
// de campos y valores recortados a 40 caracteres. Jamás imprime
// llaves, tokens ni URLs con credenciales.
//
//   node --env-file=.env scripts/screen-probe.mjs
//
// Lo esperado (documentación pública; la sonda lo confirma):
//   OMDb   ?s=  → { Search: [{ Title, Year, imdbID, Type, Poster }], Response }
//          ?i=  → detalle con totalSeasons y Poster; errores como
//          200 con Response: "False" y Error. Poster puede ser "N/A".
//   SubDL  → { status, results[]: { subtitles: [{ release_name, lang,
//          url, hi, full_season, … }] } }; 403 not_authorized, 429
//          daily_limit/rate_limit con Retry-After, «sin título» como
//          200 con status: false. La descarga del primer resultado
//          (https://dl.subdl.com<url>) es un zip: se listan solo los
//          nombres de archivo, nunca su contenido.
//
// Si la forma real difiere de la esperada, se anota en el plan y se
// ajusta solo el parser — este script no decide nada por sí solo.

const OMDB_BASE = "https://www.omdbapi.com/";
const SUBDL_LIST = "https://api.subdl.com/api/v1/subtitles";
const SUBDL_DL = "https://dl.subdl.com";
// tt11280740 = Severance (el ejemplo del plan): una serie con
// temporadas, sirve para probar búsqueda, detalle y episodios.
const TITLE = "severance";
const IMDB_ID = "tt11280740";

const omdbKey = process.env.OMDB_API_KEY;
const subdlKey = process.env.SUBDL_API_KEY;

const clip = (value) => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  let s = typeof value === "string" ? value : JSON.stringify(value);
  // Las URLs de descarga de SubDL llevan su propio api_key: nunca
  // mostrarlo aunque el recorte lo alcance.
  s = s.replace(/(api_key=)[^&\s"']+/gi, "$1***");
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

const show = (label, status, extra = "") =>
  console.log(`\n■ ${label}\n  HTTP ${status}${extra ? ` · ${extra}` : ""}`);

const fetchJson = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* cuerpo no-JSON: se muestra recortado abajo */
  }
  return { response, data, text };
};

const probeOmdb = async () => {
  if (!omdbKey) {
    console.log("\n■ OMDb — omitido: OMDB_API_KEY no está en .env");
    return;
  }
  const calls = [
    ["búsqueda ?s=", `${OMDB_BASE}?s=${encodeURIComponent(TITLE)}&apikey=${omdbKey}`],
    ["detalle ?i=", `${OMDB_BASE}?i=${IMDB_ID}&apikey=${omdbKey}`],
    [
      "temporada ?i=&Season=1",
      `${OMDB_BASE}?i=${IMDB_ID}&Season=1&apikey=${omdbKey}`,
    ],
  ];
  for (const [label, url] of calls) {
    const safe = url.replace(omdbKey, "***");
    try {
      const { response, data, text } = await fetchJson(url);
      show(label, response.status, safe);
      console.log(`  ${data ? shape(data) : clip(text)}`);
    } catch (error) {
      show(label, "sin respuesta", `${safe} — ${error.message}`);
    }
  }
};

const probeSubdl = async () => {
  if (!subdlKey) {
    console.log("\n■ SubDL — omitido: SUBDL_API_KEY no está en .env");
    return;
  }
  const listUrl =
    `${SUBDL_LIST}?api_key=${subdlKey}&imdb_id=${IMDB_ID}` +
    "&type=tv&season_number=1&episode_number=1&languages=EN&subs_per_page=30";
  const safeList = listUrl.replace(subdlKey, "***");
  try {
    const { response, data, text } = await fetchJson(listUrl);
    show("subtítulos S01E01", response.status, safeList);
    if (response.headers.get("retry-after"))
      console.log(`  Retry-After: ${response.headers.get("retry-after")}`);
    console.log(`  ${data ? shape(data) : clip(text)}`);

    // Descarga del primer resultado: solo nombres de archivo del zip.
    // La forma real pone `subtitles` en la raíz (no dentro de
    // results[]); se acepta también la anidada por si cambia.
    const subtitles =
      (Array.isArray(data?.subtitles) && data.subtitles.length
        ? data.subtitles
        : null) ??
      data?.results?.flatMap((r) => r.subtitles ?? []) ??
      [];
    const first = subtitles.find((s) => s?.url) ?? subtitles[0];
    if (!first?.url) {
      console.log("  (sin resultados: no hay zip que inspeccionar)");
      return;
    }
    const dlUrl = `${SUBDL_DL}${first.url}`;
    const dl = await fetch(dlUrl, { signal: AbortSignal.timeout(30000) });
    const buf = await dl.arrayBuffer();
    show(
      `descarga zip (${buf.byteLength} bytes)`,
      dl.status,
      dlUrl.replace(subdlKey, "***"),
    );
    if (!dl.ok) {
      console.log(`  ${clip(new TextDecoder().decode(buf.slice(0, 400)))}`);
      return;
    }
    const { BlobReader, ZipReader } = await import("@zip.js/zip.js");
    const zip = new ZipReader(new BlobReader(new Blob([buf])));
    const entries = await zip.getEntries();
    await zip.close();
    const names = entries
      .filter((e) => !e.directory)
      .map((e) => e.filename)
      .slice(0, 20);
    console.log(`  archivos: ${names.map(clip).join(", ")}`);
  } catch (error) {
    show("SubDL", "sin respuesta", `${safeList} — ${error.message}`);
  }
};

console.log("Sonda screen-probe — OMDb + SubDL (solo forma, sin contenido)");
await probeOmdb();
await probeSubdl();
