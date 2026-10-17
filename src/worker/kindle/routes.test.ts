import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";

const getSessionMock = vi.hoisted(() => vi.fn());
const authHandlerMock = vi.hoisted(() => vi.fn());
const dbQueryMock = vi.hoisted(() => vi.fn());

vi.mock("../session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("../auth", () => ({
  createAuth: () => ({
    handler: (...args: unknown[]) => authHandlerMock(...args),
    api: { getSession: getSessionMock },
  }),
}));

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
    BOOKS: mockBooksBucket as unknown,
  };

  beforeEach(() => {
    vi.clearAllMocks();
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

    it("utiliza c.env.DB cuando está disponible para registrar y vincular códigos D1", async () => {
      const mockD1Rows = new Map<string, any>();
      const mockDb = {
        prepare: vi.fn((sql: string) => ({
          bind: (...args: any[]) => ({
            run: vi.fn(async () => {
              if (sql.includes("INSERT INTO kindle_link_codes")) {
                mockD1Rows.set(args[0], {
                  code: args[0],
                  status: "pending",
                  created_at: Math.floor(Date.now() / 1000),
                });
              } else if (sql.includes("UPDATE kindle_link_codes")) {
                const [userId, userToken, code] = args;
                const existing = mockD1Rows.get(code) || { code };
                mockD1Rows.set(code, {
                  ...existing,
                  status: "linked",
                  user_id: userId,
                  session_token: userToken,
                });
              }
              return { success: true };
            }),
            first: vi.fn(async () => {
              const code = args[0];
              return mockD1Rows.get(code) || null;
            }),
          }),
        })),
      };

      const d1Env = {
        ...env,
        DB: mockDb as any,
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
      expect(res.headers.get("Location")).toBe("/k/read/mock-hash-1?section=1&page=2");
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
      // Las palabras se convierten en enlaces a consulta inline en la misma página
      expect(html).toContain("lookup=antigua");
      expect(html).toContain("lookup=estrecha");
      expect(html).toContain("lookup=perenne");
      // Botón directo para pasar página o avanzar al siguiente capítulo
      expect(html).toMatch(/Siguiente (página|capítulo) →/);
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
  });

  describe("GET /k/read/:hash/resource", () => {
    it("sirve un recurso del EPUB con su MIME type", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request("/k/read/mock-hash-1/resource?path=OEBPS/nav.xhtml", {}, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/xhtml+xml");
    });
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
});
