import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LectaApi,
  LectaApiError,
  LectaAuthError,
  parseCookieHeader,
} from "./api.js";
import type { LectaConfig } from "./config.js";

const BASE_CONFIG: LectaConfig = {
  baseUrl: "https://lecta.test",
  timeoutMs: 1000,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseCookieHeader", () => {
  it("acepta un token suelto y lo asigna a la cookie de sesión", () => {
    const jar = parseCookieHeader("abc123", "better-auth.session_token");
    expect(jar.get("better-auth.session_token")).toBe("abc123");
  });

  it("acepta el encabezado Cookie completo con varias cookies", () => {
    const jar = parseCookieHeader(
      "Cookie: better-auth.session_token=abc; otra=1",
      "better-auth.session_token",
    );
    expect(jar.get("better-auth.session_token")).toBe("abc");
    expect(jar.get("otra")).toBe("1");
  });

  it("devuelve un tarro vacío sin valor", () => {
    expect(parseCookieHeader("   ", "better-auth.session_token").size).toBe(0);
  });
});

describe("LectaApi", () => {
  it("solo tiene credenciales con cookie o correo+contraseña", () => {
    expect(new LectaApi(BASE_CONFIG).hasCredentials).toBe(false);
    expect(
      new LectaApi({ ...BASE_CONFIG, cookie: "abc" }).hasCredentials,
    ).toBe(true);
    expect(
      new LectaApi({ ...BASE_CONFIG, email: "a@b.c" }).hasCredentials,
    ).toBe(false);
    expect(
      new LectaApi({
        ...BASE_CONFIG,
        email: "a@b.c",
        password: "secreto",
      }).hasCredentials,
    ).toBe(true);
  });

  it("getSession no llama a la red sin credenciales", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(new LectaApi(BASE_CONFIG).getSession()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getJson devuelve el JSON y usa la URL base", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const api = new LectaApi(BASE_CONFIG);
    await expect(api.getJson("/api/health", { anonymous: true })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lecta.test/api/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("traduce un 500 con mensaje de la API a LectaApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "boom" }, 500)),
    );

    const api = new LectaApi(BASE_CONFIG);
    await expect(api.getJson("/api/health", { anonymous: true })).rejects.toMatchObject({
      name: "LectaApiError",
      status: 500,
      message: "boom",
    });
  });

  it("traduce un 401 a LectaAuthError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "sin sesión" }, 401)),
    );

    const api = new LectaApi(BASE_CONFIG);
    await expect(api.getJson("/api/vocab", { anonymous: true })).rejects.toBeInstanceOf(
      LectaAuthError,
    );
  });

  it("explica el timeout en lugar de propagar el error crudo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      }),
    );

    const api = new LectaApi({ ...BASE_CONFIG, timeoutMs: 1500 });
    await expect(api.getJson("/api/health", { anonymous: true })).rejects.toMatchObject({
      name: "LectaApiError",
      status: 0,
      message: expect.stringContaining("1500 ms"),
    });
  });

  it("expone el payload de error para diagnóstico", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "detalle" }, 400)),
    );

    const api = new LectaApi(BASE_CONFIG);
    try {
      await api.getJson("/api/health", { anonymous: true });
      expect.unreachable("debió lanzar");
    } catch (error) {
      expect(error).toBeInstanceOf(LectaApiError);
      expect((error as LectaApiError).payload).toEqual({ error: "detalle" });
    }
  });
});
