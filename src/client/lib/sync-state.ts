import { useSyncExternalStore } from "react";

export interface SyncState {
  isOnline: boolean;
  lastSyncedAt: number | null;
  pendingChangesCount: number;
  lastSyncError: string | null;
}

let currentState: SyncState = {
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  lastSyncedAt: null,
  pendingChangesCount: 0,
  lastSyncError: null,
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

export function recordSyncSuccess(timestamp: number = Date.now()): void {
  updateSyncState({
    lastSyncedAt: timestamp,
    lastSyncError: null,
    pendingChangesCount: 0,
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

export function getSyncStatusLabel(state: SyncState, hasAccount: boolean): string {
  if (!state.isOnline) {
    return "Sin conexión · guardado local";
  }
  if (!hasAccount) {
    return "Guardado en este dispositivo";
  }
  if (state.lastSyncError) {
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
