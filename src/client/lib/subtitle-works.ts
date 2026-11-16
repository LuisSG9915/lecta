// «Series y películas» con subtítulos propios: el usuario trae su
// archivo (.srt, .vtt, .ass) y el navegador arma la guía de vocabulario
// sin red. El texto del subtítulo vive solo en memoria durante la
// llamada; lo que se guarda es la misma lista «solo palabras» de la
// guía de papel (formas, nombres propios y claves del banco de
// frases), en el dispositivo del usuario y nunca en el servidor.
// Ver docs/designs/2026-11-15-explora-derechos.md (alternativa
// «subtítulos del usuario»).

import { detectMultiwordPhrases } from "../../shared/foreign-idioms";
import { subtitleToForms } from "../../shared/screen-guide";
import {
  decodeSubtitleBytes,
  normalizeSubtitleText,
  SUBTITLE_MAX_BYTES,
} from "../../shared/subtitle-parse";

export type SubtitleWorkType = "movie" | "tv";
export type SubtitleWorkLanguage = "es" | "en";

// Menos formas que esto = archivo vacío, roto o solo efectos de sonido.
export const SUBTITLE_MIN_FORMS = 50;

export type SubtitleWorkRef = {
  type: SubtitleWorkType;
  title: string;
  language: SubtitleWorkLanguage;
  season?: number; // tv: 0–99
  episode?: number; // tv: 1–999
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const intInRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

// Título normalizado para la identidad: sin acentos ni mayúsculas ni
// puntuación, para que «Dark», «dark » y «DÁRK» sean la misma serie.
export const normalizeWorkTitle = (title: string): string =>
  title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function isValidSubtitleRef(ref: SubtitleWorkRef): boolean {
  if (ref.type !== "movie" && ref.type !== "tv") return false;
  if (ref.language !== "es" && ref.language !== "en") return false;
  if (!normalizeWorkTitle(ref.title) || ref.title.length > 120) return false;
  if (ref.type === "tv") {
    return intInRange(ref.season, 0, 99) && intInRange(ref.episode, 1, 999);
  }
  return ref.season === undefined && ref.episode === undefined;
}

// Identidad local de la obra: SHA-256 hex de
// «lecta-subs:v1:<type>:<título normalizado>:<idioma>». Distinta del
// hash de las obras que venían de OMDb, y cumple SHA256_HEX_RE.
export async function subtitleWorkHash(
  ref: Pick<SubtitleWorkRef, "type" | "title" | "language">,
): Promise<string | null> {
  const title = normalizeWorkTitle(ref.title);
  if (!title) return null;
  const data = new TextEncoder().encode(
    `lecta-subs:v1:${ref.type}:${title}:${ref.language}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

// Capítulo dentro de la obra: «movie» o «sNN eNN» (mismo contrato que
// las obras de OMDb, para que la hoja de palabras no cambie).
export function subtitleChapterId(ref: SubtitleWorkRef): string {
  return ref.type === "movie" ? "movie" : `s${pad2(ref.season!)}e${pad2(ref.episode!)}`;
}

export function subtitleChapterLabel(ref: SubtitleWorkRef): string {
  return ref.type === "movie" ? "Película" : `T${ref.season} · E${ref.episode}`;
}

export type SubtitleGuideResult =
  | {
      ok: true;
      forms: string[];
      capitalOnly: string[];
      phrases: string[];
    }
  | { ok: false; reason: "too-big" | "too-few-forms" | "unreadable" };

// Del archivo a la guía «solo palabras». Nada de esto toca la red.
export async function subtitleFileToGuide(
  file: Blob & { name?: string },
  language: SubtitleWorkLanguage,
): Promise<SubtitleGuideResult> {
  if (file.size > SUBTITLE_MAX_BYTES) return { ok: false, reason: "too-big" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const { text } = normalizeSubtitleText(file.name ?? "", decodeSubtitleBytes(bytes));
  const { forms, capitalOnly } = subtitleToForms(text, language);
  if (forms.length < SUBTITLE_MIN_FORMS) {
    return { ok: false, reason: "too-few-forms" };
  }
  const phrases = [
    ...new Set(detectMultiwordPhrases(text, language).map((p) => p.normalizedId)),
  ];
  return { ok: true, forms, capitalOnly, phrases };
}

export const subtitleErrorMessage = (
  reason: "too-big" | "too-few-forms" | "unreadable",
): string =>
  reason === "too-big"
    ? "El archivo es demasiado grande para ser un subtítulo."
    : reason === "too-few-forms"
      ? "No encontramos suficiente diálogo en ese archivo. ¿Es un .srt, .vtt o .ass del idioma elegido?"
      : "No pudimos leer el archivo.";
