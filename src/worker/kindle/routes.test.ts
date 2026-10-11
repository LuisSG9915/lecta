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

  describe("Redirección /kindle -> /k", () => {
    it("/kindle redirige a /k", async () => {
      const res = await app.request("/kindle", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k");
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
});
