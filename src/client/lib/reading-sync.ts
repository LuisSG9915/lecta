import {
  captureDbScope,
  isDbScopeActive,
  knowledgeKey,
  listAllAnnotations,
  listAllKnowledge,
  listAllReviews,
  listIntervals,
  listPositions,
  listSavedWords,
  putAnnotation,
  putKnowledge,
  putMissingIntervals,
  putReviews,
  saveSessionValue,
  getBookData,
  saveBook,
  listBooks,
  type DbScope,
  type KnownWord,
  type SavedAnnotation,
  type SavedInterval,
  type SavedReview,
} from "./idb";
export { getBookData };
import { accountFetch } from "./account-fetch";
import {
  advanceSyncCompoundCursor,
  advanceSyncCursor,
  getSyncCompoundCursor,
  getSyncCursor,
  resetPullCursors,
} from "./sync-cursors";
import { type PushResult } from "./sync-push";
import {
  clearCollectionPagesPending,
  isSyncPaused,
  markCollectionPagesPending,
  pauseSync,
  registerReadingSyncContinuationRunner,
  resumeSync,
  scheduleReadingSyncContinuation,
} from "./sync-state";
export { pauseSync, resumeSync, scheduleReadingSyncContinuation };
import { pushWordsToServer, syncSavedWords } from "./vocab";
import {
  flushPendingPositions,
  pushPositionsToServer,
  syncPositions,
} from "./positions-sync";
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

export type SyncCollectionKey =
  | "words"
  | "annotations"
  | "activity"
  | "reviews"
  | "knowledge"
  | "positions";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFlushRunner: (() => Promise<void>) | null = null;
const dirtyCollections = new Set<SyncCollectionKey>();

export function registerReadingSyncRunner(runner: () => Promise<void>): void {
  pendingFlushRunner = runner;
  registerReadingSyncContinuationRunner(() => {
    void runner();
  });
}

export function scheduleReadingSyncPush(
  collection: SyncCollectionKey,
  delayMs = 2000,
): void {
  if (isSyncPaused()) return;
  dirtyCollections.add(collection);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void flushPendingReadingSync();
  }, delayMs);
}

export async function flushPendingReadingSync(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (isSyncPaused()) return;
  if (dirtyCollections.size === 0 || !pendingFlushRunner) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  dirtyCollections.clear();
  await pendingFlushRunner();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushPendingReadingSync();
    }
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void flushPendingReadingSync();
  });
}

