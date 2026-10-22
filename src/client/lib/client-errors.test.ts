// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveFeatureFlags } from "./settings";
import {
  CLIENT_ERROR_ENDPOINT,
  CLIENT_ERROR_MAX_PER_LOAD,
  installClientErrorReporting,
  reportClientError,
  reportErrorObject,
  resetClientErrorReporter,
} from "./client-errors";

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }),
);

type FetchCall = [string, RequestInit];
const fetchCalls = () => fetchMock.mock.calls as unknown as FetchCall[];
const sentPayloads = () =>
  fetchCalls().map(([, init]) => JSON.parse(String(init.body)) as Record<string, string>);

beforeEach(() => {
  localStorage.clear();
  resetClientErrorReporter();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("reportClientError", () => {
  it("no envía nada si el usuario desactivó compartir errores", () => {
    saveFeatureFlags({ shareClientErrors: false });
    expect(reportClientError({ name: "TypeError" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envía metadatos sin mensaje cuando el interruptor está apagado", async () => {
    expect(reportClientError({ name: "TypeError", code: "window.error", message: "boom" })).toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchCalls()[0];
    expect(url).toBe(CLIENT_ERROR_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(sentPayloads()[0]).toMatchObject({ name: "TypeError", code: "window.error" });
    expect(sentPayloads()[0]).not.toHaveProperty("message");
  });

  it("incluye el mensaje solo si el usuario lo activó", () => {
    saveFeatureFlags({ includeErrorMessage: true });
    reportClientError({ name: "TypeError", message: "x".repeat(500) });
    const payload = sentPayloads()[0];
    expect(payload.message).toHaveLength(200);
  });

  it("deduplica por nombre, código y ruta dentro de la sesión", () => {
    expect(reportClientError({ name: "TypeError", code: "a" })).toBe(true);
    expect(reportClientError({ name: "TypeError", code: "a" })).toBe(false);
    expect(reportClientError({ name: "TypeError", code: "b" })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it(`como mucho ${CLIENT_ERROR_MAX_PER_LOAD} reportes por carga`, () => {
    for (let i = 0; i < CLIENT_ERROR_MAX_PER_LOAD + 3; i += 1) {
      reportClientError({ name: `Error${i}` });
    }
    expect(fetchMock).toHaveBeenCalledTimes(CLIENT_ERROR_MAX_PER_LOAD);
  });

  it("un fallo de red no rompe la app", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("sin red");
      }),
    );
    expect(() => reportClientError({ name: "TypeError" })).not.toThrow();
  });

  it("reporta objetos Error con su nombre y código", () => {
    class StaleScopeError extends Error {
      code = "stale-scope";
    }
    expect(reportErrorObject(new StaleScopeError("cuenta cambiada"))).toBe(true);
    expect(sentPayloads()[0]).toMatchObject({ name: "Error", code: "stale-scope" });
  });

  it("reporta valores que no son Error sin lanzar", () => {
    expect(reportErrorObject("algo raro")).toBe(true);
    expect(sentPayloads()[0]).toMatchObject({ name: "NonError" });
  });

  it("resetClientErrorReporter permite volver a enviar tras recargar", () => {
    reportClientError({ name: "TypeError" });
    expect(reportClientError({ name: "TypeError" })).toBe(false);
    resetClientErrorReporter();
    expect(reportClientError({ name: "TypeError" })).toBe(true);
  });
});

describe("installClientErrorReporting", () => {
  it("engancha error y unhandledrejection una sola vez", () => {
    installClientErrorReporting();
    installClientErrorReporting();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom"), message: "boom" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    event.reason = new Error("rechazo");
    window.dispatchEvent(event);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
