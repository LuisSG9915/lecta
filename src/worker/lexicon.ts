import type pg from "pg";
import { ENRICHMENT_MODEL, ENRICHMENT_PROMPT_VERSION } from "./ai";
import { hasUsableDefinition } from "../shared/lexicon";

export type LookupRow = {
  // lexicon_entries.id es INT8 de unique_rowid() (~1.2e18 > 2^53):
  // node-pg ya lo devuelve como string; convertirlo a number lo
  // truncaría (…305 → …300) y rompería reportes e ítems.
  entry_id: string | null;
  lemma: string;
  pos: string | null;
  freq_rank: number | null;
  zipf: number | null;
  definition: string | null;
  example: string | null;
  sense_order: number | null;
};

export type LexiconEntryView = {
  entryId: string | null;
  lemma: string;
  pos: string | null;
  freqRank: number | null;
  // Frecuencia medida (wordfreq), escala ~0–8; puede ser null si la
  // entrada nunca pasó por la medición (p. ej. enriquecimientos IA).
  zipf: number | null;
  senses: { definition: string; example: string | null; senseOrder: number | null }[];
};

const LOOKUP_SQL = `
  SELECT e.id AS entry_id, e.lemma, e.pos, e.freq_rank, e.zipf, s.definition, s.example, s.sense_order
  FROM lexicon_forms f
  JOIN lexicon_entries e ON e.id = f.entry_id
  LEFT JOIN lexicon_senses s ON s.entry_id = e.id
  WHERE f.language = $1 AND f.form = lower($2)
  ORDER BY e.freq_rank NULLS LAST, s.sense_order
  LIMIT 40
`;

export function groupEntries(rows: LookupRow[]) {
  const entries = new Map<string, LexiconEntryView>();
  for (const row of rows) {
    const key = `${row.lemma}::${row.pos ?? ""}`;
    const entry = entries.get(key) ?? {
      entryId: row.entry_id != null ? String(row.entry_id) : null,
      lemma: row.lemma,
      pos: row.pos,
      freqRank: row.freq_rank,
      zipf: row.zipf != null ? Number(row.zipf) : null,
      senses: [],
    };
    if (row.definition)
      entry.senses.push({
        definition: row.definition,
        example: row.example,
        senseOrder: row.sense_order != null ? Number(row.sense_order) : null,
      });
    entries.set(key, entry);
  }
  return [...entries.values()];
}

export async function findEntries(client: pg.Client, language: string, form: string) {
  const { rows } = await client.query<LookupRow>(LOOKUP_SQL, [language, form]);
  return groupEntries(rows);
}

// El límite se aplica a las FORMAS consultadas (abajo), nunca a las
// filas del join: una forma con varias acepciones genera varias filas y
// un LIMIT aquí recortaba fichas sin aviso.
const BATCH_SQL = `
  SELECT f.form AS queried_form, e.id AS entry_id, e.lemma, e.pos, e.freq_rank, e.zipf, s.definition, s.example, s.sense_order
  FROM lexicon_forms f
  JOIN lexicon_entries e ON e.id = f.entry_id
  LEFT JOIN lexicon_senses s ON s.entry_id = e.id
  WHERE f.language = $1 AND f.form = ANY($2)
  ORDER BY f.form, e.freq_rank NULLS LAST, s.sense_order
`;

const MAX_FORMS_PER_BATCH = 2000;

export async function findEntriesForForms(client: pg.Client, language: string, forms: string[]) {
  const normalized = [
    ...new Set(forms.map((form) => form.trim().toLowerCase()).filter(Boolean)),
  ].slice(0, MAX_FORMS_PER_BATCH);
  if (!normalized.length) return {};
  const { rows } = await client.query<LookupRow & { queried_form: string }>(BATCH_SQL, [
    language,
    normalized,
  ]);
  const byForm = new Map<string, LookupRow[]>();
  for (const row of rows) {
    const list = byForm.get(row.queried_form);
    if (list) list.push(row);
    else byForm.set(row.queried_form, [row]);
  }
  return Object.fromEntries(
    [...byForm.entries()].map(([form, grouped]) => [form, groupEntries(grouped)]),
  );
}

