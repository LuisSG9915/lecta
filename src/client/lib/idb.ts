import { openDB, type IDBPDatabase } from "idb";
import type { Card } from "./fsrs";
import type { PreparationRecord } from "./preparation";
import type { ReviewKind, ReviewRating } from "../../shared/reading-data";

export interface StoredBook {
  hash: string;
  name: string;
  addedAt: number;
  data: Blob;
  // Metadatos leídos del EPUB (se rellenan de forma perezosa).
  title?: string;
  author?: string;
  language?: string;
  sectionCount?: number;
  cover?: Blob;
  // Marca de que ya intentamos leer los metadatos (aunque haya fallado).
  metaVersion?: number;
}

export interface SavedBookPosition {
  bookHash: string;
  sectionIndex: number;
  scrollTop: number;
  // Fracción leída de la sección (0–1); restaura mejor que scrollTop
  // cuando cambian tamaño de letra o ventana.
  ratio?: number;
  // Fracción ponderada del libro completo (0–1), la misma que muestra
  // la hebra del lector; la estantería la usa sin recalcular.
  progress?: number;
  // Inicio del bloque visible al guardar: restaura el punto exacto aunque
  // cambien letra, interlineado o ancho (reading-location.ts).
  anchor?: string;
  updatedAt: number;
}

export interface SavedWord {
  key: string;
  form: string;
  lemma?: string;
  pos?: string | null;
  meaning?: string;
  language: string;
  context?: string;
  bookHash?: string;
  // Acepción del catálogo elegida al guardar (fila de lexicon_senses).
  // El entry_id es int8 > 2^53 y se guarda como string. Las palabras
  // guardadas antes del cambio conservan un number truncado (…300 por
  // …305) que no es migrable: dejan de ligar hasta volver a guardar.
  senseEntryId?: string | null;
  senseOrder?: number | null;
  savedAt: number;
  updatedAt?: number;
  card?: Card;
  deleted?: boolean;
}

