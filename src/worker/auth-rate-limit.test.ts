import { describe, expect, it, vi } from "vitest";
import { app } from "./app";
import { checkAuthRateLimit, isCrossSiteForm, isLimitedAuthRequest } from "./auth-rate-limit";
import type { WorkerEnv } from "./db";

function limiter(success: boolean) {
  return { limit: vi.fn(async () => ({ success })) };
}

function req(headers: Record<string, string> = {}, url = "https://lectal.app/k/login") {
  return new Request(url, { method: "POST", headers });
}

describe("isLimitedAuthRequest", () => {
  it("limita los POST de acceso, registro y correo", () => {
    for (const path of [
      "/api/auth/sign-in/email",
      "/api/auth/sign-up/email",
      "/api/auth/sign-in/magic-link",
      "/api/auth/request-password-reset",
    ]) {
      expect(isLimitedAuthRequest("POST", path)).toBe(true);
    }
  });

  it("deja fuera get-session, los GET con token y sign-out", () => {
    expect(isLimitedAuthRequest("GET", "/api/auth/get-session")).toBe(false);
    expect(isLimitedAuthRequest("GET", "/api/auth/magic-link/verify")).toBe(false);
    expect(isLimitedAuthRequest("POST", "/api/auth/sign-out")).toBe(false);
    expect(isLimitedAuthRequest("POST", "/api/vocab")).toBe(false);
  });
});

describe("checkAuthRateLimit", () => {
  it("cuenta por alcance e IP", async () => {
    const l = limiter(false);
    const env = { AUTH_LIMITER: l } as WorkerEnv;
    expect(await checkAuthRateLimit(env, req({ "cf-connecting-ip": "1.2.3.4" }), "auth")).toBe(
      false,
    );
    expect(l.limit).toHaveBeenCalledWith({ key: "auth:1.2.3.4" });
  });

  it("deja pasar sin binding, sin IP o si el binding falla", async () => {
    expect(
      await checkAuthRateLimit({} as WorkerEnv, req({ "cf-connecting-ip": "1.2.3.4" }), "auth"),
    ).toBe(true);
    const l = limiter(false);
    expect(await checkAuthRateLimit({ AUTH_LIMITER: l } as WorkerEnv, req(), "auth")).toBe(true);
    expect(l.limit).not.toHaveBeenCalled();
    const broken = { limit: vi.fn(async () => Promise.reject(new Error("caído"))) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await checkAuthRateLimit(
        { AUTH_LIMITER: broken } as WorkerEnv,
        req({ "cf-connecting-ip": "1.2.3.4" }),
        "klogin",
      ),
    ).toBe(true);
    warn.mockRestore();
  });
});

describe("isCrossSiteForm", () => {
  it("rechaza Sec-Fetch-Site cross-site y Origin de otro host", () => {
    expect(isCrossSiteForm(req({ "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSiteForm(req({ origin: "https://evil.test" }))).toBe(true);
  });

  it("acepta el propio origen y la ausencia de cabeceras (Kindle)", () => {
    expect(
      isCrossSiteForm(req({ origin: "https://lectal.app", "sec-fetch-site": "same-origin" })),
    ).toBe(false);
    expect(isCrossSiteForm(req())).toBe(false);
    expect(isCrossSiteForm(req({ origin: "null" }))).toBe(false);
  });
});

describe("POST /api/auth/* con el freno agotado", () => {
  it("responde 429 con Retry-After antes de tocar Better Auth", async () => {
    const l = limiter(false);
    const res = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
        body: JSON.stringify({ email: "a@b.c", password: "x" }),
      },
      { DATABASE_URL: "postgres://mock", AUTH_LIMITER: l } as WorkerEnv,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" });
  });
});
