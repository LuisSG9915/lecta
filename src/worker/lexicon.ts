import type pg from "pg";

export type LookupRow = {
  lemma: string;
  pos: string | null;
  freq_rank: number | null;
  definition: string | null;
  example: string | null;
  sense_order: number | null;
};

export type LexiconEntryView = {
  lemma: string;
  pos: string | null;
  freqRank: number | null;
  senses: { definition: string; example: string | null }[];
};

const LOOKUP_SQL = `
  SELECT e.lemma, e.pos, e.freq_rank, s.definition, s.example, s.sense_order
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
      lemma: row.lemma,
      pos: row.pos,
      freqRank: row.freq_rank,
      senses: [],
    };
    if (row.definition) entry.senses.push({ definition: row.definition, example: row.example });
    entries.set(key, entry);
  }
  return [...entries.values()];
}

export async function findEntries(client: pg.Client, language: string, form: string) {
  const { rows } = await client.query<LookupRow>(LOOKUP_SQL, [language, form]);
  return groupEntries(rows);
}

const BATCH_SQL = `
  SELECT f.form AS queried_form, e.lemma, e.pos, e.freq_rank, s.definition, s.example, s.sense_order
  FROM lexicon_forms f
  JOIN lexicon_entries e ON e.id = f.entry_id
  LEFT JOIN lexicon_senses s ON s.entry_id = e.id
  WHERE f.language = $1 AND f.form = ANY($2)
  ORDER BY f.form, e.freq_rank NULLS LAST, s.sense_order
  LIMIT 2000
`;

export async function findEntriesForForms(client: pg.Client, language: string, forms: string[]) {
  const normalized = [...new Set(forms.map((form) => form.trim().toLowerCase()).filter(Boolean))];
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

export type ValidatedEnrichment = {
  lemma: string;
  pos: string;
  freqRank: number | null;
  forms: string[];
  senses: { definition: string; example: string | null }[];
};

export async function insertEnrichment(
  client: pg.Client,
  language: string,
  enrichment: ValidatedEnrichment,
) {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO lexicon_entries (language, lemma, pos, freq_rank)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [language, enrichment.lemma, enrichment.pos, enrichment.freqRank],
    );
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM lexicon_entries
       WHERE language = $1 AND lemma = $2 AND pos IS NOT DISTINCT FROM $3`,
      [language, enrichment.lemma, enrichment.pos],
    );
    const entryId = rows[0]?.id;
    if (!entryId) throw new Error("No se pudo registrar la entrada.");

    for (const form of new Set([enrichment.lemma, ...enrichment.forms])) {
      await client.query(
        `INSERT INTO lexicon_forms (language, form, entry_id)
         VALUES ($1, lower($2), $3)
         ON CONFLICT DO NOTHING`,
        [language, form, entryId],
      );
    }
    for (const [index, sense] of enrichment.senses.entries()) {
      await client.query(
        `INSERT INTO lexicon_senses (entry_id, sense_order, definition, example)
         VALUES ($1, $2, $3, $4)
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
