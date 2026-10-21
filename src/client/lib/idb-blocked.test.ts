// Apertura de IndexedDB con una versión vieja retenida por otra
// pestaña: `blocked` no puede quedar pendiente para siempre (la
// estantería cargaría eterno) y `blocking` debe soltar la conexión
// que estorba al upgrade del otro lado.
import { afterEach, describe, expect, it, vi } from "vitest";

type OpenCallbacks = {
  blocked?: (currentVersion: number, blockedVersion: number | null, event: unknown) => void;
  blocking?: (currentVersion: number, blockedVersion: number | null, event: unknown) => void;
  upgrade?: (db: unknown) => void;
};

const openDBMock = vi.fn();
vi.mock("idb", () => ({
  openDB: (...args: unknown[]) => openDBMock(...args),
}));

const freshIdb = async () => {
  vi.resetModules();
  return import("./idb");
};

afterEach(() => {
  vi.useRealTimers();
});

describe("openLectaDB bajo upgrade bloqueado", () => {
  it("blocked sin liberación rechaza tras el tope, no queda pendiente", async () => {
    openDBMock.mockImplementation(
      (_name: string, _version: number, cbs: OpenCallbacks) => {
        queueMicrotask(() => cbs.blocked?.(8, 9, {} as IDBVersionChangeEvent));
        // La pestaña vieja jamás suelta: la apertura nunca resuelve.
        return new Promise(() => {});
      },
    );
    const idb = await freshIdb();
    vi.useFakeTimers();
    const assertion = expect(idb.loadSessionValue("k")).rejects.toThrow(
      /otra pestaña/,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("una apertura que llega tras el tope se cierra, no se entrega", async () => {
    let resolveOpen: ((db: unknown) => void) | undefined;
    openDBMock.mockImplementation(
      (_name: string, _version: number, cbs: OpenCallbacks) => {
        queueMicrotask(() => cbs.blocked?.(8, 9, {} as IDBVersionChangeEvent));
        return new Promise((res) => {
          resolveOpen = res;
        });
      },
    );
    const idb = await freshIdb();
    vi.useFakeTimers();
    const assertion = expect(idb.loadSessionValue("k")).rejects.toThrow(
      /otra pestaña/,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    // La pestaña vieja soltó tarde: la conexión que por fin abrió se
    // cierra — el llamador ya recibió el error, no una base fantasma.
    const lateDb = { close: vi.fn() };
    resolveOpen?.(lateDb);
    await Promise.resolve();
    await Promise.resolve();
    expect(lateDb.close).toHaveBeenCalled();
  });

  it("blocking cierra la conexión propia que estorba al upgrade ajeno", async () => {
    let cbs: OpenCallbacks | undefined;
    openDBMock.mockImplementation((_name: string, _version: number, c: OpenCallbacks) => {
      cbs = c;
      return Promise.resolve({
        get: () => Promise.resolve(undefined),
        close: vi.fn(),
      });
    });
    const idb = await freshIdb();
    await idb.loadSessionValue("k");

    const close = vi.fn();
    cbs?.blocking?.(8, 9, { target: { close } });
    expect(close).toHaveBeenCalled();
  });

  it("classifyDbError clasifica correctamente los errores de almacenamiento", async () => {
    const { classifyDbError } = await freshIdb();

    expect(
      classifyDbError(new Error("La base local sigue abierta en otra pestaña")).code,
    ).toBe("blocked");

    const versionErr = new Error("Database version error");
    versionErr.name = "VersionError";
    expect(classifyDbError(versionErr).code).toBe("blocked");

    const quotaErr = new Error("The quota has been exceeded");
    quotaErr.name = "QuotaExceededError";
    expect(classifyDbError(quotaErr).code).toBe("quota");

    expect(classifyDbError(new Error("Database operation timed out")).code).toBe(
      "timeout",
    );

    expect(classifyDbError(new Error("InvalidStateError: corrupted data")).code).toBe(
      "corrupt",
    );
  });
});
