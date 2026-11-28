/**
 * Extrae una URL HTTPS compartida hacia Lecta vía PWA `share_target` (`?url=` o `?text=`).
 * Módulo mínimo sin dependencias para no engordar el arranque de `App.tsx`.
 */
export function extractSharedArticleUrl(
  urlParam?: string | null,
  textParam?: string | null,
): string | null {
  const candidates: string[] = [];
  if (typeof urlParam === "string" && urlParam.trim()) {
    candidates.push(urlParam.trim());
  }
  if (typeof textParam === "string" && textParam.trim()) {
    const match = textParam.match(/https:\/\/[^\s<>"']+/i);
    if (match?.[0]) candidates.push(match[0]);
  }

  for (const raw of candidates) {
    const cleaned = raw.replace(/[.,;!?)\]]+$/, "");
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      // probar siguiente candidato
    }
  }
  return null;
}
