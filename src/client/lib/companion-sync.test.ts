// Pruebas del sync del compañero: dos réplicas que convergen, el
// reenvío idempotente, el sello de confirmados, la reconciliación de
// créditos y el aislamiento por cuenta. IndexedDB se simula con un
// Map por base (mismo FakeDb que game.test.ts) y el servidor es una
// réplica en memoria del endpoint — mismas reglas de merge que el
// worker real, sin red ni SQL.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type * as IdbModule from "./idb";
import type * as SyncModule from "./companion-sync";
import type * as GameModule from "./game";
import {
  mergeCompanionRegister,
  projectGame,
  validateCompanionBatch,
  type CompanionRegister,
  type CompanionReceipt,
  type CompanionSnapshot,
  type GameJournalEvent,
  type LegacyGameBaseline,
} from "../../shared/companion-data";
import type { GameEvent } from "../../shared/gamification";

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
  companionEvents: "id",
  companionReceipts: "id",
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

  transaction() {
    const pending: (() => void)[] = [];
    let aborted = false;
    return {
      objectStore: (name: string) => ({
        get: (key: unknown) => this.get(name, key),
        getAll: () => this.getAll(name),
        getAllKeys: () => this.getAllKeys(name),
        put: (value: unknown, key?: unknown) => {
          if (aborted) return Promise.reject(new Error("tx abortada"));
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

// ---------- Servidor falso: la réplica del endpoint ----------

type ServerDb = {
  baselines: Map<string, LegacyGameBaseline>;
  events: Map<string, GameJournalEvent>;
  fields: Map<string, CompanionRegister>;
  receipts: Map<string, number>;
};

const newServerDb = (): ServerDb => ({
  baselines: new Map(),
  events: new Map(),
  fields: new Map(),
  receipts: new Map(),
});

const servers = new Map<string, ServerDb>();
const serverFor = (userId: string) => {
  let db = servers.get(userId);
  if (!db) {
    db = newServerDb();
    servers.set(userId, db);
  }
  return db;
};

// Igualdad semántica estilo jsonb (orden de propiedades no cuenta).
const canon = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object" && v !== null)
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Lo que se aplicó en el servidor simulando la transacción del PUT:
// validación, conflicto por id con payload distinto, merges por
// regla (baseline/evento anexable, campo LWW, recepción mínima) y la
// respuesta de confirmados.
function handlePut(db: ServerDb, body: unknown): Response {
  const validated = validateCompanionBatch(body);
  if (!validated.ok)
    return json(400, { error: "lote inválido", reason: validated.reason });
  const batch = validated.batch;

  const conflicts: string[] = [];
  for (const b of batch.baselines) {
    const stored = db.baselines.get(b.originId);
    if (stored && canon(stored) !== canon(b)) conflicts.push(b.originId);
  }
  for (const e of batch.events) {
    const stored = db.events.get(e.id);
    if (stored && canon(stored) !== canon(e)) conflicts.push(e.id);
  }
  if (conflicts.length)
    return json(409, { error: "conflicto", conflicts });

  for (const b of batch.baselines)
    if (!db.baselines.has(b.originId)) db.baselines.set(b.originId, b);
  for (const e of batch.events)
    if (!db.events.has(e.id)) db.events.set(e.id, e);
  const winners = new Map<string, CompanionRegister>();
  for (const f of batch.fields) {
    const cur = winners.get(f.field);
    if (
      !cur ||
      f.updatedAt > cur.updatedAt ||
      (f.updatedAt === cur.updatedAt && f.operationId > cur.operationId)
    )
      winners.set(f.field, f);
  }
  for (const f of winners.values()) {
    const cur = db.fields.get(f.field);
    if (
      !cur ||
      f.updatedAt > cur.updatedAt ||
      (f.updatedAt === cur.updatedAt && f.operationId > cur.operationId)
    )
      db.fields.set(f.field, f);
  }
  for (const r of batch.receipts)
    db.receipts.set(r.id, Math.min(db.receipts.get(r.id) ?? Infinity, r.at));

  return json(200, {
    ok: true,
    accepted: {
      baselines: [...new Set(batch.baselines.map((b) => b.originId))],
      events: [...new Set(batch.events.map((e) => e.id))],
      fields: [...new Set(batch.fields.map((f) => f.operationId))],
      receipts: [...new Set(batch.receipts.map((r) => r.id))],
    },
  });
}

function handleGet(db: ServerDb, url: URL): Response {
  const kind = url.searchParams.get("kind");
  const after = url.searchParams.get("after");
  const asc = <T>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);
  let items: unknown[];
  let keyOf: (item: never) => string;
  switch (kind) {
    case "baselines":
      items = [...db.baselines.values()]
        .filter((b) => after === null || b.originId > after)
        .sort((a, b) => asc(a.originId, b.originId));
      keyOf = (b: LegacyGameBaseline) => b.originId;
      break;
    case "events":
      items = [...db.events.values()]
        .filter((e) => after === null || e.id > after)
        .sort((a, b) => asc(a.id, b.id));
      keyOf = (e: GameJournalEvent) => e.id;
      break;
    case "fields":
      items = [...db.fields.values()]
        .filter((f) => after === null || f.field > after)
        .sort((a, b) => asc(a.field, b.field));
      keyOf = (f: CompanionRegister) => f.field;
      break;
    case "receipts":
      items = [...db.receipts]
        .filter(([id]) => after === null || id > after)
        .sort(([a], [b]) => asc(a, b))
        .map(([id, at]) => ({ id, at }));
      keyOf = (r: { id: string }) => r.id;
      break;
    default:
      return json(400, { error: "kind inválido" });
  }
  const page = items.slice(0, 120);
  const nextCursor =
    items.length > 120 ? keyOf(page[page.length - 1] as never) : null;
  return json(200, { items: page, nextCursor });
}

type Req = {
  method: string;
  url: URL;
  body: unknown;
  user: string | null;
};

// Punto de inyección por prueba: devolver una Response (o promesa)
// suplanta al servidor; null deja pasar al manejador normal.
let requestHook: ((req: Req) => Response | Promise<Response> | null) | null =
  null;
const requestLog: { method: string; url: string; body: unknown }[] = [];

const fetchImpl = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url = new URL(String(input), "https://lecta.test");
  const headers =
    init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
  const user = headers.get("x-lecta-user-id");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  requestLog.push({ method, url: `${url.pathname}${url.search}`, body });
  if (requestHook) {
    const res = await requestHook({ method, url, body, user });
    if (res) return res;
  }
  if (!user) return json(401, { error: "sin sesión" });
  const db = serverFor(user);
  if (method === "PUT") return handlePut(db, body);
  return handleGet(db, url);
};

// ---------- Datos de prueba ----------

const baseline = (originId: string, xp = 0): LegacyGameBaseline => ({
  version: 1,
  originId,
  state: {
    version: 1,
    xp,
    stats: {
      minutes: xp,
      longestSessionMin: 0,
      consulted: 0,
      saved: 0,
      rareSaved: 0,
      reviews: 0,
      booksFinished: 0,
      streakDays: 0,
      lastDayKey: null,
    },
    achievements: {},
    chests: [],
    finishedBooks: [],
    caredAt: 0,
  },
});

const ev = (
  id: string,
  at = 100,
  event: GameEvent = { kind: "consulted" },
): GameJournalEvent => ({
  version: 1,
  id,
  at,
  dayKey: "2025-06-10",
  streakBonus: false,
  event,
});

const savedEv = (id: string, at = 100): GameJournalEvent =>
  ev(id, at, { kind: "saved", zipf: null });

const reg = (
  field: string,
  value: unknown,
  updatedAt: number,
  operationId: string,
): CompanionRegister => ({
  field: field as CompanionRegister["field"],
  value,
  updatedAt,
  operationId,
});

const norm = (s: CompanionSnapshot) => ({
  baselines: [...s.baselines].sort((a, b) => (a.originId < b.originId ? -1 : 1)),
  events: [...s.events].sort((a, b) => (a.id < b.id ? -1 : 1)),
  registers: mergeCompanionRegister(s.registers),
  receipts: [...s.receipts].sort((a, b) => (a.id < b.id ? -1 : 1)),
});

type Modules = {
  idb: typeof IdbModule;
  sync: typeof SyncModule;
  game: typeof GameModule;
};

const freshModules = async (): Promise<Modules> => {
  vi.resetModules();
  const idb = await import("./idb");
  const sync = await import("./companion-sync");
  const game = await import("./game");
  return { idb, sync, game };
};

// «Monta» una base como la activa de la cuenta: cambia qué FakeDb
// responde al nombre y fuerza la transición — así dos dispositivos
// de la misma cuenta tienen discos separados.
const mount = async (
  idb: Modules["idb"],
  db: FakeDb,
  userId = "u1",
): Promise<Modules["idb"] extends never ? never : IdbModule.DbScope> => {
  disk.set(`lecta:u:${userId}`, db);
  await idb.setDbUser(null);
  await idb.setDbUser(userId);
  return idb.captureDbScope() as never;
};

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  disk.clear();
  servers.clear();
  requestLog.length = 0;
  requestHook = null;
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("convergencia entre réplicas", () => {
  it("dos dispositivos con acciones independientes convergen al mismo snapshot", async () => {
    const { idb, sync, game } = await freshModules();
    const devA = new FakeDb();
    const devB = new FakeDb();

    const scopeA = await mount(idb, devA);
    await idb.putCompanionBaseline(baseline("devA", 40), scopeA);
    await idb.appendCompanionEvents([savedEv("a-save", 50)], scopeA);
    await idb.putCompanionRegisters(
      [reg("name", "Ana", 100, "a-op")],
      scopeA,
    );
    await idb.mergeCompanionReceipts(
      [{ id: "stage-seen:1", at: 10 }],
      scopeA,
    );
    const first = await sync.syncCompanion(scopeA);
    expect(first).not.toBeNull();
    expect(first?.pending).toBe(0);

    const scopeB = await mount(idb, devB);
    await idb.putCompanionBaseline(baseline("devB", 80), scopeB);
    await idb.appendCompanionEvents([savedEv("b-save", 60)], scopeB);
    await idb.putCompanionRegisters(
      [reg("name", "Beto", 200, "b-op")],
      scopeB,
    );
    expect(await sync.syncCompanion(scopeB)).not.toBeNull();

    const scopeA2 = await mount(idb, devA);
    expect(await sync.syncCompanion(scopeA2)).not.toBeNull();
    const snapA = await game.loadGameSnapshot(scopeA2);

    const scopeB2 = await mount(idb, devB);
    const snapB = await game.loadGameSnapshot(scopeB2);

    expect(norm(snapA)).toEqual(norm(snapB));
    expect(projectGame(snapA).state).toEqual(projectGame(snapB).state);
    // Las dos colecciones de identidad se unieron en ambas réplicas.
    expect(snapA.events.map((e) => e.id).sort()).toEqual([
      "a-save",
      "b-save",
    ]);
    expect(snapA.baselines.map((b) => b.originId).sort()).toEqual([
      "devA",
      "devB",
    ]);
    // El registro con sello mayor ganó en las dos.
    expect(
      mergeCompanionRegister(snapA.registers).find((r) => r.field === "name")
        ?.value,
    ).toBe("Beto");
  });
});

describe("empuje de pendientes", () => {
  it("un lote aplicado en el servidor pero perdido en camino se reenvía idempotente", async () => {
    const { idb, sync } = await freshModules();
    const scope = await mount(idb, new FakeDb());
    await idb.appendCompanionEvents([ev("e1")], scope);

    let lost = true;
    requestHook = (req) => {
      if (req.method === "PUT" && lost) {
        lost = false;
        // El servidor SÍ aplicó el lote; el cliente solo ve el 500.
        handlePut(serverFor("u1"), req.body);
        return new Response("perdida", { status: 500 });
      }
      return null;
    };

    expect(await sync.syncCompanion(scope)).toBeNull();
    expect(serverFor("u1").events.has("e1")).toBe(true);
    expect((await idb.readCompanionAcked(scope)).events).not.toContain("e1");

    expect(await sync.syncCompanion(scope)).not.toBeNull();
    // Reenvío aceptado sin duplicar y ya confirmado.
    expect(
      [...serverFor("u1").events.values()].filter((e) => e.id === "e1"),
    ).toHaveLength(1);
    expect((await idb.readCompanionAcked(scope)).events).toContain("e1");
  });

  it("confirmar un operationId no marca como hecha la edición posterior del mismo campo", async () => {
    const { idb, sync } = await freshModules();
    const scope = await mount(idb, new FakeDb());
    await idb.putCompanionRegisters(
      [reg("name", "Ana", 100, "op1")],
      scope,
    );
    expect(await sync.syncCompanion(scope)).not.toBeNull();
    expect((await idb.readCompanionAcked(scope)).fields).toContain("op1");

    // Edición posterior: mismo campo, otro sello y otro operationId.
    await idb.putCompanionRegisters(
      [reg("name", "Beto", 200, "op2")],
      scope,
    );
    expect(await sync.syncCompanion(scope)).not.toBeNull();
    const stored = serverFor("u1").fields.get("name")!;
    expect(stored.value).toBe("Beto");
    expect(stored.operationId).toBe("op2");
    const acked = await idb.readCompanionAcked(scope);
    expect(acked.fields).toEqual(expect.arrayContaining(["op1", "op2"]));
  });

  it("un lote rechazado deja los pendientes intactos", async () => {
    const { idb, sync } = await freshModules();
    const scope = await mount(idb, new FakeDb());
    await idb.appendCompanionEvents([ev("e1")], scope);
    requestHook = (req) =>
      req.method === "PUT"
        ? json(409, { error: "conflicto", conflicts: ["e1"] })
        : null;

    expect(await sync.syncCompanion(scope)).toBeNull();
    expect((await idb.readCompanionAcked(scope)).events).toEqual([]);
    expect(serverFor("u1").events.has("e1")).toBe(false);

    requestHook = null;
    expect(await sync.syncCompanion(scope)).not.toBeNull();
    expect(serverFor("u1").events.has("e1")).toBe(true);
  });

  it("una página que falla deja los pendientes sin confirmar", async () => {
    const { idb, sync } = await freshModules();
    const scope = await mount(idb, new FakeDb());
    await idb.appendCompanionEvents([ev("local-e")], scope);
    serverFor("u1").events.set("remote-e", ev("remote-e", 5));
    requestHook = (req) =>
      req.method === "GET" && req.url.searchParams.get("kind") === "receipts"
        ? new Response("roto", { status: 500 })
        : null;

    expect(await sync.syncCompanion(scope)).toBeNull();
    // Lo remoto ya entró al disco local, pero nada quedó confirmado
    // ni enviado: el ciclo no terminó.
    expect(
      (await idb.listCompanionEvents(scope)).map((e) => e.id).sort(),
    ).toEqual(["local-e", "remote-e"]);
    const acked = await idb.readCompanionAcked(scope);
    expect(acked.events).toEqual([]);
    expect(serverFor("u1").events.has("local-e")).toBe(false);

    requestHook = null;
    expect(await sync.syncCompanion(scope)).not.toBeNull();
    expect(serverFor("u1").events.has("local-e")).toBe(true);
  });
});

describe("bajada (pull)", () => {
  it("una fila remota insertada «antes» del cursor llega en el siguiente barrido", async () => {
    const { idb, sync } = await freshModules();
    const scope = await mount(idb, new FakeDb());
    serverFor("u1").receipts.set("stage-seen:3", 30);

    expect(await sync.syncCompanion(scope)).not.toBeNull();
    expect(await idb.listCompanionReceipts(scope)).toEqual([
      { id: "stage-seen:3", at: 30 },
    ]);

    // Clave que ordena antes de la página ya vista: el barrido es
    // completo, no incremental, así que igual llega.
    serverFor("u1").receipts.set("achievement-seen:libro_1", 5);
    expect(await sync.syncCompanion(scope)).not.toBeNull();
    expect(
      (await idb.listCompanionReceipts(scope)).map((r) => r.id).sort(),
    ).toEqual(["achievement-seen:libro_1", "stage-seen:3"]);
  });

  it("lo bajado no se reenvía al servidor", async () => {
    const { idb, sync } = await freshModules();
    const scope = await mount(idb, new FakeDb());
    serverFor("u1").events.set("r1", ev("r1"));
    serverFor("u1").receipts.set("stage-seen:2", 20);

    const result = await sync.syncCompanion(scope);
    expect(result).not.toBeNull();
    expect(result?.pulled).toBe(2);
    // El pull jamás emite actividad: el journal local es exactamente
    // lo que llegó, sin premios ni recepciones inventadas.
    expect((await idb.listCompanionEvents(scope)).map((e) => e.id)).toEqual([
      "r1",
    ]);
    expect(await idb.listCompanionReceipts(scope)).toEqual([
      { id: "stage-seen:2", at: 20 },
    ]);
    // Ningún PUT salió: todo lo local ya estaba confirmado.
    expect(requestLog.filter((r) => r.method === "PUT")).toHaveLength(0);
  });
});

describe("recepciones de logro (reconcile)", () => {
  it("los créditos se escriben una sola vez con el sello del evento que los desbloquea", async () => {
    const { idb, sync } = await freshModules();
    const scope = await mount(idb, new FakeDb());
    // Dos eventos «saved»: el logro se alcanza con el más antiguo.
    await idb.appendCompanionEvents(
      [savedEv("s1", 100), savedEv("s2", 50)],
      scope,
    );

    expect(await sync.syncCompanion(scope)).not.toBeNull();
    const expected: CompanionReceipt[] = [
      { id: "achievement-credit:palabra_1", at: 50 },
    ];
    expect(await idb.listCompanionReceipts(scope)).toEqual(expected);
    expect([...serverFor("u1").receipts.entries()]).toEqual([
      ["achievement-credit:palabra_1", 50],
    ]);

    // Segunda pasada: ni duplica ni reescribe la recepción — y sin
    // pendientes no sale ni un PUT.
    requestLog.length = 0;
    expect(await sync.syncCompanion(scope)).not.toBeNull();
    expect(await idb.listCompanionReceipts(scope)).toEqual(expected);
    expect(requestLog.filter((r) => r.method === "PUT")).toHaveLength(0);
  });
});

describe("aislamiento por cuenta y ciclo en vuelo", () => {
  it("un cambio de cuenta a mitad del ciclo no publica en la cuenta nueva", async () => {
    const { idb, sync } = await freshModules();
    const scopeU1 = await mount(idb, new FakeDb(), "u1");
    await idb.appendCompanionEvents([ev("e1")], scopeU1);
    serverFor("u1").events.set("r1", ev("r1"));

    let release: (() => void) | null = null;
    requestHook = (req) => {
      if (
        !release &&
        req.method === "GET" &&
        req.url.searchParams.get("kind") === "baselines"
      ) {
        return new Promise<Response>((resolve) => {
          release = () => resolve(handleGet(serverFor("u1"), req.url));
        });
      }
      return null;
    };

    const pending = sync.syncCompanion(scopeU1);
    await tick();
    // La cuenta cambia con el primer fetch en vuelo.
    await idb.setDbUser("u2");
    const scopeU2 = idb.captureDbScope();
    release!();
    expect(await pending).toBeNull();

    // La cuenta nueva no recibió escrituras ni sellos del ciclo viejo.
    expect(await idb.listCompanionEvents(scopeU2)).toEqual([]);
    expect(await idb.listCompanionReceipts(scopeU2)).toEqual([]);
    const acked = await idb.readCompanionAcked(scopeU2);
    expect(acked).toEqual({
      baselines: [],
      events: [],
      fields: [],
      receipts: [],
    });
    expect(serverFor("u2").events.size).toBe(0);
  });

  it("llamadas concurrentes comparten el ciclo en vuelo y piden la repasada", async () => {
    const { idb, sync } = await freshModules();
    const scope = await mount(idb, new FakeDb());
    await idb.appendCompanionEvents([ev("e1")], scope);

    const first = sync.syncCompanion(scope);
    const second = sync.syncCompanion(scope);
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    // La segunda llamada marcó repasada: el barrido inicial de
    // baselines corrió dos veces, una por ciclo, nunca en paralelo.
    const baselineGets = requestLog.filter(
      (r) => r.method === "GET" && r.url.includes("kind=baselines"),
    );
    expect(baselineGets).toHaveLength(2);
    expect(serverFor("u1").events.has("e1")).toBe(true);
  });
});

describe("aviso al juego tras el pull", () => {
  it("los datos que bajan reproyectan los puntos y avisan a la UI", async () => {
    const { idb, sync, game } = await freshModules();
    const scope = await mount(idb, new FakeDb());
    // Lo que subió el otro dispositivo ya está en el servidor.
    serverFor("u1").events.set("de-otro", savedEv("de-otro", 100));

    const notified: number[] = [];
    game.subscribeGame(() => notified.push(1));
    // La primera lectura llena la caché con el estado vacío (0 puntos).
    expect((await game.loadGame(scope)).xp).toBe(0);

    const result = await sync.syncCompanion(scope);
    expect(result?.pulled).toBe(1);
    // El aviso llegó y la caché quedó suelta: la siguiente lectura
    // reproyecta con lo bajado — sin recargar ni esperar un commit.
    expect(notified).toHaveLength(1);
    expect((await game.loadGame(scope)).xp).toBeGreaterThan(0);
  });

  it("un pull sin novedades no vuelve a avisar", async () => {
    const { idb, sync, game } = await freshModules();
    const scope = await mount(idb, new FakeDb());
    serverFor("u1").events.set("de-otro", savedEv("de-otro", 100));

    const notified: number[] = [];
    game.subscribeGame(() => notified.push(1));
    expect(await sync.syncCompanion(scope)).not.toBeNull();
    expect(notified).toHaveLength(1);

    // Mismo servidor, mismo barrido: los ítems llegan otra vez pero
    // ya se tenían — avisar por ellos re-dispararía el planificador.
    expect(await sync.syncCompanion(scope)).not.toBeNull();
    expect(notified).toHaveLength(1);
  });

  it("el aviso del propio ciclo no programa un envío extra", async () => {
    vi.useFakeTimers();
    try {
      const { idb, sync, game } = await freshModules();
      const scope = await mount(idb, new FakeDb());
      serverFor("u1").events.set("de-otro", savedEv("de-otro", 100));
      game.subscribeGame(() => undefined);

      expect(await sync.syncCompanion(scope)).not.toBeNull();
      requestLog.length = 0;
      // Si el notify interno hubiera programado un flush, a los 2 s
      // saldría otro ciclo con sus cuatro GETs.
      await vi.advanceTimersByTimeAsync(60_000);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(requestLog).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un ciclo que vence a mitad del pull no avisa a la cuenta activa", async () => {
    const { idb, sync, game } = await freshModules();
    const scopeU1 = await mount(idb, new FakeDb(), "u1");
    serverFor("u1").events.set("r1", ev("r1"));

    let release: (() => void) | null = null;
    requestHook = (req) => {
      if (
        !release &&
        req.method === "GET" &&
        req.url.searchParams.get("kind") === "events"
      ) {
        return new Promise<Response>((resolve) => {
          release = () => resolve(handleGet(serverFor("u1"), req.url));
        });
      }
      return null;
    };

    const notified: number[] = [];
    game.subscribeGame(() => notified.push(1));
    const pending = sync.syncCompanion(scopeU1);
    await tick();
    // La cuenta cambia con el GET de events en vuelo.
    await idb.setDbUser("u2");
    release!();
    expect(await pending).toBeNull();
    expect(notified).toHaveLength(0);
  });
});
