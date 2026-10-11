import { beforeEach, describe, expect, it, vi } from "vitest";

// Pruebas del endpoint del compañero con un cliente pg falso: las
// cuatro tablas viven en Maps por (user_id, clave) y la «transacción»
// es una fotografía que ROLLBACK restaura. Lo que importa es el
// contrato HTTP y qué llega a la base — nunca una base real.
const h = vi.hoisted(() => {
  type QueryFn = (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  const query: QueryFn = async () => ({ rows: [], rowCount: 0 });
  return {
    session: { user: { id: "u1" } } as { user: { id: string } } | null,
    conn: "postgres://lecta:test@localhost/lecta_dev" as string | undefined,
    query,
  };
});

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getConnectionString: () => h.conn,
    withClient: async (
      _env: unknown,
      run: (client: { query: typeof h.query }) => Promise<unknown>,
    ) => run({ query: h.query }),
  };
});

vi.mock("./session", () => ({
  getSession: () => Promise.resolve(h.session),
}));

import { companion } from "./companion";

// ---------- Base falsa ----------

type FieldRow = {
  field: string;
  value: unknown;
  updated_at: string;
  operation_id: string;
};

const db = {
  baselines: new Map<string, unknown>(),
  events: new Map<string, unknown>(),
  fields: new Map<string, FieldRow>(),
  receipts: new Map<string, string>(),
};

const cloneDb = () => ({
  baselines: new Map(db.baselines),
  events: new Map(db.events),
  fields: new Map(db.fields),
  receipts: new Map(db.receipts),
});

// Igualdad semántica como la de jsonb en Postgres: el orden de las
// propiedades no cuenta para comparar payloads.
const canon = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object" && v !== null)
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
};

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };
const ok = (rows: Record<string, unknown>[] = []): QueryResult => ({
  rows,
  rowCount: rows.length,
});

let txSnapshot: ReturnType<typeof cloneDb> | null = null;
// Fallos programados: {match, error} — el primero cuya regexp toca el
// SQL lanza el error y se consume.
let failPlan: { match: RegExp; error: Error & { code?: string } }[] = [];
const queryLog: string[] = [];

const keyOf = (userId: string, id: string) => `${userId}${id}`;

