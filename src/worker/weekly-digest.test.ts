import { describe, expect, it } from "vitest";
import { isEmptyDigest } from "./weekly-digest";

describe("isEmptyDigest", () => {
  it("semana en 0 es vacía", () => {
    expect(isEmptyDigest({ minutes: 0, words: 0, reviews: 0, books: 0 })).toBe(true);
  });

  it("cualquier actividad la vuelve enviable", () => {
    expect(isEmptyDigest({ minutes: 1, words: 0, reviews: 0, books: 0 })).toBe(false);
    expect(isEmptyDigest({ minutes: 0, words: 2, reviews: 0, books: 0 })).toBe(false);
    expect(isEmptyDigest({ minutes: 0, words: 0, reviews: 3, books: 0 })).toBe(false);
    expect(isEmptyDigest({ minutes: 0, words: 0, reviews: 0, books: 1 })).toBe(false);
  });
});
