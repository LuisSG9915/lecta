import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => {
  return {
    WorkflowEntrypoint: class {
      env: unknown;
      constructor(_ctx: unknown, env: unknown) {
        this.env = env;
      }
    },
  };
});

vi.mock("./db", () => ({
  withClient: vi.fn(async (_env, fn) => fn({ query: vi.fn() })),
}));

vi.mock("./lexicon", () => ({
  findEntries: vi.fn(),
  insertEnrichment: vi.fn(),
}));

vi.mock("./ai", () => ({
  requestEnrichment: vi.fn(),
}));

import { EnrichmentWorkflow } from "./enrichment-workflow";
import { findEntries, insertEnrichment } from "./lexicon";
import { requestEnrichment } from "./ai";

describe("EnrichmentWorkflow", () => {
  it("procesa palabras filtrando stopwords y enriqueciendo lemas nuevos", async () => {
    const workflow = new EnrichmentWorkflow(
      {} as never,
      { DATABASE_URL: "postgres://mock" } as never,
    );

    const stepMock = {
      do: vi.fn(async (_name: string, fn: () => Promise<string>) => fn()),
    };

    // Caso 1: stopword 'de'
    // Caso 2: existente con definición ('casa')
    // Caso 3: nueva enriquecida por IA ('neologismo')
    // Caso 4: fallo de IA ('fallida')
    vi.mocked(findEntries)
      .mockResolvedValueOnce([{ id: 1, senses: [{ definition: "Existente" }] } as never])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.mocked(requestEnrichment)
      .mockResolvedValueOnce({
        ok: true,
        enrichment: {
          lemma: "neologismo",
          senses: [{ definition: "Palabra nueva" }],
        } as never,
      })
      .mockResolvedValueOnce({ ok: false, reason: "rate-limited" });

    const results = await workflow.run(
      {
        payload: {
          forms: ["de", "casa", "neologismo", "fallida"],
          language: "es",
        },
      } as never,
      stepMock as never,
    );

    expect(results).toEqual({
      de: "stopword",
      casa: "existing",
      neologismo: "created",
      fallida: "rate-limited",
    });
    expect(insertEnrichment).toHaveBeenCalledTimes(1);
  });
});
