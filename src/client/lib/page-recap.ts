import { accountFetch } from "./account-fetch";
import type { DbScope } from "./idb";
import { isLikelyProperNoun } from "./character-helper";

export interface PageRecapResult {
  bullets: string[];
  hookQuestion: string;
  fallback?: boolean;
}

export interface SceneReturnRecap {
  lastReadSnippet: string;
  activeCharactersInScene: string[];
  hoursSinceLastRead: number;
  shouldShowAutomatically: boolean;
}

export const CHARACTER_MEMORY_KEY = "lecta:character-memory-enabled";

export function loadCharacterMemoryEnabled(): boolean {
  try {
    const val = localStorage.getItem(CHARACTER_MEMORY_KEY);
    return val === null ? true : val === "true";
  } catch {
    return true;
  }
}

export function saveCharacterMemoryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CHARACTER_MEMORY_KEY, String(enabled));
  } catch {
    // Quota o ambiente sin localStorage
  }
}

/**
 * Genera el resumen episódico de retorno CERO SPOILERS analizando únicamente los
 * últimos ~650 caracteres antes del cursor del lector.
 */
export function generateZeroSpoilerSceneRecap(
  textBeforeCursor: string,
  lastReadTimestampMs: number,
  nowMs = Date.now(),
  lang = "es",
): SceneReturnRecap {
  const hoursSinceLastRead = Math.max(0, (nowMs - lastReadTimestampMs) / 3_600_000);
  // Tomar los últimos ~650 caracteres antes del cursor del lector
  const recentWindow = textBeforeCursor.slice(-650).trim();

  const sentences = recentWindow
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  const lastReadSnippet =
    sentences.length > 0 ? sentences[sentences.length - 1] : recentWindow.slice(-140);

  // Extraer personajes presentes en los últimos párrafos leídos
  const characterCounts = new Map<string, number>();
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/);
    for (const rawWord of words) {
      if (isLikelyProperNoun(rawWord, sentence, lang)) {
        const clean = rawWord.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
        if (clean.length >= 3) {
          characterCounts.set(clean, (characterCounts.get(clean) ?? 0) + 1);
        }
      }
    }
  }

  const activeCharactersInScene = Array.from(characterCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name);

  const isEnabled = loadCharacterMemoryEnabled();

  return {
    lastReadSnippet,
    activeCharactersInScene,
    hoursSinceLastRead: Number(hoursSinceLastRead.toFixed(1)),
    shouldShowAutomatically: isEnabled && hoursSinceLastRead >= 12 && lastReadSnippet.length > 0,
  };
}

export function deterministicPageRecapFallback(
  text: string,
  maxBullets = 2,
): PageRecapResult {
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
  const bullets = [b1, b2];
  if (maxBullets >= 3 && sentences[2]) {
    bullets.push(
      sentences[2].length > 80 ? sentences[2].slice(0, 77) + "..." : sentences[2],
    );
  } else if (maxBullets >= 3 && sentences.length >= 2) {
    bullets.push("El hilo narrativo sigue su curso sin interrupciones.");
  }
  return {
    bullets,
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

/**
 * Analiza estrictamente las últimas 3 páginas leídas para generar un resumen
 * de 3 viñetas al volver a la lectura tras un periodo de inactividad.
 */
export async function requestLastPagesRecap(
  options: {
    lastPagesText: string[];
    bookTitle?: string;
    chapterTitle?: string;
  },
  scope?: DbScope,
): Promise<PageRecapResult> {
  const pages = options.lastPagesText
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(-3); // Estrictamente las últimas 3 páginas

  if (pages.length === 0) {
    return deterministicPageRecapFallback("", 3);
  }

  const combinedText = pages.join("\n\n---\n\n");
  const recap = await requestPageRecap(
    {
      text: combinedText,
      bookTitle: options.bookTitle,
      chapterTitle: options.chapterTitle,
    },
    scope,
  );

  return recap;
}
