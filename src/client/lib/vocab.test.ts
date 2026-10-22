import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveUserId,
  listAllSavedWords,
  putSavedWord,
  saveSessionValue,
  type SavedWord,
} from "./idb";
import { pushWordsToServer, syncSavedWords } from "./vocab";
import { clearSyncCursors, getSyncCursor } from "./sync-cursors";

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
    await expect(pushWordsToServer([])).resolves.toMatchObject({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sin sesión no llama al servidor y devuelve true", async () => {
    vi.mocked(getActiveUserId).mockReturnValue(null);
    await expect(pushWordsToServer([word("a")])).resolves.toMatchObject({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("500 palabras viajan en un solo PUT y en orden", async () => {
    const words = Array.from({ length: 500 }, (_, i) => word(`w${i}`));
    await expect(pushWordsToServer(words)).resolves.toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/vocab");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string).words).toEqual(words);
  });

  it("501 palabras viajan en dos lotes sin perder ni repetir ninguna", async () => {
    const words = Array.from({ length: 501 }, (_, i) => word(`w${i}`));
    await expect(pushWordsToServer(words)).resolves.toMatchObject({ ok: true });
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
    await expect(pushWordsToServer(words)).resolves.toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("si fetch lanza devuelve false", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("sin red"));
    await expect(pushWordsToServer([word("a")])).resolves.toMatchObject({ ok: false });
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
            nextAfterWord: "w_999",
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
    expect(calls[1][0]).toBe(
      "/api/vocab?lang=es&since=1999&afterWord=w_999&includeLanguages=0",
    );
  });

  it("arranca en since=0 y avanza con nextCursor + afterWord en la segunda página", async () => {
    vi.mocked(listAllSavedWords).mockResolvedValue([]);

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            words: [{ ...word("alba"), savedAt: 1000, updatedAt: 1000 }],
            hasMore: true,
            nextCursor: 1000,
            nextAfterWord: "alba",
            serverTime: 1000,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            words: [],
            hasMore: false,
            nextCursor: 2000,
            serverTime: 2000,
          }),
          { status: 200 },
        ),
      );

    await expect(syncSavedWords()).resolves.toBe(1);

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/api/vocab?lang=es");
    expect(calls[1][0]).toBe(
      "/api/vocab?lang=es&since=1000&afterWord=alba&includeLanguages=0",
    );
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

describe("cursor de push veraz", () => {
  it("avanza al máximo aceptado por el servidor y nunca al reloj", async () => {
    vi.mocked(listAllSavedWords).mockResolvedValue([
      { ...word("a"), savedAt: 100, updatedAt: 100 },
      { ...word("b"), savedAt: 200, updatedAt: 200 },
    ]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ words: [], serverTime: 900 }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse());

    const now = vi.spyOn(Date, "now").mockReturnValue(9_000_000_000_000_000);
    await syncSavedWords();
    now.mockRestore();

    expect(getSyncCursor("u1", "vocab:es:push")).toBe(200);
    expect(getSyncCursor("u1", "vocab:es")).toBe(900);
    // Los cursores globales ya no se escriben (Fase 4).
    expect(getSyncCursor("u1", "vocab")).toBe(0);
    expect(getSyncCursor("u1", "vocab:push")).toBe(0);
  });

  it("un lote fallido no adelanta el cursor más allá de lo confirmado", async () => {
    const words = Array.from({ length: 501 }, (_, i) => ({
      ...word(`w${i}`),
      savedAt: i + 1,
      updatedAt: i + 1,
    }));
    vi.mocked(listAllSavedWords).mockResolvedValue(words);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ words: [] }), { status: 200 }))
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(errorResponse());

    await expect(syncSavedWords()).resolves.toBeNull();
    expect(getSyncCursor("u1", "vocab:es:push")).toBe(500);
    expect(getSyncCursor("u1", "vocab:es:push")).not.toBe(Date.now());
  });

  it("una palabra guardada mientras el PUT está en vuelo se empuja en el ciclo siguiente", async () => {
    vi.mocked(listAllSavedWords).mockResolvedValue([
      { ...word("a"), savedAt: 100, updatedAt: 100 },
    ]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ words: [] }), { status: 200 }))
      .mockResolvedValueOnce(okResponse());
    await syncSavedWords();
    expect(getSyncCursor("u1", "vocab:es:push")).toBe(100);

    // El usuario guardó "b" (150) mientras el PUT anterior estaba en vuelo.
    vi.mocked(listAllSavedWords).mockResolvedValue([
      { ...word("a"), savedAt: 100, updatedAt: 100 },
      { ...word("b"), savedAt: 150, updatedAt: 150 },
    ]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ words: [] }), { status: 200 }))
      .mockResolvedValueOnce(okResponse());
    await syncSavedWords();

    const batches = putBodies();
    expect(batches.at(-1)?.words.map((item) => item.key)).toEqual(["b"]);
    expect(getSyncCursor("u1", "vocab:es:push")).toBe(150);
  });
});
