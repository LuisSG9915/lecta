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

// ---------- Historial de repasos ----------

export const REVIEW_LIMITS = {
  id: 64,
  form: 100,
  kind: 24,
  rating: 24,
  batch: 1000,
} as const;

// Tipos de repaso y calificación admitidos; lo que llegue fuera de la
// lista se descarta entero (el historial es anexable e inmutable).
// Nivel B añade "context" (elegir el sentido en una oración nueva del
// catálogo), "clozeNew" (completar esa oración) y "write" (escribir
// oración propia corregida por IA). No hacen falta ratings nuevos:
// los ejercicios B1 usan correct/wrong y el resto de la lógica FSRS
// sigue con again/hard/good (easy y known ya existen si hicieran
// falta); REVIEW_LIMITS.kind=24 cubre con holgura "clozeNew" (8).
export const REVIEW_KINDS = [
  "meaning",
  "word",
  "cloze",
  "choose",
  "match",
  "sense",
  "declared",
  "reread",
  "report",
  "context",
  "clozeNew",
  "write",
] as const;
export const REVIEW_RATINGS = [
  "again",
  "hard",
  "good",
  "easy",
  "correct",
  "wrong",
  "known",
] as const;

export type ReviewKind = (typeof REVIEW_KINDS)[number];
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

export type SyncReviewInput = {
  id?: unknown;
  language?: unknown;
  form?: unknown;
  kind?: unknown;
  rating?: unknown;
  hints?: unknown;
  createdAt?: unknown;
};

export type CleanReview = {
  id: string;
  language: string;
  form: string;
  kind: ReviewKind;
  rating: ReviewRating;
  hints: number;
  createdAt: number;
};

const inList = <T extends string>(value: unknown, list: readonly T[]): T | null =>
  typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : null;

// Valida un repaso del cliente; devuelve null si le faltan piezas o si
// kind/rating/hints salen de lo permitido. createdAt sigue el criterio
// de cleanAnnotation: si falta o no es un sello válido se usa la hora
// del servidor (el repaso igual queda registrado, no se pierde).
export function cleanReview(input: SyncReviewInput): CleanReview | null {
  const id = text(input.id, REVIEW_LIMITS.id)?.trim();
  const form = text(input.form, REVIEW_LIMITS.form)?.trim();
  const kind = inList(text(input.kind, REVIEW_LIMITS.kind), REVIEW_KINDS);
  const rating = inList(text(input.rating, REVIEW_LIMITS.rating), REVIEW_RATINGS);
  if (!id || !form || !kind || !rating) return null;
  const hints =
    input.hints === undefined
      ? 0
      : typeof input.hints === "number" &&
          Number.isInteger(input.hints) &&
          input.hints >= 0 &&
          input.hints <= 99
        ? input.hints
        : null;
  if (hints === null) return null;
  return {
    id,
    language: text(input.language, 10)?.trim() || "es",
    form,
    kind,
    rating,
    hints,
    createdAt: stamp(input.createdAt) ?? Date.now(),
  };
}

// ---------- Posición de lectura ----------

export const POSITION_LIMITS = {
  bookHash: 80,
  anchor: 400,
  batch: 500,
} as const;

export type SyncPositionInput = {
  bookHash?: unknown;
  sectionIndex?: unknown;
  scrollTop?: unknown;
  ratio?: unknown;
  progress?: unknown;
  anchor?: unknown;
  updatedAt?: unknown;
};

export type CleanPosition = {
  bookHash: string;
  sectionIndex: number;
  scrollTop: number;
  ratio: number | null;
  progress: number | null;
  anchor: string | null;
  updatedAt: number;
};

// Fracción leída (0–1). Un número fuera de rango se recorta al rango
// en vez de descartarse: un remitente impreciso no debe perder la
// posición. Lo que no es número queda null (dato no disponible).
const fraction = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;

