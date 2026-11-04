// Diccionario local descargable: un paquete por idioma (es/en), cada
// uno en su propia base IndexedDB `lecta-dict-<lang>` — separadas para
// que la reinstalación de una versión nueva purgue solo su idioma.
// Compartidas entre cuentas porque es dato de referencia público
// (Wikcionario en español vía kaikki.org, CC BY-SA 4.0 + GFDL), no
// dato del usuario.
//
// Espejo del patrón del modelo de voz (kittenModel.ts): URL versionada
// con caché inmutable, SHA-256 verificado ANTES de escribir y marca de
// instalación (meta) solo al completar — una descarga a medias nunca
// cuenta como instalada y se reintenta en la próxima apertura.
//
// El disparo es automático al abrir un libro es/en (Reader.tsx); la
// consulta entra en la cadena de lookupWordRaw tras la caché/cuaderno
// del lector y antes del banco de calibración y de la red.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { generateLookupCandidates } from "../../shared/word-form";
import type { LexiconEntry } from "../../shared/lexicon";

export type DictLanguage = "es" | "en";

export interface DictionaryPackInfo {
  url: string;
  sha256: string;
  bytes: number;
  version: number;
  lemmas: number;
  forms: number;
}

// Los hashes salen de scripts/lexicon-pack.mjs; regenerar el paquete =
// subir la versión (la URL lleva v1) y pegar el nuevo hash aquí.
export const DICTIONARY_PACKS: Record<DictLanguage, DictionaryPackInfo> = {
  es: {
    url: "/lexicon/dict-es-v1.bin",
    sha256: "6e98cc32a256e2679f977742c7c9766fe3957bee9765558f4e2597abc7e4435d",
    bytes: 4_822_965,
    version: 1,
    lemmas: 126_905,
    forms: 336_248,
  },
  en: {
    url: "/lexicon/dict-en-v1.bin",
    sha256: "209bd2655846ec1e8b6cc9713aa1440289a4605707025f4bb58b9f7451355f01",
    bytes: 501_571,
    version: 1,
    lemmas: 15_233,
    forms: 49_155,
  },
};

const DB_VERSION = 1;
const FLUSH_ROWS = 5_000;
const dbName = (lang: DictLanguage) => `lecta-dict-${lang}`;

interface DictDB extends DBSchema {
  entries: { key: string; value: { key: string; pos: string | null; defs: string[] } };
  forms: { key: string; value: { key: string; lemma: string } };
  meta: {
    key: string;
    value: {
      key: string;
      version: number;
      sha256: string;
      entries: number;
      forms: number;
      installedAt: number;
    };
  };
}

const dbPromises = new Map<DictLanguage, Promise<IDBPDatabase<DictDB>>>();

function dictDb(lang: DictLanguage): Promise<IDBPDatabase<DictDB>> {
  let promise = dbPromises.get(lang);
  if (!promise) {
    promise = openDB<DictDB>(dbName(lang), DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("entries"))
          db.createObjectStore("entries", { keyPath: "key" });
        if (!db.objectStoreNames.contains("forms"))
          db.createObjectStore("forms", { keyPath: "key" });
        if (!db.objectStoreNames.contains("meta"))
          db.createObjectStore("meta", { keyPath: "key" });
      },
    });
    dbPromises.set(lang, promise);
  }
  return promise;
}

// Idiomas ya instalados en esta sesión (la meta se lee una sola vez por
// idioma; el lookup de cada palabra nunca vuelve a pagar esa lectura).
const installedCache = new Map<DictLanguage, boolean>();

export interface DictionaryPackStatus {
  installed: boolean;
  version?: number;
  entries?: number;
  forms?: number;
  installedAt?: number;
}

