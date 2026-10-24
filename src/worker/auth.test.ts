import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Capturamos la configuración que createAuth entrega a better-auth y
// al plugin de magic link para invocar los callbacks de correo sin
// red ni base. Ningún test toca Resend ni Postgres de verdad.
const poolEndMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const poolOnMock = vi.hoisted(() => vi.fn());
const dbQueryMock = vi.hoisted(() => vi.fn());

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn((config: unknown) => ({ __config: config })),
  magicLink: vi.fn((opts: unknown) => opts),
}));

vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/plugins", () => ({ magicLink: mocks.magicLink }));
vi.mock("kysely", () => ({ Kysely: class {}, PostgresDialect: class {} }));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      end = poolEndMock;
      on = poolOnMock;
    },
    Client: class {},
  },
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    withClient: async (
      _env: unknown,
      run: (client: { query: typeof dbQueryMock }) => Promise<unknown>,
    ) => run({ query: dbQueryMock }),
  };
});

import { createAuth, createScopedAuth, purgeR2Prefix } from "./auth";

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
      beforeDelete: (user: { id: string }) => Promise<void>;
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
  dbQueryMock.mockReset();
  dbQueryMock.mockResolvedValue({ rows: [] });
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

describe("gestión del ciclo de vida del pool pg", () => {
  it("createScopedAuth permite invocar closePool y cierra el pool", async () => {
    poolEndMock.mockClear();
    const { closePool } = createScopedAuth(envWithDb, "https://lecta.test");
    expect(poolEndMock).not.toHaveBeenCalled();
    await closePool();
    expect(poolEndMock).toHaveBeenCalledTimes(1);
  });

  it("createAuth adjunta closePool y funciona igual", async () => {
    poolEndMock.mockClear();
    const auth = createAuth(envWithDb, "https://lecta.test") as unknown as { closePool: () => Promise<void> };
    expect(typeof auth.closePool).toBe("function");
    await auth.closePool();
    expect(poolEndMock).toHaveBeenCalledTimes(1);
  });
});

describe("purga total al borrar la cuenta", () => {
  it("purgeR2Prefix pagina con cursor y borra todos los objetos", async () => {
    const pages = [
      {
        objects: [{ key: "books/u1/a.epub" }, { key: "books/u1/b.epub" }],
        truncated: true,
        cursor: "next",
      },
      {
        objects: [{ key: "books/u1/c.epub" }],
        truncated: false,
        cursor: "",
      },
    ];
    const list = vi.fn(async (_options: unknown) => pages.shift());
    const remove = vi.fn(async () => undefined);
    const bucket = { list, delete: remove } as unknown as R2Bucket;

    await purgeR2Prefix(bucket, "books/u1/");

    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0]?.[0]).toEqual({
      prefix: "books/u1/",
      cursor: undefined,
      limit: 1000,
    });
    expect(list.mock.calls[1]?.[0]).toEqual({
      prefix: "books/u1/",
      cursor: "next",
      limit: 1000,
    });
    expect(remove).toHaveBeenNthCalledWith(1, [
      "books/u1/a.epub",
      "books/u1/b.epub",
    ]);
    expect(remove).toHaveBeenNthCalledWith(2, ["books/u1/c.epub"]);
  });

  it("beforeDelete purga books/, user-books/ y las tablas user_books y kindle_link_codes", async () => {
    const list = vi.fn(async ({ prefix }: { prefix: string }) => ({
      objects: [{ key: prefix + "a.epub" }],
      truncated: false,
      cursor: "",
    }));
    const remove = vi.fn(async () => undefined);
    const bucket = { list, delete: remove } as unknown as R2Bucket;

    createAuth({ ...envWithDb, BOOKS: bucket }, "https://lecta.test");
    await lastAuthConfig().user.deleteUser.beforeDelete({ id: "u1" });

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "books/u1/" }),
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "user-books/u1/" }),
    );
    expect(remove).toHaveBeenCalledWith(["books/u1/a.epub"]);
    expect(remove).toHaveBeenCalledWith(["user-books/u1/a.epub"]);
    expect(dbQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM user_books"),
      ["u1"],
    );
    expect(dbQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM kindle_link_codes"),
      ["u1", expect.any(Number)],
    );
  });
});
