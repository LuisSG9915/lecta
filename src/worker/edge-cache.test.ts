import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { withEdgeCache } from "./edge-cache";

// Cache API en memoria: match/put por URL, como caches.default.
let store: Map<string, Response>;
const put = vi.fn(async (req: Request, res: Response) => {
  store.set(req.url, res);
});
const match = vi.fn(async (req: Request) => store.get(req.url)?.clone());

beforeEach(() => {
  store = new Map();
  put.mockClear();
  match.mockClear();
  vi.stubGlobal("caches", { default: { match, put } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const appWith = (compute: () => Response) => {
  const run = vi.fn(async () => compute());
  const app = new Hono();
  app.get("/x", (c) =>
    withEdgeCache(c, "lexicon/lookup?v=1&form=casa", { ttlSeconds: 600, missTtlSeconds: 60 }, run),
  );
  return { app, run };
};

describe("withEdgeCache", () => {
  it("la segunda petición sale de la caché sin recalcular y el navegador nunca guarda", async () => {
    const { app, run } = appWith(() => Response.json({ found: true }));
    const first = await app.request("http://lectal.app/x");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("x-lecta-cache")).toBe("miss");
    expect(put).toHaveBeenCalledTimes(1);
    const [key, stored] = put.mock.calls[0];
    expect(key.url).toBe("http://lectal.app/__edge/lexicon/lookup?v=1&form=casa");
    expect(stored.headers.get("cache-control")).toBe("public, max-age=600");

    const second = await app.request("http://lectal.app/x");
    expect(await second.json()).toEqual({ found: true });
    expect(second.headers.get("cache-control")).toBe("no-store");
    expect(second.headers.get("x-lecta-cache")).toBe("hit");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("un 404 se guarda con el tiempo corto y un error no se guarda", async () => {
    const notFound = appWith(() => Response.json({ found: false }, { status: 404 }));
    await notFound.app.request("http://lectal.app/x");
    expect(put.mock.calls[0][1].headers.get("cache-control")).toBe("public, max-age=60");

    put.mockClear();
    store.clear();
    const failing = appWith(() => Response.json({ error: "x" }, { status: 502 }));
    const res = await failing.app.request("http://lectal.app/x");
    expect(res.status).toBe(502);
    expect(put).not.toHaveBeenCalled();
  });

  it("sin Cache API (pruebas, vite dev) solo calcula", async () => {
    vi.unstubAllGlobals();
    const { app, run } = appWith(() => Response.json({ found: true }));
    const res = await app.request("http://lectal.app/x");
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("si la caché falla al leer, calcula igual", async () => {
    match.mockRejectedValueOnce(new Error("cache caída"));
    const { app, run } = appWith(() => Response.json({ found: true }));
    expect((await app.request("http://lectal.app/x")).status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