// ---------- Muestra para la calibración inicial ----------
//
// La prueba de vocabulario necesita lemas repartidos por bandas de
// frecuencia (zipf); la definición se trae cuando el catálogo la
// tiene — sin ella la fila igual se ofrece (solo no hay revelado al
// marcarla). Una sola consulta: DISTINCT ON (lemma) evita que el
// mismo lema salte dos veces por sus entradas de distinta categoría;
// ROW_NUMBER por banda con ORDER BY RANDOM() da la selección al azar
// y `pick <= SAMPLE_FETCH_PER_BAND` deja margen para rellenar las
// bandas que queden cortas desde las vecinas (abajo).

const SAMPLE_BANDS = 6;
const SAMPLE_PER_BAND = 6;
const SAMPLE_TOTAL = SAMPLE_BANDS * SAMPLE_PER_BAND;
// Límite de candidatas por banda: basta para que una banda pueda
// cubrir sola toda la muestra si las demás vinieran vacías.
const SAMPLE_FETCH_PER_BAND = SAMPLE_TOTAL;

// Bandas [2.0,2.5) … [4.5,5.0): floor((zipf-2)/0.5) → 0..5.
// El LEFT JOIN filtra las acepciones vacías en el ON (no en el
// WHERE, que eliminaría entradas sin ficha) y el ORDER BY prefiere
// las filas con definición: cada lema se queda con su primera
// acepción no vacía si existe, o con null si ninguna la tiene.
const SAMPLE_SQL = `
  WITH candidates AS (
    SELECT DISTINCT ON (e.lemma) e.lemma, e.zipf, s.definition
    FROM lexicon_entries e
    LEFT JOIN lexicon_senses s
      ON s.entry_id = e.id AND btrim(s.definition) <> ''
    WHERE e.language = $1
      AND e.zipf >= 2.0 AND e.zipf < 5.0
    ORDER BY e.lemma, (s.definition IS NULL), e.id, s.sense_order
  ),
  banded AS (
    SELECT lemma, definition,
           floor((zipf - 2.0) / 0.5)::int4 AS band,
           row_number() OVER (
             PARTITION BY floor((zipf - 2.0) / 0.5)
             ORDER BY random()
           ) AS pick
    FROM candidates
  )
  SELECT lemma, definition, band
  FROM banded
  WHERE pick <= $2
  ORDER BY band, pick
`;

export type SampleWord = { lemma: string; definition: string | null };

// Devuelve hasta 36 lemas, 6 por banda de zipf, cada uno con su
// primera acepción no vacía cuando el catálogo la tiene (definition
// sale null si ninguna la tiene). Si alguna banda no llena su cupo,
// las sobrantes de las vecinas completan la muestra.
export async function sampleForCalibration(
  client: pg.Client,
  language: string,
): Promise<SampleWord[]> {
  const { rows } = await client.query<{
    lemma: string;
    definition: string | null;
    band: number;
  }>(SAMPLE_SQL, [language, SAMPLE_FETCH_PER_BAND]);

  const byBand: { lemma: string; definition: string | null }[][] = Array.from(
    { length: SAMPLE_BANDS },
    () => [],
  );
  for (const row of rows) {
    if (row.band >= 0 && row.band < SAMPLE_BANDS) byBand[row.band].push(row);
  }
  const picked = byBand.flatMap((band) => band.slice(0, SAMPLE_PER_BAND));
  if (picked.length < SAMPLE_TOTAL) {
    const spare = byBand.flatMap((band) => band.slice(SAMPLE_PER_BAND));
    picked.push(...spare.slice(0, SAMPLE_TOTAL - picked.length));
  }
  return picked;
}

export type ValidatedEnrichment = {
  lemma: string;
  pos: string;
  freqRank: number | null;
  forms: string[];
  senses: { definition: string; example: string | null }[];
};

