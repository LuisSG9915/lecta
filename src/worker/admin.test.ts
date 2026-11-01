import { afterEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import * as dbModule from "./db";
import * as sessionModule from "./session";
import type { WorkerEnv } from "./db";
import { admin, assembleOverview, assembleUserDetail, type OverviewInput } from "./admin";
import type { AdminOverview, AdminUserDetail } from "../shared/admin-insights";

// Reloj fijo de las pruebas: sábado 2026-10-31 15:00 UTC.
const NOW = Date.UTC(2026, 9, 31, 15);
const DAY = 86_400_000;
const MIN = 60_000;
const TZ = "UTC";
const OWNER_ENV = {
  LECTA_OWNER_EMAIL: "dueno@lecta.mx",
  DATABASE_URL: "postgres://u:p@h/db",
} as WorkerEnv;

const day = (offset: number) => {
  const d = new Date(NOW + offset * DAY);
  return d.toISOString().slice(0, 10);
};
const TODAY = day(0);

type Q = ReturnType<typeof vi.fn>;

function fakeClient(handler: (sql: string, params?: unknown[]) => unknown[] = () => []): {
  query: Q;
} {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => ({
      rows: handler(sql, params),
      rowCount: 0,
    })),
  };
}

function withFakeClient(client: { query: Q } | undefined) {
  return vi
    .spyOn(dbModule, "withClient")
    .mockImplementation(async (_env, run) => {
      if (!client) return undefined;
      return run(client as unknown as pg.Client);
    });
}

function asOwner(email = "DUENO@lecta.mx") {
  return vi
    .spyOn(sessionModule, "getSessionUser")
    .mockResolvedValue({ id: "u-owner", email } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/access", () => {
  it("404 sin correo de dueño configurado", async () => {
    const res = await admin.request("/api/admin/access", {}, {} as WorkerEnv);
    expect(res.status).toBe(404);
  });

  it("404 con sesión de otra persona o sin sesión", async () => {
    asOwner("otra@persona.mx");
    let res = await admin.request("/api/admin/access", {}, OWNER_ENV);
    expect(res.status).toBe(404);

    vi.spyOn(sessionModule, "getSessionUser").mockResolvedValue(null);
    res = await admin.request("/api/admin/access", {}, OWNER_ENV);
    expect(res.status).toBe(404);
  });

  it("204 cuando el correo de la sesión es el del dueño", async () => {
    asOwner();
    const res = await admin.request("/api/admin/access", {}, OWNER_ENV);
    expect(res.status).toBe(204);
  });
});

// ---------- Datos de fábrica compartidos ----------

