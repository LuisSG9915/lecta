import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeSignature } from "better-auth/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import {
  memoryCodeStore,
  resetKindleStatusLimiter,
  SAFE_EPUB_ASSET_MIMES,
} from "./routes";

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
          key: "books/user-1/mock-hash-1.epub",
          customMetadata: {
            title: "Libro de prueba",
            author: "Equipo Lecta",
            sections: "2",
          },
        },
      ],
    })),
    get: vi.fn(async (key: string) => {
      if (key.includes("mock-hash-1")) {
        return {
          arrayBuffer: async () => minimalBytes.buffer.slice(
            minimalBytes.byteOffset,
            minimalBytes.byteOffset + minimalBytes.byteLength,
          ),
        };
      }
      return null;
    }),
  };

  const env = {
    DATABASE_URL: "postgres://mock",
    BETTER_AUTH_SECRET: "test-secret-for-signed-kindle-cookie",
    BOOKS: mockBooksBucket as unknown,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    memoryCodeStore.clear();
    resetKindleStatusLimiter();
    getSessionMock.mockResolvedValue(null);
    dbQueryMock.mockResolvedValue({ rows: [] });
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

    it("utiliza c.env.DB cuando está disponible para registrar y vincular códigos D1", async () => {
      const mockD1Rows = new Map<string, Record<string, unknown>>();
      const mockDb = {
        prepare: vi.fn((sql: string) => ({
          bind: (...args: unknown[]) => ({
            run: vi.fn(async () => {
              if (sql.includes("INSERT INTO kindle_link_codes")) {
                mockD1Rows.set(args[0] as string, {
                  code: args[0],
                  status: "pending",
                  created_at: Math.floor(Date.now() / 1000),
                });
              } else if (sql.includes("UPDATE kindle_link_codes")) {
                const [userId, userToken, code] = args;
                const existing = mockD1Rows.get(code as string) || { code };
                mockD1Rows.set(code as string, {
                  ...existing,
                  status: "linked",
                  user_id: userId,
                  session_token: userToken,
                });
              }
              return { success: true };
            }),
            first: vi.fn(async () => {
              const code = args[0] as string;
              return mockD1Rows.get(code) || null;
            }),
          }),
        })),
      };

      const d1Env = {
        ...env,
        DB: mockDb as unknown as D1Database,
      };

      // 1. Generar código con D1
      getSessionMock.mockResolvedValueOnce(null);
      const kindleRes = await app.request("/kindle", {}, d1Env);
      expect(kindleRes.status).toBe(200);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO kindle_link_codes"),
      );

      const html = await kindleRes.text();
      const codeMatch = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})\s*<\/div>/);
      const code = codeMatch ? codeMatch[1] : "";
      expect(code).toHaveLength(4);

      // 2. Vincular código
      getSessionMock.mockResolvedValueOnce({
        user: { id: "d1-user", email: "d1@example.com" },
      });
      const linkRes = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, userSessionToken: "d1-session-token" }),
        },
        d1Env,
      );
      expect(linkRes.status).toBe(200);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE kindle_link_codes"),
      );

      // 3. Consultar estado desde Kindle
      const statusRes = await app.request(`/api/kindle/status?code=${code}`, {}, d1Env);
      expect(statusRes.status).toBe(200);
      const statusJson = (await statusRes.json()) as { linked: boolean };
      expect(statusJson.linked).toBe(true);
      expect(statusRes.headers.get("set-cookie")).toContain("d1-session-token");
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
      expect(buttonClickRes.headers.get("Location")).toContain("page=1");
    });

    it("/kindle/read/123 redirige a /k/read/123", async () => {
      const res = await app.request("/kindle/read/123", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k/read/123");
    });
  });

  describe("GET /k (Estantería)", () => {
    it("para usuarios no autenticados muestra la bienvenida y el enlace para entrar", async () => {
      const res = await app.request("/k", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Lecta para Kindle y E-ink");
      expect(html).toContain("Iniciar sesión");
    });

    it("para usuarios con sesión muestra su lista de libros y progreso", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [{ bookHash: "mock-hash-1", sectionIndex: 0, progress: 0.5 }],
      });

      const res = await app.request("/k", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Mis Libros");
      expect(html).toContain("Libro de prueba");
      expect(html).toContain("Equipo Lecta");
      expect(html).toContain("Continuar lectura");
      expect(html).toContain("Cerrar sesión");
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
      const res = await app.request("/k/read/mock-hash-1", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain("/k/login");
    });

    it("sin parámetro section, consulta la última posición y redirige incluyendo la página", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [{ sectionIndex: 1, scrollTop: 2 }],
      });

      const res = await app.request("/k/read/mock-hash-1", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k/read/mock-hash-1?section=1&page=2&margin=md");
    });

    it("con section=0 muestra el capítulo 1 paginado con cabecera compacta y botón para pasar página", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request("/k/read/mock-hash-1?section=0", {}, env);
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
      expect(html).not.toContain('href="/k/read/mock-hash-1?section=0&amp;page=0&amp;lookup=');
      // Botón directo para pasar página o avanzar al siguiente capítulo
      expect(html).toContain("[ Sig. → ]");
      // El contenido del libro se presenta limpio sin cajas inferiores de vocabulario
      expect(html).toContain("epub-content");
      expect(html).toContain("turn-page-bar");
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

      const res = await app.request("/k/read/mock-hash-1?section=0&page=0&lookup=perenne", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("inline-lookup-card");
      expect(html).toContain("perenne");
      expect(html).toContain("adjetivo");
      expect(html).toContain("Que dura indefinidamente.");
      expect(html).toContain("✕ Cerrar");
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

      const res = await app.request("/k/read/mock-hash-1?section=0&prep=1", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Antes de leer");
      expect(html).toContain("Capítulo uno");
      expect(html).toContain("Comenzar capítulo 1 →");
      expect(html).toContain("section=0&amp;page=0");
    });

    it("con mode=paragraphs muestra la clase mode-paragraphs y números de párrafo", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/k/read/mock-hash-1?section=0&page=0&mode=paragraphs", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("mode-paragraphs");
      expect(html).toContain("p-num");
    });

    it("con mode=lexicon muestra la clase mode-lexicon", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/k/read/mock-hash-1?section=0&page=0&mode=lexicon", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("mode-lexicon");
      expect(html).toContain("[ Modo Léxico ]");
    });

    it("con ?margin=sm y ?margin=lg emite el encabezado Set-Cookie lecta_k_margin", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const resSm = await app.request("/k/read/mock-hash-1?section=0&page=0&margin=sm", {}, env);
      expect(resSm.status).toBe(200);
      const setCookieSm = resSm.headers.get("Set-Cookie");
      expect(setCookieSm).toContain("lecta_k_margin=sm; Path=/; Max-Age=31536000; SameSite=Lax");
      const htmlSm = await resSm.text();
      expect(htmlSm).toContain("reader-container margin-sm");

      const resLg = await app.request("/k/read/mock-hash-1?section=0&page=0&margin=lg", {}, env);
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
        "/k/read/mock-hash-1?section=0&page=0",
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

      const res = await app.request("/k/read/mock-hash-1?section=0&page=0&margin=invalid", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("reader-container margin-md");
      const setCookie = res.headers.get("Set-Cookie");
      // No debe setear cookie con valor inválido
      expect(setCookie || "").not.toContain("lecta_k_margin=invalid");
    });
  });

  describe("GET /k/read/:hash/resource", () => {
    it("bloquea XHTML/HTML del EPUB con 415 (no se sirve HTML same-origin)", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      for (const path of ["OEBPS/nav.xhtml", "OEBPS/chapter1.xhtml"]) {
        const res = await app.request(
          "/k/read/mock-hash-1/resource?path=" + encodeURIComponent(path),
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
      formData.append("bookHash", "mock-hash-1");
      formData.append("returnTo", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/k/vocab/add", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/read/mock-hash-1?section=0&page=0");
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
      formData.append("bookHash", "mock-hash-1");
      formData.append("returnTo", "/k/read/mock-hash-1?section=0&page=0");

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
      formData.append("bookHash", "mock-hash-1");
      formData.append("returnTo", "/k/lookup?q=perenne");

      const res = await app.request("/k/vocab/add", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/lookup");
      expect(location).toContain("saved=1");
      expect(location).toContain("q=perenne");
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
      formData.append("returnTo", "/k/read/mock-hash-1?section=0&prep=1");

      const res = await app.request("/k/knowledge/mark", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/read/mock-hash-1?section=0&prep=1");
      expect(location).toContain("markedKnown=perenne");

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO lecta_user_knowledge"),
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
      formData.append("selectedOption", "B");
      formData.append("questionIndex", "0");
      formData.append("totalQuestions", "3");
      formData.append("correctCount", "0");
      formData.append("bookHash", "mock-hash-1");
      formData.append("returnTo", "/k/read/mock-hash-1?section=0&page=0");

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
      formData.append("selectedOption", "C");
      formData.append("questionIndex", "2");
      formData.append("totalQuestions", "3");
      formData.append("correctCount", "2");
      formData.append("bookHash", "mock-hash-1");
      formData.append("returnTo", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/k/practice/answer", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/practice?done=1");
      expect(location).toContain("score=3");
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
      formData.append("bookId", "mock-hash-1");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toContain("/k/read/mock-hash-1");
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO lecta_user_knowledge"),
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
      formData.append("bookId", "mock-hash-1");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO lecta_user_words"),
        expect.arrayContaining(["user-1", "es", "soledad"]),
      );
    });

    it("POST /kindle/priming/action con action=mute_book fija cookie y redirige con primed=1", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "mute_book");
      formData.append("bookId", "mock-hash-1");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("lecta_k_mute_mock-hash-1=1");
      expect(res.headers.get("Location")).toContain("primed=1");
    });

    it("POST /kindle/priming/action con action=disable_all fija cookie global y redirige con primed=1", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "disable_all");
      formData.append("bookId", "mock-hash-1");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

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

      const res = await app.request("/k/read/mock-hash-1?section=0&page=0&primed=1", {}, env);
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
        "/k/read/mock-hash-1?section=0&page=0",
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
        "/k/read/mock-hash-1?section=0&page=0",
        { headers: { Cookie: "lecta_k_mute_mock-hash-1=1" } },
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

      const res = await app.request("/k/read/mock-hash-1?section=0&page=0", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Antes de leer · Capítulo uno");
      expect(html).toContain("Comenzar a leer capítulo →");
      expect(html).toContain("✓ Ya la sé");
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
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

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
      formData.append("bookId", "mock-hash-1");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/k/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("lecta_k_mute_mock-hash-1=1");
    });
  });
});

