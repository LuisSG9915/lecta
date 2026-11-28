import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { WorkerEnv } from "./db";
import {
  ARTICLE_MAX_BYTES,
  createArticleExtractRouter,
  extractArticleFromHtml,
  validateArticleUrl,
} from "./article-extract";

const loadPlanMock = vi.fn();
const getSessionMock = vi.fn();
const consumeRateUnitsMock = vi.fn();

vi.mock("./plan-store", () => ({
  loadUserPlan: (...args: unknown[]) => loadPlanMock(...args),
}));

vi.mock("./session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("./rate-limit", () => ({
  consumeRateUnits: (...args: unknown[]) => consumeRateUnitsMock(...args),
}));

const env = { DATABASE_URL: "postgres://local/test" } as unknown as WorkerEnv;

function mountApp(fetchImpl: typeof fetch) {
  const app = new Hono<{ Bindings: WorkerEnv }>();
  app.route("/", createArticleExtractRouter(fetchImpl));
  return app;
}

function postExtract(app: Hono<{ Bindings: WorkerEnv }>, url: string) {
  return app.fetch(
    new Request("https://lectal.app/api/articles/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),
    env,
  );
}

describe("validateArticleUrl (anti-SSRF)", () => {
  it("rechaza esquemas no HTTPS, puertos no estándar, credenciales, IPs y hosts locales", () => {
    const blocked = [
      "http://example.com/post",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pass@example.com/post",
      "https://example.com:8443/post",
      "https://localhost/post",
      "https://sub.localhost/post",
      "https://printer.local/post",
      "https://metadata.google.internal/computeMetadata/v1/",
      "https://127.0.0.1/admin",
      "https://10.0.0.1/secret",
      "https://172.16.0.1/secret",
      "https://192.168.1.1/router",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/secret",
      "https://2130706433/secret",
      "https://0x7f.0.0.1/secret",
    ];
    for (const url of blocked) {
      expect(validateArticleUrl(url).ok, url).toBe(false);
    }
  });

  it("acepta enlaces HTTPS públicos válidos", () => {
    const res = validateArticleUrl("  https://newsletter.example.com/p/ensayo-largo?ref=1  ");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.url.hostname).toBe("newsletter.example.com");
    }
  });
});

describe("extractArticleFromHtml", () => {
  it("limpia scripts/nav/footer y extrae título, autor, idioma y párrafos", () => {
    const html = `<!doctype html><html lang="en-US"><head>
      <title>Ignored Title</title>
      <meta property="og:title" content="Deep Reading &amp; Memory" />
      <meta name="author" content="Jane Doe" />
      <script>alert("bad")</script>
    </head><body>
      <nav><p>Menu item one menu item two</p></nav>
      <article>
        <h1>Deep Reading</h1>
        <p>First long paragraph about slow attention and literacy in the digital age, with enough words to exceed the minimum threshold easily for container detection.</p>
        <p>Second paragraph explaining spaced repetition and vocabulary acquisition while reading immersive fiction across chapters and quiet evenings.</p>
      </article>
      <footer><p>Copyright notice footer text</p></footer>
    </body></html>`;

    const extracted = extractArticleFromHtml(html, "text/html; charset=utf-8", "example.com");
    expect(extracted.title).toBe("Deep Reading & Memory");
    expect(extracted.author).toBe("Jane Doe");
    expect(extracted.language).toBe("en");
    expect(extracted.paragraphs).toHaveLength(2);
    expect(extracted.paragraphs[0]).toContain("First long paragraph");
    expect(extracted.paragraphs.join(" ")).not.toContain("Menu item");
    expect(extracted.paragraphs.join(" ")).not.toContain("Copyright notice");
    expect(extracted.paragraphs.join(" ")).not.toContain("alert");
  });
});

