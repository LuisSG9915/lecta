// Carga data/lexicon/*.tsv (de scripts/lexicon-export.py) a la base de
// DATABASE_URL — misma vía que `pnpm db:migrate`. Idempotente: las
// formas usan ON CONFLICT DO NOTHING y los lemas no se duplican.
//
//   node --env-file=.env scripts/lexicon-load.mjs
//
// Procedencia registrada en lexicon_sources por cada corrida.

import { readFileSync } from "node:fs";
import pg from "pg";

const LANG = "es";
const BATCH = 5000;

// Licencias confirmadas en la revisión de la Fase 2:
// docs/licencias-lexico.md. La lista de simplemma mezcla ODbL 1.0
// (Měchura), CC BY-SA (Kaikki, UniMorph), LGPLLR (FreeLing), MIT
// (spaCy) y CC BY 4.0 (Wikinflection).
const SOURCES = [
  {
    name: "simplemma",
    version: "1.1.2",
    license: "MIT + ODbL-1.0 + CC BY-SA + LGPLLR + CC BY-4.0 (ver docs/licencias-lexico.md)",
    url: "https://github.com/adbar/simplemma",
  },
  {
    name: "wordfreq",
    version: "3.1.1",
    license: "CC BY-SA 4.0",
    url: "https://github.com/rspeer/wordfreq",
  },
];

const BATCH_ROWS = `
  UPDATE lexicon_entries e
  SET zipf = j.zipf
  FROM (SELECT (value->>'l') AS lemma, (value->>'z')::FLOAT8 AS zipf
        FROM jsonb_array_elements($1)) j
  WHERE e.language = $2 AND e.lemma = j.lemma
`;

const INSERT_ENTRIES = `
  INSERT INTO lexicon_entries (language, lemma, pos, freq_rank, zipf, source, status)
  SELECT $2, j.lemma, NULL, NULL, j.zipf, 'list', 'ok'
  FROM (SELECT (value->>'l') AS lemma, (value->>'z')::FLOAT8 AS zipf
        FROM jsonb_array_elements($1)) j
  WHERE NOT EXISTS (
    SELECT 1 FROM lexicon_entries e
    WHERE e.language = $2 AND e.lemma = j.lemma
  )
`;

const INSERT_FORMS = `
  INSERT INTO lexicon_forms (language, form, entry_id, source)
  SELECT $2, j.form,
    (SELECT e.id FROM lexicon_entries e
     WHERE e.language = $2 AND e.lemma = j.lemma
     ORDER BY (e.pos IS NULL) DESC, e.id
     LIMIT 1),
    'list'
  FROM (SELECT (value->>'f') AS form, (value->>'l') AS lemma
        FROM jsonb_array_elements($1)) j
  ON CONFLICT DO NOTHING
`;

// Ambigua = la misma forma apunta a más de una entrada (la PK de
// lexicon_forms incluye entry_id, así que el caso existe).
const SET_AMBIGUOUS = `
  UPDATE lexicon_forms f
  SET ambiguous = true
  FROM (SELECT language, form FROM lexicon_forms
        GROUP BY language, form HAVING count(*) > 1) multi
  WHERE f.language = multi.language AND f.form = multi.form
`;

const readTsv = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));

const chunks = (rows, size) => {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query("SELECT current_database() AS db");
  console.log(`Conectado a la base ${rows[0].db}`);

  const lemmas = readTsv(`data/lexicon/${LANG}-lemmas.tsv`).map(([l, z]) => ({
    l,
    // zipf vacío = sin medición (wordfreq devolvió 0): NULL, no 0.00.
    z: z === undefined || z === "" ? null : Number(z),
  }));
  console.log(`${lemmas.length} lemas → lexicon_entries`);
  for (const chunk of chunks(lemmas, BATCH)) {
    await client.query(INSERT_ENTRIES, [JSON.stringify(chunk), LANG]);
    await client.query(BATCH_ROWS, [JSON.stringify(chunk), LANG]);
  }

  const forms = readTsv(`data/lexicon/${LANG}-forms.tsv`).map(([f, l]) => ({ f, l }));
  console.log(`${forms.length} formas → lexicon_forms`);
  let done = 0;
  for (const chunk of chunks(forms, BATCH)) {
    await client.query(INSERT_FORMS, [JSON.stringify(chunk), LANG]);
    done += chunk.length;
    if (done % 50000 === 0 || done === forms.length) console.log(`  ${done}/${forms.length}`);
  }

  const {
    rows: [{ updated: ambiguous }],
  } = await client.query(`WITH u AS (${SET_AMBIGUOUS} RETURNING 1) SELECT count(*) AS updated FROM u`);

  for (const source of SOURCES) {
    await client.query(
      `INSERT INTO lexicon_sources (name, version, license, url, loaded_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [source.name, source.version, source.license, source.url, Date.now()],
    );
  }

  const { rows: counts } = await client.query(`
    SELECT
      (SELECT count(*) FROM lexicon_entries WHERE language = '${LANG}') AS entries,
      (SELECT count(*) FROM lexicon_forms WHERE language = '${LANG}') AS forms
  `);
  console.log(`Listo: ${counts[0].entries} entradas, ${counts[0].forms} formas, ${ambiguous} formas ambiguas.`);
} finally {
  await client.end();
}
