import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveUserId,
  listAllKnowledge,
  listAllReviews,
  listPositions,
  putKnowledge,
  putReviews,
  saveBookPosition,
  saveSessionValue,
  type KnownWord,
  type SavedAnnotation,
  type SavedBookPosition,
  type SavedInterval,
  type SavedReview,
} from "./idb";
import {
  pushAnnotationsToServer,
  pushActivityToServer,
  pushKnowledgeToServer,
  pushReviewsToServer,
  syncKnowledge,
  syncReviews,
  syncUserBookUpload,
  pullMissingUserBooksFromCloud,
} from "./reading-sync";
import { pushPositionsToServer, syncPositions } from "./positions-sync";

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
  knowledgeKey: vi.fn(
    (language: string, lemma: string) => `${language}:${lemma.toLowerCase()}`,
  ),
  listAllAnnotations: vi.fn(async () => []),
  listAllKnowledge: vi.fn(async () => []),
  listAllReviews: vi.fn(async () => []),
  listIntervals: vi.fn(async () => []),
  listPositions: vi.fn(async () => []),
  putAnnotation: vi.fn(async () => undefined),
  putKnowledge: vi.fn(async () => undefined),
  putMissingIntervals: vi.fn(async () => 0),
  putReviews: vi.fn(async () => 0),
  saveBookPosition: vi.fn(async () => undefined),
  saveSessionValue: vi.fn(async () => undefined),
  listBooks: vi.fn(async () => []),
  getBookData: vi.fn(async () => null),
  saveBook: vi.fn(async () => undefined),
  };
});

