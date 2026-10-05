import {
  getActiveUserId,
  listPositions,
  saveBookPosition,
  saveSessionValue,
  type SavedBookPosition,
} from "./idb";
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
// lote fallido y devuelve false — nunca se finge sync.
export async function pushPositionsToServer(
  positions: SavedBookPosition[],
): Promise<boolean> {
  if (!getActiveUserId() || !positions.length) return true;
  try {
    for (let start = 0; start < positions.length; start += POSITION_LIMITS.batch) {
      const response = await fetch("/api/positions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          positions: positions.slice(start, start + POSITION_LIMITS.batch),
        }),
      });
      if (!response.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Fusiona posiciones locales y remotas por libro; gana la de updatedAt
// más reciente (el último dispositivo usado manda). Cuando lo remoto
// pisa una posición local que apuntaba a otro lugar (otra sección o un
// avance distinto) se anota en `conflicts` para que quien llama pueda
// avisar. Devuelve {pulled, conflicts}, o null si no hubo sesión o el
// ciclo no se completó — en ese caso tampoco se sella la fecha.
export async function syncPositions(): Promise<{
  pulled: number;
  conflicts: PositionConflict[];
} | null> {
  if (!getActiveUserId()) return null;

  let remote: SavedBookPosition[] | null = null;
  try {
    const response = await fetch("/api/positions");
    if (response.ok) {
      const data = (await response.json()) as { positions?: SavedBookPosition[] };
      remote = data.positions ?? [];
    }
  } catch {
    remote = null;
  }
  if (!remote) return null;

  const local = await listPositions();
  const localByHash = new Map(local.map((item) => [item.bookHash, item]));
  const remoteByHash = new Map(remote.map((item) => [item.bookHash, item]));

  const conflicts: PositionConflict[] = [];
  let pulled = 0;
  for (const item of remote) {
    const existing = localByHash.get(item.bookHash);
    if (!existing || item.updatedAt > existing.updatedAt) {
      await saveBookPosition(item);
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

  const toPush = local.filter((item) => {
    const remoteItem = remoteByHash.get(item.bookHash);
    return !remoteItem || item.updatedAt > remoteItem.updatedAt;
  });
  if (!(await pushPositionsToServer(toPush))) return null;

  // Solo se sella cuando el ciclo completo salió, como en anotaciones.
  await saveSessionValue(POSITIONS_SYNC_KEY, String(Date.now()));
  return { pulled, conflicts };
}