// Empuja anotaciones al servidor cuando hay sesión. Devuelve false si
// el envío falló, no hubo respuesta válida o el contexto de cuenta
// venció a mitad de los lotes: nunca se finge sync ni se escribe bajo
// la cuenta nueva.
export async function pushAnnotationsToServer(
  annotations: SavedAnnotation[],
  scope?: DbScope,
): Promise<PushResult> {
  if (isSyncPaused()) return { ok: false, acceptedMax: 0 };
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !annotations.length) return { ok: true, acceptedMax: 0 };
  if (!isDbScopeActive(bound)) return { ok: false, acceptedMax: 0 };
  const sorted = [...annotations].sort((a, b) => annotationStamp(a) - annotationStamp(b));
  let acceptedMax = 0;
  let lastAcceptedKey: string | undefined;
  try {
    for (let start = 0; start < sorted.length; start += ANNOTATION_LIMITS.batch) {
      const batch = sorted.slice(start, start + ANNOTATION_LIMITS.batch);
      const response = await accountFetch(
        "/api/annotations",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ annotations: batch }),
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
            await putAnnotation({ ...item, updatedAt: serverTime }, bound);
          }
        }
      }
      const lastItem = batch[batch.length - 1];
      const stamp = annotationStamp(lastItem);
      acceptedMax = Math.max(acceptedMax, serverTime ? Math.min(stamp, serverTime) : stamp);
      lastAcceptedKey = lastItem.key;
    }
    return { ok: true, acceptedMax, lastAcceptedKey };
  } catch {
    return { ok: false, acceptedMax, lastAcceptedKey };
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

  const local = await listAllAnnotations(undefined, bound);
  const cursor = getSyncCursor(bound.userId, "annotations");
  const effectiveSince = local.length > 0 ? cursor : 0;

  let currentSince = effectiveSince;
  let currentAfterId: string | undefined;
  let page = 0;
  const MAX_PAGES = 25;
  let hasMore = true;
  const remoteAll: SavedAnnotation[] = [];
  let serverTime: number | undefined;
  let nextCursor: number | undefined;
  let allOk = true;

  while (hasMore && page < MAX_PAGES) {
    page++;
    let data: {
      annotations?: SavedAnnotation[];
      serverTime?: number;
      hasMore?: boolean;
      nextCursor?: number;
      nextAfterId?: string | null;
    };
    try {
      const params = new URLSearchParams();
      if (currentSince > 0) params.set("since", String(currentSince));
      if (currentAfterId) params.set("afterId", currentAfterId);
      const url = params.size
        ? `/api/annotations?${params.toString()}`
        : "/api/annotations";
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
    const items = (data.annotations ?? []).map((item) => ({
      ...item,
      key: item.key || `${item.bookHash}:${item.id}`,
    }));
    remoteAll.push(...items);

    hasMore = Boolean(data.hasMore);
    if (hasMore && data.nextCursor !== undefined) {
      currentSince = data.nextCursor;
      currentAfterId = data.nextAfterId ?? undefined;
    }
    if (!hasMore && data.nextCursor) {
      nextCursor = data.nextCursor;
    }
  }

  if (!allOk) return null;
  if (hasMore) {
    markCollectionPagesPending("annotations");
    scheduleReadingSyncContinuation("annotations");
  } else {
    clearCollectionPagesPending("annotations");
  }

  const localByKey = new Map(local.map((item) => [item.key, item]));
  const remoteByKey = new Map(remoteAll.map((item) => [item.key, item]));

  let pulled = 0;
  let maxUpdated = effectiveSince;
  if (serverTime && serverTime > maxUpdated) maxUpdated = serverTime;

  for (const item of remoteAll) {
    const s = annotationStamp(item);
    if (s > maxUpdated) maxUpdated = s;
    const existing = localByKey.get(item.key);
    if (!existing || s > annotationStamp(existing)) {
      await putAnnotation(item, bound);
      pulled += 1;
    }
  }

  // Desacoplar toPush de effectiveSince con orden y cursor seguro
  const lastCursor = getSyncCompoundCursor(bound.userId, "annotations:push");
  const toPush = local
    .filter((item) => {
      const s = annotationStamp(item);
      const remoteItem = remoteByKey.get(item.key);
      if (remoteItem) {
        return s > annotationStamp(remoteItem);
      }
      if (lastCursor.key) {
        if (s > lastCursor.stamp) return true;
        if (s === lastCursor.stamp && item.key > lastCursor.key) return true;
        return false;
      }
      return lastCursor.stamp > 0 ? s > lastCursor.stamp : true;
    })
    .sort((a, b) => {
      const diff = annotationStamp(a) - annotationStamp(b);
      return diff !== 0 ? diff : a.key.localeCompare(b.key);
    });

  if (toPush.length > 0) {
    const pushed = await pushAnnotationsToServer(toPush, bound);
    // El cursor avanza hasta lo confirmado, nunca al reloj: lo que quedó
    // fuera se reenvía en el siguiente ciclo.
    if (pushed.acceptedMax > 0) {
      if (pushed.lastAcceptedKey) {
        advanceSyncCompoundCursor(bound.userId, "annotations:push", {
          stamp: pushed.acceptedMax,
          key: pushed.lastAcceptedKey,
        });
      } else {
        advanceSyncCursor(bound.userId, "annotations:push", pushed.acceptedMax);
      }
    }
    if (!pushed.ok) return null;
  }

  // Solo se sella la fecha cuando el ciclo completo salió: una
  // sincronización parcial no cuenta como «al día».
  const finalCursor = hasMore ? currentSince : (nextCursor ?? maxUpdated);
  if (finalCursor > 0) {
    advanceSyncCursor(bound.userId, "annotations", finalCursor);
  }
  if (!hasMore) {
    await saveSessionValue(LAST_SYNC_KEY, String(Date.now()), bound);
  }
  return pulled;
}

// Empuja intervalos nuevos al servidor. Como son inmutables el envío
// es seguro de repetir: el servidor descarta los ids que ya tiene.
export async function pushActivityToServer(
  intervals: SavedInterval[],
  scope?: DbScope,
): Promise<PushResult> {
  if (isSyncPaused()) return { ok: false, acceptedMax: 0 };
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !intervals.length) return { ok: true, acceptedMax: 0 };
  if (!isDbScopeActive(bound)) return { ok: false, acceptedMax: 0 };
  const stamp = (item: SavedInterval) => item.endedAt ?? item.startedAt;
  const sorted = [...intervals].sort((a, b) => stamp(a) - stamp(b));
  let acceptedMax = 0;
  let lastAcceptedKey: string | undefined;
  try {
    for (let start = 0; start < sorted.length; start += ACTIVITY_LIMITS.batch) {
      const batch = sorted.slice(start, start + ACTIVITY_LIMITS.batch);
      const response = await accountFetch(
        "/api/activity",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ intervals: batch }),
          keepalive: true,
        },
        bound,
      );
      if (!response.ok) return { ok: false, acceptedMax, lastAcceptedKey };
      const data = (await response.json().catch(() => null)) as { serverTime?: number } | null;
      const serverTime = data?.serverTime;
      const lastItem = batch[batch.length - 1];
      const itemStamp = stamp(lastItem);
      acceptedMax = Math.max(acceptedMax, serverTime ? Math.min(itemStamp, serverTime) : itemStamp);
      lastAcceptedKey = lastItem.id;
    }
    return { ok: true, acceptedMax, lastAcceptedKey };
  } catch {
    return { ok: false, acceptedMax, lastAcceptedKey };
  }
}

