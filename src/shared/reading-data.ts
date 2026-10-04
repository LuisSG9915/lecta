// Contrato de marcadores y pasajes entre cliente y worker. El cliente
// envía su SavedAnnotation; el servidor valida campo a campo y guarda
// en lecta_user_annotations.

export const ANNOTATION_LIMITS = {
  id: 64,
  bookHash: 80,
  anchor: 400,
  text: 3000,
  prefix: 120,
  suffix: 120,
  note: 1000,
  batch: 500,
} as const;

export type AnnotationKind = "bookmark" | "passage";

export type SyncAnnotationInput = {
  id?: unknown;
  bookHash?: unknown;
  kind?: unknown;
  sectionIndex?: unknown;
  anchor?: unknown;
  text?: unknown;
  prefix?: unknown;
  suffix?: unknown;
  note?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  deleted?: unknown;
};

export type CleanAnnotation = {
  id: string;
  bookHash: string;
  kind: AnnotationKind;
  sectionIndex: number;
  anchor: string | null;
  text: string | null;
  prefix: string | null;
  suffix: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : null;
const stamp = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

// Valida una anotación del cliente; devuelve null si le faltan las
// piezas mínimas (id, libro, tipo válido).
export function cleanAnnotation(input: SyncAnnotationInput): CleanAnnotation | null {
  const id = text(input.id, ANNOTATION_LIMITS.id)?.trim();
  const bookHash = text(input.bookHash, ANNOTATION_LIMITS.bookHash)?.trim();
  const kind = input.kind === "bookmark" || input.kind === "passage" ? input.kind : null;
  if (!id || !bookHash || !kind) return null;
  const updatedAt = stamp(input.updatedAt) ?? Date.now();
  return {
    id,
    bookHash,
    kind,
    sectionIndex:
      typeof input.sectionIndex === "number" && Number.isFinite(input.sectionIndex)
        ? Math.max(0, Math.floor(input.sectionIndex))
        : 0,
    anchor: text(input.anchor, ANNOTATION_LIMITS.anchor),
    text: text(input.text, ANNOTATION_LIMITS.text),
    prefix: text(input.prefix, ANNOTATION_LIMITS.prefix),
    suffix: text(input.suffix, ANNOTATION_LIMITS.suffix),
    note: text(input.note, ANNOTATION_LIMITS.note),
    createdAt: stamp(input.createdAt) ?? updatedAt,
    updatedAt,
    deleted: input.deleted === true,
  };
}

// ---------- Intervalos de actividad ----------

export const ACTIVITY_LIMITS = {
  id: 64,
  bookHash: 80,
  // Un intervalo no puede durar más de un día: valores más largos son
  // ruido o relojes rotos, y la unión ya fusiona lecturas continuas.
  maxMs: 86_400_000,
  batch: 1000,
} as const;

export type SyncActivityInput = {
  id?: unknown;
  bookHash?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
};

export type CleanActivity = {
  id: string;
  bookHash: string;
  startedAt: number;
  endedAt: number;
};

// Los intervalos son inmutables: se valida la forma completa y lo que
// no cuadra se descarta entero (no se «repara» a medias).
export function cleanActivity(input: SyncActivityInput): CleanActivity | null {
  const id = text(input.id, ACTIVITY_LIMITS.id)?.trim();
  const bookHash = text(input.bookHash, ACTIVITY_LIMITS.bookHash)?.trim();
  const startedAt = stamp(input.startedAt);
  const endedAt = stamp(input.endedAt);
  if (!id || !bookHash || !startedAt || !endedAt) return null;
  if (endedAt <= startedAt || endedAt - startedAt > ACTIVITY_LIMITS.maxMs)
    return null;
  return { id, bookHash, startedAt, endedAt };
}
