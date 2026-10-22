// Cursores de sincronización incremental por cuenta en localStorage.
// Evitan transferir colecciones completas en cada reconexión u online.

const memoryStore = new Map<string, string>();

function getStorageItem(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage.getItem(key);
    }
  } catch {
    // Fallback a memoria
  }
  return memoryStore.get(key) ?? null;
}

function setStorageItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // Fallback a memoria
  }
  memoryStore.set(key, value);
}

function removeStorageItem(key: string): void {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.removeItem === "function") {
      localStorage.removeItem(key);
    }
  } catch {
    // Fallback a memoria
  }
  memoryStore.delete(key);
}

export function getSyncCursor(userId: string, collection: string): number {
  if (!userId) return 0;
  try {
    const raw = getStorageItem(`lecta_sync_cursors_v1:${userId}`);
    if (!raw) return 0;
    const cursors = JSON.parse(raw) as Record<string, unknown>;
    const val = Number(cursors[collection]);
    return Number.isFinite(val) && val > 0 ? val : 0;
  } catch {
    return 0;
  }
}

export function setSyncCursor(userId: string, collection: string, timestamp: number): void {
  if (!userId || !Number.isFinite(timestamp) || timestamp <= 0) return;
  try {
    const key = `lecta_sync_cursors_v1:${userId}`;
    const raw = getStorageItem(key);
    const cursors = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    cursors[collection] = timestamp;
    setStorageItem(key, JSON.stringify(cursors));
  } catch {
    // Ignorar restricciones de cuota o modo privado
  }
}

export function clearSyncCursors(userId?: string): void {
  try {
    if (userId) {
      removeStorageItem(`lecta_sync_cursors_v1:${userId}`);
    } else {
      if (typeof localStorage !== "undefined") {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("lecta_sync_cursors_v1:")) {
            keysToRemove.push(k);
          }
        }
        for (const k of keysToRemove) {
          removeStorageItem(k);
        }
      }
      for (const k of memoryStore.keys()) {
        if (k.startsWith("lecta_sync_cursors_v1:")) memoryStore.delete(k);
      }
    }
  } catch {
    // Ignorar error
  }
}
