import { afterEach, describe, expect, it, vi } from "vitest";
import { createScopedAuth } from "./auth";
import type { WorkerEnv } from "./db";

const BASE = "https://lectal.app";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, ...headers },
    body: JSON.stringify(body),
  });
}

async function handle(env: Partial<WorkerEnv>, req: Request) {
  const { auth, closePool } = createScopedAuth(
    {
      DATABASE_URL: "postgres://u:p@127.0.0.1:1/db",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ...env,
    } as WorkerEnv,
    BASE,
  );
  try {
    return await auth.handler(req);
  } finally {
    await closePool();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Turnstile en el acceso", () => {
  it("con secret, registro y enlace mágico sin token → 400 sin tocar la base", async () => {
    for (const [path, body] of [
      ["/sign-up/email", { email: "a@b.co", password: "12345678", name: "a" }],
      ["/sign-in/magic-link", { email: "a@b.co" }],
    ] as const) {
      const res = await handle({ TURNSTILE_SECRET_KEY: "secreto" }, post(path, body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "MISSING_RESPONSE" });
    }
  });

  it("con secret, un token rechazado por Cloudflare → 403", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ success: false, "error-codes": ["invalid-input-response"] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await handle(
      { TURNSTILE_SECRET_KEY: "secreto" },
      post(
        "/sign-up/email",
        { email: "a@b.co", password: "12345678", name: "a" },
        { "x-captcha-response": "falso" },
      ),
    );
    expect(res.status).toBe(403);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("challenges.cloudflare.com");
  });

  it("sign-in/email no pide captcha (portal Kindle sin JS)", async () => {
    const res = await handle(
      { TURNSTILE_SECRET_KEY: "secreto" },
      post("/sign-in/email", { email: "a@b.co", password: "12345678" }),
    );
    const data = (await res.json().catch(() => ({}))) as { code?: string };
    expect(data.code).not.toBe("MISSING_RESPONSE");
  });

  it("sin secret no se exige captcha", async () => {
    const res = await handle({}, post("/sign-in/magic-link", { email: "a@b.co" }));
    const data = (await res.json().catch(() => ({}))) as { code?: string };
    expect(data.code).not.toBe("MISSING_RESPONSE");
  });
});

describe("correos desechables en el alta (F12)", () => {
  it("sign-up con dominio desechable → 400 DISPOSABLE_EMAIL sin tocar la base", async () => {
    const res = await handle(
      {},
      post("/sign-up/email", { email: "x@mailinator.com", password: "12345678", name: "x" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "DISPOSABLE_EMAIL" });
  });

  it("un correo normal no es rechazado por la regla", async () => {
    const res = await handle(
      {},
      post("/sign-up/email", { email: "ana@gmail.com", password: "12345678", name: "a" }),
    );
    // La base falsa falla después; lo único que importa es que no sea nuestro 400.
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    expect(body.code).not.toBe("DISPOSABLE_EMAIL");
  });
});
