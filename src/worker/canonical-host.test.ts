import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CANONICAL_ORIGIN, isProbePath, isWorkerRoute, legacyHostRedirect } from "./canonical-host";
import handler from "./index";
import type { WorkerEnv } from "./db";

// index.ts reexporta el Workflow, que importa este módulo del runtime.
vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: class {} }));

const OLD = "https://lecta.luis-sg9915.workers.dev";

describe("legacyHostRedirect", () => {
  it("manda páginas del host viejo a lectal.app con 301, conservando ruta y query", () => {
    for (const path of ["/", "/inicio/", "/inicio", "/nivel", "/nivel/", "/nivel.html", "/k", "/index.html", "/reader/libro?x=1"]) {
      const res = legacyHostRedirect(new Request(`${OLD}${path}`));
      expect(res?.status).toBe(301);
      expect(res?.headers.get("location")).toBe(`${CANONICAL_ORIGIN}${path}`);
    }
  });

  it("no toca la API, archivos con extensión, el shell del SW ni los POST", () => {
    for (const path of ["/api/health", "/api/billing/webhook", "/nivel/nivel.js", "/sw.js", "/sw-manifest.json", "/assets/index-ABC.js", "/__lecta_shell__"]) {
      expect(legacyHostRedirect(new Request(`${OLD}${path}`))).toBeNull();
    }
    expect(legacyHostRedirect(new Request(`${OLD}/`, { method: "POST" }))).toBeNull();
  });

  it("no toca lectal.app ni localhost", () => {
    expect(legacyHostRedirect(new Request("https://lectal.app/"))).toBeNull();
    expect(legacyHostRedirect(new Request("http://localhost:5188/"))).toBeNull();
  });
});

describe("isWorkerRoute", () => {
  it("reconoce las rutas de Hono y deja el resto a los assets", () => {
    expect(isWorkerRoute("/api/health")).toBe(true);
    expect(isWorkerRoute("/k")).toBe(true);
    expect(isWorkerRoute("/kindle/priming/action")).toBe(true);
    expect(isWorkerRoute("/models/x.onnx")).toBe(true);
    expect(isWorkerRoute("/")).toBe(false);
    expect(isWorkerRoute("/kitten")).toBe(false);
    expect(isWorkerRoute("/inicio/")).toBe(false);
    expect(isWorkerRoute("/nivel")).toBe(false);
    expect(isWorkerRoute("/nivel/")).toBe(false);
    expect(isWorkerRoute("/nivel.html")).toBe(false);
  });
});

describe("isProbePath", () => {
  it("reconoce sondas de WordPress y PHP sin tocar rutas reales", () => {
    expect(isProbePath("/wp-admin/install.php")).toBe(true);
    expect(isProbePath("/wp-login.php")).toBe(true);
    expect(isProbePath("/WP-content/x")).toBe(true);
    expect(isProbePath("/xmlrpc.php")).toBe(true);
    expect(isProbePath("/")).toBe(false);
    expect(isProbePath("/inicio/")).toBe(false);
    expect(isProbePath("/assets/index.js")).toBe(false);
    expect(isProbePath("/api/health")).toBe(false);
  });
});

describe("fetch del Worker", () => {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  const call = (url: string, env: WorkerEnv) =>
    (handler.fetch as (r: Request, e: WorkerEnv, c: ExecutionContext) => Promise<Response>)(
      new Request(url),
      env,
      ctx,
    );

  it("responde 404 a las sondas sin tocar assets ni redirigir", async () => {
    const assets = { fetch: vi.fn() };
    for (const url of [`${OLD}/wp-admin/install.php`, "https://lectal.app/wp-login.php"]) {
      const res = await call(url, { ASSETS: assets } as unknown as WorkerEnv);
      expect(res.status).toBe(404);
    }
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("redirige el host viejo antes de tocar assets o la app", async () => {
    const assets = { fetch: vi.fn() };
    const res = await call(`${OLD}/inicio/`, { ASSETS: assets } as unknown as WorkerEnv);
    expect(res.status).toBe(301);
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("las páginas de lectal.app van al binding de assets", async () => {
    const assets = { fetch: vi.fn(async () => new Response("html", { status: 200 })) };
    for (const page of ["/inicio/", "/nivel", "/nivel/"]) {
      const res = await call(`https://lectal.app${page}`, { ASSETS: assets } as unknown as WorkerEnv);
      expect(res.status).toBe(200);
    }
    expect(assets.fetch).toHaveBeenCalledTimes(3);
  });

  it("la API sigue en Hono, también en el host viejo", async () => {
    const assets = { fetch: vi.fn() };
    const res = await call(`${OLD}/api/positions`, { ASSETS: assets } as unknown as WorkerEnv);
    // Sin base la ruta responde 503: lo que importa es que la atendió Hono.
    expect(res.status).not.toBe(301);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("publica /nivel estático sin scripts inline, con enlace canónico y enlace desde /inicio/", () => {
    const nivelHtml = fs.readFileSync(path.resolve(process.cwd(), "marketing/landing/nivel.html"), "utf8");
    const nivelJs = fs.readFileSync(path.resolve(process.cwd(), "marketing/landing/nivel.js"), "utf8");
    const landingHtml = fs.readFileSync(path.resolve(process.cwd(), "marketing/landing/index.html"), "utf8");

    expect(nivelHtml).toContain('<link rel="canonical" href="https://lectal.app/nivel/">');
    expect(nivelHtml).toContain('<script src="/nivel/nivel.js" defer></script>');
    expect(nivelHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(nivelHtml).toContain("/?probar=alice-wonderland&src=nivel");
    expect(nivelHtml).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]|\uFE0F/u);

    expect(nivelJs).toContain("/api/catalog/");
    expect(nivelJs).toContain("/?probar=");
    expect(landingHtml).toContain('href="/nivel/"');
  });
});