// Valida una posición del cliente; solo exige el libro (bookHash) y el
// resto cae a valores seguros. updatedAt sigue el criterio de
// cleanAnnotation: si falta o no es un sello válido se usa la hora del
// servidor, y updated_at arbitra qué dispositivo escribió último.
export function cleanPosition(input: SyncPositionInput): CleanPosition | null {
  const bookHash = text(input.bookHash, POSITION_LIMITS.bookHash)?.trim();
  if (!bookHash) return null;
  return {
    bookHash,
    sectionIndex:
      typeof input.sectionIndex === "number" && Number.isFinite(input.sectionIndex)
        ? Math.max(0, Math.floor(input.sectionIndex))
        : 0,
    scrollTop:
      typeof input.scrollTop === "number" && Number.isFinite(input.scrollTop)
        ? Math.max(0, input.scrollTop)
        : 0,
    ratio: fraction(input.ratio),
    progress: fraction(input.progress),
    anchor: text(input.anchor, POSITION_LIMITS.anchor),
    updatedAt: stamp(input.updatedAt) ?? Date.now(),
  };
}

// ---------- Modelo de conocimiento ----------

export const KNOWLEDGE_LIMITS = {
  lemma: 100,
  // Tolerancia para relojes de cliente adelantados: una fila sellada
  // en el futuro lejano ganaría el arbitraje por updated_at para
  // siempre, así que se descarta en vez de «repararla».
  futureSkewMs: 300_000,
  batch: 500,
} as const;

// De dónde vino la evidencia: la prueba inicial de calibración, una
// respuesta explícita del lector («ya la conozco», ronda de
// preparación), una palabra guardada en su Cuaderno o lo inferido de
// sus actos (dominarla en el repaso). Lo que llegue fuera de la
// lista se descarta entero, como en los repasos.
export const KNOWLEDGE_SOURCES = [
  "calibration",
  "declared",
  "preparation",
  "saved",
  "inferred",
] as const;
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];

// Peso de cada fuente al arbitrar escrituras y proyecciones: lo
// inferido pesa menos que el guardado en el Cuaderno y mucho menos
// que una respuesta explícita (calibración, «ya la conozco», ronda
// de preparación). Es la regla única de mergeKnowledgeWrite (idb) y
// del resolvedor de alias de conocimiento (knowledge): un «inferred»
// jamás deshace una respuesta explícita.
export const KNOWLEDGE_SOURCE_STRENGTH: Record<KnowledgeSource, number> = {
  inferred: 0,
  saved: 1,
  calibration: 2,
  declared: 2,
  preparation: 2,
};

// Orden convergente de arbitraje de evidencia: el MISMO criterio en
// los tres sitios que fusionan (escritura local, sync del cliente y
// upsert del servidor), para que cualquier orden de llegada converja
// al mismo ganador. Llave lexicográfica:
//   1. peso: fuerza de la fuente; una lápida compite con 2 — borrar
//      es un acto explícito del usuario, no del algoritmo.
//   2. updatedAt: a peso igual gana lo último decidido.
//   3. lápida: a llave idéntica gana el borrado — a reloj empatado no
//      se revive lo que el usuario eliminó.
//   4. veredicto: conocida = 0, desconocida = 1 — al empate total se
//      prefiere sobre-enseñar antes que ocultar una palabra.
export type KnowledgeArbRow = {
  source: string;
  updatedAt: number;
  deleted?: boolean;
  known: boolean;
};

export function knowledgeArbKey(
  row: KnowledgeArbRow,
): [number, number, number, number] {
  return [
    row.deleted === true
      ? 2
      : (KNOWLEDGE_SOURCE_STRENGTH[row.source as KnowledgeSource] ?? 0),
    row.updatedAt,
    row.deleted === true ? 1 : 0,
    row.known ? 0 : 1,
  ];
}