// Marcadores y pasajes guardados del libro. Comparten almacén: ambos
// son «lugares conservados» y sincronizan por la misma clave.
export interface SavedAnnotation {
  // `${bookHash}:${id}` — permite listar por libro y fusionar por id.
  key: string;
  id: string;
  bookHash: string;
  kind: "bookmark" | "passage";
  sectionIndex: number;
  // Texto con el que se reubica el lugar aunque cambie la letra.
  anchor?: string;
  // Solo pasajes: el fragmento seleccionado y su contexto.
  text?: string;
  prefix?: string;
  suffix?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

// Intervalo de lectura registrado por el lector. Son inmutables y
// anexables: la sincronización solo inserta los que faltan por id,
// nunca los edita ni los borra (no hay lápidas que propagar).
export interface SavedInterval {
  id: string;
  bookHash: string;
  startedAt: number;
  endedAt: number;
}

// Repaso registrado (una calificación sobre una palabra del cuaderno).
// Como los intervalos: inmutable y anexable; la sincronización solo
// inserta los que faltan por id en cada lado.
export interface SavedReview {
  id: string;
  language: string;
  form: string;
  kind: ReviewKind;
  rating: ReviewRating;
  hints: number;
  createdAt: number;
}

// Evidencia de conocimiento sobre un lema: si el lector lo sabe o no
// y de dónde salió esa afirmación (calibración, respuesta explícita,
// guardado en el Cuaderno o inferida de sus actos). Es mutable como
// las anotaciones: updatedAt arbitra y los borrados viajan como
// lápidas.
export type KnownWord = {
  // `${language}:${lemma.toLowerCase()}` — un lema por fila e idioma.
  key: string;
  language: string;
  lemma: string;
  known: boolean;
  source: string;
  updatedAt: number;
  deleted?: boolean;
};

// ---------- Historial de trayecto (readingEvents) ----------
//
// Eventos inmutables y anexables del recorrido de lectura: permiten
// auditar qué se mostró y qué hizo el lector después. Son locales
// por dispositivo y cuenta (no se sincronizan al servidor) y se
// podan por antigüedad — el Cuaderno y la evidencia no dependen
// de ellos.

// Por qué una fila llegó a la preparación: manda la evidencia
// explícita, pertenece al grupo «por aprender», la eligió la regla
// de rareza o el catálogo no tiene información suficiente.
export type PresentedReason =
  | "explicit_unknown"
  | "learning"
  | "rarity"
  | "catalog_uncertain";

export type PresentedRow = {
  key: string;
  form: string;
  lemma?: string;
  reason: PresentedReason;
  zipf?: number | null;
};

type ReadingEventBase = {
  id: string;
  version: 1;
  visitId: string;
  bookHash: string;
  createdAt: number;
};

export type ReadingEvent = ReadingEventBase &
  (
    | {
        kind: "target_entered";
        targetId: string;
        sectionIndex: number;
      }
    | {
        kind: "preparation_presented";
        targetId: string;
        presentationId: string;
        // Solo las filas realmente visibles en pantalla, en orden.
        rows: PresentedRow[];
      }
    | {
        kind: "preparation_answered";
        targetId: string;
        presentationId: string;
        key: string;
        answer: "known" | "unknown";
      }
    | {
        kind: "preparation_skipped";
        targetId: string;
        presentationId: string;
      }
    | {
        kind: "word_consulted";
        sectionIndex: number;
        form: string;
        origin: "text";
      }
    | {
        kind: "word_saved";
        sectionIndex: number;
        form: string;
        lemma?: string;
        entryId?: string | null;
        senseOrder?: number | null;
        origin: "text" | "preparation";
      }
    | {
        kind: "word_declared_known";
        sectionIndex: number;
        lemma: string;
        origin: "text" | "preparation";
      }
  );

// Operación pendiente sobre un libro remoto (subida o borrado). Es la
// cola persistente del dispositivo para reintentar cuando no hubo
// sesión o conexión al hacer el cambio local.
export interface BookOp {
  id: string;
  kind: "upload" | "delete";
  hash: string;
  name?: string;
  createdAt: number;
  lastError?: string;
}

interface LectaDB {
  books: { key: string; value: StoredBook };
  positions: { key: string; value: SavedBookPosition };
  session: { key: string; value: string };
  savedWords: { key: string; value: SavedWord };
  annotations: { key: string; value: SavedAnnotation };
  activity: { key: string; value: SavedInterval };
  reviews: { key: string; value: SavedReview };
  knowledge: { key: string; value: KnownWord };
  readingEvents: { key: string; value: ReadingEvent };
  bookOps: { key: string; value: BookOp };
}

const SESSION_KEY = "latestBookHash";
const ANONYMOUS_DB = "lecta";
const DB_VERSION = 8;
const ALL_STORES = [
  "books",
  "positions",
  "session",
  "savedWords",
  "annotations",
  "activity",
  "reviews",
  "knowledge",
  "readingEvents",
  "bookOps",
] as const;

const dbNameFor = (userId: string | null) =>
  userId ? `lecta:u:${userId}` : ANONYMOUS_DB;

let activeUserId: string | null = null;
let dbPromise: Promise<IDBPDatabase<LectaDB>> | null = null;

function openLectaDB(name: string) {
  return openDB<LectaDB>(name, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("books"))
        db.createObjectStore("books", { keyPath: "hash" });
      if (!db.objectStoreNames.contains("positions"))
        db.createObjectStore("positions", { keyPath: "bookHash" });
      if (!db.objectStoreNames.contains("session")) db.createObjectStore("session");
      if (!db.objectStoreNames.contains("savedWords"))
        db.createObjectStore("savedWords", { keyPath: "key" });
      if (!db.objectStoreNames.contains("annotations"))
        db.createObjectStore("annotations", { keyPath: "key" });
      if (!db.objectStoreNames.contains("activity"))
        db.createObjectStore("activity", { keyPath: "id" });
      if (!db.objectStoreNames.contains("reviews"))
        db.createObjectStore("reviews", { keyPath: "id" });
      if (!db.objectStoreNames.contains("knowledge"))
        db.createObjectStore("knowledge", { keyPath: "key" });
      if (!db.objectStoreNames.contains("readingEvents"))
        db.createObjectStore("readingEvents", { keyPath: "id" });
      if (!db.objectStoreNames.contains("bookOps"))
        db.createObjectStore("bookOps", { keyPath: "id" });
    },
  });
}

function getDb() {
  dbPromise ??= openLectaDB(dbNameFor(activeUserId));
  return dbPromise;
}

export function getActiveUserId() {
  return activeUserId;
}

// Borra por completo la base local de una cuenta (solo tras el correo
// de confirmación del borrado). Devuelve false si el navegador lo
// bloqueó o falló: quien llama decide si avisa, nunca se finge éxito.
export async function deleteAccountDb(userId: string): Promise<boolean> {
  if (activeUserId === userId) await setDbUser(null);
  return new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(dbNameFor(userId));
    request.onsuccess = () => resolve(true);
    request.onblocked = () => resolve(false);
    request.onerror = () => resolve(false);
  });
}

