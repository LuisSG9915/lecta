// Carga acepciones del Wikcionario en español (dump kaikki.org,
// eswiktionary) al catálogo léxico — la alternativa sin IA a las
// definiciones. Lee data/lexicon/es-wiktionary.jsonl.gz (o .jsonl)
// en streaming, una línea JSON por entrada.
//
//   node --env-file=.env scripts/lexicon-wiktionary.mjs [--limit=N]
//
// Políticas:
//   · Entradas que ya tienen acepción útil (IA, semilla, cargas
//     previas) se conservan intactas — este load solo rellena huecos.
//   · Una línea «forma de» (senses[].form_of) no crea ficha propia:
//     enlaza la forma al lema en lexicon_forms, que es como el
//     lookup resuelve flexiones.
//   · El stub pos=null que ya trae la lista (zipf medido) se ascribe
//     a la pos del Wikcionario cuando corresponde, conservando su
//     medición; los lemas nuevos quedan con source='wiktionary'.
//   · Idempotente: formas y acepciones usan ON CONFLICT DO NOTHING.
//
// Licencia de los datos: CC BY-SA 4.0 + GFDL (docs/licencias-lexico.md).

import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import pg from "pg";

const LANG = "es";
const BATCH = 2000;
// Techo de acepciones por ficha: el Wikcionario puede listar 20+
// usos raros; las primeras son las comunes y acotan el payload del
// lookup (LOOKUP_SQL LIMIT 40 filas por forma).
const MAX_SENSES = 8;
const MAX_DEF_CHARS = 480;
const MAX_EXAMPLE_CHARS = 300;
// Varias líneas del dump pueden mapear a la misma ficha nuestra
// (pos distintas que comparten mapeo, o duplicados del origen):
// el orden real se resuelve en memoria.
const LIMIT = process.argv
  .map((arg) => /^--limit=(\d+)$/.exec(arg)?.[1])
  .find(Boolean);

// pos del dump → vocabulario del catálogo (el mismo que espera la
// ficha y la IA). Lo que no es vocabulario legible (caracteres,
// símbolos, afijos sueltos) se descarta completo.
const POS_MAP = {
  noun: "sustantivo",
  name: "nombre propio",
  verb: "verbo",
  adj: "adjetivo",
  adv: "adverbio",
  pron: "pronombre",
  prep: "preposición",
  conj: "conjunción",
  intj: "interjección",
  article: "determinante",
  det: "determinante",
  num: "numeral",
  participle: "participio",
  particle: "partícula",
  phrase: "locución",
  prep_phrase: "locución",
  proverb: "proverbio",
  contraction: "contracción",
  abbrev: "abreviatura",
  unknown: null,
};
const SKIP_POS = new Set(["character", "symbol", "syllable", "infix", "prefix", "suffix", "affix"]);

const INSERT_ENTRIES = `
  INSERT INTO lexicon_entries (language, lemma, pos, freq_rank, zipf, source, status)
  SELECT $2, j.lemma, j.pos, NULL, j.zipf, 'wiktionary', 'ok'
  FROM (SELECT (value->>'l') AS lemma,
               NULLIF(value->>'p','') AS pos,
               (value->>'z')::FLOAT8 AS zipf
        FROM jsonb_array_elements($1)) j
  WHERE NOT EXISTS (
    SELECT 1 FROM lexicon_entries e
    WHERE e.language = $2 AND e.lemma = j.lemma AND e.pos IS NOT DISTINCT FROM j.pos
  )
  RETURNING id, lemma, pos
`;

const INSERT_SENSES = `
  INSERT INTO lexicon_senses (entry_id, sense_order, definition, example, status, source)
  SELECT (j.value->>'e')::int8, (j.value->>'o')::int4, j.value->>'d', j.value->>'x',
         'ok', 'wiktionary'
  FROM jsonb_array_elements($1) AS j(value)
  ON CONFLICT DO NOTHING
`;

const INSERT_FORMS = `
  INSERT INTO lexicon_forms (language, form, entry_id, source)
  SELECT $2, lower(j.f), (j.e)::int8, 'wiktionary'
  FROM (SELECT (value->>'f') AS f, (value->>'e') AS e
        FROM jsonb_array_elements($1) AS r(value)) j
  WHERE lower(j.f) <> '' AND length(lower(j.f)) <= 100
  ON CONFLICT DO NOTHING
`;

