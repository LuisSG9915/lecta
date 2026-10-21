import { useSyncExternalStore } from "react";

export type SyncCollection =
  | "words"
  | "positions"
  | "annotations"
  | "knowledge"
  | "activity"
  | "reviews"
  | "companion";

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

export function recordCollectionSyncSuccess(
  collection: SyncCollection,
  timestamp: number = Date.now(),
): void {
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
  });
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
  });
}

export function recordSyncSuccess(timestamp: number = Date.now()): void {
  const allSynced: Record<SyncCollection, CollectionSyncStatus> = { ...currentState.collections };
  for (const k of Object.keys(allSynced) as SyncCollection[]) {
    allSynced[k] = { status: "synced", lastSyncedAt: timestamp, error: null };
  }
  updateSyncState({
    lastSyncedAt: timestamp,
    lastSyncError: null,
    pendingChangesCount: 0,
    collections: allSynced,
  });
}

export function recordSyncError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error ?? "Error");
  updateSyncState({
    lastSyncError: message,
  });
}

export function setPendingChangesCount(count: number): void {
  updateSyncState({
    pendingChangesCount: Math.max(0, count),
  });
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
