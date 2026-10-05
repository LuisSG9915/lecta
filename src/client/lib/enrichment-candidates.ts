import type { SectionPrediction } from "./knowledge";

// Selección del lote automático: primero las predichas que tienen
// entrada pero ninguna acepción (huecos del catálogo), luego las sin
// ficha. Se excluye conocimiento explícito «conocida», formas solo
// capitalizadas y duplicados por entrada/forma. Devuelve las formas
// reales consultadas; el servidor decide si comparten trabajo.
export function selectEnrichmentCandidates(
  prediction: SectionPrediction,
  capitalOnly: ReadonlySet<string>,
  knowledge: ReadonlyMap<string, { lemma: string; known: boolean }>,
  cap: number,
): string[] {
  const selected: string[] = [];
  const seenForms = new Set<string>();
  const seenEntries = new Set<string>();

  const knownExplicitly = (form: string, lemma?: string | null) =>
    knowledge.get(form)?.known === true ||
    (lemma ? knowledge.get(lemma.toLowerCase())?.known === true : false);

  const add = (form: string, entryId?: string | null, lemma?: string | null) => {
    if (selected.length >= cap) return;
    if (!form || capitalOnly.has(form) || seenForms.has(form)) return;
    if (knownExplicitly(form, lemma)) return;
    if (entryId) {
      const key = `id:${entryId}`;
      if (seenEntries.has(key)) return;
      seenEntries.add(key);
    }
    seenForms.add(form);
    selected.push(form);
  };

  for (const item of prediction.predicted)
    if (!item.entry.senses.length)
      add(item.form, item.entry.entryId, item.entry.lemma);
  for (const form of prediction.missing) add(form);
  return selected;
}

// Palabras del Cuaderno sin definición: el lector ya declaró que no
// las sabe, así que definirlas vale más que perseguir candidatas del
// análisis. El servidor vuelve a verificar si hacen falta
// (pendingEnrichmentJobs), así que aquí basta filtrar duplicados y lo
// ya pedido en esta sesión de lectura.
export function selectSavedForEnrichment(
  words: readonly { form: string; meaning?: string }[],
  alreadySent: ReadonlySet<string>,
  cap: number,
): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (selected.length >= cap) break;
    const form = word.form.trim().toLowerCase();
    if (!form || word.meaning || seen.has(form) || alreadySent.has(form)) continue;
    seen.add(form);
    selected.push(word.form);
  }
  return selected;
}