function overviewInput(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    users: [
      { id: "u1", email: "ana@correo.mx", name: "Ana", created_at: NOW - 5 * DAY },
      { id: "u3", email: "carla@correo.mx", name: "Carla", created_at: NOW - 30 * DAY },
      { id: "u2", email: "a-1@smoke.test", name: "Smoke", created_at: NOW - 46 * DAY },
    ],
    facts: [
      // Minutos unidos: 30 hoy, 60 en el periodo y 10 en el anterior.
      { metric: "minutes", user_id: "u1", day: TODAY, k1: null, k2: null, n1: String(30 * MIN), n2: 0, n3: 0 },
      { metric: "minutes", user_id: "u1", day: day(-16), k1: null, k2: null, n1: String(60 * MIN), n2: 0, n3: 0 },
      { metric: "minutes", user_id: "u1", day: day(-41), k1: null, k2: null, n1: String(10 * MIN), n2: 0, n3: 0 },
      { metric: "minutes_total", user_id: "u1", day: null, k1: null, k2: null, n1: String(100 * MIN), n2: 0, n3: 0 },
      { metric: "kindle", user_id: "u1", day: TODAY, k1: null, k2: null, n1: "40", n2: String(25 * MIN), n3: 0 },
      { metric: "review", user_id: "u1", day: TODAY, k1: null, k2: null, n1: "4", n2: "4", n3: "3" },
      { metric: "review", user_id: "u2", day: TODAY, k1: null, k2: null, n1: "9", n2: "9", n3: "9" },
      { metric: "word_saved", user_id: "u1", day: day(-1), k1: null, k2: null, n1: "3", n2: 0, n3: 0 },
      { metric: "signup", user_id: "u1", day: day(-5), k1: null, k2: null, n1: "1", n2: 0, n3: 0 },
      { metric: "signup", user_id: "u3", day: day(-30), k1: null, k2: null, n1: "1", n2: 0, n3: 0 },
      { metric: "companion", user_id: "u1", day: TODAY, k1: "consulted", k2: null, n1: "5", n2: 0, n3: 0 },
      { metric: "active_day", user_id: "u1", day: TODAY, k1: null, k2: null, n1: "1", n2: 0, n3: 0 },
      { metric: "active_day", user_id: "u1", day: day(-16), k1: null, k2: null, n1: "1", n2: 0, n3: 0 },
      { metric: "active_day", user_id: "u3", day: TODAY, k1: null, k2: null, n1: "1", n2: 0, n3: 0 },
      { metric: "words", user_id: "u1", day: null, k1: null, k2: null, n1: "12", n2: 0, n3: 0 },
      { metric: "reviews", user_id: "u1", day: null, k1: null, k2: null, n1: "40", n2: "36", n3: "27" },
      { metric: "annotations", user_id: "u1", day: null, k1: null, k2: null, n1: "6", n2: "3", n3: "2" },
      { metric: "stage", user_id: "u1", day: null, k1: "learning", k2: null, n1: "7", n2: 0, n3: 0 },
      { metric: "stage", user_id: "u1", day: null, k1: "mastered", k2: null, n1: "5", n2: 0, n3: 0 },
      { metric: "knowledge", user_id: "u1", day: null, k1: "en", k2: "saved", n1: "42", n2: 0, n3: 0 },
      { metric: "position", user_id: "u1", day: null, k1: "bookA", k2: null, n1: "0.99", n2: String(NOW - DAY), n3: 0 },
      { metric: "position", user_id: "u1", day: null, k1: "bookB", k2: null, n1: "0.4", n2: String(NOW - 20 * DAY), n3: 0 },
      { metric: "position", user_id: "u3", day: null, k1: "bookA", k2: null, n1: "0.5", n2: String(NOW - 3 * DAY), n3: 0 },
      { metric: "position", user_id: "u2", day: null, k1: "bookA", k2: null, n1: "0.2", n2: String(NOW - 2 * DAY), n3: 0 },
      { metric: "book_minutes", user_id: "u1", day: null, k1: "bookA", k2: null, n1: String(50 * MIN), n2: 0, n3: 0 },
      { metric: "last_active", user_id: "u1", day: null, k1: null, k2: null, n1: String(NOW - 3600_000), n2: 0, n3: 0 },
      { metric: "kindle_user", user_id: "u1", day: null, k1: null, k2: null, n1: "1", n2: 0, n3: 0 },
      { metric: "returned", user_id: "u1", day: null, k1: null, k2: null, n1: "1", n2: 0, n3: 0 },
      { metric: "companion_finished", user_id: "u1", day: null, k1: "bookA", k2: day(-16), n1: "1", n2: 0, n3: 0 },
      { metric: "rating", user_id: null, day: null, k1: "good", k2: null, n1: "20", n2: 0, n3: 0 },
      { metric: "kind", user_id: null, day: null, k1: "cloze", k2: null, n1: "12", n2: 0, n3: 0 },
      { metric: "words", user_id: "u2", day: null, k1: null, k2: null, n1: "99", n2: 0, n3: 0 },
      { metric: "active_day", user_id: "u2", day: TODAY, k1: null, k2: null, n1: "1", n2: 0, n3: 0 },
    ],
    hourCells: [{ dow: 0, hr: 21, ms: String(60 * MIN) }],
    sessions: [
      { user_id: "u1", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0)" },
      { user_id: "u1", ua: "Mozilla/5.0 (Kindle; Linux)" },
      { user_id: "u2", ua: "Mozilla/5.0 (X11; Linux x86_64)" },
    ],
    aiUsage: [{ scope: "tip", units: "3", users: "1" }],
    userBooks: [
      { user_id: "u1", book_id: "bookA", title: "Libro A", author: "Autor A" },
    ],
    days: 30,
    timeZone: TZ,
    now: NOW,
    includeTest: false,
    ...overrides,
  };
}

