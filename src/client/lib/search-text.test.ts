import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "./search-text";

describe("normalizeSearchText", () => {
  it("quita acentos y mayúsculas para comparar", () => {
    expect(normalizeSearchText("Corazón")).toBe("corazon");
    expect(normalizeSearchText("Pérez Galdós")).toBe("perez galdos");
  });

  it("colapsa espacios y recorta bordes", () => {
    expect(normalizeSearchText("  El   Quijote  ")).toBe("el quijote");
  });
});
