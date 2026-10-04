import { openDB, type IDBPDatabase } from "idb";
import type { Card } from "./fsrs";

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

interface LectaDB {
  books: { key: string; value: StoredBook };
  positions: { key: string; value: SavedBookPosition };
  session: { key: string; value: string };
  savedWords: { key: string; value: SavedWord };
  annotations: { key: string; value: SavedAnnotation };
  activity: { key: string; value: SavedInterval };
}

const SESSION_KEY = "latestBookHash";
const ANONYMOUS_DB = "lecta";
const DB_VERSION = 4;
const ALL_STORES = [
  "books",
  "positions",
  "session",
  "savedWords",
  "annotations",
  "activity",
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
    const [books, positions, words, annotations, intervals, latestHash] =
      await Promise.all([
        anon.getAll("books"),
        anon.getAll("positions"),
        anon.getAll("savedWords"),
        anon.getAll("annotations"),
        anon.getAll("activity"),
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
    if (latestHash && !(await target.get("session", SESSION_KEY))) {
      await target.put("session", latestHash, SESSION_KEY);
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

export async function updateAnnotation(annotation: SavedAnnotation) {
  const db = await getDb();
  const updated = { ...annotation, updatedAt: Date.now() };
  await db.put("annotations", updated);
  return updated;
}

// Borra el archivo, su posición guardada y la referencia de último
// libro si apuntaba a este. Las anotaciones quedan como lápidas para
// que la sincronización propague el borrado a otros dispositivos.
export async function deleteStoredBook(hash: string) {
  const db = await getDb();
  const transaction = db.transaction(
    ["books", "positions", "session", "annotations"],
    "readwrite",
  );
  const latest = await transaction.objectStore("session").get(SESSION_KEY);
  const now = Date.now();
  const annotations = transaction.objectStore("annotations");
  const bookAnnotations = (await annotations.getAll()).filter(
    (item) => item.bookHash === hash && !item.deleted,
  );
  await Promise.all([
    transaction.objectStore("books").delete(hash),
    transaction.objectStore("positions").delete(hash),
    latest === hash ? transaction.objectStore("session").delete(SESSION_KEY) : undefined,
    ...bookAnnotations.map((item) =>
      annotations.put({ ...item, deleted: true, updatedAt: now }),
    ),
    transaction.done,
  ]);
}
