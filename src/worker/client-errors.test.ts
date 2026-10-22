import { beforeEach, describe, expect, it } from "vitest";
import {
  CLIENT_ERROR_LIMIT_PER_MINUTE,
  allowClientError,
  parseClientErrorReport,
  resetClientErrorLimiters,
  sanitizeRoute,
} from "./client-errors";

describe("sanitizeRoute", () => {
  it("quita query y hash", () => {
    expect(sanitizeRoute("/reader?book=abc#x")).toBe("/reader");
    expect(sanitizeRoute("/vocabulary?tab=due")).toBe("/vocabulary");
  });

  it("colapsa el código de vinculación de Kindle", () => {
    expect(sanitizeRoute("/k/ABCD")).toBe("/k/*");
    expect(sanitizeRoute("/k/abcd?x=1")).toBe("/k/*");
  });

  it("reduce rutas anidadas a prefijo y comodín", () => {
    expect(sanitizeRoute("/reader/chapter/3")).toBe("/reader/*");
  });

  it("manda a /otra lo que no reconoce", () => {
    expect(sanitizeRoute("/wp-admin?x=1")).toBe("/otra");
    expect(sanitizeRoute("reader")).toBe("/otra");
    expect(sanitizeRoute("")).toBe("/otra");
    expect(sanitizeRoute("/a/b/c/d")).toBe("/otra");
    expect(sanitizeRoute(undefined)).toBe("/otra");
    expect(sanitizeRoute(42)).toBe("/otra");
  });

  it("conserva la raíz", () => {
    expect(sanitizeRoute("/")).toBe("/");
  });
});

describe("parseClientErrorReport", () => {
  const valid = {
    name: "TypeError",
    code: "unhandledrejection",
    route: "/reader?book=abc",
    version: "prod",
  };

  it("acepta un reporte válido y sanea la ruta", () => {
    const report = parseClientErrorReport(valid);
    expect(report).toEqual({
      event: "client_error",
      name: "TypeError",
      code: "unhandledrejection",
      route: "/reader",
      version: "prod",
    });
  });

  it("rechaza campos desconocidos", () => {
    expect(parseClientErrorReport({ ...valid, stack: "at foo()" })).toBeNull();
    expect(parseClientErrorReport({ ...valid, bookText: "..." })).toBeNull();
  });

  it("rechaza un mensaje fuera del límite en vez de recortarlo", () => {
    expect(parseClientErrorReport({ ...valid, message: "x".repeat(201) })).toBeNull();
    expect(parseClientErrorReport({ ...valid, message: "   " })).toBeNull();
  });

  it("acepta un mensaje corto y lo devuelve", () => {
    const report = parseClientErrorReport({ ...valid, message: "boom" });
    expect(report?.message).toBe("boom");
  });

  it("exige un nombre legible", () => {
    expect(parseClientErrorReport({ ...valid, name: "" })).toBeNull();
    expect(parseClientErrorReport({ ...valid, name: 12 })).toBeNull();
    expect(parseClientErrorReport({ route: "/reader" })).toBeNull();
  });

  it("rechaza cuerpos que no son objetos", () => {
    for (const raw of [null, undefined, "texto", 42, [], [valid]]) {
      expect(parseClientErrorReport(raw)).toBeNull();
    }
  });
});

describe("allowClientError", () => {
  beforeEach(() => {
    resetClientErrorLimiters();
  });

  it("permite hasta el tope por minuto y corta el siguiente", () => {
    const now = 1_760_000_000_000;
    for (let i = 0; i < CLIENT_ERROR_LIMIT_PER_MINUTE; i += 1) {
      expect(allowClientError("1.2.3.4", now + i)).toBe(true);
    }
    expect(allowClientError("1.2.3.4", now + CLIENT_ERROR_LIMIT_PER_MINUTE)).toBe(false);
  });

  it("se reinicia al cambiar de minuto", () => {
    const now = 1_760_000_000_000;
    for (let i = 0; i < CLIENT_ERROR_LIMIT_PER_MINUTE; i += 1) {
      allowClientError("5.5.5.5", now);
    }
    expect(allowClientError("5.5.5.5", now + 60_000)).toBe(true);
  });

  it("cuenta por IP", () => {
    const now = 1_760_000_000_000;
    for (let i = 0; i < CLIENT_ERROR_LIMIT_PER_MINUTE; i += 1) {
      allowClientError("9.9.9.9", now);
    }
    expect(allowClientError("9.9.9.9", now)).toBe(false);
    expect(allowClientError("8.8.8.8", now)).toBe(true);
  });
});