// Fusiona actividad local y remota por id: llegan solo los intervalos
// que este dispositivo no conoce y se suben los que el servidor no
// tiene. Devuelve cuántos llegaron, o null si no hubo sesión/respuesta
// o la cuenta cambió a mitad del ciclo.
export async function syncActivity(scope?: DbScope) {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return null;

  const local = await listIntervals(bound);
  const cursor = getSyncCursor(bound.userId, "activity");
  const effectiveSince = local.length > 0 ? cursor : 0;

  let currentSince = effectiveSince;
  let currentAfterId: string | undefined = undefined;
  let page = 0;
  const MAX_PAGES = 25;
  let hasMore = true;
  const remoteAll: SavedInterval[] = [];
  let serverTime: number | undefined;
  let nextCursor: number | undefined;
  let allOk = true;

  while (hasMore && page < MAX_PAGES) {
    page++;
    let data: {
      intervals?: SavedInterval[];
      serverTime?: number;
      hasMore?: boolean;
      nextCursor?: number;
      nextAfterId?: string;
    };
    try {
      const params = new URLSearchParams();
      if (currentSince > 0) params.set("since", String(currentSince));
      if (currentAfterId) params.set("afterId", currentAfterId);
      const url = params.size
        ? `/api/activity?${params.toString()}`
        : "/api/activity";
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
    const items = data.intervals ?? [];
    remoteAll.push(...items);

    hasMore = Boolean(data.hasMore);
    if (hasMore) {
      // La primera página sin since se ordena por id: se sigue con el
      // cursor de id para no mezclar ended_at con un corte por id.
      if (currentSince > 0 && data.nextCursor !== undefined) {
        currentSince = data.nextCursor;
        currentAfterId = data.nextAfterId ?? undefined;
      } else if (data.nextAfterId) {
        currentAfterId = data.nextAfterId;
      }
    }
    if (!hasMore && data.nextCursor) {
      nextCursor = data.nextCursor;
    }
  }

  if (!allOk) return null;
  if (hasMore) {
    markCollectionPagesPending("activity");
    scheduleReadingSyncContinuation("activity");
  } else {
    clearCollectionPagesPending("activity");
  }

  const remoteIds = new Set(remoteAll.map((item) => item.id));
  const localIds = new Set(local.map((item) => item.id));

  let maxUpdated = effectiveSince;
  if (serverTime && serverTime > maxUpdated) maxUpdated = serverTime;
  for (const item of remoteAll) {
    const s = item.endedAt ?? item.startedAt;
    if (s > maxUpdated) maxUpdated = s;
  }

  const pulled = await putMissingIntervals(
    remoteAll.filter((item) => !localIds.has(item.id)),
    bound,
  );

  // Desacoplar toPush de effectiveSince con orden y cursor seguro
  const lastCursor = getSyncCompoundCursor(bound.userId, "activity:push");
  const toPush = local
    .filter((item) => {
      if (remoteIds.has(item.id)) return false;
      const s = item.endedAt ?? item.startedAt;
      if (lastCursor.key) {
        if (s > lastCursor.stamp) return true;
        if (s === lastCursor.stamp && item.id > lastCursor.key) return true;
        return false;
      }
      return lastCursor.stamp > 0 ? s > lastCursor.stamp : true;
    })
    .sort((a, b) => {
      const sA = a.endedAt ?? a.startedAt;
      const sB = b.endedAt ?? b.startedAt;
      const diff = sA - sB;
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

  if (toPush.length > 0) {
    const pushed = await pushActivityToServer(toPush, bound);
    if (pushed.acceptedMax > 0) {
      if (pushed.lastAcceptedKey) {
        advanceSyncCompoundCursor(bound.userId, "activity:push", {
          stamp: pushed.acceptedMax,
          key: pushed.lastAcceptedKey,
        });
      } else {
        advanceSyncCursor(bound.userId, "activity:push", pushed.acceptedMax);
      }
    }
    if (!pushed.ok) return null;
  }

  const finalCursor = hasMore ? currentSince : (nextCursor ?? maxUpdated);
  if (finalCursor > 0) {
    advanceSyncCursor(bound.userId, "activity", finalCursor);
  }
  if (!hasMore) {
    await saveSessionValue(ACTIVITY_SYNC_KEY, String(Date.now()), bound);
  }
  return pulled;
}

// Empuja repasos nuevos al servidor. Igual que la actividad son
// inmutables: reenviar es seguro, el servidor descarta ids repetidos.
export async function pushReviewsToServer(
  reviews: SavedReview[],
  scope?: DbScope,
): Promise<PushResult> {
  if (isSyncPaused()) return { ok: false, acceptedMax: 0 };
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !reviews.length) return { ok: true, acceptedMax: 0 };
  if (!isDbScopeActive(bound)) return { ok: false, acceptedMax: 0 };
  const sorted = [...reviews].sort((a, b) => a.createdAt - b.createdAt);
  let acceptedMax = 0;
  let lastAcceptedKey: string | undefined;
  try {
    for (let start = 0; start < sorted.length; start += REVIEW_LIMITS.batch) {
      const batch = sorted.slice(start, start + REVIEW_LIMITS.batch);
      const response = await accountFetch(
        "/api/reviews",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reviews: batch }),
          keepalive: true,
        },
        bound,
      );
      if (!response.ok) return { ok: false, acceptedMax, lastAcceptedKey };
      const data = (await response.json().catch(() => null)) as { serverTime?: number } | null;
      const serverTime = data?.serverTime;
      const lastItem = batch[batch.length - 1];
      acceptedMax = Math.max(acceptedMax, serverTime ? Math.min(lastItem.createdAt, serverTime) : lastItem.createdAt);
      lastAcceptedKey = lastItem.id;
    }
    return { ok: true, acceptedMax, lastAcceptedKey };
  } catch {
    return { ok: false, acceptedMax, lastAcceptedKey };
  }
}

