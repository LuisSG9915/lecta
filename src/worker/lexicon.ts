import type pg from "pg";
import { ENRICHMENT_MODEL, ENRICHMENT_PROMPT_VERSION } from "./ai";
import { hasUsableDefinition } from "../shared/lexicon";
import {
  CALIBRATION_PER_BAND,
  calibrationBandIndex,
  calibrationBankFor,
  calibrationBankLemmas,
  calibrationFallbackDefinition,
  type CalibrationProfile,
} from "../shared/calibration-bank";

// El catálogo léxico es dato de referencia compartido (no datos de
// usuario): las tablas lexicon_* viven en lecta_dev y producción las
// consulta por nombre calificado sobre el mismo cluster. Así la
// carga del Wikcionario (≈2 M de filas) no se duplica ni gasta RUs
// dos veces; los datos por cuenta siguen en la base de cada entorno.
export const CATALOG = "lecta_dev.";

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
  FROM ${CATALOG}lexicon_forms f
  JOIN ${CATALOG}lexicon_entries e ON e.id = f.entry_id
  LEFT JOIN ${CATALOG}lexicon_senses s ON s.entry_id = e.id
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
  FROM ${CATALOG}lexicon_forms f
  JOIN ${CATALOG}lexicon_entries e ON e.id = f.entry_id
  LEFT JOIN ${CATALOG}lexicon_senses s ON s.entry_id = e.id
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
// La muestra sale del banco editorial de shared/calibration-bank:
// lemas revisados con definición cargada, verificados contra su
// banda zipf en el catálogo. El examen deja así de ofrecer fichas
// sin sentido para el propósito («step», «jalifa») aunque existan en
// el catálogo. Una sola consulta trae todas las fichas del banco;
// para cada lema se elige la ficha dominante — la que tiene más
// acepciones con definición, criterio que en las homonimias revisadas
// (ciego, cuarto, paciente, parco) siempre escoge la lectura común—
// y solo entra a la muestra si su zipf medido cae en la banda que el
// banco declara: una medición que se mueva no arrastra al lema fuera
// de lugar silenciosamente.

const SAMPLE_BANK_SQL = `
  SELECT e.id, e.lemma, e.pos, e.zipf,
         (SELECT s.definition FROM ${CATALOG}lexicon_senses s
           WHERE s.entry_id = e.id AND btrim(coalesce(s.definition, '')) <> ''
           ORDER BY s.sense_order LIMIT 1) AS definition,
         (SELECT count(*)::int4 FROM ${CATALOG}lexicon_senses sc
           WHERE sc.entry_id = e.id
             AND btrim(coalesce(sc.definition, '')) <> '') AS def_count
    FROM ${CATALOG}lexicon_entries e
   WHERE e.language = $1 AND e.lemma = ANY($2)
`;

export type SampleWord = { lemma: string; definition: string | null };

const shuffle = <T,>(list: T[]): T[] => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

// Devuelve hasta 18 lemas (3 por banda, tres pasos de seis). Si una
// banda queda corta se devuelve menos — la insuficiencia es visible,
// no se rellena con lemas de otra banda.
export async function sampleForCalibration(
  client: pg.Client,
  language: string,
  profile: CalibrationProfile = "native",
): Promise<SampleWord[]> {
  const bank = calibrationBankFor(profile, language);
  const { rows } = await client.query<{
    id: string;
    lemma: string;
    pos: string | null;
    zipf: number | null;
    definition: string | null;
    def_count: number;
  }>(SAMPLE_BANK_SQL, [language, calibrationBankLemmas(language, profile)]);

  const byLemma = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byLemma.get(row.lemma);
    if (list) list.push(row);
    else byLemma.set(row.lemma, [row]);
  }

  const picked: SampleWord[] = [];
  for (let band = 0; band < bank.length; band++) {
    const eligible = bank[band].flatMap((lemma) => {
      const entries = byLemma.get(lemma) ?? [];
      // La ficha dominante es la de más acepciones con definición; a
      // empate gana el id de entrada menor — determinista, no depende
      // del orden en que Postgres devolvió las filas. (Más acepciones
      // es solo heurística de lectura común, no certeza de sentido.)
      const dominant = entries
        .filter((row) => row.definition != null)
        .sort(
          (a, b) =>
            b.def_count - a.def_count ||
            (BigInt(a.id) < BigInt(b.id)
              ? -1
              : BigInt(a.id) > BigInt(b.id)
                ? 1
                : 0),
        )[0];
      if (
        dominant &&
        dominant.zipf != null &&
        calibrationBandIndex(dominant.zipf, profile, language) === band
      ) {
        return [{ lemma, definition: dominant.definition }];
      }
      if (language === "en") {
        const fallbackDef = calibrationFallbackDefinition(lemma, "en");
        if (fallbackDef) {
          return [{ lemma, definition: fallbackDef }];
        }
      }
      return [];
    });
    picked.push(...shuffle(eligible).slice(0, CALIBRATION_PER_BAND));
  }
  return shuffle(picked);
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
      `SELECT id, pos FROM ${CATALOG}lexicon_entries
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
        `UPDATE ${CATALOG}lexicon_entries
         SET pos = COALESCE(pos, $2),
             freq_rank = COALESCE(freq_rank, $3),
             status = 'ok', model_version = $4, prompt_version = $5
         WHERE id = $1`,
        [entryId, enrichment.pos, enrichment.freqRank, ENRICHMENT_MODEL, ENRICHMENT_PROMPT_VERSION],
      );
    } else {
      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO ${CATALOG}lexicon_entries (language, lemma, pos, freq_rank, source, status, model_version, prompt_version)
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
          `SELECT id FROM ${CATALOG}lexicon_entries
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
        `INSERT INTO ${CATALOG}lexicon_forms (language, form, entry_id, source)
         VALUES ($1, lower($2), $3, 'ai')
         ON CONFLICT DO NOTHING`,
        [language, form, entryId],
      );
    }
    for (const [index, sense] of enrichment.senses.entries()) {
      await client.query(
        `INSERT INTO ${CATALOG}lexicon_senses (entry_id, sense_order, definition, example, status, source)
         VALUES ($1, $2, $3, $4, 'ok', 'ai')
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
