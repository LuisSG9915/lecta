import { describe, it, expect } from "vitest";
import {
  recordBookConsultedWord,
  getBookConsultedWords,
  isWordConsultedInBook,
  primeBookConsultedWords,
  normalizeGlossaryWord,
} from "./book-glossary";

describe("Book Glossary Persistence & Memory Cache (Fase 2)", () => {
  const bookId = "b-fase2-test";

  it("normaliza palabras a minúsculas y sin espacios", () => {
    expect(normalizeGlossaryWord("  Inmarcesible  ")).toBe("inmarcesible");
    expect(normalizeGlossaryWord("ÉFÍMERO")).toBe("éfímero");
  });

  it("registra y consulta palabras en memoria de forma instantánea", async () => {
    expect(isWordConsultedInBook(bookId, "quimera")).toBe(false);

    await recordBookConsultedWord(bookId, "quimera");
    expect(isWordConsultedInBook(bookId, "quimera")).toBe(true);
    expect(isWordConsultedInBook(bookId, "QUIMERA")).toBe(true);

    const words = await getBookConsultedWords(bookId);
    expect(words.has("quimera")).toBe(true);
  });

  it("permite pre-cargar palabras consultadas en lote", () => {
    const bookB = "b-batch-test";
    primeBookConsultedWords(bookB, ["ataraxia", "efimero"]);

    expect(isWordConsultedInBook(bookB, "ataraxia")).toBe(true);
    expect(isWordConsultedInBook(bookB, "efimero")).toBe(true);
    expect(isWordConsultedInBook(bookB, "desconocida")).toBe(false);
  });
});
