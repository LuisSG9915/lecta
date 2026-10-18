// Predicado compartido de cobertura léxica: una forma está cubierta
// cuando alguna ficha trae al menos una acepción no vacía, no por
// existir una entrada huérfana en lexicon_entries.
export type LexiconSenseLike = { definition?: string | null };
export type LexiconEntryLike = { senses?: LexiconSenseLike[] };

export type LexiconEntry = {
  entryId: string | null;
  lemma: string;
  pos: string | null;
  freqRank: number | null;
  zipf: number | null;
  senses: { definition: string; example: string | null; senseOrder: number | null }[];
};

export function hasUsableDefinition(entries: readonly LexiconEntryLike[] | undefined) {
  return (entries ?? []).some((entry) =>
    (entry.senses ?? []).some(
      (sense) => typeof sense.definition === "string" && sense.definition.trim().length > 0,
    ),
  );
}

// Medición zipf de una forma consultada. Una misma forma puede traer
// fichas sin medición junto a otras medidas (p. ej. «decirle» tiene
// ficha propia del Wikcionario sin zipf y la ficha medida de
// «decir»): tomar la primera ficha perdería una medición que sí
// existe. Se prefiere la ficha del lema pedido —la acepción que la
// evidencia declara— y si ninguna está medida se cae a la primera
// lectura medida, que suele ser el lema base de la forma.
export type ZipfMeasuredLike = { lemma?: string | null; zipf?: number | null };

export function measuredZipf(
  entries: readonly ZipfMeasuredLike[] | undefined,
  preferredLemma?: string,
): number | null {
  let fallback: number | null = null;
  for (const entry of entries ?? []) {
    if (typeof entry.zipf !== "number" || !Number.isFinite(entry.zipf)) continue;
    if (preferredLemma != null && entry.lemma === preferredLemma) return entry.zipf;
    fallback ??= entry.zipf;
  }
  return fallback;
}

// Categorías gramaticales que no son vocabulario aprendible: una
// ficha con esta pos jamás se sugiere al lector, sea cual sea su
// medición. «determinante» cubre lo que la IA llama «artículo» (el
// volcado del Wikcionario mapea article/det → determinante);
// partículas, contracciones y abreviaturas producen el mismo ruido.
// Valores del catálogo que sí son vocabulario —sustantivo, verbo,
// adjetivo, adverbio, locución, participio, proverbio, nombre
// propio— quedan fuera de la lista a propósito.
const NON_LEARNABLE_POS = new Set([
  "numeral",
  "interjección",
  "pronombre",
  "artículo",
  "determinante",
  "preposición",
  "conjunción",
  "partícula",
  "contracción",
  "abreviatura",
]);

// pos null/vacía no excluye: fichas sin categoría (cargas iniciales
// o fuentes sin pos) se comportan como vocabulario normal.
export function isLearnablePos(pos: string | null | undefined): boolean {
  return pos == null || !NON_LEARNABLE_POS.has(pos.trim().toLowerCase());
}
