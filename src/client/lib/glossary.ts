import type { BookVocabManifest } from "./catalog";
import { isLearnablePos } from "../../shared/lexicon";

export interface GlossaryTerm {
  form: string;
  lemma: string;
  pos: string | null;
  zipf: number | null;
  isCultism: boolean;
  isSaved: boolean;
  isKnown: boolean;
}

export type GlossaryFilter = "cultisms" | "all" | "saved" | "learning";
export type GlossarySort = "rarity" | "alpha";

/**
 * Umbral de escala Zipf para considerar un término como cultismo o rareza literaria singular.
 */
export const CULTISM_ZIPF_THRESHOLD = 3.8;

/**
 * Extrae y organiza los términos del vocabulario de un libro a partir de su manifiesto.
 */
export function extractGlossaryTerms(
  manifest: BookVocabManifest,
  savedForms = new Set<string>(),
  knownLemmas = new Set<string>(),
): GlossaryTerm[] {
  const terms: GlossaryTerm[] = [];
  const seenForms = new Set<string>();

  for (const form of manifest.forms) {
    if (seenForms.has(form)) continue;
    seenForms.add(form);

    const formLow = form.toLowerCase();
    const entryIndices = manifest.byForm[form] ?? manifest.byForm[formLow] ?? [];
    if (entryIndices.length > 0) {
      const matchedEntries = entryIndices
        .map((i) => manifest.entries[i])
        .filter((e): e is NonNullable<typeof e> => e != null);

      const learnable = matchedEntries.filter((e) => isLearnablePos(e.pos));
      const pool = learnable.length > 0 ? learnable : matchedEntries;

      // Ordenar por menor zipf (la acepción más literaria/rara)
      pool.sort((a, b) => (a.zipf ?? 99) - (b.zipf ?? 99));
      const best = pool[0];

      if (best) {
        const isCultism =
          best.zipf != null && best.zipf < CULTISM_ZIPF_THRESHOLD;
        const lemma = best.lemma || form;
        const lemmaLow = lemma.toLowerCase();
        terms.push({
          form,
          lemma,
          pos: best.pos,
          zipf: best.zipf,
          isCultism,
          isSaved:
            savedForms.has(form) ||
            savedForms.has(formLow) ||
            savedForms.has(lemma) ||
            savedForms.has(lemmaLow),
          isKnown:
            knownLemmas.has(lemma) ||
            knownLemmas.has(lemmaLow) ||
            knownLemmas.has(form) ||
            knownLemmas.has(formLow),
        });
        continue;
      }
    }

    // Término sin ficha en el catálogo: neologismo, voz propia o arcaísmo de la obra
    terms.push({
      form,
      lemma: form,
      pos: null,
      zipf: null,
      isCultism: true, // Términos ausentes del catálogo estándar suelen ser arcaísmos o nombres propios
      isSaved: savedForms.has(form) || savedForms.has(formLow),
      isKnown: knownLemmas.has(form) || knownLemmas.has(formLow),
    });
  }

  return terms;
}

/**
 * Filtra y ordena los términos del glosario según búsqueda, categoría y criterio de orden.
 */
export function filterAndSortGlossary(
  terms: GlossaryTerm[],
  query: string,
  filter: GlossaryFilter,
  sort: GlossarySort,
): GlossaryTerm[] {
  const q = query.trim().toLowerCase();

  let list = terms;

  // Filtrado por búsqueda
  if (q.length > 0) {
    list = list.filter(
      (t) => t.form.toLowerCase().includes(q) || t.lemma.toLowerCase().includes(q),
    );
  }

  // Filtrado por categoría
  if (filter === "cultisms") {
    list = list.filter((t) => t.isCultism);
  } else if (filter === "saved") {
    list = list.filter((t) => t.isSaved);
  } else if (filter === "learning") {
    list = list.filter((t) => !t.isKnown && !t.isSaved);
  }

  // Ordenación
  const sorted = [...list];
  if (sort === "rarity") {
    sorted.sort((a, b) => {
      // Las raras primero (menor Zipf). Nulos al principio como singulares
      const za = a.zipf ?? 0;
      const zb = b.zipf ?? 0;
      if (za !== zb) return za - zb;
      return a.form.localeCompare(b.form, "es");
    });
  } else {
    // Alfabético
    sorted.sort((a, b) => a.form.localeCompare(b.form, "es"));
  }

  return sorted;
}

/**
 * Traduce una medición Zipf a una etiqueta humana y serena.
 */
export function formatZipfLabel(zipf: number | null): string {
  if (zipf == null) return "Voz particular de la obra";
  if (zipf < 2.5) return "Cultismo muy raro";
  if (zipf < CULTISM_ZIPF_THRESHOLD) return "Término literario";
  if (zipf < 4.8) return "Poco frecuente";
  return "Frecuente";
}
