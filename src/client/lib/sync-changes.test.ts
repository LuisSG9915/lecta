import { afterEach, describe, expect, it, vi } from "vitest";
import * as accountFetchModule from "./account-fetch";
import {
  SYNC_CHANGES_TTL_MS,
  canSkipPull,
  clearSyncChanges,
  primeSyncChanges,
  syncChangeLanguages,
} from "./sync-changes";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  clearSyncChanges();
  vi.restoreAllMocks();
});

describe("sonda de cambios", () => {
  it("salta solo si el sello del servidor no pasa el cursor", async () => {
    vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(
      json({ stamps: { annotations: 1000, "vocab:es": 2000 } }),
    );
    await primeSyncChanges("u1");
    expect(canSkipPull("u1", "annotations", 1000)).toBe(true);
    expect(canSkipPull("u1", "annotations", 999)).toBe(false);
    // Sin filas en el servidor la clave no viene: nada que bajar.
    expect(canSkipPull("u1", "reviews", 5)).toBe(true);
    // Primer pull (cursor 0) nunca se salta.
    expect(canSkipPull("u1", "reviews", 0)).toBe(false);
    // Claves que la sonda no cubre (knowledge por idioma) nunca se saltan.
    expect(canSkipPull("u1", "knowledge:es", 5)).toBe(false);
    expect(syncChangeLanguages("u1")).toEqual(["es"]);
  });

  it("sin sonda, con sonda vieja, de otra cuenta o fallida no salta nada", async () => {
    expect(canSkipPull("u1", "annotations", 10)).toBe(false);
    const fetchMock = vi
      .spyOn(accountFetchModule, "accountFetch")
      .mockResolvedValue(json({ stamps: { annotations: 1 } }));
    await primeSyncChanges("u1");
    const now = Date.now();
    expect(canSkipPull("u2", "annotations", 10, now)).toBe(false);
    expect(canSkipPull("u1", "annotations", 10, now + SYNC_CHANGES_TTL_MS + 1)).toBe(false);
    fetchMock.mockResolvedValue(json({ error: "x" }, 503));
    await primeSyncChanges("u1");
    expect(canSkipPull("u1", "annotations", 10)).toBe(false);
    fetchMock.mockRejectedValue(new Error("offline"));
    await primeSyncChanges("u1");
    expect(canSkipPull("u1", "annotations", 10)).toBe(false);
  });
});
