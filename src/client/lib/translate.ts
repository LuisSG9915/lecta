import { accountFetch } from "./account-fetch";
import type { DbScope } from "./idb";

/**
 * Traduce un párrafo de forma natural (de inglés a español) para la lectura bilingüe fluida.
 */
export async function translateParagraph(
  text: string,
  from = "en",
  to = "es",
  scope?: DbScope,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  try {
    const res = await accountFetch(
      "/api/ai/translate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed, from, to }),
      },
      scope,
    );

    if (res.ok) {
      const data = (await res.json()) as { translation?: string };
      if (typeof data.translation === "string" && data.translation.trim()) {
        return data.translation.trim();
      }
    }
  } catch {
    // Fallback suave en caso de error de red o modo sin conexión
  }

  return trimmed;
}