export async function dictionaryPackStatus(
  lang: DictLanguage,
): Promise<DictionaryPackStatus> {
  try {
    const db = await dictDb(lang);
    const meta = await db.get("meta", "pack");
    const installed = meta?.version === DICTIONARY_PACKS[lang].version;
    installedCache.set(lang, installed);
    return installed
      ? {
          installed: true,
          version: meta.version,
          entries: meta.entries,
          forms: meta.forms,
          installedAt: meta.installedAt,
        }
      : { installed: false };
  } catch {
    return { installed: false };
  }
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

// Lee la respuesta línea a línea sin materializar el archivo entero:
// blob → gzip → utf8 → troceo por \n arrastrando el resto.
async function* packLines(body: ReadableStream<Uint8Array>) {
  const stream = body
    .pipeThrough(
      new DecompressionStream("gzip") as unknown as TransformStream<
        Uint8Array,
        Uint8Array
      >,
    )
    .pipeThrough(
      new TextDecoderStream() as unknown as TransformStream<
        Uint8Array,
        string
      >,
    );
  const reader = stream.getReader();
  let tail = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = tail + value;
      const lines = chunk.split("\n");
      tail = lines.pop() ?? "";
      for (const line of lines) if (line) yield line;
    }
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

const inFlight = new Map<DictLanguage, Promise<DictPackResult>>();

export type DictPackResult = "installed" | "already" | "skipped" | "failed";

/**
 * Descarga e instala el paquete del idioma si falta. Silencioso por
 * diseño: con ahorro de datos, sin conexión o fetch viejo devuelve
 * "skipped"/"failed" y la lectura sigue igual — el próximo intento
 * retoma desde cero (la meta solo se escribe al final).
 */
export function ensureDictionaryPack(lang: DictLanguage): Promise<DictPackResult> {
  const pack = DICTIONARY_PACKS[lang];
  if (!pack) return Promise.resolve("skipped");
  const running = inFlight.get(lang);
  if (running) return running;
  const task = installPack(lang, pack).finally(() => inFlight.delete(lang));
  inFlight.set(lang, task);
  return task;
}

async function installPack(
  lang: DictLanguage,
  pack: DictionaryPackInfo,
): Promise<DictPackResult> {
  const status = await dictionaryPackStatus(lang);
  if (status.installed) return "already";
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return "skipped";
  const connection = (navigator as { connection?: { saveData?: boolean } })
    .connection;
  if (connection?.saveData) return "skipped";

  let response: Response;
  try {
    response = await fetch(pack.url, { credentials: "same-origin" });
    if (!response.ok || !response.body) return "failed";
  } catch {
    return "failed";
  }

  try {
    const compressed = await response.arrayBuffer();
    if (pack.bytes && compressed.byteLength !== pack.bytes) return "failed";
    const digest = await sha256Hex(compressed);
    if (digest !== pack.sha256) return "failed";

    const db = await dictDb(lang);
    // Versión nueva: purga el idioma antes de reescribir (la base es
    // solo de este idioma, así que no toca al otro paquete).
    await db.clear("entries");
    await db.clear("forms");

    let headerSeen = false;
    const stats = { entries: 0, forms: 0 };
    const batch: { entries: DictDB["entries"]["value"][]; forms: DictDB["forms"]["value"][] } = {
      entries: [],
      forms: [],
    };
    const flush = async () => {
      if (!batch.entries.length && !batch.forms.length) return;
      const tx = db.transaction(["entries", "forms"], "readwrite");
      for (const value of batch.entries) void tx.objectStore("entries").put(value);
      for (const value of batch.forms) void tx.objectStore("forms").put(value);
      batch.entries = [];
      batch.forms = [];
      await tx.done;
      await yieldToMain();
    };

    // Response.body da el ReadableStream sin pedir Blob.stream()
    // (ausente en jsdom y en WebViews viejos).
    const streamBody = new Response(compressed).body;
    if (!streamBody) return "failed";
    for await (const line of packLines(streamBody)) {
      if (!headerSeen) {
        if (!line.startsWith(`#lecta-dict v${pack.version} ${lang}`)) return "failed";
        headerSeen = true;
        continue;
      }
      const cols = line.split("\t");
      if (cols[0] === "E" && cols.length === 4) {
        const defs = cols[3].split("\x1F").filter(Boolean);
        if (!defs.length) continue;
        batch.entries.push({
          key: `${lang}:${cols[1]}`,
          pos: cols[2] || null,
          defs,
        });
        stats.entries += 1;
      } else if (cols[0] === "F" && cols.length === 3) {
        batch.forms.push({ key: `${lang}:${cols[1]}`, lemma: cols[2] });
        stats.forms += 1;
      }
      if (batch.entries.length + batch.forms.length >= FLUSH_ROWS) await flush();
    }
    if (!headerSeen) return "failed";
    await flush();
    // Marca de instalación al final: solo una descarga completa cuenta.
    await db.put("meta", {
      key: "pack",
      version: pack.version,
      sha256: pack.sha256,
      entries: stats.entries,
      forms: stats.forms,
      installedAt: Date.now(),
    });
    installedCache.set(lang, true);
    return "installed";
  } catch (err) {
    console.warn("[Lecta dict] instalación del paquete falló:", err);
    return "failed";
  }
}

/**
 * Resuelve una forma contra el paquete instalado. Devuelve una
 * LexiconEntry sin entryId (el dato local no conoce el id del catálogo)
 * o null si el idioma no está instalado / la palabra no está.
 */
export async function lookupDictionaryPack(
  form: string,
  lang: DictLanguage,
): Promise<LexiconEntry | null> {
  if (installedCache.get(lang) !== true) {
    const status = await dictionaryPackStatus(lang);
    if (!status.installed) return null;
  }
  const db = await dictDb(lang).catch(() => null);
  if (!db) return null;
  for (const candidate of generateLookupCandidates(form, lang)) {
    try {
      const direct = await db.get("entries", `${lang}:${candidate}`);
      if (direct?.defs?.length)
        return toLexiconEntry(candidate, direct);
      const linked = await db.get("forms", `${lang}:${candidate}`);
      if (linked) {
        const entry = await db.get("entries", `${lang}:${linked.lemma}`);
        if (entry?.defs?.length) return toLexiconEntry(linked.lemma, entry);
      }
    } catch {
      return null;
    }
  }
  return null;
}

function toLexiconEntry(
  lemma: string,
  row: { pos: string | null; defs: string[] },
): LexiconEntry {
  return {
    entryId: null,
    lemma,
    pos: row.pos,
    freqRank: null,
    zipf: null,
    senses: row.defs.map((definition, index) => ({
      definition,
      example: null,
      senseOrder: index + 1,
    })),
  };
}

// ── soporte de pruebas ──────────────────────────────────────────────
export async function __resetDictionaryPackForTests(): Promise<void> {
  installedCache.clear();
  inFlight.clear();
  for (const promise of dbPromises.values()) (await promise).close();
  dbPromises.clear();
}
