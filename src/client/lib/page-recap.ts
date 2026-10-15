import { accountFetch } from "./account-fetch";
import type { DbScope } from "./idb";

export interface PageRecapResult {
  bullets: string[];
  hookQuestion: string;
  fallback?: boolean;
}

export function deterministicPageRecapFallback(text: string): PageRecapResult {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
  const b1 = sentences[0]
    ? (sentences[0].length > 80 ? sentences[0].slice(0, 77) + "..." : sentences[0])
    : "La lectura transcurre en este punto de la obra.";
  const b2 = sentences[1]
    ? (sentences[1].length > 80 ? sentences[1].slice(0, 77) + "..." : sentences[1])
    : "Los personajes y reflexiones continúan desenvolviéndose.";
  return {
    bullets: [b1, b2],
    hookQuestion: "¿Cómo continúa el hilo de este pasaje?",
    fallback: true,
  };
}

export async function requestPageRecap(
  options: { text: string; bookTitle?: string; chapterTitle?: string },
  scope?: DbScope,
): Promise<PageRecapResult> {
  const text = options.text.trim();
  if (!text) {
    return deterministicPageRecapFallback("");
  }
  try {
    const res = await accountFetch(
      "/api/ai/page-recap",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options),
      },
      scope,
    );
    if (!res.ok) {
      return deterministicPageRecapFallback(text);
    }
    const data = (await res.json()) as {
      bullets?: string[];
      hookQuestion?: string;
      fallback?: boolean;
    };
    if (
      Array.isArray(data.bullets) &&
      data.bullets.length > 0 &&
      typeof data.hookQuestion === "string" &&
      data.hookQuestion.trim()
    ) {
      return {
        bullets: data.bullets,
        hookQuestion: data.hookQuestion,
        fallback: data.fallback,
      };
    }
    return deterministicPageRecapFallback(text);
  } catch {
    return deterministicPageRecapFallback(text);
  }
}
