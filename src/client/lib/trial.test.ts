import { describe, expect, it } from "vitest";
import { parseTrialBook } from "./trial";

describe("parseTrialBook", () => {
  it("acepta solo los clásicos de la lista", () => {
    expect(parseTrialBook("marianela")?.title).toBe("Marianela");
    expect(parseTrialBook("alice-wonderland")?.author).toBe("Lewis Carroll");
    expect(parseTrialBook("lazarillo")?.title).toBe("El Lazarillo de Tormes");
    expect(parseTrialBook("christmas-carol")?.author).toBe("Charles Dickens");
  });

  it("acepta cualquier id con formato válido del catálogo (se valida al abrir)", () => {
    expect(parseTrialBook("quijote")).toEqual({ id: "quijote", title: "quijote", author: "" });
  });

  it("rechaza formato inválido y los pg-* de Gutenberg", () => {
    expect(parseTrialBook(null)).toBeNull();
    expect(parseTrialBook("")).toBeNull();
    expect(parseTrialBook("pg-1342")).toBeNull();
    expect(parseTrialBook("__proto__")).toBeNull();
    expect(parseTrialBook("../etc")).toBeNull();
    expect(parseTrialBook("Marianela")).toBeNull();
    expect(parseTrialBook("a".repeat(65))).toBeNull();
  });
});
