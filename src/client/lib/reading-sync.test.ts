import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveUserId,
  listAllAnnotations,
  listAllKnowledge,
  listAllReviews,
  listPositions,
  putAnnotation,
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
  syncAnnotations,
  syncKnowledge,
  syncReviews,
  syncUserBookUpload,
  pullMissingUserBooksFromCloud,
  forceFullResyncFromServer,
} from "./reading-sync";
import { pushPositionsToServer, syncPositions } from "./positions-sync";
import { clearSyncCursors, getSyncCursor, setSyncCursor } from "./sync-cursors";

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
  listSavedWords: vi.fn(async () => []),
  listAllSavedWords: vi.fn(async () => []),
  putAnnotation: vi.fn(async () => undefined),
  putSavedWord: vi.fn(async () => undefined),
  putKnowledge: vi.fn(async () => undefined),
  putMissingIntervals: vi.fn(async () => 0),
  putReviews: vi.fn(async () => 0),
  saveBookPosition: vi.fn(async () => undefined),
  saveSessionValue: vi.fn(async () => undefined),
  listBooks: vi.fn(async () => []),
  getBookData: vi.fn(async () => null),
  saveBook: vi.fn(async () => undefined),
  mergeKnowledgeRecords: vi.fn((a: { updatedAt?: number; savedAt?: number; deleted?: boolean }, b: { updatedAt?: number; savedAt?: number; deleted?: boolean }) => {
    const getStamp = (r: { updatedAt?: number; savedAt?: number }) => r.updatedAt ?? r.savedAt ?? 0;
    const [winner, loser] = getStamp(a) >= getStamp(b) ? [a, b] : [b, a];
    if (winner.deleted) return winner;
    return { ...loser, ...winner };
  }),
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
  clearSyncCursors();
  if (typeof localStorage !== "undefined") localStorage.clear();
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
    await expect(pushAnnotationsToServer(items)).resolves.toMatchObject({ ok: true });
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
    await expect(pushAnnotationsToServer(items)).resolves.toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sin sesión no llama al servidor y devuelve true", async () => {
    vi.mocked(getActiveUserId).mockReturnValue(null);
    await expect(pushAnnotationsToServer([annotation("a")])).resolves.toMatchObject({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(saveSessionValue).not.toHaveBeenCalled();
  });
});

describe("syncAnnotations", () => {
  it("la segunda llamada a syncAnnotations envía ?since=<timestamp> y un delta vacío conserva locales", async () => {
    const { listAllAnnotations, putAnnotation } = await import("./idb");
    const local = [annotation("a1", { updatedAt: 100 })];
    vi.mocked(listAllAnnotations).mockResolvedValue(local);

    const remoteFirst = annotation("a2", { updatedAt: 200 });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ annotations: [remoteFirst], serverTime: 200 }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse());

    await expect(syncAnnotations()).resolves.toBe(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/annotations");

    vi.mocked(putAnnotation).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ annotations: [], serverTime: 300 }), { status: 200 }),
    );

    await expect(syncAnnotations()).resolves.toBe(0);
    const secondCall = vi.mocked(fetch).mock.calls[2][0];
    expect(secondCall).toBe("/api/annotations?since=200");
    expect(putAnnotation).not.toHaveBeenCalled();
  });

  it("el cursor de push avanza a lo confirmado, nunca al reloj", async () => {
    const { listAllAnnotations } = await import("./idb");
    vi.mocked(listAllAnnotations).mockResolvedValue([
      annotation("a1", { updatedAt: 100 }),
      annotation("a2", { updatedAt: 200 }),
    ]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ annotations: [], serverTime: 900 }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse());

    const now = vi.spyOn(Date, "now").mockReturnValue(9_000_000_000_000_000);
    await syncAnnotations();
    now.mockRestore();

    expect(getSyncCursor("u1", "annotations:push")).toBe(200);
    expect(getSyncCursor("u1", "annotations")).toBe(900);
  });

  it("con sellos no monótonos ordena por stamp ASC, y ante fallo del lote 2 lastPushedAt conserva el corte y el siguiente ciclo reenvía", async () => {
    const { listAllAnnotations } = await import("./idb");
    const items: SavedAnnotation[] = [
      annotation("aardvark", { updatedAt: 5000 }),
      ...Array.from({ length: 499 }, (_, i) => annotation(`mid${i}`, { updatedAt: 1000 })),
      annotation("zorro", { updatedAt: 1000 }),
    ];
    vi.mocked(listAllAnnotations).mockResolvedValue(items);

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ annotations: [], serverTime: 900 }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(errorResponse());

    await expect(syncAnnotations()).resolves.toBeNull();

    const batches = putBodies("annotations") as SavedAnnotation[][];
    expect(batches).toHaveLength(2);
    expect(batches[0].some((a) => a.id === "zorro")).toBe(true);
    expect(batches[1].some((a) => a.id === "aardvark")).toBe(true);

    expect(getSyncCursor("u1", "annotations:push")).toBe(1000);

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ annotations: [], serverTime: 1200 }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse());

    await syncAnnotations();

    const secondAttemptBatches = (putBodies("annotations") as SavedAnnotation[][]).slice(2);
    expect(secondAttemptBatches).toHaveLength(1);
    expect(secondAttemptBatches[0].map((a) => a.id)).toEqual(["aardvark"]);
    expect(getSyncCursor("u1", "annotations:push")).toBe(5000);
  });
});

