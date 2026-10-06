// Predicado compartido de cobertura léxica: una forma está cubierta
// cuando alguna ficha trae al menos una acepción no vacía, no por
// existir una entrada huérfana en lexicon_entries.
export type LexiconSenseLike = { definition?: string | null };
export type LexiconEntryLike = { senses?: LexiconSenseLike[] };

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