const annotation = (id: string, over: Partial<SavedAnnotation> = {}): SavedAnnotation => ({
  key: `b1:${id}`,
  id,
  bookHash: "b1",
  kind: "passage",
  sectionIndex: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const interval = (id: string): SavedInterval => ({
  id,
  bookHash: "b1",
  startedAt: 1,
  endedAt: 2,
});

const review = (id: string): SavedReview => ({
  id,
  language: "es",
  form: "perenne",
  kind: "meaning",
  rating: "good",
  hints: 0,
  createdAt: 1,
});

const position = (
  bookHash: string,
  over: Partial<SavedBookPosition> = {},
): SavedBookPosition => ({
  bookHash,
  sectionIndex: 0,
  scrollTop: 0,
  updatedAt: 1,
  ...over,
});

const known = (lemma: string, over: Partial<KnownWord> = {}): KnownWord => ({
  key: `es:${lemma}`,
  language: "es",
  lemma,
  known: true,
  source: "calibration",
  updatedAt: 1,
  ...over,
});

const okResponse = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const errorResponse = () => new Response("error", { status: 500 });

const putBodies = (
  field: "annotations" | "intervals" | "reviews" | "positions" | "rows",
) =>
  vi
    .mocked(fetch)
    .mock.calls.filter((call) => call[1]?.method === "PUT")
    .map((call) => JSON.parse(call[1]?.body as string)[field] as unknown[]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
  vi.mocked(getActiveUserId).mockReturnValue("u1");
  vi.mocked(listAllKnowledge).mockResolvedValue([]);
  vi.mocked(listAllReviews).mockResolvedValue([]);
  vi.mocked(listPositions).mockResolvedValue([]);
  vi.mocked(putReviews).mockResolvedValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pushAnnotationsToServer", () => {
  it("501 anotaciones viajan en dos PUT sin perder ni repetir ninguna", async () => {
    const items = Array.from({ length: 501 }, (_, i) => annotation(`a${i}`));
    // Una lápida dentro del segundo lote: debe llegar intacta.
    items[500].deleted = true;
    await expect(pushAnnotationsToServer(items)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/annotations");
    const batches = putBodies("annotations") as SavedAnnotation[][];
    expect(batches[0]).toEqual(items.slice(0, 500));
    expect(batches[1]).toEqual(items.slice(500));
    expect(batches[1][0].deleted).toBe(true);
    expect(batches.flat()).toEqual(items);
  });

  it("un lote rechazado devuelve false y detiene el envío", async () => {
    const items = Array.from({ length: 1200 }, (_, i) => annotation(`a${i}`));
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(errorResponse());
    await expect(pushAnnotationsToServer(items)).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sin sesión no llama al servidor y devuelve true", async () => {
    vi.mocked(getActiveUserId).mockReturnValue(null);
    await expect(pushAnnotationsToServer([annotation("a")])).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(saveSessionValue).not.toHaveBeenCalled();
  });
});

describe("pushActivityToServer", () => {
  it("1001 intervalos viajan en dos PUT sin perder ni repetir ninguno", async () => {
    const items = Array.from({ length: 1001 }, (_, i) => interval(`i${i}`));
    await expect(pushActivityToServer(items)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/activity");
    const batches = putBodies("intervals") as SavedInterval[][];
    expect(batches[0]).toHaveLength(1000);
    expect(batches[1]).toEqual(items.slice(1000));
    expect(batches.flat()).toEqual(items);
  });

  it("si fetch lanza devuelve false", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("sin red"));
    await expect(pushActivityToServer([interval("i")])).resolves.toBe(false);
  });
});

describe("pushReviewsToServer", () => {
  it("1001 repasos viajan en dos PUT sin perder ni repetir ninguno", async () => {
    const items = Array.from({ length: 1001 }, (_, i) => review(`r${i}`));
    await expect(pushReviewsToServer(items)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/reviews");
    const batches = putBodies("reviews") as SavedReview[][];
    expect(batches[0]).toHaveLength(1000);
    expect(batches[1]).toEqual(items.slice(1000));
    expect(batches.flat()).toEqual(items);
  });

  it("un lote rechazado devuelve false y detiene el envío", async () => {
    const items = Array.from({ length: 1500 }, (_, i) => review(`r${i}`));
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(errorResponse());
    await expect(pushReviewsToServer(items)).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sin sesión no llama al servidor y devuelve true", async () => {
    vi.mocked(getActiveUserId).mockReturnValue(null);
    await expect(pushReviewsToServer([review("r")])).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("syncReviews", () => {
  it("baja los que faltan, sube los locales y sella la fecha", async () => {
    vi.mocked(listAllReviews).mockResolvedValue([review("local")]);
    vi.mocked(putReviews).mockResolvedValue(1);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reviews: [review("remoto")] }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse());
    await expect(syncReviews()).resolves.toBe(1);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/api/reviews");
    expect(calls[1][0]).toBe("/api/reviews");
    expect(calls[1][1]?.method).toBe("PUT");
    expect(JSON.parse(calls[1][1]?.body as string).reviews).toEqual([review("local")]);
    expect(putReviews).toHaveBeenCalledWith(
      [review("remoto")],
      expect.anything(),
    );
    expect(saveSessionValue).toHaveBeenCalledWith(
      "reviewsLastSyncAt",
      expect.any(String),
      expect.anything(),
    );
  });

  it("devuelve null y no sella la fecha si el servidor no responde", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse());
    await expect(syncReviews()).resolves.toBeNull();
    expect(putReviews).not.toHaveBeenCalled();
    expect(saveSessionValue).not.toHaveBeenCalled();
  });

  it("devuelve null y no sella la fecha si el envío falla", async () => {
    vi.mocked(listAllReviews).mockResolvedValue([review("local")]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ reviews: [] }), { status: 200 }))
      .mockResolvedValueOnce(errorResponse());
    await expect(syncReviews()).resolves.toBeNull();
    expect(saveSessionValue).not.toHaveBeenCalled();
  });
});

