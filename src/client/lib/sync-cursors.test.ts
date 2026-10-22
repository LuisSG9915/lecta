// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceSyncCursor,
  clearSyncCursors,
  getSyncCursor,
  setSyncCursor,
} from "./sync-cursors";

const USER = "u1";

beforeEach(() => {
  clearSyncCursors();
  if (typeof localStorage !== "undefined") localStorage.clear();
  vi.restoreAllMocks();
});

describe("cursores de sincronización", () => {
  it("devuelve 0 para una colección que nunca se escribió", () => {
    expect(getSyncCursor(USER, "vocab:es:push")).toBe(0);
    expect(getSyncCursor("", "vocab")).toBe(0);
  });

  it("avanza solo hacia adelante: un sello anterior no retrocede el cursor", () => {
    expect(advanceSyncCursor(USER, "vocab:es:push", 100)).toBe(100);
    expect(advanceSyncCursor(USER, "vocab:es:push", 50)).toBe(100);
    expect(getSyncCursor(USER, "vocab:es:push")).toBe(100);
    expect(advanceSyncCursor(USER, "vocab:es:push", 150)).toBe(150);
    expect(getSyncCursor(USER, "vocab:es:push")).toBe(150);
  });

  it("ignora sellos nulos, negativos o no finitos", () => {
    advanceSyncCursor(USER, "annotations", 200);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(advanceSyncCursor(USER, "annotations", bad)).toBe(200);
    }
    expect(getSyncCursor(USER, "annotations")).toBe(200);
  });

  it("no mezcla colecciones ni cuentas", () => {
    advanceSyncCursor(USER, "vocab:es:push", 100);
    advanceSyncCursor(USER, "annotations:push", 300);
    expect(getSyncCursor(USER, "vocab:es:push")).toBe(100);
    expect(getSyncCursor(USER, "annotations:push")).toBe(300);
    expect(getSyncCursor("u2", "vocab:es:push")).toBe(0);
  });

  it("un valor corrupto en el almacén no rompe la lectura", () => {
    localStorage.setItem(
      `lecta_sync_cursors_v1:${USER}`,
      JSON.stringify({ "vocab:es": "no-es-un-numero", "vocab:es:push": -3 }),
    );
    expect(getSyncCursor(USER, "vocab:es")).toBe(0);
    expect(getSyncCursor(USER, "vocab:es:push")).toBe(0);
    expect(advanceSyncCursor(USER, "vocab:es", 10)).toBe(10);
  });

  it("setSyncCursor sigue permitiendo retroceder a propósito", () => {
    setSyncCursor(USER, "positions", 500);
    setSyncCursor(USER, "positions", 200);
    expect(getSyncCursor(USER, "positions")).toBe(200);
  });

  it("clearSyncCursors borra la cuenta indicada y no las demás", () => {
    advanceSyncCursor(USER, "vocab:es", 10);
    advanceSyncCursor("u2", "vocab:es", 20);
    clearSyncCursors(USER);
    expect(getSyncCursor(USER, "vocab:es")).toBe(0);
    expect(getSyncCursor("u2", "vocab:es")).toBe(20);
  });
});
