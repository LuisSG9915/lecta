import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  translateParagraph,
  translateClause,
  extractParagraphClauses,
  selectMostComplexClause,
  selectOptimalScaffoldingTier,
  updateBilingualAutonomyProfile,
  DEFAULT_BILINGUAL_PROFILE,
} from "./translate";

vi.mock("./account-fetch", () => ({
  accountFetch: vi.fn(),
}));

import { accountFetch } from "./account-fetch";

describe("translate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("translateParagraph", () => {
    it("devuelve cadena vacía si el texto está en blanco", async () => {
      const res = await translateParagraph("   ");
      expect(res).toBe("");
      expect(accountFetch).not.toHaveBeenCalled();
    });

    it("obtiene la traducción desde /api/ai/translate", async () => {
      vi.mocked(accountFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ translation: "El sol brillaba sobre el mar." }),
      } as Response);

      const res = await translateParagraph("The sun was shining over the sea.");
      expect(res).toBe("El sol brillaba sobre el mar.");
      expect(accountFetch).toHaveBeenCalledWith(
        "/api/ai/translate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            text: "The sun was shining over the sea.",
            from: "en",
            to: "es",
          }),
        }),
        undefined,
      );
    });

    it("cae suavemente al texto original en caso de error o sin conexión", async () => {
      vi.mocked(accountFetch).mockRejectedValueOnce(new Error("Network error"));

      const res = await translateParagraph("The sun was shining over the sea.");
      expect(res).toBe("The sun was shining over the sea.");
    });
  });

  describe("translateClause", () => {
    it("traduce una cláusula compleja de forma análoga a translateParagraph", async () => {
      vi.mocked(accountFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ translation: "aunque nadie lo sabía" }),
      } as Response);

      const res = await translateClause("although nobody knew it");
      expect(res).toBe("aunque nadie lo sabía");
    });
  });

  describe("extractParagraphClauses", () => {
    it("segmenta un párrafo en cláusulas con sus rangos de caracteres y conteo de palabras", () => {
      const text = "He walked slowly, looking around; the street was quiet, but danger lurked.";
      const clauses = extractParagraphClauses(text);

      expect(clauses.length).toBe(4);
      expect(clauses[0].text).toBe("He walked slowly,");
      expect(clauses[0].wordCount).toBe(3);
      expect(clauses[1].text).toBe("looking around;");
      expect(clauses[1].wordCount).toBe(2);
      expect(clauses[2].text).toBe("the street was quiet,");
      expect(clauses[2].wordCount).toBe(4);
      expect(clauses[3].text).toBe("but danger lurked.");
      expect(clauses[3].wordCount).toBe(3);

      for (const clause of clauses) {
        expect(text.slice(clause.startIndex, clause.endIndex)).toBe(clause.text);
      }
    });

    it("devuelve array vacío ante texto vacío", () => {
      expect(extractParagraphClauses("   ")).toEqual([]);
    });
  });

  describe("selectMostComplexClause", () => {
    it("identifica la cláusula con mayor número de palabras", () => {
      const text = "Short, but here is a much longer clause with several descriptive words; tiny.";
      const selected = selectMostComplexClause(text);

      expect(selected).not.toBeNull();
      expect(selected?.text).toBe(
        "but here is a much longer clause with several descriptive words;",
      );
      expect(text.slice(selected!.startIndex, selected!.endIndex)).toBe(
        "but here is a much longer clause with several descriptive words;",
      );
    });

    it("devuelve null si no hay cláusulas válidas", () => {
      expect(selectMostComplexClause("")).toBeNull();
    });
  });

  describe("re-exports de andamiaje bilingüe", () => {
    it("re-exporta correctamente selectOptimalScaffoldingTier y updateBilingualAutonomyProfile", () => {
      const tier = selectOptimalScaffoldingTier("Sample text", 0.01, "en", DEFAULT_BILINGUAL_PROFILE);
      expect(tier).toBe(1);

      const updated = updateBilingualAutonomyProfile(
        DEFAULT_BILINGUAL_PROFILE,
        "en",
        "read-autonomously",
      );
      expect(updated.autonomyBiasByLang.en).toBe(-0.015);
    });
  });
});
