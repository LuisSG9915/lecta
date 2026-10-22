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
import { getSyncCursor, setSyncCursor } from "./sync-cursors";
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
): Promise<boolean> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !positions.length) return true;
  if (!isDbScopeActive(bound)) return false;
  try {
    for (let start = 0; start < positions.length; start += POSITION_LIMITS.batch) {
      const response = await accountFetch(
        "/api/positions",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            positions: positions.slice(start, start + POSITION_LIMITS.batch),
          }),
          keepalive: true,
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

let pendingPositionsToFlush: SavedBookPosition[] = [];

export function getPendingPositionsCount(): number {
  return pendingPositionsToFlush.length;
}

export function queuePositionForFlush(pos: SavedBookPosition) {
  pendingPositionsToFlush.push(pos);
}

export function flushPendingPositions(scope?: DbScope): Promise<boolean> {
  if (!pendingPositionsToFlush.length) return Promise.resolve(true);
  const items = [...pendingPositionsToFlush];
  pendingPositionsToFlush = [];
  return pushPositionsToServer(items, scope);
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
    };
    try {
      const url =
        currentSince > 0
          ? `/api/positions?since=${currentSince}`
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
    if (hasMore && data.nextCursor) {
      currentSince = data.nextCursor;
      setSyncCursor(bound.userId, "positions", currentSince);
    }
    if (!hasMore && data.nextCursor) {
      nextCursor = data.nextCursor;
    }
  }

  if (!allOk) return null;

  const localByHash = new Map(local.map((item) => [item.bookHash, item]));
  const remoteByHash = new Map(remoteAll.map((item) => [item.bookHash, item]));

  const conflicts: PositionConflict[] = [];
  let pulled = 0;
  let maxUpdated = effectiveSince;
  if (serverTime && serverTime > maxUpdated) maxUpdated = serverTime;

  for (const item of remoteAll) {
    if (item.updatedAt > maxUpdated) maxUpdated = item.updatedAt;
    const existing = localByHash.get(item.bookHash);
    if (!existing || item.updatedAt > existing.updatedAt) {
      await saveBookPosition(item, bound);
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

  // Desacoplar toPush de effectiveSince
  const lastPushedAt = getSyncCursor(bound.userId, "positions:push");
  const toPush = local.filter((item) => {
    const remoteItem = remoteByHash.get(item.bookHash);
    if (remoteItem) {
      return item.updatedAt > remoteItem.updatedAt;
    }
    return lastPushedAt > 0 ? item.updatedAt > lastPushedAt : true;
  });

  if (toPush.length > 0) {
    if (await pushPositionsToServer(toPush, bound)) {
      setSyncCursor(bound.userId, "positions:push", Date.now());
    } else {
      return null;
    }
  } else if (lastPushedAt === 0) {
    setSyncCursor(bound.userId, "positions:push", Date.now());
  }

  // Solo se sella cuando el ciclo completo salió, como en anotaciones.
  const finalCursor = nextCursor ?? (maxUpdated > 0 ? maxUpdated : Date.now());
  setSyncCursor(bound.userId, "positions", finalCursor);
  await saveSessionValue(POSITIONS_SYNC_KEY, String(Date.now()), bound);
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
  return pushPositionsToServer([pos], scope);
}