// Fusiona repasos locales y remotos por id: llegan solo los que este
// dispositivo no conoce y se suben los que el servidor no tiene.
// Devuelve cuántos llegaron, o null si no hubo sesión/respuesta o la
// cuenta cambió a mitad del ciclo.
export async function syncReviews(scope?: DbScope) {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return null;

  const local = await listAllReviews(bound);
  const cursor = getSyncCursor(bound.userId, "reviews");
  const effectiveSince = local.length > 0 ? cursor : 0;

  let currentSince = effectiveSince;
  let currentAfterId: string | undefined = undefined;
  let page = 0;
  const MAX_PAGES = 25;
  let hasMore = true;
  const remoteAll: SavedReview[] = [];
  let serverTime: number | undefined;
  let nextCursor: number | undefined;
  let allOk = true;

  while (hasMore && page < MAX_PAGES) {
    page++;
    let data: {
      reviews?: SavedReview[];
      serverTime?: number;
      hasMore?: boolean;
      nextCursor?: number;
      nextAfterId?: string;
    };
    try {
      const params = new URLSearchParams();
      if (currentSince > 0) params.set("since", String(currentSince));
      if (currentAfterId) params.set("afterId", currentAfterId);
      const url = params.size
        ? `/api/reviews?${params.toString()}`
        : "/api/reviews";
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
    const items = data.reviews ?? [];
    remoteAll.push(...items);

    hasMore = Boolean(data.hasMore);
    if (hasMore) {
      // La primera página sin since se ordena por id: se sigue con el
      // cursor de id para no mezclar ended_at con un corte por id.
      if (currentSince > 0 && data.nextCursor !== undefined) {
        currentSince = data.nextCursor;
        currentAfterId = data.nextAfterId ?? undefined;
      } else if (data.nextAfterId) {
        currentAfterId = data.nextAfterId;
      }
    }
    if (!hasMore && data.nextCursor) {
      nextCursor = data.nextCursor;
    }
  }

  if (!allOk) return null;
  if (hasMore) {
    markCollectionPagesPending("reviews");
    scheduleReadingSyncContinuation("reviews");
  } else {
    clearCollectionPagesPending("reviews");
  }

  const remoteIds = new Set(remoteAll.map((item) => item.id));
  const localIds = new Set(local.map((item) => item.id));

  let maxUpdated = effectiveSince;
  if (serverTime && serverTime > maxUpdated) maxUpdated = serverTime;
  for (const item of remoteAll) {
    if (item.createdAt > maxUpdated) maxUpdated = item.createdAt;
  }

  const pulled = await putReviews(
    remoteAll.filter((item) => !localIds.has(item.id)),
    bound,
  );

  // Desacoplar toPush de effectiveSince con orden y cursor seguro
  const lastCursor = getSyncCompoundCursor(bound.userId, "reviews:push");
  const toPush = local
    .filter((item) => {
      if (remoteIds.has(item.id)) return false;
      if (lastCursor.key) {
        if (item.createdAt > lastCursor.stamp) return true;
        if (item.createdAt === lastCursor.stamp && item.id > lastCursor.key) return true;
        return false;
      }
      return lastCursor.stamp > 0 ? item.createdAt > lastCursor.stamp : true;
    })
    .sort((a, b) => {
      const diff = a.createdAt - b.createdAt;
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

  if (toPush.length > 0) {
    const pushed = await pushReviewsToServer(toPush, bound);
    if (pushed.acceptedMax > 0) {
      if (pushed.lastAcceptedKey) {
        advanceSyncCompoundCursor(bound.userId, "reviews:push", {
          stamp: pushed.acceptedMax,
          key: pushed.lastAcceptedKey,
        });
      } else {
        advanceSyncCursor(bound.userId, "reviews:push", pushed.acceptedMax);
      }
    }
    if (!pushed.ok) return null;
  }

  const finalCursor = hasMore ? currentSince : (nextCursor ?? maxUpdated);
  if (finalCursor > 0) {
    advanceSyncCursor(bound.userId, "reviews", finalCursor);
  }
  if (!hasMore) {
    await saveSessionValue(REVIEWS_SYNC_KEY, String(Date.now()), bound);
  }
  return pulled;
}

// Empuja evidencia de conocimiento al servidor cuando hay sesión.
// Mismo criterio que las anotaciones: lotes de KNOWLEDGE_LIMITS.batch,
// se detiene al primer lote fallido y devuelve false — nunca se finge
// sincronización ni se escribe bajo la cuenta nueva.
export async function pushKnowledgeToServer(
  rows: KnownWord[],
  scope?: DbScope,
): Promise<PushResult> {
  if (isSyncPaused()) return { ok: false, acceptedMax: 0 };
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !rows.length) return { ok: true, acceptedMax: 0 };
  if (!isDbScopeActive(bound)) return { ok: false, acceptedMax: 0 };
  const sorted = [...rows].sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
  let acceptedMax = 0;
  let lastAcceptedKey: string | undefined;
  try {
    for (let start = 0; start < sorted.length; start += KNOWLEDGE_LIMITS.batch) {
      const batch = sorted.slice(start, start + KNOWLEDGE_LIMITS.batch);
      const response = await accountFetch(
        "/api/knowledge",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rows: batch }),
          keepalive: true,
        },
        bound,
      );
      if (!response.ok) return { ok: false, acceptedMax, lastAcceptedKey };
      const data = (await response.json().catch(() => null)) as { serverTime?: number } | null;
      const serverTime = data?.serverTime;
      if (serverTime) {
        for (const item of batch) {
          if ((item.updatedAt ?? 0) > serverTime) {
            await putKnowledge({ ...item, updatedAt: serverTime }, bound);
          }
        }
      }
      const lastItem = batch[batch.length - 1];
      const stamp = lastItem.updatedAt ?? 0;
      acceptedMax = Math.max(acceptedMax, serverTime ? Math.min(stamp, serverTime) : stamp);
      lastAcceptedKey = lastItem.key || knowledgeKey(lastItem.language, lastItem.lemma);
    }
    return { ok: true, acceptedMax, lastAcceptedKey };
  } catch {
    return { ok: false, acceptedMax, lastAcceptedKey };
  }
}

