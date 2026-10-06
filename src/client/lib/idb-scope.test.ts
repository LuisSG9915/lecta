// Pruebas del aislamiento de cuenta: generación de contexto,
// migración anónimo→cuenta y escrituras tardías que aterrizan en la
// base dueña. IndexedDB se simula con un Map por base; `openDB` se
// sustituye pero el resto del módulo corre de verdad.
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY_PATHS: Record<string, string> = {
  books: "hash",
  positions: "bookHash",
  savedWords: "key",
  annotations: "key",
  activity: "id",
  reviews: "id",
  knowledge: "key",
  readingEvents: "id",
  bookOps: "id",
};

class FakeDb {
  stores = new Map<string, Map<unknown, unknown>>();
  closed = false;

  private storeFor(name: string) {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map();
      this.stores.set(name, store);
    }
    return store;
  }

  get(name: string, key: unknown) {
    return Promise.resolve(this.storeFor(name).get(key));
  }

  getAll(name: string) {
    return Promise.resolve([...this.storeFor(name).values()]);
  }

  getAllKeys(name: string) {
    return Promise.resolve([...this.storeFor(name).keys()]);
  }

  put(name: string, value: unknown, key?: unknown) {
    const k = key ?? (value as Record<string, unknown>)[KEY_PATHS[name]];
    this.storeFor(name).set(k, value);
    return Promise.resolve(k);
  }

  delete(name: string, key: unknown) {
    this.storeFor(name).delete(key);
    return Promise.resolve();
  }

  // Transacción simulada: las escrituras quedan en espera hasta
  // `done`; `abort` las descarta, como IDB real. Un valor con
  // `fail: true` rechaza el put — fuerza el fallo a mitad de lote.
  transaction() {
    const pending: (() => void)[] = [];
    let aborted = false;
    return {
      objectStore: (name: string) => ({
        get: (key: unknown) => this.get(name, key),
        put: (value: unknown, key?: unknown) => {
          if (aborted) return Promise.reject(new Error("tx abortada"));
          if ((value as { fail?: boolean } | null)?.fail === true)
            return Promise.reject(new Error("fallo simulado"));
          pending.push(() => {
            void this.put(name, value, key);
          });
          return Promise.resolve(
            key ?? (value as Record<string, unknown>)[KEY_PATHS[name]],
          );
        },
        delete: (key: unknown) => {
          pending.push(() => this.delete(name, key));
          return Promise.resolve();
        },
        clear: () => {
          pending.push(() => this.storeFor(name).clear());
          return Promise.resolve();
        },
      }),
      abort() {
        aborted = true;
        pending.length = 0;
      },
      get done() {
        if (!aborted) pending.forEach((run) => run());
        return Promise.resolve();
      },
    };
  }

  close() {
    this.closed = true;
  }
}

// Un «disco» de IndexedDB por nombre: sobrevive a los reseteos de
// módulo así como la base real sobrevive al cambio de sesión.
const disk = new Map<string, FakeDb>();
const dbFor = (name: string) => {
  let db = disk.get(name);
  if (!db) {
    db = new FakeDb();
    disk.set(name, db);
  }
  return db;
};

vi.mock("idb", () => ({
  openDB: vi.fn(async (name: string) => dbFor(name)),
}));

const freshIdb = async () => {
  vi.resetModules();
  return import("./idb");
};

const word = (form: string, over: Record<string, unknown> = {}) => ({
  key: `es:${form}`,
  form,
  language: "es",
  savedAt: 1,
  updatedAt: 1,
  ...over,
});

const kRow = (lemma: string, over: Record<string, unknown> = {}) => ({
  language: "es",
  lemma,
  known: true,
  source: "inferred",
  ...over,
});

beforeEach(() => {
  disk.clear();
});

