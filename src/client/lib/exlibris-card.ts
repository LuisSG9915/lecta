import { bookDisplayName } from "../../shared/book-display";
import { resolveCoatId, type CompanionCoatId } from "../../shared/companion-data";
import { totalReadingMs } from "./journey";
import {
  copyQuoteCardToClipboard,
  downloadQuoteCard,
  drawCompanionCat,
  THEME_PALETTES,
  wrapCanvasText,
} from "./quote-card";

export const EXLIBRIS_WIDTH = 1080;
export const EXLIBRIS_HEIGHT = 1920;
export const EXLIBRIS_MAX_WORDS = 5;

export type ExlibrisTheme = "papel" | "noche";

export interface ExlibrisInput {
  bookTitle?: string;
  bookName?: string;
  author?: string;
  readingMinutes?: number;
  words?: string[];
  theme?: ExlibrisTheme;
  includeCompanion?: boolean;
  coatId?: CompanionCoatId;
  companionStage?: number;
  finishedDate?: string;
}

export interface ExlibrisData {
  title: string;
  author: string | null;
  readingTimeLabel: string | null;
  words: string[];
  theme: ExlibrisTheme;
  includeCompanion: boolean;
  coatId: CompanionCoatId;
  companionStage: number;
  finishedDate: string | null;
}

/**
 * Formatea una duración real en minutos o devuelve null si es cero o ausente.
 * Nunca inventa horas ni redondea un cero hacia arriba.
 */
export function formatExlibrisDuration(minutes?: number): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  const rounded = Math.round(minutes);
  if (rounded <= 0) return null;
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rem = rounded % 60;
  if (rem === 0) return `${hours} h`;
  return `${hours} h ${rem} min`;
}

function dedupeWords(rawWords?: string[]): string[] {
  if (!rawWords || rawWords.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of rawWords) {
    const clean = entry.trim();
    if (!clean) continue;
    const key = clean.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= EXLIBRIS_MAX_WORDS) break;
  }
  return out;
}

/**
 * Normaliza título, duración real y hasta 5 palabras del libro para el Exlibris.
 */
export function buildExlibrisData(input: ExlibrisInput): ExlibrisData {
  const title = bookDisplayName({ title: input.bookTitle, name: input.bookName });
  const author = input.author?.trim() || null;
  const readingTimeLabel = formatExlibrisDuration(input.readingMinutes);
  const words = dedupeWords(input.words);
  const theme: ExlibrisTheme = input.theme === "noche" ? "noche" : "papel";
  const includeCompanion = input.includeCompanion ?? true;
  const coatId = resolveCoatId(input.coatId);
  const rawStage = typeof input.companionStage === "number" ? input.companionStage : 1;
  const companionStage = Math.max(0, Math.min(3, Math.floor(rawStage)));
  const finishedDate = input.finishedDate?.trim() || null;

  return {
    title,
    author,
    readingTimeLabel,
    words,
    theme,
    includeCompanion,
    coatId,
    companionStage,
    finishedDate,
  };
}

/**
 * Extrae únicamente palabras e intervalos reales pertenecientes a `bookHash`.
 */
export function collectBookExlibrisStats(
  bookHash: string,
  words: Array<{ bookHash?: string; form?: string; lemma?: string; savedAt?: number; deleted?: boolean }>,
  intervals: Array<{ bookHash?: string; startedAt: number; endedAt: number }>,
): { words: string[]; readingMinutes: number } {
  const bookWords = words
    .filter((w) => !w.deleted && w.bookHash === bookHash)
    .slice()
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
    .map((w) => w.lemma?.trim() || w.form?.trim() || "")
    .filter(Boolean);

  const bookIntervals = intervals.filter((iv) => iv.bookHash === bookHash);
  const ms = totalReadingMs(bookIntervals);
  const readingMinutes = ms > 0 ? Math.max(1, Math.round(ms / 60_000)) : 0;

  return {
    words: dedupeWords(bookWords),
    readingMinutes,
  };
}

/**
 * Renderiza la lámina de Exlibris 9:16 (1080×1920) en un Canvas HTML5.
 */
