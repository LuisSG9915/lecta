// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogVocab,
  downloadCatalogEpub,
  entriesByFormOf,
  isCatalogIndex,
  isVocabManifest,
  listCatalog,
  manifestBookForms,
  type BookVocabManifest,
  type CatalogIndex,
} from "./catalog";

const session = vi.hoisted(() => new Map<string, string>());

vi.mock("./idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./idb")>();
  return {
    ...mod,
    loadSessionValue: vi.fn(async (key: string) => session.get(key) ?? null),
    saveSessionValue: vi.fn(async (key: string, value: string) => {
      session.set(key, value);
    }),
  };
});

const INDEX: CatalogIndex = {
  bookCount: 2,
  books: [
    { id: "quijote", gutenbergId: 2000, title: "Don Quijote", author: "Miguel de Cervantes", cover: true, epubSha256: "aa" },
    { id: "azul", gutenbergId: 14, title: "Azul…", author: "Rubén Darío", cover: false },
  ],
};

const MANIFEST: BookVocabManifest = {
  v: 1,
  wordCount: 1000,
  uniqueForms: 2,
  forms: ["casa", "perenne"],
  entries: [
    { id: "e1", lemma: "casa", pos: "sustantivo", zipf: 6.1 },
    { id: "e2", lemma: "perenne", pos: "adjetivo", zipf: 2.1 },
    { id: "e3", lemma: "perenne", pos: "verbo", zipf: null },
  ],
  byForm: { casa: [0], perenne: [1, 2], perennemente: [] },
  missing: [],
};

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
  session.clear();
});

describe("listCatalog", () => {
  it("devuelve el índice y lo respalda en session", async () => {
    fetchStub(async () => jsonResponse(INDEX));
    const index = await listCatalog();
    expect(index?.bookCount).toBe(2);
    expect(session.get("catalogIndex:v1")).toBe(JSON.stringify(INDEX));
  });

  it("sin red cae al respaldo de session", async () => {
    session.set("catalogIndex:v1", JSON.stringify(INDEX));
    fetchStub(async () => { throw new Error("offline"); });
    const index = await listCatalog();
    expect(index?.books.map((b) => b.id)).toEqual(["quijote", "azul"]);
  });

  it("sin red ni caché devuelve null (la sección se omite)", async () => {
    fetchStub(async () => { throw new Error("offline"); });
    expect(await listCatalog()).toBeNull();
  });

  it("respuesta con forma inválida no se fía ni se guarda", async () => {
    fetchStub(async () => jsonResponse({ books: [{ id: 1 }] }));
    expect(await listCatalog()).toBeNull();
    expect(session.has("catalogIndex:v1")).toBe(false);
  });
});

describe("catalogVocab", () => {
  it("descarga el manifiesto y lo cachea por libro", async () => {
    const fetch = fetchStub(async (url) =>
      url === "/api/catalog/quijote/vocab" ? jsonResponse(MANIFEST) : jsonResponse(null, 404),
    );
    const manifest = await catalogVocab("quijote");
    expect(manifest?.uniqueForms).toBe(2);
    // Segunda llamada sale del caché: no vuelve a la red.
    const again = await catalogVocab("quijote");
    expect(again).toEqual(manifest);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("manifiesto inválido devuelve null", async () => {
    fetchStub(async () => jsonResponse({ v: 2 }));
    expect(await catalogVocab("quijote")).toBeNull();
  });
});

describe("downloadCatalogEpub", () => {
  it("devuelve un File con nombre de título y autor", async () => {
    fetchStub(async (url) =>
      url === "/api/catalog/quijote/epub"
        ? new Response(new Blob(["PK epub"]), { status: 200 })
        : jsonResponse(null, 404),
    );
    const file = await downloadCatalogEpub(INDEX.books[0]);
    expect(file).not.toBeNull();
    expect(file?.name).toBe("Don Quijote — Miguel de Cervantes.epub");
    expect(file?.type).toBe("application/epub+zip");
    // jsdom serializa las partes Blob como texto («[object Blob]»);
    // en el navegador el contenido viaja completo. Aquí basta saber
    // que llegó un File no vacío.
    expect(file?.size).toBeGreaterThan(0);
  });

  it("404 devuelve null", async () => {
    fetchStub(async () => jsonResponse(null, 404));
    expect(await downloadCatalogEpub(INDEX.books[0])).toBeNull();
  });
});

describe("manifiesto → vista de predictSection", () => {
  it("entriesByFormOf reconstruye las fichas con campos slim", () => {
    const byForm = entriesByFormOf(MANIFEST);
    expect(byForm.casa[0].lemma).toBe("casa");
    expect(byForm.casa[0].zipf).toBe(6.1);
    // Dos acepciones de «perenne» conservan id propio tras dedupe.
    expect(byForm.perenne).toHaveLength(2);
    expect(byForm.perenne[1].pos).toBe("verbo");
  });

  it("manifestBookForms devuelve solo las formas del libro", () => {
    // «perennemente» existe en byForm como clave de respaldo pero no
    // es forma del libro: no entra a la cobertura.
    expect(manifestBookForms(MANIFEST)).toEqual(["casa", "perenne"]);
  });

  it("isCatalogIndex / isVocabManifest rechazan formas extrañas", () => {
    expect(isCatalogIndex(INDEX)).toBe(true);
    expect(isCatalogIndex({ books: "x" })).toBe(false);
    expect(isVocabManifest(MANIFEST)).toBe(true);
    expect(isVocabManifest({ v: 1 })).toBe(false);
  });
});
