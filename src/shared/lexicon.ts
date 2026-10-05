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