describe("pushPositionsToServer", () => {
  it("501 posiciones viajan en dos PUT sin perder ni repetir ninguna", async () => {
    const items = Array.from({ length: 501 }, (_, i) => position(`b${i}`));
    await expect(pushPositionsToServer(items)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/positions");
    const batches = putBodies("positions") as SavedBookPosition[][];
    expect(batches[0]).toHaveLength(500);
    expect(batches[1]).toEqual(items.slice(500));
    expect(batches.flat()).toEqual(items);
  });

  it("un lote rechazado devuelve false y detiene el envío", async () => {
    const items = Array.from({ length: 600 }, (_, i) => position(`b${i}`));
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(errorResponse());
    await expect(pushPositionsToServer(items)).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sin sesión no llama al servidor y devuelve true", async () => {
    vi.mocked(getActiveUserId).mockReturnValue(null);
    await expect(pushPositionsToServer([position("b1")])).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("syncPositions", () => {
  it("la remota más nueva pisa el local distinto, registra el conflicto y sella", async () => {
    const local = position("b1", { sectionIndex: 1, progress: 0.2, updatedAt: 5 });
    const remota = position("b1", { sectionIndex: 3, progress: 0.6, updatedAt: 10 });
    vi.mocked(listPositions).mockResolvedValue([local]);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ positions: [remota] }), { status: 200 }),
    );
    await expect(syncPositions()).resolves.toEqual({
      pulled: 1,
      conflicts: [{ bookHash: "b1", previous: local, merged: remota }],
    });
    expect(saveBookPosition).toHaveBeenCalledWith(remota, expect.anything());
    // El local ya estaba cubierto por la remota más nueva: no hay PUT.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(saveSessionValue).toHaveBeenCalledWith(
      "positionsLastSyncAt",
      expect.any(String),
      expect.anything(),
    );
  });

  it("una remota nueva se guarda sin conflicto y la local más nueva se sube", async () => {
    const nueva = position("b2", { updatedAt: 10 });
    const local = position("b1", { updatedAt: 10 });
    const viejaRemota = position("b1", { updatedAt: 5 });
    vi.mocked(listPositions).mockResolvedValue([local]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ positions: [viejaRemota, nueva] }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse());
    await expect(syncPositions()).resolves.toEqual({ pulled: 1, conflicts: [] });
    expect(saveBookPosition).toHaveBeenCalledWith(nueva, expect.anything());
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[1][0]).toBe("/api/positions");
    expect(calls[1][1]?.method).toBe("PUT");
    expect(JSON.parse(calls[1][1]?.body as string).positions).toEqual([local]);
    expect(saveSessionValue).toHaveBeenCalledWith(
      "positionsLastSyncAt",
      expect.any(String),
      expect.anything(),
    );
  });

  it("devuelve null y no sella la fecha si el servidor no responde", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse());
    await expect(syncPositions()).resolves.toBeNull();
    expect(saveBookPosition).not.toHaveBeenCalled();
    expect(saveSessionValue).not.toHaveBeenCalled();
  });

  it("devuelve null y no sella la fecha si el envío falla", async () => {
    vi.mocked(listPositions).mockResolvedValue([position("b1", { updatedAt: 10 })]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ positions: [] }), { status: 200 }))
      .mockResolvedValueOnce(errorResponse());
    await expect(syncPositions()).resolves.toBeNull();
    expect(saveSessionValue).not.toHaveBeenCalled();
  });
});

