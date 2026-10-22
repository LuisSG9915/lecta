import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LectaApiError } from "./api.js";
import type { LectaConfig } from "./config.js";
import { registerTools } from "./tools.js";

const config: LectaConfig = {
  baseUrl: "https://lecta.test",
  timeoutMs: 1_000,
};

type ToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type ToolEntry = {
  name: string;
  config: ToolConfig;
  handler: (args: never) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }>;
};

type FakeApi = {
  baseUrl: string;
  hasCredentials: boolean;
  getJson: ReturnType<typeof vi.fn>;
  postJson: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
};

/** Respuestas del catálogo y de la API para que cada herramienta tenga datos. */
function canned(path: string): unknown {
  if (path.includes("/api/lexicon/lookup")) {
    return {
      found: true,
      entries: [
        {
          entryId: "e1",
          lemma: "casa",
          pos: "sustantivo",
          zipf: 5,
          senses: [{ definition: "Edificio para habitar", example: "Mi casa" }],
        },
      ],
    };
  }
  if (path.includes("/api/lexicon/batch")) {
    return { entries: { casas: [{ lemma: "casa", senses: [{ definition: "Edificio" }] }] } };
  }
  if (path.endsWith("/vocab")) {
    return {
      v: 1,
      wordCount: 1,
      uniqueForms: 1,
      forms: ["casas"],
      entries: [{ id: "e1", lemma: "casa", pos: "sustantivo", zipf: 5 }],
      byForm: { casas: [0] },
      missing: [],
    };
  }
  if (path.includes("/api/catalog")) {
    return {
      generatedAt: "2026-01-01T00:00:00.000Z",
      bookCount: 1,
      books: [
        {
          id: "quijote",
          title: "Don Quijote",
          author: "Cervantes",
          language: "es",
          subjects: ["novela"],
          cover: true,
        },
      ],
    };
  }
  if (path.includes("/api/books")) {
    return {
      books: [
        {
          hash: "h1",
          title: "Libro",
          author: "Autor",
          language: "es",
          sections: 3,
          uploaded: "2026-01-01",
        },
      ],
    };
  }
  if (path.includes("/api/vocab")) {
    return {
      words: [
        {
          form: "casas",
          lemma: "casa",
          language: "es",
          meaning: "Edificio",
          savedAt: 1,
          updatedAt: 2,
        },
      ],
    };
  }
  if (path.includes("/api/activity")) return { intervals: [], hasMore: false };
  if (path.includes("/api/reviews")) return { reviews: [], hasMore: false };
  if (path.includes("/api/positions")) return { positions: [] };
  if (path.includes("/api/annotations")) {
    return {
      annotations: [
        {
          id: "a1",
          bookHash: "h1",
          kind: "highlight",
          text: "una cita",
          note: null,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      hasMore: false,
    };
  }
  if (path.includes("/api/knowledge")) {
    return {
      rows: [{ language: "es", lemma: "casa", known: true, source: "reading", updatedAt: 3 }],
      hasMore: false,
    };
  }
  if (path.includes("/api/health")) return { status: "ok" };
  return {};
}

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  const getJson = vi.fn(async (path: string) => canned(path));
  const postJson = vi.fn(async (path: string) => canned(path));
  return {
    baseUrl: config.baseUrl,
    hasCredentials: true,
    getJson,
    postJson,
    getSession: vi.fn(async () => ({ user: { id: "u1", email: "a@b.c", name: "Luis" } })),
    ...overrides,
  };
}

function captureTools(api: FakeApi): Map<string, ToolEntry> {
  const tools = new Map<string, ToolEntry>();
  const server = {
    registerTool: (name: string, toolConfig: ToolConfig, handler: ToolEntry["handler"]) => {
      tools.set(name, { name, config: toolConfig, handler });
    },
  };
  registerTools(server as never, api as never, config);
  return tools;
}

const schemaOf = (tool: ToolEntry) =>
  z.object((tool.config.inputSchema ?? {}) as z.ZodRawShape);

/** Entradas válidas por herramienta: se validan contra su propio esquema. */
const inputs: Record<string, unknown> = {
  lookup: { form: "casas", language: "es" },
  lookup_many: { forms: ["casas", "perro"], language: "es" },
  catalog: { query: "quijote", limit: 10 },
  catalog_vocab: { bookId: "quijote", query: "casa", limit: 10 },
  whoami: {},
  my_books: {},
  my_words: { language: "es", query: "casa", dueOnly: false, limit: 10 },
  reading_stats: { days: 7 },
  search_annotations: { query: "cita", bookHash: "h1", kind: "passage", limit: 10 },
  my_knowledge: { language: "es", known: true, query: "casa", limit: 10 },
  health: {},
};

const expectedToolNames = Object.keys(inputs);

describe("registerTools", () => {
  it("registra todas las herramientas con título, descripción y esquema zod", () => {
    const tools = captureTools(makeApi());
    expect([...tools.keys()].sort()).toEqual([...expectedToolNames].sort());

    for (const tool of tools.values()) {
      expect(tool.config.title, `${tool.name} sin título`).toBeTruthy();
      expect(tool.config.description, `${tool.name} sin descripción`).toBeTruthy();
      for (const [key, schema] of Object.entries(tool.config.inputSchema ?? {})) {
        expect(typeof (schema as { safeParse?: unknown }).safeParse, `${tool.name}.${key}`).toBe(
          "function",
        );
      }
    }
  });

  it("cada entrada de ejemplo pasa el esquema de su herramienta", () => {
    const tools = captureTools(makeApi());
    for (const name of expectedToolNames) {
      const tool = tools.get(name)!;
      const parsed = schemaOf(tool).safeParse(inputs[name]);
      expect(parsed.success, `${name}: ${parsed.error?.message ?? ""}`).toBe(true);
    }
  });

  it.each(expectedToolNames)("%s devuelve contenido JSON en el camino feliz", async (name) => {
    const tools = captureTools(makeApi());
    const tool = tools.get(name)!;
    const args = schemaOf(tool).parse(inputs[name]);
    const result = await tool.handler(args as never);

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  it.each(expectedToolNames.filter((name) => name !== "health"))(
    "%s responde con isError ante un fallo de la API",
    async (name) => {
      const fail = async () => {
        throw new LectaApiError("la API se cayó", 500);
      };
      const api = makeApi({
        getJson: vi.fn(fail),
        postJson: vi.fn(fail),
        getSession: vi.fn(fail),
      });
      const tool = captureTools(api).get(name)!;
      // bookId único: el vocabulario del catálogo se cachea por libro.
      const input = { ...(inputs[name] as Record<string, unknown>) };
      if (name === "catalog_vocab") input.bookId = "sin-cache-error";
      const args = schemaOf(tool).parse(input);
      const result = await tool.handler(args as never);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("la API se cayó");
    },
  );

  it("whoami explica qué falta cuando no hay credenciales", async () => {
    const tool = captureTools(makeApi({ hasCredentials: false })).get("whoami")!;
    const result = await tool.handler({} as never);
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      configured: false,
      authenticated: false,
    });
  });

  it("lookup informa found:false cuando el catálogo no tiene la forma", async () => {
    const api = makeApi();
    api.getJson.mockResolvedValueOnce({ found: false, entries: [] });
    const tool = captureTools(api).get("lookup")!;
    const result = await tool.handler(schemaOf(tool).parse({ form: "zzzz" }) as never);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ found: false, entries: [] });
  });

  it("health no falla y devuelve el estado de la API", async () => {
    const tool = captureTools(makeApi()).get("health")!;
    const result = await tool.handler({} as never);
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({ reachable: true, status: "ok" });
    expect(payload.baseUrl).toBe(config.baseUrl);
  });
});