describe("contexto de cuenta", () => {
  it("la generación sube en cada transición y los contextos viejos vencen", async () => {
    const idb = await freshIdb();
    const anon = idb.captureDbScope();
    expect(anon).toEqual({ userId: null, generation: 0 });
    expect(idb.isDbScopeActive(anon)).toBe(true);

    await idb.setDbUser("u1");
    const u1 = idb.captureDbScope();
    expect(u1).toEqual({ userId: "u1", generation: 1 });
    expect(idb.isDbScopeActive(anon)).toBe(false);
    expect(idb.isDbScopeActive(u1)).toBe(true);

    await idb.setDbUser("u2");
    // A→B→A no reviva un contexto viejo de la misma cuenta.
    await idb.setDbUser("u1");
    expect(idb.isDbScopeActive(u1)).toBe(false);
    expect(idb.captureDbScope()).toEqual({ userId: "u1", generation: 3 });
  });

  it("setDbUser serializa transiciones concurrentes", async () => {
    const idb = await freshIdb();
    await Promise.all([idb.setDbUser("u1"), idb.setDbUser("u2")]);
    expect(idb.getActiveUserId()).toBe("u2");
    expect(idb.captureDbScope().generation).toBe(2);
  });
});

describe("migración anónimo→cuenta", () => {
  it("traslada los datos y limpia el espacio anónimo", async () => {
    const idb = await freshIdb();
    await idb.putSavedWord(word("perenne"));
    await idb.saveBook({
      hash: "h1",
      name: "libro.epub",
      data: new Blob(),
      addedAt: 1,
    });
    await idb.saveSessionValue(
      "preparation:v1:h1:cap1",
      JSON.stringify({ updatedAt: 5, answers: {} }),
    );
    await idb.saveSessionValue("vocabLastSyncAt", "123");

    await idb.setDbUser("u1");

    const target = dbFor("lecta:u:u1");
    const anon = dbFor("lecta");
    expect(target.stores.get("savedWords")?.get("es:perenne")).toMatchObject({
      form: "perenne",
    });
    expect(target.stores.get("books")?.get("h1")).toMatchObject({ hash: "h1" });
    // La clave del ciclo del lector migra; los marcadores de sync no.
    expect(target.stores.get("session")?.has("preparation:v1:h1:cap1")).toBe(
      true,
    );
    expect(target.stores.get("session")?.has("vocabLastSyncAt")).toBe(false);
    // El anónimo quedó limpio: otra persona no recibe lo anterior.
    for (const store of anon.stores.values()) expect(store.size).toBe(0);
  });

  it("el borrador de calibración migra; el de la cuenta no se pisa", async () => {
    const draft = JSON.stringify({ v: 2, answers: { x: "known" }, step: 0 });
    const idb = await freshIdb();
    await idb.saveSessionValue("calibrationDraft", draft);
    await idb.setDbUser("u1");
    expect(
      dbFor("lecta:u:u1").stores.get("session")?.get("calibrationDraft"),
    ).toBe(draft);

    // La cuenta ya tiene su propio borrador: sin updatedAt en ambos,
    // el de la cuenta gana siempre — lo anónimo jamás lo pisa.
    const idb2 = await freshIdb();
    const accountDraft = JSON.stringify({ v: 2, answers: { y: "unknown" }, step: 1 });
    dbFor("lecta:u:u2").stores.set(
      "session",
      new Map([["calibrationDraft", accountDraft]]),
    );
    await idb2.saveSessionValue(
      "calibrationDraft",
      JSON.stringify({ v: 2, answers: { z: "known" }, step: 0 }),
    );
    await idb2.setDbUser("u2");
    expect(
      dbFor("lecta:u:u2").stores.get("session")?.get("calibrationDraft"),
    ).toBe(accountDraft);
  });

  it("la meta semanal migra y la de la cuenta con updatedAt mayor gana", async () => {
    const idb = await freshIdb();
    await idb.saveSessionValue(
      "readingGoal:v1",
      JSON.stringify({ version: 1, daysPerWeek: 3, updatedAt: 100 }),
    );
    await idb.setDbUser("u1");
    expect(
      dbFor("lecta:u:u1").stores.get("session")?.get("readingGoal:v1"),
    ).toContain('"daysPerWeek":3');

    // La cuenta ya tiene una meta más nueva: el arbitraje por
    // updatedAt conserva la suya, no la del invitado.
    const idb2 = await freshIdb();
    const accountGoal = JSON.stringify({
      version: 1,
      daysPerWeek: 5,
      updatedAt: 200,
    });
    dbFor("lecta:u:u2").stores.set(
      "session",
      new Map([["readingGoal:v1", accountGoal]]),
    );
    await idb2.saveSessionValue(
      "readingGoal:v1",
      JSON.stringify({ version: 1, daysPerWeek: 2, updatedAt: 50 }),
    );
    await idb2.setDbUser("u2");
    expect(
      dbFor("lecta:u:u2").stores.get("session")?.get("readingGoal:v1"),
    ).toBe(accountGoal);
  });

  it("el registro de exposición de Aprender migra con la cuenta", async () => {
    const idb = await freshIdb();
    const exposure = JSON.stringify({
      version: 1,
      seen: { "es:casa": { at: 1, verdict: "learn" } },
      updatedAt: 100,
    });
    await idb.saveSessionValue("learnExposure:v1", exposure);
    await idb.setDbUser("u1");
    expect(
      dbFor("lecta:u:u1").stores.get("session")?.get("learnExposure:v1"),
    ).toBe(exposure);
  });

  it("la fila de la cuenta con updatedAt mayor no se pisa con lo anónimo", async () => {
    // La cuenta ya tenía una versión más nueva de la misma palabra.
    dbFor("lecta:u:u1").stores.set(
      "savedWords",
      new Map([["es:perenne", word("perenne", { updatedAt: 50 })]]),
    );
    const idb = await freshIdb();
    await idb.putSavedWord(word("perenne", { updatedAt: 10 }));

    await idb.setDbUser("u1");

    expect(
      dbFor("lecta:u:u1").stores.get("savedWords")?.get("es:perenne"),
    ).toMatchObject({ updatedAt: 50 });
  });
});

