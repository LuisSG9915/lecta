import { describe, expect, it } from "vitest";
import {
  formatNumberedSnippet,
  mergeLineWindows,
  parseInvestigationReferences,
  shouldExcludePath,
  sortRepoPathsForGemini,
} from "./pack-gemini.mjs";

describe("pack-gemini", () => {
  it("excluye diccionarios comprimidos, epubs, fuentes y lockfiles", () => {
    expect(shouldExcludePath("public/lexicon/senses-es.csv.gz")).toBe(true);
    expect(shouldExcludePath("public/lexicon/locuciones.es.json")).toBe(true);
    expect(shouldExcludePath("public/libros/azul-ruben-dario.epub")).toBe(true);
    expect(shouldExcludePath("src/client/fonts/literata.woff2")).toBe(true);
    expect(shouldExcludePath("pnpm-lock.yaml")).toBe(true);
    expect(shouldExcludePath("src/worker/kindle/routes.ts")).toBe(false);
    expect(shouldExcludePath("src/client/components/Vocabulary.tsx")).toBe(false);
  });

  it("prioriza AGENTS.md, db/ y src/ antes de scripts y docs secundarios", () => {
    const sorted = sortRepoPathsForGemini([
      "scripts/foo.mjs",
      "src/client/App.tsx",
      "src/worker/kindle/routes.ts",
      "db/schema.sql",
      "AGENTS.md",
    ]);
    expect(sorted).toEqual([
      "AGENTS.md",
      "db/schema.sql",
      "src/worker/kindle/routes.ts",
      "src/client/App.tsx",
      "scripts/foo.mjs",
    ]);
  });

  it("extrae archivos, rangos de líneas y símbolos técnicos de una investigación", () => {
    const sample = `
      Ubicación: src/worker/kindle/routes.ts:1257-1258 y src/worker/kindle/routes.ts:1653, 1828.
      Y en epub-reader.ts:999 junto con \`src/client/components/Vocabulary.tsx:482, 512\`.
      Falta actualizar \`synced_at\` e \`isLearnPending\`.
    `;
    const parsed = parseInvestigationReferences(sample);
    expect([...parsed.files.get("src/worker/kindle/routes.ts")]).toEqual([
      1257, 1258, 1653, 1828,
    ]);
    expect([...parsed.files.get("src/client/components/Vocabulary.tsx")]).toEqual([
      482, 512,
    ]);
    expect(parsed.symbols).toContain("synced_at");
    expect(parsed.symbols).toContain("isLearnPending");
  });

  it("fusiona ventanas de líneas cercanas y numera fragmentos correctamente", () => {
    const windows = mergeLineWindows([100, 120, 500], 600, 20);
    expect(windows).toEqual([
      { start: 80, end: 140 },
      { start: 480, end: 520 },
    ]);

    const snippet = formatNumberedSnippet("uno\ndos\ntres\ncuatro", 2, 3);
    expect(snippet).toBe("   2| dos\n   3| tres");
  });
});