export async function renderExlibrisToCanvas(
  input: ExlibrisInput,
  targetCanvas?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      await document.fonts.ready;
    } catch {
      // continuar con fuentes disponibles
    }
  }

  const canvas = targetCanvas ?? document.createElement("canvas");
  canvas.width = EXLIBRIS_WIDTH;
  canvas.height = EXLIBRIS_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const data = buildExlibrisData(input);
  const palette = THEME_PALETTES[data.theme] ?? THEME_PALETTES.papel;
  const width = EXLIBRIS_WIDTH;
  const height = EXLIBRIS_HEIGHT;

  // Fondo
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  // Marco editorial exterior e interior
  const inset = 54;
  const innerInset = inset + 14;
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  ctx.lineWidth = 1;
  ctx.strokeRect(innerInset, innerInset, width - innerInset * 2, height - innerInset * 2);

  const contentX = innerInset + 86;
  const contentWidth = width - contentX * 2;
  const centerX = width / 2;

  // Doble filete superior de imprenta
  let cursorY = innerInset + 88;
  ctx.strokeStyle = palette.brand;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(contentX, cursorY);
  ctx.lineTo(width - contentX, cursorY);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(contentX, cursorY + 9);
  ctx.lineTo(width - contentX, cursorY + 9);
  ctx.stroke();

  // Sello «EXLIBRIS» + pequeño rombo tipográfico
  cursorY += 68;
  const sansFont = '"Alegreya Sans", system-ui, sans-serif';
  const serifFont = '"Literata Variable", Literata, Georgia, serif';

  ctx.font = `600 28px ${sansFont}`;
  ctx.fillStyle = palette.brand;
  ctx.textAlign = "center";
  ctx.fillText("EXLIBRIS", centerX, cursorY);

  // Rombo ornamental minimalista
  cursorY += 28;
  ctx.fillStyle = palette.brand;
  ctx.beginPath();
  ctx.moveTo(centerX, cursorY - 7);
  ctx.lineTo(centerX + 7, cursorY);
  ctx.lineTo(centerX, cursorY + 7);
  ctx.lineTo(centerX - 7, cursorY);
  ctx.closePath();
  ctx.fill();

  // Título normalizado del libro
  cursorY += 98;
  const titleLen = data.title.length;
  const titleFontSize = titleLen > 64 ? 42 : titleLen > 34 ? 52 : 62;
  const titleLineHeight = Math.round(titleFontSize * 1.28);

  ctx.font = `italic 500 ${titleFontSize}px ${serifFont}`;
  ctx.fillStyle = palette.text;
  ctx.textAlign = "center";

  const rawTitleLines = wrapCanvasText(ctx, data.title, contentWidth);
  const titleLines =
    rawTitleLines.length > 4
      ? [...rawTitleLines.slice(0, 3), `${rawTitleLines[3].replace(/[…\s]+$/, "")}…`]
      : rawTitleLines;

  for (const line of titleLines) {
    ctx.fillText(line, centerX, cursorY);
    cursorY += titleLineHeight;
  }

  // Autor (si existe)
  if (data.author) {
    cursorY += 12;
    ctx.font = `italic 400 32px ${serifFont}`;
    ctx.fillStyle = palette.meta;
    const authorLines = wrapCanvasText(ctx, data.author, contentWidth).slice(0, 2);
    for (const aLine of authorLines) {
      ctx.fillText(aLine, centerX, cursorY);
      cursorY += 42;
    }
  }

  // Gato compañero centrado según pelaje y etapa
  if (data.includeCompanion) {
    const stageScales = [1.75, 2.0, 2.2, 2.35];
    const catScale = stageScales[data.companionStage] ?? 2.0;
    const catY = Math.max(cursorY + 130, 880);
    ctx.save();
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(centerX, catY - 4, 126, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawCompanionCat(ctx, centerX, catY, catScale, data.coatId);
    cursorY = catY + 148;
  } else {
    cursorY = Math.max(cursorY + 72, 760);
  }

  // Tiempo de lectura real (omitir si es null / 0)
  if (data.readingTimeLabel) {
    ctx.font = `600 22px ${sansFont}`;
    ctx.fillStyle = palette.meta;
    ctx.textAlign = "center";
    ctx.fillText("Tiempo de lectura", centerX, cursorY);
    cursorY += 44;
    ctx.font = `500 38px ${serifFont}`;
    ctx.fillStyle = palette.text;
    ctx.fillText(data.readingTimeLabel, centerX, cursorY);
    cursorY += 68;
  }

  // Hasta 5 palabras guardadas del libro (omitir si está vacío)
  if (data.words.length > 0) {
    ctx.font = `600 22px ${sansFont}`;
    ctx.fillStyle = palette.brand;
    ctx.textAlign = "center";
    ctx.fillText("PALABRAS GUARDADAS", centerX, cursorY);
    cursorY += 46;

    ctx.font = `normal 400 30px ${serifFont}`;
    ctx.fillStyle = palette.text;
    const wordsJoined = data.words.join(" · ");
    const wordLines = wrapCanvasText(ctx, wordsJoined, contentWidth).slice(0, 4);
    for (const wLine of wordLines) {
      ctx.fillText(wLine, centerX, cursorY);
      cursorY += 44;
    }
  }

  // Pie editorial: regla fina + fecha (si hay) + firma
  const footerLineY = height - innerInset - 124;
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX - 110, footerLineY);
  ctx.lineTo(centerX + 110, footerLineY);
  ctx.stroke();

  if (data.finishedDate) {
    ctx.font = `italic 400 22px ${serifFont}`;
    ctx.fillStyle = palette.meta;
    ctx.textAlign = "center";
    ctx.fillText(data.finishedDate, centerX, footerLineY + 38);
  }

  ctx.font = `500 24px ${sansFont}`;
  ctx.fillStyle = palette.brand;
  ctx.textAlign = "center";
  ctx.fillText("Lecta · lectal.app", centerX, height - innerInset - 44);

  return canvas;
}

export async function generateExlibrisBlob(input: ExlibrisInput): Promise<Blob> {
  const canvas = await renderExlibrisToCanvas(input);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar el archivo PNG del Exlibris"));
    }, "image/png");
  });
}

export function exlibrisFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `exlibris-${slug || "lecta"}.png`;
}

export function downloadExlibrisCard(blob: Blob, title: string): void {
  downloadQuoteCard(blob, exlibrisFilename(title));
}

export async function copyExlibrisToClipboard(blob: Blob): Promise<boolean> {
  return copyQuoteCardToClipboard(blob);
}

export async function shareExlibrisCard(
  blob: Blob,
  input: ExlibrisInput,
): Promise<"shared" | "copied" | "downloaded"> {
  const data = buildExlibrisData(input);
  const filename = exlibrisFilename(data.title);
  const file = new File([blob], filename, { type: "image/png" });
  const shareTitle = `Exlibris · ${data.title}`;

  if (
    typeof navigator !== "undefined" &&
    "canShare" in navigator &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: shareTitle,
        text: data.author ? `${data.title} — ${data.author}` : data.title,
      });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "shared";
    }
  }

  const copied = await copyExlibrisToClipboard(blob);
  if (copied) return "copied";

  downloadExlibrisCard(blob, data.title);
  return "downloaded";
}