describe("POST /api/articles/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    loadPlanMock.mockResolvedValue({ plan: "lecta_plus", trialEndsAt: null });
    consumeRateUnitsMock.mockResolvedValue(true);
  });

  it("exige sesión (401) y plan Lecta+ (402 en cuenta free)", async () => {
    const app = mountApp(vi.fn() as unknown as typeof fetch);

    getSessionMock.mockResolvedValueOnce(null);
    expect((await postExtract(app, "https://example.com/a")).status).toBe(401);

    loadPlanMock.mockResolvedValueOnce({ plan: "free", trialEndsAt: null });
    const res402 = await postExtract(app, "https://example.com/a");
    expect(res402.status).toBe(402);
    expect(await res402.json()).toMatchObject({ code: "LECTA_PLUS_REQUIRED" });
  });

  it("aplica cuota horaria (429)", async () => {
    consumeRateUnitsMock.mockResolvedValueOnce(false);
    const fetchSpy = vi.fn();
    const app = mountApp(fetchSpy as unknown as typeof fetch);

    const res = await postExtract(app, "https://example.com/a");
    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza redirects hacia destinos internos/no-HTTPS con 400", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    const app = mountApp(fetchMock as unknown as typeof fetch);
    const res = await postExtract(app, "https://example.com/redirect");
    expect(res.status).toBe(400);
  });

  it("rechaza content-type application/pdf con 415", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("binary", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    const app = mountApp(fetchMock as unknown as typeof fetch);
    const res = await postExtract(app, "https://example.com/doc.pdf");
    expect(res.status).toBe(415);
  });

  it("rechaza respuestas > 2 MB tanto por content-length como por stream", async () => {
    const appHeader = mountApp(
      vi.fn(async () =>
        new Response("ok", {
          status: 200,
          headers: {
            "content-type": "text/html",
            "content-length": String(ARTICLE_MAX_BYTES + 100),
          },
        }),
      ) as unknown as typeof fetch,
    );
    expect((await postExtract(appHeader, "https://example.com/huge")).status).toBe(413);

    const bigChunk = new Uint8Array(ARTICLE_MAX_BYTES + 10);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bigChunk);
        controller.close();
      },
    });
    const appStream = mountApp(
      vi.fn(async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ) as unknown as typeof fetch,
    );
    expect((await postExtract(appStream, "https://example.com/stream-huge")).status).toBe(413);
  });

  it("extrae título y párrafos reales en memoria con 200", async () => {
    const html = `<html lang="es"><head><title>Un ensayo breve</title></head><body><article><p>Primer párrafo del ensayo en español.</p><p>Segundo párrafo con ideas claras.</p></article></body></html>`;
    const app = mountApp(
      vi.fn(async () =>
        new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ) as unknown as typeof fetch,
    );
    const res = await postExtract(app, "https://blog.example.com/ensayo");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { title: string; paragraphs: string[]; language: string };
    expect(json.title).toBe("Un ensayo breve");
    expect(json.language).toBe("es");
    expect(json.paragraphs).toEqual([
      "Primer párrafo del ensayo en español.",
      "Segundo párrafo con ideas claras.",
    ]);
  });

  it("extrae texto plano (text/plain) separado por líneas en blanco", () => {
    const plain = "Título del ensayo\n\nPrimer párrafo suficientemente largo de texto plano.\n\nSegundo párrafo claro.";
    const extracted = extractArticleFromHtml(plain, "text/plain; charset=utf-8", "notes.example.com");
    expect(extracted.title).toBe("Título del ensayo");
    expect(extracted.paragraphs).toEqual([
      "Título del ensayo",
      "Primer párrafo suficientemente largo de texto plano.",
      "Segundo párrafo claro.",
    ]);
  });

  it("devuelve 400 si el cuerpo JSON es inválido", async () => {
    const app = mountApp(vi.fn() as unknown as typeof fetch);
    const res = await app.fetch(
      new Request("https://lectal.app/api/articles/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{bad-json",
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("falla cerrado con 503 si consumeRateUnits lanza un error", async () => {
    consumeRateUnitsMock.mockRejectedValueOnce(new Error("db down"));
    const fetchSpy = vi.fn();
    const app = mountApp(fetchSpy as unknown as typeof fetch);
    const res = await postExtract(app, "https://example.com/a");
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("devuelve 502 si el origen responde error HTTP o falla la red", async () => {
    const appHttpErr = mountApp(
      vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch,
    );
    expect((await postExtract(appHttpErr, "https://example.com/missing")).status).toBe(502);

    const appNetErr = mountApp(
      vi.fn(async () => {
        throw new Error("network timeout");
      }) as unknown as typeof fetch,
    );
    expect((await postExtract(appNetErr, "https://example.com/down")).status).toBe(502);
  });

  it("sigue una redirección 302 segura hacia otro host HTTPS y extrae el artículo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/article" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          `<html><head><title>Redirigido</title></head><body><article><p>Contenido después de la redirección segura.</p></article></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      );
    const app = mountApp(fetchMock as unknown as typeof fetch);
    const res = await postExtract(app, "https://example.com/short");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sourceHost: string; title: string };
    expect(json.sourceHost).toBe("cdn.example.com");
    expect(json.title).toBe("Redirigido");
  });

  it("devuelve 422 cuando el HTML no tiene párrafos legibles", async () => {
    const app = mountApp(
      vi.fn(async () =>
        new Response("<html><body><nav><a href='/'>Inicio</a></nav></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ) as unknown as typeof fetch,
    );
    const res = await postExtract(app, "https://example.com/empty");
    expect(res.status).toBe(422);
  });
});
