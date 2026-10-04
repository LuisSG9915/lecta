import { openDB } from "idb";
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
  card?: Card;
}

interface LectaDB {
  books: { key: string; value: StoredBook };
  positions: { key: string; value: SavedBookPosition };
  session: { key: string; value: string };
  savedWords: { key: string; value: SavedWord };
}

const SESSION_KEY = "latestBookHash";

const dbPromise = openDB<LectaDB>("lecta", 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "hash" });
    if (!db.objectStoreNames.contains("positions"))
      db.createObjectStore("positions", { keyPath: "bookHash" });
    if (!db.objectStoreNames.contains("session")) db.createObjectStore("session");
    if (!db.objectStoreNames.contains("savedWords"))
      db.createObjectStore("savedWords", { keyPath: "key" });
  },
});

export async function saveBook(book: StoredBook) {
  const db = await dbPromise;
  const transaction = db.transaction(["books", "session"], "readwrite");
  await Promise.all([
    transaction.objectStore("books").put(book),
    transaction.objectStore("session").put(book.hash, SESSION_KEY),
    transaction.done,
  ]);
}

export async function loadLatestBook() {
  const db = await dbPromise;
  const hash = await db.get("session", SESSION_KEY);
  return hash ? db.get("books", hash) : undefined;
}

export async function listStoredBooks() {
  const db = await dbPromise;
  return db.getAll("books");
}

export async function saveBookPosition(position: SavedBookPosition) {
  const db = await dbPromise;
  await db.put("positions", position);
}

export async function loadBookPosition(bookHash: string) {
  const db = await dbPromise;
  return db.get("positions", bookHash);
}

export function wordKey(language: string, form: string) {
  return `${language}:${form.toLowerCase()}`;
}

export async function saveWord(word: Omit<SavedWord, "key" | "savedAt">) {
  const db = await dbPromise;
  const entry: SavedWord = {
    ...word,
    key: wordKey(word.language, word.form),
    savedAt: Date.now(),
  };
  await db.put("savedWords", entry);
  return entry;
}

export async function loadSavedWord(language: string, form: string) {
  const db = await dbPromise;
  return db.get("savedWords", wordKey(language, form));
}

export async function listSavedWords(language?: string) {
  const db = await dbPromise;
  const all = await db.getAll("savedWords");
  return language ? all.filter((word) => word.language === language) : all;
}

export async function updateSavedWord(word: SavedWord) {
  const db = await dbPromise;
  await db.put("savedWords", word);
}
