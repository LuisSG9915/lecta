// Elección inicial de lectura (T18): se pregunta una sola vez cuando
// el libro no tiene posición guardada. El registro vive aparte del
// avance — describe la decisión (dónde empezar, qué preparar), no el
// progreso — así reabrir no vuelve a preguntar aunque la posición
// todavía no exista.

import {
  loadSessionValue,
  saveSessionValue,
  type DbScope,
} from "./idb";
import type { ChapterCatalog, ChapterTarget } from "./chapters";
import type { SavedBookPosition } from "./idb";

export type BookStartRecord = {
  version: 1;
  readingTargetId: string;
  preparationTargetId: string | null;
  updatedAt: number;
};

const key = (bookHash: string) => `bookStart:v1:${bookHash}`;

const isRecord = (value: unknown): value is BookStartRecord =>
  typeof value === "object" &&
  value !== null &&
  (value as BookStartRecord).version === 1 &&
  typeof (value as BookStartRecord).readingTargetId === "string" &&
  (value as BookStartRecord).readingTargetId.length > 0 &&
  ((value as BookStartRecord).preparationTargetId === null ||
    typeof (value as BookStartRecord).preparationTargetId === "string") &&
  typeof (value as BookStartRecord).updatedAt === "number";

// Registros corruptos, de otra versión o sin destino se ignoran:
// es preferible volver a preguntar que abrir un lugar inventado.
export async function loadBookStart(
  bookHash: string,
  scope?: DbScope,
): Promise<BookStartRecord | null> {
  const raw = await loadSessionValue(key(bookHash), scope);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveBookStart(
  bookHash: string,
  choice: { readingTargetId: string; preparationTargetId: string | null },
  scope?: DbScope,
): Promise<void> {
  const record: BookStartRecord = {
    version: 1,
    readingTargetId: choice.readingTargetId,
    preparationTargetId: choice.preparationTargetId,
    updatedAt: Date.now(),
  };
  await saveSessionValue(key(bookHash), JSON.stringify(record), scope);
}

// Decisión pura de entrada: qué abrir al cargar el libro.
// - Hay posición → reanudar ahí; la elección no se vuelve a pedir.
// - Sin posición pero con registro previo → el destino registrado
//   (reabrir tras elegir no repite la pregunta).
// - Ninguno → pedir elección; la sección cero no se renderiza antes.
export type EntryDecision =
  | { kind: "resume"; sectionIndex: number; ratio: number; anchor?: string }
  | { kind: "target"; target: ChapterTarget }
  | { kind: "ask" };

export function resolveEntryTarget(
  saved: SavedBookPosition | null | undefined,
  start: BookStartRecord | null,
  catalog: ChapterCatalog,
  sectionCount: number,
): EntryDecision {
  if (saved) {
    const index = Math.min(saved.sectionIndex ?? 0, sectionCount - 1);
    return {
      kind: "resume",
      sectionIndex: Math.max(0, index),
      ratio: saved.sectionIndex === index ? saved.ratio ?? 0 : 0,
      anchor: saved.sectionIndex === index ? saved.anchor : undefined,
    };
  }
  if (start) {
    const target = catalog.targets.find((t) => t.id === start.readingTargetId);
    if (target) return { kind: "target", target };
  }
  return { kind: "ask" };
}