describe("arbitraje convergente de conocimiento", () => {
  it("una inferencia con sello más nuevo no pisa una respuesta explícita", async () => {
    const idb = await freshIdb();
    await idb.saveKnowledge(
      kRow("perenne", { source: "declared", updatedAt: 100 }),
    );
    await idb.saveKnowledge(
      kRow("perenne", { source: "inferred", known: false, updatedAt: 200 }),
    );
    const row = (await idb.listAllKnowledge())[0];
    expect(row).toMatchObject({
      source: "declared",
      known: true,
      updatedAt: 100,
    });
  });

  it("una lápida explícita no se reviva con una inferencia posterior", async () => {
    const idb = await freshIdb();
    await idb.putKnowledge({
      key: "es:perenne",
      language: "es",
      lemma: "perenne",
      known: true,
      source: "declared",
      updatedAt: 300,
      deleted: true,
    });
    await idb.saveKnowledge(
      kRow("perenne", { source: "inferred", updatedAt: 400 }),
    );
    const row = (await idb.listAllKnowledge())[0];
    expect(row.deleted).toBe(true);
    expect(row.updatedAt).toBe(300);
  });

  it("una respuesta explícita posterior sí revive una lápida", async () => {
    const idb = await freshIdb();
    await idb.putKnowledge({
      key: "es:perenne",
      language: "es",
      lemma: "perenne",
      known: true,
      source: "inferred",
      updatedAt: 300,
      deleted: true,
    });
    await idb.saveKnowledge(
      kRow("perenne", { source: "declared", updatedAt: 400 }),
    );
    const row = (await idb.listAllKnowledge())[0];
    expect(row.deleted).toBeFalsy();
    expect(row.source).toBe("declared");
  });

  it("la escritura redundante (misma fuerza y veredicto) no mueve el sello", async () => {
    const idb = await freshIdb();
    await idb.saveKnowledge(
      kRow("perenne", { source: "declared", updatedAt: 100 }),
    );
    await idb.saveKnowledge(
      kRow("perenne", { source: "calibration", updatedAt: 200 }),
    );
    const row = (await idb.listAllKnowledge())[0];
    expect(row.updatedAt).toBe(100);
  });
});

