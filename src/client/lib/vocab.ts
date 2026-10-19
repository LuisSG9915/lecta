import {
  captureDbScope,
  isDbScopeActive,
  listAllSavedWords,
  listSavedWords,
  putSavedWord,
  removeSavedWord,
  saveSessionValue,
  saveWordWithKnowledge,
  type DbScope,
  type SavedWord,
  type VocabEntry,
  type WordMeaning,
} from "./idb";
import { accountFetch } from "./account-fetch";

const stamp = (word: SavedWord) => word.updatedAt ?? word.savedAt;
const LAST_SYNC_KEY = "vocabLastSyncAt";
// El servidor acota cada PUT a 500 palabras: más allá hay que partir
// el envío en lotes o los registros sobrantes se pierden sin aviso.
const WORD_BATCH_LIMIT = 500;

// Empuja palabras al servidor cuando hay sesión. Devuelve false si el
// envío falló, no hubo respuesta válida o el contexto de cuenta venció
// a mitad de los lotes: quien llama decide cómo avisar; nunca se finge
// sincronización ni se envía nada bajo la cuenta nueva.
export async function pushWordsToServer(
  words: SavedWord[],
  scope?: DbScope,
): Promise<boolean> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !words.length) return true;
  if (!isDbScopeActive(bound)) return false;
  try {
    for (let start = 0; start < words.length; start += WORD_BATCH_LIMIT) {
      const response = await accountFetch(
        "/api/vocab",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ words: words.slice(start, start + WORD_BATCH_LIMIT) }),
        },
        bound,
      );
      if (!response.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Borra la palabra localmente (lápida) y propaga el borrado si hay sesión.
export async function removeWord(key: string, scope?: DbScope) {
  const bound = scope ?? captureDbScope();
  const tombstone = await removeSavedWord(key, bound);
  if (tombstone) void pushWordsToServer([tombstone], bound);
  return tombstone;
}

// Fusiona vocabulario local y remoto por clave; el registro con
// updatedAt más reciente gana. Recorre todos los idiomas presentes en
// el cuaderno local, no solo el español. Devuelve cuántas palabras
// llegaron del servidor, o null si no hubo sesión/respuesta o la
// cuenta cambió a mitad del ciclo.
export async function syncSavedWords(scope?: DbScope) {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return null;
  const localAll = await listAllSavedWords(undefined, bound);
  const languages = [...new Set(localAll.map((word) => word.language || "es"))];
  if (!languages.length) languages.push("es");

  let pulled = 0;
  let allOk = true;
  for (const language of languages) {
    if (!isDbScopeActive(bound)) {
      allOk = false;
      break;
    }
    let remote: SavedWord[] | null = null;
    try {
      const response = await accountFetch(
        `/api/vocab?lang=${encodeURIComponent(language)}`,
        undefined,
        bound,
      );
      if (response.ok) {
        const data = (await response.json()) as { words?: SavedWord[] };
        remote = data.words ?? [];
      }
    } catch {
      remote = null;
    }
    if (!remote) {
      allOk = false;
      continue;
    }

    const local = localAll.filter((word) => (word.language || "es") === language);
    const localByKey = new Map(local.map((word) => [word.key, word]));
    const remoteByKey = new Map(remote.map((word) => [word.key, word]));

    for (const word of remote) {
      const existing = localByKey.get(word.key);
      if (!existing || stamp(word) > stamp(existing)) {
        // Aterriza en la base dueña del contexto aunque la activa ya
        // sea otra: la respuesta traía datos de esa cuenta.
        await putSavedWord(word, bound);
        pulled += 1;
      }
    }

    const toPush = local.filter((word) => {
      const remoteWord = remoteByKey.get(word.key);
      return !remoteWord || stamp(word) > stamp(remoteWord);
    });
    if (!(await pushWordsToServer(toPush, bound))) allOk = false;
  }

  // Solo sellamos la fecha cuando todos los idiomas sincronizaron:
  // una sincronización parcial no cuenta como «al día».
  if (allOk) await saveSessionValue(LAST_SYNC_KEY, String(Date.now()), bound);
  return allOk ? pulled : null;
}

export async function findSavedEntry(
  word: string,
  bookId?: string,
  scope?: DbScope,
): Promise<VocabEntry | null> {
  const bound = scope ?? captureDbScope();
  const words = await listSavedWords(undefined, bound);
  const found = words.find(
    (w) =>
      w.form.toLowerCase() === word.toLowerCase() &&
      (!bookId || !w.bookHash || w.bookHash === bookId),
  );
  if (!found) return null;
  return {
    ...found,
    id: found.key,
    note: found.contextSnippet ?? "",
  };
}

export async function saveVocabEntry(
  input: {
    word: string;
    lemma: string;
    bookId?: string;
    bookTitle?: string;
    sentence?: string;
    cfi?: string;
    meaning?: WordMeaning;
    note?: string;
  },
  scope?: DbScope,
): Promise<{ entry: VocabEntry }> {
  const bound = scope ?? captureDbScope();
  const def = input.meaning?.ContextualMeaning || input.meaning?.definitions?.[0] || "";
  const { word: saved } = await saveWordWithKnowledge(
    {
      word: {
        form: input.word,
        lemma: input.lemma,
        meaning: def,
        language: "es",
        context: input.sentence,
        bookHash: input.bookId,
        bookTitle: input.bookTitle,
        contextSnippet: input.note,
        priority: true,
      },
      knowledge: {
        language: "es",
        lemma: input.lemma,
        known: false,
        source: "saved",
        status: "unknown",
      },
    },
    bound,
  );
  const entry: VocabEntry = {
    ...saved,
    id: saved.key,
    note: input.note,
  };
  return { entry };
}

export async function removeVocabEntry(id: string, scope?: DbScope): Promise<void> {
  await removeWord(id, scope);
}

export async function updateVocabNote(
  id: string,
  note: string,
  scope?: DbScope,
): Promise<VocabEntry | null> {
  const bound = scope ?? captureDbScope();
  const words = await listAllSavedWords(undefined, bound);
  const found = words.find((w) => w.key === id);
  if (!found) return null;
  const updated: SavedWord = {
    ...found,
    contextSnippet: note,
    updatedAt: Date.now(),
  };
  await putSavedWord(updated, bound);
  return {
    ...updated,
    id: updated.key,
    note,
  };
}
