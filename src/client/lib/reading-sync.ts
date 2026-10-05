import {
  getActiveUserId,
  knowledgeKey,
  listAllAnnotations,
  listAllKnowledge,
  listAllReviews,
  listIntervals,
  putAnnotation,
  putKnowledge,
  putMissingIntervals,
  putReviews,
  saveSessionValue,
  type KnownWord,
  type SavedAnnotation,
  type SavedInterval,
  type SavedReview,
} from "./idb";
import { annotationStamp } from "./annotations";
import {
  ANNOTATION_LIMITS,
  ACTIVITY_LIMITS,
  REVIEW_LIMITS,
  KNOWLEDGE_LIMITS,
} from "../../shared/reading-data";

const LAST_SYNC_KEY = "annotationsLastSyncAt";
const ACTIVITY_SYNC_KEY = "activityLastSyncAt";
const REVIEWS_SYNC_KEY = "reviewsLastSyncAt";
const KNOWLEDGE_SYNC_KEY = "knowledgeLastSyncAt";

// Empuja anotaciones al servidor cuando hay sesión. Devuelve false si
// el envío falló o no hubo respuesta válida: nunca se finge sync.
export async function pushAnnotationsToServer(
  annotations: SavedAnnotation[],
): Promise<boolean> {
  if (!getActiveUserId() || !annotations.length) return true;
  try {
    // El servidor recorta cada PUT a ANNOTATION_LIMITS.batch; sin
    // lotes, el excedente se perdería sin aviso.
    for (let start = 0; start < annotations.length; start += ANNOTATION_LIMITS.batch) {
      const response = await fetch("/api/annotations", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          annotations: annotations.slice(start, start + ANNOTATION_LIMITS.batch),
        }),
      });
      if (!response.ok) return false;
    }
    return true;
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
    for (let start = 0; start < intervals.length; start += ACTIVITY_LIMITS.batch) {
      const response = await fetch("/api/activity", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intervals: intervals.slice(start, start + ACTIVITY_LIMITS.batch),
        }),
      });
      if (!response.ok) return false;
    }
    return true;
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

// Empuja repasos nuevos al servidor. Igual que la actividad son
// inmutables: reenviar es seguro, el servidor descarta ids repetidos.
export async function pushReviewsToServer(
  reviews: SavedReview[],
): Promise<boolean> {
  if (!getActiveUserId() || !reviews.length) return true;
  try {
    for (let start = 0; start < reviews.length; start += REVIEW_LIMITS.batch) {
      const response = await fetch("/api/reviews", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviews: reviews.slice(start, start + REVIEW_LIMITS.batch),
        }),
      });
      if (!response.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Fusiona repasos locales y remotos por id: llegan solo los que este
// dispositivo no conoce y se suben los que el servidor no tiene.
// Devuelve cuántos llegaron, o null si no hubo sesión/respuesta.
export async function syncReviews() {
  if (!getActiveUserId()) return null;

  let remote: SavedReview[] | null = null;
  try {
    const response = await fetch("/api/reviews");
    if (response.ok) {
      const data = (await response.json()) as { reviews?: SavedReview[] };
      remote = data.reviews ?? [];
    }
  } catch {
    remote = null;
  }
  if (!remote) return null;

  const local = await listAllReviews();
  const remoteIds = new Set(remote.map((item) => item.id));
  const localIds = new Set(local.map((item) => item.id));

  const pulled = await putReviews(
    remote.filter((item) => !localIds.has(item.id)),
  );
  const toPush = local.filter((item) => !remoteIds.has(item.id));
  if (!(await pushReviewsToServer(toPush))) return null;

  await saveSessionValue(REVIEWS_SYNC_KEY, String(Date.now()));
  return pulled;
}

// Empuja evidencia de conocimiento al servidor cuando hay sesión.
// Mismo criterio que las anotaciones: lotes de KNOWLEDGE_LIMITS.batch,
// se detiene al primer lote fallido y devuelve false — nunca se finge
// sincronización.
export async function pushKnowledgeToServer(rows: KnownWord[]): Promise<boolean> {
  if (!getActiveUserId() || !rows.length) return true;
  try {
    for (let start = 0; start < rows.length; start += KNOWLEDGE_LIMITS.batch) {
      const response = await fetch("/api/knowledge", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: rows.slice(start, start + KNOWLEDGE_LIMITS.batch),
        }),
      });
      if (!response.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Fusiona el modelo de conocimiento local con el del servidor por
// clave (idioma:lema); gana el updatedAt más reciente, lápidas
// incluidas, como en las anotaciones. Devuelve cuántas filas llegaron,
// o null si no hubo sesión o el ciclo no se completó.
export async function syncKnowledge() {
  if (!getActiveUserId()) return null;

  let remote: KnownWord[] | null = null;
  try {
    const response = await fetch("/api/knowledge");
    if (response.ok) {
      const data = (await response.json()) as { rows?: KnownWord[] };
      // La clave se deriva de idioma+lema; se recalcula por si faltara.
      remote = (data.rows ?? []).map((item) => ({
        ...item,
        key: item.key || knowledgeKey(item.language, item.lemma),
      }));
    }
  } catch {
    remote = null;
  }
  if (!remote) return null;

  const local = await listAllKnowledge();
  const localByKey = new Map(local.map((item) => [item.key, item]));
  const remoteByKey = new Map(remote.map((item) => [item.key, item]));

  let pulled = 0;
  for (const item of remote) {
    const existing = localByKey.get(item.key);
    if (!existing || item.updatedAt > existing.updatedAt) {
      await putKnowledge(item);
      pulled += 1;
    }
  }

  const toPush = local.filter((item) => {
    const remoteItem = remoteByKey.get(item.key);
    return !remoteItem || item.updatedAt > remoteItem.updatedAt;
  });
  if (!(await pushKnowledgeToServer(toPush))) return null;

  // Solo se sella la fecha cuando el ciclo completo salió, como en los
  // demás syncs: una sincronización parcial no cuenta como «al día».
  await saveSessionValue(KNOWLEDGE_SYNC_KEY, String(Date.now()));
  return pulled;
}