describe("escrituras con contexto vencido", () => {
  it("una escritura anónima tardía aterriza en la cuenta heredera", async () => {
    const idb = await freshIdb();
    const staleAnon = idb.captureDbScope();
    await idb.setDbUser("u1");

    // El guardado empezó como invitado y termina ya dentro de sesión:
    // pertenece a la cuenta que absorbió lo anónimo, no al espacio
    // limpiado ni (peor) a otra base.
    await idb.putSavedWord(word("tardia"), staleAnon);

    expect(
      dbFor("lecta:u:u1").stores.get("savedWords")?.has("es:tardia"),
    ).toBe(true);
    expect(
      dbFor("lecta").stores.get("savedWords")?.has("es:tardia") ?? false,
    ).toBe(false);
  });

  it("una escritura de la cuenta A durante A→B aterriza en A, jamás en B", async () => {
    const idb = await freshIdb();
    await idb.setDbUser("u1");
    const scopeU1 = idb.captureDbScope();
    await idb.setDbUser("u2");

    await idb.putSavedWord(word("de-u1"), scopeU1);

    expect(
      dbFor("lecta:u:u1").stores.get("savedWords")?.has("es:de-u1"),
    ).toBe(true);
    expect(
      dbFor("lecta:u:u2").stores.get("savedWords")?.has("es:de-u1") ?? false,
    ).toBe(false);
  });
});

describe("aislamiento del juego", () => {
  it("un premio encolado bajo un contexto vencido no toca la cuenta nueva", async () => {
    const idb = await freshIdb();
    const game = await import("./game");
    await idb.setDbUser("u1");
    const scopeU1 = idb.captureDbScope();

    // El premio nace bajo u1; antes de que la cola lo escriba la
    // sesión ya es u2 — aborta sin aterrizar en ninguna base ajena.
    await idb.setDbUser("u2");
    await game.award({ kind: "read", ms: 60_000 }, scopeU1);

    expect(
      dbFor("lecta:u:u2").stores.get("session")?.has("gameState") ?? false,
    ).toBe(false);
    expect(
      dbFor("lecta:u:u1").stores.get("session")?.has("gameState") ?? false,
    ).toBe(false);
  });

  it("premios de cuentas distintas quedan en bases distintas", async () => {
    const idb = await freshIdb();
    const game = await import("./game");
    await idb.setDbUser("u1");
    await game.award({ kind: "read", ms: 60_000 }, idb.captureDbScope());

    await idb.setDbUser("u2");
    game.resetGameCache();
    await game.award({ kind: "read", ms: 120_000 }, idb.captureDbScope());

    const u1Raw = dbFor("lecta:u:u1").stores.get("session")?.get("gameState");
    const u2Raw = dbFor("lecta:u:u2").stores.get("session")?.get("gameState");
    expect(u1Raw).toBeTruthy();
    expect(u2Raw).toBeTruthy();
    // Estados separados: el XP de cada cuenta no se mezcla.
    const u1 = JSON.parse(u1Raw as string) as { xp: number };
    const u2 = JSON.parse(u2Raw as string) as { xp: number };
    expect(u1.xp).not.toBe(u2.xp);
  });
});