// Simula el SQL del endpoint contra los Maps. No intenta ser Postgres:
// cubre justo las declaraciones que companion.ts emite.
async function fakeQuery(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult> {
  queryLog.push(sql);
  const planned = failPlan[0];
  if (planned && planned.match.test(sql)) {
    failPlan.shift();
    throw planned.error;
  }
  if (sql === "BEGIN") {
    txSnapshot = cloneDb();
    return ok();
  }
  if (sql === "COMMIT") {
    txSnapshot = null;
    return ok();
  }
  if (sql === "ROLLBACK") {
    if (txSnapshot) {
      db.baselines = txSnapshot.baselines;
      db.events = txSnapshot.events;
      db.fields = txSnapshot.fields;
      db.receipts = txSnapshot.receipts;
    }
    txSnapshot = null;
    return ok();
  }

  const userId = params[0] as string;
  // Los lotes llevan el jsonb de ítems en params[1]; las páginas GET
  // llevan el cursor — solo se parsea donde toca.
  const incoming = () => JSON.parse(params[1] as string) as never[];

  if (sql.includes("COUNT(DISTINCT")) {
    const isBaseline = sql.includes("origin_id");
    const table = isBaseline ? db.baselines : db.events;
    const keyFor = (item: { originId?: string; id?: string }) =>
      isBaseline ? item.originId! : item.id!;
    const conflicts = new Set<string>();
    const sigs = new Map<string, Set<string>>();
    for (const item of incoming() as { originId?: string; id?: string }[]) {
      const key = keyFor(item);
      const sig = canon(item);
      const set = sigs.get(key) ?? new Set<string>();
      set.add(sig);
      sigs.set(key, set);
      const stored = table.get(keyOf(userId, key));
      if (stored !== undefined && canon(stored) !== sig) conflicts.add(key);
    }
    for (const [key, set] of sigs) if (set.size > 1) conflicts.add(key);
    return ok([...conflicts].map((key) => ({ key })));
  }

  if (sql.startsWith("INSERT INTO lecta_user_companion_baselines")) {
    for (const item of incoming() as { originId: string }[]) {
      const key = keyOf(userId, item.originId);
      if (!db.baselines.has(key)) db.baselines.set(key, item);
    }
    return ok();
  }

  if (sql.startsWith("INSERT INTO lecta_user_companion_events")) {
    for (const item of incoming() as { id: string }[]) {
      const key = keyOf(userId, item.id);
      if (!db.events.has(key)) db.events.set(key, item);
    }
    return ok();
  }

  if (sql.startsWith("INSERT INTO lecta_user_companion_fields")) {
    const fields = incoming() as {
      field: string;
      value: unknown;
      updatedAt: number;
      operationId: string;
    }[];
    const winners = new Map<string, (typeof fields)[number]>();
    for (const f of fields) {
      const cur = winners.get(f.field);
      if (
        !cur ||
        f.updatedAt > cur.updatedAt ||
        (f.updatedAt === cur.updatedAt && f.operationId > cur.operationId)
      )
        winners.set(f.field, f);
    }
    for (const f of winners.values()) {
      const key = keyOf(userId, f.field);
      const cur = db.fields.get(key);
      if (
        !cur ||
        f.updatedAt > Number(cur.updated_at) ||
        (f.updatedAt === Number(cur.updated_at) &&
          f.operationId > cur.operation_id)
      )
        db.fields.set(key, {
          field: f.field,
          value: f.value,
          updated_at: String(f.updatedAt),
          operation_id: f.operationId,
        });
    }
    return ok();
  }

  if (sql.startsWith("INSERT INTO lecta_user_companion_receipts")) {
    const mins = new Map<string, number>();
    for (const r of incoming() as { id: string; at: number }[])
      mins.set(r.id, Math.min(mins.get(r.id) ?? Infinity, r.at));
    for (const [id, at] of mins) {
      const key = keyOf(userId, id);
      const cur = db.receipts.get(key);
      if (cur === undefined || at < Number(cur))
        db.receipts.set(key, String(at));
    }
    return ok();
  }

  // GET paginado por clave: user_id + clave > after, orden y límite 121.
  if (sql.trimStart().startsWith("SELECT")) {
    const after = params[1] as string | null;
    const prefix = `${userId}`;
    if (sql.includes("FROM lecta_user_companion_baselines")) {
      const rows = [...db.baselines]
        .filter(
          ([k]) =>
            k.startsWith(prefix) &&
            (after === null || k.slice(prefix.length) > after),
        )
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, 121)
        .map(([, payload]) => ({ payload }));
      return ok(rows);
    }
    if (sql.includes("FROM lecta_user_companion_events")) {
      const rows = [...db.events]
        .filter(
          ([k]) =>
            k.startsWith(prefix) &&
            (after === null || k.slice(prefix.length) > after),
        )
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, 121)
        .map(([, payload]) => ({ payload }));
      return ok(rows);
    }
    if (sql.includes("FROM lecta_user_companion_fields")) {
      const rows = [...db.fields]
        .filter(
          ([k]) =>
            k.startsWith(prefix) &&
            (after === null || k.slice(prefix.length) > after),
        )
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, 121)
        .map(([, row]) => ({
          field: row.field,
          value: row.value,
          updatedAt: row.updated_at,
          operationId: row.operation_id,
        }));
      return ok(rows);
    }
    if (sql.includes("FROM lecta_user_companion_receipts")) {
      const rows = [...db.receipts]
        .filter(
          ([k]) =>
            k.startsWith(prefix) &&
            (after === null || k.slice(prefix.length) > after),
        )
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, 121)
        .map(([k, at]) => ({ id: k.slice(prefix.length), at }));
      return ok(rows);
    }
  }
  throw new Error(`SQL no simulada: ${sql}`);
}

// ---------- Datos de prueba ----------

const state = (xp = 0) => ({
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
});

const baseline = (originId: string, xp = 0) => ({
  version: 1,
  originId,
  state: state(xp),
});