// Cambia la base activa según la sesión. Al iniciar sesión migra lo
// guardado como invitado hacia la cuenta y limpia el espacio anónimo,
// para que otra persona que use el dispositivo no lo reciba.
export async function setDbUser(userId: string | null) {
  if (userId === activeUserId) return;
  activeUserId = userId;
  const previous = dbPromise;
  dbPromise = null;
  if (previous) (await previous).close();
  if (userId) await migrateAnonymousToUser();
}

const newerOf = <T>(a: T, b: T, stamp: (item: T) => number | undefined) =>
  (stamp(b) ?? 0) > (stamp(a) ?? 0) ? b : a;

async function migrateAnonymousToUser() {
  const target = await getDb();
  const anon = await openLectaDB(ANONYMOUS_DB);
  try {
    const [books, positions, words, annotations, intervals, reviews, knowledge, events, ops, latestHash] =
      await Promise.all([
        anon.getAll("books"),
        anon.getAll("positions"),
        anon.getAll("savedWords"),
        anon.getAll("annotations"),
        anon.getAll("activity"),
        anon.getAll("reviews"),
        anon.getAll("knowledge"),
        anon.getAll("readingEvents"),
        anon.getAll("bookOps"),
        anon.get("session", SESSION_KEY),
      ]);

    for (const book of books) {
      if (!(await target.get("books", book.hash))) await target.put("books", book);
    }
    for (const position of positions) {
      const existing = await target.get("positions", position.bookHash);
      const merged = existing
        ? newerOf(existing, position, (item) => item.updatedAt)
        : position;
      await target.put("positions", merged);
    }
    for (const word of words) {
      const existing = await target.get("savedWords", word.key);
      const merged = existing
        ? newerOf(existing, word, (item) => item.updatedAt ?? item.savedAt)
        : word;
      await target.put("savedWords", merged);
    }
    for (const annotation of annotations) {
      const existing = await target.get("annotations", annotation.key);
      const merged = existing
        ? newerOf(existing, annotation, (item) => item.updatedAt)
        : annotation;
      await target.put("annotations", merged);
    }
    // Intervalos: anexables por id; si ya existe se conserva el primero.
    for (const interval of intervals) {
      if (!(await target.get("activity", interval.id)))
        await target.put("activity", interval);
    }
    // Repasos: misma regla, anexables por id.
    for (const review of reviews) {
      if (!(await target.get("reviews", review.id)))
        await target.put("reviews", review);
    }
    // Conocimiento: mutable como las anotaciones; gana el updatedAt
    // más reciente, lápidas incluidas.
    for (const word of knowledge) {
      const existing = await target.get("knowledge", word.key);
      const merged = existing
        ? newerOf(existing, word, (item) => item.updatedAt)
        : word;
      await target.put("knowledge", merged);
    }
    // Trayecto: anexable por id como la actividad y los repasos.
    for (const event of events) {
      if (!(await target.get("readingEvents", event.id)))
        await target.put("readingEvents", event);
    }
    // Ops de libro encoladas: son del dispositivo, pero se migran porque
    // lo esperado al entrar sesión es completarlas bajo la cuenta (p.
    // ej. subir un libro guardado como invitado). Anexables por id.
    for (const op of ops) {
      if (!(await target.get("bookOps", op.id))) await target.put("bookOps", op);
    }
    if (latestHash && !(await target.get("session", SESSION_KEY))) {
      await target.put("session", latestHash, SESSION_KEY);
    }
    // Solo las claves del ciclo del lector: calibración, elección de
    // inicio y registros de preparación. La cuenta conserva lo suyo;
    // lo anónimo solo gana si es un registro más reciente.
    const sessionKeys = await anon.getAllKeys("session");
    for (const key of sessionKeys) {
      if (typeof key !== "string" || !isMigratableSessionKey(key)) continue;
      const incoming = await anon.get("session", key);
      if (typeof incoming !== "string") continue;
      const existing = await target.get("session", key);
      const merged = mergeSessionValue(existing, incoming);
      if (merged !== existing) await target.put("session", merged, key);
    }

    const cleanup = anon.transaction([...ALL_STORES], "readwrite");
    await Promise.all([
      ...ALL_STORES.map((store) => cleanup.objectStore(store).clear()),
      cleanup.done,
    ]);
  } finally {
    anon.close();
  }
}

export async function saveBook(book: StoredBook) {
  const db = await getDb();
  const transaction = db.transaction(["books", "session"], "readwrite");
  await Promise.all([
    transaction.objectStore("books").put(book),
    transaction.objectStore("session").put(book.hash, SESSION_KEY),
    transaction.done,
  ]);
}

