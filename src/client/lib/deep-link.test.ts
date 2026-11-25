import { describe, expect, it } from "vitest";
import { findDeepLinkItem, parseOpenBookParam } from "./deep-link";

const HASH = "a".repeat(64);

describe("enlace directo ?abrir=", () => {
  it("solo acepta un sha256 en hex", () => {
    expect(parseOpenBookParam(HASH)).toBe(HASH);
    expect(parseOpenBookParam(HASH.toUpperCase())).toBe(HASH);
    expect(parseOpenBookParam(null)).toBeNull();
    expect(parseOpenBookParam("abc")).toBeNull();
    expect(parseOpenBookParam("lecta-subs:v1:movie:x:es")).toBeNull();
    expect(parseOpenBookParam(`${HASH}x`)).toBeNull();
  });

  it("encuentra el libro de la estantería por hash", () => {
    const library = [{ hash: "b".repeat(64) }, { hash: HASH, remoteOnly: true }];
    expect(findDeepLinkItem(library, HASH)).toBe(library[1]);
    expect(findDeepLinkItem(library, "c".repeat(64))).toBeNull();
    expect(findDeepLinkItem(library, null)).toBeNull();
  });
});
