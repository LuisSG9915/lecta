#!/usr/bin/env node
// Exporta las acepciones del Wikcionario del catálogo (lecta_dev) a
// public/lexicon/senses-es.csv.gz — tarea pendiente de la Fase 8.
//
//   node --env-file=.env scripts/lexicon-export-senses.mjs [--out=ruta.csv.gz]
//
// Políticas:
//   · Solo source='wiktionary': las acepciones generadas con IA y las de la
//     semilla (source NULL) no entran — no son datos del Wikcionario y su
//     licencia es otra.
//   · Derivación mínima y declarada: se recorta el espacio en blanco y los
//     saltos de línea pasan a un espacio (un CSV con saltos dentro de campo es
//     válido, pero así el archivo es línea a línea).
//   · Orden estable (lema, pos, orden de acepción, id) y gzip sin fecha: dos
//     ejecuciones sobre el mismo catálogo dan el mismo SHA-256.
//
// Licencia de los datos: CC BY-SA 4.0 + GFDL (docs/licencias-lexico.md).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";

const DEFAULT_OUT = "public/lexicon/senses-es.csv.gz";
const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) || DEFAULT_OUT;
const HEADER = "lemma,pos,sense_order,definition,example";

const QUERY = `
  SELECT e.lemma,
         e.pos,
         s.sense_order,
         s.definition,
         COALESCE(s.example, '') AS example
  FROM lexicon_senses s
  JOIN lexicon_entries e ON e.id = s.entry_id
  WHERE e.language = 'es' AND s.source = 'wiktionary'
  ORDER BY e.lemma, e.pos NULLS FIRST, s.sense_order, e.id
`;

/** Escapa un campo según RFC 4180 y aplana los saltos de línea. */
function field(value) {
  const flat = String(value ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(QUERY);
await client.end();

const lines = [HEADER];
for (const row of rows) {
  lines.push(
    [field(row.lemma), field(row.pos), field(row.sense_order), field(row.definition), field(row.example)].join(","),
  );
}
const csv = lines.join("\n") + "\n";
const gz = gzipSync(Buffer.from(csv, "utf8"), { level: 9 });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gz);

const sha = createHash("sha256").update(gz).digest("hex");
console.log(`${rows.length} acepciones → ${out}`);
console.log(`crudo ${csv.length} bytes · gzip ${gz.length} bytes · sha256 ${sha}`);