// ¿La fila entrante desplaza a la existente? Comparación
// lexicográfica: conmutativa e idempotente, así que merge(a,b) da el
// mismo ganador sin importar el orden de llegada ni quién fusione.
export function knowledgeArbWins(
  incoming: KnowledgeArbRow,
  existing: KnowledgeArbRow,
): boolean {
  const a = knowledgeArbKey(incoming);
  const b = knowledgeArbKey(existing);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

// El mismo orden como tupla SQL para el ON CONFLICT del worker. Se
// genera desde KNOWLEDGE_SOURCE_STRENGTH para que el CASE no pueda
// divergir del comparador de arriba: (peso, sello, lápida, veredicto)
// comparado por filas, donde la lápida gana a reloj empatado y la
// desconocida gana al empate total.
export function knowledgeArbSql(alias: string): string {
  const weights = KNOWLEDGE_SOURCES.map(
    (s) => `WHEN '${s}' THEN ${KNOWLEDGE_SOURCE_STRENGTH[s]}`,
  ).join(" ");
  const weight =
    `CASE WHEN ${alias}.deleted THEN 2 ` +
    `ELSE CASE ${alias}.source ${weights} ELSE 0 END END`;
  return `(${weight}, ${alias}.updated_at, ${alias}.deleted, NOT ${alias}.known)`;
}

export type SyncKnowledgeInput = {
  language?: unknown;
  lemma?: unknown;
  known?: unknown;
  source?: unknown;
  updatedAt?: unknown;
  deleted?: unknown;
};

export type CleanKnowledge = {
  language: string;
  lemma: string;
  known: boolean;
  source: KnowledgeSource;
  updatedAt: number;
  deleted: boolean;
};

// Valida una fila de conocimiento del cliente; devuelve null si le
// falta cualquier pieza. A diferencia de cleanPosition aquí no hay
// reparto: sin updatedAt entero y plausible la fila se descarta,
// porque el sello es lo único que arbitra entre dispositivos.
// El lema se guarda en minúsculas (los lemas del catálogo ya lo
// están), igual que las formas del vocabulario.
export function cleanKnowledge(input: SyncKnowledgeInput): CleanKnowledge | null {
  const rawLanguage = text(input.language, 10)?.trim() ?? "";
  const language = /^[a-z]{2,3}$/i.test(rawLanguage) ? rawLanguage.toLowerCase() : null;
  const lemma = text(input.lemma, KNOWLEDGE_LIMITS.lemma)?.trim().toLowerCase();
  const source = inList(text(input.source, 20), KNOWLEDGE_SOURCES);
  const updatedAt = input.updatedAt;
  if (!language || !lemma || !source) return null;
  if (typeof input.known !== "boolean") return null;
  if (
    typeof updatedAt !== "number" ||
    !Number.isInteger(updatedAt) ||
    updatedAt <= 0 ||
    updatedAt > Date.now() + KNOWLEDGE_LIMITS.futureSkewMs
  )
    return null;
  return {
    language,
    lemma,
    known: input.known,
    source,
    updatedAt,
    deleted: input.deleted === true,
  };
}

// ---------- Tarjetas FSRS ----------
//
// La tarjeta es el historial del repaso serializado por ts-fsrs: un
// campo mal formado corrompe la programación del lector. Viaja como
// jsonb tal cual la escribió el cliente — las fechas llegan como
// string ISO o número (DateInput), no como Date. El servidor valida
// la forma antes del SQL: una card malformada rechaza la petición
// completa en vez de guardarse, y una card ausente/no enviada jamás
// borra la almacenada (el upsert la preserva). Campos extra se
// toleran y se conservan: ts-fsrs puede agregar claves entre
// versiones sin que el validador las pele.

const CARD_REAL_FIELDS = ["stability", "difficulty"] as const;
const CARD_COUNTER_FIELDS = [
  "elapsed_days",
  "scheduled_days",
  "learning_steps",
  "reps",
  "lapses",
] as const;
const CARD_STATES = new Set([0, 1, 2, 3]);

const isDateInput = (value: unknown) =>
  value instanceof Date
    ? !Number.isNaN(value.getTime())
    : (typeof value === "string" || typeof value === "number") &&
      !Number.isNaN(new Date(value).getTime());

// ¿El objeto tiene la forma de una Card de ts-fsrs 5.x? No normaliza
// ni escribe defaults: solo responde sí/no para que quien recibe
// decida si rechaza la petición.
export function isFsrsCardShape(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const card = value as Record<string, unknown>;
  if (!isDateInput(card.due)) return false;
  if (card.last_review !== undefined && !isDateInput(card.last_review))
    return false;
  for (const field of CARD_REAL_FIELDS)
    if (typeof card[field] !== "number" || !Number.isFinite(card[field] as number))
      return false;
  for (const field of CARD_COUNTER_FIELDS)
    if (
      typeof card[field] !== "number" ||
      !Number.isInteger(card[field] as number) ||
      (card[field] as number) < 0
    )
      return false;
  if (!CARD_STATES.has(card.state as number)) return false;
  return true;
}