const event = (id: string, at = 1_000) => ({
  version: 1,
  id,
  at,
  dayKey: "2025-06-10",
  streakBonus: false,
  event: { kind: "consulted" },
});

const field = (
  name: string,
  value: unknown,
  updatedAt: number,
  operationId: string,
) => ({ field: name, value, updatedAt, operationId });

const putBatch = (body: unknown) =>
  companion.request("/api/companion", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const batch = (over: Record<string, unknown> = {}) => ({
  version: 1,
  baselines: [],
  events: [],
  fields: [],
  receipts: [],
  ...over,
});

const getKind = (kind: string, after?: string) =>
  companion.request(
    `/api/companion?kind=${kind}` +
      (after !== undefined ? `&after=${encodeURIComponent(after)}` : ""),
  );

beforeEach(() => {
  db.baselines = new Map();
  db.events = new Map();
  db.fields = new Map();
  db.receipts = new Map();
  txSnapshot = null;
  failPlan = [];
  queryLog.length = 0;
  h.session = { user: { id: "u1" } };
  h.conn = "postgres://lecta:test@localhost/lecta_dev";
  h.query = fakeQuery;
});

describe("PUT /api/companion — guardas", () => {
  it("503 sin almacenamiento configurado", async () => {
    h.conn = undefined;
    const response = await putBatch(batch());
    expect(response.status).toBe(503);
  });

  it("401 sin sesión", async () => {
    h.session = null;
    const response = await putBatch(batch({ events: [event("e1")] }));
    expect(response.status).toBe(401);
  });

  it("400 con lote inválido antes de tocar la base", async () => {
    const response = await putBatch({ version: 2 });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { reason?: string };
    expect(body.reason).toBe("bad batch version");
    expect(queryLog.filter((q) => q === "BEGIN")).toHaveLength(0);
  });

  it("400 cuando el lote trae el mismo id con payload distinto", async () => {
    const response = await putBatch(
      batch({ events: [event("e1", 1000), event("e1", 2000)] }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { reason?: string };
    expect(body.reason).toBe("conflicting event id");
  });

  it("413 con cuerpo por encima de 256 KiB", async () => {
    const big = JSON.stringify({
      ...batch(),
      relleno: "x".repeat(300 * 1024),
    });
    const response = await putBatch(big);
    expect(response.status).toBe(413);
    expect(queryLog).toHaveLength(0);
  });

  it("confirma un lote válido y devuelve los ids aceptados", async () => {
    const response = await putBatch(
      batch({
        baselines: [baseline("o1", 40)],
        events: [event("e1"), event("e2", 2000)],
        fields: [field("name", "Misifus", 100, "op1")],
        receipts: [{ id: "achievement-seen:palabra_1", at: 50 }],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      accepted: Record<string, string[]>;
    };
    expect(body.accepted).toEqual({
      baselines: ["o1"],
      events: ["e1", "e2"],
      fields: ["op1"],
      receipts: ["achievement-seen:palabra_1"],
    });
    expect(db.baselines.size).toBe(1);
    expect(db.events.size).toBe(2);
    expect(db.fields.size).toBe(1);
    expect(queryLog).toContain("COMMIT");
  });

  it("acepta un lote con logros nuevos y level-seen válidos", async () => {
    const response = await putBatch(
      batch({
        receipts: [
          { id: "achievement-seen:palabras_250", at: 50 },
          { id: "level-seen:3", at: 60 },
        ],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { accepted: Record<string, string[]> };
    expect(body.accepted.receipts).toEqual(["achievement-seen:palabras_250", "level-seen:3"]);
  });

  it("400 ante categoría inventada o logro desconocido en PUT", async () => {
    const response = await putBatch(
      batch({
        receipts: [{ id: "categoria-inventada:clave", at: 50 }],
      }),
    );
    expect(response.status).toBe(400);
  });

  it("reenviar el mismo lote es éxito aunque no inserte nada", async () => {
    const first = await putBatch(batch({ events: [event("e1")] }));
    expect(first.status).toBe(200);
    const second = await putBatch(batch({ events: [event("e1")] }));
    expect(second.status).toBe(200);
    const body = (await second.json()) as {
      accepted: { events: string[] };
    };
    // El id sigue confirmado: ya existía idéntico.
    expect(body.accepted.events).toEqual(["e1"]);
    expect(db.events.size).toBe(1);
  });

  it("409 cuando el id ya existe con payload distinto", async () => {
    const first = await putBatch(batch({ events: [event("e1", 1000)] }));
    expect(first.status).toBe(200);
    const response = await putBatch(batch({ events: [event("e1", 2000)] }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { conflicts?: string[] };
    expect(body.conflicts).toEqual(["e1"]);
    // Nada cambió: el evento guardado es el primero.
    expect(canon(db.events.get(keyOf("u1", "e1")))).toBe(canon(event("e1", 1000)));
  });

  it("409 igual para un baseline ya guardado con otro estado", async () => {
    await putBatch(batch({ baselines: [baseline("o1", 40)] }));
    const response = await putBatch(batch({ baselines: [baseline("o1", 99)] }));
    expect(response.status).toBe(409);
  });

  it("rollback: un fallo a mitad no deja nada escrito", async () => {
    failPlan = [
      {
        match: /INSERT INTO lecta_user_companion_events/,
        error: new Error("boom") as Error & { code?: string },
      },
    ];
    const response = await putBatch(
      batch({ baselines: [baseline("o1")], events: [event("e1")] }),
    );
    expect(response.status).toBe(503);
    expect(queryLog).toContain("ROLLBACK");
    expect(db.baselines.size).toBe(0);
    expect(db.events.size).toBe(0);
  });

  it("503 con un error de SQL que no es serializable", async () => {
    failPlan = [
      {
        match: /INSERT INTO lecta_user_companion_events/,
        error: new Error("boom") as Error & { code?: string },
      },
    ];
    const response = await putBatch(batch({ events: [event("e1")] }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error?: string };
    expect(body.error).not.toContain("boom");
  });

  it("un error serializable 40001 reintenta la transacción y confirma", async () => {
    failPlan = [
      {
        match: /INSERT INTO lecta_user_companion_events/,
        error: Object.assign(new Error("serialization"), { code: "40001" }),
      },
    ];
    const response = await putBatch(batch({ events: [event("e1")] }));
    expect(response.status).toBe(200);
    expect(queryLog.filter((q) => q === "BEGIN")).toHaveLength(2);
    expect(queryLog).toContain("ROLLBACK");
    expect(db.events.size).toBe(1);
  });

  it("los registros arbitran por (updated_at, operation_id) y null es dato", async () => {
    // Empate de sello: gana el operationId mayor.
    await putBatch(
      batch({ fields: [field("equipped.neck", "bufanda", 100, "op-b")] }),
    );
    await putBatch(
      batch({ fields: [field("equipped.neck", "collar", 100, "op-a")] }),
    );
    let row = db.fields.get(keyOf("u1", "equipped.neck"))!;
    expect(row.value).toBe("bufanda");
    expect(row.operation_id).toBe("op-b");

    // Quitar la prenda con sello mayor: el null se guarda como dato.
    await putBatch(
      batch({ fields: [field("equipped.neck", null, 200, "op-c")] }),
    );
    row = db.fields.get(keyOf("u1", "equipped.neck"))!;
    expect(row.value).toBeNull();
    expect(row.updated_at).toBe("200");
  });

  it("dentro del lote gana el sello mayor del mismo campo", async () => {
    const response = await putBatch(
      batch({
        fields: [
          field("name", "Viejo", 100, "op1"),
          field("name", "Nuevo", 200, "op2"),
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(db.fields.get(keyOf("u1", "name"))!.value).toBe("Nuevo");
  });

  it("las recepciones unen por sello mínimo", async () => {
    await putBatch(
      batch({ receipts: [{ id: "achievement-seen:palabra_1", at: 500 }] }),
    );
    await putBatch(
      batch({
        receipts: [
          { id: "achievement-seen:palabra_1", at: 900 },
          { id: "achievement-seen:palabra_1", at: 300 },
        ],
      }),
    );
    expect(db.receipts.get(keyOf("u1", "achievement-seen:palabra_1"))).toBe(
      "300",
    );
  });

  it("aisla por user_id: otro usuario no ve ni choca con lo de u1", async () => {
    await putBatch(batch({ events: [event("e1", 1000)] }));
    h.session = { user: { id: "u2" } };
    // Mismo id y distinto payload bajo otra cuenta: no es conflicto.
    const response = await putBatch(batch({ events: [event("e1", 2000)] }));
    expect(response.status).toBe(200);
    expect(db.events.size).toBe(2);
  });
});

describe("GET /api/companion — lectura paginada", () => {
  it("503 sin almacenamiento y 401 sin sesión", async () => {
    h.conn = undefined;
    expect((await getKind("events")).status).toBe(503);
    h.conn = "postgres://x";
    h.session = null;
    expect((await getKind("events")).status).toBe(401);
  });

  it("400 sin kind o con kind fuera de la lista", async () => {
    expect((await companion.request("/api/companion")).status).toBe(400);
    expect((await getKind("cosas")).status).toBe(400);
  });

  it("400 con cursor vacío o demasiado largo", async () => {
    expect((await getKind("events", "")).status).toBe(400);
    expect((await getKind("events", "x".repeat(201))).status).toBe(400);
  });

  it("devuelve eventos ordenados con su payload completo", async () => {
    await putBatch(
      batch({ events: [event("e2", 2), event("e1", 1), event("e3", 3)] }),
    );
    const response = await getKind("events");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(body.items.map((i) => i.id)).toEqual(["e1", "e2", "e3"]);
    expect(body.nextCursor).toBeNull();
    expect(body.items[0]).toEqual(event("e1", 1));
  });

  it("pagina 125 filas en tandas de 120 con cursor por clave", async () => {
    // Cofres «legacy:<id>» admiten cualquier clave: sirven para llenar.
    const many = Array.from({ length: 125 }, (_, i) => ({
      id: `chest-open:legacy:r${String(i).padStart(3, "0")}`,
      at: i + 1,
    }));
    // 125 > 120 del lote: entran en dos PUT.
    await putBatch(batch({ receipts: many.slice(0, 120) }));
    await putBatch(batch({ receipts: many.slice(120) }));

    const page1 = (await (await getKind("receipts")).json()) as {
      items: { id: string; at: number }[];
      nextCursor: string | null;
    };
    expect(page1.items).toHaveLength(120);
    expect(page1.nextCursor).toBe("chest-open:legacy:r119");
    expect(page1.items[0].id).toBe("chest-open:legacy:r000");

    const response2 = await getKind("receipts", page1.nextCursor!);
    const page2 = (await response2.json()) as {
      items: { id: string; at: number }[];
      nextCursor: string | null;
    };
    expect(page2.items.map((i) => i.id)).toEqual([
      "chest-open:legacy:r120",
      "chest-open:legacy:r121",
      "chest-open:legacy:r122",
      "chest-open:legacy:r123",
      "chest-open:legacy:r124",
    ]);
    expect(page2.nextCursor).toBeNull();
    // Los sellos llegan como number en JSON, no como texto de int8.
    expect(typeof page2.items[0].at).toBe("number");
  });

  it("devuelve los registros como {field, value, updatedAt, operationId}", async () => {
    await putBatch(
      batch({ fields: [field("equipped.neck", null, 200, "op9")] }),
    );
    const response = await getKind("fields");
    const body = (await response.json()) as {
      items: {
        field: string;
        value: unknown;
        updatedAt: number;
        operationId: string;
      }[];
    };
    expect(body.items).toEqual([
      { field: "equipped.neck", value: null, updatedAt: 200, operationId: "op9" },
    ]);
  });

  it("otro usuario no ve los datos de u1", async () => {
    await putBatch(batch({ events: [event("e1")] }));
    h.session = { user: { id: "u2" } };
    const body = (await (await getKind("events")).json()) as {
      items: unknown[];
    };
    expect(body.items).toEqual([]);
  });
});