describe("palabras guardadas y tarjetas FSRS", () => {
  // Tarjeta repasada (state=Review): su historial jamás se reinicia
  // por un guardado repetido ni por restaurar su lápida.
  const card = {
    due: new Date("2025-01-02T00:00:00Z"),
    stability: 3.5,
    difficulty: 5.1,
    elapsed_days: 2,
    scheduled_days: 3,
    learning_steps: 0,
    reps: 4,
    lapses: 1,
    state: 2,
    last_review: new Date("2025-01-01T00:00:00Z"),
  };

  const knowledge = {
    language: "es",
    lemma: "perennir",
    known: false,
    source: "saved" as const,
  };

  it("restaurar una lápida repasada conserva tarjeta, savedAt y acepción", async () => {
    const idb = await freshIdb();
    const seed = dbFor("lecta");
    seed.stores.set(
      "savedWords",
      new Map([
        [
          "es:perenne",
          word("perenne", {
            deleted: true,
            savedAt: 5,
            updatedAt: 7,
            card,
            lemma: "perennir",
            pos: "verbo",
            meaning: "que dura",
            senseEntryId: "9",
            senseOrder: 2,
            context: "frase original",
            bookHash: "h1",
          }),
        ],
      ]),
    );

    const { word: restored } = await idb.saveWordWithKnowledge({
      word: {
        form: "perenne",
        language: "es",
        lemma: "perennir-otro",
        meaning: "significado nuevo",
        context: "otra frase",
        bookHash: "h2",
      },
      knowledge,
    });

    expect(restored.card).toEqual(card);
    expect(restored.savedAt).toBe(5);
    // Los campos ya guardados ganan; solo se rellenarían huecos.
    expect(restored.meaning).toBe("que dura");
    expect(restored.senseEntryId).toBe("9");
    expect(restored.senseOrder).toBe(2);
    expect(restored.context).toBe("frase original");
    expect(restored.bookHash).toBe("h1");
    expect(restored.deleted).toBeUndefined();
    expect(restored.updatedAt).toBeGreaterThan(7);
    // Lo persistido es exactamente lo devuelto.
    expect(
      seed.stores.get("savedWords")?.get("es:perenne"),
    ).toEqual(restored);
  });

  it("guardar una palabra activa no reinicia su tarjeta ni su fecha", async () => {
    const idb = await freshIdb();
    const seed = dbFor("lecta");
    const active = word("perenne", {
      savedAt: 5,
      updatedAt: 7,
      card,
      meaning: "que dura",
    });
    seed.stores.set("savedWords", new Map([["es:perenne", active]]));

    const { word: result } = await idb.saveWordWithKnowledge({
      word: { form: "perenne", language: "es", meaning: "otra cosa" },
      knowledge,
    });

    // La fila vigente se devuelve tal cual: nada se reescribe.
    expect(result).toEqual(active);
    expect(seed.stores.get("savedWords")?.get("es:perenne")).toEqual(active);
  });

  it("fillSavedWordMeaning rellena huecos sin tocar tarjeta ni fechas", async () => {
    const idb = await freshIdb();
    const seed = dbFor("lecta");
    seed.stores.set(
      "savedWords",
      new Map([
        ["es:vacia", word("vacia", { savedAt: 5, updatedAt: 9, card })],
      ]),
    );

    const filled = await idb.fillSavedWordMeaning(
      "es:vacia",
      9,
      {
        meaning: "definición del catálogo",
        lemma: "vacir",
        pos: "verbo",
        senseEntryId: "4",
        senseOrder: 1,
      },
      idb.captureDbScope(),
    );

    expect(filled?.meaning).toBe("definición del catálogo");
    expect(filled?.card).toEqual(card);
    expect(filled?.savedAt).toBe(5);
    expect(filled?.updatedAt).toBeGreaterThan(9);
    expect(seed.stores.get("savedWords")?.get("es:vacia")).toEqual(filled);
  });

  it("fillSavedWordMeaning no escribe si la fila cambió, se borró o ya tiene significado", async () => {
    const idb = await freshIdb();
    const seed = dbFor("lecta");
    const rows = new Map([
      // Un repaso durante la consulta cambia updatedAt: el sello
      // esperado ya no coincide y el relleno aborta.
      ["es:repasada", word("repasada", { updatedAt: 50, card })],
      ["es:lapsus", word("lapsus", { updatedAt: 9, deleted: true })],
      [
        "es:conmigo",
        word("conmigo", { updatedAt: 9, meaning: "ya la tiene" }),
      ],
    ]);
    seed.stores.set("savedWords", rows);
    const snapshot = structuredClone(Object.fromEntries(rows));

    const patch = {
      meaning: "definición",
      lemma: "lema",
      pos: "verbo",
      senseEntryId: "1",
      senseOrder: 1,
    };
    // Sello viejo (9) pero la fila ya está en 50.
    expect(
      await idb.fillSavedWordMeaning("es:repasada", 9, patch, idb.captureDbScope()),
    ).toBeNull();
    // Lápida: el relleno jamás la revive.
    expect(
      await idb.fillSavedWordMeaning("es:lapsus", 9, patch, idb.captureDbScope()),
    ).toBeNull();
    // Ya con significado: nada que rellenar.
    expect(
      await idb.fillSavedWordMeaning("es:conmigo", 9, patch, idb.captureDbScope()),
    ).toBeNull();
    // Fila inexistente.
    expect(
      await idb.fillSavedWordMeaning("es:noexiste", 9, patch, idb.captureDbScope()),
    ).toBeNull();

    // Ninguna fila cambió: ni sello ni contenido.
    expect(
      Object.fromEntries(seed.stores.get("savedWords")!),
    ).toEqual(snapshot);
  });
});