describe("pushKnowledgeToServer", () => {
  it("501 filas viajan en dos PUT sin perder ni repetir ninguna", async () => {
    const items = Array.from({ length: 501 }, (_, i) => known(`lema${i}`));
    // Una lápida dentro del segundo lote: debe llegar intacta.
    items[500].deleted = true;
    await expect(pushKnowledgeToServer(items)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/knowledge");
    const batches = putBodies("rows") as KnownWord[][];
    expect(batches[0]).toHaveLength(500);
    expect(batches[1]).toEqual(items.slice(500));
    expect(batches[1][0].deleted).toBe(true);
    expect(batches.flat()).toEqual(items);
  });

  it("un lote rechazado devuelve false y detiene el envío", async () => {
    const items = Array.from({ length: 600 }, (_, i) => known(`lema${i}`));
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(errorResponse());
    await expect(pushKnowledgeToServer(items)).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sin sesión no llama al servidor y devuelve true", async () => {
    vi.mocked(getActiveUserId).mockReturnValue(null);
    await expect(pushKnowledgeToServer([known("perenne")])).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(saveSessionValue).not.toHaveBeenCalled();
  });
});

describe("syncKnowledge", () => {
  it("baja lo más nuevo, sube lo local ganador y sella la fecha", async () => {
    const local = known("perenne", { updatedAt: 10 });
    const remotaNueva = known("zafiro", { updatedAt: 10 });
    const remotaVieja = known("perenne", { known: false, updatedAt: 5 });
    vi.mocked(listAllKnowledge).mockResolvedValue([local]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rows: [remotaVieja, remotaNueva] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(okResponse());
    await expect(syncKnowledge()).resolves.toBe(1);
    // Solo la remota nueva entra; la vieja no pisa al local más nuevo.
    expect(putKnowledge).toHaveBeenCalledWith(remotaNueva, expect.anything());
    expect(putKnowledge).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/api/knowledge");
    expect(calls[1][0]).toBe("/api/knowledge");
    expect(calls[1][1]?.method).toBe("PUT");
    expect(JSON.parse(calls[1][1]?.body as string).rows).toEqual([local]);
    expect(saveSessionValue).toHaveBeenCalledWith(
      "knowledgeLastSyncAt",
      expect.any(String),
      expect.anything(),
    );
  });

  it("las lápidas remotas más nuevas también se fusionan", async () => {
    const local = known("perenne", { updatedAt: 5 });
    const lapida = known("perenne", { deleted: true, updatedAt: 10 });
    vi.mocked(listAllKnowledge).mockResolvedValue([local]);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [lapida] }), { status: 200 }),
    );
    await expect(syncKnowledge()).resolves.toBe(1);
    expect(putKnowledge).toHaveBeenCalledWith(lapida, expect.anything());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("una inferencia remota más nueva no destruye la respuesta explícita local", async () => {
    // El orden de arbitraje es (peso, sello, lápida, veredicto): la
    // explícita vieja gana a la inferencia nueva y además se sube
    // para que el servidor converja al mismo ganador.
    const local = known("perenne", { source: "declared", updatedAt: 100 });
    const remota = known("perenne", {
      source: "inferred",
      known: false,
      updatedAt: 200,
    });
    vi.mocked(listAllKnowledge).mockResolvedValue([local]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rows: [remota] }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse());
    await expect(syncKnowledge()).resolves.toBe(0);
    expect(putKnowledge).not.toHaveBeenCalled();
    expect((putBodies("rows") as KnownWord[][]).flat()).toEqual([local]);
  });

  it("una explícita remota más vieja sí desplaza una inferencia local", async () => {
    const local = known("perenne", {
      source: "inferred",
      known: false,
      updatedAt: 200,
    });
    const remota = known("perenne", { source: "declared", updatedAt: 100 });
    vi.mocked(listAllKnowledge).mockResolvedValue([local]);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [remota] }), { status: 200 }),
    );
    await expect(syncKnowledge()).resolves.toBe(1);
    expect(putKnowledge).toHaveBeenCalledWith(remota, expect.anything());
    // La inferencia local pierde y no se sube.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("una lápida explícita remota vence a una inferencia local más nueva", async () => {
    const local = known("perenne", { source: "inferred", updatedAt: 400 });
    const lapida = known("perenne", {
      source: "declared",
      deleted: true,
      updatedAt: 300,
    });
    vi.mocked(listAllKnowledge).mockResolvedValue([local]);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [lapida] }), { status: 200 }),
    );
    await expect(syncKnowledge()).resolves.toBe(1);
    expect(putKnowledge).toHaveBeenCalledWith(lapida, expect.anything());
  });

  it("una lápida local no se pisa por una inferencia remota más nueva", async () => {
    const local = known("perenne", {
      source: "declared",
      deleted: true,
      updatedAt: 300,
    });
    const remota = known("perenne", { source: "inferred", updatedAt: 400 });
    vi.mocked(listAllKnowledge).mockResolvedValue([local]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rows: [remota] }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse());
    await expect(syncKnowledge()).resolves.toBe(0);
    expect(putKnowledge).not.toHaveBeenCalled();
    // La lápida se sube para propagar el borrado.
    expect((putBodies("rows") as KnownWord[][]).flat()).toEqual([local]);
  });

  it("reconstruye la clave si la fila remota no la trae", async () => {
    const sinClave = { ...known("Perenne", { updatedAt: 10 }), key: "" };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [sinClave] }), { status: 200 }),
    );
    await expect(syncKnowledge()).resolves.toBe(1);
    expect(putKnowledge).toHaveBeenCalledWith(
      {
        ...sinClave,
        key: "es:perenne",
      },
      expect.anything(),
    );
  });

  it("devuelve null y no sella la fecha si el servidor no responde", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse());
    await expect(syncKnowledge()).resolves.toBeNull();
    expect(putKnowledge).not.toHaveBeenCalled();
    expect(saveSessionValue).not.toHaveBeenCalled();
  });

  it("devuelve null y no sella la fecha si el envío falla", async () => {
    vi.mocked(listAllKnowledge).mockResolvedValue([known("perenne", { updatedAt: 10 })]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [] }), { status: 200 }))
      .mockResolvedValueOnce(errorResponse());
    await expect(syncKnowledge()).resolves.toBeNull();
    expect(saveSessionValue).not.toHaveBeenCalled();
  });
});

