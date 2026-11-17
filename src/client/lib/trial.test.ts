import { describe, expect, it } from "vitest";
import { parseTrialBook } from "./trial";

describe("parseTrialBook", () => {
  it("acepta solo los clásicos de la lista", () => {
    expect(parseTrialBook("marianela")?.title).toBe("Marianela");
    expect(parseTrialBook("alice-wonderland")?.author).toBe("Lewis Carroll");
    expect(parseTrialBook("lazarillo")?.title).toBe("El Lazarillo de Tormes");
    expect(parseTrialBook("christmas-carol")?.author).toBe("Charles Dickens");
  });

  it("descarta lo demás, incluidas claves heredadas del prototipo", () => {
    expect(parseTrialBook(null)).toBeNull();
    expect(parseTrialBook("")).toBeNull();
    expect(parseTrialBook("quijote")).toBeNull();
    expect(parseTrialBook("constructor")).toBeNull();
    expect(parseTrialBook("__proto__")).toBeNull();
  });
});
