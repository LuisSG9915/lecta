// «Leo este libro en papel»: piezas puras de la pantalla de capítulos
// para quien lee el libro físico. El registro de capítulos leídos vive
// en el store `session` con clave versionada `paperReading:v1:{hash}` —
// registrada en isBookScopedSessionKey (muere con el libro) y en
// BACKUP_SESSION_PREFIXES (viaja en el respaldo). Sin React, sin red.

import type { ChapterCatalog, ChapterTarget } from "./chapters";
import {
  loadSessionValue,
  saveSessionValue,
  type DbScope,
} from "./idb";
import type { PreparationRecord } from "./preparation";
import type { SuggestionRow, SuggestionRows } from "./section-words";
import { extractChapterContextSnippet } from "./section-words";

// Palabras de la selección principal por capítulo. El resto queda en
// «Ver más palabras de este capítulo», como la bandeja deferred del
// lector — nunca se declaran conocidas por el recorte.
export const PAPER_MAIN_ROWS = 12;
// Tope de sugerencias del alta manual.
export const PAPER_SUGGESTIONS = 6;

export const paperReadingKey = (hash: string) => `paperReading:v1:${hash}`;

// Estado por libro de la lectura en papel: qué destinos ya marcó como
// leídos y el último abierto, para volver a donde se quedó.
export type PaperReadingRecord = {
  version: 1;
  bookHash: string;
  readTargetIds: string[];
  lastTargetId: string | null;
  updatedAt: number;
};

