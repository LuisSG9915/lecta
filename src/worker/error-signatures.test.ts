import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "./db";
import type { WorkerEnv } from "./db";
import {
  ERROR_SIGNATURE_MAX_DAYS,
  collectErrorDigest,
  fingerprint,
  listErrorSignatures,
  purgeErrorSignatures,
  recordErrorSignature,
  sendErrorDigest,
} from "./error-signatures";

type QueryCall = [string, unknown[] | undefined];
type FakeClient = { query: ReturnType<typeof vi.fn> };

function stubClient(rows: unknown[] = [], rowCount = 0): FakeClient {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

/** Engancha `withClient` para que corra el callback contra un cliente falso. */
function withFakeClient(client: FakeClient | undefined) {
  return vi
    .spyOn(dbModule, "withClient")
    .mockImplementation(async (_env, run) => {
      if (!client) return undefined;
      return run(client as unknown as Parameters<typeof run>[0]);
    });
}

const env = {} as WorkerEnv;

const base = {
  name: "TypeError",
  code: "window.error",
  route: "/reader/*",
  version: "prod",
  frames: ["index-ABC.js:1:234", "index-ABC.js:5:10"],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fingerprint", () => {
  it("es estable y no depende del id del libro", async () => {
    const a = await fingerprint({ ...base, route: "/reader/book-98123" });
    const b = await fingerprint({ ...base, route: "/reader/book-44512" });
    const repeated = await fingerprint({ ...base, route: "/reader/book-98123" });
    expect(a).toBe(b);
    expect(a).toBe(repeated);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("separa dos bugs distintos en la misma ruta", async () => {
    const one = await fingerprint(base);
    const otherFrame = await fingerprint({
      ...base,
      frames: ["otro-Chunk.js:9:9"],
    });
    const otherName = await fingerprint({ ...base, name: "RangeError" });
    expect(one).not.toBe(otherFrame);
    expect(one).not.toBe(otherName);
  });
});

describe("recordErrorSignature", () => {
  it("hace UPSERT por día y firma, no por evento", async () => {
    const client = stubClient([], 1);
    withFakeClient(client);

    const written = await recordErrorSignature(env, base, new Date("2026-10-29T12:00:00Z"));

    expect(written).toBe(true);
    const [sql, params] = client.query.mock.calls[0] as QueryCall;
    expect(sql).toContain("INSERT INTO lecta_error_signatures");
    expect(sql).toContain("hits          = lecta_error_signatures.hits + 1");
    expect(sql).toContain("ON CONFLICT (bucket_day, signature)");
    expect(params?.[0]).toBe("2026-10-29");
    // Muestra de frames limpia y sin mensaje cuando el usuario no lo autorizó.
    expect(params?.[6]).toBe("index-ABC.js:1:234 -> index-ABC.js:5:10");
    expect(params?.[7]).toBeNull();
  });

  it("guarda el mensaje recortado y la ruta normalizada", async () => {
    const client = stubClient([], 1);
    withFakeClient(client);

    await recordErrorSignature(env, {
      ...base,
      route: "/reader/98123",
      message: "m".repeat(400),
    });

    const [, params] = client.query.mock.calls[0] as QueryCall;
    expect(params?.[2]).toBe("/reader/:id");
    expect(String(params?.[7])).toHaveLength(200);
  });

  it("sin base devuelve false y no lanza", async () => {
    withFakeClient(undefined);
    await expect(recordErrorSignature(env, base)).resolves.toBe(false);
  });
});

describe("listErrorSignatures", () => {
  it("mapea las filas y normaliza tipos", async () => {
    const client = stubClient([
      {
        signature: "abcd1234ef567890",
        day: "2026-10-29",
        route: "/reader/*",
        name: "TypeError",
        code: "window.error",
        version: "prod",
        hits: "12",
        sample_frames: "a.js:1:2",
        last_message: null,
        first_seen: "2026-10-29 10:00:00+00",
        last_seen: "2026-10-29 12:00:00+00",
      },
    ]);
    withFakeClient(client);

    const rows = await listErrorSignatures(env, 7);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      signature: "abcd1234ef567890",
      hits: 12,
      lastMessage: null,
      sampleFrames: "a.js:1:2",
    });
  });

  it("recorta la ventana a los días máximos", async () => {
    const client = stubClient([]);
    withFakeClient(client);

    await listErrorSignatures(env, 999);
    const [, params] = client.query.mock.calls[0] as QueryCall;
    expect(params?.[0]).toBe(ERROR_SIGNATURE_MAX_DAYS);
  });

  it("sin base devuelve lista vacía", async () => {
    withFakeClient(undefined);
    await expect(listErrorSignatures(env)).resolves.toEqual([]);
  });
});

