import { describe, expect, it, vi, beforeEach } from "vitest";

// La sesión la entrega Better Auth; aquí se verifica la validación de encabezados,
// la detección temprana de cookies y el cierre del pool de base de datos.
const getSessionMock = vi.hoisted(() => vi.fn());
const closePoolMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const createScopedAuthMock = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => ({
    auth: { api: { getSession: getSessionMock } },
    closePool: closePoolMock,
  })),
);

vi.mock("./auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth")>();
  return {
    ...actual,
    createScopedAuth: (...args: unknown[]) => createScopedAuthMock(...args),
    createAuth: (...args: unknown[]) => createScopedAuthMock(...args).auth,
  };
});

import { getSession, SessionInfraError } from "./session";

const env = { DATABASE_URL: "postgres://lecta:test@localhost/lecta_dev" };

const contextFor = (
  headers: Record<string, string>,
  executionCtx?: { waitUntil: (promise: Promise<unknown>) => void },
) => ({
  env,
  req: {
    raw: new Request("https://lecta.test/api/vocab", {
      headers: {
        cookie: "better-auth.session_token=valid_token_123",
        ...headers,
      },
    }),
    url: "https://lecta.test/api/vocab",
  },
  executionCtx,
});

describe("getSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("devuelve la sesión cuando no hay encabezado de cuenta", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    const session = await getSession(contextFor({}));
    expect(session?.user.id).toBe("u1");
    expect(closePoolMock).toHaveBeenCalled();
  });

  it("devuelve la sesión cuando el encabezado coincide", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    const session = await getSession(
      contextFor({ "x-lecta-user-id": "u1" }),
    );
    expect(session?.user.id).toBe("u1");
    expect(closePoolMock).toHaveBeenCalled();
  });

  it("rechaza cuando el encabezado declara otra cuenta", async () => {
    // La cookie ya es de u2 pero la petición nació de u1: viajaba con
    // una sesión vieja y no debe leer ni escribir nada.
    getSessionMock.mockResolvedValue({ user: { id: "u2" } });
    const session = await getSession(
      contextFor({ "x-lecta-user-id": "u1" }),
    );
    expect(session).toBeNull();
    expect(closePoolMock).toHaveBeenCalled();
  });

  it("rechaza sin sesión válida aunque el encabezado exista", async () => {
    getSessionMock.mockResolvedValue(null);
    const session = await getSession(
      contextFor({ "x-lecta-user-id": "u1" }),
    );
    expect(session).toBeNull();
    expect(closePoolMock).toHaveBeenCalled();
  });

  it("rechaza sin base configurada", async () => {
    const session = await getSession({
      env: {},
      req: contextFor({}).req,
    });
    expect(session).toBeNull();
    expect(createScopedAuthMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("rechaza de inmediato sin cookie de sesión sin abrir pool", async () => {
    const rawReq = new Request("https://lecta.test/api/vocab", {
      headers: { "x-lecta-user-id": "u1" }, // Sin cookie de sesión
    });
    const session = await getSession({
      env,
      req: { raw: rawReq, url: "https://lecta.test/api/vocab" },
    });
    expect(session).toBeNull();
    expect(createScopedAuthMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(closePoolMock).not.toHaveBeenCalled();
  });

  it("delega el cierre del pool a executionCtx.waitUntil si está presente", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    const waitUntilSpy = vi.fn();
    const session = await getSession(
      contextFor({}, { waitUntil: waitUntilSpy }),
    );
    expect(session?.user.id).toBe("u1");
    expect(waitUntilSpy).toHaveBeenCalledTimes(1);
  });

  it("lanza SessionInfraError y cierra el pool ante fallos de conexión o Postgres", async () => {
    getSessionMock.mockRejectedValue(new Error("Connection terminated unexpectedly"));
    await expect(getSession(contextFor({}))).rejects.toThrow(SessionInfraError);
    expect(closePoolMock).toHaveBeenCalled();
  });

  it("devuelve null y cierra el pool ante errores normales de sesión inválida", async () => {
    getSessionMock.mockRejectedValue(new Error("Session expired or malformed token"));
    const session = await getSession(contextFor({}));
    expect(session).toBeNull();
    expect(closePoolMock).toHaveBeenCalled();
  });
});
