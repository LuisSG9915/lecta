import {
  getActiveUserId,
  listAllSavedWords,
  putSavedWord,
  removeSavedWord,
  saveSessionValue,
  type SavedWord,
} from "./idb";

const stamp = (word: SavedWord) => word.updatedAt ?? word.savedAt;
const LAST_SYNC_KEY = "vocabLastSyncAt";

// Empuja palabras al servidor cuando hay sesión. Devuelve false si el
// envío falló o no hubo respuesta válida: quien llama decide cómo
// avisar; nunca se finge sincronización.
export async function pushWordsToServer(words: SavedWord[]): Promise<boolean> {
  if (!getActiveUserId() || !words.length) return true;
  try {
    const response = await fetch("/api/vocab", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ words }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Borra la palabra localmente (lápida) y propaga el borrado si hay sesión.
export async function removeWord(key: string) {
  const tombstone = await removeSavedWord(key);
  if (tombstone) void pushWordsToServer([tombstone]);
  return tombstone;
}

// Fusiona vocabulario local y remoto por clave; el registro con
// updatedAt más reciente gana. Recorre todos los idiomas presentes en
// el cuaderno local, no solo el español. Devuelve cuántas palabras
// llegaron del servidor, o null si no hubo sesión/respuesta.
export async function syncSavedWords() {
  if (!getActiveUserId()) return null;
  const localAll = await listAllSavedWords();
  const languages = [...new Set(localAll.map((word) => word.language || "es"))];
  if (!languages.length) languages.push("es");

  let pulled = 0;
  let allOk = true;
  for (const language of languages) {
    let remote: SavedWord[] | null = null;
    try {
      const response = await fetch(`/api/vocab?lang=${encodeURIComponent(language)}`);
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
        await putSavedWord(word);
        pulled += 1;
      }
    }

    const toPush = local.filter((word) => {
      const remoteWord = remoteByKey.get(word.key);
      return !remoteWord || stamp(word) > stamp(remoteWord);
    });
    if (!(await pushWordsToServer(toPush))) allOk = false;
  }

  // Solo sellamos la fecha cuando todos los idiomas sincronizaron:
  // una sincronización parcial no cuenta como «al día».
  if (allOk) await saveSessionValue(LAST_SYNC_KEY, String(Date.now()));
  return pulled;
}
