import type { SavedAnnotation } from "./idb";

// Un solo marcador por libro («la cinta» del libro físico): id fijo.
export const BOOKMARK_ID = "ribbon";

export const annotationStamp = (item: SavedAnnotation) => item.updatedAt;

// Fusión local/remota: gana el registro con updatedAt más reciente;
// las lápidas viajan igual que cualquier versión.
export function mergeAnnotation(
  local: SavedAnnotation | undefined,
  remote: SavedAnnotation,
): SavedAnnotation {
  if (!local || annotationStamp(remote) > annotationStamp(local)) return remote;
  return local;
}

export function makeBookmark(
  bookHash: string,
  sectionIndex: number,
  anchor?: string,
): Omit<SavedAnnotation, "key" | "createdAt" | "updatedAt"> {
  return { id: BOOKMARK_ID, bookHash, kind: "bookmark", sectionIndex, anchor };
}

const PASSAGE_TEXT_MAX = 3000;
const CONTEXT_LEN = 60;

// Recorta el fragmento seleccionado respetando límites razonables y
// conserva contexto para reubicarlo si el texto exacto ya no coincide.
export function makePassage(
  bookHash: string,
  sectionIndex: number,
  text: string,
  prefix?: string,
  suffix?: string,
): Omit<SavedAnnotation, "key" | "createdAt" | "updatedAt"> | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 2) return null;
  return {
    id: crypto.randomUUID(),
    bookHash,
    kind: "passage",
    sectionIndex,
    // El inicio del fragmento sirve de ancla para volver a él.
    anchor: clean.slice(0, 80),
    text: clean.slice(0, PASSAGE_TEXT_MAX),
    prefix: prefix?.slice(-CONTEXT_LEN) || undefined,
    suffix: suffix?.slice(0, CONTEXT_LEN) || undefined,
  };
}
