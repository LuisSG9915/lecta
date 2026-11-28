import { Hono } from "hono";
import { runInBackground } from "./background";
import type { WorkerEnv } from "./db";
import { recordLandingEvent, recordPlanEvent } from "./landing-events";
import { requireLectaPlus, type PlanVariables } from "./plan-middleware";
import { consumeRateUnits } from "./rate-limit";

export const ARTICLE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const ARTICLE_TIMEOUT_MS = 5_000;
export const ARTICLE_MAX_REDIRECTS = 3;
export const ARTICLE_RATE_LIMIT = 20;
export const ARTICLE_RATE_SCOPE = "article-extract";

const MAX_URL_LENGTH = 2048;
const MAX_PARAGRAPHS = 400;
const MAX_TOTAL_CHARS = 250_000;

export interface ExtractedArticlePayload {
  title: string;
  author?: string;
  language: string;
  sourceHost: string;
  paragraphs: string[];
}

function isIpv4Literal(host: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (/^\d+$/.test(host)) return true;
  if (/^(?:0x[0-9a-f]+|0\d+)(?:\.(?:0x[0-9a-f]+|\d+))*$/i.test(host)) return true;
  return false;
}

/**
 * Política estricta anti-SSRF: solo HTTPS público en puerto 443, sin credenciales,
 * sin IPs literales (v4/v6/numérica/hex) y sin dominios internos/locales.
 */
export function validateArticleUrl(
  raw: unknown,
): { ok: true; url: URL } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Ingresa un enlace HTTPS válido." };
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, error: "El enlace está vacío o es demasiado largo." };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "El enlace no tiene un formato válido." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "Solo se aceptan enlaces seguros (https://)." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "No se permiten credenciales en el enlace." };
  }
  if (url.port !== "" && url.port !== "443") {
    return { ok: false, error: "Solo se permite el puerto HTTPS estándar." };
  }

  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host || !host.includes(".") || host.includes("[") || host.includes(":")) {
    return { ok: false, error: "Usa un dominio público válido." };
  }
  if (!/^[a-z0-9.-]+$/.test(host) || isIpv4Literal(host)) {
    return { ok: false, error: "No se permiten direcciones IP ni hosts locales." };
  }
  if (
    host === "localhost" ||
    host === "metadata" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".arpa")
  ) {
    return { ok: false, error: "No se permiten hosts internos o reservados." };
  }

  return { ok: true, url };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    });
}

