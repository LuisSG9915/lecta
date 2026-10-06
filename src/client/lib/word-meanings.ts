// Relleno diferido de `meaning` en palabras del Cuaderno: una
// palabra se puede guardar sin ficha («Se guardará sin ficha») y la
// definición puede llegar después — la carga del Wikcionario, una
// ficha IA posterior o el lote de enriquecimiento del lector. Sin
// este paso esas palabras quedaban vacías para siempre y no podían
// entrar a los repasos por significado.
//
// No crea ni borra conocimiento: solo completa campos léxicos
// vacíos con lo que el catálogo ya tiene, y lo hace por
// compare-and-set para no revivir lápidas ni pisar repasos
// ocurridos mientras se consultaba el catálogo.

import { batchLookup, type BatchLookupResult, type LexiconEntry } from "./lexicon";
import {
  captureDbScope,
  fillSavedWordMeaning,
  isDbScopeActive,
  type DbScope,
  type SavedWord,
} from "./idb";
import { hasUsableDefinition } from "../../shared/lexicon";
import { pushWordsToServer } from "./vocab";

const usableSenses = (entry: LexiconEntry) =>
  entry.senses.filter((sense) => sense.definition?.trim());

type MeaningPatch = Pick<
  SavedWord,
  "meaning" | "lemma" | "pos" | "senseEntryId" | "senseOrder"
>;

// Decide qué definición y campos léxicos rellenar para una palabra
// guardada sin significado, a partir del catálogo. La referencia de
// acepción guardada manda: con pareja entryId+senseOrder se usa
// exactamente ese sentido (si ya no existe o quedó vacío no se
// reasigna otra — queda para revisión manual); con solo entryId se
// completa el orden con el primer sentido útil de esa ficha; sin
// referencia se prefiere la ficha del propio lema y luego la primera
// con definición. Nunca pisa campos ya guardados.
export function planMeaningBackfill(
  word: SavedWord,
  entries: LexiconEntry[] | undefined,
): MeaningPatch | null {
  if (word.meaning?.trim()) return null;
  const usable = (entries ?? []).filter((entry) => hasUsableDefinition([entry]));
  if (!usable.length) return null;

  const fill = (
    entry: LexiconEntry,
    sense: LexiconEntry["senses"][number],
  ): MeaningPatch => ({
    meaning: sense.definition,
    lemma: word.lemma ?? entry.lemma,
    pos: word.pos ?? entry.pos,
    senseEntryId: word.senseEntryId ?? entry.entryId,
    senseOrder: word.senseOrder ?? sense.senseOrder,
  });

  if (word.senseEntryId != null && word.senseOrder != null) {
    const entry = usable.find((e) => e.entryId === String(word.senseEntryId));
    const sense = entry?.senses.find((s) => s.senseOrder === word.senseOrder);
    if (!entry || !sense?.definition?.trim()) return null;
    return fill(entry, sense);
  }

  if (word.senseEntryId != null) {
    const entry = usable.find((e) => e.entryId === String(word.senseEntryId));
    const sense = entry ? usableSenses(entry)[0] : undefined;
    if (!entry || !sense) return null;
    return fill(entry, sense);
  }

  const own = word.lemma
    ? usable.find(
        (entry) => entry.lemma.toLowerCase() === word.lemma!.toLowerCase(),
      )
    : undefined;
  const entry = own ?? usable[0];
  const sense = usableSenses(entry)[0];
  if (!sense) return null;
  return fill(entry, sense);
}

// Rehidrata los significados que faltan consultando el catálogo (por
// lote, sin cobrar cuota ni usar IA). El guardado es compare-and-set:
// solo se escribe si la fila sigue igual que al capturarla — un
// repaso, borrado o cambio de sesión durante la consulta detiene la
// escritura. Devuelve la lista de entrada con las filas realmente
// persistidas, y empuja al servidor exactamente esas (con su sello
// nuevo, no el objeto previo al guardado). Un fallo de red no deshace
// lo local.
export async function backfillWordMeanings(
  words: SavedWord[],
  deps: BackfillDeps = {},
  scope?: DbScope,
): Promise<SavedWord[]> {
  const bound = scope ?? captureDbScope();
  const missing = words.filter(
    (word) => !word.deleted && !word.meaning?.trim(),
  );
  if (!missing.length) return words;

  const lookup = deps.lookup ?? batchLookup;
  const byLanguage = new Map<string, SavedWord[]>();
  for (const word of missing) {
    const list = byLanguage.get(word.language) ?? [];
    list.push(word);
    byLanguage.set(word.language, list);
  }

  const save =
    deps.save ??
    ((word: SavedWord, patch: MeaningPatch) =>
      fillSavedWordMeaning(word.key, word.updatedAt ?? 0, patch, bound));

  const persisted: SavedWord[] = [];
  for (const [language, group] of byLanguage) {
    const result = await lookup(
      group.map((word) => word.form),
      language,
    );
    if (!result.ok) continue;
    for (const word of group) {
      const patch = planMeaningBackfill(word, result.entries[word.form]);
      if (!patch) continue;
      const saved = await save(word, patch);
      if (saved) persisted.push(saved);
    }
  }
  if (!persisted.length) return words;
  const byKey = new Map(persisted.map((word) => [word.key, word]));
  // El contexto capturado al iniciar el flujo sigue mandando: un push
  // con otro scope enviaría filas a la cuenta equivocada.
  if (isDbScopeActive(bound)) {
    const push = deps.push ?? pushWordsToServer;
    void push(persisted).catch(() => {});
  }
  return words.map((word) => byKey.get(word.key) ?? word);
}

export type BackfillDeps = {
  lookup?: (forms: string[], lang: string) => Promise<BatchLookupResult>;
  save?: (word: SavedWord, patch: MeaningPatch) => Promise<SavedWord | null>;
  push?: (words: SavedWord[]) => Promise<boolean>;
};
