import { useSyncExternalStore } from "react";

export type SyncCollection =
  | "words"
  | "positions"
  | "annotations"
  | "knowledge"
  | "activity"
  | "reviews"
  | "companion";

export type PendingCollection = SyncCollection | "books";

export interface CollectionSyncStatus {
  status: "idle" | "syncing" | "synced" | "error";
  lastSyncedAt?: number;
  error?: string | null;
}

export interface SyncState {
  isOnline: boolean;
  lastSyncedAt: number | null;
  pendingChangesCount: number;
  lastSyncError: string | null;
  collections: Record<SyncCollection, CollectionSyncStatus>;
}

const initialCollections: Record<SyncCollection, CollectionSyncStatus> = {
  words: { status: "idle" },
  positions: { status: "idle" },
  annotations: { status: "idle" },
  knowledge: { status: "idle" },
  activity: { status: "idle" },
  reviews: { status: "idle" },
  companion: { status: "idle" },
};

let rawPendingCount = 0;
const collectionPendingCounts: Partial<Record<PendingCollection, number>> = {};
// Colecciones que agotaron MAX_PAGES con `hasMore` todavía en true: el
// ciclo no terminó, aunque el cursor sí avanzó para continuar después.
const pagesPendingCollections: Partial<Record<SyncCollection, boolean>> = {};

export function computeEffectivePendingChanges(
  collections = currentState.collections,
  rawCount = rawPendingCount,
): number {
  const collectionSum = Object.values(collectionPendingCounts).reduce(
    (sum, c) => sum + (c || 0),
    0,
  );
  const errorCollectionsCount = Object.values(collections).filter(
    (c) => c.status === "error",
  ).length;
  const pagesPendingCount = Object.keys(pagesPendingCollections).length;
  return rawCount + collectionSum + errorCollectionsCount + pagesPendingCount;
}

let currentState: SyncState = {
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  lastSyncedAt: null,
  pendingChangesCount: 0,
  lastSyncError: null,
  collections: initialCollections,
};

const listeners = new Set<(state: SyncState) => void>();

function notify() {
  for (const listener of listeners) {
    try {
      listener(currentState);
    } catch {
      // Ignore listener errors
    }
  }
}

export function getSyncState(): SyncState {
  return currentState;
}

export function subscribeSyncState(listener: (state: SyncState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateSyncState(patch: Partial<SyncState>): void {
  currentState = { ...currentState, ...patch };
  notify();
}

export function setPendingChangesCount(count: number): void {
  rawPendingCount = Math.max(0, count);
  updateSyncState({
    pendingChangesCount: computeEffectivePendingChanges(),
  });
}

export function setCollectionPendingCount(
  collection: PendingCollection,
  count: number,
): void {
  collectionPendingCounts[collection] = Math.max(0, count);
  updateSyncState({
    pendingChangesCount: computeEffectivePendingChanges(),
  });
}

export function incrementCollectionPendingCount(
  collection: PendingCollection,
  delta = 1,
): void {
  const current = collectionPendingCounts[collection] ?? 0;
  setCollectionPendingCount(collection, current + delta);
}

export function markCollectionPagesPending(collection: SyncCollection): void {
  if (pagesPendingCollections[collection]) return;
  pagesPendingCollections[collection] = true;
  updateSyncState({
    pendingChangesCount: computeEffectivePendingChanges(),
  });
}

export function clearCollectionPagesPending(collection: SyncCollection): void {
  if (!pagesPendingCollections[collection]) return;
  delete pagesPendingCollections[collection];
  updateSyncState({
    pendingChangesCount: computeEffectivePendingChanges(),
  });
}

let continuationTimer: ReturnType<typeof setTimeout> | null = null;
let registeredContinuationRunner: (() => void) | null = null;

export function registerReadingSyncContinuationRunner(runner: () => void): void {
  registeredContinuationRunner = runner;
}

let syncPaused = false;

export function pauseSync(): void {
  syncPaused = true;
  if (continuationTimer) {
    clearTimeout(continuationTimer);
    continuationTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

export function resumeSync(): void {
  syncPaused = false;
}

export function isSyncPaused(): boolean {
  return syncPaused;
}

export function scheduleReadingSyncContinuation(
  collection?: SyncCollection,
  delayMs = 50,
): void {
  if (syncPaused) return;
  if (collection) {
    markCollectionPagesPending(collection);
  }
  if (continuationTimer) clearTimeout(continuationTimer);
  continuationTimer = setTimeout(() => {
    continuationTimer = null;
    if (registeredContinuationRunner && (typeof navigator === "undefined" || navigator.onLine !== false)) {
      registeredContinuationRunner();
    }
  }, delayMs);
}

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000] as const;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let registeredRetryCallback: (() => void) | null = null;

export function registerSyncRetryRunner(runner: () => void): void {
  registeredRetryCallback = runner;
}

export function scheduleSyncRetry(onRetry?: () => void): void {
  if (syncPaused) return;
  if (onRetry) registeredRetryCallback = onRetry;
  if (retryTimer) clearTimeout(retryTimer);
  if (retryAttempt >= RETRY_DELAYS_MS.length) return;

  const delay = RETRY_DELAYS_MS[retryAttempt++];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (currentState.isOnline) {
      registeredRetryCallback?.();
    }
  }, delay);
}

export function resetSyncRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryAttempt = 0;
}

