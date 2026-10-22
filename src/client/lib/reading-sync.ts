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
import { getSyncCursor, setSyncCursor } from "./sync-cursors";
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

export function flushPendingReadingSync(): Promise<void> {
  // If visibility changes to hidden while saving, ensure active sync flushes
  return Promise.resolve();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushPendingReadingSync();
    }
  });
}

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
    };
    try {
      const url =
        currentSince > 0
          ? `/api/annotations?since=${currentSince}`
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
    if (hasMore && data.nextCursor) {
      currentSince = data.nextCursor;
      setSyncCursor(bound.userId, "annotations", currentSince);
    }
    if (!hasMore && data.nextCursor) {
      nextCursor = data.nextCursor;
    }
  }

  if (!allOk) return null;

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

  // Desacoplar toPush de effectiveSince
  const lastPushedAt = getSyncCursor(bound.userId, "annotations:push");
  const toPush = local.filter((item) => {
    const s = annotationStamp(item);
    const remoteItem = remoteByKey.get(item.key);
    if (remoteItem) {
      return s > annotationStamp(remoteItem);
    }
    return lastPushedAt > 0 ? s > lastPushedAt : true;
  });

  if (toPush.length > 0) {
    if (await pushAnnotationsToServer(toPush, bound)) {
      setSyncCursor(bound.userId, "annotations:push", Date.now());
    } else {
      return null;
    }
  } else if (lastPushedAt === 0) {
    setSyncCursor(bound.userId, "annotations:push", Date.now());
  }

  // Solo se sella la fecha cuando el ciclo completo salió: una
  // sincronización parcial no cuenta como «al día».
  const finalCursor = nextCursor ?? (maxUpdated > 0 ? maxUpdated : Date.now());
  setSyncCursor(bound.userId, "annotations", finalCursor);
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
      let url = "/api/activity";
      if (currentSince > 0) {
        url = `/api/activity?since=${currentSince}`;
      } else if (currentAfterId) {
        url = `/api/activity?afterId=${encodeURIComponent(currentAfterId)}`;
      }
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
      if (currentSince > 0 && data.nextCursor) {
        currentSince = data.nextCursor;
        setSyncCursor(bound.userId, "activity", currentSince);
      } else if (data.nextAfterId) {
        currentAfterId = data.nextAfterId;
      }
    }
    if (!hasMore && data.nextCursor) {
      nextCursor = data.nextCursor;
    }
  }

  if (!allOk) return null;

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

  // Desacoplar toPush de effectiveSince
  const lastPushedAt = getSyncCursor(bound.userId, "activity:push");
  const toPush = local.filter((item) => {
    if (remoteIds.has(item.id)) return false;
    const s = item.endedAt ?? item.startedAt;
    return lastPushedAt > 0 ? s > lastPushedAt : true;
  });

  if (toPush.length > 0) {
    if (await pushActivityToServer(toPush, bound)) {
      setSyncCursor(bound.userId, "activity:push", Date.now());
    } else {
      return null;
    }
  } else if (lastPushedAt === 0) {
    setSyncCursor(bound.userId, "activity:push", Date.now());
  }

  const finalCursor = nextCursor ?? (maxUpdated > 0 ? maxUpdated : Date.now());
  setSyncCursor(bound.userId, "activity", finalCursor);
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
      let url = "/api/reviews";
      if (currentSince > 0) {
        url = `/api/reviews?since=${currentSince}`;
      } else if (currentAfterId) {
        url = `/api/reviews?afterId=${encodeURIComponent(currentAfterId)}`;
      }
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
      if (currentSince > 0 && data.nextCursor) {
        currentSince = data.nextCursor;
        setSyncCursor(bound.userId, "reviews", currentSince);
      } else if (data.nextAfterId) {
        currentAfterId = data.nextAfterId;
      }
    }
    if (!hasMore && data.nextCursor) {
      nextCursor = data.nextCursor;
    }
  }

  if (!allOk) return null;

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

  // Desacoplar toPush de effectiveSince
  const lastPushedAt = getSyncCursor(bound.userId, "reviews:push");
  const toPush = local.filter((item) => {
    if (remoteIds.has(item.id)) return false;
    return lastPushedAt > 0 ? item.createdAt > lastPushedAt : true;
  });

  if (toPush.length > 0) {
    if (await pushReviewsToServer(toPush, bound)) {
      setSyncCursor(bound.userId, "reviews:push", Date.now());
    } else {
      return null;
    }
  } else if (lastPushedAt === 0) {
    setSyncCursor(bound.userId, "reviews:push", Date.now());
  }

  const finalCursor = nextCursor ?? (maxUpdated > 0 ? maxUpdated : Date.now());
  setSyncCursor(bound.userId, "reviews", finalCursor);
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
  const cursor =
    getSyncCursor(bound.userId, cursorKey) ||
    getSyncCursor(bound.userId, "knowledge");
  const effectiveSince = local.length > 0 ? cursor : 0;

  let currentSince = effectiveSince;
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
      availableLanguages?: string[];
    };
    try {
      const langParam = options?.language
        ? `language=${encodeURIComponent(options.language)}`
        : "";
      let url = "/api/knowledge";
      if (currentSince > 0) {
        url = langParam
          ? `/api/knowledge?${langParam}&since=${currentSince}`
          : `/api/knowledge?since=${currentSince}`;
      } else if (langParam) {
        url = `/api/knowledge?${langParam}`;
      }
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
    if (hasMore && data.nextCursor) {
      currentSince = data.nextCursor;
      setSyncCursor(bound.userId, cursorKey, currentSince);
      setSyncCursor(bound.userId, "knowledge", currentSince);
    }
    if (!hasMore && data.nextCursor) {
      nextCursor = data.nextCursor;
    }
  }

  if (!allOk) return null;

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
      await putKnowledge(item, bound);
      pulled += 1;
    }
  }

  // Desacoplar toPush de effectiveSince
  const pushCursorKey = options?.language
    ? `knowledge:${options.language}:push`
    : "knowledge:push";
  const lastPushedAt =
    getSyncCursor(bound.userId, pushCursorKey) ||
    getSyncCursor(bound.userId, "knowledge:push");
  const toPush = local.filter((item) => {
    if (options?.language && item.language !== options.language) return false;
    const s = item.updatedAt ?? 0;
    const remoteItem = remoteByKey.get(item.key);
    if (remoteItem) {
      return knowledgeArbWins(item, remoteItem);
    }
    return lastPushedAt > 0 ? s > lastPushedAt : true;
  });

  if (toPush.length > 0) {
    if (await pushKnowledgeToServer(toPush, bound)) {
      const pushNow = Date.now();
      setSyncCursor(bound.userId, pushCursorKey, pushNow);
      setSyncCursor(bound.userId, "knowledge:push", pushNow);
    } else {
      return null;
    }
  } else if (lastPushedAt === 0) {
    const pushNow = Date.now();
    setSyncCursor(bound.userId, pushCursorKey, pushNow);
    setSyncCursor(bound.userId, "knowledge:push", pushNow);
  }

  // Solo se sella la fecha cuando el ciclo completo salió, como en los
  // demás syncs: una sincronización parcial no cuenta como «al día».
  const finalCursor = nextCursor ?? (maxUpdated > 0 ? maxUpdated : Date.now());
  setSyncCursor(bound.userId, cursorKey, finalCursor);
  setSyncCursor(bound.userId, "knowledge", finalCursor);
  await saveSessionValue(KNOWLEDGE_SYNC_KEY, String(Date.now()), bound);
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
