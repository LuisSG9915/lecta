import { describe, expect, it } from "vitest";
import { parseTrialBook } from "./trial";

describe("parseTrialBook", () => {
  it("acepta solo los clásicos de la lista", () => {
    expect(parseTrialBook("marianela")?.title).toBe("Marianela");
    expect(parseTrialBook("alice-wonderland")?.author).toBe("Lewis Carroll");
  });

  it("descarta lo demás, incluidas claves heredadas del prototipo", () => {
    expect(parseTrialBook(null)).toBeNull();
    expect(parseTrialBook("")).toBeNull();
    expect(parseTrialBook("quijote")).toBeNull();
    expect(parseTrialBook("constructor")).toBeNull();
    expect(parseTrialBook("__proto__")).toBeNull();
  });
});