describe("assembleOverview", () => {
  it("excluye las cuentas de prueba por omisión", () => {
    const out = assembleOverview(overviewInput());
    expect(out.testAccountsExcluded).toBe(true);
    expect(out.kpis.totalAccounts).toBe(2);
    expect(out.users.map((u) => u.email)).not.toContain("a-1@smoke.test");
  });

  it("las incluye con includeTest", () => {
    const out = assembleOverview(overviewInput({ includeTest: true }));
    expect(out.testAccountsExcluded).toBe(false);
    expect(out.kpis.totalAccounts).toBe(3);
  });

  it("calcula los KPIs del periodo y del anterior", () => {
    const out = assembleOverview(overviewInput());
    const k = out.kpis;
    expect(k.newAccounts).toBe(2);
    expect(k.activeToday).toBe(2);
    expect(k.active30d).toBe(2);
    expect(k.stickiness).toBe(1);
    expect(k.readingMinutes).toBe(90);
    expect(k.kindleMinutesEst).toBe(25);
    expect(k.wordsSaved).toBe(3);
    expect(k.reviews).toBe(4);
    expect(k.recallPct).toBe(75);
    expect(k.annotations).toBe(3);
    // bookA: posición ≥0.99 actualizada en el periodo Y evento del
    // compañero en el periodo → el mismo par (usuario, libro) → 1.
    expect(k.booksFinished).toBe(1);

    const p = out.kpisPrev;
    expect(p.readingMinutes).toBe(10);
    expect(p.annotations).toBe(2);
    expect(p.reviews).toBe(0);
  });

  it("arma la serie diaria rellenando huecos", () => {
    const out = assembleOverview(overviewInput());
    expect(out.series).toHaveLength(30);
    const today = out.series[out.series.length - 1]!;
    expect(today.day).toBe(TODAY);
    expect(today.activeUsers).toBe(2);
    expect(today.readingMinutes).toBe(30);
    expect(today.kindlePages).toBe(40);
    expect(today.kindleMinutesEst).toBe(25);
    expect(today.reviews).toBe(4);
    expect(today.consults).toBe(5);
    const yesterday = out.series[out.series.length - 2]!;
    expect(yesterday.wordsSaved).toBe(3);
  });

  it("arma el embudo de activación", () => {
    const out = assembleOverview(overviewInput());
    const funnel = Object.fromEntries(out.funnel.map((f) => [f.id, f.users]));
    expect(funnel).toEqual({
      signup: 2,
      read: 1,
      saved: 1,
      reviewed: 1,
      returned: 1,
      finished: 1,
    });
  });

  it("arma cohortes por semana de alta", () => {
    const out = assembleOverview(overviewInput());
    const cohort = out.cohorts.find((c) => c.week === "2026-10-26");
    expect(cohort?.size).toBe(1);
    expect(cohort?.retainedUsers[0]).toBe(1);
    expect(cohort?.retainedPct[0]).toBe(100);
    // Semanas futuras no calculables.
    expect(cohort?.retainedPct[7]).toBeNull();
  });

  it("reparte los libros con título, lectores y en pausa", () => {
    const out = assembleOverview(overviewInput());
    const bookA = out.topBooks.find((b) => b.bookHash === "bookA")!;
    expect(bookA.title).toBe("Libro A");
    expect(bookA.readers).toBe(2);
    expect(bookA.minutes).toBe(50);
    expect(bookA.finished).toBe(1);
    expect(bookA.avgProgress).toBeCloseTo(0.745, 2);

    const paused = out.pausedBooks.find((b) => b.bookHash === "bookB")!;
    expect(paused.readers).toBe(1);
  });

  it("resume aprendizaje, dispositivos e IA", () => {
    const out = assembleOverview(overviewInput());
    expect(out.learning.stages.learning).toBe(7);
    expect(out.learning.stages.mastered).toBe(5);
    expect(out.learning.ratings.good).toBe(20);
    expect(out.learning.reviewKinds.cloze).toBe(12);
    expect(out.learning.knowledgeByLang[0]).toMatchObject({
      language: "en",
      known: 42,
    });

    const phone = out.devices.find((d) => d.device === "phone")!;
    expect(phone.sessions).toBe(1);
    const kindle = out.devices.find((d) => d.device === "kindle")!;
    expect(kindle.users).toBe(1);

    expect(out.aiByScope[0]).toEqual({ scope: "tip", units: 3, users: 1 });

    const heat = out.hourHeatmap[0]!;
    expect(heat).toEqual({ dow: 7, hour: 21, minutes: 60 });
  });

  it("llena la tabla de cuentas con totales y señales", () => {
    const out = assembleOverview(overviewInput());
    const ana = out.users.find((u) => u.id === "u1")!;
    expect(ana.minutesPeriod).toBe(90);
    expect(ana.minutesTotal).toBe(100);
    expect(ana.booksStarted).toBe(2);
    expect(ana.booksFinished).toBe(1);
    expect(ana.wordsSaved).toBe(12);
    expect(ana.reviews).toBe(40);
    expect(ana.recallPct).toBe(75);
    expect(ana.usesKindle).toBe(true);
    expect(ana.annotations).toBe(6);
  });
});

// ---------- Ruta GET /api/admin/insights ----------

