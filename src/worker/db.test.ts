import { describe, expect, it } from "vitest";
import { chunks, SYNC_CHUNK_ROWS } from "./db";

describe("chunks", () => {
  it("devuelve un solo trozo cuando la lista cabe en el lote", () => {
    const rows = Array.from({ length: 5 }, (_, i) => i);
    expect(chunks(rows)).toEqual([[0, 1, 2, 3, 4]]);
  });

  it("parte la lista en tandas de SYNC_CHUNK_ROWS", () => {
    const rows = Array.from({ length: SYNC_CHUNK_ROWS * 2 + 7 }, (_, i) => i);
    const parts = chunks(rows);
    expect(parts.map((part) => part.length)).toEqual([
      SYNC_CHUNK_ROWS,
      SYNC_CHUNK_ROWS,
      7,
    ]);
    expect(parts.flat()).toEqual(rows);
  });

  it("lista vacía no produce consultas", () => {
    expect(chunks([])).toEqual([]);
  });

  it("respeta un tamaño de trozo explícito", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
