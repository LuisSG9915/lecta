import {
  captureDbScope,
  isDbScopeActive,
  listPositions,
  saveBookPosition,
  saveSessionValue,
  type DbScope,
  type SavedBookPosition,
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
  markCollectionPagesPending,
  scheduleReadingSyncContinuation,
} from "./sync-state";
import { POSITION_LIMITS } from "../../shared/reading-data";

const POSITIONS_SYNC_KEY = "positionsLastSyncAt";

// Conflicto resuelto durante la fusión: el servidor traía una posición
// más nueva que pisó una local que apuntaba a otro lugar del libro.
export type PositionConflict = {
  bookHash: string;
  previous: SavedBookPosition;
  merged: SavedBookPosition;
};

// Empuja posiciones al servidor cuando hay sesión. Mismo criterio que
// las anotaciones: lotes de POSITION_LIMITS.batch, se detiene al primer
// lote fallido y devuelve false — nunca se finge sync ni se escribe
// bajo la cuenta nueva.
export async function pushPositionsToServer(
  positions: SavedBookPosition[],
  scope?: DbScope,
): Promise<PushResult> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !positions.length) return { ok: true, acceptedMax: 0 };
  if (!isDbScopeActive(bound)) return { ok: false, acceptedMax: 0 };
  const sorted = [...positions].sort((a, b) => a.updatedAt - b.updatedAt);
  let acceptedMax = 0;
  let lastAcceptedKey: string | undefined;
  try {
    for (let start = 0; start < sorted.length; start += POSITION_LIMITS.batch) {
      const batch = sorted.slice(start, start + POSITION_LIMITS.batch);
      const response = await accountFetch(
        "/api/positions",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ positions: batch }),
          keepalive: true,
        },
        bound,
      );
      if (!response.ok) return { ok: false, acceptedMax, lastAcceptedKey };
      const data = (await response.json().catch(() => null)) as { serverTime?: number } | null;
      const serverTime = data?.serverTime;
      if (serverTime) {
        for (const item of batch) {
          if (item.updatedAt > serverTime) {
            await saveBookPosition({ ...item, updatedAt: serverTime }, bound);
          }
        }
      }
      const lastItem = batch[batch.length - 1];
      acceptedMax = Math.max(acceptedMax, serverTime ? Math.min(lastItem.updatedAt, serverTime) : lastItem.updatedAt);
      lastAcceptedKey = lastItem.bookHash;
    }
    return { ok: true, acceptedMax, lastAcceptedKey };
  } catch {
    return { ok: false, acceptedMax, lastAcceptedKey };
  }
}

let pendingPositionsToFlush: SavedBookPosition[] = [];

export function getPendingPositionsCount(): number {
  return pendingPositionsToFlush.length;
}

export function flushPendingPositions(scope?: DbScope): Promise<boolean> {
  if (!pendingPositionsToFlush.length) return Promise.resolve(true);
  const items = [...pendingPositionsToFlush];
  pendingPositionsToFlush = [];
  return pushPositionsToServer(items, scope).then((result) => result.ok);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushPendingPositions();
    }
  });
}

