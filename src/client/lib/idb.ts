import { openDB, type IDBPDatabase } from "idb";
import type { Card } from "./fsrs";

export interface StoredBook {
  hash: string;
  name: string;
  addedAt: number;
  data: Blob;
}

export interface SavedBookPosition {
  bookHash: string;
  sectionIndex: number;
  scrollTop: number;
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

interface LectaDB {
  books: { key: string; value: StoredBook };
  positions: { key: string; value: SavedBookPosition };
  session: { key: string; value: string };
  savedWords: { key: string; value: SavedWord };
}

const SESSION_KEY = "latestBookHash";
const ANONYMOUS_DB = "lecta";
const DB_VERSION = 2;
const ALL_STORES = ["books", "positions", "session", "savedWords"] as const;

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
    const [books, positions, words, latestHash] = await Promise.all([
      anon.getAll("books"),
      anon.getAll("positions"),
      anon.getAll("savedWords"),
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

export async function listStoredBooks() {
  const db = await getDb();
  return db.getAll("books");
}

export async function saveBookPosition(position: SavedBookPosition) {
  const db = await getDb();
  await db.put("positions", position);
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

// Borra el archivo, su posición guardada y la referencia de último
// libro si apuntaba a este.
export async function deleteStoredBook(hash: string) {
  const db = await getDb();
  const transaction = db.transaction(["books", "positions", "session"], "readwrite");
  const latest = await transaction.objectStore("session").get(SESSION_KEY);
  await Promise.all([
    transaction.objectStore("books").delete(hash),
    transaction.objectStore("positions").delete(hash),
    latest === hash ? transaction.objectStore("session").delete(SESSION_KEY) : undefined,
    transaction.done,
  ]);
}
