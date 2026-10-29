#!/usr/bin/env node
// Desminifica los frames que guarda lecta_error_signatures.
//
// Los reportes del cliente viajan con hasta 3 frames limpios del tipo
// `index-CMW2Mu5g.js:1:23456` (ver topFrames en src/client/lib/client-errors.ts).
// Esos nombres son los del build desplegado, así que para leerlos hacen falta
// los .map de ESE build: vite.config.ts los emite con `sourcemap: "hidden"` y
// sourcemapVault() los mueve a artifacts/sourcemaps/<build-id>/ con un índice
// acumulado. Este script lee ese índice y traduce cada frame a su archivo
// original (src/client/...:línea:columna + nombre de función).
//
// Uso:
//   node --env-file=.env scripts/symbolicate.mjs index-CMW2Mu5g.js:1:23456
//   node --env-file=.env scripts/symbolicate.mjs --db          # tabla completa
//   node --env-file=.env scripts/symbolicate.mjs --db --days 7 --json
//
// Sin --db no toca la base: solo resuelve los frames que le pases.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

const ROOT = process.cwd();
const INDEX_FILE = resolve(ROOT, "artifacts/sourcemaps/index.json");

// Un frame limpio del cliente: `archivo.js:línea:columna` (con o sin prefijo
// de ruta tipo `assets/`). V8 usa columna 1-based; source-map la quiere 0-based.
const FRAME_RE = /^(?:[^\s/]+\/)*([^/\s]+\.js):(\d+):(\d+)$/;
// Un frame de código propio (sourceMaps de librerías o stacks ya limpios): no
// hay nada que desminificar, se reporta tal cual.
const SOURCE_FRAME_RE = /^(?:[^\s/]+\/)*[^/\s]+\.(?:tsx?|jsx):\d+:\d+$/;

export function parseArgs(argv) {
  const options = { frames: [], db: false, days: 7, json: false, limit: 100 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db") options.db = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--days") options.days = clampInt(argv[++i], 1, 30, 7);
    else if (arg === "--limit") options.limit = clampInt(argv[++i], 1, 1000, 100);
    else if (arg.startsWith("--")) {
      throw new Error(`Opción desconocida: ${arg}`);
    } else options.frames.push(arg);
  }
  return options;
}

function clampInt(raw, min, max, fallback) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function loadIndex(file = INDEX_FILE) {
  if (!existsSync(file)) {
    throw new Error(
      `No hay índice de mapas en ${file}. Genera uno con \`pnpm build\` ` +
        "(vite.config.ts → sourcemapVault).",
    );
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/** @returns {{asset: string, original: string | null, reason?: string}} */
export function resolveFrame(index, frame, root = ROOT) {
  const trimmed = String(frame).trim();
  if (SOURCE_FRAME_RE.test(trimmed)) {
    return { asset: trimmed, original: trimmed, reason: "ya es fuente" };
  }
  const match = FRAME_RE.exec(trimmed);
  if (!match) return { asset: trimmed, original: null, reason: "frame ilegible" };
  const [, asset, line, rawColumn] = match;
  const entry = index.assets?.[asset];
  if (!entry) return { asset, original: null, reason: "sin mapa para ese build" };

  const mapPath = resolve(root, entry.map);
  if (!existsSync(mapPath)) return { asset, original: null, reason: `falta ${entry.map}` };

  try {
    const traceMap = new TraceMap(JSON.parse(readFileSync(mapPath, "utf8")));
    const pos = originalPositionFor(traceMap, {
      line: Number.parseInt(line, 10),
      // V8 cuenta la columna desde 1; el mapa desde 0.
      column: Math.max(0, Number.parseInt(rawColumn, 10) - 1),
    });
    if (!pos.source || pos.line == null) {
      return { asset, original: null, reason: "columna sin mapping" };
    }
    const where = `${pos.source.replace(/^(?:\.\.\/)+/, "")}:${pos.line}:${pos.column ?? 0}`;
    return { asset, original: pos.name ? `${where} (${pos.name})` : where };
  } catch (error) {
    return { asset, original: null, reason: `mapa inválido: ${error.message}` };
  }
}

export function splitFrames(sample) {
  return String(sample ?? "")
    .split("->")
    .map((frame) => frame.trim())
    .filter(Boolean);
}

async function readSignatures(days, limit) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Falta DATABASE_URL (usa `node --env-file=.env`).");
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const dbName = await client.query("SELECT current_database() AS db");
    const rows = await client.query(
      `SELECT signature, name, code, route, version, hits, sample_frames, last_seen
         FROM lecta_error_signatures
        WHERE bucket_day >= current_date - $1::INT8
        ORDER BY hits DESC, last_seen DESC
        LIMIT $2`,
      [days, limit],
    );
    return { database: dbName.rows[0]?.db, rows: rows.rows };
  } finally {
    await client.end();
  }
}

function printFrameLine(frame, resolved) {
  const left = frame.padEnd(42);
  if (resolved.original) return `    ${left} → ${resolved.original}`;
  return `    ${left} → (${resolved.reason ?? "sin resolver"})`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const index = loadIndex();
  const builds = (index.builds ?? []).length;

  if (!options.db) {
    if (options.frames.length === 0) {
      throw new Error("Pasa al menos un frame (`archivo.js:línea:columna`) o usa --db.");
    }
    const results = options.frames.map((frame) => ({
      frame,
      ...resolveFrame(index, frame),
    }));
    if (options.json) {
      console.log(JSON.stringify({ builds, results }, null, 2));
      return;
    }
    console.log(`Índice: ${builds} build(s) de mapas en artifacts/sourcemaps/`);
    for (const result of results) console.log(printFrameLine(result.frame, result));
    return;
  }

  const { database, rows } = await readSignatures(options.days, options.limit);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          database,
          days: options.days,
          rows: rows.map((row) => ({
            ...row,
            frames: splitFrames(row.sample_frames).map((frame) => ({
              frame,
              ...resolveFrame(index, frame),
            })),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Base: ${database} · últimos ${options.days} día(s) · ${rows.length} firma(s)`);
  if (rows.length === 0) {
    console.log("Sin errores agrupados en ese rango.");
    return;
  }
  for (const row of rows) {
    const head = `${row.hits}× ${row.name}${row.code ? `/${row.code}` : ""} · ${row.route} · v${row.version || "?"}`;
    console.log(`\n${head}`);
    console.log(`  firma ${row.signature} · último ${new Date(row.last_seen).toISOString()}`);
    const frames = splitFrames(row.sample_frames);
    if (frames.length === 0) console.log("  (sin frames en el reporte)");
    for (const frame of frames) console.log(printFrameLine(frame, resolveFrame(index, frame)));
  }
}

// Solo se ejecuta como CLI (`node scripts/symbolicate.mjs`), nunca al importarlo
// desde scripts/symbolicate.test.mjs.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`symbolicate: ${error.message}`);
    process.exitCode = 1;
  });
}
