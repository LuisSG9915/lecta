import { describe, expect, it, vi } from "vitest";

// La sesión la entrega Better Auth; aquí solo importa qué devuelve su
// getSession para cada caso de encabezado.
const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock("./auth", () => ({
  createAuth: () => ({ api: { getSession: getSessionMock } }),
}));

import { getSession } from "./session";

const env = { DATABASE_URL: "postgres://lecta:test@localhost/lecta_dev" };

const contextFor = (headers: Record<string, string>) => ({
  env,
  req: {
    raw: new Request("https://lecta.test/api/vocab", { headers }),
    url: "https://lecta.test/api/vocab",
  },
});

describe("getSession", () => {
  it("devuelve la sesión cuando no hay encabezado de cuenta", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    const session = await getSession(contextFor({}));
    expect(session?.user.id).toBe("u1");
  });

  it("devuelve la sesión cuando el encabezado coincide", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    const session = await getSession(
      contextFor({ "x-lecta-user-id": "u1" }),
    );
    expect(session?.user.id).toBe("u1");
  });

  it("rechaza cuando el encabezado declara otra cuenta", async () => {
    // La cookie ya es de u2 pero la petición nació de u1: viajaba con
    // una sesión vieja y no debe leer ni escribir nada.
    getSessionMock.mockResolvedValue({ user: { id: "u2" } });
    const session = await getSession(
      contextFor({ "x-lecta-user-id": "u1" }),
    );
    expect(session).toBeNull();
  });

  it("rechaza sin sesión válida aunque el encabezado exista", async () => {
    getSessionMock.mockResolvedValue(null);
    const session = await getSession(
      contextFor({ "x-lecta-user-id": "u1" }),
    );
    expect(session).toBeNull();
  });

  it("rechaza sin base configurada", async () => {
    const session = await getSession({
      env: {},
      req: contextFor({}).req,
    });
    expect(session).toBeNull();
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});
