import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCollectionPagesPending,
  getSyncState,
  getSyncStatusLabel,
  isSyncInError,
  markCollectionPagesPending,
  recordCollectionSyncError,
  recordCollectionSyncFailure,
  recordCollectionSyncSuccess,
  registerSyncRetryRunner,
  resetSyncRetry,
  setPendingChangesCount,
  updateSyncState,
  type SyncCollection,
} from "./sync-state";

const ALL_COLLECTIONS: SyncCollection[] = [
  "words",
  "positions",
  "annotations",
  "knowledge",
  "activity",
  "reviews",
  "companion",
];

describe("sync-state", () => {
  beforeEach(() => {
    for (const collection of ALL_COLLECTIONS) {
      clearCollectionPagesPending(collection);
    }
    setPendingChangesCount(0);
    updateSyncState({
      isOnline: true,
      lastSyncedAt: null,
      pendingChangesCount: 0,
      lastSyncError: null,
      collections: {
        words: { status: "idle" },
        positions: { status: "idle" },
        annotations: { status: "idle" },
        knowledge: { status: "idle" },
        activity: { status: "idle" },
        reviews: { status: "idle" },
        companion: { status: "idle" },
      },
    });
  });

  it("registra éxito por colección y actualiza timestamp", () => {
    const now = 1700000000000;
    recordCollectionSyncSuccess("words", now);

    const state = getSyncState();
    expect(state.collections.words.status).toBe("synced");
    expect(state.collections.words.lastSyncedAt).toBe(now);
    expect(state.collections.words.error).toBeNull();
  });

  it("registra error por colección y marca error global sin permitir 'synced'", () => {
    recordCollectionSyncSuccess("words", 1000);
    recordCollectionSyncError("positions", new Error("Error en posiciones"));

    const state = getSyncState();
    expect(state.collections.words.status).toBe("synced");
    expect(state.collections.positions.status).toBe("error");
    expect(state.collections.positions.error).toBe("Error en posiciones");
    expect(isSyncInError(state)).toBe(true);

    // Con error en posiciones, la etiqueta debe ser de reintento, NUNCA 'Sincronizado'
    const label = getSyncStatusLabel(state, true);
    expect(label).toBe("Guardado local · reintentando sincronizar");
  });

  it("muestra 'Sincronizado' únicamente cuando ninguna colección haya fallado y lastSyncedAt esté activo", () => {
    const now = 1700000000000;
    const collections: SyncCollection[] = [
      "words",
      "positions",
      "annotations",
      "knowledge",
      "activity",
      "reviews",
      "companion",
    ];

    for (const c of collections) {
      recordCollectionSyncSuccess(c, now);
    }

    const state = getSyncState();
    expect(isSyncInError(state)).toBe(false);
    expect(state.pendingChangesCount).toBe(0);
    expect(getSyncStatusLabel(state, true)).toBe("Sincronizado");
  });

  it("contabiliza pendientes por colección individual e impide estado 'Sincronizado'", () => {
    const now = 1700000000000;
    const collections: SyncCollection[] = [
      "words",
      "positions",
      "annotations",
      "knowledge",
      "activity",
      "reviews",
      "companion",
    ];
    for (const c of collections) {
      recordCollectionSyncSuccess(c, now);
    }
    expect(getSyncStatusLabel(getSyncState(), true)).toBe("Sincronizado");

    // Añadir 2 palabras pendientes
    setPendingChangesCount(2);
    const state = getSyncState();
    expect(state.pendingChangesCount).toBe(2);
    expect(getSyncStatusLabel(state, true)).toBe(
      "Guardado en este dispositivo · pendiente de sincronizar",
    );
  });

  it("muestra 'Guardado en este dispositivo · pendiente de sincronizar' cuando hay cambios en cola", () => {
    setPendingChangesCount(3);
    const state = getSyncState();
    expect(state.pendingChangesCount).toBe(3);
    expect(getSyncStatusLabel(state, true)).toBe(
      "Guardado en este dispositivo · pendiente de sincronizar",
    );
  });

  it("muestra 'Sin conexión · guardado local' cuando no hay red", () => {
    updateSyncState({ isOnline: false });
    const state = getSyncState();
    expect(getSyncStatusLabel(state, true)).toBe("Sin conexión · guardado local");
  });

  it("muestra 'Guardado en este dispositivo' para usuarios anónimos sin cuenta", () => {
    const state = getSyncState();
    expect(getSyncStatusLabel(state, false)).toBe("Guardado en este dispositivo");
  });

  it("mantiene 'pendiente de sincronizar' cuando quedaron páginas sin leer", () => {
    recordCollectionSyncSuccess("words", 1000);
    expect(getSyncStatusLabel(getSyncState(), true)).toBe("Sincronizado");

    markCollectionPagesPending("words");
    expect(getSyncState().pendingChangesCount).toBe(1);
    expect(getSyncStatusLabel(getSyncState(), true)).toBe(
      "Guardado en este dispositivo · pendiente de sincronizar",
    );

    // Un éxito de colección no debe borrar el pendiente de páginas.
    recordCollectionSyncSuccess("words", 2000);
    expect(getSyncStatusLabel(getSyncState(), true)).toBe(
      "Guardado en este dispositivo · pendiente de sincronizar",
    );

    clearCollectionPagesPending("words");
    expect(getSyncStatusLabel(getSyncState(), true)).toBe("Sincronizado");
  });

  it("cuando sync falla (recordCollectionSyncFailure), el estado pasa a reintentando sincronizar y el timer de backoff vuelve a intentar el sync", () => {
    vi.useFakeTimers();
    resetSyncRetry();

    const onRetryMock = vi.fn();
    registerSyncRetryRunner(onRetryMock);

    recordCollectionSyncFailure("words", "Fallo de red");

    const state = getSyncState();
    expect(state.collections.words.status).toBe("error");
    expect(isSyncInError(state)).toBe(true);
    expect(getSyncStatusLabel(state, true)).toBe("Guardado local · reintentando sincronizar");

    // Intento 1: 5_000 ms
    expect(onRetryMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4999);
    expect(onRetryMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRetryMock).toHaveBeenCalledTimes(1);

    // Si vuelve a fallar: intento 2: 15_000 ms
    recordCollectionSyncFailure("words", "Fallo 2");
    vi.advanceTimersByTime(14999);
    expect(onRetryMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onRetryMock).toHaveBeenCalledTimes(2);

    // Si vuelve a fallar: intento 3: 45_000 ms
    recordCollectionSyncFailure("words", "Fallo 3");
    vi.advanceTimersByTime(44999);
    expect(onRetryMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(onRetryMock).toHaveBeenCalledTimes(3);

    // Éxito posterior resetea el timer y restaura 'Sincronizado'
    recordCollectionSyncSuccess("words", Date.now());
    expect(isSyncInError(getSyncState())).toBe(false);

    vi.useRealTimers();
  });
});
