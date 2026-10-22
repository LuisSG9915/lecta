import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("usa la URL de producción y el timeout por defecto", () => {
    const config = loadConfig({});
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.timeoutMs).toBe(20_000);
    expect(config.cookie).toBeUndefined();
    expect(config.email).toBeUndefined();
    expect(config.password).toBeUndefined();
  });

  it("normaliza barras finales y conserva la ruta base", () => {
    const config = loadConfig({ LECTA_BASE_URL: "http://localhost:5173///" });
    expect(config.baseUrl).toBe("http://localhost:5173");
  });

  it("rechaza URLs inválidas o con esquema no permitido", () => {
    expect(() => loadConfig({ LECTA_BASE_URL: "no-es-una-url" })).toThrow(
      /no es una URL válida/,
    );
    expect(() => loadConfig({ LECTA_BASE_URL: "ftp://lecta.local" })).toThrow(
      /http o https/,
    );
  });

  it("acota el timeout al mínimo de 1000 ms", () => {
    expect(loadConfig({ LECTA_TIMEOUT_MS: "50" }).timeoutMs).toBe(20_000);
    expect(loadConfig({ LECTA_TIMEOUT_MS: "1500" }).timeoutMs).toBe(1500);
    expect(loadConfig({ LECTA_TIMEOUT_MS: "abc" }).timeoutMs).toBe(20_000);
  });

  it("lee credenciales solo del entorno y recorta espacios", () => {
    const config = loadConfig({
      LECTA_COOKIE: "  better-auth.session_token=abc  ",
      LECTA_EMAIL: "  luis@example.com  ",
      LECTA_PASSWORD: "secreto",
    });
    expect(config.cookie).toBe("better-auth.session_token=abc");
    expect(config.email).toBe("luis@example.com");
    expect(config.password).toBe("secreto");
  });
});