export type EnrichmentJob = {
  form: string;
  entryId: string | null;
};

// Convierte formas pedidas en trabajos IA reales: una forma cubierta
// por cualquier acepción útil no gasta cuota; varias formas sin ficha
// que resuelven a la misma entrada comparten una sola generación.
export function pendingEnrichmentJobs(
  forms: string[],
  entriesByForm: Record<string, LexiconEntryView[]>,
): EnrichmentJob[] {
  const jobs: EnrichmentJob[] = [];
  const seenForms = new Set<string>();
  const seenEntries = new Set<string>();
  for (const raw of forms) {
    const form = raw.trim().toLowerCase();
    if (!form || seenForms.has(form)) continue;
    seenForms.add(form);
    const entries = entriesByForm[form] ?? [];
    if (hasUsableDefinition(entries)) continue;
    const entryId = entries[0]?.entryId ?? null;
    if (entryId) {
      const key = `id:${entryId}`;
      if (seenEntries.has(key)) continue;
      seenEntries.add(key);
    }
    jobs.push({ form, entryId });
  }
  return jobs;
}

export async function insertEnrichment(
  client: pg.Client,
  language: string,
  enrichment: ValidatedEnrichment,
  requestedForm?: string,
) {
  await client.query("BEGIN");
  try {
    const { rows: sameLemma } = await client.query<{ id: string; pos: string | null }>(
      `SELECT id, pos FROM lexicon_entries
       WHERE language = $1 AND lemma = $2
       ORDER BY id`,
      [language, enrichment.lemma],
    );
    const matchingPos = sameLemma.find((row) => row.pos === enrichment.pos);
    const emptyCatalogRow = sameLemma.find((row) => row.pos === null);
    const target = matchingPos ?? emptyCatalogRow;
    let entryId = target?.id;
    if (entryId) {
      // La fila cargada desde fuentes puede venir sin pos ni fichas:
      // la completa sin crear un lema duplicado ni tocar su zipf medido.
      await client.query(
        `UPDATE lexicon_entries
         SET pos = COALESCE(pos, $2),
             freq_rank = COALESCE(freq_rank, $3),
             status = 'ok', model_version = $4, prompt_version = $5
         WHERE id = $1`,
        [entryId, enrichment.pos, enrichment.freqRank, ENRICHMENT_MODEL, ENRICHMENT_PROMPT_VERSION],
      );
    } else {
      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO lexicon_entries (language, lemma, pos, freq_rank, source, status, model_version, prompt_version)
         VALUES ($1, $2, $3, $4, 'ai', 'ok', $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          language,
          enrichment.lemma,
          enrichment.pos,
          enrichment.freqRank,
          ENRICHMENT_MODEL,
          ENRICHMENT_PROMPT_VERSION,
        ],
      );
      entryId = inserted[0]?.id;
      if (!entryId) {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM lexicon_entries
           WHERE language = $1 AND lemma = $2 AND pos IS NOT DISTINCT FROM $3`,
          [language, enrichment.lemma, enrichment.pos],
        );
        entryId = rows[0]?.id;
      }
    }
    if (!entryId) throw new Error("No se pudo registrar la entrada.");

    const linkedForms = new Set(
      [requestedForm, enrichment.lemma, ...enrichment.forms]
        .filter((form): form is string => Boolean(form?.trim()))
        .map((form) => form.toLowerCase()),
    );
    for (const form of linkedForms) {
      await client.query(
        `INSERT INTO lexicon_forms (language, form, entry_id, source)
         VALUES ($1, lower($2), $3, 'ai')
         ON CONFLICT DO NOTHING`,
        [language, form, entryId],
      );
    }
    for (const [index, sense] of enrichment.senses.entries()) {
      await client.query(
        `INSERT INTO lexicon_senses (entry_id, sense_order, definition, example, status)
         VALUES ($1, $2, $3, $4, 'ok')
         ON CONFLICT DO NOTHING`,
        [entryId, index + 1, sense.definition, sense.example],
      );
    }
    await client.query("COMMIT");
    return entryId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
