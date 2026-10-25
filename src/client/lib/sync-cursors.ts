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

export interface SyncCompoundCursor {
  stamp: number;
  key: string;
}

function readRawCursors(userId: string): Record<string, unknown> {
  try {
    const raw = getStorageItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeRawCursors(userId: string, cursors: Record<string, unknown>): void {
  try {
    setStorageItem(storageKey(userId), JSON.stringify(cursors));
  } catch {
    // Ignorar restricciones de cuota o modo privado
  }
}

function readCursors(userId: string): Record<string, number> {
  const parsed = readRawCursors(userId);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const normalized = normalize(value);
    if (normalized > 0) out[key] = normalized;
  }
  return out;
}

export function getSyncCursor(userId: string, collection: string): number {
  if (!userId) return 0;
  return readCursors(userId)[collection] ?? 0;
}

export function getSyncCompoundCursor(userId: string, collection: string): SyncCompoundCursor {
  if (!userId) return { stamp: 0, key: "" };
  const raw = readRawCursors(userId);
  const stamp = normalize(raw[collection]);
  const key = typeof raw[`${collection}#key`] === "string" ? (raw[`${collection}#key`] as string) : "";
  return { stamp, key };
}

export function advanceSyncCompoundCursor(
  userId: string,
  collection: string,
  cursor: SyncCompoundCursor,
): SyncCompoundCursor {
  if (!userId) return { stamp: 0, key: "" };
  const stamp = normalize(cursor.stamp);
  const raw = readRawCursors(userId);
  const currentStamp = normalize(raw[collection]);
  const currentKey = typeof raw[`${collection}#key`] === "string" ? (raw[`${collection}#key`] as string) : "";

  const shouldAdvance =
    stamp > currentStamp || (stamp === currentStamp && cursor.key.localeCompare(currentKey) > 0);
  if (!shouldAdvance) return { stamp: currentStamp, key: currentKey };

  raw[collection] = stamp;
  raw[`${collection}#key`] = cursor.key;
  writeRawCursors(userId, raw);
  return { stamp, key: cursor.key };
}

/**
 * Escribe el cursor sin comprobar monotonía. Solo para casos en los que
 * retroceder es deliberado; para el resto, usa `advanceSyncCursor`.
 */
export function setSyncCursor(userId: string, collection: string, timestamp: number): void {
  const value = normalize(timestamp);
  if (!userId || value <= 0) return;
  const raw = readRawCursors(userId);
  raw[collection] = value;
  delete raw[`${collection}#key`];
  writeRawCursors(userId, raw);
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
  const raw = readRawCursors(userId);
  const current = normalize(raw[collection]);
  if (value <= current) return current;
  raw[collection] = value;
  writeRawCursors(userId, raw);
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

/**
 * Reinicia únicamente los cursores de pull (descarga) a 0 para forzar una
 * resincronización completa desde el servidor sin perder los cursores de push.
 */
export function resetPullCursors(userId: string): void {
  if (!userId) return;
  const raw = readRawCursors(userId);
  const pullKeys = Object.keys(raw).filter((k) => !k.includes(":push"));
  for (const k of pullKeys) {
    delete raw[k];
  }
  writeRawCursors(userId, raw);
}