// Fusiona el modelo de conocimiento local con el del servidor por
// clave (idioma:lema). El arbitraje es el orden convergente
// knowledgeArbWins —peso de fuente (lápida = explícita), sello,
// lápida, veredicto—, idéntico al de la escritura local y al upsert
// del servidor: cualquier orden de llegada converge al mismo ganador.
// Devuelve cuántas filas llegaron, o null si no hubo sesión, el ciclo
// no se completó o la cuenta cambió a mitad del ciclo.
export async function syncKnowledge(
  scope?: DbScope,
  options?: { language?: string },
) {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return null;

  const local = await listAllKnowledge(undefined, bound);
  const cursorKey = options?.language
    ? `knowledge:${options.language}`
    : "knowledge";
  const cursor = getSyncCursor(bound.userId, cursorKey);
  const effectiveSince = local.length > 0 ? cursor : 0;

  let currentSince = effectiveSince;
  let currentAfterWord: string | undefined;
  let currentAfterLanguage: string | undefined;
  let page = 0;
  const MAX_PAGES = 25;
  let hasMore = true;
  const remoteAll: KnownWord[] = [];
  let serverTime: number | undefined;
  let nextCursor: number | undefined;
  let allOk = true;

  while (hasMore && page < MAX_PAGES) {
    page++;
    let data: {
      rows?: KnownWord[];
      serverTime?: number;
      hasMore?: boolean;
      nextCursor?: number;
      nextAfterWord?: string | null;
      nextAfterLanguage?: string | null;
      availableLanguages?: string[];
    };
    try {
      const params = new URLSearchParams();
      if (options?.language) params.set("language", options.language);
      if (currentSince > 0) params.set("since", String(currentSince));
      if (currentAfterWord) params.set("afterWord", currentAfterWord);
      if (currentAfterLanguage) params.set("afterLanguage", currentAfterLanguage);
      if (page > 1) params.set("includeLanguages", "0");
      const url = params.size
        ? `/api/knowledge?${params.toString()}`
        : "/api/knowledge";
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
    const pageItems = (data.rows ?? []).map((item) => ({
      ...item,
      key: item.key || knowledgeKey(item.language, item.lemma),
    }));
    remoteAll.push(...pageItems);

    hasMore = Boolean(data.hasMore);
    if (hasMore && data.nextCursor !== undefined) {
      currentSince = data.nextCursor;
      currentAfterWord = data.nextAfterWord ?? undefined;
      currentAfterLanguage = data.nextAfterLanguage ?? undefined;
    }
    if (!hasMore && data.nextCursor) {
      nextCursor = data.nextCursor;
    }
  }

  if (!allOk) return null;
  if (hasMore) {
    markCollectionPagesPending("knowledge");
    scheduleReadingSyncContinuation("knowledge");
  } else {
    clearCollectionPagesPending("knowledge");
  }

  const localByKey = new Map(local.map((item) => [item.key, item]));
  const remoteByKey = new Map(remoteAll.map((item) => [item.key, item]));

  let pulled = 0;
  let maxUpdated = effectiveSince;
  if (serverTime && serverTime > maxUpdated) maxUpdated = serverTime;

  for (const item of remoteAll) {
    const s = item.updatedAt ?? 0;
    if (s > maxUpdated) maxUpdated = s;
    const existing = localByKey.get(item.key);
    if (!existing || knowledgeArbWins(item, existing)) {
      const passiveCount =
        item.passiveSeenCount != null || existing?.passiveSeenCount != null
          ? Math.max(item.passiveSeenCount ?? 0, existing?.passiveSeenCount ?? 0)
          : undefined;
      const toPut: KnownWord = passiveCount !== undefined ? { ...item, passiveSeenCount: passiveCount } : item;
      await putKnowledge(toPut, bound);
      pulled += 1;
    }
  }

  // Desacoplar toPush de effectiveSince con orden y cursor seguro
  const pushCursorKey = options?.language
    ? `knowledge:${options.language}:push`
    : "knowledge:push";
  const lastCursor = getSyncCompoundCursor(bound.userId, pushCursorKey);
  const toPush = local
    .filter((item) => {
      if (options?.language && item.language !== options.language) return false;
      const s = item.updatedAt ?? 0;
      const remoteItem = remoteByKey.get(item.key);
      if (remoteItem) {
        return knowledgeArbWins(item, remoteItem);
      }
      if (lastCursor.key) {
        if (s > lastCursor.stamp) return true;
        if (s === lastCursor.stamp && item.key > lastCursor.key) return true;
        return false;
      }
      return lastCursor.stamp > 0 ? s > lastCursor.stamp : true;
    })
    .sort((a, b) => {
      const diff = (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
      const keyA = a.key || knowledgeKey(a.language, a.lemma);
      const keyB = b.key || knowledgeKey(b.language, b.lemma);
      return diff !== 0 ? diff : keyA.localeCompare(keyB);
    });

  if (toPush.length > 0) {
    const pushed = await pushKnowledgeToServer(toPush, bound);
    // El conocimiento se arbitra por `knowledgeArbWins`, así que reenviar
    // es seguro; el cursor solo avanza hasta lo confirmado.
    if (pushed.acceptedMax > 0) {
      if (pushed.lastAcceptedKey) {
        advanceSyncCompoundCursor(bound.userId, pushCursorKey, {
          stamp: pushed.acceptedMax,
          key: pushed.lastAcceptedKey,
        });
      } else {
        advanceSyncCursor(bound.userId, pushCursorKey, pushed.acceptedMax);
      }
    }
    if (!pushed.ok) return null;
  }

  // Solo se sella la fecha cuando el ciclo completo salió, como en los
  // demás syncs: una sincronización parcial no cuenta como «al día».
  const finalCursor = hasMore ? currentSince : (nextCursor ?? maxUpdated);
  if (finalCursor > 0) {
    advanceSyncCursor(bound.userId, cursorKey, finalCursor);
  }
  if (!hasMore) {
    await saveSessionValue(KNOWLEDGE_SYNC_KEY, String(Date.now()), bound);
  }
  return pulled;
}

export async function syncUserBookUpload(book: {
  id: string;
  title: string;
  author?: string;
  data: ArrayBuffer;
}): Promise<boolean> {
  try {
    const res = await fetch(`/api/user/books/${encodeURIComponent(book.id)}/file`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/epub+zip",
        "x-book-title": encodeURIComponent(book.title),
        "x-book-author": encodeURIComponent(book.author ?? ""),
      },
      body: book.data,
    });
    return res.ok;
  } catch {
    return false; // Local-first: si está offline, no interrumpir al usuario
  }
}