describe("flush y keepalive en sincronización", () => {
  it("las peticiones PUT de sync de anotaciones incluyen keepalive: true", async () => {
    const item = annotation("a1");
    await pushAnnotationsToServer([item]);
    const calls = vi.mocked(fetch).mock.calls;
    const putCall = calls.find((c) => c[1]?.method === "PUT");
    expect(putCall).toBeDefined();
    expect(putCall?.[1]?.keepalive).toBe(true);
  });

  it("pushPositionsToServer incluye keepalive: true en guardado de progreso", async () => {
    const pos = position("book1", { sectionIndex: 2 });
    await pushPositionsToServer([pos]);
    const calls = vi.mocked(fetch).mock.calls;
    const posCall = calls.find(
      (c) => c[0] === "/api/positions" && c[1]?.method === "PUT",
    );
    expect(posCall).toBeDefined();
    expect(posCall?.[1]?.keepalive).toBe(true);
  });
});

describe("BYO-EPUB Cloud Sync (reading-sync)", () => {
  it("syncUserBookUpload sube el archivo EPUB con los encabezados correspondientes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const data = new Uint8Array([1, 2, 3]).buffer;
    const ok = await syncUserBookUpload({
      id: "book-123",
      title: "El Quijote",
      author: "Cervantes",
      data,
    });
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/user/books/book-123/file",
      expect.objectContaining({
        method: "PUT",
        headers: {
          "Content-Type": "application/epub+zip",
          "x-book-title": encodeURIComponent("El Quijote"),
          "x-book-author": encodeURIComponent("Cervantes"),
        },
        body: data,
      }),
    );
  });

  it("pullMissingUserBooksFromCloud descarga libros que no existen localmente y los guarda en IDB", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            books: [
              { id: "b1", title: "Libro 1", author: "A1", updatedAt: 100 },
              { id: "b2", title: "Libro 2", author: "A2", updatedAt: 200 },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }),
      );

    const { listBooks, saveBook } = await import("./idb");
    vi.mocked(listBooks).mockResolvedValueOnce([{ id: "b1", title: "Libro 1" }]);

    const downloaded = await pullMissingUserBooksFromCloud();
    expect(downloaded).toBe(1);
    expect(saveBook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "b2",
        title: "Libro 2",
        author: "A2",
        addedAt: 200,
      }),
    );
  });
});