describe("saveCalibrationBatch", () => {
  const card = { reps: 2, stability: 30 } as never;

  it("escribe evidencia y restaura lápidas en una sola transacción", async () => {
    const idb = await freshIdb();
    const seed = dbFor("lecta");
    // Una lápida con repaso y una palabra activa que no debe tocarse.
    seed.stores.set(
      "savedWords",
      new Map([
        ["es:rara", word("rara", { deleted: true, card })],
        ["es:activa", word("activa", { updatedAt: 7 })],
      ]),
    );

    const out = await idb.saveCalibrationBatch(
      {
        knowledge: [
          { language: "es", lemma: "rara", known: false, source: "calibration" },
          { language: "es", lemma: "activa", known: false, source: "calibration" },
        ],
        words: [
          { form: "rara", lemma: "rara", language: "es", meaning: "poco común" },
          { form: "activa", lemma: "activa", language: "es" },
        ],
      },
      idb.captureDbScope(),
    );

    // La evidencia entró; la lápida se restauró conservando su tarjeta
    // y rellenando el significado; la activa no se reescribió.
    expect(out.knowledge).toHaveLength(2);
    expect(out.words).toHaveLength(1);
    const restored = seed.stores.get("savedWords")?.get("es:rara") as {
      deleted?: boolean;
      card?: unknown;
      meaning?: string;
    };
    expect(restored.deleted).toBeUndefined();
    expect(restored.card).toEqual(card);
    expect(restored.meaning).toBe("poco común");
    expect(
      seed.stores.get("savedWords")?.get("es:activa"),
    ).toMatchObject({ updatedAt: 7 });
    expect(seed.stores.get("knowledge")?.get("es:rara")).toMatchObject({
      known: false,
      source: "calibration",
    });
  });

  it("un fallo a mitad no deja media ronda", async () => {
    const idb = await freshIdb();
    const seed = dbFor("lecta");
    await expect(
      idb.saveCalibrationBatch(
        {
          knowledge: [
            { language: "es", lemma: "x", known: true, source: "calibration" },
          ],
          // El segundo put de la transacción falla: lo ya encolado de
          // knowledge no puede quedar confirmado.
          words: [
            { form: "boom", language: "es", fail: true } as never,
          ],
        },
        idb.captureDbScope(),
      ),
    ).rejects.toThrow("fallo simulado");

    expect(seed.stores.get("knowledge")?.size ?? 0).toBe(0);
    expect(seed.stores.get("savedWords")?.size ?? 0).toBe(0);
  });
});

describe("accountFetch", () => {
  it("aborta con StaleScopeError antes de tocar la red", async () => {
    const idb = await freshIdb();
    const { accountFetch } = await import("./account-fetch");
    const scope = idb.captureDbScope();
    await idb.setDbUser("u1");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(accountFetch("/api/x", {}, scope)).rejects.toBeInstanceOf(
      idb.StaleScopeError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("declara la identidad esperada con x-lecta-user-id", async () => {
    const idb = await freshIdb();
    const { accountFetch } = await import("./account-fetch");
    await idb.setDbUser("u1");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await accountFetch("/api/x", {}, idb.captureDbScope());
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("x-lecta-user-id")).toBe("u1");
    vi.unstubAllGlobals();
  });
});
