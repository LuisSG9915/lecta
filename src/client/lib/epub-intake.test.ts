import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkEpubFile, epubCheckMessage, matchAttachedEpub } from "./epub-intake";
import { sha256Hex } from "./hash";

const minimal = new Blob([new Uint8Array(readFileSync(resolve(__dirname, "../../../fixtures/minimal.epub")))]);

describe("epub-intake", () => {
  it("acepta un EPUB válido y rechaza vacío o no EPUB", async () => {
    expect(await checkEpubFile(minimal, { full: true })).toEqual({ ok: true });
    const empty = await checkEpubFile(new Blob([]));
    expect(empty).toEqual({ ok: false, reason: "size" });
    const junk = await checkEpubFile(new Blob([new Uint8Array([1, 2, 3, 4])]));
    expect(junk).toEqual({ ok: false, reason: "format" });
    if (!junk.ok) expect(epubCheckMessage(junk)).toContain("EPUB");
  });

  it("empareja solo por sha256 exacto", async () => {
    const hash = await sha256Hex(minimal);
    expect(await matchAttachedEpub(minimal, hash)).toEqual({ ok: true });
    expect(await matchAttachedEpub(minimal, "00".repeat(32))).toEqual({ ok: false, reason: "mismatch" });
  });
});