export async function pullMissingUserBooksFromCloud(): Promise<number> {
  try {
    const res = await fetch("/api/user/books");
    if (!res.ok) return 0;
    const { books: remoteBooks } = (await res.json()) as {
      books: Array<{ id: string; title: string; author: string; updatedAt: number }>;
    };

    const localBooks = await listBooks();
    const localIds = new Set(localBooks.map((b) => b.id));
    let downloaded = 0;

    for (const remote of remoteBooks) {
      if (localIds.has(remote.id)) continue;
      const fileRes = await fetch(`/api/user/books/${encodeURIComponent(remote.id)}/file`);
      if (!fileRes.ok) continue;
      const buffer = await fileRes.arrayBuffer();
      await saveBook({
        id: remote.id,
        title: remote.title,
        author: remote.author,
        addedAt: remote.updatedAt,
        data: buffer,
      });
      downloaded++;
    }
    return downloaded;
  } catch {
    return 0;
  }
}

export interface ResyncResult {
  ok: boolean;
  serverCounts?: {
    words: number;
    annotations: number;
    activity: number;
    reviews: number;
    positions: number;
    knowledge: number;
  };
  localCounts?: {
    words: number;
    annotations: number;
    activity: number;
    reviews: number;
    positions: number;
    knowledge: number;
  };
  diverged?: boolean;
  error?: string;
}