// Fusiona posiciones locales y remotas por libro; gana la de updatedAt
// más reciente (el último dispositivo usado manda). Cuando lo remoto
// pisa una posición local que apuntaba a otro lugar (otra sección o un
// avance distinto) se anota en `conflicts` para que quien llama pueda
// avisar. Devuelve {pulled, conflicts}, o null si no hubo sesión, el
// ciclo no se completó o la cuenta cambió a mitad — en esos casos
// tampoco se sella la fecha.
export async function syncPositions(scope?: DbScope): Promise<{
  pulled: number;
  conflicts: PositionConflict[];
} | null> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return null;

  const local = await listPositions(bound);
  const cursor = getSyncCursor(bound.userId, "positions");
  const effectiveSince = local.length > 0 ? cursor : 0;

  let currentSince = effectiveSince;
  let currentAfterBookHash: string | undefined;
  let page = 0;
  const MAX_PAGES = 25;
  let hasMore = true;
  const remoteAll: SavedBookPosition[] = [];
  let serverTime: number | undefined;
  let nextCursor: number | undefined;
  let allOk = true;

  while (hasMore && page < MAX_PAGES) {
    page++;
    let data: {
      positions?: SavedBookPosition[];
      serverTime?: number;
      hasMore?: boolean;
      nextCursor?: number;
      nextAfterBookHash?: string | null;
    };
    try {
      const params = new URLSearchParams();
      if (currentSince > 0) params.set("since", String(currentSince));
      if (currentAfterBookHash) {
        params.set("afterBookHash", currentAfterBookHash);
      }
      const url = params.size
        ? `/api/positions?${params.toString()}`
        : "/api/positions";
      const response = await accountFetch(url, undefined, bound);
      if (!response.ok) {
        allOk = false;
        break;
      }
      data = await response.json();
    } catch {
      allOk = false;
      break;
    }
    if (!data) {
      allOk = false;
      break;
    }

    if (data.serverTime) serverTime = data.serverTime;
    const items = data.positions ?? [];
    remoteAll.push(...items);

    hasMore = Boolean(data.hasMore);
    if (hasMore && data.nextCursor !== undefined) {
      currentSince = data.nextCursor;
      currentAfterBookHash = data.nextAfterBookHash ?? undefined;
    }
    if (!hasMore && data.nextCursor) {
      nextCursor = data.nextCursor;
    }
  }

  if (!allOk) return null;
  if (hasMore) {
    markCollectionPagesPending("positions");
    scheduleReadingSyncContinuation("positions");
  } else {
    clearCollectionPagesPending("positions");
  }

  // El pull tarda lo suyo: un guardado que haya aterrizado mientras
  // tanto (la posición final de la lectura, al cerrar el libro) tiene
  // que contar. Con la foto tomada antes de la red, una fila remota más
  // nueva que esa foto pisaba el punto que el lector acababa de guardar.
  const localNow = await listPositions(bound);
  const localByHash = new Map(localNow.map((item) => [item.bookHash, item]));
  const remoteByHash = new Map(remoteAll.map((item) => [item.bookHash, item]));

  const conflicts: PositionConflict[] = [];
  let pulled = 0;
  let maxUpdated = effectiveSince;
  if (serverTime && serverTime > maxUpdated) maxUpdated = serverTime;

  for (const item of remoteAll) {
    if (item.updatedAt > maxUpdated) maxUpdated = item.updatedAt;
    const existing = localByHash.get(item.bookHash);
    if (!existing || item.updatedAt > existing.updatedAt) {
      // El servidor guarda el ancla como texto, sin la fracción del
      // bloque que ya se había leído: si la fila remota apunta al mismo
      // párrafo, se conserva la precisión que este dispositivo conoce.
      const merged =
        existing?.anchorOffset != null &&
        existing.anchor != null &&
        existing.anchor === item.anchor
          ? { ...item, anchorOffset: existing.anchorOffset }
          : item;
      await saveBookPosition(merged, bound);
      pulled += 1;
      // Solo cuenta como conflicto si el local apuntaba a otro lugar:
      // otra sección o un avance con diferencia visible (>0.5 %).
      if (
        existing &&
        (existing.sectionIndex !== item.sectionIndex ||
          Math.abs((existing.progress ?? 0) - (item.progress ?? 0)) > 0.005)
      ) {
        conflicts.push({
          bookHash: item.bookHash,
          previous: existing,
          merged: item,
        });
      }
    }
  }

  // Desacoplar toPush de effectiveSince con orden y cursor seguro
  const lastCursor = getSyncCompoundCursor(bound.userId, "positions:push");
  const toPush = localNow
    .filter((item) => {
      const remoteItem = remoteByHash.get(item.bookHash);
      if (remoteItem) {
        return item.updatedAt > remoteItem.updatedAt;
      }
      if (lastCursor.key) {
        if (item.updatedAt > lastCursor.stamp) return true;
        if (item.updatedAt === lastCursor.stamp && item.bookHash > lastCursor.key) return true;
        return false;
      }
      return lastCursor.stamp > 0 ? item.updatedAt > lastCursor.stamp : true;
    })
    .sort((a, b) => {
      const diff = a.updatedAt - b.updatedAt;
      return diff !== 0 ? diff : a.bookHash.localeCompare(b.bookHash);
    });

  if (toPush.length > 0) {
    const pushed = await pushPositionsToServer(toPush, bound);
    if (pushed.acceptedMax > 0) {
      if (pushed.lastAcceptedKey) {
        advanceSyncCompoundCursor(bound.userId, "positions:push", {
          stamp: pushed.acceptedMax,
          key: pushed.lastAcceptedKey,
        });
      } else {
        advanceSyncCursor(bound.userId, "positions:push", pushed.acceptedMax);
      }
    }
    if (!pushed.ok) return null;
  }

  // Solo se sella cuando el ciclo completo salió, como en anotaciones.
  const finalCursor = hasMore ? currentSince : (nextCursor ?? maxUpdated);
  if (finalCursor > 0) {
    advanceSyncCursor(bound.userId, "positions", finalCursor);
  }
  if (!hasMore) {
    await saveSessionValue(POSITIONS_SYNC_KEY, String(Date.now()), bound);
  }
  return { pulled, conflicts };
}

export async function pushPosition(
  bookId: string,
  cfi: string,
  fraction: number,
  scope?: DbScope,
): Promise<boolean> {
  const pos: SavedBookPosition = {
    bookHash: bookId,
    sectionIndex: 0,
    scrollTop: 0,
    ratio: fraction,
    progress: fraction,
    anchor: cfi,
    updatedAt: Date.now(),
  };
  return pushPositionsToServer([pos], scope).then((result) => result.ok);
}
