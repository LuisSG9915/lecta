#!/usr/bin/env node
// Embudo de la landing por fuente, desde lecta_landing_daily (migración 028).
// Solo lee. Uso:
//   pnpm landing:stats [--days 14] [--json]
// `DATABASE_URL` del `.env` es producción (`lecta`); para dev, `DATABASE_URL_DEV` (`lecta_dev`).

import { pathToFileURL } from "node:url";

const CTA_PREFIX = "cta:";
const GROWTH_EVENTS = new Set([
  "app:share-postal",
  "app:share-exlibris",
  "app:article-import",
  "app:article-share-target",
  "app:audio-review",
]);

/**
 * Filas `{ event, source, hits }` ⇒ una fila por fuente con el embudo
 * vistas → demo → clic en CTA → signup, ordenada por vistas.
 */
export function buildFunnel(rows) {
  const bySource = new Map();
  for (const row of rows) {
    const event = String(row.event);
    if (event.startsWith("app:") || event.startsWith("nivel:")) continue;
    const source = String(row.source);
    const hits = Number(row.hits) || 0;
    const entry =
      bySource.get(source) ??
      { source, views: 0, demoOpen: 0, demoSave: 0, cta: 0, ctaBy: {}, signup: 0 };
    if (event === "view") entry.views += hits;
    else if (event === "demo_open") entry.demoOpen += hits;
    else if (event === "demo_save") entry.demoSave += hits;
    else if (event === "signup") entry.signup += hits;
    else if (event.startsWith(CTA_PREFIX)) {
      entry.cta += hits;
      const where = event.slice(CTA_PREFIX.length);
      entry.ctaBy[where] = (entry.ctaBy[where] ?? 0) + hits;
    }
    bySource.set(source, entry);
  }
  return [...bySource.values()].sort((a, b) => b.views - a.views || b.signup - a.signup);
}

/** Embudo de `/nivel` (`nivel:view` → `nivel:epub` → `nivel:cta`) por fuente. */
export function buildNivelFunnel(rows) {
  const bySource = new Map();
  for (const row of rows) {
    const event = String(row.event);
    if (event !== "nivel:view" && event !== "nivel:epub" && event !== "nivel:cta") continue;
    const source = String(row.source);
    const hits = Number(row.hits) || 0;
    const entry = bySource.get(source) ?? { source, views: 0, epub: 0, cta: 0 };
    if (event === "nivel:view") entry.views += hits;
    else if (event === "nivel:epub") entry.epub += hits;
    else entry.cta += hits;
    bySource.set(source, entry);
  }
  return [...bySource.values()].sort((a, b) => b.views - a.views || b.cta - a.cta);
}

/** Señales de adopción en producto (`GROWTH_EVENTS`), desglosadas por plan. */
export function buildGrowthSignals(rows) {
  const byEvent = new Map();
  for (const row of rows) {
    const event = String(row.event);
    if (!GROWTH_EVENTS.has(event)) continue;
    const hits = Number(row.hits) || 0;
    const source = String(row.source);
    const entry =
      byEvent.get(event) ?? { event, total: 0, trial: 0, free: 0, plus: 0, unknown: 0 };
    entry.total += hits;
    if (source === "trial") entry.trial += hits;
    else if (source === "free") entry.free += hits;
    else if (source === "plus") entry.plus += hits;
    else entry.unknown += hits;
    byEvent.set(event, entry);
  }
  return [...byEvent.values()]
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total || a.event.localeCompare(b.event));
}

export function rate(part, whole) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";
}

function parseArgs(argv) {
  const out = { days: 14, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") out.json = true;
    else if (argv[i] === "--days") out.days = Math.max(1, Math.min(90, Number(argv[++i]) || 14));
  }
  return out;
}

async function readRows(days) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL (usa `node --env-file=.env`).");
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const db = await client.query("SELECT current_database() AS db");
    const result = await client.query(
      `SELECT event, source, sum(hits)::INT8 AS hits
         FROM lecta_landing_daily
        WHERE bucket_day >= current_date - $1::INT8
        GROUP BY event, source`,
      [days],
    );
    return { database: db.rows[0]?.db, rows: result.rows };
  } finally {
    await client.end();
  }
}

function printTable(header, lines) {
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  for (const line of lines) console.log(fmt(line));
}

async function main() {
  const { days, json } = parseArgs(process.argv.slice(2));
  const { database, rows } = await readRows(days);
  const funnel = buildFunnel(rows);
  const nivelFunnel = buildNivelFunnel(rows);
  const growthSignals = buildGrowthSignals(rows);
  if (json) {
    console.log(JSON.stringify({ database, days, funnel, nivelFunnel, growthSignals }, null, 2));
    return;
  }
  console.log(`Landing · ${database} · últimos ${days} días\n`);
  if (funnel.length === 0 && nivelFunnel.length === 0 && growthSignals.length === 0) {
    console.log("Sin eventos todavía.");
    return;
  }
  if (funnel.length > 0) {
    printTable(
      ["fuente", "vistas", "demo", "guarda", "CTA", "signup", "CTA/vista", "signup/vista"],
      funnel.map((f) => [
        f.source,
        f.views,
        f.demoOpen,
        f.demoSave,
        f.cta,
        f.signup,
        rate(f.cta, f.views),
        rate(f.signup, f.views),
      ]),
    );
    const ctaTotals = {};
    for (const f of funnel) {
      for (const [where, hits] of Object.entries(f.ctaBy)) ctaTotals[where] = (ctaTotals[where] ?? 0) + hits;
    }
    const ranked = Object.entries(ctaTotals).sort((a, b) => b[1] - a[1]);
    if (ranked.length) console.log(`\nClics por CTA: ${ranked.map(([w, h]) => `${w} ${h}`).join(" · ")}`);
  }
  if (nivelFunnel.length > 0) {
    console.log("\n/nivel\n");
    printTable(
      ["fuente", "vistas", "epub", "CTA", "epub/vista", "CTA/vista"],
      nivelFunnel.map((f) => [f.source, f.views, f.epub, f.cta, rate(f.epub, f.views), rate(f.cta, f.views)]),
    );
  }
  if (growthSignals.length > 0) {
    console.log("\nSeñales de producto (M4)\n");
    printTable(
      ["evento", "total", "trial", "free", "plus"],
      growthSignals.map((g) => [g.event, g.total, g.trial, g.free, g.plus]),
    );
  }
}

// pathToFileURL: la ruta del repo lleva espacios («Desarrollos Devin»).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
