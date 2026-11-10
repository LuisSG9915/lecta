// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

// FakeDb con transacciones diferidas, igual que en offline-dictionary.test.
const KEY_PATHS: Record<string, string> = {
  entries: "key",
  forms: "key",
  meta: "key",
};

class FakeDb {
  stores = new Map<string, Map<unknown, unknown>>();
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  createObjectStore(name: string) {
    this.stores.set(name, new Map());
  }

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

  put(name: string, value: unknown) {
    const key = (value as Record<string, unknown>)[KEY_PATHS[name]];
    this.storeFor(name).set(key, value);
    return Promise.resolve(key);
  }

  clear(name: string) {
    this.storeFor(name).clear();
    return Promise.resolve();
  }

  transaction() {
    const pending: (() => void)[] = [];
    return {
      objectStore: (name: string) => ({
        get: (key: unknown) => this.get(name, key),
        put: (value: unknown) => {
          pending.push(() => void this.put(name, value));
          return Promise.resolve((value as Record<string, unknown>)[KEY_PATHS[name]]);
        },
      }),
      get done() {
        pending.forEach((run) => run());
        return Promise.resolve();
      },
    };
  }

  close() {}
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
  openDB: vi.fn(async (name: string, _v: number, opts?: { upgrade?: (db: FakeDb) => void }) => {
    const db = dbFor(name);
    opts?.upgrade?.(db);
    return db;
  }),
}));

import {
  DICTIONARY_PACKS,
  dictionaryPackStatus,
  ensureDictionaryPack,
  lookupDictionaryPack,
  __resetDictionaryPackForTests,
  type DictLanguage,
} from "./dictionaryPack";

const PACK_TSV = [
  "#lecta-dict v4 en",
  "E\tschool\tsustantivo\tEscuela, instituto, colegio.\x1FCardumen, banco de peces.",
  "E\tstilt\tsustantivo\tZanco.\x1FPilar elevado.",
  "F\tschools\tschool",
  "F\tstilts\tstilt",
].join("\n") + "\n";

function packResponse(tsv = PACK_TSV) {
  const gz = gzipSync(Buffer.from(tsv, "utf8"));
  const sha = createHash("sha256").update(gz).digest("hex");
  return { gz, sha };
}

function stubPackInfo(lang: DictLanguage, sha: string, bytes: number) {
  const pack = DICTIONARY_PACKS[lang];
  pack.sha256 = sha;
  pack.bytes = bytes;
}

beforeEach(() => {
  __resetDictionaryPackForTests();
  disk.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dictionaryPack", () => {
  it("consulta sin paquete instalado devuelve null", async () => {
    expect(await lookupDictionaryPack("school", "en")).toBeNull();
  });

  it("instala y resuelve lema y flexión", async () => {
    const { gz, sha } = packResponse();
    stubPackInfo("en", sha, gz.length);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(gz, { status: 200 })),
    );

    expect(await ensureDictionaryPack("en")).toBe("installed");
    const status = await dictionaryPackStatus("en");
    expect(status.installed).toBe(true);
    expect(status.entries).toBe(2);
    expect(status.forms).toBe(2);

    const lemma = await lookupDictionaryPack("school", "en");
    expect(lemma?.lemma).toBe("school");
    expect(lemma?.pos).toBe("sustantivo");
    expect(lemma?.senses[0]?.definition).toContain("Escuela");

    const flexion = await lookupDictionaryPack("schools", "en");
    expect(flexion?.lemma).toBe("school");
    expect(flexion?.senses[0]?.definition).toContain("Escuela");
  });

  it("no instala con hash incorrecto y puede reintentar", async () => {
    const { gz } = packResponse();
    stubPackInfo("en", "0".repeat(64), gz.length);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(gz, { status: 200 })),
    );
    expect(await ensureDictionaryPack("en")).toBe("failed");
    expect((await dictionaryPackStatus("en")).installed).toBe(false);
    expect(await lookupDictionaryPack("school", "en")).toBeNull();

    const { gz: gz2, sha: sha2 } = packResponse();
    stubPackInfo("en", sha2, gz2.length);
    expect(await ensureDictionaryPack("en")).toBe("installed");
  });

  it("rechaza una cabecera de otra versión", async () => {
    const tsv = "#lecta-dict v9 en\nE\tschool\tsustantivo\tEscuela.\n";
    const { gz, sha } = packResponse(tsv);
    stubPackInfo("en", sha, gz.length);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(gz)));
    expect(await ensureDictionaryPack("en")).toBe("failed");
    expect(await lookupDictionaryPack("school", "en")).toBeNull();
  });

  it("una sola descarga en vuelo aunque se pida dos veces", async () => {
    const { gz, sha } = packResponse();
    stubPackInfo("en", sha, gz.length);
    const spy = vi.fn(async () => new Response(gz));
    vi.stubGlobal("fetch", spy);
    const [a, b] = await Promise.all([
      ensureDictionaryPack("en"),
      ensureDictionaryPack("en"),
    ]);
    expect([a, b]).toEqual(["installed", "installed"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("instalar un idioma no borra al otro", async () => {
    const en = packResponse();
    stubPackInfo("en", en.sha, en.gz.length);
    const esTsv = "#lecta-dict v1 es\nE\tcasa\tsustantivo\tVivienda.\n";
    const es = packResponse(esTsv);
    stubPackInfo("es", es.sha, es.gz.length);
    const bodies: Record<string, ArrayBuffer> = {
      "/dict/dict-en-v4.bin": new Uint8Array(en.gz).buffer,
      "/dict/dict-es-v1.bin": new Uint8Array(es.gz).buffer,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) =>
        new Response(bodies[String(url)]),
      ),
    );

    expect(await ensureDictionaryPack("en")).toBe("installed");
    expect(await ensureDictionaryPack("es")).toBe("installed");
    // Tras instalar es, el paquete en sigue resolviendo.
    const entry = await lookupDictionaryPack("school", "en");
    expect(entry?.senses[0]?.definition).toContain("Escuela");
    const esEntry = await lookupDictionaryPack("casa", "es");
    expect(esEntry?.senses[0]?.definition).toBe("Vivienda.");
  });

  it("ya instalado no vuelve a pedir la red", async () => {
    const { gz, sha } = packResponse();
    stubPackInfo("en", sha, gz.length);
    const spy = vi.fn(async () => new Response(gz));
    vi.stubGlobal("fetch", spy);
    await ensureDictionaryPack("en");
    expect(await ensureDictionaryPack("en")).toBe("already");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
