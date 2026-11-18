export const DEFAULT_WPM = 180;
export const MIN_WPM = 100;
export const MAX_WPM = 600;

// Muestra creíble de una sección: tiempo y texto mínimos para medir
// ritmo o dwell (una pasada de 5 s o una sesión olvidada no cuentan).
export const MIN_SAMPLE_WORDS = 40;
export const MIN_SAMPLE_MS = 15_000;
export const MAX_SAMPLE_MS = 15 * 60_000;

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

// Minutos que faltan para terminar el capítulo real (varias secciones EPUB).
// `sizes` está en bytes (tamaño del XHTML), no en palabras: las palabras
// solo se conocen de la sección abierta (`sectionWords`), así que las
// secciones siguientes se estiman con la razón palabras/byte medida en la
// actual (aproximación; sin muestra creíble solo cuenta la sección actual).
// Los capítulos que comparten archivo comparten rango y esto sobreestima
// un poco: cuenta lo que resta de la sección entera.
export function chapterMinutesLeft(
  sizes: number[],
  sectionIndex: number,
  range: { startSection: number; endSection: number } | null,
  sectionWords: number,
  scrollRatio: number,
  wpm: number,
): number {
  const ratio = Math.min(1, Math.max(0, scrollRatio));
  let words = Math.max(0, sectionWords * (1 - ratio));
  const currentSize = sizes[sectionIndex] ?? 0;
  if (range && sectionWords >= MIN_SAMPLE_WORDS && currentSize > 0) {
    const wordsPerByte = sectionWords / currentSize;
    for (let i = sectionIndex + 1; i < range.endSection; i += 1) {
      words += Math.max(0, sizes[i] ?? 0) * wordsPerByte;
    }
  }
  return Math.ceil(words / Math.max(wpm, 1));
}

// Texto de progreso del dock. En scroll, con catálogo, cuenta capítulos
// reales; sin él cae a secciones EPUB.
export function dockProgressText(opts: {
  layout: string;
  page: number;
  pageCount: number;
  sectionIndex: number;
  sectionTotal: number;
  minutes: number;
  ordinal: { n: number; total: number } | null;
}): string {
  const mins = opts.minutes > 0 ? ` · ~${opts.minutes} min` : "";
  if (opts.layout === "pages") return `Pág. ${opts.page + 1} de ${opts.pageCount || 1}${mins}`;
  if (opts.ordinal) return `Cap. ${opts.ordinal.n} de ${opts.ordinal.total}${mins}`;
  return `Cap. ${opts.sectionIndex + 1} de ${opts.sectionTotal || 1}${mins}`;
}

// Media móvil acotada de la velocidad de lectura medida.
// Devuelve null si la muestra no es confiable (muy poco texto o tiempo).
export function updateWpm(
  current: number | null,
  wordsRead: number,
  msSpent: number,
): number | null {
  if (
    wordsRead < MIN_SAMPLE_WORDS ||
    msSpent < MIN_SAMPLE_MS ||
    msSpent > MAX_SAMPLE_MS
  )
    return current;
  const observed = Math.min(MAX_WPM, Math.max(MIN_WPM, wordsRead / (msSpent / 60_000)));
  const next = current === null ? observed : current * 0.7 + observed * 0.3;
  return Math.round(Math.min(MAX_WPM, Math.max(MIN_WPM, next)));
}