// Promoción del stub pos=null de la lista: adopta la pos del
// Wikcionario conservando su zipf medido (va por lote, no por lema:
// cada UPDATE suelto costaría un round-trip remoto).
const UPGRADE_STUBS = `
  UPDATE lexicon_entries e
  SET pos = j.pos
  FROM (SELECT (value->>'e')::int8 AS id,
               NULLIF(value->>'p','') AS pos
        FROM jsonb_array_elements($1) AS r(value)) j
  WHERE e.id = j.id
`;

const SET_AMBIGUOUS = `
  UPDATE lexicon_forms f
  SET ambiguous = true
  FROM (SELECT language, form FROM lexicon_forms
        GROUP BY language, form HAVING count(*) > 1) multi
  WHERE f.language = multi.language AND f.form = multi.form AND NOT f.ambiguous
`;

// Las glosas del dump ya vienen limpias; esto cubre restos de
// formato wiki puntuales (negritas, enlaces) sin reescribir texto.
const cleanGloss = (raw) =>
  String(raw ?? "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/'{2,3}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DEF_CHARS);

const senseGloss = (sense) => {
  const glosses = (sense.glosses ?? [])
    .map(cleanGloss)
    .filter(Boolean);
  // Una acepción suele traer una glosa; varias son subacepciones o
  // parafrasis — se unen para no perder información.
  return glosses.join("; ").slice(0, MAX_DEF_CHARS);
};

const senseExample = (sense) => {
  for (const example of sense.examples ?? []) {
    const text = cleanGloss(example.text ?? example.example ?? "");
    if (text) return text.slice(0, MAX_EXAMPLE_CHARS);
  }
  return null;
};

const file = ["data/lexicon/es-wiktionary.jsonl.gz", "data/lexicon/es-wiktionary.jsonl"]
  .find(existsSync);
if (!file) {
  console.error(
    "Falta data/lexicon/es-wiktionary.jsonl.gz — descárgalo de\n" +
      "  https://kaikki.org/eswiktionary/Español/kaikki.org-dictionary-Español.jsonl.gz",
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query("SELECT current_database() AS db");
  console.log(`Conectado a ${rows[0].db} · origen ${file}`);

  // Estado en memoria del catálogo: qué existe y qué ya tiene
  // acepción. Todo lo demás se inserta por lotes.
  /** @type {Map<string, {id: string, pos: string | null, zipf: number | null}[]>} */
  const entriesByLemma = new Map();
  {
    const { rows: existing } = await client.query(
      "SELECT id::text AS id, lemma, pos, zipf FROM lexicon_entries WHERE language = $1",
      [LANG],
    );
    for (const row of existing) {
      const list = entriesByLemma.get(row.lemma) ?? [];
      list.push({ id: row.id, pos: row.pos, zipf: row.zipf });
      entriesByLemma.set(row.lemma, list);
    }
  }
  const sensedEntries = new Set(
    (
      await client.query(
        "SELECT DISTINCT entry_id::text AS e FROM lexicon_senses WHERE btrim(definition) <> ''",
      )
    ).rows.map((row) => row.e),
  );
  console.log(`Catálogo: ${entriesByLemma.size} lemas, ${sensedEntries.size} con acepción.`);

  /** @type {{l: string, p: string | null, z: number | null}[]} */ let pendingEntries = [];
  /** @type {{e: string, o: number, d: string, x: string | null}[]} */ let pendingSenses = [];
  /** @type {{f: string, e: string}[]} */ let pendingForms = [];
  /** @type {{e: string, p: string | null}[]} */ let pendingUpgrades = [];
  const queuedKeys = new Set(); // lemma|pos ya encolados en pendingEntries
  const nextOrder = new Map(); // entryId → siguiente sense_order
  const linkedPairs = new Set(); // form|entryId ya encolados
  const deferredForms = []; // vínculos form_of: {form, lemma, pos}

  const stats = {
    lines: 0,
    skipped: 0,
    formOf: 0,
    entriesCreated: 0,
    stubsUpgraded: 0,
    entriesFilled: 0,
    senses: 0,
    forms: 0,
    unresolvedFormOf: 0,
  };

  const entryIdFor = (lemma, pos, zipfHint) => {
    const list = entriesByLemma.get(lemma) ?? [];
    const match = list.find((entry) => entry.pos === pos);
    if (match) return match.id;
    // Stub de la lista sin pos: lo adopta la primera pos del
    // Wikcionario que llegue — conserva su zipf medido.
    const stub = list.find((entry) => entry.pos === null);
    if (stub) {
      stub.pos = pos;
      stats.stubsUpgraded += 1;
      pendingUpgrades.push({ e: stub.id, p: pos });
      return stub.id;
    }
    const key = `${lemma}|${pos ?? ""}`;
    if (queuedKeys.has(key)) return null;
    queuedKeys.add(key);
    pendingEntries.push({
      l: lemma,
      p: pos,
      // zipf es medición del lema: la copia la trae el stub del
      // mismo lema para que ninguna ficha quede sin medición.
      z: list.find((entry) => entry.zipf != null)?.zipf ?? zipfHint ?? null,
    });
    return null; // id pendiente hasta el flush
  };

  const flush = async () => {
    if (pendingUpgrades.length) {
      await client.query(UPGRADE_STUBS, [JSON.stringify(pendingUpgrades)]);
      pendingUpgrades = [];
    }
    if (pendingEntries.length) {
      const { rows: created } = await client.query(INSERT_ENTRIES, [
        JSON.stringify(pendingEntries),
        LANG,
      ]);
      for (const row of created) {
        const list = entriesByLemma.get(row.lemma) ?? [];
        list.push({ id: String(row.id), pos: row.pos, zipf: null });
        entriesByLemma.set(row.lemma, list);
      }
      stats.entriesCreated += created.length;
      pendingEntries = [];
    }
    if (pendingSenses.length) {
      const result = await client.query(INSERT_SENSES, [JSON.stringify(pendingSenses)]);
      stats.senses += result.rowCount ?? 0;
      pendingSenses = [];
    }
    if (pendingForms.length) {
      const result = await client.query(INSERT_FORMS, [JSON.stringify(pendingForms), LANG]);
      stats.forms += result.rowCount ?? 0;
      pendingForms = [];
    }
  };

  const queueSense = (entryId, definition, example) => {
    if (sensedEntries.has(entryId)) return;
    const order = nextOrder.get(entryId) ?? 1;
    if (order > MAX_SENSES) return;
    nextOrder.set(entryId, order + 1);
    pendingSenses.push({ e: entryId, o: order, d: definition, x: example });
  };

  const queueForm = (form, entryId) => {
    const key = `${form}|${entryId}`;
    if (linkedPairs.has(key)) return;
    linkedPairs.add(key);
    pendingForms.push({ f: form, e: entryId });
  };

  // Los lemas cuya entrada existe pero aún no tiene acepción y está
  // encolada esperan su id; las acepciones se aplazan junto con los
  // form_of a un segundo pase en memoria (el archivo se lee una vez).
  /** @type {{lemma: string, pos: string | null, senses: {d: string, x: string | null}[]}[]} */
  const deferredSenses = [];
  /** @type {{form: string, entryId: string}[]} */ const deferredEntryForms = [];

  const input = createReadStream(file);
  const stream = file.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    stats.lines += 1;
    if (LIMIT && stats.lines > Number(LIMIT)) break;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      stats.skipped += 1;
      continue;
    }
    const word = typeof row.word === "string" ? row.word.trim() : "";
    // Frases (espacios) no son consultables como palabra; el dump
    // también incluye claves raras sin letras.
    if (!word || /\s/.test(word) || !/\p{L}/u.test(word)) {
      stats.skipped += 1;
      continue;
    }
    const pos = Object.hasOwn(POS_MAP, row.pos) ? POS_MAP[row.pos] : null;
    if (SKIP_POS.has(row.pos)) {
      stats.skipped += 1;
      continue;
    }
    const lemma = word.toLowerCase();
    const senses = Array.isArray(row.senses) ? row.senses : [];
    const usable = senses
      .map((sense) => ({ sense, d: senseGloss(sense) }))
      .filter(({ d }) => d);
    const formTargets = new Set(
      senses.flatMap((sense) => sense.form_of ?? []).map((f) => f.word?.toLowerCase().trim()).filter(Boolean),
    );
    const onlyFormOf = usable.length > 0 && usable.every(({ sense }) => (sense.form_of ?? []).length > 0);

    // Vínculos flexión → lema: siempre se registran (también cuando
    // la línea además trae acepciones propias).
    for (const target of formTargets) deferredForms.push({ form: lemma, lemma: target, pos });
    if (onlyFormOf) {
      stats.formOf += 1;
      continue; // sin ficha propia: la glosa describe la flexión
    }
    if (!usable.length) {
      stats.skipped += 1;
      continue;
    }

    const entryId = entryIdFor(lemma, pos, null);
    if (entryId) {
      if (!sensedEntries.has(entryId)) {
        for (const { sense, d } of usable) queueSense(entryId, d, senseExample(sense));
        if (nextOrder.has(entryId)) stats.entriesFilled += 1;
        if (nextOrder.has(entryId)) sensedEntries.add(entryId);
      }
      queueForm(lemma, entryId);
      for (const form of row.forms ?? []) {
        if (typeof form.form === "string" && form.form.trim())
          queueForm(form.form.trim(), entryId);
      }
    } else {
      // Entrada encolada pero sin id: acepciones y flexiones se
      // resuelven tras el próximo flush.
      deferredSenses.push({
        lemma,
        pos,
        senses: usable.map(({ sense, d }) => ({ d, x: senseExample(sense) })),
      });
      for (const form of row.forms ?? []) {
        if (typeof form.form === "string" && form.form.trim())
          deferredEntryForms.push({ form: form.form.trim(), lemma, pos });
      }
      deferredEntryForms.push({ form: lemma, lemma, pos });
    }

    if (stats.lines % 2000 === 0) {
      await flush();
      // Reasigna lo aplazado contra ids ya conocidos.
      for (const item of deferredSenses.splice(0)) {
        const list = entriesByLemma.get(item.lemma) ?? [];
        const target =
          list.find((entry) => entry.pos === item.pos) ?? list[0];
        if (!target || sensedEntries.has(target.id)) continue;
        for (const { d, x } of item.senses) queueSense(target.id, d, x);
        if (nextOrder.has(target.id)) stats.entriesFilled += 1;
        if (nextOrder.has(target.id)) sensedEntries.add(target.id);
      }
      for (const item of deferredEntryForms.splice(0)) {
        const list = entriesByLemma.get(item.lemma) ?? [];
        const target =
          list.find((entry) => entry.pos === item.pos) ?? list[0];
        if (target) queueForm(item.form, target.id);
      }
      if (stats.lines % 50000 === 0)
        console.log(`  ${stats.lines} líneas · +${stats.entriesCreated} entradas · ${stats.senses} acepciones`);
    }
  }
  // Último pase sobre lo aplazado y vínculos form_of.
  await flush();
  for (const item of deferredSenses) {
    const list = entriesByLemma.get(item.lemma) ?? [];
    const target = list.find((entry) => entry.pos === item.pos) ?? list[0];
    if (!target || sensedEntries.has(target.id)) continue;
    for (const { d, x } of item.senses) queueSense(target.id, d, x);
    sensedEntries.add(target.id);
    stats.entriesFilled += 1;
  }
  for (const item of deferredEntryForms) {
    const list = entriesByLemma.get(item.lemma) ?? [];
    const target = list.find((entry) => entry.pos === item.pos) ?? list[0];
    if (target) queueForm(item.form, target.id);
  }
  await flush();

  // form_of diferidos: enlazan la forma al lema ya existente o
  // recién creado — preferencia por la pos de la forma misma, luego
  // cualquier ficha con acepción.
  for (const { form, lemma, pos } of deferredForms) {
    const list = entriesByLemma.get(lemma);
    if (!list?.length) {
      stats.unresolvedFormOf += 1;
      continue;
    }
    const target =
      list.find((entry) => entry.pos === pos) ??
      list.find((entry) => sensedEntries.has(entry.id)) ??
      list[0];
    queueForm(form, target.id);
    if (pendingForms.length >= BATCH) await flush();
  }
  await flush();
  await client.query(SET_AMBIGUOUS);

  await client.query(
    `INSERT INTO lexicon_sources (name, version, license, url, loaded_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      "kaikki-eswiktionary",
      "dump 2026-10-01",
      "CC BY-SA 4.0 + GFDL",
      "https://kaikki.org/eswiktionary/Español/",
      Date.now(),
    ],
  );

  const { rows: counts } = await client.query(
    `SELECT
       (SELECT count(*) FROM lexicon_entries WHERE language = $1) AS entries,
       (SELECT count(*) FROM lexicon_forms WHERE language = $1) AS forms,
       (SELECT count(*) FROM lexicon_senses) AS senses,
       (SELECT count(DISTINCT entry_id) FROM lexicon_senses) AS covered`,
    [LANG],
  );
  console.log("Listo.", stats);
  console.log(
    `Catálogo final: ${counts[0].entries} entradas, ${counts[0].forms} formas, ` +
      `${counts[0].senses} acepciones en ${counts[0].covered} fichas.`,
  );
} finally {
  await client.end();
}
