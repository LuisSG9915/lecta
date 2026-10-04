import {
  getActiveUserId,
  listAllSavedWords,
  putSavedWord,
  removeSavedWord,
  type SavedWord,
} from "./idb";

const stamp = (word: SavedWord) => word.updatedAt ?? word.savedAt;

// Empuja palabras al servidor cuando hay sesión. Sin conexión quedan
// solo en el dispositivo y se suben en la próxima sincronización.
export async function pushWordsToServer(words: SavedWord[]) {
  if (!getActiveUserId() || !words.length) return;
  try {
    await fetch("/api/vocab", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ words }),
    });
  } catch {
    // Fuera de línea: la próxima sincronización lo reintenta.
  }
}

// Borra la palabra localmente (lápida) y propaga el borrado si hay sesión.
export async function removeWord(key: string) {
  const tombstone = await removeSavedWord(key);
  if (tombstone) void pushWordsToServer([tombstone]);
  return tombstone;
}

// Fusiona vocabulario local y remoto por clave; el registro con
// updatedAt más reciente gana. Devuelve cuántas palabras llegaron
// del servidor, o null si no hubo sesión/respuesta.
export async function syncSavedWords(language = "es") {
  if (!getActiveUserId()) return null;
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
  if (!remote) return null;

  const local = await listAllSavedWords(language);
  const localByKey = new Map(local.map((word) => [word.key, word]));
  const remoteByKey = new Map(remote.map((word) => [word.key, word]));

  let pulled = 0;
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
  await pushWordsToServer(toPush);
  return pulled;
}