describe("purgeErrorSignatures", () => {
  it("borra lo anterior a la retención y devuelve cuántas filas", async () => {
    const client = stubClient([], 4);
    withFakeClient(client);

    await expect(purgeErrorSignatures(env, 30)).resolves.toBe(4);
    const [sql, params] = client.query.mock.calls[0] as QueryCall;
    expect(sql).toContain("DELETE FROM lecta_error_signatures");
    expect(sql).toContain("bucket_day < current_date - $1::INT8");
    expect(params?.[0]).toBe(30);
  });

  it("sin base devuelve 0", async () => {
    withFakeClient(undefined);
    await expect(purgeErrorSignatures(env)).resolves.toBe(0);
  });
});

describe("collectErrorDigest", () => {
  it("se queda con las firmas que superan el umbral", async () => {
    const client = stubClient([
      {
        signature: "abcd1234ef567890",
        name: "TypeError",
        route: "/reader/*",
        version: "prod",
        hits: "9",
        sample_frames: "a.js:1:2",
      },
    ]);
    withFakeClient(client);

    const rows = await collectErrorDigest(env, 5);
    expect(rows[0]).toMatchObject({ hits: 9, route: "/reader/*" });
    const [sql, params] = client.query.mock.calls[0] as QueryCall;
    expect(sql).toContain("HAVING sum(hits) >= $1::INT8");
    expect(params?.[0]).toBe(5);
  });
});

describe("sendErrorDigest", () => {
  const digest = [
    {
      signature: "abcd1234ef567890",
      name: "TypeError",
      route: "/reader/*",
      version: "prod",
      hits: 9,
      sampleFrames: "a.js:1:2",
    },
  ];

  it("no envía nada sin clave, sin dueño o sin filas", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendErrorDigest(env, digest)).resolves.toBe(false);
    await expect(
      sendErrorDigest({ RESEND_API_KEY: "k" } as WorkerEnv, digest),
    ).resolves.toBe(false);
    await expect(
      sendErrorDigest(
        { RESEND_API_KEY: "k", LECTA_OWNER_EMAIL: "dueno@example.com" } as WorkerEnv,
        [],
      ),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("manda el resumen al dueño", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const sent = await sendErrorDigest(
      {
        RESEND_API_KEY: "k",
        RESEND_FROM_EMAIL: "Lecta <hola@example.com>",
        LECTA_OWNER_EMAIL: "dueno@example.com",
      } as WorkerEnv,
      digest,
    );

    expect(sent).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      to: string[];
      from: string;
      text: string;
      subject: string;
    };
    expect(body.to).toEqual(["dueno@example.com"]);
    expect(body.from).toBe("Lecta <hola@example.com>");
    expect(body.subject).toContain("1 firma");
    expect(body.text).toContain("TypeError en /reader/*");
    expect(body.text).toContain("abcd1234ef567890");
  });

  it("un rechazo de Resend no lanza", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendErrorDigest(
        { RESEND_API_KEY: "k", LECTA_OWNER_EMAIL: "dueno@example.com" } as WorkerEnv,
        digest,
      ),
    ).resolves.toBe(false);
  });
});