function routeClient(): { query: Q } {
  return fakeClient((sql) => {
    if (sql.includes("active_day")) {
      return [
        {
          metric: "minutes",
          user_id: "u1",
          day: TODAY,
          k1: null,
          k2: null,
          n1: String(30 * MIN),
          n2: 0,
          n3: 0,
        },
        {
          metric: "active_day",
          user_id: "u1",
          day: TODAY,
          k1: null,
          k2: null,
          n1: "1",
          n2: 0,
          n3: 0,
        },
      ];
    }
    if (sql.includes("generate_series")) return [];
    if (sql.includes("companion_finished")) {
      return [
        {
          metric: "words",
          user_id: "u1",
          day: null,
          k1: null,
          k2: null,
          n1: "5",
          n2: 0,
          n3: 0,
        },
      ];
    }
    if (sql.includes('FROM "user"')) {
      return [
        {
          id: "u1",
          email: "ana@correo.mx",
          name: "Ana",
          created_at: String(NOW - 5 * DAY),
        },
      ];
    }
    if (sql.includes('FROM "session"')) return [];
    return [];
  });
}

describe("GET /api/admin/insights", () => {
  it("404 a quien no es el dueño", async () => {
    asOwner("otra@persona.mx");
    const res = await admin.request("/api/admin/insights", {}, OWNER_ENV);
    expect(res.status).toBe(404);
  });

  it("devuelve el panel al dueño con no-store", async () => {
    asOwner();
    withFakeClient(routeClient());
    const res = await admin.request(
      "/api/admin/insights?days=30&tz=UTC",
      {},
      OWNER_ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Server-Timing lleva las dos etapas medidas: consulta y ensamblado.
    const timing = res.headers.get("server-timing");
    expect(timing).toMatch(/db;dur=\d+(\.\d+)?/);
    expect(timing).toMatch(/assemble;dur=\d+(\.\d+)?/);
    const body = (await res.json()) as AdminOverview;
    expect(body.days).toBe(30);
    expect(body.timeZone).toBe("UTC");
    expect(body.kpis.totalAccounts).toBe(1);
    expect(body.series).toHaveLength(30);
    expect(body.users[0]?.email).toBe("ana@correo.mx");
  });

  it("limita days y la zona a valores válidos", async () => {
    asOwner();
    withFakeClient(routeClient());
    const res = await admin.request(
      "/api/admin/insights?days=9999&tz=Marte/Olympus",
      {},
      OWNER_ENV,
    );
    const body = (await res.json()) as AdminOverview;
    expect(body.days).toBe(30);
    expect(body.timeZone).toBe("UTC");
  });

  it("todas las consultas usan parámetros, nunca interpolan", async () => {
    asOwner();
    const client = routeClient();
    withFakeClient(client);
    await admin.request("/api/admin/insights?days=30&tz=UTC", {}, OWNER_ENV);
    for (const call of client.query.mock.calls) {
      const sql = String(call[0]);
      // La zona y el periodo viajan como $N, jamás pegados en el SQL.
      expect(sql).not.toContain("UTC");
      expect(sql).not.toContain("America/");
      expect(sql).not.toMatch(/\$\{|\b30\b(?!\d*000)/);
    }
    // Los parámetros sí viajan aparte.
    const dailyCall = client.query.mock.calls.find((c) =>
      String(c[0]).includes("active_day"),
    );
    expect(dailyCall?.[1]).toEqual(
      expect.arrayContaining([expect.any(Number), "UTC"]),
    );
  });
});

// ---------- Ruta GET /api/admin/users/:id ----------

function detailClient(account: unknown[]): { query: Q } {
  return fakeClient((sql) => {
    if (sql.includes("active_day")) {
      return [
        {
          metric: "minutes",
          user_id: "u1",
          day: TODAY,
          k1: null,
          k2: null,
          n1: String(20 * MIN),
          n2: 0,
          n3: 0,
        },
      ];
    }
    if (sql.includes("companion_finished")) {
      return [
        {
          metric: "position",
          user_id: "u1",
          day: null,
          k1: "bookA",
          k2: null,
          n1: "0.99",
          n2: String(NOW - DAY),
          n3: 0,
        },
        {
          metric: "stage",
          user_id: "u1",
          day: null,
          k1: "learning",
          k2: null,
          n1: "4",
          n2: 0,
          n3: 0,
        },
      ];
    }
    if (sql.includes('FROM "user"')) return account;
    if (sql.includes('FROM "session"')) {
      return [{ user_id: "u1", ua: "Mozilla/5.0 (Kindle; Linux)" }];
    }
    if (sql.includes("user_books")) {
      return [
        {
          user_id: "u1",
          book_id: "bookA",
          title: "Libro A",
          author: "Autor A",
        },
      ];
    }
    return [];
  });
}

describe("GET /api/admin/users/:id", () => {
  it("404 a quien no es el dueño", async () => {
    asOwner("otra@persona.mx");
    const res = await admin.request("/api/admin/users/u1", {}, OWNER_ENV);
    expect(res.status).toBe(404);
  });

  it("404 cuando la cuenta no existe", async () => {
    asOwner();
    withFakeClient(detailClient([]));
    const res = await admin.request("/api/admin/users/nadie", {}, OWNER_ENV);
    expect(res.status).toBe(404);
  });

  it("devuelve la ficha de la persona", async () => {
    asOwner();
    withFakeClient(
      detailClient([
        {
          id: "u1",
          email: "ana@correo.mx",
          name: "Ana",
          created_at: String(NOW - 5 * DAY),
        },
      ]),
    );
    const res = await admin.request(
      "/api/admin/users/u1?days=30&tz=UTC",
      {},
      OWNER_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminUserDetail;
    expect(body.user.email).toBe("ana@correo.mx");
    expect(body.series).toHaveLength(30);
    expect(body.books[0]).toMatchObject({
      bookHash: "bookA",
      title: "Libro A",
      finished: true,
    });
    expect(body.stages.learning).toBe(4);
    expect(body.devices[0]?.device).toBe("kindle");
  });
});

// ---------- assembleUserDetail ----------

describe("assembleUserDetail", () => {
  it("devuelve null sin cuenta", () => {
    expect(
      assembleUserDetail({
        account: null,
        facts: [],
        userFacts: [],
        sessions: [],
        aiUsage: [],
        userBooks: [],
        days: 30,
        timeZone: TZ,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("agrupa libros, etapas, repasos por semana e idiomas", () => {
    const detail = assembleUserDetail({
      account: {
        id: "u1",
        email: "ana@correo.mx",
        name: "Ana",
        created_at: NOW - 5 * DAY,
      },
      facts: [
        {
          metric: "minutes",
          user_id: "u1",
          day: TODAY,
          k1: null,
          k2: null,
          n1: String(45 * MIN),
          n2: 0,
          n3: 0,
        },
        {
          metric: "review",
          user_id: "u1",
          day: TODAY,
          k1: null,
          k2: null,
          n1: "4",
          n2: "4",
          n3: "3",
        },
        {
          metric: "companion",
          user_id: "u1",
          day: TODAY,
          k1: "consulted",
          k2: null,
          n1: "7",
          n2: 0,
          n3: 0,
        },
      ],
      userFacts: [
        {
          metric: "position",
          user_id: "u1",
          day: null,
          k1: "bookA",
          k2: null,
          n1: "0.99",
          n2: String(NOW - DAY),
          n3: 0,
        },
        {
          metric: "book_minutes",
          user_id: "u1",
          day: null,
          k1: "bookB",
          k2: null,
          n1: String(10 * MIN),
          n2: 0,
          n3: 0,
        },
        {
          metric: "knowledge",
          user_id: "u1",
          day: null,
          k1: "en",
          k2: "saved",
          n1: "30",
          n2: 0,
          n3: 0,
        },
        {
          metric: "word_lang",
          user_id: "u1",
          day: null,
          k1: "en",
          k2: null,
          n1: "8",
          n2: 0,
          n3: 0,
        },
        {
          metric: "companion_finished",
          user_id: "u1",
          day: null,
          k1: "bookB",
          k2: TODAY,
          n1: "1",
          n2: 0,
          n3: 0,
        },
      ],
      sessions: [{ user_id: "u1", ua: "Mozilla/5.0 (iPhone)" }],
      aiUsage: [{ scope: "tip", units: "2", users: "1" }],
      userBooks: [],
      days: 30,
      timeZone: TZ,
      now: NOW,
    })!;

    expect(detail.consultsTotal).toBe(7);
    // bookB aparece por minutos aunque no tenga posición guardada.
    const bookB = detail.books.find((b) => b.bookHash === "bookB")!;
    expect(bookB.minutes).toBe(10);
    expect(bookB.finished).toBe(true); // por evento del compañero
    const week = detail.recallByWeek[0]!;
    expect(week.recallPct).toBe(75);
    expect(detail.languages[0]).toEqual({
      language: "en",
      lemmasKnown: 30,
      wordsSaved: 8,
    });
    expect(detail.devices[0]?.device).toBe("phone");
  });
});