export async function loadLatestBook() {
  const db = await getDb();
  const hash = await db.get("session", SESSION_KEY);
  return hash ? db.get("books", hash) : undefined;
}

export async function loadLatestBookHash() {
  const db = await getDb();
  return db.get("session", SESSION_KEY);
}

export async function listStoredBooks() {
  const db = await getDb();
  return db.getAll("books");
}

export async function getStoredBook(hash: string) {
  const db = await getDb();
  return db.get("books", hash);
}

// Guarda los metadatos del EPUB (título, autor, portada) sin tocar el
// archivo; metaVersion evita releer libros cuyo intento ya falló.
export async function updateBookMeta(
  hash: string,
  meta: Pick<StoredBook, "title" | "author" | "language" | "sectionCount" | "cover" | "metaVersion">,
) {
  const db = await getDb();
  const book = await db.get("books", hash);
  if (!book) return;
  await db.put("books", { ...book, ...meta });
}

export async function listPositions() {
  const db = await getDb();
  return db.getAll("positions");
}

export async function saveBookPosition(position: SavedBookPosition) {
  const db = await getDb();
  await db.put("positions", position);
}

const READ_DAYS_KEY = "readingDays";

// Cada intervalo de lectura cerrado registra el día (a medianoche
// local) para los puntos de la semana. Se alimenta solo de tiempo de
// lectura medido — abrir un libro o guardar posición ya no basta.
async function recordReadingDay(db: IDBPDatabase<LectaDB>, now = Date.now()) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const stamp = day.getTime();
  const days = parseReadingDays(await db.get("session", READ_DAYS_KEY));
  if (days.includes(stamp)) return;
  days.push(stamp);
  const recent = days.filter((item) => now - item < 90 * 86_400_000).slice(-120);
  await db.put("session", JSON.stringify(recent), READ_DAYS_KEY);
}

function parseReadingDays(raw: string | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => typeof item === "number")
      : [];
  } catch {
    return [];
  }
}

export async function listReadingDays() {
  const db = await getDb();
  return parseReadingDays(await db.get("session", READ_DAYS_KEY));
}

// Pequeños valores por cuenta (velocidad de lectura medida, etc.).
export async function saveSessionValue(key: string, value: string) {
  const db = await getDb();
  await db.put("session", value, key);
}

export async function loadSessionValue(key: string) {
  const db = await getDb();
  return db.get("session", key);
}

export async function listSessionKeys(): Promise<string[]> {
  const db = await getDb();
  return (await db.getAllKeys("session")).filter(
    (key): key is string => typeof key === "string",
  );
}

// ---------- Ciclo de vida del store session ----------

// Claves de session que viajan anónimo→cuenta y al respaldo. Los
// formatos los congelan preparation.ts (`preparation:v1:<hash>:`,
// `bookStart:v1:<hash>`) y calibration.ts (`calibrationDone`); aquí
// van literales porque esos módulos ya importan idb (un import de
// vuelta crearía un ciclo). Los sellos de sync, el ajuste de auth y
// claves arbitrarias NO migran: no son datos del lector.
const SESSION_MIGRATABLE_PREFIXES = ["preparation:v1:", "bookStart:v1:"] as const;

