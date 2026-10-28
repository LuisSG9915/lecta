/**
 * Validador de "Tap Intencional" (Anti-Missclick Guard).
 * Protege contra toques accidentales en móvil (acomodar pulgar, scroll, swipe, bordes de pantalla y stopwords).
 */

export interface TapCoordinates {
  clientX: number;
  clientY: number;
}

export interface TapIntentValidationInput {
  downPoint?: TapCoordinates | null;
  upPoint: TapCoordinates;
  pointerType?: string;
  lastScrollOrNavTime?: number;
  now?: number;
  viewportWidth?: number;
  word?: string;
  isLongPress?: boolean;
}

export interface TapIntentResult {
  valid: boolean;
  reason?: "movement_delta" | "scroll_cooldown" | "thumb_edge_zone" | "stopword";
}

const SPECIFIC_STOPWORDS = new Set([
  "el", "la", "de", "en", "y", "a", "que", "un", "al", "del", "se", "o", "u",
  "si", "no", "es", "su", "me", "te", "le", "lo", "los", "las", "por", "con",
  // English common short particles
  "the", "in", "on", "at", "to", "by", "of", "or", "and", "is", "it", "as", "an",
]);

export function cleanWordForStopwordCheck(rawWord: string): string {
  return rawWord
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function isStopwordMissclick(rawWord?: string | null): boolean {
  if (!rawWord) return true;
  const cleaned = cleanWordForStopwordCheck(rawWord);
  if (!cleaned) return true;
  // Artículos, preposiciones o conjunciones de <= 2 letras
  if (cleaned.length <= 2) return true;
  // Stopwords explícitas como 'que', 'del', 'los', 'las', 'por', 'con'
  return SPECIFIC_STOPWORDS.has(cleaned);
}

export function validateTapIntent(input: TapIntentValidationInput): TapIntentResult {
  const isTouch = input.pointerType === "touch" || input.pointerType === "pen";

  // a) Delta de movimiento: Math.hypot(upX - downX, upY - downY) < 8 px
  if (input.downPoint) {
    const delta = Math.hypot(
      input.upPoint.clientX - input.downPoint.clientX,
      input.upPoint.clientY - input.downPoint.clientY,
    );
    if (delta >= 8) {
      return { valid: false, reason: "movement_delta" };
    }
  }

  // b) Cooldown de Scroll: Ignora cualquier tap si ocurrió scroll o cambio de página en los últimos 180 ms
  const now = input.now ?? Date.now();
  if (input.lastScrollOrNavTime && now - input.lastScrollOrNavTime < 180) {
    return { valid: false, reason: "scroll_cooldown" };
  }

  // c) Edge Safe-Zone (Zona del Pulgar): Si pointerType === 'touch', ignora taps en el 8% izquierdo o derecho
  if (isTouch && !input.isLongPress) {
    const vw = input.viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1000);
    const x = input.upPoint.clientX;
    if (x < vw * 0.08 || x > vw * 0.92) {
      return { valid: false, reason: "thumb_edge_zone" };
    }
  }

  // d) Filtro de Stopwords: Si el tap cae sobre artículos, preposiciones o conjunciones <= 2 letras o stopwords
  if (!input.isLongPress && isStopwordMissclick(input.word)) {
    return { valid: false, reason: "stopword" };
  }

  return { valid: true };
}
