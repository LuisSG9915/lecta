// Relleno diferido de `meaning` en palabras del Cuaderno: una
// palabra se puede guardar sin ficha («Se guardará sin ficha») y la
// definición puede llegar después — la carga del Wikcionario, una
// ficha IA posterior o el lote de enriquecimiento del lector. Sin
// este paso esas palabras quedaban vacías para siempre y no podían
// entrar a los repasos por significado.
//
// No crea ni borra conocimiento: solo completa campos léxicos
// vacíos con lo que el catálogo ya tiene. La acepción elegida es la
// primera con definición (o la que corresponde a la guardada),
// igual que la ficha principal de WordPanel.

import { hasUsableDefinition } from "../../shared/lexicon";
import { updateSavedWord, type SavedWord } from "./idb";
import { batchLookup, type BatchLookupResult, type LexiconEntry } from "./lexicon";
import { pushWordsToServer } from "./vocab";

// Campos a rellenar de una palabra guardada sin significado, a
// partir de las fichas del catálogo. Nunca pisa datos existentes:
// solo completa lo vacío. Devuelve null si no hay nada que aportar.
export function planMeaningBackfill(
  word: SavedWord,
  entries: LexiconEntry[] | undefined,
): Pick<SavedWord, "meaning" | "lemma" | "pos" | "senseEntryId" | "senseOrder"> | null {
  if (word.meaning?.trim()) return null;
  const usable = (entries ?? []).filter((entry) => hasUsableDefinition([entry]));
  if (!usable.length) return null;
  // La acepción guardada manda si sigue en el catálogo; si no, la
  // primera ficha con definición (criterio de la ficha principal).
  const entry =
    (word.senseEntryId != null &&
      usable.find((item) => item.entryId === String(word.senseEntryId))) ||
    usable[0];
  const sense = entry.senses.find((item) => item.definition?.trim());
  if (!sense) return null;
  return {
    meaning: sense.definition,
    lemma: word.lemma ?? entry.lemma,
    pos: word.pos ?? entry.pos,
    senseEntryId: word.senseEntryId ?? entry.entryId,
    senseOrder: word.senseOrder ?? sense.senseOrder,
  };
}

export type BackfillDeps = {
  lookup?: (forms: string[], lang: string) => Promise<BatchLookupResult>;
  save?: (word: SavedWord) => Promise<unknown>;
  push?: (words: SavedWord[]) => Promise<boolean>;
};

// Consulta el catálogo por las palabras sin significado y escribe lo
// que encuentre. Devuelve la lista en el mismo orden con los cambios
// aplicados (el llamador la usa directo para refrescar la vista).
// Fallos de catálogo/red dejan todo igual: es un relleno auxiliar.
export async function backfillWordMeanings(
  words: SavedWord[],
  deps: BackfillDeps = {},
): Promise<SavedWord[]> {
  const { lookup = batchLookup, save = updateSavedWord, push = pushWordsToServer } = deps;
  const pending = words.filter((word) => !word.deleted && !word.meaning?.trim());
  if (!pending.length) return words;

  const languages = [...new Set(pending.map((word) => word.language || "es"))];
  const results = await Promise.all(
    languages.map((language) =>
      lookup(
        pending
          .filter((word) => (word.language || "es") === language)
          .map((word) => word.form),
        language,
      ).catch((): BatchLookupResult => ({ ok: false, error: "", entries: {} })),
    ),
  );

  const updated: SavedWord[] = [];
  results.forEach((result, index) => {
    if (!result.ok) return;
    const language = languages[index];
    for (const word of pending) {
      if ((word.language || "es") !== language) continue;
      const patch = planMeaningBackfill(
        word,
        result.entries[word.form.toLowerCase()] ?? result.entries[word.form],
      );
      if (patch) updated.push({ ...word, ...patch });
    }
  });
  if (!updated.length) return words;

  for (const word of updated) await save(word);
  void push(updated);
  const byKey = new Map(updated.map((word) => [word.key, word]));
  return words.map((word) => byKey.get(word.key) ?? word);
}