export function isMigratableSessionKey(key: string): boolean {
  return (
    key === "calibrationDone" ||
    SESSION_MIGRATABLE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

// Decide qué valor queda al migrar una clave de session: la cuenta
// conserva lo suyo salvo que lo anónimo sea un registro con
// `updatedAt` más reciente (registros v1 de inicio/preparación).
// Banderas sin sello («calibrationDone») y contenido no verificable
// jamás pisan lo que la cuenta ya tiene.
export function mergeSessionValue(
  existing: string | undefined | null,
  incoming: string,
): string {
  if (existing == null) return incoming;
  try {
    const a = JSON.parse(existing) as { updatedAt?: unknown };
    const b = JSON.parse(incoming) as { updatedAt?: unknown };
    if (
      typeof a?.updatedAt === "number" &&
      typeof b?.updatedAt === "number" &&
      b.updatedAt > a.updatedAt
    )
      return incoming;
  } catch {
    // No es JSON: se conserva lo de la cuenta.
  }
  return existing;
}

// Claves de session que pertenecen a un libro: su inicio elegido y
// todas sus preparaciones. El prefijo lleva dos puntos tras el hash —
// «abc» no borra lo de «abc2».
export function isBookScopedSessionKey(bookHash: string, key: string): boolean {
  return (
    key === `bookStart:v1:${bookHash}` ||
    key.startsWith(`preparation:v1:${bookHash}:`)
  );
}

export async function loadBookPosition(bookHash: string) {
  const db = await getDb();
  return db.get("positions", bookHash);
}

export function wordKey(language: string, form: string) {
  return `${language}:${form.toLowerCase()}`;
}

export async function saveWord(word: Omit<SavedWord, "key" | "savedAt">) {
  const db = await getDb();
  const now = Date.now();
  const entry: SavedWord = {
    ...word,
    key: wordKey(word.language, word.form),
    savedAt: now,
    updatedAt: now,
  };
  await db.put("savedWords", entry);
  return entry;
}

// Guardar una palabra y su evidencia «aún no la sé» son un solo acto:
// van en una transacción para que nunca quede la palabra sin la señal
// (o al revés). Devuelve la fila de conocimiento vigente — si ya
// decía lo mismo con una fuente igual o más fuerte no se reescribe
// (mergeKnowledgeWrite) y se devuelve la existente.
export async function saveWordWithKnowledge(input: {
  word: Omit<SavedWord, "key" | "savedAt">;
  knowledge: Omit<KnownWord, "key" | "updatedAt">;
}): Promise<{ word: SavedWord; knowledge: KnownWord | null }> {
  const db = await getDb();
  const now = Date.now();
  const tx = db.transaction(["savedWords", "knowledge"], "readwrite");
  const entry: SavedWord = {
    ...input.word,
    key: wordKey(input.word.language, input.word.form),
    savedAt: now,
    updatedAt: now,
  };
  const knowledgeStore = tx.objectStore("knowledge");
  const existing = await knowledgeStore.get(
    knowledgeKey(input.knowledge.language, input.knowledge.lemma),
  );
  const next = mergeKnowledgeWrite(existing, input.knowledge, now);
  await tx.objectStore("savedWords").put(entry);
  if (next) await knowledgeStore.put(next);
  await tx.done;
  return { word: entry, knowledge: next ?? existing ?? null };
}

export async function loadSavedWord(language: string, form: string) {
  const db = await getDb();
  const word = await db.get("savedWords", wordKey(language, form));
  return word?.deleted ? undefined : word;
}

// Palabras visibles (sin lápidas). Para sincronización usa
// listAllSavedWords, que incluye los borrados pendientes de propagar.
export async function listSavedWords(language?: string) {
  const all = await listAllSavedWords(language);
  return all.filter((word) => !word.deleted);
}

export async function listAllSavedWords(language?: string) {
  const db = await getDb();
  const all = await db.getAll("savedWords");
  return language ? all.filter((word) => word.language === language) : all;
}

// Borrado lógico: queda una lápida con updatedAt nuevo para que la
// sincronización propague el borrado incluso si se hizo sin conexión.
export async function removeSavedWord(key: string) {
  const db = await getDb();
  const word = await db.get("savedWords", key);
  if (!word) return undefined;
  const tombstone = { ...word, deleted: true, updatedAt: Date.now() };
  await db.put("savedWords", tombstone);
  return tombstone;
}

export async function putSavedWord(word: SavedWord) {
  const db = await getDb();
  await db.put("savedWords", word);
}

export async function updateSavedWord(word: SavedWord) {
  const db = await getDb();
  const updated = { ...word, updatedAt: Date.now() };
  await db.put("savedWords", updated);
  return updated;
}

const annotationKey = (bookHash: string, id: string) => `${bookHash}:${id}`;

export async function saveAnnotation(
  input: Omit<SavedAnnotation, "key" | "createdAt" | "updatedAt">,
) {
  const db = await getDb();
  const now = Date.now();
  const entry: SavedAnnotation = {
    ...input,
    key: annotationKey(input.bookHash, input.id),
    createdAt: now,
    updatedAt: now,
  };
  await db.put("annotations", entry);
  return entry;
}

export async function listAnnotations(bookHash?: string) {
  const all = await listAllAnnotations(bookHash);
  return all.filter((annotation) => !annotation.deleted);
}

// Incluye lápidas: la sincronización necesita propagar los borrados.
export async function listAllAnnotations(bookHash?: string) {
  const db = await getDb();
  const all = await db.getAll("annotations");
  return bookHash ? all.filter((item) => item.bookHash === bookHash) : all;
}

export async function removeAnnotation(key: string) {
  const db = await getDb();
  const item = await db.get("annotations", key);
  if (!item) return undefined;
  const tombstone = { ...item, deleted: true, updatedAt: Date.now() };
  await db.put("annotations", tombstone);
  return tombstone;
}

export async function putAnnotation(annotation: SavedAnnotation) {
  const db = await getDb();
  await db.put("annotations", annotation);
}

// Guarda un intervalo de lectura y sella cada día local que toca
// (uno que cruza medianoche cuenta en ambos días). El recorrido usa
// setDate para respetar días de 23/25 h en cambio de horario.
export async function saveReadingInterval(interval: SavedInterval) {
  const db = await getDb();
  await db.put("activity", interval);
  const cursor = new Date(interval.startedAt);
  cursor.setHours(0, 0, 0, 0);
  const lastDay = new Date(interval.endedAt);
  lastDay.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= lastDay.getTime()) {
    await recordReadingDay(db, cursor.getTime() + 60_000);
    cursor.setDate(cursor.getDate() + 1);
  }
}

// Inserta solo los intervalos que faltan por id (llegada del servidor).
// Devuelve cuántos eran nuevos.
export async function putMissingIntervals(intervals: SavedInterval[]) {
  const db = await getDb();
  let added = 0;
  for (const interval of intervals) {
    if (!(await db.get("activity", interval.id))) {
      await db.put("activity", interval);
      added += 1;
    }
  }
  return added;
}

export async function listIntervals() {
  const db = await getDb();
  return db.getAll("activity");
}

// Guarda un repaso; si no trae id se genera uno (uuid) como hace el
// lector al cerrar intervalos.
export async function saveReview(review: Omit<SavedReview, "id"> & { id?: string }) {
  const db = await getDb();
  const entry: SavedReview = { ...review, id: review.id ?? crypto.randomUUID() };
  await db.put("reviews", entry);
  return entry;
}

// Inserta solo los repasos que faltan por id (llegada del servidor).
// Devuelve cuántos eran nuevos.
export async function putReviews(reviews: SavedReview[]) {
  const db = await getDb();
  let added = 0;
  for (const review of reviews) {
    if (!(await db.get("reviews", review.id))) {
      await db.put("reviews", review);
      added += 1;
    }
  }
  return added;
}

export async function listAllReviews() {
  const db = await getDb();
  return db.getAll("reviews");
}

// ---------- Trayecto de lectura (local, no sincronizado) ----------

// Inserta un evento tal cual; son inmutables y deduplicables por id.
export async function putReadingEvent(event: ReadingEvent) {
  const db = await getDb();
  await db.put("readingEvents", event);
}

export async function listReadingEvents(bookHash?: string) {
  const db = await getDb();
  const all = await db.getAll("readingEvents");
  const filtered = bookHash ? all.filter((e) => e.bookHash === bookHash) : all;
  return filtered.sort((a, b) => a.createdAt - b.createdAt);
}

// Poda por antigüedad: el historial es diagnóstico reciente, no
// archivo permanente. Devuelve cuántos eventos se borraron.
export async function pruneReadingEvents(olderThan: number) {
  const db = await getDb();
  const all = await db.getAll("readingEvents");
  const stale = all.filter((e) => e.createdAt < olderThan);
  for (const event of stale) await db.delete("readingEvents", event.id);
  return stale.length;
}

// ---------- Modelo de conocimiento ----------

// La clave comparte formato con wordKey (idioma:término en minúsculas)
// pero nombra «lema»: la evidencia es por lema, no por forma.
export function knowledgeKey(language: string, lemma: string) {
  return `${language}:${lemma.toLowerCase()}`;
}

// Crea o actualiza la evidencia de un lema con sello nuevo (salvo que
// llegue uno explícito, p. ej. al restaurar) pasando por la regla de
// fuerza de fuentes: una evidencia débil jamás deshace una explícita.
// Devuelve la fila vigente —la nueva o la existente si no tocaba
// escribir— para que el llamador pueda aplicarla al modelo y subirla.
export async function saveKnowledge(
  input: Omit<KnownWord, "key" | "updatedAt"> & { updatedAt?: number },
) {
  const db = await getDb();
  const key = knowledgeKey(input.language, input.lemma);
  const existing = await db.get("knowledge", key);
  const now = input.updatedAt ?? Date.now();
  const next = mergeKnowledgeWrite(existing, input, now);
  if (next) await db.put("knowledge", next);
  // mergeKnowledgeWrite solo devuelve null habiendo fila previa.
  return (next ?? existing) as KnownWord;
}

// Evidencia visible (sin lápidas). Para sincronización usa
// listAllKnowledge, que incluye los borrados pendientes de propagar.
export async function listKnowledge(language?: string) {
  const all = await listAllKnowledge(language);
  return all.filter((word) => !word.deleted);
}

export async function listAllKnowledge(language?: string) {
  const db = await getDb();
  const all = await db.getAll("knowledge");
  return language ? all.filter((word) => word.language === language) : all;
}

// Borrado lógico, igual que removeSavedWord: la lápida con sello nuevo
// propaga el borrado incluso si se hizo sin conexión.
export async function removeKnowledge(key: string) {
  const db = await getDb();
  const word = await db.get("knowledge", key);
  if (!word) return undefined;
  const tombstone = { ...word, deleted: true, updatedAt: Date.now() };
  await db.put("knowledge", tombstone);
  return tombstone;
}

// Inserta la fila tal cual llegó (sincronización): no toca updatedAt.
export async function putKnowledge(word: KnownWord) {
  const db = await getDb();
  await db.put("knowledge", word);
}

export async function updateAnnotation(annotation: SavedAnnotation) {
  const db = await getDb();
  const updated = { ...annotation, updatedAt: Date.now() };
  await db.put("annotations", updated);
  return updated;
}

// Borra el archivo, su posición guardada, la elección de inicio, los
// registros de preparación y el trayecto del libro, y la referencia
// de último libro si apuntaba a este. Las anotaciones quedan como
// lápidas para que la sincronización propague el borrado a otros
// dispositivos.
export async function deleteStoredBook(hash: string) {
  const db = await getDb();
  const transaction = db.transaction(
    ["books", "positions", "session", "annotations", "readingEvents"],
    "readwrite",
  );
  const session = transaction.objectStore("session");
  const [latest, sessionKeys] = await Promise.all([
    session.get(SESSION_KEY),
    session.getAllKeys(),
  ]);
  const now = Date.now();
  const annotations = transaction.objectStore("annotations");
  const bookAnnotations = (await annotations.getAll()).filter(
    (item) => item.bookHash === hash && !item.deleted,
  );
  const events = transaction.objectStore("readingEvents");
  const bookEvents = (await events.getAll()).filter(
    (item) => item.bookHash === hash,
  );
  await Promise.all([
    transaction.objectStore("books").delete(hash),
    transaction.objectStore("positions").delete(hash),
    latest === hash ? session.delete(SESSION_KEY) : undefined,
    ...sessionKeys
      .filter(
        (key): key is string =>
          typeof key === "string" && isBookScopedSessionKey(hash, key),
      )
      .map((key) => session.delete(key)),
    ...bookAnnotations.map((item) =>
      annotations.put({ ...item, deleted: true, updatedAt: now }),
    ),
    ...bookEvents.map((item) => events.delete(item.id)),
    transaction.done,
  ]);
}

// ---------- Cola de operaciones de libro ----------

// Encola una operación de libro (subida o borrado remoto) para
// procesarla con runBookQueue; si no llega id se genera uno (uuid).
export async function enqueueBookOp(
  op: Omit<BookOp, "id" | "createdAt"> & { id?: string },
) {
  const db = await getDb();
  const entry: BookOp = {
    ...op,
    id: op.id ?? crypto.randomUUID(),
    createdAt: Date.now(),
  };
  await db.put("bookOps", entry);
  return entry;
}

export async function listBookOps() {
  const db = await getDb();
  return db.getAll("bookOps");
}

export async function removeBookOp(id: string) {
  const db = await getDb();
  await db.delete("bookOps", id);
}

// Anota el último error sin sacar la op de la cola: se reintenta en la
// próxima corrida y el mensaje queda para diagnóstico.
export async function markBookOpError(id: string, message: string) {
  const db = await getDb();
  const op = await db.get("bookOps", id);
  if (!op) return;
  await db.put("bookOps", { ...op, lastError: message });
}

// --- Preparación «Antes de leer» -------------------------------------

// Pesos de la fuente de evidencia: lo inferido por actos (dominadas,
// consultas antiguas) pesa menos que el guardado en el Cuaderno y
// mucho menos que una respuesta explícita (calibración, «ya la
// conozco», ronda de preparación).
const SOURCE_STRENGTH: Record<string, number> = {
  inferred: 0,
  saved: 1,
  calibration: 2,
  declared: 2,
  preparation: 2,
};

// Fila de `knowledge` a escribir por una evidencia nueva.
// `null` = nada que escribir. Una fuente estrictamente más débil
// nunca pisa una fuerte, ni para confirmar ni para cambiar el
// veredicto (un «inferred» no puede deshacer un «ya la conozco»); a
// fuerza igual gana lo último que escribió el lector, así que solo se
// omite la escritura redundante —mismo veredicto y misma fuerza—, que
// solo movería el sello y generaría ruido de sincronización. Mismo
// veredicto con fuente más fuerte SÍ reescribe (la respuesta
// explícita eleva la inferencia débil); una lápida también: la
// evidencia nueva es fresca.
export function mergeKnowledgeWrite(
  existing: KnownWord | undefined,
  row: Omit<KnownWord, "key" | "updatedAt">,
  now: number,
): KnownWord | null {
  if (existing && !existing.deleted) {
    const incoming = SOURCE_STRENGTH[row.source] ?? 0;
    const current = SOURCE_STRENGTH[existing.source] ?? 0;
    if (incoming < current) return null;
    if (incoming === current && existing.known === row.known)
      return null;
  }
  return {
    ...row,
    key: existing?.key ?? knowledgeKey(row.language, row.lemma),
    updatedAt: now,
  };
}

export const mergePreparationKnowledge = mergeKnowledgeWrite;

// Fila de `savedWords` a escribir por una respuesta «desconocida»
// nueva. `null` = nada que escribir. Una palabra activa se conserva
// intacta (tarjeta, acepción, contexto y fechas son del lector). Una
// lápida se restaura conservando esos campos útiles y rellenando los
// huecos con lo que trae la respuesta; el indicador de borrado se va.
export function mergePreparationWord(
  existing: SavedWord | undefined,
  word: Omit<SavedWord, "key" | "savedAt">,
  now: number,
): SavedWord | null {
  if (existing && !existing.deleted) return null;
  if (existing) {
    return {
      ...existing,
      deleted: undefined,
      updatedAt: now,
      lemma: existing.lemma ?? word.lemma,
      pos: existing.pos ?? word.pos,
      meaning: existing.meaning ?? word.meaning,
      context: existing.context ?? word.context,
      bookHash: existing.bookHash ?? word.bookHash,
      senseEntryId: existing.senseEntryId ?? word.senseEntryId,
      senseOrder: existing.senseOrder ?? word.senseOrder,
      card: existing.card ?? word.card,
    };
  }
  return {
    ...word,
    key: wordKey(word.language, word.form),
    savedAt: now,
    updatedAt: now,
  };
}

// Lote confirmado de una ronda de preparación: evidencia de
// conocimiento, palabras desconocidas del Cuaderno y el registro de
// la ronda, en una sola transacción. Si cualquier escritura falla,
// ninguna tabla cambia. Devuelve las filas efectivamente escritas
// para que quien llame las sincronice después — aquí no entra nada
// de red.
export async function savePreparationBatch(input: {
  record: PreparationRecord;
  // `preparationRecordKey(record.bookHash, record.targetId)` — la arma
  // quien llama para no importar preparation.ts desde aquí.
  recordKey: string;
  knowledge: Omit<KnownWord, "key" | "updatedAt">[];
  words: Omit<SavedWord, "key" | "savedAt">[];
}): Promise<{ knowledge: KnownWord[]; words: SavedWord[] }> {
  const db = await getDb();
  const now = Date.now();
  const tx = db.transaction(["knowledge", "savedWords", "session"], "readwrite");

  const knowledge: KnownWord[] = [];
  const words: SavedWord[] = [];
  try {
    const knowledgeStore = tx.objectStore("knowledge");
    for (const row of input.knowledge) {
      const existing = await knowledgeStore.get(
        knowledgeKey(row.language, row.lemma),
      );
      const entry = mergePreparationKnowledge(existing, row, now);
      if (!entry) continue;
      await knowledgeStore.put(entry);
      knowledge.push(entry);
    }

    const wordsStore = tx.objectStore("savedWords");
    for (const word of input.words) {
      const existing = await wordsStore.get(wordKey(word.language, word.form));
      const entry = mergePreparationWord(existing, word, now);
      if (!entry) continue;
      await wordsStore.put(entry);
      words.push(entry);
    }

    await tx
      .objectStore("session")
      .put(JSON.stringify(input.record), input.recordKey);
  } catch (err) {
    // Una excepción entre peticiones no aborta la transacción por sí
    // sola: al quedar inactiva, IDB confirmaría lo ya encolado. Abortar
    // a mano para que el lote sea todo o nada. (abort() sobre una
    // transacción ya cerrada lanza; se ignora.)
    try {
      tx.abort();
    } catch {
      /* la transacción ya terminó */
    }
    throw err;
  }
  await tx.done;
  return { knowledge, words };
}
