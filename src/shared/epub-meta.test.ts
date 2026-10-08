import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractEpubMeta } from "./epub-meta";

describe("extractEpubMeta", () => {
  it("extrae título, autor y secciones de fixtures/minimal.epub", async () => {
    const fixturePath = resolve(__dirname, "../../fixtures/minimal.epub");
    const data = new Uint8Array(readFileSync(fixturePath));
    const meta = await extractEpubMeta(data);
    expect(meta).not.toBeNull();
    expect(meta?.title).toBe("Libro de prueba");
    expect(meta?.author).toBe("Equipo Lecta");
    expect(meta?.sections).toBe(2);
    expect(meta?.language).toBe("es");
  });

  it("devuelve null para bytes no válidos", async () => {
    const meta = await extractEpubMeta(new Uint8Array([1, 2, 3, 4]));
    expect(meta).toBeNull();
  });
});
