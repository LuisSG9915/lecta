// Contrato de la «guía de papel» de la biblioteca comunitaria (modelo
// A1: solo palabras). Es lo ÚNICO que viaja entre lectores: índice de
// capítulos y, por capítulo, las formas únicas no-stopword ordenadas
// alfabéticamente. Cero texto del autor — sin frases, sin citas, sin
// orden narrativo — así que el archivo EPUB nunca sale de la cuenta
// de quien lo compartió y la guía no es una obra derivada protegible:
// es un índice léxico.
//
// `sanitizePaperBookGuide` reconstruye el objeto campo a campo: tanto
// en el worker (antes de guardar en R2) como en el cliente (antes de
// persistir en IndexedDB) cualquier propiedad extra se descarta — la
// garantía de «solo palabras» no depende de quien envía el JSON.

import { isStopword } from "./stopwords";
import { isWordToken } from "./word-form";

export const PAPER_GUIDE_VERSION = 1;
// Defensas de tamaño: un EPUB razonable nunca las excede y evitan que
// una guía malformada infle el almacenamiento de sesión.
export const PAPER_GUIDE_MAX_CHAPTERS = 600;
export const PAPER_GUIDE_MAX_FORMS_PER_CHAPTER = 8000;
export const PAPER_GUIDE_LABEL_MAX = 60;

// Clave de sesión (IndexedDB store `session`) donde el cliente guarda
// la guía de un libro paper_only — viaja en el respaldo JSON y se
// borra con el libro por `isBookScopedSessionKey`.
export const paperGuideSessionKey = (bookHash: string) =>
  `paperGuide:v1:${bookHash}`;

export type PaperGuideChapterKind =
  | "chapter"
  | "preliminary"
  | "frontmatter"
  | "other"
  | "uncertain";

export type PaperGuideChapter = {
  // Identidad del destino dentro del libro (ruta#fragmento del índice).
  id: string;
  // Rótulo del capítulo truncado a PAPER_GUIDE_LABEL_MAX caracteres.
  label: string;
  depth: number;
  kind: PaperGuideChapterKind;
  // Formas únicas del capítulo en minúsculas, orden A–Z, sin stopwords.
  forms: string[];
  // Subconjunto que solo apareció capitalizado (nombres, extranjerismos).
  capitalOnly: string[];
};

export type PaperBookGuide = {
  version: typeof PAPER_GUIDE_VERSION;
  bookHash: string;
  title: string;
  author: string;
  language: string;
  updatedAt: number;
  chapters: PaperGuideChapter[];
};

const CHAPTER_KINDS: ReadonlySet<string> = new Set([
  "chapter",
  "preliminary",
  "frontmatter",
  "other",
  "uncertain",
]);

const asFormList = (
  value: unknown,
  language: string,
  limit = PAPER_GUIDE_MAX_FORMS_PER_CHAPTER,
): string[] => {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const form = item.trim().toLowerCase();
    if (!form || !isWordToken(form) || isStopword(form, language)) continue;
    out.add(form);
    if (out.size >= limit) break;
  }
  return [...out].sort((a, b) => a.localeCompare(b));
};

// Reconstruye la guía desde datos arbitrarios. Devuelve null si falta
// algo esencial (versión, hash esperado, capítulos válidos); en caso
// contrario produce SIEMPRE el objeto canónico: campos y nada más.
export function sanitizePaperBookGuide(
  input: unknown,
  expectedHash: string,
): PaperBookGuide | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (raw.version !== PAPER_GUIDE_VERSION) return null;
  if (typeof raw.bookHash !== "string" || raw.bookHash !== expectedHash)
    return null;
  const language =
    typeof raw.language === "string" && raw.language ? raw.language : "es";
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : Date.now();
  if (!Array.isArray(raw.chapters)) return null;

  const chapters: PaperGuideChapter[] = [];
  for (const item of raw.chapters) {
    if (chapters.length >= PAPER_GUIDE_MAX_CHAPTERS) break;
    if (!item || typeof item !== "object") continue;
    const ch = item as Record<string, unknown>;
    if (typeof ch.id !== "string" || !ch.id) continue;
    const label =
      typeof ch.label === "string" && ch.label.trim()
        ? ch.label.trim().slice(0, PAPER_GUIDE_LABEL_MAX)
        : "Capítulo";
    const kind = CHAPTER_KINDS.has(String(ch.kind))
      ? (ch.kind as PaperGuideChapterKind)
      : "uncertain";
    chapters.push({
      id: ch.id,
      label,
      depth:
        typeof ch.depth === "number" && Number.isFinite(ch.depth) && ch.depth >= 0
          ? Math.min(Math.floor(ch.depth), 20)
          : 0,
      kind,
      forms: asFormList(ch.forms, language),
      capitalOnly: asFormList(ch.capitalOnly, language),
    });
  }
  if (!chapters.length) return null;

  return {
    version: PAPER_GUIDE_VERSION,
    bookHash: expectedHash,
    title: typeof raw.title === "string" ? raw.title.slice(0, 200) : "",
    author: typeof raw.author === "string" ? raw.author.slice(0, 200) : "",
    language,
    updatedAt,
    chapters,
  };
}
