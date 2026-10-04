export const DEFAULT_WPM = 180;
export const MIN_WPM = 100;
export const MAX_WPM = 600;

// Palabras totales (no únicas) de un texto: base del tiempo estimado.
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Progreso del libro ponderado por el tamaño de cada sección.
export function bookProgress(sizes: number[], index: number, scrollRatio: number): number {
  const total = sizes.reduce((sum, size) => sum + Math.max(0, size), 0);
  if (!total) return 0;
  let read = 0;
  for (let i = 0; i < Math.min(index, sizes.length); i += 1) {
    read += Math.max(0, sizes[i]);
  }
  const current = sizes[index] ?? 0;
  const ratio = Math.min(1, Math.max(0, scrollRatio));
  return Math.min(1, (read + current * ratio) / total);
}

// Minutos restantes de la sección, redondeados hacia arriba.
export function minutesLeft(totalWords: number, scrollRatio: number, wpm: number): number {
  const ratio = Math.min(1, Math.max(0, scrollRatio));
  const remaining = Math.max(0, totalWords * (1 - ratio));
  return Math.ceil(remaining / Math.max(wpm, 1));
}

// Media móvil acotada de la velocidad de lectura medida.
// Devuelve null si la muestra no es confiable (muy poco texto o tiempo).
export function updateWpm(
  current: number | null,
  wordsRead: number,
  msSpent: number,
): number | null {
  if (wordsRead < 40 || msSpent < 15_000 || msSpent > 15 * 60_000) return current;
  const observed = Math.min(MAX_WPM, Math.max(MIN_WPM, wordsRead / (msSpent / 60_000)));
  const next = current === null ? observed : current * 0.7 + observed * 0.3;
  return Math.round(Math.min(MAX_WPM, Math.max(MIN_WPM, next)));
}
