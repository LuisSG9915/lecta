// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isGutenbergSearchPage,
  searchGutenberg,
} from "./gutenberg";

const fetchStub = (impl: (url: string) => Promise<Response>) => {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchGutenberg", () => {
  const RESULT = {
    page: 0,
    hasMore: true,
    books: [
      {
        id: "pg-1342",
        gutenbergId: 1342,
        title: "Don Quijote",
        author: "Cervantes",
        language: "es",
        subjects: ["Fiction"],
        cover: false,
      },
    ],
  };

  it("arma la query solo con los parámetros presentes", async () => {
    const fetch = fetchStub(async () => jsonResponse(RESULT));
    const result = await searchGutenberg({ q: " quijote ", lang: "es" });
    expect(result?.books[0].id).toBe("pg-1342");
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toBe("/api/catalog/search?q=quijote&lang=es");
  });

  it("sin parámetros llama la URL limpia (más descargados)", async () => {
    const fetch = fetchStub(async () => jsonResponse(RESULT));
    await searchGutenberg({});
    expect(String(fetch.mock.calls[0][0])).toBe("/api/catalog/search");
  });

  it("respuesta con forma inválida devuelve null", async () => {
    fetchStub(async () => jsonResponse({ page: 0, books: "no" }));
    expect(await searchGutenberg({ q: "x" })).toBeNull();
  });

  it("error de red devuelve null", async () => {
    fetchStub(async () => {
      throw new Error("offline");
    });
    expect(await searchGutenberg({})).toBeNull();
  });

  it("isGutenbergSearchPage valida la forma mínima", () => {
    expect(isGutenbergSearchPage(RESULT)).toBe(true);
    expect(isGutenbergSearchPage({ ...RESULT, hasMore: "sí" })).toBe(false);
    expect(
      isGutenbergSearchPage({ ...RESULT, books: [{ id: 1 }] }),
    ).toBe(false);
  });
});