// Valida el registro guardado igual que parsePreparationRecord:
// versión desconocida, tipos distintos u otro libro → se ignora
// completo, nunca se usa como estado.
export function parsePaperReadingRecord(
  raw: string | null | undefined,
  bookHash: string,
): PaperReadingRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PaperReadingRecord>;
    if (v?.version !== 1) return null;
    if (typeof v.bookHash !== "string" || v.bookHash !== bookHash) return null;
    if (!Array.isArray(v.readTargetIds)) return null;
    for (const id of v.readTargetIds) {
      if (typeof id !== "string" || !id) return null;
    }
    if (v.lastTargetId !== null && typeof v.lastTargetId !== "string")
      return null;
    if (typeof v.updatedAt !== "number" || !Number.isFinite(v.updatedAt))
      return null;
    return {
      version: 1,
      bookHash,
      readTargetIds: [...v.readTargetIds],
      lastTargetId: v.lastTargetId,
      updatedAt: v.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function loadPaperReading(
  bookHash: string,
  scope?: DbScope,
): Promise<PaperReadingRecord | null> {
  const raw = await loadSessionValue(paperReadingKey(bookHash), scope).catch(
    () => null,
  );
  return parsePaperReadingRecord(raw, bookHash);
}

export async function savePaperReading(
  record: PaperReadingRecord,
  scope?: DbScope,
): Promise<void> {
  await saveSessionValue(
    paperReadingKey(record.bookHash),
    JSON.stringify(record),
    scope,
  );
}

// La lista de capítulos de la pantalla: destinos de lectura (chapter y
// uncertain — los que el índice no sabe clasificar se muestran igual)
// separados de los preliminares y anexos, que se ofrecen colapsados.
// Si el libro no tiene ningún destino de lectura identificable, todos
// van a la lista principal: nunca una pantalla vacía.
export function groupPaperChapters(catalog: ChapterCatalog): {
  reading: ChapterTarget[];
  extras: ChapterTarget[];
} {
  const reading: ChapterTarget[] = [];
  const extras: ChapterTarget[] = [];
  for (const target of catalog.targets) {
    if (target.kind === "chapter" || target.kind === "uncertain") {
      reading.push(target);
    } else {
      extras.push(target);
    }
  }
  if (!reading.length) return { reading: [...catalog.targets], extras: [] };
  return { reading, extras };
}

export type PaperChapterStatus = {
  status: "new" | "prepared" | "read";
  // Respuestas «No la conozco» del registro de preparación: van al
  // Cuaderno al confirmar.
  unknownCount: number;
};

// Estado visible de un capítulo: «leído» gana sobre «preparado» (el
// registro de preparación puede quedar reviewed y luego marcarse leído);
// «skipped» y los borradores cuentan como sin revisar.
export function paperChapterStatus(
  targetId: string,
  prep: PreparationRecord | null,
  paper: PaperReadingRecord | null,
): PaperChapterStatus {
  let unknownCount = 0;
  if (prep?.answers) {
    for (const answer of Object.values(prep.answers)) {
      if (answer === "unknown") unknownCount += 1;
    }
  }
  if (paper?.readTargetIds.includes(targetId)) {
    return { status: "read", unknownCount };
  }
  if (prep?.disposition === "reviewed") {
    return { status: "prepared", unknownCount };
  }
  return { status: "new", unknownCount };
}

// Borde de palabra Unicode, sin distinguir mayúsculas: exige que lo
// adyacente no sea letra ni dígito (una «w1» no cuenta dentro de
// «w15», como una «la» no cuenta dentro de «helado»).
const appearanceRegex = (form: string) =>
  new RegExp(
    `(^|[^\\p{L}\\p{N}])${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  );

// Índice de la primera aparición de la forma en el texto del capítulo,
// o -1 si no aparece.
export function firstAppearance(text: string, form: string): number {
  if (!text || !form) return -1;
  const match = appearanceRegex(form).exec(text);
  if (!match) return -1;
  return match.index + match[1].length;
}

// La frase del capítulo donde aparece la palabra, solo si aparece.
// extractChapterContextSnippet devuelve el inicio del capítulo cuando
// no hay coincidencia: guardarla en una palabra que el libro no tiene
// adjuntaría una frase ajena, así que ausente → undefined.
export function contextIfPresent(
  text: string,
  form: string,
): string | undefined {
  if (firstAppearance(text, form) < 0) return undefined;
  const snippet = extractChapterContextSnippet(text, form);
  return snippet || undefined;
}

// Las 12 candidatas de la selección principal, ordenadas por su primera
// aparición en el capítulo (el lector de papel las encuentra página a
// página). Las que no aparecen en el texto van al final en su orden
// original. El resto de la selección y las diferidas van a «más».
export function splitPaperRows(
  suggestion: SuggestionRows,
  text: string,
): { main: SuggestionRow[]; more: SuggestionRow[]; uncertain: SuggestionRow[] } {
  const head = suggestion.rows.slice(0, PAPER_MAIN_ROWS);
  const positionOf = (row: SuggestionRow) => {
    const index = firstAppearance(text, row.form);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const main = head
    .map((row, index) => ({ row, index, position: positionOf(row) }))
    .sort((a, b) =>
      a.position === b.position ? a.index - b.index : a.position - b.position,
    )
    .map((item) => item.row);
  return {
    main,
    more: [...suggestion.rows.slice(PAPER_MAIN_ROWS), ...suggestion.deferred],
    uncertain: suggestion.uncertain,
  };
}

export type ManualSuggestion = {
  form: string;
  inChapter: boolean;
  saved: boolean;
};

const normalizeForMatch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

// Sugerencias del alta manual: prefijo sin acentos sobre las formas del
// capítulo primero (son las que el lector de papel probablemente tenga
// a la vista) y luego las del libro entero. Sin duplicados; las que ya
// están en el Cuaderno se muestran marcadas y no se ofrecen dos veces.
export function suggestManualForms(
  query: string,
  chapterForms: string[],
  bookForms: string[],
  saved: ReadonlySet<string>,
  limit = PAPER_SUGGESTIONS,
): ManualSuggestion[] {
  const needle = normalizeForMatch(query.trim());
  if (needle.length < 2) return [];
  const isSaved = (form: string) => saved.has(form.toLowerCase());
  const seen = new Set<string>();
  const out: ManualSuggestion[] = [];
  const push = (form: string, inChapter: boolean) => {
    const key = form.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ form, inChapter, saved: isSaved(form) });
  };
  for (const form of chapterForms) {
    if (normalizeForMatch(form).startsWith(needle)) push(form, true);
    if (out.length >= limit) return out;
  }
  for (const form of bookForms) {
    if (normalizeForMatch(form).startsWith(needle)) push(form, false);
    if (out.length >= limit) return out;
  }
  return out;
}
