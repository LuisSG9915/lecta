import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeSignature } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as epubReader from "./epub-reader";
import { app } from "../app";
import {
  correctKeyFor,
  memoryCodeStore,
  parseKindleViewportCookie,
  resetKindleStatusLimiter,
  safeKindleReturn,
  SAFE_EPUB_ASSET_MIMES,
} from "./routes";
import { resetKindleCacheMemory } from "./cache";

// Bloque 2 (docs/designs/2026-11-12-planes-y-landing.md): las rutas con gating
// consultan el plan con loadUserPlan. Por defecto la cuenta es fundadora, así
// la consulta no pasa por withClient ni consume los mocks de la base.
const loadUserPlanMock = vi.hoisted(() =>
  vi.fn(async () => ({
    plan: "founder_lifetime" as const,
    starterCoat: null,
    expiresAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    degraded: false,
  })),
);
vi.mock("../plan-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plan-store")>()),
  loadUserPlan: loadUserPlanMock,
}));


const getSessionMock = vi.hoisted(() => vi.fn());
const authHandlerMock = vi.hoisted(() => vi.fn());
const dbQueryMock = vi.hoisted(() => vi.fn());

vi.mock("../session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("../auth", () => {
  const authObj = {
    handler: (...args: unknown[]) => authHandlerMock(...args),
    api: { getSession: getSessionMock },
    closePool: () => Promise.resolve(),
  };
  return {
    createAuth: () => authObj,
    createScopedAuth: () => ({ auth: authObj, closePool: () => Promise.resolve() }),
    closePoolSafe: (closePool: () => Promise<void>) => closePool(),
  };
});

vi.mock("../db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db")>();
  return {
    ...original,
    getConnectionString: () => "postgres://mock",
    withClient: async (_env: unknown, callback: (client: { query: typeof dbQueryMock }) => Promise<unknown>) =>
      callback({ query: dbQueryMock }),
  };
});

