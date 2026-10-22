import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveUserId,
  listAllSavedWords,
  putSavedWord,
  saveSessionValue,
  type SavedWord,
} from "./idb";
import { pushWordsToServer, syncSavedWords } from "./vocab";
import { clearSyncCursors } from "./sync-cursors";

vi.mock("./idb", () => {
  const getActiveUserId = vi.fn((): string | null => "u1");
  const captureDbScope = vi.fn(() => ({
    userId: getActiveUserId(),
    generation: 0,
  }));
  const isDbScopeActive = vi.fn(
    (scope: { userId: string | null }) => scope.userId === getActiveUserId(),
  );
  class StaleScopeError extends Error {
    constructor() {
      super("La cuenta activa cambió durante la operación.");
      this.name = "StaleScopeError";
    }
  }
  return {
  captureDbScope,
  isDbScopeActive,
  StaleScopeError,
  getActiveUserId,
  listAllSavedWords: vi.fn(async () => []),
  putSavedWord: vi.fn(async () => undefined),
  removeSavedWord: vi.fn(),
  saveSessionValue: vi.fn(async () => undefined),
  };
});

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
  clearSyncCursors();
  if (typeof localStorage !== "undefined") localStorage.clear();
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
    expect(fetch).toHaveBeenCalledWith("/api/vocab?lang=es", expect.anything());
    expect(saveSessionValue).not.toHaveBeenCalled();
  });

  it("con el ciclo completo devuelve lo traído y sella la fecha", async () => {
    vi.mocked(listAllSavedWords).mockResolvedValue([word("a"), word("b")]);
    const remote = { ...word("nueva"), savedAt: 5, updatedAt: 5 };
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ words: [remote] }), { status: 200 }))
      .mockResolvedValueOnce(okResponse());
    await expect(syncSavedWords()).resolves.toBe(1);
    expect(putSavedWord).toHaveBeenCalledWith(remote, expect.anything());
    expect(saveSessionValue).toHaveBeenCalledWith(
      "vocabLastSyncAt",
      expect.any(String),
      expect.anything(),
    );
  });

  it("la segunda llamada a sync envía ?since=<timestamp> y un delta vacío conserva palabras locales", async () => {
    const localWords = [word("palabra1"), word("palabra2")];
    vi.mocked(listAllSavedWords).mockResolvedValue(localWords);

    // Primera llamada: descarga palabra con updatedAt: 1000
    const remoteFirst = { ...word("nueva"), savedAt: 1000, updatedAt: 1000 };
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ words: [remoteFirst], serverTime: 1000 }), { status: 200 }))
      .mockResolvedValueOnce(okResponse());

    await expect(syncSavedWords()).resolves.toBe(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/vocab?lang=es");

    // Segunda llamada: debe incluir &since=1000
    vi.mocked(putSavedWord).mockClear();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ words: [], serverTime: 1500 }), { status: 200 }));

    await expect(syncSavedWords()).resolves.toBe(0);
    const secondGetUrl = vi.mocked(fetch).mock.calls[2][0];
    expect(secondGetUrl).toBe("/api/vocab?lang=es&since=1000");

    // Un delta vacío no sobrescribe ni borra las palabras locales
    expect(putSavedWord).not.toHaveBeenCalled();
  });

  it("itera y recupera 1050 palabras en dos páginas en una sola llamada a syncSavedWords", async () => {
    vi.mocked(listAllSavedWords).mockResolvedValue([]);
    const page1Words = Array.from({ length: 1000 }, (_, i) => ({
      ...word(`w_${i}`),
      savedAt: 1000 + i,
      updatedAt: 1000 + i,
    }));
    const page2Words = Array.from({ length: 50 }, (_, i) => ({
      ...word(`w_p2_${i}`),
      savedAt: 2000 + i,
      updatedAt: 2000 + i,
    }));

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            words: page1Words,
            hasMore: true,
            nextCursor: 1999,
            serverTime: 1999,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            words: page2Words,
            hasMore: false,
            nextCursor: 2050,
            serverTime: 2050,
          }),
          { status: 200 },
        ),
      );

    const result = await syncSavedWords();
    expect(result).toBe(1050);
    expect(putSavedWord).toHaveBeenCalledTimes(1050);

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/api/vocab?lang=es");
    expect(calls[1][0]).toBe("/api/vocab?lang=es&since=1999");
  });

  it("una palabra nueva guardada localmente se incluye en toPush aunque el cursor de bajada esté adelantado", async () => {
    const { setSyncCursor } = await import("./sync-cursors");
    const futureTime = Date.now() + 600_000;
    setSyncCursor("u1", "vocab", futureTime);
    setSyncCursor("u1", "vocab:es", futureTime);

    const nuevaLocal = { ...word("palabraNueva"), updatedAt: Date.now(), savedAt: Date.now() };
    vi.mocked(listAllSavedWords).mockResolvedValue([nuevaLocal]);

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ words: [], serverTime: Date.now(), hasMore: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse());

    const result = await syncSavedWords();
    expect(result).toBe(0);

    const putCalls = vi.mocked(fetch).mock.calls.filter((c) => c[1]?.method === "PUT");
    expect(putCalls).toHaveLength(1);
    const body = JSON.parse(putCalls[0][1]?.body as string) as { words: SavedWord[] };
    expect(body.words).toHaveLength(1);
    expect(body.words[0].key).toBe("palabraNueva");
  });

  it("un dispositivo nuevo con base local vacía al recibir availableLanguages sincroniza todos los idiomas", async () => {
    vi.mocked(listAllSavedWords).mockResolvedValue([]);

    const wordEs = { ...word("hola", "es"), savedAt: 100, updatedAt: 100 };
    const wordEn = { ...word("hello", "en"), savedAt: 200, updatedAt: 200 };

    vi.mocked(fetch)
      // Respuesta para lang=es con availableLanguages: ["es", "en"]
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            words: [wordEs],
            availableLanguages: ["es", "en"],
            hasMore: false,
            serverTime: 100,
          }),
          { status: 200 },
        ),
      )
      // Respuesta para lang=en
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            words: [wordEn],
            hasMore: false,
            serverTime: 200,
          }),
          { status: 200 },
        ),
      );

    const result = await syncSavedWords();
    expect(result).toBe(2);
    expect(putSavedWord).toHaveBeenCalledWith(wordEs, expect.anything());
    expect(putSavedWord).toHaveBeenCalledWith(wordEn, expect.anything());

    const getCalls = vi.mocked(fetch).mock.calls.filter((c) => !c[1]?.method || c[1]?.method === "GET");
    expect(getCalls).toHaveLength(2);
    expect(getCalls[0][0]).toBe("/api/vocab?lang=es");
    expect(getCalls[1][0]).toBe("/api/vocab?lang=en");
  });
});
