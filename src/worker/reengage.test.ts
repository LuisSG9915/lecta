import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { WorkerEnv } from "./db";

const queryMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock("./session", () => ({ getSession: (...args: unknown[]) => getSessionMock(...args) }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  withClient: async (_env: unknown, run: (client: { query: typeof queryMock }) => Promise<unknown>) =>
    run({ query: queryMock }),
}));

import {
  ELIGIBLE_SQL,
  buildReengageHtml,
  progressPercent,
  reengage,
  reengageSubject,
  reengageToken,
  runReengage,
  verifyReengageToken,
} from "./reengage";

const SECRET = "s3cr3t";
const env: WorkerEnv = { RESEND_API_KEY: "re_x", BETTER_AUTH_SECRET: SECRET, DATABASE_URL: "postgres://x" };
const NOW = Date.UTC(2026, 11, 10);
const noSleep = async () => undefined;

beforeEach(() => {
  queryMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("firma de la baja", () => {
  it("verifica la propia y rechaza otra cuenta o basura", async () => {
    const t = await reengageToken(SECRET, "u1");
    expect(await verifyReengageToken(SECRET, "u1", t)).toBe(true);
    expect(await verifyReengageToken(SECRET, "u2", t)).toBe(false);
    expect(await verifyReengageToken("otro", "u1", t)).toBe(false);
    expect(await verifyReengageToken(SECRET, "u1", "abc")).toBe(false);
  });
});

describe("contenido", () => {
  it("libro, progreso, palabras y baja; el título se escapa", () => {
    const html = buildReengageHtml(
      { title: "<b>Marianela</b>", progress: 42, dueWords: 7 },
      "https://lectal.app/api/reengage/unsubscribe?u=u1&t=x",
    );
    expect(html).toContain("«&lt;b&gt;Marianela&lt;/b&gt;»");
    expect(html).toContain("en el 42%");
    expect(html).toContain("7 palabras de tu Cuaderno te esperan");
    expect(html).toContain("https://lectal.app/?src=regreso");
    expect(html).toContain("api/reengage/unsubscribe");
  });

  it("sin título ni palabras", () => {
    const html = buildReengageHtml({ title: null, progress: null, dueWords: 0 }, "x");
    expect(html).toContain("Dejaste tu libro a medias.");
    expect(html).not.toContain("Cuaderno te");
    expect(reengageSubject({ title: null, progress: null, dueWords: 0 })).toBe("Tu libro te espera en Lecta");
    expect(reengageSubject({ title: "Marianela", progress: 1, dueWords: 0 })).toBe("«Marianela» te espera");
  });

  it("progreso 0–1 a porcentaje", () => {
    expect(progressPercent(0.423)).toBe(42);
    expect(progressPercent(55)).toBe(55);
    expect(progressPercent(null)).toBeNull();
    expect(progressPercent(0)).toBeNull();
  });
});

describe("runReengage", () => {
  const respond = (eligible: unknown[]) =>
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === ELIGIBLE_SQL) return { rows: eligible };
      if (sql.includes("FROM lecta_user_positions")) return { rows: [{ book_hash: "h1", progress: 0.5 }] };
      if (sql.includes("FROM user_books")) return { rows: [{ title: "Marianela" }] };
      if (sql.includes("FROM lecta_user_words")) return { rows: [{ n: "3" }] };
      return { rows: [], rowCount: 1 };
    });

  it("ventana de 7 a 14 días y enfriamiento de 30 en los parámetros", async () => {
    respond([]);
    await runReengage(env, NOW, noSleep);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toBe(ELIGIBLE_SQL);
    expect(params).toEqual([NOW - 7 * 86_400_000, NOW - 14 * 86_400_000, NOW - 30 * 86_400_000]);
    expect(sql).toContain('u."emailVerified"');
    expect(sql).toContain("@smoke.test");
    expect(sql).toContain("reengage_opt_out");
  });

  it("envía con baja de un clic y marca el envío solo si Resend acepta", async () => {
    respond([{ id: "u1", email: "lector@correo.mx" }]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await runReengage(env, NOW, noSleep)).toEqual({ sent: 1, eligible: 1 });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.to).toEqual(["lector@correo.mx"]);
    expect(body.subject).toBe("«Marianela» te espera");
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.headers["List-Unsubscribe"]).toContain("/api/reengage/unsubscribe?u=u1&t=");
    expect(body.html).toContain("en el 50%");
    expect(body.html).toContain("3 palabras");
    const mark = queryMock.mock.calls.find(([sql]) => String(sql).includes("reengage_sent_at = EXCLUDED"));
    expect(mark?.[1]).toEqual(["u1", NOW]);
    expect(String(mark?.[0])).not.toMatch(/SET[^;]*plan\s*=/);
  });

  it("con un libro de hash sha256 el botón abre ese libro directo", async () => {
    const hash = "ab".repeat(32);
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === ELIGIBLE_SQL) return { rows: [{ id: "u1", email: "lector@correo.mx" }] };
      if (sql.includes("FROM lecta_user_positions")) return { rows: [{ book_hash: hash, progress: 0.5 }] };
      return { rows: [], rowCount: 1 };
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await runReengage(env, NOW, noSleep);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.html).toContain(`https://lectal.app/?src=regreso&amp;abrir=${hash}`);
  });

  it("si Resend falla no marca el envío", async () => {
    respond([{ id: "u1", email: "lector@correo.mx" }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    expect(await runReengage(env, NOW, noSleep)).toEqual({ sent: 0, eligible: 1 });
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("reengage_sent_at = EXCLUDED"))).toBe(false);
  });

  it("sin columnas (42703), sin Resend o sin secreto no envía", async () => {
    queryMock.mockRejectedValue(Object.assign(new Error("no col"), { code: "42703" }));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await runReengage(env, NOW, noSleep)).toEqual({ sent: 0, eligible: 0 });
    expect(await runReengage({ ...env, RESEND_API_KEY: undefined }, NOW, noSleep)).toEqual({ sent: 0, eligible: 0 });
    expect(await runReengage({ ...env, BETTER_AUTH_SECRET: undefined }, NOW, noSleep)).toEqual({ sent: 0, eligible: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("baja", () => {
  const app = new Hono<{ Bindings: WorkerEnv }>().route("/", reengage);

  it("GET solo muestra la confirmación; POST da de baja", async () => {
    const t = await reengageToken(SECRET, "u1");
    const url = `/api/reengage/unsubscribe?u=u1&t=${t}`;
    const get = await app.request(url, {}, env);
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('method="post"');
    expect(queryMock).not.toHaveBeenCalled();

    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    const post = await app.request(url, { method: "POST" }, env);
    expect(post.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("reengage_opt_out = true");
    expect(params[0]).toBe("u1");
  });

  it("una firma inválida no toca la base", async () => {
    const res = await app.request("/api/reengage/unsubscribe?u=u1&t=" + "0".repeat(64), { method: "POST" }, env);
    expect(res.status).toBe(404);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("preferencia en «Tú»", () => {
  const app = new Hono<{ Bindings: WorkerEnv }>().route("/", reengage);

  beforeEach(() => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
  });

  it("GET: activo por defecto y refleja la baja guardada", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await (await app.request("/api/reengage/preferences", {}, env)).json()).toEqual({ enabled: true });
    queryMock.mockResolvedValueOnce({ rows: [{ reengage_opt_out: true }] });
    expect(await (await app.request("/api/reengage/preferences", {}, env)).json()).toEqual({ enabled: false });
  });

  it("GET sin la columna (033 pendiente): activo", async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "42703" }));
    expect(await (await app.request("/api/reengage/preferences", {}, env)).json()).toEqual({ enabled: true });
  });

  it("POST guarda la baja por UPSERT sin tocar el plan", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await app.request(
      "/api/reengage/preferences",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) },
      env,
    );
    expect(await res.json()).toEqual({ enabled: false });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("reengage_opt_out = EXCLUDED.reengage_opt_out");
    expect(sql).not.toMatch(/SET[^;]*\bplan\s*=/);
    expect(params.slice(0, 2)).toEqual(["u1", true]);
  });

  it("POST sin la columna responde 503 y sin sesión 401", async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "42703" }));
    const body = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) };
    expect((await app.request("/api/reengage/preferences", body, env)).status).toBe(503);
    getSessionMock.mockResolvedValueOnce(null);
    expect((await app.request("/api/reengage/preferences", body, env)).status).toBe(401);
  });
});
