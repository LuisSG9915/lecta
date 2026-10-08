// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY_PATHS: Record<string, string> = {
  books: "hash",
  positions: "bookHash",
  savedWords: "key",
  annotations: "key",
  activity: "id",
  reviews: "id",
  knowledge: "key",
  readingEvents: "id",
  bookOps: "id",
  companionEvents: "id",
  companionReceipts: "id",
  lexiconCache: "key",
};

class FakeDb {
  stores = new Map<string, Map<unknown, unknown>>();
  closed = false;

  private storeFor(name: string) {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map();
      this.stores.set(name, store);
    }
    return store;
  }

  get(name: string, key: unknown) {
    return Promise.resolve(this.storeFor(name).get(key));
  }

  getAll(name: string) {
    return Promise.resolve([...this.storeFor(name).values()]);
  }

  getAllKeys(name: string) {
    return Promise.resolve([...this.storeFor(name).keys()]);
  }

  put(name: string, value: unknown, key?: unknown) {
    const k = key ?? (value as Record<string, unknown>)[KEY_PATHS[name]];
    this.storeFor(name).set(k, value);
    return Promise.resolve(k);
  }

  delete(name: string, key: unknown) {
    this.storeFor(name).delete(key);
    return Promise.resolve();
  }

  transaction() {
    const pending: (() => void)[] = [];
    let aborted = false;
    return {
      objectStore: (name: string) => ({
        get: (key: unknown) => this.get(name, key),
        getAll: () => this.getAll(name),
        getAllKeys: () => this.getAllKeys(name),
        put: (value: unknown, key?: unknown) => {
          if (aborted) return Promise.reject(new Error("tx abortada"));
          pending.push(() => {
            void this.put(name, value, key);
          });
          return Promise.resolve(
            key ?? (value as Record<string, unknown>)[KEY_PATHS[name]],
          );
        },
        delete: (key: unknown) => {
          pending.push(() => this.delete(name, key));
          return Promise.resolve();
        },
        clear: () => {
          pending.push(() => this.storeFor(name).clear());
          return Promise.resolve();
        },
      }),
      abort() {
        aborted = true;
        pending.length = 0;
      },
      get done() {
        if (!aborted) pending.forEach((run) => run());
        return Promise.resolve();
      },
    };
  }

  close() {
    this.closed = true;
  }
}

const disk = new Map<string, FakeDb>();
const dbFor = (name: string) => {
  let db = disk.get(name);
  if (!db) {
    db = new FakeDb();
    disk.set(name, db);
  }
  return db;
};

vi.mock("idb", () => ({
  openDB: vi.fn(async (name: string) => dbFor(name)),
}));

import {
  getBookDictionaryStatus,
  getDictionaryCacheWordCount,
  emptyDictionaryCache,
} from "./offline-dictionary";
import {
  saveCachedLexicon,
  clearCachedLexicon,
  saveSessionValue,
} from "./idb";
import type { LexiconEntry } from "./lexicon";
import { bookVocabKey } from "./book-vocab";

describe("offline-dictionary", () => {
  beforeEach(async () => {
    disk.clear();
    await clearCachedLexicon();
  });

  it("calcula estadísticas del diccionario cacheadas", async () => {
    const initialCount = await getDictionaryCacheWordCount();
    expect(initialCount).toBe(0);

    const fakeEntry: LexiconEntry = {
      entryId: "12345",
      lemma: "ataraxia",
      pos: "sustantivo",
      freqRank: null,
      zipf: 2.5,
      senses: [
        {
          definition: "Serenidad y tranquilidad del ánimo.",
          example: null,
          senseOrder: 1,
        },
      ],
    };

    await saveCachedLexicon("es", "ataraxia", [fakeEntry]);
    const countAfter = await getDictionaryCacheWordCount();
    expect(countAfter).toBe(1);

    await emptyDictionaryCache();
    const countAfterEmpty = await getDictionaryCacheWordCount();
    expect(countAfterEmpty).toBe(0);
  });

  it("calcula el porcentaje de palabras cacheadas para un libro", async () => {
    const hash = "fake-book-hash-123";
    const manifest = {
      v: 1,
      wordCount: 100,
      uniqueForms: 3,
      forms: ["palabra", "libro", "lectura"],
      entries: [],
      byForm: {},
      missing: [],
    };

    await saveSessionValue(bookVocabKey(hash), JSON.stringify(manifest));

    // Sin palabras cacheadas
    let status = await getBookDictionaryStatus(hash, "es");
    expect(status.total).toBe(3);
    expect(status.cached).toBe(0);
    expect(status.percent).toBe(0);

    // Guardar 1 palabra en caché
    const entry: LexiconEntry = {
      entryId: "1",
      lemma: "libro",
      pos: null,
      freqRank: null,
      zipf: 4.2,
      senses: [{ definition: "Conjunto de hojas encuadernadas", example: null, senseOrder: 1 }],
    };
    await saveCachedLexicon("es", "libro", [entry]);

    status = await getBookDictionaryStatus(hash, "es");
    expect(status.total).toBe(3);
    expect(status.cached).toBe(1);
    expect(status.percent).toBe(33);
  });
});
