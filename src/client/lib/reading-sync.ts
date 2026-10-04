import {
  getActiveUserId,
  listAllAnnotations,
  listIntervals,
  putAnnotation,
  putMissingIntervals,
  saveSessionValue,
  type SavedAnnotation,
  type SavedInterval,
} from "./idb";
import { annotationStamp } from "./annotations";

const LAST_SYNC_KEY = "annotationsLastSyncAt";
const ACTIVITY_SYNC_KEY = "activityLastSyncAt";

// Empuja anotaciones al servidor cuando hay sesión. Devuelve false si
// el envío falló o no hubo respuesta válida: nunca se finge sync.
export async function pushAnnotationsToServer(
  annotations: SavedAnnotation[],
): Promise<boolean> {
  if (!getActiveUserId() || !annotations.length) return true;
  try {
    const response = await fetch("/api/annotations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ annotations }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Fusiona marcadores y pasajes locales con los del servidor por clave;
// el registro con updatedAt más reciente gana, lápidas incluidas (así
// un borrado sin conexión también se propaga). Devuelve cuántas
// anotaciones llegaron, o null si no hubo sesión/respuesta.
export async function syncAnnotations() {
  if (!getActiveUserId()) return null;

  let remote: SavedAnnotation[] | null = null;
  try {
    const response = await fetch("/api/annotations");
    if (response.ok) {
      const data = (await response.json()) as { annotations?: SavedAnnotation[] };
      // La clave se deriva de libro+id; se recalcula por si faltara.
      remote = (data.annotations ?? []).map((item) => ({
        ...item,
        key: item.key || `${item.bookHash}:${item.id}`,
      }));
    }
  } catch {
    remote = null;
  }
  if (!remote) return null;

  const local = await listAllAnnotations();
  const localByKey = new Map(local.map((item) => [item.key, item]));
  const remoteByKey = new Map(remote.map((item) => [item.key, item]));

  let pulled = 0;
  for (const item of remote) {
    const existing = localByKey.get(item.key);
    if (!existing || annotationStamp(item) > annotationStamp(existing)) {
      await putAnnotation(item);
      pulled += 1;
    }
  }

  const toPush = local.filter((item) => {
    const remoteItem = remoteByKey.get(item.key);
    return !remoteItem || annotationStamp(item) > annotationStamp(remoteItem);
  });
  if (!(await pushAnnotationsToServer(toPush))) return null;

  // Solo se sella la fecha cuando el ciclo completo salió: una
  // sincronización parcial no cuenta como «al día».
  await saveSessionValue(LAST_SYNC_KEY, String(Date.now()));
  return pulled;
}

// Empuja intervalos nuevos al servidor. Como son inmutables el envío
// es seguro de repetir: el servidor descarta los ids que ya tiene.
export async function pushActivityToServer(
  intervals: SavedInterval[],
): Promise<boolean> {
  if (!getActiveUserId() || !intervals.length) return true;
  try {
    const response = await fetch("/api/activity", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intervals }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Fusiona actividad local y remota por id: llegan solo los intervalos
// que este dispositivo no conoce y se suben los que el servidor no
// tiene. Devuelve cuántos llegaron, o null si no hubo sesión/respuesta.
export async function syncActivity() {
  if (!getActiveUserId()) return null;

  let remote: SavedInterval[] | null = null;
  try {
    const response = await fetch("/api/activity");
    if (response.ok) {
      const data = (await response.json()) as { intervals?: SavedInterval[] };
      remote = data.intervals ?? [];
    }
  } catch {
    remote = null;
  }
  if (!remote) return null;

  const local = await listIntervals();
  const remoteIds = new Set(remote.map((item) => item.id));
  const localIds = new Set(local.map((item) => item.id));

  const pulled = await putMissingIntervals(
    remote.filter((item) => !localIds.has(item.id)),
  );
  const toPush = local.filter((item) => !remoteIds.has(item.id));
  if (!(await pushActivityToServer(toPush))) return null;

  await saveSessionValue(ACTIVITY_SYNC_KEY, String(Date.now()));
  return pulled;
}
