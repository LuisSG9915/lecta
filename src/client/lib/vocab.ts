import {
  captureDbScope,
  isDbScopeActive,
  listAllSavedWords,
  listSavedWords,
  mergeKnowledgeRecords,
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
import {
  advanceSyncCompoundCursor,
  advanceSyncCursor,
  getSyncCompoundCursor,
  getSyncCursor,
} from "./sync-cursors";
import { type PushResult } from "./sync-push";
import {
  clearCollectionPagesPending,
  isSyncPaused,
  markCollectionPagesPending,
  scheduleReadingSyncContinuation,
} from "./sync-state";
import { loadUserLanguageProfile, USER_LANGUAGE_PROFILE_KEY } from "./profile-models";

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
): Promise<PushResult> {
  if (isSyncPaused()) return { ok: false, acceptedMax: 0 };
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !words.length) return { ok: true, acceptedMax: 0 };
  if (!isDbScopeActive(bound)) return { ok: false, acceptedMax: 0 };
  const sorted = [...words].sort((a, b) => stamp(a) - stamp(b));
  let acceptedMax = 0;
  let lastAcceptedKey: string | undefined;
  try {
    for (let start = 0; start < sorted.length; start += WORD_BATCH_LIMIT) {
      const batch = sorted.slice(start, start + WORD_BATCH_LIMIT);
      const response = await accountFetch(
        "/api/vocab",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ words: batch }),
        },
        bound,
      );
      if (!response.ok) return { ok: false, acceptedMax, lastAcceptedKey };
      const data = (await response.json().catch(() => null)) as { serverTime?: number } | null;
      const serverTime = data?.serverTime;
      if (serverTime) {
        for (const item of batch) {
          const itemStamp = stamp(item);
          if (itemStamp > serverTime) {
            await putSavedWord({ ...item, updatedAt: serverTime }, bound);
          }
        }
      }
      const lastItem = batch[batch.length - 1];
      const lastStamp = stamp(lastItem);
      acceptedMax = Math.max(acceptedMax, serverTime ? Math.min(lastStamp, serverTime) : lastStamp);
      lastAcceptedKey = lastItem.key;
    }
    return { ok: true, acceptedMax, lastAcceptedKey };
  } catch {
    return { ok: false, acceptedMax, lastAcceptedKey };
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
// el cuaderno local, el perfil y los devueltos por el servidor.
// Devuelve cuántas palabras llegaron del servidor, o null si no hubo
// sesión/respuesta o la cuenta cambió a mitad del ciclo.
export async function syncSavedWords(scope?: DbScope) {
  if (isSyncPaused()) return null;
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return null;
  const localAll = await listAllSavedWords(undefined, bound);

  const initialLanguages = new Set<string>(["es"]);
  for (const word of localAll) {
    if (word.language) initialLanguages.add(word.language);
  }
  const hasSavedProfile =
    typeof window !== "undefined" &&
    window.localStorage &&
    window.localStorage.getItem(USER_LANGUAGE_PROFILE_KEY);
  if (hasSavedProfile) {
    const profile = loadUserLanguageProfile();
    if (profile.thetaByLang) {
      for (const lang of Object.keys(profile.thetaByLang)) {
        if (lang) initialLanguages.add(lang);
      }
    }
  }

  const queue = Array.from(initialLanguages);
  const processedLanguages = new Set<string>();

  let pulled = 0;
  let allOk = true;
  let pagesPending = false;
  let maxUpdated = 0;

  for (let i = 0; i < queue.length; i++) {
    const language = queue[i];
    if (processedLanguages.has(language)) continue;
    processedLanguages.add(language);

    if (!isDbScopeActive(bound)) {
      allOk = false;
      break;
    }

    const local = localAll.filter((word) => (word.language || "es") === language);
    const langCursor = getSyncCursor(bound.userId, `vocab:${language}`);
    const effectiveSince = local.length > 0 ? langCursor : 0;

    let currentSince = effectiveSince;
    let currentAfterWord: string | undefined;
    let page = 0;
    const MAX_PAGES = 25;
    let hasMore = true;
    const langRemote: SavedWord[] = [];
    let langOk = true;
    let langNextCursor: number | undefined;

    while (hasMore && page < MAX_PAGES) {
      page++;
      let pageData: {
        words?: SavedWord[];
        serverTime?: number;
        hasMore?: boolean;
        nextCursor?: number;
        nextAfterWord?: string | null;
        availableLanguages?: string[];
      };

      try {
        const params = new URLSearchParams({ lang: language });
        if (currentSince > 0) params.set("since", String(currentSince));
        if (currentAfterWord) params.set("afterWord", currentAfterWord);
        // Solo la primera página descubre idiomas: en las siguientes el
        // DISTINCT es redundante y cuesta una consulta por página.
        if (page > 1) params.set("includeLanguages", "0");
        const url = `/api/vocab?${params.toString()}`;
        const response = await accountFetch(url, undefined, bound);
        if (!response.ok) {
          langOk = false;
          break;
        }
        pageData = await response.json();
      } catch {
        langOk = false;
        break;
      }

      if (!pageData) {
        langOk = false;
        break;
      }

      const words = pageData.words ?? [];
      langRemote.push(...words);

      // Descubrimiento dinámico de idiomas adicionales
      if (Array.isArray(pageData.availableLanguages)) {
        for (const availLang of pageData.availableLanguages) {
          if (
            availLang &&
            !processedLanguages.has(availLang) &&
            !queue.includes(availLang)
          ) {
            queue.push(availLang);
          }
        }
      }

      hasMore = Boolean(pageData.hasMore);
      if (hasMore && pageData.nextCursor !== undefined) {
        currentSince = pageData.nextCursor;
        currentAfterWord = pageData.nextAfterWord ?? undefined;
      }
      if (!hasMore && pageData.nextCursor) {
        langNextCursor = pageData.nextCursor;
      }
      if (pageData.serverTime && pageData.serverTime > maxUpdated) {
        maxUpdated = pageData.serverTime;
      }
    }

    pagesPending ||= hasMore;

    if (!langOk) {
      allOk = false;
      continue;
    }

    const localByKey = new Map(local.map((word) => [word.key, word]));
    const remoteByKey = new Map(langRemote.map((word) => [word.key, word]));

    for (const word of langRemote) {
      const wordStamp = stamp(word);
      if (wordStamp > maxUpdated) maxUpdated = wordStamp;
      const existing = localByKey.get(word.key);
      if (!existing || wordStamp > stamp(existing)) {
        const merged = existing ? mergeKnowledgeRecords(word, existing) : word;
        await putSavedWord(merged, bound);
        pulled += 1;
      }
    }

    // Desacoplar toPush de effectiveSince con orden y cursor seguro
    const lastCursor = getSyncCompoundCursor(bound.userId, `vocab:${language}:push`);
    const toPush = local
      .filter((word) => {
        const wordStamp = stamp(word);
        const remoteWord = remoteByKey.get(word.key);
        if (remoteWord) {
          return wordStamp > stamp(remoteWord);
        }
        if (lastCursor.key) {
          if (wordStamp > lastCursor.stamp) return true;
          if (wordStamp === lastCursor.stamp && word.key > lastCursor.key) return true;
          return false;
        }
        return lastCursor.stamp > 0 ? wordStamp > lastCursor.stamp : true;
      })
      .sort((a, b) => {
        const diff = stamp(a) - stamp(b);
        return diff !== 0 ? diff : a.key.localeCompare(b.key);
      });

    if (toPush.length > 0) {
      const pushed = await pushWordsToServer(toPush, bound);
      // Solo se avanza hasta lo confirmado: si un lote falló, lo que quedó
      // fuera del cursor se reenvía en el siguiente ciclo.
      if (pushed.acceptedMax > 0) {
        if (pushed.lastAcceptedKey) {
          advanceSyncCompoundCursor(bound.userId, `vocab:${language}:push`, {
            stamp: pushed.acceptedMax,
            key: pushed.lastAcceptedKey,
          });
        } else {
          advanceSyncCursor(bound.userId, `vocab:${language}:push`, pushed.acceptedMax);
        }
      }
      if (!pushed.ok) {
        allOk = false;
      }
    }

    const finalLangCursor = hasMore ? currentSince : (langNextCursor ?? maxUpdated);
    if (finalLangCursor > 0) {
      advanceSyncCursor(bound.userId, `vocab:${language}`, finalLangCursor);
    }
  }

  // Solo sellamos la fecha cuando todos los idiomas sincronizaron:
  // una sincronización parcial no cuenta como «al día».
  if (allOk) {
    if (pagesPending) {
      markCollectionPagesPending("words");
      scheduleReadingSyncContinuation("words");
    } else {
      clearCollectionPagesPending("words");
      await saveSessionValue(LAST_SYNC_KEY, String(Date.now()), bound);
    }
  }
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
