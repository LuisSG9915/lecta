import {
  captureDbScope,
  isDbScopeActive,
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
  type DbScope,
  type KnownWord,
  type SavedAnnotation,
  type SavedInterval,
  type SavedReview,
} from "./idb";
import { accountFetch } from "./account-fetch";
import { knowledgeArbWins } from "../../shared/reading-data";
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
// el envío falló, no hubo respuesta válida o el contexto de cuenta
// venció a mitad de los lotes: nunca se finge sync ni se escribe bajo
// la cuenta nueva.
export async function pushAnnotationsToServer(
  annotations: SavedAnnotation[],
  scope?: DbScope,
): Promise<boolean> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !annotations.length) return true;
  if (!isDbScopeActive(bound)) return false;
  try {
    // El servidor recorta cada PUT a ANNOTATION_LIMITS.batch; sin
    // lotes, el excedente se perdería sin aviso.
    for (let start = 0; start < annotations.length; start += ANNOTATION_LIMITS.batch) {
      const response = await accountFetch(
        "/api/annotations",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            annotations: annotations.slice(start, start + ANNOTATION_LIMITS.batch),
          }),
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

// Fusiona marcadores y pasajes locales con los del servidor por clave;
// el registro con updatedAt más reciente gana, lápidas incluidas (así
// un borrado sin conexión también se propaga). Devuelve cuántas
// anotaciones llegaron, o null si no hubo sesión/respuesta o la cuenta
// cambió a mitad del ciclo.
export async function syncAnnotations(scope?: DbScope) {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return null;

  let remote: SavedAnnotation[] | null = null;
  try {
    const response = await accountFetch("/api/annotations", undefined, bound);
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

  const local = await listAllAnnotations(undefined, bound);
  const localByKey = new Map(local.map((item) => [item.key, item]));
  const remoteByKey = new Map(remote.map((item) => [item.key, item]));

  let pulled = 0;
  for (const item of remote) {
    const existing = localByKey.get(item.key);
    if (!existing || annotationStamp(item) > annotationStamp(existing)) {
      await putAnnotation(item, bound);
      pulled += 1;
    }
  }

  const toPush = local.filter((item) => {
    const remoteItem = remoteByKey.get(item.key);
    return !remoteItem || annotationStamp(item) > annotationStamp(remoteItem);
  });
  if (!(await pushAnnotationsToServer(toPush, bound))) return null;

  // Solo se sella la fecha cuando el ciclo completo salió: una
  // sincronización parcial no cuenta como «al día».
  await saveSessionValue(LAST_SYNC_KEY, String(Date.now()), bound);
  return pulled;
}

// Empuja intervalos nuevos al servidor. Como son inmutables el envío
// es seguro de repetir: el servidor descarta los ids que ya tiene.
export async function pushActivityToServer(
  intervals: SavedInterval[],
  scope?: DbScope,
): Promise<boolean> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !intervals.length) return true;
  if (!isDbScopeActive(bound)) return false;
  try {
    for (let start = 0; start < intervals.length; start += ACTIVITY_LIMITS.batch) {
      const response = await accountFetch(
        "/api/activity",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intervals: intervals.slice(start, start + ACTIVITY_LIMITS.batch),
          }),
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

// Fusiona actividad local y remota por id: llegan solo los intervalos
// que este dispositivo no conoce y se suben los que el servidor no
// tiene. Devuelve cuántos llegaron, o null si no hubo sesión/respuesta
// o la cuenta cambió a mitad del ciclo.
export async function syncActivity(scope?: DbScope) {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return null;

  let remote: SavedInterval[] | null = null;
  try {
    const response = await accountFetch("/api/activity", undefined, bound);
    if (response.ok) {
      const data = (await response.json()) as { intervals?: SavedInterval[] };
      remote = data.intervals ?? [];
    }
  } catch {
    remote = null;
  }
  if (!remote) return null;

  const local = await listIntervals(bound);
  const remoteIds = new Set(remote.map((item) => item.id));
  const localIds = new Set(local.map((item) => item.id));

  const pulled = await putMissingIntervals(
    remote.filter((item) => !localIds.has(item.id)),
    bound,
  );
  const toPush = local.filter((item) => !remoteIds.has(item.id));
  if (!(await pushActivityToServer(toPush, bound))) return null;

  await saveSessionValue(ACTIVITY_SYNC_KEY, String(Date.now()), bound);
  return pulled;
}

// Empuja repasos nuevos al servidor. Igual que la actividad son
// inmutables: reenviar es seguro, el servidor descarta ids repetidos.
export async function pushReviewsToServer(
  reviews: SavedReview[],
  scope?: DbScope,
): Promise<boolean> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !reviews.length) return true;
  if (!isDbScopeActive(bound)) return false;
  try {
    for (let start = 0; start < reviews.length; start += REVIEW_LIMITS.batch) {
      const response = await accountFetch(
        "/api/reviews",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reviews: reviews.slice(start, start + REVIEW_LIMITS.batch),
          }),
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

// Fusiona repasos locales y remotos por id: llegan solo los que este
// dispositivo no conoce y se suben los que el servidor no tiene.
// Devuelve cuántos llegaron, o null si no hubo sesión/respuesta o la
// cuenta cambió a mitad del ciclo.
export async function syncReviews(scope?: DbScope) {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return null;

  let remote: SavedReview[] | null = null;
  try {
    const response = await accountFetch("/api/reviews", undefined, bound);
    if (response.ok) {
      const data = (await response.json()) as { reviews?: SavedReview[] };
      remote = data.reviews ?? [];
    }
  } catch {
    remote = null;
  }
  if (!remote) return null;

  const local = await listAllReviews(bound);
  const remoteIds = new Set(remote.map((item) => item.id));
  const localIds = new Set(local.map((item) => item.id));

  const pulled = await putReviews(
    remote.filter((item) => !localIds.has(item.id)),
    bound,
  );
  const toPush = local.filter((item) => !remoteIds.has(item.id));
  if (!(await pushReviewsToServer(toPush, bound))) return null;

  await saveSessionValue(REVIEWS_SYNC_KEY, String(Date.now()), bound);
  return pulled;
}

// Empuja evidencia de conocimiento al servidor cuando hay sesión.
// Mismo criterio que las anotaciones: lotes de KNOWLEDGE_LIMITS.batch,
// se detiene al primer lote fallido y devuelve false — nunca se finge
// sincronización ni se escribe bajo la cuenta nueva.
export async function pushKnowledgeToServer(
  rows: KnownWord[],
  scope?: DbScope,
): Promise<boolean> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !rows.length) return true;
  if (!isDbScopeActive(bound)) return false;
  try {
    for (let start = 0; start < rows.length; start += KNOWLEDGE_LIMITS.batch) {
      const response = await accountFetch(
        "/api/knowledge",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            rows: rows.slice(start, start + KNOWLEDGE_LIMITS.batch),
          }),
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

// Fusiona el modelo de conocimiento local con el del servidor por
// clave (idioma:lema). El arbitraje es el orden convergente
// knowledgeArbWins —peso de fuente (lápida = explícita), sello,
// lápida, veredicto—, idéntico al de la escritura local y al upsert
// del servidor: cualquier orden de llegada converge al mismo ganador.
// Devuelve cuántas filas llegaron, o null si no hubo sesión, el ciclo
// no se completó o la cuenta cambió a mitad del ciclo.
export async function syncKnowledge(scope?: DbScope) {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return null;

  let remote: KnownWord[] | null = null;
  try {
    const response = await accountFetch("/api/knowledge", undefined, bound);
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

  const local = await listAllKnowledge(undefined, bound);
  const localByKey = new Map(local.map((item) => [item.key, item]));
  const remoteByKey = new Map(remote.map((item) => [item.key, item]));

  let pulled = 0;
  for (const item of remote) {
    const existing = localByKey.get(item.key);
    if (!existing || knowledgeArbWins(item, existing)) {
      await putKnowledge(item, bound);
      pulled += 1;
    }
  }

  const toPush = local.filter((item) => {
    const remoteItem = remoteByKey.get(item.key);
    return !remoteItem || knowledgeArbWins(item, remoteItem);
  });
  if (!(await pushKnowledgeToServer(toPush, bound))) return null;

  // Solo se sella la fecha cuando el ciclo completo salió, como en los
  // demás syncs: una sincronización parcial no cuenta como «al día».
  await saveSessionValue(KNOWLEDGE_SYNC_KEY, String(Date.now()), bound);
  return pulled;
}
