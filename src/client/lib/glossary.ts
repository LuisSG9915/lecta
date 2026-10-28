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
  isConsulted?: boolean;
}

export type GlossaryFilter = "cultisms" | "all" | "saved" | "learning" | "consulted";
export type GlossarySort = "rarity" | "alpha" | "alpha-desc" | "frequency";

/**
 * Umbral de escala Zipf para considerar un término como cultismo o rareza literaria singular.
 */
export const CULTISM_ZIPF_THRESHOLD = 3.8;

/**
 * Extrae la letra inicial en mayúsculas, normalizando tildes pero conservando la Ñ.
 */
export function getInitialLetter(word: string): string {
  const trimmed = word.trim();
  if (!trimmed) return "";
  const first = trimmed.charAt(0).toUpperCase();
  if (first === "Ñ") return "Ñ";
  const normalized = first.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/^[A-Z]$/.test(normalized)) {
    return normalized;
  }
  return "#";
}

/**
 * Normaliza la categoría gramatical para filtros generales (sustantivo, adjetivo, verbo, etc.).
 */
export function normalizePosCategory(pos: string | null | undefined): string | null {
  if (!pos) return null;
  const p = pos.toLowerCase();
  if (p === "propio" || p.includes("personaje")) return "propio";
  if (p.includes("sust") || p.includes("nombre")) return "sustantivo";
  if (p.includes("adj")) return "adjetivo";
  if (p.includes("verb") || p.startsWith("v.") || p === "v") return "verbo";
  if (p.includes("adv")) return "adverbio";
  return "otro";
}

/**
 * Obtiene el conjunto de letras iniciales disponibles en una lista de términos.
 */
export function getAvailableLetters(terms: GlossaryTerm[]): Set<string> {
  const letters = new Set<string>();
  for (const t of terms) {
    const l = getInitialLetter(t.form);
    if (l) letters.add(l);
  }
  return letters;
}

/**
 * Extrae y organiza los términos del vocabulario de un libro a partir de su manifiesto.
 */
export function extractGlossaryTerms(
  manifest: BookVocabManifest,
  savedForms = new Set<string>(),
  knownLemmas = new Set<string>(),
  consultedForms = new Set<string>(),
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
          isConsulted:
            consultedForms.has(form) ||
            consultedForms.has(formLow) ||
            consultedForms.has(lemma) ||
            consultedForms.has(lemmaLow),
        });
        continue;
      }
    }

    // Término sin ficha en el catálogo: neologismo, voz propia o arcaísmo de la obra
    const isCap = /^[A-ZÁÉÍÓÚÜÑ]/.test(form.trim());
    terms.push({
      form,
      lemma: form,
      pos: isCap ? "propio" : null,
      zipf: null,
      isCultism: true, // Términos ausentes del catálogo estándar suelen ser arcaísmos o nombres propios
      isSaved: savedForms.has(form) || savedForms.has(formLow),
      isKnown: knownLemmas.has(form) || knownLemmas.has(formLow),
      isConsulted: consultedForms.has(form) || consultedForms.has(formLow),
    });
  }

  return terms;
}

/**
 * Filtra y ordena los términos del glosario según búsqueda, categoría y criterio de orden,
 * con soporte opcional para letra inicial y categoría gramatical.
 */
export function filterAndSortGlossary(
  terms: GlossaryTerm[],
  query: string,
  filter: GlossaryFilter,
  sort: GlossarySort,
  letter?: string | null,
  posCategory?: string | null,
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
  } else if (filter === "consulted") {
    list = list.filter((t) => t.isConsulted);
  } else if (filter === "learning") {
    list = list.filter((t) => !t.isKnown && !t.isSaved);
  }

  // Filtrado por letra inicial
  if (letter) {
    list = list.filter((t) => getInitialLetter(t.form) === letter);
  }

  // Filtrado por categoría gramatical (POS)
  if (posCategory && posCategory !== "all") {
    list = list.filter((t) => normalizePosCategory(t.pos) === posCategory);
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
  } else if (sort === "frequency") {
    sorted.sort((a, b) => {
      // Mayor Zipf primero (frecuentes primero). Nulos al final
      const za = a.zipf ?? -1;
      const zb = b.zipf ?? -1;
      if (za !== zb) return zb - za;
      return a.form.localeCompare(b.form, "es");
    });
  } else if (sort === "alpha-desc") {
    sorted.sort((a, b) => b.form.localeCompare(a.form, "es"));
  } else {
    // Alfabético A–Z
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