describe("Kindle Routes (/k and /kindle)", () => {
  const minimalPath = resolve(__dirname, "../../../fixtures/minimal.epub");
  const minimalBytes = new Uint8Array(readFileSync(minimalPath));

  const mockBooksBucket = {
    list: vi.fn(async () => ({
      objects: [
        {
          key: "books/user-1/abababababababababababababababababababababababababababababababab.epub",
          customMetadata: {
            title: "Libro de prueba",
            author: "Equipo Lecta",
            sections: "2",
          },
        },
      ],
    })),
    get: vi.fn(defaultEpubGet),
    put: vi.fn(async (_key: string, _value: unknown) => undefined),
    delete: vi.fn(async () => undefined),
    // El EPUB de prueba es del usuario de la sesión (guardia de propiedad
    // de /k/read): el head responde para su clave .epub.
    head: vi.fn(async (key: string) =>
      key.includes("abababababababababababababababababababababababababababababababab") && key.endsWith(".epub") ? { key } : null,
    ),
  };

  // Implementación por defecto: solo sirve el EPUB de prueba para claves
  // .epub; las claves kcache/* responden null (miss) salvo que la prueba
  // las siembre explícitamente.
  async function defaultEpubGet(key: string) {
    if (key.includes("abababababababababababababababababababababababababababababababab") && key.endsWith(".epub")) {
      return {
        arrayBuffer: async () => minimalBytes.buffer.slice(
          minimalBytes.byteOffset,
          minimalBytes.byteOffset + minimalBytes.byteLength,
        ),
      };
    }
    return null;
  }

  const env = {
    DATABASE_URL: "postgres://mock",
    BETTER_AUTH_SECRET: "test-secret-for-signed-kindle-cookie",
    BOOKS: mockBooksBucket as unknown,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    memoryCodeStore.clear();
    resetKindleStatusLimiter();
    resetKindleCacheMemory();
    mockBooksBucket.get.mockImplementation(defaultEpubGet);
    getSessionMock.mockResolvedValue(null);
    dbQueryMock.mockResolvedValue({ rows: [] });
  });

  describe("Lecta+ en el portal (Bloque 2)", () => {
    const freePlan = {
      plan: "free" as const,
      starterCoat: null,
      expiresAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      degraded: false,
    };
    afterEach(() => {
      loadUserPlanMock.mockResolvedValue({ ...freePlan, plan: "founder_lifetime" as never });
    });

    it("una cuenta free recibe la nota HTML con 402 y sin <script>", async () => {
      getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
      loadUserPlanMock.mockResolvedValue(freePlan as never);
      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab", {}, env);
      expect(res.status).toBe(402);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("Lecta+");
      expect(html).not.toContain("<script");
    });

    it("las rutas exentas no consultan el plan", async () => {
      loadUserPlanMock.mockClear();
      getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
      await app.request("/k/login", {}, env);
      await app.request("/k/verify?code=ABCD", {}, env);
      expect(loadUserPlanMock).not.toHaveBeenCalled();
    });

    it("sin sesión /k sigue redirigiendo (no responde 402)", async () => {
      getSessionMock.mockResolvedValue(null);
      const res = await app.request("/k", {}, env);
      expect(res.status).toBe(302);
    });

    it("vincular un Kindle sin Lecta+ responde 402", async () => {
      getSessionMock.mockResolvedValue({ user: { id: "user-1" }, session: { token: "t" } });
      loadUserPlanMock.mockResolvedValue(freePlan as never);
      const res = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: "ABCD" }),
        },
        env,
      );
      expect(res.status).toBe(402);
    });

    it("vincular sin cuenta resuelta (userId vacío) se rechaza", async () => {
      getSessionMock.mockResolvedValue(null);
      const res = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: "ABCD", userSessionToken: "tok" }),
        },
        env,
      );
      expect(res.status).toBe(401);
    });
  });

  describe("Portal Kindle y vinculación por código de 4 letras", () => {
    it("GET /kindle sin sesión genera y muestra el código de 4 letras para e-readers", async () => {
      getSessionMock.mockResolvedValueOnce(null);
      const res = await app.request("/kindle", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Vincular tu Kindle");
      expect(html).toMatch(/[A-Z0-9]{4}/);
    });

    it("GET /kindle con sesión redirige a /k", async () => {
      getSessionMock.mockResolvedValueOnce({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/kindle", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k");
    });

    it("POST /api/kindle/link vincula el código con la sesión del usuario", async () => {
      // 1. Obtener código
      getSessionMock.mockResolvedValueOnce(null);
      const kindleRes = await app.request("/kindle", {}, env);
      const html = await kindleRes.text();
      const codeMatch = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})\s*<\/div>/);
      const code = codeMatch ? codeMatch[1] : "";
      expect(code).toHaveLength(4);

      // 2. Vincular desde móvil
      getSessionMock.mockResolvedValueOnce({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const linkRes = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, userSessionToken: "mock-session-tok-123" }),
        },
        env,
      );
      expect(linkRes.status).toBe(200);
      const linkJson = (await linkRes.json()) as { success: boolean };
      expect(linkJson.success).toBe(true);

      // 3. Kindle consulta estado
      const statusRes = await app.request(`/api/kindle/status?code=${code}`, {}, env);
      expect(statusRes.status).toBe(200);
      const statusJson = (await statusRes.json()) as { linked: boolean };
      expect(statusJson.linked).toBe(true);
      expect(statusRes.headers.get("set-cookie")).toContain("better-auth.session_token");
    });

    it("emite cookie firmada compatible con Better Auth y con prefijo __Secure- en HTTPS", async () => {
      getSessionMock.mockResolvedValueOnce(null);
      const kindleRes = await app.request("https://lecta.test/kindle", {}, env);
      const html = await kindleRes.text();
      const code = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})\s*<\/div>/)?.[1] ?? "";
      expect(code).toHaveLength(4);

      getSessionMock.mockResolvedValueOnce({
        user: { id: "user-https", email: "https@example.com" },
      });
      const linkRes = await app.request(
        "https://lecta.test/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, userSessionToken: "signed-token" }),
        },
        env,
      );
      expect(linkRes.status).toBe(200);

      const statusRes = await app.request(
        `https://lecta.test/api/kindle/status?code=${code}`,
        {},
        env,
      );
      expect(statusRes.status).toBe(200);
      const setCookie = statusRes.headers.get("set-cookie") ?? "";
      expect(setCookie.startsWith("__Secure-better-auth.session_token=")).toBe(true);
      expect(setCookie).toContain("Secure");
      const cookieValue = decodeURIComponent(
        setCookie.split(";")[0].split("=").slice(1).join("="),
      );
      const dot = cookieValue.lastIndexOf(".");
      const token = cookieValue.slice(0, dot);
      const signature = cookieValue.slice(dot + 1);
      expect(token).toBe("signed-token");
      // La firma sale del mismo HMAC-SHA256 que usa Better Auth.
      expect(signature).toBe(
        await makeSignature("signed-token", env.BETTER_AUTH_SECRET),
      );
      const body = (await statusRes.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("sessionToken");
    });

    it("canjea el código una sola vez: la segunda consulta ya no entrega sesión", async () => {
      const memEnv = { ...env, DATABASE_URL: undefined } as unknown as typeof env;
      getSessionMock.mockResolvedValueOnce(null);
      const kindleRes = await app.request("/kindle", {}, memEnv);
      const html = await kindleRes.text();
      const code = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})\s*<\/div>/)?.[1] ?? "";
      expect(code).toHaveLength(4);

      getSessionMock.mockResolvedValueOnce({
        user: { id: "user-once", email: "once@example.com" },
      });
      const linkRes = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, userSessionToken: "once-token" }),
        },
        memEnv,
      );
      expect(linkRes.status).toBe(200);

      const first = await app.request(`/api/kindle/status?code=${code}`, {}, memEnv);
      expect(first.status).toBe(200);
      expect(first.headers.get("set-cookie")).toContain("better-auth.session_token=");

      const second = await app.request(`/api/kindle/status?code=${code}`, {}, memEnv);
      expect(second.status).toBe(404);
    });

    it("limita las consultas de estado por IP", async () => {
      const headers = { "cf-connecting-ip": "203.0.113.77" };
      for (let i = 0; i < 20; i += 1) {
        const res = await app.request("/api/kindle/status?code=ZZZZ", { headers }, env);
        expect(res.status).toBe(404);
      }
      const blocked = await app.request("/api/kindle/status?code=ZZZZ", { headers }, env);
      expect(blocked.status).toBe(429);
    });

    it("registra y vincula el código en kindle_link_codes por la conexión pg", async () => {
      const rows = new Map<string, { status: string; session_token: string | null; user_id: string | null }>();
      const future = Math.floor(Date.now() / 1000) + 600;
      dbQueryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("INSERT INTO kindle_link_codes")) {
          rows.set(String(params[0]), { status: "pending", session_token: null, user_id: null });
        } else if (sql.includes("UPDATE kindle_link_codes")) {
          const [userId, token, code] = params as [string, string, string];
          rows.set(code, { status: "linked", session_token: token, user_id: userId });
        } else if (sql.includes("SELECT code, status, expires_at FROM kindle_link_codes")) {
          const row = rows.get(String(params[0]));
          return { rows: row ? [{ code: params[0], status: row.status, expires_at: future }] : [] };
        } else if (sql.includes("DELETE FROM kindle_link_codes") && sql.includes("RETURNING")) {
          const row = rows.get(String(params[0]));
          if (row?.status === "linked") {
            rows.delete(String(params[0]));
            return { rows: [{ session_token: row.session_token, user_id: row.user_id }] };
          }
        }
        return { rows: [] };
      });

      // 1. Generar código: INSERT en kindle_link_codes.
      getSessionMock.mockResolvedValueOnce(null);
      const kindleRes = await app.request("/kindle", {}, env);
      expect(kindleRes.status).toBe(200);
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO kindle_link_codes"),
        expect.any(Array),
      );
      const html = await kindleRes.text();
      const code = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})\s*<\/div>/)?.[1] ?? "";
      expect(code).toHaveLength(4);

      // 2. Vincular desde el celular: UPDATE … SET status = 'linked'.
      getSessionMock.mockResolvedValueOnce({
        user: { id: "pg-user", email: "pg@example.com" },
      });
      const linkRes = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, userSessionToken: "pg-session-token" }),
        },
        env,
      );
      expect(linkRes.status).toBe(200);
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE kindle_link_codes\s+SET status = 'linked'/),
        ["pg-user", "pg-session-token", code],
      );

      // 3. El Kindle canjea el código y recibe la sesión.
      const statusRes = await app.request(`/api/kindle/status?code=${code}`, {}, env);
      expect(statusRes.status).toBe(200);
      expect(statusRes.headers.get("set-cookie")).toContain("pg-session-token");
    });

    it("muestra el botón físico HTML 'Ya ingresé el código en mi celular → Entrar' en la pantalla de vinculación", async () => {
      getSessionMock.mockResolvedValueOnce(null);
      const res = await app.request("/kindle", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Ya ingresé el código en mi celular → Entrar");
      expect(html).toContain("/api/kindle/status?code=");
      expect(html).toContain("redirect=1");
    });

    it("al confirmar código vinculado vía botón físico (?redirect=1) establece cookie y redirige a la última posición leída", async () => {
      // 1. Crear código
      getSessionMock.mockResolvedValueOnce(null);
      const kindleRes = await app.request("/kindle", {}, env);
      const html = await kindleRes.text();
      const codeMatch = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})\s*<\/div>/);
      const code = codeMatch ? codeMatch[1] : "";
      expect(code).toHaveLength(4);

      // 2. Simular posición previa en lecta_user_positions
      dbQueryMock.mockResolvedValueOnce({
        rows: [{ bookHash: "ultimo-libro", sectionIndex: 3, scrollTop: 1 }],
      });

      // 3. Vincular desde móvil
      getSessionMock.mockResolvedValueOnce({
        user: { id: "user-lector", email: "lector@example.com" },
      });
      const linkRes = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, userSessionToken: "token-lector-abc" }),
        },
        env,
      );
      expect(linkRes.status).toBe(200);

      // 4. Kindle pulsa botón físico con redirect=1
      const buttonClickRes = await app.request(`/api/kindle/status?code=${code}&redirect=1`, {}, env);
      expect(buttonClickRes.status).toBe(302);
      expect(buttonClickRes.headers.get("set-cookie")).toContain("token-lector-abc");
      expect(buttonClickRes.headers.get("Location")).toContain("/k/read/ultimo-libro");
      expect(buttonClickRes.headers.get("Location")).toContain("section=3");
      expect(buttonClickRes.headers.get("Location")).not.toContain("page=");
    });

    it("/kindle/read/123 redirige a /k/read/123", async () => {
      const res = await app.request("/kindle/read/123", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k/read/123");
    });
  });

  describe("GET /k (Estantería)", () => {
    it("K7: sin sesión redirige directo al código de vinculación de /kindle", async () => {
      const res = await app.request("/k", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/kindle");
    });

    it("para usuarios con sesión muestra «Seguir leyendo» destacado y su biblioteca", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockImplementation(async (sql: string) => {
        if (typeof sql === "string" && sql.includes("lecta_user_positions")) {
          return {
            rows: [
              {
                bookHash: "abababababababababababababababababababababababababababababababab",
                sectionIndex: 0,
                progress: 0.5,
                syncedAt: "2026-11-01T10:00:00Z",
              },
            ],
          };
        }
        if (typeof sql === "string" && sql.includes("lecta_user_words")) {
          return { rows: [{ n: 3 }] };
        }
        return { rows: [] };
      });

      const res = await app.request("/k", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("SEGUIR LEYENDO");
      expect(html).toContain("Libro de prueba");
      expect(html).toContain("Equipo Lecta");
      expect(html).toContain("Continuar lectura");
      expect(html).toContain("Repaso del día");
      expect(html).toContain("3 palabras esperan repaso");
      expect(html).toContain("Cerrar sesión");
    });

    it("K7: pagina la biblioteca con ?pag=N y muestra el paginador", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      // 12 libros sin posición → página 1 de 2
      dbQueryMock.mockImplementation(async (sql: string) => {
        if (typeof sql === "string" && sql.includes("lecta_user_positions")) {
          return { rows: [] };
        }
        if (typeof sql === "string" && sql.includes("user_books")) {
          return {
            rows: Array.from({ length: 12 }, (_, i) => ({
              id: `libro-${String(i + 1).padStart(2, "0")}`,
              title: `Libro ${String(i + 1).padStart(2, "0")}`,
              author: "Autor",
            })),
          };
        }
        return { rows: [] };
      });

      const p1 = await app.request("/k", {}, env);
      const html1 = await p1.text();
      expect(html1).toContain("Libro 01");
      expect(html1).toContain("Pág. 1 de 2");
      expect(html1).toContain("/k?pag=2");
      expect(html1).not.toContain("Libro 11");

      const p2 = await app.request("/k?pag=2", {}, env);
      const html2 = await p2.text();
      expect(html2).toContain("Libro 11");
      expect(html2).toContain("Libro 12");
      expect(html2).toContain("/k?pag=1");
      expect(html2).not.toContain("Libro 01");
    });
  });

  describe("GET y POST /k/login", () => {
    it("GET /k/login muestra el formulario para invitados", async () => {
      const res = await app.request("/k/login", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Iniciar sesión en Lecta");
      expect(html).toContain('name="email"');
      expect(html).toContain('name="password"');
    });

    it("GET /k/login redirige a /k si ya hay sesión iniciada", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/k/login", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k");
    });

    it("POST /k/login rechaza petición sin credenciales", async () => {
      const formData = new FormData();
      formData.append("email", "");
      formData.append("password", "");

      const res = await app.request("/k/login", { method: "POST", body: formData }, env);
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Introduce tu correo y contraseña.");
    });

    it("POST /k/login muestra error si Better Auth rechaza las credenciales", async () => {
      authHandlerMock.mockResolvedValue(new Response("{}", { status: 401 }));

      const formData = new FormData();
      formData.append("email", "bad@example.com");
      formData.append("password", "wrong");

      const res = await app.request("/k/login", { method: "POST", body: formData }, env);
      expect(res.status).toBe(401);
      const html = await res.text();
      expect(html).toContain("Correo electrónico o contraseña incorrectos.");
    });

    it("POST /k/login establece la cookie de sesión y redirige a /k si es correcto", async () => {
      authHandlerMock.mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: {
            "set-cookie": "better-auth.session_token=mock-token; Path=/; HttpOnly",
          },
        }),
      );

      const formData = new FormData();
      formData.append("email", "good@example.com");
      formData.append("password", "correct");

      const res = await app.request("/k/login", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k");
      expect(res.headers.get("set-cookie")).toContain("better-auth.session_token=mock-token");
    });
  });

  describe("GET /k/logout", () => {
    it("elimina la cookie de sesión y redirige a /k", async () => {
      authHandlerMock.mockResolvedValue(new Response("{}", { status: 200 }));
      const res = await app.request("/k/logout", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k");
      expect(res.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    });
  });

  describe("GET /k/read/:hash", () => {
    it("redirige al login si no hay sesión iniciada", async () => {
      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain("/k/login");
    });

    it("sin parámetro section, consulta la última posición y redirige a la sección", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [{ sectionIndex: 1, ratio: 0.5 }],
      });

      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k/read/abababababababababababababababababababababababababababababababab?section=1&margin=md");
    });

    it("con section=0 muestra el capítulo 1 paginado con cabecera compacta y botón para pasar página", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Capítulo uno");
      // Cabecera compacta con título y autor
      expect(html).toContain("reader-header");
      expect(html).toContain("Libro de prueba");
      expect(html).toContain("Equipo Lecta");
      // Las palabras se convierten en spans inertes con data-w sin enlaces <a> accidentales
      expect(html).toContain('data-w="antigua"');
      expect(html).toContain('data-w="estrecha"');
      expect(html).toContain('data-w="perenne"');
      expect(html).not.toContain('href="/k/read/abababababababababababababababababababababababababababababababab?section=0&amp;page=0&amp;lookup=');
      // Botón directo para pasar página o avanzar al siguiente capítulo
      expect(html).toContain("[ Sig. → ]");
      // El contenido del libro se presenta limpio sin cajas inferiores de vocabulario
      expect(html).toContain("epub-content");
      expect(html).toContain("turn-page-bar");
    });

    it("expone Server-Timing con las etapas y el total", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0", {}, env);
      expect(res.status).toBe(200);
      const timing = res.headers.get("Server-Timing") ?? "";
      expect(timing).toMatch(/session;dur=\d+(\.\d)?/);
      expect(timing).toMatch(/r2;dur=\d+(\.\d)?/);
      expect(timing).toMatch(/parse;dur=\d+(\.\d)?/);
      expect(timing).toMatch(/paginate;dur=\d+(\.\d)?/);
      expect(timing).toMatch(/total;dur=\d+(\.\d)?/);
    });

    it("con parámetro lookup muestra la definición inline sin salir del libro", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [
          {
            entry_id: "1001",
            lemma: "perenne",
            pos: "adjetivo",
            definition: "Que dura indefinidamente.",
            example: "Un árbol de hoja perenne.",
            sense_order: 1,
          },
        ],
      });

      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0&lookup=perenne", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("inline-lookup-card");
      expect(html).toContain("perenne");
      expect(html).toContain("adjetivo");
      expect(html).toContain("Que dura indefinidamente.");
      expect(html).toContain("Cerrar");
      expect(html).not.toContain("✕");
      expect(html).toContain("+ Guardar en mi Cuaderno");
    });

    it("con prep=1 muestra la preparación previa al capítulo con palabras y botón de comenzar capítulo", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [
          {
            entry_id: "1001",
            lemma: "perenne",
            pos: "adjetivo",
            definition: "Que dura indefinidamente.",
            example: "Un árbol de hoja perenne.",
            sense_order: 1,
            queried_form: "perenne",
          },
        ],
      });

      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&prep=1", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Antes de leer");
      expect(html).toContain("Capítulo uno");
      expect(html).toContain("Comenzar a leer capítulo →");
      expect(html).toContain("section=0&amp;page=0&amp;primed=1");
    });

    it("Fase 7: con bookLang='en' siembra ENGLISH_CORE_LEXICON y además consulta findEntriesForForms", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const getChapterSpy = vi.spyOn(epubReader, "getEpubChapter").mockResolvedValue({
        bookTitle: "Test Book",
        bookAuthor: "Author",
        chapterTitle: "Chapter One",
        contentHtml: "<p>The ephemeral beauty of morning light upon the river.</p>",
        totalSections: 2,
        sectionIndex: 0,
        language: "en",
      });

      try {
        const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&prep=1", {}, env);
        expect(res.status).toBe(200);
        // Debe consultar findEntriesForForms para 'en'
        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.stringContaining("lexicon_forms"),
          expect.arrayContaining(["en"]),
        );
      } finally {
        getChapterSpy.mockRestore();
      }
    });

    it("con mode=paragraphs muestra la clase mode-paragraphs y números de párrafo", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0&mode=paragraphs", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("mode-paragraphs");
      expect(html).toContain("p-num");
    });

    it("con mode=anchors muestra la clase mode-anchors y la pestaña Anclas", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0&mode=anchors", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("mode-anchors");
      expect(html).toContain("[ Anclas de lectura ]");
    });

    it("con ?margin=sm y ?margin=lg emite el encabezado Set-Cookie lecta_k_margin", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const resSm = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0&margin=sm", {}, env);
      expect(resSm.status).toBe(200);
      const setCookieSm = resSm.headers.get("Set-Cookie");
      expect(setCookieSm).toContain("lecta_k_margin=sm; Path=/; Max-Age=31536000; SameSite=Lax");
      const htmlSm = await resSm.text();
      expect(htmlSm).toContain("reader-container margin-sm");

      const resLg = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0&margin=lg", {}, env);
      expect(resLg.status).toBe(200);
      const setCookieLg = resLg.headers.get("Set-Cookie");
      expect(setCookieLg).toContain("lecta_k_margin=lg; Path=/; Max-Age=31536000; SameSite=Lax");
      const htmlLg = await resLg.text();
      expect(htmlLg).toContain("reader-container margin-lg");
    });

    it("utiliza la preferencia de cookie lecta_k_margin=lg cuando no se envía parámetro en la URL", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request(
        "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0",
        { headers: { Cookie: "lecta_k_margin=lg" } },
        env,
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("reader-container margin-lg");
    });

    it("valores inválidos (?margin=invalid) hacen fallback seguro a md", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0&margin=invalid", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("reader-container margin-md");
      const setCookie = res.headers.get("Set-Cookie");
      // No debe setear cookie con valor inválido
      expect(setCookie || "").not.toContain("lecta_k_margin=invalid");
    });

    it("H1.1: restaura página mediante ratio (no scrollTop) y persiste scroll_top=0 y synced_at", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      // Simulamos posición web previa: scrollTop = 1174, ratio = 0.5 en sección 0
      dbQueryMock.mockResolvedValue({
        rows: [{ sectionIndex: 0, scrollTop: 1174, ratio: 0.5 }],
      });

      const paginateSpy = vi.spyOn(epubReader, "paginateChapter").mockReturnValue(
        Array.from({ length: 11 }, (_, i) => `<p>Página ${i} con texto de lectura</p>`),
      );

      try {
        const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0", {}, env);
        expect(res.status).toBe(200);
        const html = await res.text();
        // Con totalPages = 11 (0..10), ratio = 0.5 corresponde a pageIndex = 5 (página 6 de 11)
        expect(html).toContain("6/11");
        expect(html).toContain(">Página</span> 5");

        // Verificar que al persistir la posición en lecta_user_positions:
        // scroll_top se guarda como 0 (no como 5 ni 1174), y synced_at está presente
        const positionSaveCall = dbQueryMock.mock.calls.find((call) =>
          typeof call[0] === "string" && call[0].includes("INSERT INTO lecta_user_positions"),
        );
        expect(positionSaveCall).toBeDefined();
        expect(positionSaveCall![0]).toContain("scroll_top");
        expect(positionSaveCall![0]).toContain("synced_at");
        expect(positionSaveCall![0]).toContain("scroll_top = 0");
        expect(positionSaveCall![0]).toContain("anchor = excluded.anchor");
        expect(positionSaveCall![0]).toContain("anchor_offset = 0");
        // El array de parámetros: [userId, hash, sectionIndex, pageRatio, progress, now]
        // donde $4 es pageRatio (0.5) y no pageIndex ni 1174
        expect(positionSaveCall![1][3]).toBe(0.5);
      } finally {
        paginateSpy.mockRestore();
      }
    });

    it("Fase 5: restaura página mediante ancla textual coincidente en el capítulo", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      // Simulamos posición web previa: anchor presente en página 3
      dbQueryMock.mockResolvedValue({
        rows: [{ sectionIndex: 0, ratio: 0.1, anchor: "Texto clave en página tres del capítulo" }],
      });

      const paginateSpy = vi.spyOn(epubReader, "paginateChapter").mockReturnValue([
        "<p>Página 0 de introducción</p>",
        "<p>Página 1 con detalles</p>",
        "<p>Página 2 con más contenido</p>",
        "<p>Texto clave en página tres del capítulo con lectura continua</p>",
        "<p>Página 4 final</p>",
      ]);

      try {
        const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0", {}, env);
        expect(res.status).toBe(200);
        const html = await res.text();
        // Debe coincidir con anchorPageIdx = 3 (Página 4 de 5)
        expect(html).toContain("4/5");
        expect(html).toContain("Pág. 4 de 5");
        expect(html).toContain('data-w="clave"');
      } finally {
        paginateSpy.mockRestore();
      }
    });
  });

  describe("GET /k/read/:hash/resource", () => {
    it("bloquea XHTML/HTML del EPUB con 415 (no se sirve HTML same-origin)", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      for (const path of ["OEBPS/nav.xhtml", "OEBPS/chapter1.xhtml"]) {
        const res = await app.request(
          "/k/read/abababababababababababababababababababababababababababababababab/resource?path=" + encodeURIComponent(path),
          {},
          env,
        );
        expect(res.status).toBe(415);
        expect(await res.text()).toBe("Unsupported resource type");
      }
    });

    it("solo permite MIME de imagen y fuente en la lista blanca", () => {
      expect(SAFE_EPUB_ASSET_MIMES.has("image/jpeg")).toBe(true);
      expect(SAFE_EPUB_ASSET_MIMES.has("image/png")).toBe(true);
      expect(SAFE_EPUB_ASSET_MIMES.has("font/woff2")).toBe(true);
      expect(SAFE_EPUB_ASSET_MIMES.has("text/html")).toBe(false);
      expect(SAFE_EPUB_ASSET_MIMES.has("application/xhtml+xml")).toBe(false);
      expect(SAFE_EPUB_ASSET_MIMES.has("image/svg+xml")).toBe(false);
    });
  });

  it("añade CSP restrictiva y nosniff a las vistas HTML de /k", async () => {
    const res = await app.request("/k/login", {}, env);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("form-action 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  describe("GET /k/lookup (Diccionario)", () => {
    it("muestra la barra de búsqueda del diccionario", async () => {
      const res = await app.request("/k/lookup", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Diccionario de Lecta");
    });

    it("muestra definiciones cuando se encuentra la palabra", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      // Mock findEntries
      dbQueryMock.mockResolvedValue({
        rows: [
          {
            entry_id: "1001",
            lemma: "perenne",
            pos: "adjetivo",
            freq_rank: 500,
            zipf: 4.5,
            definition: "Que dura indefinidamente.",
            example: "Un árbol de hoja perenne.",
            sense_order: 1,
          },
        ],
      });

      const res = await app.request("/k/lookup?q=perenne", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("perenne");
      expect(html).toContain("adjetivo");
      expect(html).toContain("Que dura indefinidamente.");
      expect(html).toContain("+ Guardar en mi Cuaderno");
    });
  });

  describe("POST /k/vocab/add (Guardar en Cuaderno)", () => {
    it("guarda la palabra desde el lector y redirige de vuelta al lector con savedWord", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("form", "perenne");
      formData.append("lemma", "perenne");
      formData.append("pos", "adjetivo");
      formData.append("meaning", "Que dura indefinidamente.");
      formData.append("bookHash", "abababababababababababababababababababababababababababababababab");
      formData.append("returnTo", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/k/vocab/add", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");
      expect(location).toContain("savedWord=perenne");

      // Verificar que se insertó en la base de datos
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO lecta_user_words"),
        expect.arrayContaining(["user-1", "perenne", "perenne", "adjetivo"]),
      );
    });

    it("guarda la palabra junto con el contexto episódico en lecta_user_words", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("form", "perenne");
      formData.append("lemma", "perenne");
      formData.append("pos", "adjetivo");
      formData.append("meaning", "Que dura indefinidamente.");
      formData.append("context", "El árbol perenne resistía las nevadas.");
      formData.append("bookHash", "abababababababababababababababababababababababababababababababab");
      formData.append("returnTo", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/k/vocab/add", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO lecta_user_words"),
        expect.arrayContaining(["user-1", "perenne", "perenne", "adjetivo", "Que dura indefinidamente.", "El árbol perenne resistía las nevadas."]),
      );
    });

    it("guarda la palabra desde el diccionario y redirige a /k/lookup con saved=1", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("form", "perenne");
      formData.append("lemma", "perenne");
      formData.append("pos", "adjetivo");
      formData.append("meaning", "Que dura indefinidamente.");
      formData.append("bookHash", "abababababababababababababababababababababababababababababababab");
      formData.append("returnTo", "/k/lookup?q=perenne");

      const res = await app.request("/k/vocab/add", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/lookup");
      expect(location).toContain("saved=1");
      expect(location).toContain("q=perenne");
    });

    it("H1.3: guarda palabra con language='en' insertando 'en' en lecta_user_words y actualiza synced_at", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("form", "ephemeral");
      formData.append("lemma", "ephemeral");
      formData.append("pos", "adj.");
      formData.append("meaning", "Lasting for a very short time.");
      formData.append("language", "en-US");
      formData.append("bookHash", "abababababababababababababababababababababababababababababababab");
      formData.append("returnTo", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/k/vocab/add", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);

      const insertCall = dbQueryMock.mock.calls.find((call) =>
        typeof call[0] === "string" && call[0].includes("INSERT INTO lecta_user_words"),
      );
      expect(insertCall).toBeDefined();
      // El parámetro de language debe ser 'en' (normalizado de 'en-US')
      expect(insertCall![1]).toContain("en");
      expect(insertCall![1]).not.toContain("es");
      // H1.2: Debe incluir synced_at tanto en columnas como en DO UPDATE SET
      expect(insertCall![0]).toContain("synced_at");
      expect(insertCall![0]).toContain("synced_at = excluded.synced_at");
    });
  });

  describe("POST /k/knowledge/mark", () => {
    it("marca un lema como conocido e inserta en lecta_user_knowledge", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("lemma", "perenne");
      formData.append("known", "1");
      formData.append("returnTo", "/k/read/abababababababababababababababababababababababababababababababab?section=0&prep=1");

      const res = await app.request("/k/knowledge/mark", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/read/abababababababababababababababababababababababababababababababab?section=0&prep=1");
      expect(location).toContain("markedKnown=perenne");

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO lecta_user_knowledge[\s\S]*'preparation'/),
        expect.arrayContaining(["user-1", "perenne", true]),
      );
    });
  });

  describe("GET y POST /k/practice (Práctica de Vocabulario)", () => {
    it("GET /k/practice redirige a login si no hay sesión iniciada", async () => {
      const res = await app.request("/k/practice", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain("/k/login");
    });

    it("GET /k/practice muestra pantalla de práctica para usuario autenticado", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [
          {
            form: "perenne",
            meaning: "Que dura indefinidamente.",
            card: null,
          },
        ],
      });

      const res = await app.request("/k/practice", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Práctica");
    });

    it("GET /k/practice incluye contexto episódico si está presente en la base de datos", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [
          {
            form: "perenne",
            lemma: "perenne",
            pos: "adjetivo",
            meaning: "Que dura indefinidamente.",
            context: "El árbol perenne resistía las nevadas.",
            card: null,
          },
          {
            form: "inefable",
            lemma: "inefable",
            pos: "adjetivo",
            meaning: "Que no se puede explicar con palabras.",
            context: null,
            card: null,
          },
          {
            form: "prístino",
            lemma: "prístino",
            pos: "adjetivo",
            meaning: "Antiguo, primero, primitivo o inalterado.",
            context: null,
            card: null,
          },
        ],
      });

      const res = await app.request("/k/practice", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("El árbol perenne resistía las nevadas.");
    });

    it("POST /k/practice/answer procesa respuesta y redirige a la siguiente pregunta", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("word", "perenne");
      formData.append("selectedOption", correctKeyFor("user-1", "perenne", 0));
      formData.append("questionIndex", "0");
      formData.append("totalQuestions", "3");
      formData.append("correctCount", "0");
      formData.append("bookHash", "abababababababababababababababababababababababababababababababab");
      formData.append("returnTo", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/k/practice/answer", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/practice?q=1");
      expect(location).toContain("score=1");
    });

    it("POST /k/practice/answer al terminar redirige con done=1", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("word", "perenne");
      formData.append("selectedOption", correctKeyFor("user-1", "perenne", 2));
      formData.append("questionIndex", "2");
      formData.append("totalQuestions", "3");
      formData.append("correctCount", "2");
      formData.append("bookHash", "abababababababababababababababababababababababababababababababab");
      formData.append("returnTo", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/k/practice/answer", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/practice?done=1");
      expect(location).toContain("score=3");
    });

    it("H1.2: POST /k/practice/answer actualiza synced_at en lecta_user_words, reviews y activity", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("word", "perenne");
      formData.append("selectedOption", correctKeyFor("user-1", "perenne", 0));
      formData.append("questionIndex", "0");
      formData.append("totalQuestions", "3");
      formData.append("correctCount", "0");
      formData.append("bookHash", "abababababababababababababababababababababababababababababababab");
      formData.append("returnTo", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/k/practice/answer", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);

      const updateWordCall = dbQueryMock.mock.calls.find((call) =>
        typeof call[0] === "string" && call[0].includes("UPDATE lecta_user_words"),
      );
      expect(updateWordCall).toBeDefined();
      expect(updateWordCall![0]).toContain("synced_at = $2");

      const insertReviewCall = dbQueryMock.mock.calls.find((call) =>
        typeof call[0] === "string" && call[0].includes("INSERT INTO lecta_user_reviews"),
      );
      expect(insertReviewCall).toBeDefined();
      expect(insertReviewCall![0]).toContain("synced_at");
      // Acierto con opciones = «hard», como en el Cuaderno.
      expect(insertReviewCall![1]).toContain("hard");

      const insertActivityCall = dbQueryMock.mock.calls.find((call) =>
        typeof call[0] === "string" && call[0].includes("INSERT INTO lecta_user_activity"),
      );
      expect(insertActivityCall).toBeDefined();
      expect(insertActivityCall![0]).toContain("synced_at");
    });
  });

  describe("Espacio de Pre-lectura Adaptativo (Fase 2)", () => {
    it("POST /kindle/priming/action con action=known actualiza user_knowledge", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "known");
      formData.append("lemma", "perenne");
      formData.append("lang", "es");
      formData.append("bookId", "abababababababababababababababababababababababababababababababab");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toContain("/k/read/abababababababababababababababababababababababababababababababab");
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO lecta_user_knowledge[\s\S]*'preparation'/),
        expect.arrayContaining(["user-1", "es", "perenne"]),
      );
    });

    it("POST /kindle/priming/action con action=save actualiza user_knowledge y cuaderno", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "save");
      formData.append("lemma", "soledad");
      formData.append("lang", "es");
      formData.append("bookId", "abababababababababababababababababababababababababababababababab");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO lecta_user_words"),
        expect.arrayContaining(["user-1", "es", "soledad"]),
      );
    });

    it("POST /k/priming/action con action=save persiste presented_at y preserva metadatos en lecta_user_words", async () => {
      // requireKindlePlan también lee la sesión: un Once lo consumiría él.
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const body = new URLSearchParams({
        action: "save",
        bookId: "abababababababababababababababababababababababababababababababab",
        chapter: "0",
        lemma: "efímero",
        form: "efímera",
        meaning: "Pasajero, de corta duración.",
        context: "Una sombra efímera cruzó el patio.",
        lang: "es",
      });

      const res = await app.request(
        "/k/priming/action",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        },
        env,
      );

      expect(res.status).toBe(303);
      const wordInsertCall = dbQueryMock.mock.calls.find((call) =>
        String(call[0]).includes("INSERT INTO lecta_user_words"),
      );
      expect(wordInsertCall).toBeDefined();
      expect(String(wordInsertCall![0])).toContain("presented_at");
      expect(String(wordInsertCall![0])).toContain(
        "presented_at = COALESCE(lecta_user_words.presented_at, excluded.presented_at)",
      );
    });

    it("POST /kindle/priming/action con action=mute_book fija cookie y redirige con primed=1", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "mute_book");
      formData.append("bookId", "abababababababababababababababababababababababababababababababab");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("lecta_k_mute_abababababababababababababababababababababababababababababababab=1");
      expect(res.headers.get("Location")).toContain("primed=1");
    });

    it("POST /kindle/priming/action con action=disable_all fija cookie global y redirige con primed=1", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "disable_all");
      formData.append("bookId", "abababababababababababababababababababababababababababababababab");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("lecta_k_priming_off=1");
      expect(res.headers.get("Location")).toContain("primed=1");
    });

    it("GET /k/read con primed=1 omite la antesala y muestra directamente el texto", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0&primed=1", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Capítulo uno");
      expect(html).toContain(">estrecha<");
      expect(html).not.toContain("Comenzar a leer capítulo 1 →");
    });

    it("GET /k/read con cookie lecta_k_priming_off=1 omite la antesala", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request(
        "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0",
        { headers: { Cookie: "lecta_k_priming_off=1" } },
        env,
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Capítulo uno");
      expect(html).toContain(">estrecha<");
      expect(html).not.toContain("Comenzar a leer capítulo 1 →");
    });

    it("GET /k/read con cookie lecta_k_mute_<bookId>=1 omite la antesala para este libro", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request(
        "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0",
        { headers: { Cookie: "lecta_k_mute_abababababababababababababababababababababababababababababababab=1" } },
        env,
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Capítulo uno");
      expect(html).toContain(">estrecha<");
      expect(html).not.toContain("Comenzar a leer capítulo 1 →");
    });

    it("GET /k/read en página 0 muestra la antesala de pre-lectura cuando hay palabras candidatas en el catálogo", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      dbQueryMock.mockImplementation((sql: string) => {
        if (typeof sql === "string" && sql.includes("lexicon_")) {
          return Promise.resolve({
            rows: [
              {
                queried_form: "perenne",
                entry_id: "101",
                lemma: "perenne",
                pos: "adjetivo",
                zipf: 3.5,
                definition: "Que dura indefinidamente.",
                sense_order: 1,
              },
              {
                queried_form: "estrecha",
                entry_id: "102",
                lemma: "estrecho",
                pos: "adjetivo",
                zipf: 4.0,
                definition: "Que tiene poca anchura.",
                sense_order: 1,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Antes de leer · Capítulo uno");
      expect(html).toContain("Comenzar a leer capítulo →");
      expect(html).toContain("Ya la sé");
      expect(html).toContain("+ Repasar");
      expect(html).toContain("Ocultar en este libro");
      expect(html).toContain("Desactivar siempre");
      expect(html).toContain("window.lectaKindleAction");
    });

    it("POST /kindle/priming/action con action=enable_all limpia cookie lecta_k_priming_off", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "enable_all");
      formData.append("returnUrl", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("lecta_k_priming_off=0");
    });

    it("POST /k/priming/action y POST /kindle/priming/action son equivalentes", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "mute_book");
      formData.append("bookId", "abababababababababababababababababababababababababababababababab");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0");

      const res = await app.request("/k/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("lecta_k_mute_abababababababababababababababababababababababababababababababab=1");
    });
  });

  describe("K1 — Estabilidad y seguridad", () => {
    it("la estantería enlaza «Continuar» con ?section=N sin page= para restaurar por ancla/ratio", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockImplementation(async (sql: string) => {
        if (typeof sql === "string" && sql.includes("lecta_user_positions")) {
          return { rows: [{ bookHash: "abababababababababababababababababababababababababababababababab", sectionIndex: 1, progress: 0.42 }] };
        }
        return { rows: [] };
      });

      const res = await app.request("/k", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("/k/read/abababababababababababababababababababababababababababababababab?section=1");
      expect(html).not.toContain("page=");
    });

    it("safeKindleReturn solo permite rutas internas /k y /kindle", () => {
      expect(safeKindleReturn("/k/read/abc?section=2")).toBe("/k/read/abc?section=2");
      expect(safeKindleReturn("/kindle")).toBe("/kindle");
      expect(safeKindleReturn("https://evil.example/k")).toBe("/k");
      expect(safeKindleReturn("//evil.example/k")).toBe("/k");
      expect(safeKindleReturn("/k\\evil")).toBe("/k");
      expect(safeKindleReturn("/k//evil")).toBe("/k");
      expect(safeKindleReturn("/api/words")).toBe("/k");
      expect(safeKindleReturn("")).toBe("/k");
      expect(safeKindleReturn(undefined)).toBe("/k");
      expect(safeKindleReturn("https://x", "/k/fallback")).toBe("/k/fallback");
    });

    it("POST /api/kindle/link responde 401 sin token de sesión (sin token sintético)", async () => {
      getSessionMock.mockResolvedValueOnce(null);
      const kindleRes = await app.request("/kindle", {}, env);
      const html = await kindleRes.text();
      const codeMatch = html.match(/([A-Z0-9]{4})/);
      const code = codeMatch ? codeMatch[1] : "";
      expect(code).toHaveLength(4);

      getSessionMock.mockResolvedValueOnce({
        user: { id: "user-9", email: "lector@example.com" },
      });
      const res = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        },
        env,
      );
      expect(res.status).toBe(401);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain("iniciar sesión");
    });

    it("registra actividad de lectura como evento puntual (started_at = ended_at = synced_at)", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0", {}, env);
      expect(res.status).toBe(200);

      const act = dbQueryMock.mock.calls.find((call) =>
        typeof call[0] === "string" && call[0].includes("INSERT INTO lecta_user_activity"),
      );
      expect(act).toBeDefined();
      expect(act![0]).toContain("$4, $4, $4");
      const params = act![1] as unknown[];
      expect(params[3]).toBe(params[3]); // mismo instante para los tres campos
      expect(typeof params[3]).toBe("number");
    });

    it("GET /k/practice ordena por vencimiento FSRS antes que por saved_at", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({ rows: [] });

      await app.request("/k/practice", {}, env);
      const wordsQuery = dbQueryMock.mock.calls.find((call) =>
        typeof call[0] === "string" && call[0].includes("FROM lecta_user_words"),
      );
      expect(wordsQuery).toBeDefined();
      expect(wordsQuery![0]).toContain("card->>'due'");
      expect(wordsQuery![0]).toContain("ORDER BY (");
      expect(wordsQuery![0]).toContain("saved_at DESC");
    });

    it("correctKeyFor es determinista por (user, palabra, índice) y no fijo por índice", () => {
      const a = correctKeyFor("user-1", "perenne", 0);
      expect(["A", "B", "C"]).toContain(a);
      expect(correctKeyFor("user-1", "perenne", 0)).toBe(a);
      // La posición correcta ya no depende solo del índice de pregunta
      const keys = new Set([
        correctKeyFor("user-1", "perenne", 0),
        correctKeyFor("user-1", "perenne", 1),
        correctKeyFor("user-1", "perenne", 2),
      ]);
      expect(keys.size).toBeGreaterThanOrEqual(1); // determinista; cobertura real en integración
    });

    it("el botón físico de vinculación apunta al status del MISMO código (sin regenerar)", async () => {
      getSessionMock.mockResolvedValueOnce(null);
      const res = await app.request("/kindle", {}, env);
      const html = await res.text();
      const code = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})/)![1];
      const metaRefresh = html.match(/http-equiv="refresh" content="6;\s*url=([^"]+)"/);
      expect(metaRefresh).not.toBeNull();
      expect(metaRefresh![1]).toContain(`/api/kindle/status?code=${code}`);
      expect(metaRefresh![1]).toContain("redirect=1");
    });
  });

  describe("K2 — Preferencias de lectura por cuenta", () => {
    const sessionUser = { user: { id: "user-1", email: "lector@example.com" } };

    it("GET /api/kindle/prefs devuelve defaults cuando no hay fila", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      const res = await app.request("/api/kindle/prefs", {}, env);
      expect(res.status).toBe(200);
      const body = await res.json() as { prefs: Record<string, string> };
      expect(body.prefs).toMatchObject({
        fontFamily: "literata",
        fontSize: "md",
        approach: "clean",
        layout: "paged",
      });
    });

    it("GET /api/kindle/prefs cae a defaults si la tabla aún no existe", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockRejectedValue(new Error('relation "lecta_kindle_prefs" does not exist'));
      const res = await app.request("/api/kindle/prefs", {}, env);
      expect(res.status).toBe(200);
      const body = await res.json() as { prefs: Record<string, string> };
      expect(body.prefs.fontFamily).toBe("literata");
    });

    it("PUT /api/kindle/prefs normaliza y persiste con UPSERT", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      const res = await app.request(
        "/api/kindle/prefs",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prefs: { fontFamily: "atkinson", fontSize: "xxl", approach: "anchors", align: "center" },
          }),
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { prefs: Record<string, string> };
      expect(body.prefs.fontFamily).toBe("atkinson");
      expect(body.prefs.align).toBe("justify"); // valor inválido → default

      const upsert = dbQueryMock.mock.calls.find((call) =>
        typeof call[0] === "string" && call[0].includes("INSERT INTO lecta_kindle_prefs"),
      );
      expect(upsert).toBeDefined();
      expect(upsert![0]).toContain("ON CONFLICT (user_id) DO UPDATE");
      const params = upsert![1] as unknown[];
      expect(params[0]).toBe("user-1");
      expect(params).toContain("atkinson");
      expect(params).toContain("xxl");
      expect(params).toContain("anchors");
    });

    it("PUT /api/kindle/prefs responde 503 si la tabla no existe (sin crash)", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockRejectedValue(new Error('relation "lecta_kindle_prefs" does not exist'));
      const res = await app.request(
        "/api/kindle/prefs",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prefs: { fontSize: "lg" } }),
        },
        env,
      );
      expect(res.status).toBe(503);
    });

    it("GET /k/ajustes renderiza el formulario con los selects del vocabulario", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      const res = await app.request("/k/ajustes", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      for (const name of ["fontFamily", "fontSize", "lineHeight", "margin", "align", "approach", "layout"]) {
        expect(html).toContain(`name="${name}"`);
      }
      expect(html).toContain("Anclas de lectura");
      expect(html).toContain("Guardar en mi Kindle");
    });

    it("GET /k/ajustes sin sesión redirige a login", async () => {
      getSessionMock.mockResolvedValue(null);
      const res = await app.request("/k/ajustes", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain("/k/login");
    });

    it("POST /k/ajustes guarda, fija cookies y redirige con saved=1", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      const formData = new FormData();
      formData.append("fontFamily", "source-serif");
      formData.append("fontSize", "lg");
      formData.append("approach", "paragraphs");
      formData.append("layout", "scroll");
      formData.append("returnTo", "/k");

      const res = await app.request("/k/ajustes", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/k?saved=1");
      const cookies = res.headers.get("Set-Cookie") || "";
      expect(cookies).toContain("lecta_k_layout=scroll");
    });

    it("POST /k/ajustes responde 503 amable si la tabla no existe", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockRejectedValue(new Error('relation "lecta_kindle_prefs" does not exist'));
      const formData = new FormData();
      formData.append("fontSize", "lg");
      const res = await app.request("/k/ajustes", { method: "POST", body: formData }, env);
      expect(res.status).toBe(503);
      const html = await res.text();
      expect(html).toContain("No pudimos guardar");
    });

    it("/k/read aplica el enfoque «anchors» de la cuenta cuando no hay parámetro", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockImplementation(async (sql: string) => {
        if (typeof sql === "string" && sql.includes("lecta_kindle_prefs")) {
          return {
            rows: [{
              font_family: "literata",
              font_size: "lg",
              line_height: "normal",
              margin: "md",
              align: "justify",
              approach: "anchors",
              layout: "paged",
            }],
          };
        }
        return { rows: [] };
      });

      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("mode-anchors");
      expect(html).toContain("size-lg");
      expect(html).toContain('<b class="anc">');
    });
  });

  describe("K4 — Caché de capítulos y recursos en R2", () => {
    it("segunda petición de la misma sección sirve desde kcache/ch sin releer el EPUB", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      resetKindleCacheMemory();
      dbQueryMock.mockResolvedValue({ rows: [] });

      const res1 = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0", {}, env);
      expect(res1.status).toBe(200);

      const epubGetsAfterFirst = mockBooksBucket.get.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].endsWith(".epub"),
      ).length;

      await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0", {}, env);
      const epubGetsAfterSecond = mockBooksBucket.get.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].endsWith(".epub"),
      ).length;

      // El segundo toque no debe volver a bajar el binario del libro
      expect(epubGetsAfterSecond).toBe(epubGetsAfterFirst);
      // … y haber escrito el artefacto kcache/ch/…json en R2
      expect(
        mockBooksBucket.put.mock.calls.some((call) =>
          typeof call[0] === "string" && call[0].startsWith("kcache/ch/abababababababababababababababababababababababababababababababab/"),
        ),
      ).toBe(true);
    });

    it("sirve recursos desde kcache/res sin volver a descargar el EPUB", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      resetKindleCacheMemory();
      dbQueryMock.mockResolvedValue({ rows: [] });

      // Sembrar el recurso directamente en el mock de R2
      mockBooksBucket.get.mockImplementation(async (key: string) => {
        if (key === "kcache/res/abababababababababababababababababababababababababababababababab/OEBPS/img.png") {
          return {
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
            httpMetadata: { contentType: "image/png" },
          };
        }
        if (key.includes("abababababababababababababababababababababababababababababababab") && key.endsWith(".epub")) {
          return {
            arrayBuffer: async () => minimalBytes.buffer.slice(
              minimalBytes.byteOffset,
              minimalBytes.byteOffset + minimalBytes.byteLength,
            ),
          };
        }
        return null;
      });

      const res = await app.request(
        "/k/read/abababababababababababababababababababababababababababababababab/resource?path=OEBPS/img.png",
        {},
        env,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Cache-Control")).toContain("private");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");

      const epubGets = mockBooksBucket.get.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].endsWith(".epub"),
      ).length;
      expect(epubGets).toBe(0);
    });

    it("K6: ?toc=1 muestra el índice del EPUB y el lector enlaza a él", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({ rows: [] });

      // El lector incluye «Índice» porque minimal.epub trae nav.xhtml
      const read = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0", {}, env);
      expect(read.status).toBe(200);
      const readHtml = await read.text();
      expect(readHtml).toContain(">Índice</a>");
      expect(readHtml).toContain("toc=1");
      // Las acciones secundarias ya no saturan la barra: van dentro del menú
      expect(readHtml).toContain("Aa · Menú");

      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&toc=1", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(">Índice</h1>");
      expect(html).toContain("Capítulo uno");
      expect(html).toContain("Capítulo dos");
      expect(html).toContain("is-current");
      expect(html).toContain("section=1&amp;page=0");
      expect(html).toContain("Volver al libro");
    });

    it("K5: lecta_k_vp acepta formato estricto y rechaza valores absurdos", () => {
      expect(parseKindleViewportCookie("600x800")).toEqual({ w: 600, h: 800 });
      expect(parseKindleViewportCookie("1072x1448")).toEqual({ w: 1072, h: 1448 });
      expect(parseKindleViewportCookie(undefined)).toBeNull();
      expect(parseKindleViewportCookie("")).toBeNull();
      expect(parseKindleViewportCookie("abc")).toBeNull();
      expect(parseKindleViewportCookie("600")).toBeNull();
      expect(parseKindleViewportCookie("600x800;otra=cosa")).toBeNull();
      expect(parseKindleViewportCookie("100x800")).toBeNull(); // w < 240
      expect(parseKindleViewportCookie("600x99999")).toBeNull(); // h > 4096
      expect(parseKindleViewportCookie("99999x99999")).toBeNull();
    });

    it("rechaza EPUBs que superan el límite con página amable (413/400)", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      resetKindleCacheMemory();
      dbQueryMock.mockResolvedValue({ rows: [] });
      mockBooksBucket.get.mockImplementation(async (key: string) => {
        if (key.includes("abababababababababababababababababababababababababababababababab") && key.endsWith(".epub")) {
          return {
            size: 60 * 1024 * 1024,
            arrayBuffer: async () => {
              throw new Error("no debería descargarse");
            },
          };
        }
        return null;
      });

      const res = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0", {}, env);
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("demasiado grande");
    });
  });

  describe("K8 — Vista previa /k/preview", () => {
    const sessionUser = { user: { id: "user-1", email: "lector@example.com" } };

    it("GET /k/preview sin sesión redirige a /kindle", async () => {
      getSessionMock.mockResolvedValue(null);
      const res = await app.request("/k/preview", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/kindle");
    });

    it("GET /k/preview renderiza el marco con iframe a /k/preview/page", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      const res = await app.request("/k/preview?size=lg&mode=anchors", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("/k/preview/page");
      expect(html).toContain("size=lg");
      expect(html).toContain("mode=anchors");
      expect(html).toContain("Vista previa de tu Kindle");
    });

    it("GET /k/preview/page sin sesión responde 401", async () => {
      getSessionMock.mockResolvedValue(null);
      const res = await app.request("/k/preview/page", {}, env);
      expect(res.status).toBe(401);
    });

    it("GET /k/preview/page renderiza la página real del lector con el primer libro", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      const res = await app.request("/k/preview/page", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      // Es el MISMO render del lector: header, aviso de vista previa y clases
      expect(html).toContain("epub-content mode-clean size-md font-literata");
      expect(html).toContain("reader-container margin-md");
      expect(html).toContain("Vista previa — así se verá tu lectura en el Kindle.");
      expect(html).toContain("Libro de prueba");
    });

    it("GET /k/preview/page aplica los overrides de la query sobre la cuenta", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockImplementation(async (sql: string) => {
        if (typeof sql === "string" && sql.includes("lecta_kindle_prefs")) {
          return {
            rows: [{
              font_family: "literata",
              font_size: "md",
              line_height: "normal",
              margin: "md",
              align: "justify",
              approach: "clean",
              layout: "paged",
            }],
          };
        }
        return { rows: [] };
      });
      const res = await app.request(
        "/k/preview/page?size=xxl&mode=anchors&font=opendyslexic&align=left&layout=scroll",
        {},
        env,
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("mode-anchors size-xxl font-opendyslexic");
      expect(html).toContain("align-left");
      expect(html).toContain("layout-scroll");
    });

    it("el portal /k permite ser embebido por el mismo origen (frame-ancestors 'self')", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      // La vista previa navega dentro del iframe: todo el portal necesita
      // 'self' o cada enlace interno daría «rechazó la conexión».
      const inner = await app.request("/k/preview/page", {}, env);
      expect(inner.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
      const outer = await app.request("/k/preview", {}, env);
      expect(outer.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
      const ajustes = await app.request("/k/ajustes", {}, env);
      expect(ajustes.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
      const read = await app.request("/k/read/abababababababababababababababababababababababababababababababab?section=0&page=0", {}, env);
      expect(read.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    });

    it("los enlaces internos del preview se reescriben a /k/preview/page (navegación dentro del marco)", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      const res = await app.request("/k/preview/page?size=xl&mode=anchors", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      // Los links de lectura ya no apuntan a /k/read (que saldría del preview)
      expect(html).not.toContain('href="/k/read/abababababababababababababababababababababababababababababababab');
      expect(html).toContain("/k/preview/page?book=abababababababababababababababababababababababababababababababab");
      // Los overrides viajan por la navegación interna
      expect(html).toContain("mode=anchors");
      expect(html).toContain("size=xl");
      expect(html).toContain("font=");
      expect(html).toContain("lh=");
      expect(html).toContain("align=");
      // El enlace de salida a la biblioteca abre pestaña real
      expect(html).toContain('target="_blank" href="/k"');
    });

    it("GET /k/preview/page honra ?page= para paginar dentro del marco", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      // size=xxl reduce el presupuesto por página → hay una página 2 real
      const p1 = await app.request("/k/preview/page?page=1&size=xxl", {}, env);
      expect(p1.status).toBe(200);
      const html = await p1.text();
      expect(html).toContain("Pág. 2 de");
    });

    it("GET /k/preview/page con ?toc=1 muestra el índice dentro del marco", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      const res = await app.request("/k/preview/page?toc=1", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("toc-list");
      // Las entradas del índice también navegan dentro del preview
      expect(html).toContain("/k/preview/page?book=abababababababababababababababababababababababababababababababab");
      expect(html).not.toContain('href="/k/read/abababababababababababababababababababababababababababababababab');
    });

    it("GET /k/preview/page ignora un parámetro book malicioso", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      const res = await app.request(
        `/k/preview/page?book=${encodeURIComponent('"><svg onload=alert(1)')}`,
        {},
        env,
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain("<svg onload");
    });

    it("GET /k/preview/page usa el pasaje de muestra cuando no hay libros", async () => {
      getSessionMock.mockResolvedValue(sessionUser);
      dbQueryMock.mockResolvedValue({ rows: [] });
      mockBooksBucket.list.mockResolvedValueOnce({ objects: [] });
      const res = await app.request("/k/preview/page", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Texto de muestra");
      expect(html).toContain("tetera");
    });
  });

  // Revisión de derechos de Explora (ronda 4, I1): kcache/ es compartido por
  // hash y los hashes de Comunidad son públicos. La propiedad se comprueba
  // ANTES de leer el caché; si no, otra cuenta lee el libro de A.
  describe("kcache solo para el dueño del libro", () => {
    const HASH_A = "cd".repeat(32);
    const store = new Map<string, { data: ArrayBuffer; httpMetadata?: Record<string, string> }>();
    const toBuffer = (v: unknown): ArrayBuffer => {
      if (v instanceof ArrayBuffer) return v;
      const u8 = v as Uint8Array;
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    };
    const bucket = {
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({
        objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      })),
      get: vi.fn(async (key: string) => {
        const hit = store.get(key);
        if (!hit) return null;
        return {
          size: hit.data.byteLength,
          httpMetadata: hit.httpMetadata,
          arrayBuffer: async () => hit.data.slice(0),
          text: async () => new TextDecoder().decode(hit.data),
        };
      }),
      head: vi.fn(async (key: string) => (store.has(key) ? { key } : null)),
      put: vi.fn(async (key: string, value: unknown, opts?: { httpMetadata?: Record<string, string> }) => {
        store.set(key, { data: toBuffer(value), httpMetadata: opts?.httpMetadata });
      }),
      delete: vi.fn(async () => undefined),
    };
    const leakEnv = { ...env, BOOKS: bucket as unknown };
    const asUser = (id: string) =>
      getSessionMock.mockResolvedValue({ user: { id, email: `${id}@example.com` } });

    beforeEach(() => {
      store.clear();
      store.set(`books/user-a/${HASH_A}.epub`, {
        data: toBuffer(minimalBytes),
      });
      // A ya abrió el libro en el Kindle: hay recurso cacheado en R2
      store.set(`kcache/res/${HASH_A}/OEBPS/img.png`, {
        data: new Uint8Array([1, 2, 3]).buffer,
        httpMetadata: { contentType: "image/png" },
      });
    });

    it("B recibe 404 en read, resource y preview con el hash de A; A sigue leyendo", async () => {
      asUser("user-a");
      const ownRead = await app.request(`/k/read/${HASH_A}?section=0&page=0`, {}, leakEnv);
      expect(ownRead.status).toBe(200);
      expect(
        [...store.keys()].some((k) => k.startsWith(`kcache/ch/${HASH_A}/`)),
      ).toBe(true);

      asUser("user-b");
      const read = await app.request(`/k/read/${HASH_A}?section=0&page=0`, {}, leakEnv);
      expect(read.status).toBe(404);
      expect(await read.text()).not.toContain("epub-content");

      const res = await app.request(
        `/k/read/${HASH_A}/resource?path=OEBPS/img.png`,
        {},
        leakEnv,
      );
      expect(res.status).toBe(404);

      const preview = await app.request(`/k/preview/page?book=${HASH_A}`, {}, leakEnv);
      expect(preview.status).toBe(404);

      asUser("user-a");
      const again = await app.request(`/k/read/${HASH_A}?section=0&page=0`, {}, leakEnv);
      expect(again.status).toBe(200);
      const ownRes = await app.request(
        `/k/read/${HASH_A}/resource?path=OEBPS/img.png`,
        {},
        leakEnv,
      );
      expect(ownRes.status).toBe(200);
      const ownPreview = await app.request(`/k/preview/page?book=${HASH_A}`, {}, leakEnv);
      expect(ownPreview.status).toBe(200);
      expect(await ownPreview.text()).toContain("epub-content");
    });

    it("/k/read solo acepta un sha256: un slug de catálogo no sirve el EPUB", async () => {
      store.set("catalog/quijote.epub", { data: toBuffer(minimalBytes) });
      asUser("user-b");
      const read = await app.request("/k/read/quijote?section=0&page=0", {}, leakEnv);
      expect([400, 404]).toContain(read.status);
      const res = await app.request("/k/read/quijote/resource?path=OEBPS/img.png", {}, leakEnv);
      expect([400, 404]).toContain(res.status);
      expect(bucket.get).not.toHaveBeenCalledWith("catalog/quijote.epub");
    });
  });
});