export function recordCollectionSyncSuccess(
  collection: SyncCollection,
  timestamp: number = Date.now(),
): void {
  collectionPendingCounts[collection] = 0;
  const nextCollections: Record<SyncCollection, CollectionSyncStatus> = {
    ...currentState.collections,
    [collection]: {
      status: "synced" as const,
      lastSyncedAt: timestamp,
      error: null,
    },
  };

  // Solo se considera éxito global si ninguna colección ha fallado
  const hasError = Object.values(nextCollections).some((c) => c.status === "error");
  const firstError = Object.values(nextCollections).find((c) => c.error)?.error ?? null;

  updateSyncState({
    collections: nextCollections,
    lastSyncError: hasError ? firstError : null,
    lastSyncedAt: hasError ? currentState.lastSyncedAt : timestamp,
    pendingChangesCount: computeEffectivePendingChanges(nextCollections),
  });

  if (!hasError) {
    resetSyncRetry();
  }
}

export function recordCollectionSyncError(
  collection: SyncCollection,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error ?? "Error al sincronizar");
  const nextCollections: Record<SyncCollection, CollectionSyncStatus> = {
    ...currentState.collections,
    [collection]: {
      status: "error" as const,
      error: message,
    },
  };

  updateSyncState({
    collections: nextCollections,
    lastSyncError: message,
    pendingChangesCount: computeEffectivePendingChanges(nextCollections),
  });

  if (currentState.isOnline) {
    scheduleSyncRetry();
  }
}

export function recordCollectionSyncFailure(
  collection: SyncCollection,
  error: unknown = "Sync parcial o interrumpido",
): void {
  recordCollectionSyncError(collection, error);
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    subscribeSyncState,
    getSyncState,
    getSyncState,
  );
}

export function isSyncInError(state: SyncState): boolean {
  if (state.lastSyncError) return true;
  if (!state.collections) return false;
  return Object.values(state.collections).some((c) => c.status === "error");
}

export function getSyncStatusLabel(state: SyncState, hasAccount: boolean): string {
  if (!state.isOnline) {
    return "Sin conexión · guardado local";
  }
  if (!hasAccount) {
    return "Guardado en este dispositivo";
  }
  if (isSyncInError(state)) {
    return "Guardado local · reintentando sincronizar";
  }
  if (state.pendingChangesCount > 0) {
    return "Guardado en este dispositivo · pendiente de sincronizar";
  }
  if (state.lastSyncedAt) {
    return "Sincronizado";
  }
  return "Guardado en este dispositivo";
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    updateSyncState({ isOnline: true });
  });
  window.addEventListener("offline", () => {
    updateSyncState({ isOnline: false });
  });
}
