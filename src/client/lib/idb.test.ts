import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergeKnowledgeRecords, type KnowledgeRecord, type SavedWord } from "./idb";
import type { Card } from "./fsrs";

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

  clear(name: string) {
    this.storeFor(name).clear();
    return Promise.resolve();
  }

  transaction(_names: string[], _mode: string) {
    return {
      objectStore: (name: string) => ({
        get: (k: unknown) => this.get(name, k),
        put: (v: unknown, k?: unknown) => this.put(name, v, k),
        delete: (k: unknown) => this.delete(name, k),
        clear: () => this.clear(name),
      }),
      done: Promise.resolve(),
    };
  }

  close() {
    this.closed = true;
  }
}

const dbs = new Map<string, FakeDb>();
const dbFor = (name: string) => {
  let db = dbs.get(name);
  if (!db) {
    db = new FakeDb();
    dbs.set(name, db);
  }
  return db;
};

vi.mock("idb", () => ({
  openDB: (name: string) => Promise.resolve(dbFor(name)),
  deleteDB: (name: string) => {
    dbs.delete(name);
    return Promise.resolve();
  },
}));

describe("mergeKnowledgeRecords", () => {
  const baseCard1: Card = {
    due: new Date("2025-01-01"),
    stability: 2,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 1,
    reps: 1,
    lapses: 0,
    state: 1,
    learning_steps: 0,
    last_review: new Date("2025-01-01"),
  };

  const baseCard2: Card = {
    due: new Date("2025-01-02"),
    stability: 4,
    difficulty: 4,
    elapsed_days: 3,
    scheduled_days: 3,
    reps: 3,
    lapses: 0,
    state: 2,
    learning_steps: 0,
    last_review: new Date("2025-01-02"),
  };

  it("combina campos secundarios (contextSnippet, priority, passiveSeenCount) y card", () => {
    const anonRow: KnowledgeRecord = {
      key: "es:perenne",
      form: "perenne",
      language: "es",
      updatedAt: 2000,
      contextSnippet: "un árbol perenne en el bosque",
      priority: true,
      passiveSeenCount: 5,
    };

    const accountRow: KnowledgeRecord = {
      key: "es:perenne",
      form: "perenne",
      language: "es",
      updatedAt: 1000,
      card: baseCard1,
      passiveSeenCount: 2,
    };

    const merged = mergeKnowledgeRecords(anonRow, accountRow);

    expect(merged.contextSnippet).toBe("un árbol perenne en el bosque");
    expect(merged.priority).toBe(true);
    expect(merged.card).toEqual(baseCard1);
    expect(merged.passiveSeenCount).toBe(5);
    expect(merged.updatedAt).toBe(2000);
  });

  it("conserva la tarjeta FSRS más avanzada por reps o lastReview", () => {
    const rowLessReps: KnowledgeRecord = {
      key: "es:perenne",
      updatedAt: 3000,
      card: baseCard1, // reps: 1
    };
    const rowMoreReps: KnowledgeRecord = {
      key: "es:perenne",
      updatedAt: 1000,
      card: baseCard2, // reps: 3
    };

    const merged = mergeKnowledgeRecords(rowLessReps, rowMoreReps);
    expect(merged.card).toEqual(baseCard2);
  });

  it("una lápida borra la tarjeta y gana sobre registros anteriores", () => {
    const tombstone: KnowledgeRecord = {
      key: "es:perenne",
      updatedAt: 5000,
      deleted: true,
      card: null,
    };
    const existing: KnowledgeRecord = {
      key: "es:perenne",
      updatedAt: 2000,
      card: baseCard1,
    };

    const merged = mergeKnowledgeRecords(tombstone, existing);
    expect(merged.deleted).toBe(true);
    expect(merged.card).toBeNull();
  });
});

describe("migración anónimo -> cuenta en IDB", () => {
  beforeEach(() => {
    dbs.clear();
  });

  it("combina una fila anónima con contextSnippet y una fila de cuenta con card FSRS sin perder ninguno de los dos", async () => {
    const idb = await import("./idb");
    const now = Date.now();

    const sampleCard: Card = {
      due: new Date("2025-01-01"),
      stability: 3,
      difficulty: 4,
      elapsed_days: 2,
      scheduled_days: 2,
      reps: 2,
      lapses: 0,
      state: 2,
      learning_steps: 0,
      last_review: new Date("2025-01-01"),
    };

    // 1. Simular base anónima ("lecta"): tiene 'perenne' con contextSnippet
    const anonDb = dbFor("lecta");
    const anonWord: SavedWord = {
      key: "es:perenne",
      form: "perenne",
      language: "es",
      contextSnippet: "fragmento de contexto anónimo",
      savedAt: now - 1000,
      updatedAt: now,
      priority: true,
    };
    await anonDb.put("savedWords", anonWord);

    // 2. Simular base de cuenta ("lecta:u:u1"): ya tiene 'perenne' con card FSRS
    const accountDb = dbFor("lecta:u:u1");
    const accountWord: SavedWord = {
      key: "es:perenne",
      form: "perenne",
      language: "es",
      savedAt: now - 5000,
      updatedAt: now - 2000,
      card: sampleCard,
    };
    await accountDb.put("savedWords", accountWord);

    // 3. Iniciar sesión -> dispara migrateAnonymousToUser("u1")
    await idb.setDbUser("u1");

    // 4. Verificar resultado en la base de la cuenta ("lecta:u:u1")
    const migrated = (await accountDb.get("savedWords", "es:perenne")) as SavedWord;
    expect(migrated).toBeDefined();
    expect(migrated.contextSnippet).toBe("fragmento de contexto anónimo");
    expect(migrated.card).toEqual(sampleCard);
    expect(migrated.priority).toBe(true);
  });
});
