import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveUserId,
  listAllSavedWords,
  putSavedWord,
  saveSessionValue,
  type SavedWord,
} from "./idb";
import { pushWordsToServer, syncSavedWords } from "./vocab";

vi.mock("./idb", () => ({
  getActiveUserId: vi.fn(() => "u1"),
  listAllSavedWords: vi.fn(async () => []),
  putSavedWord: vi.fn(async () => undefined),
  removeSavedWord: vi.fn(),
  saveSessionValue: vi.fn(async () => undefined),
}));

const word = (key: string, language = "es"): SavedWord => ({
  key,
  form: key,
  language,
  savedAt: 1,
  updatedAt: 1,
});

const okResponse = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const errorResponse = () => new Response("error", { status: 500 });

// El cuerpo de cada PUT, ya parseado, para revisar lotes y orden.
const putBodies = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter((call) => call[1]?.method === "PUT")
    .map((call) => JSON.parse(call[1]?.body as string) as { words: SavedWord[] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
  vi.mocked(getActiveUserId).mockReturnValue("u1");
  vi.mocked(listAllSavedWords).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pushWordsToServer", () => {
  it("sin palabras no llama al servidor y devuelve true", async () => {
    await expect(pushWordsToServer([])).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sin sesión no llama al servidor y devuelve true", async () => {
    vi.mocked(getActiveUserId).mockReturnValue(null);
    await expect(pushWordsToServer([word("a")])).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("500 palabras viajan en un solo PUT y en orden", async () => {
    const words = Array.from({ length: 500 }, (_, i) => word(`w${i}`));
    await expect(pushWordsToServer(words)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/vocab");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string).words).toEqual(words);
  });

  it("501 palabras viajan en dos lotes sin perder ni repetir ninguna", async () => {
    const words = Array.from({ length: 501 }, (_, i) => word(`w${i}`));
    await expect(pushWordsToServer(words)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const batches = putBodies().map((body) => body.words);
    expect(batches[0]).toEqual(words.slice(0, 500));
    expect(batches[1]).toEqual(words.slice(500));
    expect(batches.flat()).toEqual(words);
  });

  it("un lote rechazado devuelve false y detiene el envío", async () => {
    const words = Array.from({ length: 1200 }, (_, i) => word(`w${i}`));
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(errorResponse());
    await expect(pushWordsToServer(words)).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("si fetch lanza devuelve false", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("sin red"));
    await expect(pushWordsToServer([word("a")])).resolves.toBe(false);
  });
});

describe("syncSavedWords", () => {
  it("devuelve null y no sella la fecha si un idioma no responde", async () => {
    vi.mocked(listAllSavedWords).mockResolvedValue([word("a"), word("b")]);
    vi.mocked(fetch).mockResolvedValue(errorResponse());
    await expect(syncSavedWords()).resolves.toBeNull();
    expect(saveSessionValue).not.toHaveBeenCalled();
  });

  it("devuelve null y no sella la fecha si el envío falla", async () => {
    vi.mocked(listAllSavedWords).mockResolvedValue([word("a"), word("b")]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ words: [] }), { status: 200 }))
      .mockResolvedValueOnce(errorResponse());
    await expect(syncSavedWords()).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/vocab?lang=es");
    expect(saveSessionValue).not.toHaveBeenCalled();
  });

  it("con el ciclo completo devuelve lo traído y sella la fecha", async () => {
    vi.mocked(listAllSavedWords).mockResolvedValue([word("a"), word("b")]);
    const remote = { ...word("nueva"), savedAt: 5, updatedAt: 5 };
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ words: [remote] }), { status: 200 }))
      .mockResolvedValueOnce(okResponse());
    await expect(syncSavedWords()).resolves.toBe(1);
    expect(putSavedWord).toHaveBeenCalledWith(remote);
    expect(saveSessionValue).toHaveBeenCalledWith("vocabLastSyncAt", expect.any(String));
  });
});
