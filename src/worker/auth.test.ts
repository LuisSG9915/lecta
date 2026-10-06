import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Capturamos la configuración que createAuth entrega a better-auth y
// al plugin de magic link para invocar los callbacks de correo sin
// red ni base. Ningún test toca Resend ni Postgres de verdad.
const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn((config: unknown) => ({ __config: config })),
  magicLink: vi.fn((opts: unknown) => opts),
}));

vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/plugins", () => ({ magicLink: mocks.magicLink }));
vi.mock("kysely", () => ({ Kysely: class {}, PostgresDialect: class {} }));
vi.mock("pg", () => ({ default: { Pool: class {}, Client: class {} } }));

import { createAuth } from "./auth";

const FAKE_URL = "https://lecta.test/auth?token=TOKEN_FICTICIO_abc123";
const FAKE_EMAIL = "persona@example.test";

type EmailArgs = { user: { email: string }; url: string };
type AuthConfig = {
  emailAndPassword: {
    sendResetPassword: (args: EmailArgs) => Promise<void>;
  };
  user: {
    deleteUser: {
      sendDeleteAccountVerification: (args: EmailArgs) => Promise<void>;
    };
  };
};

const lastAuthConfig = () =>
  mocks.betterAuth.mock.calls.at(-1)?.[0] as unknown as AuthConfig;
const lastSendMagicLink = () =>
  (mocks.magicLink.mock.calls.at(-1)?.[0] as {
    sendMagicLink: (args: { email: string; url: string }) => Promise<void>;
  }).sendMagicLink;

const envWithDb = { DATABASE_URL: "postgres://lecta:test@localhost/lecta_dev" };
const envWithResend = {
  ...envWithDb,
  RESEND_API_KEY: "re_ficticio",
  RESEND_FROM_EMAIL: "Lecta <hola@lecta.test>",
};

const allLogs = (...spies: ReturnType<typeof vi.spyOn>[]) =>
  spies.flatMap((spy) => spy.mock.calls.flat().map(String));

beforeEach(() => {
  mocks.betterAuth.mockClear();
  mocks.magicLink.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("correo de autenticación", () => {
  it("sin RESEND_API_KEY las tres rutas fallan sin registrar enlace ni destinatario", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    createAuth(envWithDb, "https://lecta.test");
    const config = lastAuthConfig();
    const user = { email: FAKE_EMAIL };
    const sends = [
      lastSendMagicLink()({ email: FAKE_EMAIL, url: FAKE_URL }),
      config.emailAndPassword.sendResetPassword({ user, url: FAKE_URL }),
      config.user.deleteUser.sendDeleteAccountVerification({ user, url: FAKE_URL }),
    ];
    for (const send of sends)
      await expect(send).rejects.toThrow("correo no está configurado");

    // Nada de «el enlace quedó en el log»: ni la URL con token ni el
    // correo pueden aparecer en la salida.
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const text of allLogs(log, error)) {
      expect(text).not.toContain(FAKE_URL);
      expect(text).not.toContain(FAKE_EMAIL);
    }
  });

  it("un rechazo de Resend registra solo el código, sin enlace, correo ni cuerpo remoto", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("detalle interno del proveedor", { status: 401 })),
    );

    createAuth(envWithResend, "https://lecta.test");
    await expect(
      lastSendMagicLink()({ email: FAKE_EMAIL, url: FAKE_URL }),
    ).rejects.toThrow("401");

    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain("401");
    expect(message).not.toContain(FAKE_EMAIL);
    expect(message).not.toContain(FAKE_URL);
    expect(message).not.toContain("detalle interno");
  });

  it("un envío correcto pide a Resend el correo con el enlace", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    createAuth(envWithResend, "https://lecta.test");
    await lastSendMagicLink()({ email: FAKE_EMAIL, url: FAKE_URL });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_ficticio",
    );
    const body = JSON.parse(String(init.body)) as {
      to: string[];
      subject: string;
      html: string;
    };
    expect(body.to).toEqual([FAKE_EMAIL]);
    expect(body.html).toContain(FAKE_URL);
  });
});