function stripTagsAndNormalize(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function detectLanguage(html: string, sampleText: string): string {
  const langMatch =
    html.match(/<html\b[^>]*\blang=["']([a-z]{2})(?:-[a-z0-9]+)?["']/i) ??
    html.match(/<meta\b[^>]*http-equiv=["']content-language["'][^>]*content=["']([a-z]{2})/i);
  if (langMatch?.[1]) {
    const code = langMatch[1].toLowerCase();
    if (["es", "en", "fr", "pt", "it", "de"].includes(code)) return code;
  }
  const lower = ` ${sampleText.slice(0, 2500).toLowerCase()} `;
  const esHits = (lower.match(/\b(el|la|los|las|de|que|en|para|con|una?)\b/g) ?? []).length;
  const enHits = (lower.match(/\b(the|and|that|with|for|from|this|have|are)\b/g) ?? []).length;
  return enHits > esHits ? "en" : "es";
}

function readMetaContent(html: string, attrValue: string): string | undefined {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re1 = new RegExp(
    `<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']{1,300})["'][^>]*>`,
    "i",
  );
  const re2 = new RegExp(
    `<meta\\b[^>]*content=["']([^"']{1,300})["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`,
    "i",
  );
  const match = html.match(re1) ?? html.match(re2);
  const val = match?.[1] ? stripTagsAndNormalize(match[1]) : "";
  return val || undefined;
}

export function extractArticleFromHtml(
  rawText: string,
  contentType: string,
  fallbackHost: string,
): ExtractedArticlePayload {
  const isPlain = /^text\/plain\b/i.test(contentType);
  if (isPlain) {
    const rawParas = rawText
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length >= 2)
      .slice(0, MAX_PARAGRAPHS);
    const title =
      rawParas[0] && rawParas[0].length <= 140 ? rawParas[0] : fallbackHost;
    return {
      title,
      language: detectLanguage("", rawParas.join(" ")),
      sourceHost: fallbackHost,
      paragraphs: rawParas,
    };
  }

  const ogTitle = readMetaContent(rawText, "og:title");
  const tagTitleMatch = rawText.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = rawText.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const rawTitle =
    ogTitle ||
    (tagTitleMatch?.[1] ? stripTagsAndNormalize(tagTitleMatch[1]) : "") ||
    (h1Match?.[1] ? stripTagsAndNormalize(h1Match[1]) : "") ||
    fallbackHost;
  const title = rawTitle.slice(0, 160);
  const authorRaw =
    readMetaContent(rawText, "author") ?? readMetaContent(rawText, "article:author");
  const author = authorRaw ? authorRaw.slice(0, 120) : undefined;

  const withoutNoise = rawText
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|svg|iframe|nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi,
      " ",
    );

  const articleMatch = withoutNoise.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = withoutNoise.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const bodyMatch = withoutNoise.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);

  const articleTextLen = articleMatch?.[1]
    ? stripTagsAndNormalize(articleMatch[1]).length
    : 0;
  const mainTextLen = mainMatch?.[1]
    ? stripTagsAndNormalize(mainMatch[1]).length
    : 0;

  const container =
    articleTextLen >= 200
      ? articleMatch![1]
      : mainTextLen >= 200
        ? mainMatch![1]
        : bodyMatch?.[1] ?? withoutNoise;

  const blocks = [...container.matchAll(/<(p|h2|h3|h4|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => stripTagsAndNormalize(m[2]))
    .filter((text) => text.length >= 2);

  const paragraphs: string[] = [];
  let charCount = 0;
  for (const text of blocks) {
    if (paragraphs.length >= MAX_PARAGRAPHS || charCount + text.length > MAX_TOTAL_CHARS) {
      break;
    }
    paragraphs.push(text);
    charCount += text.length;
  }

  return {
    title,
    ...(author ? { author } : {}),
    language: detectLanguage(rawText, paragraphs.join(" ")),
    sourceHost: fallbackHost,
    paragraphs,
  };
}

class ExtractHttpError extends Error {
  constructor(
    public readonly status: 400 | 413 | 415 | 422 | 502,
    message: string,
  ) {
    super(message);
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > ARTICLE_MAX_BYTES) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore cancel error
    }
    throw new ExtractHttpError(413, "La página supera el límite de 2 MB.");
  }

  if (!response.body) {
    const buf = await response.arrayBuffer();
    if (buf.byteLength > ARTICLE_MAX_BYTES) {
      throw new ExtractHttpError(413, "La página supera el límite de 2 MB.");
    }
    return new TextDecoder().decode(buf);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > ARTICLE_MAX_BYTES) {
          await reader.cancel().catch(() => {});
          throw new ExtractHttpError(413, "La página supera el límite de 2 MB.");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function fetchPublicArticle(
  initialUrl: URL,
  fetchImpl: typeof fetch,
): Promise<{ rawText: string; contentType: string; finalHost: string }> {
  let currentUrl = initialUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARTICLE_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= ARTICLE_MAX_REDIRECTS; hop += 1) {
      const response = await fetchImpl(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,text/plain;q=0.9",
          "user-agent": "LectaReader/1.0 (+https://lectal.app)",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        if (hop === ARTICLE_MAX_REDIRECTS) {
          throw new ExtractHttpError(422, "El enlace tiene demasiadas redirecciones.");
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new ExtractHttpError(502, "No se pudo seguir la redirección del artículo.");
        }
        let nextRaw: string;
        try {
          nextRaw = new URL(location, currentUrl).toString();
        } catch {
          throw new ExtractHttpError(400, "La redirección apunta a un enlace inválido.");
        }
        const check = validateArticleUrl(nextRaw);
        if (!check.ok) {
          throw new ExtractHttpError(400, check.error);
        }
        currentUrl = check.url;
        continue;
      }

      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        throw new ExtractHttpError(502, "No se pudo obtener el artículo desde ese sitio.");
      }

      const contentType = response.headers.get("content-type") || "";
      if (!/^text\/(html|plain)\b/i.test(contentType)) {
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        throw new ExtractHttpError(415, "Solo se pueden leer páginas web o texto plano.");
      }

      const rawText = await readBoundedText(response);
      return { rawText, contentType, finalHost: currentUrl.hostname.toLowerCase() };
    }
    throw new ExtractHttpError(422, "El enlace tiene demasiadas redirecciones.");
  } catch (err) {
    if (err instanceof ExtractHttpError) throw err;
    throw new ExtractHttpError(502, "No se pudo conectar con esa página a tiempo.");
  } finally {
    clearTimeout(timer);
  }
}

export function createArticleExtractRouter(fetchImpl: typeof fetch = fetch) {
  const router = new Hono<{ Bindings: WorkerEnv; Variables: PlanVariables }>();

  router.post("/api/articles/extract", requireLectaPlus, async (c) => {
    let body: { url?: unknown };
    try {
      body = (await c.req.json()) as { url?: unknown };
    } catch {
      return c.json({ error: "Cuerpo JSON inválido." }, 400);
    }

    const check = validateArticleUrl(body.url);
    if (!check.ok) {
      return c.json({ error: check.error }, 400);
    }

    const session = c.get("session");
    try {
      const allowed = await consumeRateUnits(
        c.env,
        session.user.id,
        1,
        ARTICLE_RATE_LIMIT,
        ARTICLE_RATE_SCOPE,
      );
      if (!allowed) {
        return c.json(
          { error: "Alcanzaste el límite por hora de importación de artículos." },
          429,
        );
      }
    } catch {
      return c.json(
        { error: "Servicio temporalmente no disponible. Intenta de nuevo en un momento." },
        503,
      );
    }

    try {
      const { rawText, contentType, finalHost } = await fetchPublicArticle(
        check.url,
        fetchImpl,
      );
      const article = extractArticleFromHtml(rawText, contentType, finalHost);
      if (article.paragraphs.length === 0) {
        return c.json(
          { error: "No pudimos extraer texto legible de ese enlace." },
          422,
        );
      }
      const source = c.get("planSource") ?? "plus";
      runInBackground(
        c,
        Promise.all([
          recordLandingEvent(c.env, { event: "app:article-import", source }).catch(() => false),
          recordPlanEvent(c.env, session.user.id, "app:article-import").catch(() => false),
        ]),
      );
      return c.json(article, 200);
    } catch (err) {
      if (err instanceof ExtractHttpError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo extraer el artículo." }, 502);
    }
  });

  return router;
}

export const articleExtract = createArticleExtractRouter();