export async function forceFullResyncFromServer(
  scope?: DbScope,
): Promise<ResyncResult> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) {
    return { ok: false, error: "No hay sesión activa" };
  }

  // 1. Flush/push de cambios pendientes locales
  await flushPendingReadingSync();
  await flushPendingPositions(bound);

  const [localWords, localAnn, localAct, localRev, localPos, localKnow] =
    await Promise.all([
      listSavedWords(undefined, bound),
      listAllAnnotations(undefined, bound),
      listIntervals(bound),
      listAllReviews(bound),
      listPositions(bound),
      listAllKnowledge(undefined, bound),
    ]);

  if (localWords.length) await pushWordsToServer(localWords, bound);
  if (localAnn.length) await pushAnnotationsToServer(localAnn, bound);
  if (localAct.length) await pushActivityToServer(localAct, bound);
  if (localRev.length) await pushReviewsToServer(localRev, bound);
  if (localPos.length) await pushPositionsToServer(localPos, bound);
  if (localKnow.length) await pushKnowledgeToServer(localKnow, bound);

  // 2. Reiniciar a 0 todos los cursores locales de pull
  resetPullCursors(bound.userId);

  // 3. Ejecutar el pull completo de todas las colecciones
  await Promise.all([
    syncSavedWords(bound),
    syncAnnotations(bound),
    syncActivity(bound),
    syncReviews(bound),
    syncPositions(bound),
    syncKnowledge(bound),
  ]);

  // 4. Comparar conteos locales activos contra /api/sync/counts
  let serverCounts: ResyncResult["serverCounts"];
  try {
    const res = await accountFetch("/api/sync/counts", undefined, bound);
    if (!res.ok) {
      return { ok: false, error: "Error al consultar conteos del servidor" };
    }
    const data = (await res.json()) as { counts: ResyncResult["serverCounts"] };
    serverCounts = data.counts;
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Error de red al consultar conteos",
    };
  }

  const [activeWords, activeAnn, activeAct, activeRev, activePos, activeKnow] =
    await Promise.all([
      listSavedWords(undefined, bound).then(
        (items) => items.filter((w) => !w.deleted).length,
      ),
      listAllAnnotations(undefined, bound).then(
        (items) => items.filter((a) => !a.deleted).length,
      ),
      listIntervals(bound).then((items) => items.length),
      listAllReviews(bound).then((items) => items.length),
      listPositions(bound).then((items) => items.length),
      listAllKnowledge(undefined, bound).then(
        (items: KnownWord[]) => items.filter((k) => !k.deleted).length,
      ),
    ]);

  const localCounts = {
    words: activeWords,
    annotations: activeAnn,
    activity: activeAct,
    reviews: activeRev,
    positions: activePos,
    knowledge: activeKnow,
  };

  const diverged =
    !serverCounts ||
    localCounts.words !== serverCounts.words ||
    localCounts.annotations !== serverCounts.annotations ||
    localCounts.activity !== serverCounts.activity ||
    localCounts.reviews !== serverCounts.reviews ||
    localCounts.positions !== serverCounts.positions ||
    localCounts.knowledge !== serverCounts.knowledge;

  return {
    ok: true,
    serverCounts,
    localCounts,
    diverged,
  };
}
