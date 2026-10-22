// Cursores de sincronización incremental por cuenta en localStorage.
// Evitan transferir colecciones completas en cada reconexión u online.
//
// Regla de oro: un cursor solo avanza. El de **push** avanza al sello máximo de
// lo que el servidor confirmó (nunca al reloj: un `Date.now()` puede adelantar a
// un dato que quedó sin enviar y perderlo para siempre). El de **pull** avanza al
// `nextCursor`/`serverTime` del servidor.

const memoryStore = new Map<string, string>();

function storageKey(userId: string): string {
  return `lecta_sync_cursors_v1:${userId}`;
}

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
    // Ignorar restricciones de cuota o modo privado
  }
  memoryStore.delete(key);
}

function normalize(value: unknown): number {
  const val = Number(value);
  return Number.isFinite(val) && val > 0 ? val : 0;
}

function readCursors(userId: string): Record<string, number> {
  try {
    const raw = getStorageItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = normalize(value);
      if (normalized > 0) out[key] = normalized;
    }
    return out;
  } catch {
    return {};
  }
}

function writeCursors(userId: string, cursors: Record<string, number>): void {
  try {
    setStorageItem(storageKey(userId), JSON.stringify(cursors));
  } catch {
    // Ignorar restricciones de cuota o modo privado
  }
}

export function getSyncCursor(userId: string, collection: string): number {
  if (!userId) return 0;
  return readCursors(userId)[collection] ?? 0;
}

/**
 * Escribe el cursor sin comprobar monotonía. Solo para casos en los que
 * retroceder es deliberado; para el resto, usa `advanceSyncCursor`.
 */
export function setSyncCursor(userId: string, collection: string, timestamp: number): void {
  const value = normalize(timestamp);
  if (!userId || value <= 0) return;
  const cursors = readCursors(userId);
  cursors[collection] = value;
  writeCursors(userId, cursors);
}

/**
 * Avanza el cursor **solo hacia adelante** y devuelve el valor resultante.
 * Un sello nulo, negativo o anterior al actual no lo mueve.
 */
export function advanceSyncCursor(
  userId: string,
  collection: string,
  stamp: number,
): number {
  if (!userId) return 0;
  const value = normalize(stamp);
  const cursors = readCursors(userId);
  const current = cursors[collection] ?? 0;
  if (value <= current) return current;
  cursors[collection] = value;
  writeCursors(userId, cursors);
  return value;
}

export function clearSyncCursors(userId?: string): void {
  try {
    if (userId) {
      removeStorageItem(storageKey(userId));
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