describe("pushActivityToServer", () => {
  it("1001 intervalos viajan en dos PUT sin perder ni repetir ninguno", async () => {
    const items = Array.from({ length: 1001 }, (_, i) => interval(`i${i}`));
    await expect(pushActivityToServer(items)).resolves.toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/activity");
    const batches = putBodies("intervals") as SavedInterval[][];
    expect(batches[0]).toHaveLength(1000);
    expect(batches[1]).toEqual(items.slice(1000));
    expect(batches.flat()).toEqual(items);
  });

  it("si fetch lanza devuelve false", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("sin red"));
    await expect(pushActivityToServer([interval("i")])).resolves.toMatchObject({ ok: false });
  });
});

describe("pushReviewsToServer", () => {
  it("1001 repasos viajan en dos PUT sin perder ni repetir ninguno", async () => {
    const items = Array.from({ length: 1001 }, (_, i) => review(`r${i}`));
    await expect(pushReviewsToServer(items)).resolves.toMatchObject({ ok: true });
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
    await expect(pushReviewsToServer(items)).resolves.toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sin sesión no llama al servidor y devuelve true", async () => {
    vi.mocked(getActiveUserId).mockReturnValue(null);
    await expect(pushReviewsToServer([review("r")])).resolves.toMatchObject({ ok: true });
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
    await expect(pushPositionsToServer(items)).resolves.toMatchObject({ ok: true });
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
    await expect(pushPositionsToServer(items)).resolves.toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sin sesión no llama al servidor y devuelve true", async () => {
    vi.mocked(getActiveUserId).mockReturnValue(null);
    await expect(pushPositionsToServer([position("b1")])).resolves.toMatchObject({ ok: true });
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

  it("la fila que aterrizó durante el pull no la pisa una remota más antigua", async () => {
    // Cerrar el libro con «atrás» guarda la posición en segundo plano y
    // sincroniza acto seguido. Si el merge se apoya en la foto tomada
    // antes de la red, una remota que ya era vieja (otro dispositivo,
    // reloj desincronizado) gana y el punto recién leído desaparece.
    const fotoVieja = position("b1", { sectionIndex: 0, progress: 0.01, updatedAt: 100 });
    const guardadaAlCerrar = position("b1", { sectionIndex: 4, progress: 0.55, updatedAt: 900 });
    const remota = position("b1", { sectionIndex: 0, progress: 0.01, updatedAt: 500 });
    vi.mocked(listPositions)
      .mockResolvedValueOnce([fotoVieja])
      .mockResolvedValue([guardadaAlCerrar]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ positions: [remota] }), { status: 200 }),
      )
      .mockResolvedValueOnce(okResponse());

    await expect(syncPositions()).resolves.toEqual({ pulled: 0, conflicts: [] });

    expect(saveBookPosition).not.toHaveBeenCalled();
    const putBody = JSON.parse(
      vi.mocked(fetch).mock.calls[1][1]?.body as string,
    ) as { positions: SavedBookPosition[] };
    expect(putBody.positions).toEqual([guardadaAlCerrar]);
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
    await expect(pushKnowledgeToServer(items)).resolves.toMatchObject({ ok: true });
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
    await expect(pushKnowledgeToServer(items)).resolves.toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sin sesión no llama al servidor y devuelve true", async () => {
    vi.mocked(getActiveUserId).mockReturnValue(null);
    await expect(pushKnowledgeToServer([known("perenne")])).resolves.toMatchObject({ ok: true });
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

  it("scheduleReadingSyncPush debounce de 2 segundos ejecuta el push pendiente tras 2000 ms", async () => {
    vi.useFakeTimers();
    const runner = vi.fn(async () => {});
    const { registerReadingSyncRunner, scheduleReadingSyncPush } = await import("./reading-sync");
    registerReadingSyncRunner(runner);

    scheduleReadingSyncPush("words", 2000);
    expect(runner).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1999);
    expect(runner).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(runner).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("flushPendingReadingSync cancela el timer pendiente y ejecuta inmediatamente", async () => {
    vi.useFakeTimers();
    const runner = vi.fn(async () => {});
    const { registerReadingSyncRunner, scheduleReadingSyncPush, flushPendingReadingSync } =
      await import("./reading-sync");
    registerReadingSyncRunner(runner);

    scheduleReadingSyncPush("words", 2000);
    expect(runner).not.toHaveBeenCalled();

    await flushPendingReadingSync();
    expect(runner).toHaveBeenCalledTimes(1);

    // Asegurarse de que el timer fue cancelado y no vuelve a disparar
    await vi.advanceTimersByTimeAsync(2000);
    expect(runner).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
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

describe("Paginación y Cursores de Sync (Lote 1)", () => {
  it("syncKnowledge itera y recupera 1050 filas en dos páginas en una sola llamada", async () => {
    const page1Rows = Array.from({ length: 1000 }, (_, i) => ({
      ...known(`lemma_${i}`),
      updatedAt: 1000 + i,
    }));
    const page2Rows = Array.from({ length: 50 }, (_, i) => ({
      ...known(`lemma_p2_${i}`),
      updatedAt: 2000 + i,
    }));

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rows: page1Rows,
            hasMore: true,
            nextCursor: 1999,
            nextAfterWord: "lemma_999",
            nextAfterLanguage: "es",
            serverTime: 1999,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rows: page2Rows,
            hasMore: false,
            nextCursor: 2050,
            serverTime: 2050,
          }),
          { status: 200 },
        ),
      );

    const result = await syncKnowledge();
    expect(result).toBe(1050);
    expect(putKnowledge).toHaveBeenCalledTimes(1050);

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/api/knowledge");
    expect(calls[1][0]).toBe(
      "/api/knowledge?since=1999&afterWord=lemma_999&afterLanguage=es&includeLanguages=0",
    );
  });

  it("syncKnowledge recibe availableLanguages en la respuesta y guarda el cursor final", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rows: [known("perenne", { language: "es" })],
          availableLanguages: ["es", "en"],
          hasMore: false,
          nextCursor: 5000,
          serverTime: 5000,
        }),
        { status: 200 },
      ),
    );

    const result = await syncKnowledge();
    expect(result).toBe(1);
    const { getSyncCursor } = await import("./sync-cursors");
    expect(getSyncCursor("u1", "knowledge")).toBe(5000);
  });

  it("syncAnnotations aplica paginación con hasMore y nextCursor", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => annotation(`a_${i}`, { updatedAt: 1000 + i }));
    const page2 = Array.from({ length: 20 }, (_, i) => annotation(`a_p2_${i}`, { updatedAt: 2000 + i }));

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            annotations: page1,
            hasMore: true,
            nextCursor: 1999,
            nextAfterId: "a_999",
            serverTime: 1999,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            annotations: page2,
            hasMore: false,
            nextCursor: 2020,
            serverTime: 2020,
          }),
          { status: 200 },
        ),
      );

    const result = await syncAnnotations();
    expect(result).toBe(1020);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/api/annotations");
    expect(calls[1][0]).toBe(
      "/api/annotations?since=1999&afterId=a_999",
    );
  });

  it("no omite ni duplica filas cuando dos páginas comparten updated_at", async () => {
    const page1 = [
      annotation("a", { updatedAt: 1000 }),
      annotation("b", { updatedAt: 1000 }),
    ];
    const page2 = [
      annotation("c", { updatedAt: 1000 }),
      annotation("d", { updatedAt: 1000 }),
    ];

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            annotations: page1,
            hasMore: true,
            nextCursor: 1000,
            nextAfterId: "b",
            serverTime: 1000,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            annotations: page2,
            hasMore: false,
            nextCursor: 2000,
            serverTime: 2000,
          }),
          { status: 200 },
        ),
      );

    const { putAnnotation } = await import("./idb");
    const result = await syncAnnotations();
    expect(result).toBe(4);
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe(
      "/api/annotations?since=1000&afterId=b",
    );
    const pulledKeys = vi.mocked(putAnnotation).mock.calls.map(([item]) => item.key);
    expect(new Set(pulledKeys).size).toBe(4);
    expect(pulledKeys.sort()).toEqual(["b1:a", "b1:b", "b1:c", "b1:d"]);
  });

  it("syncActivity aplica paginación con hasMore y nextAfterId", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => interval(`act_${i}`));
    const page2 = Array.from({ length: 10 }, (_, i) => interval(`act_p2_${i}`));

    const { syncActivity } = await import("./reading-sync");

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            intervals: page1,
            hasMore: true,
            nextAfterId: "act_999",
            nextCursor: 1999,
            serverTime: 1999,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            intervals: page2,
            hasMore: false,
            nextAfterId: null,
            nextCursor: 2010,
            serverTime: 2010,
          }),
          { status: 200 },
        ),
      );

    const { putMissingIntervals } = await import("./idb");
    vi.mocked(putMissingIntervals).mockResolvedValueOnce(1010);

    const result = await syncActivity();
    expect(result).toBe(1010);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/api/activity");
    expect(calls[1][0]).toBe("/api/activity?afterId=act_999");
  });

  it("syncReviews aplica paginación con hasMore y nextAfterId", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => review(`rev_${i}`));
    const page2 = Array.from({ length: 15 }, (_, i) => review(`rev_p2_${i}`));

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reviews: page1,
            hasMore: true,
            nextAfterId: "rev_999",
            nextCursor: 1999,
            serverTime: 1999,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reviews: page2,
            hasMore: false,
            nextAfterId: null,
            nextCursor: 2015,
            serverTime: 2015,
          }),
          { status: 200 },
        ),
      );

    vi.mocked(putReviews).mockResolvedValueOnce(1015);

    const result = await syncReviews();
    expect(result).toBe(1015);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/api/reviews");
    expect(calls[1][0]).toBe("/api/reviews?afterId=rev_999");
  });

  it("syncPositions aplica paginación con hasMore y nextCursor", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => position(`h_${i}`, { updatedAt: 1000 + i }));
    const page2 = Array.from({ length: 25 }, (_, i) => position(`h_p2_${i}`, { updatedAt: 2000 + i }));

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            positions: page1,
            hasMore: true,
            nextCursor: 1999,
            nextAfterBookHash: "h_999",
            serverTime: 1999,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            positions: page2,
            hasMore: false,
            nextCursor: 2025,
            serverTime: 2025,
          }),
          { status: 200 },
        ),
      );

    const result = await syncPositions();
    expect(result?.pulled).toBe(1025);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/api/positions");
    expect(calls[1][0]).toBe(
      "/api/positions?since=1999&afterBookHash=h_999",
    );
  });

  it("pushAnnotationsToServer corrige sellos futuros al serverTime devuelto por el servidor", async () => {
    const serverNow = 1_700_000_000_000;
    const futureTime = serverNow + 600_000;
    const ann = annotation("a_futuro", { updatedAt: futureTime });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, serverTime: serverNow }), { status: 200 }),
    );

    const result = await pushAnnotationsToServer([ann]);
    expect(result.ok).toBe(true);
    expect(putAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "a_futuro",
        updatedAt: serverNow,
      }),
      expect.anything(),
    );
  });

  it("forceFullResyncFromServer restaura registros borrados silenciosamente en IndexedDB sin cerrar sesión", async () => {
    // 1. Simular cursor de pull avanzado previamente en annotations
    setSyncCursor("u1", "annotations", 5000);
    setSyncCursor("u1", "vocab:es", 5000);
    setSyncCursor("u1", "positions", 5000);
    expect(getSyncCursor("u1", "annotations")).toBe(5000);

    // 2. En local IndexedDB, el registro de anotación se borró silenciosamente
    vi.mocked(listAllAnnotations).mockResolvedValue([]);

    // 3. Mock de endpoints para responder al pull completo y a /api/sync/counts
    const restoredAnn = {
      id: "ann_restaurada",
      bookHash: "b1",
      kind: "passage",
      sectionIndex: 0,
      anchor: null,
      text: "anotación recuperada",
      prefix: null,
      suffix: null,
      note: null,
      createdAt: 1000,
      updatedAt: 1000,
      syncedAt: 1000,
      deleted: false,
    };

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/annotations")) {
        return new Response(
          JSON.stringify({
            annotations: [restoredAnn],
            hasMore: false,
            nextCursor: 1000,
            serverTime: 1000,
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/vocab")) {
        return new Response(
          JSON.stringify({ words: [], hasMore: false, nextCursor: 0, serverTime: 1000 }),
          { status: 200 },
        );
      }
      if (url.includes("/api/positions")) {
        return new Response(
          JSON.stringify({ positions: [], hasMore: false, nextCursor: 0, serverTime: 1000 }),
          { status: 200 },
        );
      }
      if (url.includes("/api/activity")) {
        return new Response(
          JSON.stringify({ intervals: [], hasMore: false, nextCursor: 0, serverTime: 1000 }),
          { status: 200 },
        );
      }
      if (url.includes("/api/reviews")) {
        return new Response(
          JSON.stringify({ reviews: [], hasMore: false, nextCursor: 0, serverTime: 1000 }),
          { status: 200 },
        );
      }
      if (url.includes("/api/knowledge")) {
        return new Response(
          JSON.stringify({ items: [], hasMore: false, nextCursor: 0, serverTime: 1000 }),
          { status: 200 },
        );
      }
      if (url.includes("/api/sync/counts")) {
        return new Response(
          JSON.stringify({
            ok: true,
            counts: {
              words: 0,
              annotations: 1,
              activity: 0,
              reviews: 0,
              positions: 0,
              knowledge: 0,
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, serverTime: 1000 }), { status: 200 });
    });

    // Simulamos que al repoblar, putAnnotation registra la fila y subsequent listAllAnnotations la retorna
    vi.mocked(putAnnotation).mockImplementationOnce(async (ann) => {
      vi.mocked(listAllAnnotations).mockResolvedValue([
        annotation("ann_restaurada", { text: "anotación recuperada", updatedAt: 1000 }),
      ]);
      return ann.id;
    });

    // 4. Invocar la resincronización forzada
    const res = await forceFullResyncFromServer();

    expect(res.ok).toBe(true);
    // Verifica que putAnnotation fue invocado para restaurar la anotación en IDB
    expect(putAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ann_restaurada",
        text: "anotación recuperada",
      }),
      expect.anything(),
    );

    // Verifica que la petición de pull fue sin since=5000 gracias al reinicio de cursor
    const annCall = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).includes("/api/annotations"));
    expect(annCall).toBeDefined();
    expect(String(annCall?.[0])).not.toContain("since=5000");

    // Y los conteos finales coinciden con el servidor
    expect(res.serverCounts?.annotations).toBe(1);
    expect(res.localCounts?.annotations).toBe(1);
    expect(res.diverged).toBe(false);
  });
});

