import { openDB, type IDBPDatabase } from "idb";
import type { Card } from "./fsrs";
import type { PreparationRecord } from "./preparation";
import type { LexiconEntry } from "./lexicon";
import type { ReviewKind, ReviewRating } from "../../shared/reading-data";
import {
  KNOWLEDGE_SOURCE_STRENGTH,
  knowledgeArbWins,
  isFsrsCardShape,
} from "../../shared/reading-data";
import {
  mergeCompanionRegister,
  pendingAchievementCredits,
  projectGame,
  receiptIdFor,
  COMPANION_FIELDS,
  BOOK_MOODS,
  COMPANION_MOTION,
  type CompanionDevicePrefs,
  type CompanionRegister,
  type CompanionReceipt,
  type CompanionSnapshot,
  type GameJournalEvent,
  type LegacyGameBaseline,
} from "../../shared/companion-data";
import type { GameState } from "../../shared/gamification";

export type StoredBookBinary = Blob | ArrayBuffer | Uint8Array;

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

export interface StoredBookRecord extends Omit<StoredBook, "data"> {
  data: StoredBookBinary;
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
  contextSnippet?: string;
  bookHash?: string;
  bookTitle?: string;
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
  priority?: boolean;
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
  color?: "amber" | "salvia" | "dario";
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
  passiveSeenCount?: number;
  estimatedKnownProb?: number;
  status?: "unknown" | "familiar" | "known";
};

/**
 * Perfil psicométrico almacenado por cuenta en IndexedDB.
 */
export interface PsychometricProfileRecord {
  theta?: number;
  thetaByLang?: Record<string, number>;
  preferredPreviewCount?: number;
  consecutivePreviewSkips?: number;
  uncertaintyByLang?: Record<string, number>;
  chaptersCompletedByLang?: Record<string, number>;
  updatedAt?: number;
}

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
  // Los eventos tip_* se escriben desde la estantería, fuera de toda
  // visita de lectura: ahí visitId y bookHash van en null.
  visitId: string | null;
  bookHash: string | null;
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
    // Retroceso deliberado de página o sección: materia prima del
    // detector de fatiga (focus-telemetry).
    | {
        kind: "page_regressed";
        sectionIndex: number;
      }
    // Tiempo con la sección en pantalla al dejarla: dwell real por
    // bloque, con las palabras recorridas para el ritmo estimado.
    | {
        kind: "section_dwell";
        sectionIndex: number;
        ms: number;
        words: number;
      }
    // Aviso de fatiga emitido (bostezo del gato + sugerencia 20-20-20):
    // queda la muestra que lo provocó para auditar el umbral.
    | {
        kind: "fatigue_flag";
        sectionIndex: number;
        regressions: number;
        moves: number;
      }
    // Consejo diario de la estantería mostrado / aceptado: mide si
    // las intervenciones IA sirven (sin guardar el texto del tip).
    // Son los únicos eventos sin visita ni libro: nacen fuera del
    // lector.
    | {
        kind: "tip_shown";
        tipDay: string;
        action: string;
        promptVersion: string;
      }
    | {
        kind: "tip_accepted";
        tipDay: string;
        action: string;
      }
    // Marcador de retomar mostrado / «Releer el capítulo» elegido:
    // mide si el contexto de reenganche tras días sin abrir sirve.
    | {
        kind: "resume_shown";
        sectionIndex: number;
        daysSince: number;
        savedInRange: number;
      }
    | {
        kind: "resume_reread";
        sectionIndex: number;
        daysSince: number;
      }
    // Lectura en voz alta (voz del dispositivo, Web Speech API):
    // sesión iniciada / pausada / reanudada / terminada y cambio de
    // ajuste. Los payloads llevan solo identificadores y números —
    // jamás texto del libro ni la palabra consultada.
    | {
        kind: "tts_session_start";
        sessionId: string;
        targetId: string;
        sectionIndex: number;
        source: "reader_tools";
        rate: number;
        highlight: string;
      }
    | {
        kind: "tts_paused";
        sessionId: string;
        targetId: string;
        sectionIndex: number;
        reason: string;
        ms: number;
      }
    | {
        kind: "tts_resumed";
        sessionId: string;
        targetId: string;
        sectionIndex: number;
        ms: number;
      }
    | {
        kind: "tts_section_advance";
        sessionId: string;
        targetId: string;
        sectionIndex: number;
        ms: number;
      }
    | {
        kind: "tts_session_end";
        sessionId: string;
        targetId: string;
        sectionIndex: number;
        endReason: string;
        rate: number;
        ms: number;
        sentenceCount: number;
        lookupCount: number;
        savedWordCount: number;
        resumedCount: number;
        sectionAdvances: number;
      }
    // Fuera de visita (el ajuste puede cambiar desde la estantería):
    // visitId/bookHash quedan en null como los tip_*.
    | {
        kind: "tts_setting_changed";
        enabled: boolean;
        rate?: number;
        highlight?: string;
        source: "settings" | "reader_tools";
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
  books: { key: string; value: StoredBookRecord };
  positions: { key: string; value: SavedBookPosition };
  session: { key: string; value: string };
  savedWords: { key: string; value: SavedWord };
  annotations: { key: string; value: SavedAnnotation };
  activity: { key: string; value: SavedInterval };
  reviews: { key: string; value: SavedReview };
  knowledge: { key: string; value: KnownWord };
  readingEvents: { key: string; value: ReadingEvent };
  bookOps: { key: string; value: BookOp };
  companionEvents: { key: string; value: GameJournalEvent };
  companionReceipts: { key: string; value: CompanionReceipt };
  lexiconCache: { key: string; value: CachedLexiconEntry };
}

export interface CachedLexiconEntry {
  key: string;
  form: string;
  language: string;
  entries: LexiconEntry[];
  cachedAt: number;
}

const SESSION_KEY = "latestBookHash";
const ANONYMOUS_DB = "lecta";
const DB_VERSION = 10;
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
  "companionEvents",
  "companionReceipts",
  "lexiconCache",
] as const;

const dbNameFor = (userId: string | null) =>
  userId ? `lecta:u:${userId}` : ANONYMOUS_DB;

let activeUserId: string | null = null;
let dbPromise: Promise<IDBPDatabase<LectaDB>> | null = null;
// Generación de la base activa: aumenta en cada cambio de cuenta, así
// un contexto viejo nunca parece vigente ni siquiera tras un A→B→A.
let dbGeneration = 0;
// A quién absorbió lo anónimo la última migración: un guardado con
// contexto anónimo que llega tarde pertenece a esa cuenta, no al
// espacio ya limpiado.
let anonymousHeir: string | null = null;
// Las transiciones de cuenta se serializan: un cambio que llega con
// una migración en curso espera a que termine — nunca se retargetea
// una migración pendiente a la base de la cuenta nueva.
let transitionPromise: Promise<void> = Promise.resolve();

// Fotografía de qué base estaba activa al iniciar una operación. Las
// operaciones de varios pasos la capturan antes del primer await y la
// pasan por toda la cadena: las escrituras siempre aterrizan en la
// base dueña del contexto y las idas a red abortan si venció.
export type DbScope = Readonly<{ userId: string | null; generation: number }>;

export function captureDbScope(): DbScope {
  return { userId: activeUserId, generation: dbGeneration };
}

export function isDbScopeActive(scope: DbScope): boolean {
  return scope.userId === activeUserId && scope.generation === dbGeneration;
}

// Una llamada remota con contexto vencido aborta con este error; quien
// sincroniza lo traduce a «no se envió». Jamás se empuja nada bajo la
// cuenta recién activada.
export class StaleScopeError extends Error {
  constructor() {
    super("La cuenta activa cambió durante la operación.");
    this.name = "StaleScopeError";
  }
}

export type DbStorageErrorCode = "blocked" | "quota" | "corrupt" | "timeout";

export interface DbStorageError {
  code: DbStorageErrorCode;
  message: string;
}

export function classifyDbError(error: unknown): DbStorageError {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const name = error instanceof Error ? error.name : "";
  const lower = message.toLowerCase();

  if (
    lower.includes("otra pestaña") ||
    lower.includes("blocked") ||
    lower.includes("bloqueada") ||
    name === "VersionError"
  ) {
    return {
      code: "blocked",
      message:
        error instanceof Error && error.message
          ? error.message
          : "La base local está bloqueada por otra pestaña abierta; ciérrala y recarga.",
    };
  }

  if (
    name === "QuotaExceededError" ||
    lower.includes("quota") ||
    lower.includes("cuota") ||
    lower.includes("espacio") ||
    lower.includes("almacenamiento lleno")
  ) {
    return {
      code: "quota",
      message: "Se agotó la cuota de almacenamiento en este dispositivo.",
    };
  }

  if (
    lower.includes("timeout") ||
    lower.includes("tiempo límite") ||
    lower.includes("timed out")
  ) {
    return {
      code: "timeout",
      message: "La conexión con el almacenamiento local tardó demasiado.",
    };
  }

  return {
    code: "corrupt",
    message: message || "Error al acceder a la base de datos local.",
  };
}

// Tope para una apertura bloqueada: si otra pestaña conserva abierta
// una versión vieja, `openDB` queda pendiente para siempre y con él la
// estantería («Preparando tu estantería…» sin fin). Pasado este plazo
// se rechaza y el llamador muestra el error en vez de cargar eterno.
const OPEN_BLOCKED_MS = 8_000;

function openLectaDB(name: string) {
  let gaveUp = false;
  let blockedTimer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<IDBPDatabase<LectaDB>>((resolve, reject) => {
    openDB<LectaDB>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("books"))
          db.createObjectStore("books", { keyPath: "hash" });
        if (!db.objectStoreNames.contains("positions"))
          db.createObjectStore("positions", { keyPath: "bookHash" });
        if (!db.objectStoreNames.contains("session"))
          db.createObjectStore("session");
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
        // El compañero (v9): journal inmutable de premios y recepciones
        // monotónicas (créditos de logro, cofres abiertos, avisos vistos).
        if (!db.objectStoreNames.contains("companionEvents"))
          db.createObjectStore("companionEvents", { keyPath: "id" });
        if (!db.objectStoreNames.contains("companionReceipts"))
          db.createObjectStore("companionReceipts", { keyPath: "id" });
        // Diccionario sin conexión (v10): almacén de fichas del catálogo
        // cacheadas localmente para consulta instantánea offline.
        if (!db.objectStoreNames.contains("lexiconCache"))
          db.createObjectStore("lexiconCache", { keyPath: "key" });
      },
    // Esta conexión quedó vieja y otra pestaña pide el upgrade:
    // cerrarla es lo único que libera al otro lado (event.target es
    // la base; lo que siga usando esta conexión fallará hasta recargar).
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as IDBDatabase).close();
    },
    // Alguien retiene abierta una versión vieja de esta misma base:
    // el reloj evita que la apertura quede pendiente sin respuesta.
    blocked() {
      blockedTimer ??= setTimeout(() => {
        gaveUp = true;
        reject(
          new Error(
            `La base local "${name}" sigue abierta en otra pestaña; ciérrala y recarga.`,
          ),
        );
      }, OPEN_BLOCKED_MS);
    },
  }).then(
    (db) => {
      if (blockedTimer !== undefined) clearTimeout(blockedTimer);
      // Si llegó tarde tras el tope no se entrega una conexión
      // fantasma: se cierra y el llamador ya vio el error.
      if (gaveUp) db.close();
      else resolve(db);
    },
    reject,
  );
  });
}

export function resetDbConnection() {
  dbPromise = null;
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openLectaDB(dbNameFor(activeUserId)).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// Base a la que pertenece un contexto: la activa si sigue vigente; si
// ya venció, la del dueño del contexto — nunca la base recién
// activada. Un contexto anónimo vencido pertenece a la cuenta que lo
// absorbió al iniciar sesión (o al espacio anónimo si no hubo
// migración de por medio).
const scopeDbName = (scope: DbScope) =>
  dbNameFor(
    isDbScopeActive(scope) ? activeUserId : (scope.userId ?? anonymousHeir),
  );

// Resuelve la base para un contexto. La compartida se reutiliza cuando
// el contexto sigue vivo; con contexto vencido se abre una conexión
// privada a la base dueña y el llamador la cierra al terminar.
export async function withDb<T>(
  scope: DbScope | undefined,
  run: (db: IDBPDatabase<LectaDB>) => T | Promise<T>,
): Promise<T> {
  if (!scope || isDbScopeActive(scope)) return run(await getDb());
  const db = await openLectaDB(scopeDbName(scope));
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

export function getActiveUserId() {
  return activeUserId;
}

// Borra por completo la base local de una cuenta (solo tras el correo
// de confirmación del borrado) o la base anónima con null. Cierra la
// conexión viva antes de borrar: sin eso, IndexedDB bloquea el borrado
// en la misma pestaña. Devuelve false si el navegador lo bloqueó o
// falló: quien llama decide si avisa, nunca se finge éxito.
export async function deleteAccountDb(userId: string | null): Promise<boolean> {
  if (activeUserId === userId) {
    if (userId !== null) await setDbUser(null);
    const open = dbPromise;
    dbPromise = null;
    if (open) (await open).close();
  }
  return new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(dbNameFor(userId));
    request.onsuccess = () => resolve(true);
    request.onblocked = () => resolve(false);
    request.onerror = () => resolve(false);
  });
}

// Acción manual de Diagnóstico: cierra la conexión activa y borra el
// DbScope actual (la base de la cuenta o el espacio anónimo).
export async function deleteLocalDb(): Promise<boolean> {
  return deleteAccountDb(activeUserId);
}

// Cambia la base activa según la sesión, serializado: una transición
// que llega con otra en curso espera a que termine. Al iniciar sesión
// migra lo guardado como invitado hacia la cuenta y limpia el espacio
// anónimo, para que otra persona que use el dispositivo no lo reciba.
export async function setDbUser(userId: string | null) {
  const run = transitionPromise.then(() => switchDbUser(userId));
  // La cadena nunca queda rota por una transición fallida: el próximo
  // llamado parte del último estado estable.
  transitionPromise = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function switchDbUser(userId: string | null) {
  if (userId === activeUserId) return;
  activeUserId = userId;
  dbGeneration += 1;
  const previous = dbPromise;
  dbPromise = null;
  if (previous) (await previous).close();
  if (userId) {
    await migrateAnonymousToUser(userId);
    anonymousHeir = userId;
  } else {
    anonymousHeir = null;
  }
}

const newerOf = <T>(a: T, b: T, stamp: (item: T) => number | undefined) =>
  (stamp(b) ?? 0) > (stamp(a) ?? 0) ? b : a;

export interface KnowledgeRecord {
  updatedAt?: number;
  savedAt?: number;
  deleted?: boolean;
  deletedAt?: number | null;
  card?: Card | null;
  contextSnippet?: string | null;
  priority?: boolean | null;
  passiveSeenCount?: number | null;
  [key: string]: unknown;
}

export function mergeKnowledgeRecords<T extends KnowledgeRecord>(
  a: T,
  b: T,
): T {
  const getStamp = (r: KnowledgeRecord) => r.updatedAt ?? r.savedAt ?? 0;
  const [winner, loser] = getStamp(a) >= getStamp(b) ? [a, b] : [b, a];

  // Si la versión más reciente es una lápida de borrado, gana la lápida completa
  if (winner.deletedAt != null || winner.deleted === true) {
    return winner;
  }

  const pickBetterCard = (
    c1: Card | null | undefined,
    c2: Card | null | undefined,
  ): Card | null => {
    if (!c1) return c2 ?? null;
    if (!c2) return c1;
    const r1 = (c1 as { reps?: number }).reps ?? 0;
    const r2 = (c2 as { reps?: number }).reps ?? 0;
    if (r1 !== r2) return r1 > r2 ? c1 : c2;
    const getReviewTime = (c: Card) => {
      const lr =
        (c as { last_review?: unknown; lastReview?: unknown }).last_review ??
        (c as { last_review?: unknown; lastReview?: unknown }).lastReview;
      if (!lr) return 0;
      if (lr instanceof Date) return lr.getTime();
      if (typeof lr === "number") return lr;
      return new Date(String(lr)).getTime() || 0;
    };
    return getReviewTime(c1) >= getReviewTime(c2) ? c1 : c2;
  };

  const merged: T = {
    ...loser,
    ...winner,
    card: pickBetterCard(
      winner.card as Card | undefined,
      loser.card as Card | undefined,
    ) as T["card"],
    contextSnippet: (winner.contextSnippet ?? loser.contextSnippet) as T["contextSnippet"],
    priority: (winner.priority ?? loser.priority) as T["priority"],
  };

  if (winner.passiveSeenCount != null || loser.passiveSeenCount != null) {
    (merged as Record<string, unknown>).passiveSeenCount = Math.max(
      Number(winner.passiveSeenCount) || 0,
      Number(loser.passiveSeenCount) || 0,
    );
  }

  return merged;
}

async function migrateAnonymousToUser(userId: string) {
  // Destino fijo con conexión propia: el traslado escribe en la base
  // de `userId` aunque la cuenta activa cambiara mientras corría.
  const target = await openLectaDB(dbNameFor(userId));
  const anon = await openLectaDB(ANONYMOUS_DB);
  try {
    // El gameState v1 del invitado se sella como baseline ANTES de
    // leer nada: así su foto y el sello de migración viajan con el
    // resto del compañero aunque la cuenta ya estuviera migrada. Es
    // idempotente — si ya corrió no reescribe nada.
    await migrateGameStateV1In(anon);
    const [books, positions, words, annotations, intervals, reviews, knowledge, events, ops, latestHash, companionEvents, companionReceipts, cachedLexicon] =
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
        anon.getAll("companionEvents"),
        anon.getAll("companionReceipts"),
        anon.getAll("lexiconCache"),
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
        ? mergeKnowledgeRecords(word, existing)
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
        ? mergeKnowledgeRecords(word, existing)
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

    // Compañero: sus claves no pasan por isMigratableSessionKey ni por
    // mergeSessionValue — cada colección tiene su propia regla de
    // unión (contratos C y F del plan).
    // Journal y recepciones: anexables por id, como los intervalos.
    for (const event of companionEvents) {
      if (!(await target.get("companionEvents", event.id)))
        await target.put("companionEvents", event);
    }
    for (const receipt of companionReceipts) {
      if (!(await target.get("companionReceipts", receipt.id)))
        await target.put("companionReceipts", receipt);
    }
    // Fichas cacheadas del diccionario local: se trasladan si no existen en la cuenta.
    for (const cached of cachedLexicon) {
      if (!(await target.get("lexiconCache", cached.key)))
        await target.put("lexiconCache", cached);
    }
    // Baselines: unión por originId — son inmutables, así que uno ya
    // presente en la cuenta jamás se reescribe.
    const mergedBaselines = parseCompanionBaselines(
      await target.get("session", COMPANION_BASELINES_KEY),
    );
    let baselinesChanged = false;
    for (const [originId, baseline] of Object.entries(
      parseCompanionBaselines(
        await anon.get("session", COMPANION_BASELINES_KEY),
      ),
    )) {
      if (!mergedBaselines[originId]) {
        mergedBaselines[originId] = baseline;
        baselinesChanged = true;
      }
    }
    if (baselinesChanged)
      await target.put(
        "session",
        JSON.stringify(mergedBaselines),
        COMPANION_BASELINES_KEY,
      );
    // Registros del perfil: misma fusión por sello que en cualquier
    // escritura — gana el (updatedAt, operationId) mayor.
    const anonRegisters = parseCompanionRegisters(
      await anon.get("session", COMPANION_PROFILE_KEY),
    );
    if (anonRegisters.length) {
      const merged = mergeCompanionRegister([
        ...parseCompanionRegisters(
          await target.get("session", COMPANION_PROFILE_KEY),
        ),
        ...anonRegisters,
      ]);
      await target.put(
        "session",
        JSON.stringify(merged),
        COMPANION_PROFILE_KEY,
      );
    }
    // Llaves sueltas: solo si la cuenta no tiene las suyas. El
    // gameState v1 y el «companion» viejo son inertes tras el sello
    // pero se conservan; el sello de migración y las preferencias de
    // dispositivo tampoco se pisan.
    for (const key of [
      COMPANION_DEVICE_PREFS_KEY,
      COMPANION_MIGRATION_KEY,
      GAME_STATE_KEY,
      GAME_KEY,
    ]) {
      const incoming = await anon.get("session", key);
      if (
        typeof incoming === "string" &&
        (await target.get("session", key)) === undefined
      )
        await target.put("session", incoming, key);
    }

    // La limpieza anónima va dentro del try: si el traslado falla a
    // la mitad, lo guardado como invitado se conserva para el próximo
    // intento en vez de quedar borrado a medias.
    const cleanup = anon.transaction([...ALL_STORES], "readwrite");
    await Promise.all([
      ...ALL_STORES.map((store) => cleanup.objectStore(store).clear()),
      cleanup.done,
    ]);
  } finally {
    anon.close();
    target.close();
  }
}

export type BackupRestoreResult = {
  booksRestored: number;
  positionsRestored: number;
  wordsRestored: number;
  annotationsRestored: number;
  activityRestored: number;
  reviewsRestored: number;
  knowledgeRestored: number;
};

export const MAX_BACKUP_WORDS = 50_000;
export const MAX_BACKUP_ANNOTATIONS = 25_000;
export const MAX_BACKUP_POSITIONS = 5_000;
export const MAX_BACKUP_ACTIVITY = 25_000;
export const MAX_BACKUP_REVIEWS = 50_000;
export const MAX_BACKUP_KNOWLEDGE = 100_000;

export const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

export function validateBackupPayloadStrict(data: {
  books?: Array<{
    hash: string;
    name?: string;
    addedAt?: number;
    title?: string;
    author?: string;
    language?: string;
    sectionCount?: number;
    metaVersion?: number;
  }>;
  positions?: SavedBookPosition[];
  words?: SavedWord[];
  annotations?: SavedAnnotation[];
  activity?: SavedInterval[];
  reviews?: SavedReview[];
  knowledge?: KnownWord[];
  events?: ReadingEvent[];
  companionEvents?: GameJournalEvent[];
  companionReceipts?: CompanionReceipt[];
  session?: Record<string, string>;
}): void {
  if (
    (data.words?.length ?? 0) > MAX_BACKUP_WORDS ||
    (data.annotations?.length ?? 0) > MAX_BACKUP_ANNOTATIONS ||
    (data.positions?.length ?? 0) > MAX_BACKUP_POSITIONS ||
    (data.activity?.length ?? 0) > MAX_BACKUP_ACTIVITY ||
    (data.reviews?.length ?? 0) > MAX_BACKUP_REVIEWS ||
    (data.knowledge?.length ?? 0) > MAX_BACKUP_KNOWLEDGE
  ) {
    throw new Error("El respaldo excede el límite máximo de registros permitido");
  }

  if (Array.isArray(data.books)) {
    for (const book of data.books) {
      if (book?.hash && !SHA256_HEX_RE.test(book.hash)) {
        throw new Error(`El respaldo contiene un hash de libro inválido: "${book.hash}"`);
      }
    }
  }

  if (Array.isArray(data.positions)) {
    for (const pos of data.positions) {
      if (pos?.bookHash && !SHA256_HEX_RE.test(pos.bookHash)) {
        throw new Error(`El respaldo contiene un bookHash de posición inválido: "${pos.bookHash}"`);
      }
    }
  }

  if (Array.isArray(data.annotations)) {
    for (const ann of data.annotations) {
      if (ann?.bookHash && !SHA256_HEX_RE.test(ann.bookHash)) {
        throw new Error(`El respaldo contiene un bookHash de anotación inválido: "${ann.bookHash}"`);
      }
    }
  }

  if (Array.isArray(data.words)) {
    for (const word of data.words) {
      const wordStr =
        word.form ?? (word as unknown as { word?: string }).word;
      if (typeof wordStr !== "string" || wordStr.trim().length === 0 || wordStr.length > 200) {
        throw new Error("El respaldo contiene una palabra esencial con formato inválido o vacía");
      }
      const updatedAt = word.updatedAt ?? word.savedAt;
      if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt <= 0) {
        throw new Error(`El respaldo contiene una palabra ("${wordStr}") con fecha de actualización inválida`);
      }
      if (word.card !== undefined && word.card !== null && !isFsrsCardShape(word.card)) {
        throw new Error(`El respaldo contiene una tarjeta FSRS inválida en la palabra "${wordStr}"`);
      }
    }
  }

  if (Array.isArray(data.reviews)) {
    for (const review of data.reviews) {
      const revObj = review as unknown as { card?: unknown; fsrsCard?: unknown };
      const card = revObj.card ?? revObj.fsrsCard;
      if (card !== undefined && card !== null && !isFsrsCardShape(card)) {
        throw new Error(`El respaldo contiene una tarjeta FSRS inválida en el repaso "${review.id ?? ""}"`);
      }
    }
  }
}

export async function restoreBackupToDb(
  data: {
    books?: Array<{
      hash: string;
      name: string;
      addedAt?: number;
      title?: string;
      author?: string;
      language?: string;
      sectionCount?: number;
      metaVersion?: number;
    }>;
    positions?: SavedBookPosition[];
    words?: SavedWord[];
    annotations?: SavedAnnotation[];
    activity?: SavedInterval[];
    reviews?: SavedReview[];
    knowledge?: KnownWord[];
    events?: ReadingEvent[];
    companionEvents?: GameJournalEvent[];
    companionReceipts?: CompanionReceipt[];
    session?: Record<string, string>;
  },
  scope?: DbScope,
): Promise<BackupRestoreResult> {
  validateBackupPayloadStrict(data);
  const bound = scope ?? captureDbScope();
  return withDb(bound, async (target) => {
    let booksRestored = 0;
    let positionsRestored = 0;
    let wordsRestored = 0;
    let annotationsRestored = 0;
    let activityRestored = 0;
    let reviewsRestored = 0;
    let knowledgeRestored = 0;

    if (Array.isArray(data.books)) {
      for (const book of data.books) {
        if (!book?.hash) continue;
        const rawExisting = await target.get("books", book.hash);
        const existing = rawExisting ? normalizeStoredBookRecord(rawExisting) : undefined;
        if (existing) {
          if (existing.data && existing.data.size > 0) {
            // Si ya existe el libro localmente con data.size > 0, conserva su binario
            // y actualiza solo metadatos si el respaldo es más reciente o si faltaban datos.
            const backupTime = book.addedAt ?? 0;
            const existingTime = existing.addedAt ?? 0;
            if (backupTime >= existingTime || !existing.title) {
              await target.put("books", {
                ...existing,
                title: book.title ?? existing.title,
                author: book.author ?? existing.author,
                language: book.language ?? existing.language,
                sectionCount: book.sectionCount ?? existing.sectionCount,
                metaVersion: book.metaVersion ?? existing.metaVersion,
                name: book.name ?? existing.name,
              });
              booksRestored++;
            }
          } else {
            // Si existía un registro previo corrupto de 0 bytes, se remueve de books
            await target.delete("books", book.hash);
          }
        }
      }
    }

    if (Array.isArray(data.positions)) {
      for (const position of data.positions) {
        if (!position?.bookHash) continue;
        const existing = await target.get("positions", position.bookHash);
        const merged = existing
          ? newerOf(existing, position, (item) => item.updatedAt)
          : position;
        await target.put("positions", merged);
        positionsRestored++;
      }
    }

    if (Array.isArray(data.words)) {
      for (const word of data.words) {
        if (!word?.key) continue;
        const existing = await target.get("savedWords", word.key);
        const merged = existing
          ? newerOf(existing, word, (item) => item.updatedAt ?? item.savedAt)
          : word;
        await target.put("savedWords", merged);
        wordsRestored++;
      }
    }

    if (Array.isArray(data.annotations)) {
      for (const annotation of data.annotations) {
        if (!annotation?.key) continue;
        const existing = await target.get("annotations", annotation.key);
        const merged = existing
          ? newerOf(existing, annotation, (item) => item.updatedAt)
          : annotation;
        await target.put("annotations", merged);
        annotationsRestored++;
      }
    }

    if (Array.isArray(data.activity)) {
      for (const interval of data.activity) {
        if (!interval?.id) continue;
        if (!(await target.get("activity", interval.id))) {
          await target.put("activity", interval);
          activityRestored++;
        }
      }
    }

    if (Array.isArray(data.reviews)) {
      for (const review of data.reviews) {
        if (!review?.id) continue;
        if (!(await target.get("reviews", review.id))) {
          await target.put("reviews", review);
          reviewsRestored++;
        }
      }
    }

    if (Array.isArray(data.knowledge)) {
      for (const item of data.knowledge) {
        if (!item?.key) continue;
        const existing = await target.get("knowledge", item.key);
        const merged = existing
          ? newerOf(existing, item, (k) => k.updatedAt)
          : item;
        await target.put("knowledge", merged);
        knowledgeRestored++;
      }
    }

    if (Array.isArray(data.events)) {
      for (const event of data.events) {
        if (!event?.id) continue;
        if (!(await target.get("readingEvents", event.id))) {
          await target.put("readingEvents", event);
        }
      }
    }

    if (Array.isArray(data.companionEvents)) {
      for (const event of data.companionEvents) {
        if (!event?.id) continue;
        if (!(await target.get("companionEvents", event.id))) {
          await target.put("companionEvents", event);
        }
      }
    }

    if (Array.isArray(data.companionReceipts)) {
      for (const receipt of data.companionReceipts) {
        if (!receipt?.id) continue;
        if (!(await target.get("companionReceipts", receipt.id))) {
          await target.put("companionReceipts", receipt);
        }
      }
    }

    if (data.session && typeof data.session === "object") {
      for (const [key, incoming] of Object.entries(data.session)) {
        if (typeof incoming !== "string") continue;
        const existing = await target.get("session", key);
        const merged = mergeSessionValue(existing, incoming);
        if (merged !== existing) await target.put("session", merged, key);
      }
    }

    return {
      booksRestored,
      positionsRestored,
      wordsRestored,
      annotationsRestored,
      activityRestored,
      reviewsRestored,
      knowledgeRestored,
    };
  });
}

export type SaveBookInput =
  | StoredBookRecord
  | {
      id: string;
      title: string;
      author?: string;
      addedAt?: number;
      data: StoredBookBinary;
      language?: string;
      sectionCount?: number;
      cover?: Blob;
      metaVersion?: number;
      name?: string;
      hash?: string;
    };

export function normalizeStoredBookRecord(record: StoredBookRecord): StoredBook {
  return {
    ...record,
    data:
      record.data instanceof Blob
        ? record.data
        : new Blob([record.data as unknown as BlobPart], { type: "application/epub+zip" }),
  };
}

export function normalizeStoredBook(
  book: StoredBookRecord | StoredBook | undefined,
): StoredBook | undefined {
  if (!book) return book;
  return normalizeStoredBookRecord(book);
}

export async function saveBook(book: SaveBookInput, scope?: DbScope): Promise<StoredBook> {
  if (typeof navigator !== "undefined" && navigator.storage?.persist) {
    void navigator.storage.persist().catch(() => false);
  }
  const rawData = book.data;
  // Convertimos a ArrayBuffer para almacenamiento persistente 100% seguro y compatible
  // en todos los motores de base de datos (evita el bug crítico de WebKit/Safari con Blobs en IndexedDB).
  let buffer: ArrayBuffer;
  if (rawData instanceof ArrayBuffer) {
    buffer = rawData;
  } else if (ArrayBuffer.isView(rawData)) {
    const view = rawData as Uint8Array;
    buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  } else if (rawData instanceof Blob) {
    buffer = await rawData.arrayBuffer();
  } else {
    buffer = new ArrayBuffer(0);
  }

  const hash = ("hash" in book && book.hash ? book.hash : ("id" in book ? book.id : "")) || "";
  const name = ("name" in book && book.name ? book.name : ("title" in book && book.title ? book.title : "")) || "";
  const title = "title" in book ? book.title : undefined;
  const author = "author" in book ? book.author : undefined;
  const addedAt = "addedAt" in book && book.addedAt ? book.addedAt : Date.now();
  const language = "language" in book ? book.language : undefined;
  const sectionCount = "sectionCount" in book ? book.sectionCount : undefined;
  const cover = "cover" in book ? book.cover : undefined;
  const metaVersion = "metaVersion" in book ? book.metaVersion : undefined;

  const stored: StoredBookRecord = {
    hash,
    name,
    title,
    author,
    addedAt,
    language,
    sectionCount,
    cover,
    metaVersion,
    data: buffer,
  };

  return withDb(scope, async (db) => {
    const transaction = db.transaction(["books", "session"], "readwrite");
    await Promise.all([
      transaction.objectStore("books").put(stored),
      transaction.objectStore("session").put(stored.hash, SESSION_KEY),
      transaction.done,
    ]);
    return normalizeStoredBookRecord(stored);
  });
}

export async function loadLatestBook(scope?: DbScope): Promise<StoredBook | undefined> {
  return withDb(scope, async (db) => {
    const hash = await db.get("session", SESSION_KEY);
    if (!hash) return undefined;
    const record = await db.get("books", hash);
    return record ? normalizeStoredBookRecord(record) : undefined;
  });
}

export async function loadLatestBookHash(scope?: DbScope) {
  return withDb(scope, (db) => db.get("session", SESSION_KEY));
}

export async function listStoredBooks(scope?: DbScope): Promise<StoredBook[]> {
  return withDb(scope, async (db) => {
    const books = await db.getAll("books");
    return books.map(normalizeStoredBookRecord);
  });
}

export async function listBooks(scope?: DbScope): Promise<Array<{ id: string; title: string; author?: string }>> {
  const books = await listStoredBooks(scope);
  return books.map((b) => ({
    id: b.hash,
    title: b.title || b.name,
    author: b.author,
  }));
}

export async function getStoredBook(hash: string, scope?: DbScope): Promise<StoredBook | undefined> {
  return withDb(scope, async (db) => {
    const record = await db.get("books", hash);
    return record ? normalizeStoredBookRecord(record) : undefined;
  });
}

export async function getBookData(id: string, scope?: DbScope): Promise<ArrayBuffer | null> {
  const book = await getStoredBook(id, scope);
  if (!book?.data) return null;
  return book.data.arrayBuffer();
}

// Guarda los metadatos del EPUB (título, autor, portada) sin tocar el
// archivo; metaVersion evita releer libros cuyo intento ya falló.
export async function updateBookMeta(
  hash: string,
  meta: Pick<StoredBook, "title" | "author" | "language" | "sectionCount" | "cover" | "metaVersion">,
  scope?: DbScope,
) {
  return withDb(scope, async (db) => {
    const book = await db.get("books", hash);
    if (!book) return;
    await db.put("books", { ...book, ...meta });
  });
}

export async function listPositions(scope?: DbScope) {
  return withDb(scope, (db) => db.getAll("positions"));
}

export async function saveBookPosition(position: SavedBookPosition, scope?: DbScope) {
  return withDb(scope, (db) => db.put("positions", position));
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

export async function listReadingDays(scope?: DbScope) {
  return withDb(scope, async (db) =>
    parseReadingDays(await db.get("session", READ_DAYS_KEY)),
  );
}

export interface ShelfBootstrapData {
  positions: SavedBookPosition[];
  savedWords: SavedWord[];
  latestHash?: string;
  readingDays: number[];
  intervals: SavedInterval[];
  rawGoal?: string;
}

// Carga atómica en una sola transacción readonly de los datos necesarios
// para montar la estantería (posiciones, palabras, hash reciente, días de lectura,
// intervalos y meta semanal). Reduce drásticamente los viajes a IndexedDB.
export async function loadShelfBootstrap(scope?: DbScope): Promise<ShelfBootstrapData> {
  return withDb(scope, async (db) => {
    const tx = db.transaction(["positions", "savedWords", "session", "activity"], "readonly");
    const [positions, savedWords, latestHash, rawDays, intervals, rawGoal] = await Promise.all([
      tx.objectStore("positions").getAll(),
      tx.objectStore("savedWords").getAll(),
      tx.objectStore("session").get(SESSION_KEY),
      tx.objectStore("session").get(READ_DAYS_KEY),
      tx.objectStore("activity").getAll(),
      tx.objectStore("session").get("readingGoal:v1"),
    ]);
    await tx.done;
    return {
      positions,
      savedWords: (savedWords as SavedWord[]).filter((w) => !w.deleted),
      latestHash: typeof latestHash === "string" ? latestHash : undefined,
      readingDays: parseReadingDays(typeof rawDays === "string" ? rawDays : undefined),
      intervals: intervals as SavedInterval[],
      rawGoal: typeof rawGoal === "string" ? rawGoal : undefined,
    };
  });
}

// Pequeños valores por cuenta (velocidad de lectura medida, etc.).
export async function saveSessionValue(key: string, value: string, scope?: DbScope) {
  return withDb(scope, (db) => db.put("session", value, key));
}

export async function loadSessionValue(key: string, scope?: DbScope) {
  return withDb(scope, (db) => db.get("session", key));
}

export const PSYCHOMETRIC_PROFILE_SESSION_KEY = "lecta:psychometric_profile:v1";

export async function savePsychometricProfile(
  profile: PsychometricProfileRecord,
  scope?: DbScope,
): Promise<void> {
  await withDb(scope, (db) =>
    db.put("session", JSON.stringify(profile), PSYCHOMETRIC_PROFILE_SESSION_KEY),
  );
}

export async function loadPsychometricProfile(
  scope?: DbScope,
): Promise<PsychometricProfileRecord | null> {
  return withDb(scope, async (db) => {
    const raw = await db.get("session", PSYCHOMETRIC_PROFILE_SESSION_KEY);
    if (!raw || typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as PsychometricProfileRecord;
    } catch {
      return null;
    }
  });
}

export async function listSessionKeys(scope?: DbScope): Promise<string[]> {
  return withDb(scope, async (db) =>
    (await db.getAllKeys("session")).filter(
      (key): key is string => typeof key === "string",
    ),
  );
}

// ¿La cuenta tiene alguna evidencia de aprendizaje? (palabras en el
// Cuaderno, conocimiento declarado/inferido o una preparación ya
// registrada — la calibración también escribe knowledge, así queda
// cubierta). La primera hoja «Antes de leer» de una cuenta sin
// nada de esto pide trabajo a ciegas: por eso existe la consulta.
export async function hasAnyLearningHistory(scope?: DbScope): Promise<boolean> {
  return withDb(scope, async (db) => {
    const [words, knowledge, sessionKeys] = await Promise.all([
      db.count("savedWords"),
      db.count("knowledge"),
      db.getAllKeys("session"),
    ]);
    if (words > 0 || knowledge > 0) return true;
    return sessionKeys.some(
      (key) => typeof key === "string" && key.startsWith("preparation:v1:"),
    );
  });
}

// ---------- Ciclo de vida del store session ----------

// Claves de session que viajan anónimo→cuenta y al respaldo. Los
// formatos los congelan preparation.ts (`preparation:v1:<hash>:`,
// `bookStart:v1:<hash>`) y calibration.ts (`calibrationDone`); aquí
// van literales porque esos módulos ya importan idb (un import de
// vuelta crearía un ciclo). Los sellos de sync, el ajuste de auth y
// claves arbitrarias NO migran: no son datos del lector.
export const CHAPTER_FOLLOW_PREFIX = "chapterFollow:v1:";
const SESSION_MIGRATABLE_PREFIXES = ["preparation:v1:", "bookStart:v1:", CHAPTER_FOLLOW_PREFIX] as const;

export function isMigratableSessionKey(key: string): boolean {
  return (
    key === "calibrationDone" ||
    key === "calibrationDraft" ||
    key === "readingGoal:v1" ||
    key === "lecta:retention_horizon:v1" ||
    key === "learnExposure:v1" ||
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

// Claves de session que pertenecen a un libro: su inicio elegido,
// todas sus preparaciones y el análisis de vocabulario que alimenta
// la insignia de cobertura. El prefijo lleva dos puntos tras el hash —
// «abc» no borra lo de «abc2».
export function isBookScopedSessionKey(bookHash: string, key: string): boolean {
  return (
    key === `bookStart:v1:${bookHash}` ||
    key === `bookVocab:v1:${bookHash}` ||
    key.startsWith(`preparation:v1:${bookHash}:`) ||
    key.startsWith(`${CHAPTER_FOLLOW_PREFIX}${encodeURIComponent(bookHash)}:`)
  );
}

export async function loadBookPosition(bookHash: string, scope?: DbScope) {
  return withDb(scope, (db) => db.get("positions", bookHash));
}

export function wordKey(language: string, form: string) {
  return `${language}:${form.toLowerCase()}`;
}

export async function saveWord(
  word: Omit<SavedWord, "key" | "savedAt">,
  scope?: DbScope,
) {
  return withDb(scope, async (db) => {
    const now = Date.now();
    const entry: SavedWord = {
      ...word,
      key: wordKey(word.language, word.form),
      savedAt: now,
      updatedAt: now,
    };
    await db.put("savedWords", entry);
    return entry;
  });
}

// Guardar una palabra y su evidencia «aún no la sé» son un solo acto:
// van en una transacción para que nunca quede la palabra sin la señal
// (o al revés). La palabra se fusiona con lo que ya haya (regla de
// mergePreparationWord): una activa conserva tarjeta, acepción,
// contexto y fechas — volver a guardarla jamás reinicia su repaso;
// una lápida se restaura rellenando solo los huecos. Devuelve la fila
// de conocimiento vigente — si ya decía lo mismo con una fuente igual
// o más fuerte no se reescribe (mergeKnowledgeWrite) y se devuelve la
// existente.
export async function saveWordWithKnowledge(input: {
  word: Omit<SavedWord, "key" | "savedAt">;
  knowledge: Omit<KnownWord, "key" | "updatedAt">;
}, scope?: DbScope): Promise<{ word: SavedWord; knowledge: KnownWord | null }> {
  return withDb(scope, async (db) => {
    const now = Date.now();
    const tx = db.transaction(["savedWords", "knowledge"], "readwrite");
    const wordsStore = tx.objectStore("savedWords");
    const existing = await wordsStore.get(
      wordKey(input.word.language, input.word.form),
    );
    const knowledgeStore = tx.objectStore("knowledge");
    const existingKnowledge = await knowledgeStore.get(
      knowledgeKey(input.knowledge.language, input.knowledge.lemma),
    );
    const next = mergeKnowledgeWrite(existingKnowledge, input.knowledge, now);
    const merged = mergePreparationWord(existing, input.word, now);
    if (merged) await wordsStore.put(merged);
    if (next) await knowledgeStore.put(next);
    await tx.done;
    // Palabra activa sin cambios: la vigente es la ya guardada.
    return {
      word: merged ?? (existing as SavedWord),
      knowledge: next ?? existingKnowledge ?? null,
    };
  });
}

// Rellena campos léxicos vacíos de una palabra guardada, con la fila
// releída en el momento de escribir: ausente, lápida, ya con
// significado o cambiada desde el sello esperado → no toca nada y
// devuelve null. Así una respuesta de catálogo tardía no revive un
// borrado ni pisa un repaso ocurrido durante la consulta. Solo se
// escriben los campos autorizados que estén vacíos; tarjeta,
// contexto y savedAt quedan como estaban y updatedAt se renueva.
export async function fillSavedWordMeaning(
  key: string,
  expectedStamp: number | undefined,
  patch: Pick<
    SavedWord,
    "meaning" | "lemma" | "pos" | "senseEntryId" | "senseOrder"
  >,
  scope?: DbScope,
): Promise<SavedWord | null> {
  return withDb(scope, async (db) => {
    // Lectura y escritura en la misma transacción: ningún repaso ni
    // borrado puede colarse entre el chequeo del sello y el put.
    const tx = db.transaction("savedWords", "readwrite");
    const store = tx.objectStore("savedWords");
    const word = await store.get(key);
    if (!word || word.deleted) return null;
    if (word.meaning?.trim()) return null;
    if ((word.updatedAt ?? 0) !== (expectedStamp ?? 0)) return null;
    const updated: SavedWord = {
      ...word,
      meaning: word.meaning ?? patch.meaning,
      lemma: word.lemma ?? patch.lemma,
      pos: word.pos ?? patch.pos,
      senseEntryId: word.senseEntryId ?? patch.senseEntryId,
      senseOrder: word.senseOrder ?? patch.senseOrder,
      updatedAt: Date.now(),
    };
    await store.put(updated);
    await tx.done;
    return updated;
  });
}

export async function loadSavedWord(language: string, form: string, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const word = await db.get("savedWords", wordKey(language, form));
    return word?.deleted ? undefined : word;
  });
}

// Palabras visibles (sin lápidas). Para sincronización usa
// listAllSavedWords, que incluye los borrados pendientes de propagar.
export async function listSavedWords(language?: string, scope?: DbScope) {
  const all = await listAllSavedWords(language, scope);
  return all.filter((word) => !word.deleted);
}

export async function listAllSavedWords(language?: string, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const all = await db.getAll("savedWords");
    return language ? all.filter((word) => word.language === language) : all;
  });
}

// Borrado lógico: queda una lápida con updatedAt nuevo para que la
// sincronización propague el borrado incluso si se hizo sin conexión.
export async function removeSavedWord(key: string, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const word = await db.get("savedWords", key);
    if (!word) return undefined;
    const tombstone = { ...word, deleted: true, updatedAt: Date.now() };
    await db.put("savedWords", tombstone);
    return tombstone;
  });
}

export async function putSavedWord(word: SavedWord, scope?: DbScope) {
  return withDb(scope, (db) => db.put("savedWords", word));
}

export async function updateSavedWord(word: SavedWord, scope?: DbScope) {
  return withDb(scope, (db) => {
    const updated = { ...word, updatedAt: Date.now() };
    return db.put("savedWords", updated).then(() => updated);
  });
}

const annotationKey = (bookHash: string, id: string) => `${bookHash}:${id}`;

export async function saveAnnotation(
  input: Omit<SavedAnnotation, "key" | "createdAt" | "updatedAt">,
  scope?: DbScope,
) {
  return withDb(scope, async (db) => {
    const now = Date.now();
    const entry: SavedAnnotation = {
      ...input,
      key: annotationKey(input.bookHash, input.id),
      createdAt: now,
      updatedAt: now,
    };
    await db.put("annotations", entry);
    return entry;
  });
}

export async function listAnnotations(bookHash?: string, scope?: DbScope) {
  const all = await listAllAnnotations(bookHash, scope);
  return all.filter((annotation) => !annotation.deleted);
}

// Incluye lápidas: la sincronización necesita propagar los borrados.
export async function listAllAnnotations(bookHash?: string, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const all = await db.getAll("annotations");
    return bookHash ? all.filter((item) => item.bookHash === bookHash) : all;
  });
}

export async function removeAnnotation(key: string, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const item = await db.get("annotations", key);
    if (!item) return undefined;
    const tombstone = { ...item, deleted: true, updatedAt: Date.now() };
    await db.put("annotations", tombstone);
    return tombstone;
  });
}

export async function putAnnotation(annotation: SavedAnnotation, scope?: DbScope) {
  return withDb(scope, (db) => db.put("annotations", annotation));
}

// Guarda un intervalo de lectura y sella cada día local que toca
// (uno que cruza medianoche cuenta en ambos días). El recorrido usa
// setDate para respetar días de 23/25 h en cambio de horario.
export async function saveReadingInterval(interval: SavedInterval, scope?: DbScope) {
  return withDb(scope, async (db) => {
    await db.put("activity", interval);
    const cursor = new Date(interval.startedAt);
    cursor.setHours(0, 0, 0, 0);
    const lastDay = new Date(interval.endedAt);
    lastDay.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= lastDay.getTime()) {
      await recordReadingDay(db, cursor.getTime() + 60_000);
      cursor.setDate(cursor.getDate() + 1);
    }
  });
}

// Inserta solo los intervalos que faltan por id (llegada del servidor).
// Devuelve cuántos eran nuevos.
export async function putMissingIntervals(intervals: SavedInterval[], scope?: DbScope) {
  return withDb(scope, async (db) => {
    let added = 0;
    for (const interval of intervals) {
      if (!(await db.get("activity", interval.id))) {
        await db.put("activity", interval);
        added += 1;
      }
    }
    return added;
  });
}

export async function listIntervals(scope?: DbScope) {
  return withDb(scope, (db) => db.getAll("activity"));
}

// Guarda un repaso; si no trae id se genera uno (uuid) como hace el
// lector al cerrar intervalos.
export async function saveReview(
  review: Omit<SavedReview, "id"> & { id?: string },
  scope?: DbScope,
) {
  return withDb(scope, async (db) => {
    const entry: SavedReview = { ...review, id: review.id ?? crypto.randomUUID() };
    await db.put("reviews", entry);
    return entry;
  });
}

// Inserta solo los repasos que faltan por id (llegada del servidor).
// Devuelve cuántos eran nuevos.
export async function putReviews(reviews: SavedReview[], scope?: DbScope) {
  return withDb(scope, async (db) => {
    let added = 0;
    for (const review of reviews) {
      if (!(await db.get("reviews", review.id))) {
        await db.put("reviews", review);
        added += 1;
      }
    }
    return added;
  });
}

export async function listAllReviews(scope?: DbScope) {
  return withDb(scope, (db) => db.getAll("reviews"));
}

// ---------- Trayecto de lectura (local, no sincronizado) ----------

// Inserta un evento tal cual; son inmutables y deduplicables por id.
export async function putReadingEvent(event: ReadingEvent, scope?: DbScope) {
  return withDb(scope, (db) => db.put("readingEvents", event));
}

export async function listReadingEvents(bookHash?: string, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const all = await db.getAll("readingEvents");
    const filtered = bookHash ? all.filter((e) => e.bookHash === bookHash) : all;
    return filtered.sort((a, b) => a.createdAt - b.createdAt);
  });
}

// Poda por antigüedad: el historial es diagnóstico reciente, no
// archivo permanente. Devuelve cuántos eventos se borraron.
export async function pruneReadingEvents(olderThan: number, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const all = await db.getAll("readingEvents");
    const stale = all.filter((e) => e.createdAt < olderThan);
    for (const event of stale) await db.delete("readingEvents", event.id);
    return stale.length;
  });
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
  scope?: DbScope,
) {
  return withDb(scope, async (db) => {
    const key = knowledgeKey(input.language, input.lemma);
    const existing = await db.get("knowledge", key);
    const now = input.updatedAt ?? Date.now();
    const next = mergeKnowledgeWrite(existing, input, now);
    if (next) await db.put("knowledge", next);
    // mergeKnowledgeWrite solo devuelve null habiendo fila previa.
    return (next ?? existing) as KnownWord;
  });
}

// Evidencia visible (sin lápidas). Para sincronización usa
// listAllKnowledge, que incluye los borrados pendientes de propagar.
export async function listKnowledge(language?: string, scope?: DbScope) {
  const all = await listAllKnowledge(language, scope);
  return all.filter((word) => !word.deleted);
}

export async function listAllKnowledge(language?: string, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const all = await db.getAll("knowledge");
    return language ? all.filter((word) => word.language === language) : all;
  });
}

// Borrado lógico, igual que removeSavedWord: la lápida con sello nuevo
// propaga el borrado incluso si se hizo sin conexión.
export async function removeKnowledge(key: string, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const word = await db.get("knowledge", key);
    if (!word) return undefined;
    const tombstone = { ...word, deleted: true, updatedAt: Date.now() };
    await db.put("knowledge", tombstone);
    return tombstone;
  });
}

// Inserta la fila tal cual llegó (sincronización): no toca updatedAt.
export async function putKnowledge(word: KnownWord, scope?: DbScope) {
  return withDb(scope, (db) => db.put("knowledge", word));
}

export async function updateAnnotation(annotation: SavedAnnotation, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const updated = { ...annotation, updatedAt: Date.now() };
    await db.put("annotations", updated);
    return updated;
  });
}

// Borra el archivo, su posición guardada, la elección de inicio, los
// registros de preparación y el trayecto del libro, y la referencia
// de último libro si apuntaba a este. Las anotaciones quedan como
// lápidas para que la sincronización propague el borrado a otros
// dispositivos.
export async function deleteStoredBook(hash: string, scope?: DbScope) {
  return withDb(scope, async (db) => {
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
  });
}

// ---------- Cola de operaciones de libro ----------

// Encola una operación de libro (subida o borrado remoto) para
// procesarla con runBookQueue; si no llega id se genera uno (uuid).
export async function enqueueBookOp(
  op: Omit<BookOp, "id" | "createdAt"> & { id?: string },
  scope?: DbScope,
) {
  return withDb(scope, async (db) => {
    const entry: BookOp = {
      ...op,
      id: op.id ?? crypto.randomUUID(),
      createdAt: Date.now(),
    };
    await db.put("bookOps", entry);
    return entry;
  });
}

export async function listBookOps(scope?: DbScope) {
  return withDb(scope, (db) => db.getAll("bookOps"));
}

export async function removeBookOp(id: string, scope?: DbScope) {
  return withDb(scope, (db) => db.delete("bookOps", id));
}

// Anota el último error sin sacar la op de la cola: se reintenta en la
// próxima corrida y el mensaje queda para diagnóstico.
export async function markBookOpError(id: string, message: string, scope?: DbScope) {
  return withDb(scope, async (db) => {
    const op = await db.get("bookOps", id);
    if (!op) return;
    await db.put("bookOps", { ...op, lastError: message });
  });
}

// --- Preparación «Antes de leer» -------------------------------------

// Pesos de la fuente de evidencia (definidos en reading-data para
// reutilizarlos en el resolvedor de alias): lo inferido por actos
// pesa menos que el guardado en el Cuaderno y mucho menos que una
// respuesta explícita (calibración, «ya la conozco», preparación).
const SOURCE_STRENGTH: Record<string, number> = KNOWLEDGE_SOURCE_STRENGTH;

// Fila de `knowledge` a escribir por una evidencia nueva.
// `null` = nada que escribir. El arbitraje es el orden convergente
// knowledgeArbWins (reading-data compartido): la fuente débil jamás
// deshace una explícita —ni siquiera si su reloj va adelante— y una
// lápida compite como acto explícito, así que una inferencia nueva no
// resucita lo borrado pero una respuesta explícita sí. La única
// omisión extra es la escritura redundante —mismo veredicto y misma
// fuerza en fila viva—, que solo movería el sello.
export function mergeKnowledgeWrite(
  existing: KnownWord | undefined,
  row: Omit<KnownWord, "key" | "updatedAt">,
  now: number,
): KnownWord | null {
  if (existing) {
    // Si la entrada trae un cambio explícito en campos de inferencia pasiva:
    const statusChanged =
      row.status !== undefined && row.status !== existing.status;
    const passiveChanged =
      row.passiveSeenCount !== undefined &&
      row.passiveSeenCount !== existing.passiveSeenCount;
    const probChanged =
      row.estimatedKnownProb !== undefined &&
      row.estimatedKnownProb !== existing.estimatedKnownProb;

    // Sin cambio semántico no se mueve el sello: misma fuerza y mismo
    // veredicto en fila viva solo generaría ruido de sincronización.
    const noChange =
      !existing.deleted &&
      existing.known === row.known &&
      !statusChanged &&
      !passiveChanged &&
      !probChanged &&
      (SOURCE_STRENGTH[row.source] ?? 0) ===
        (SOURCE_STRENGTH[existing.source] ?? 0);
    if (noChange) return null;
    // Arbitraje convergente: el mismo orden que el sync y el servidor.
    // La lápida compite con peso explícito: una inferencia posterior
    // no resucita lo que el usuario borró; una respuesta explícita sí.
    if (
      !knowledgeArbWins({ ...row, deleted: row.deleted ?? false, updatedAt: now }, existing)
    )
      return null;
  }
  const out: KnownWord = {
    ...row,
    key: existing?.key ?? knowledgeKey(row.language, row.lemma),
    updatedAt: now,
  };
  const count = row.passiveSeenCount ?? existing?.passiveSeenCount;
  if (count !== undefined) out.passiveSeenCount = count;
  const prob = row.estimatedKnownProb ?? existing?.estimatedKnownProb;
  if (prob !== undefined) out.estimatedKnownProb = prob;
  const status = row.status ?? existing?.status;
  if (status !== undefined) out.status = status;
  return out;
}

export async function recordPassiveExposure(
  language: string,
  lemma: string,
  scope?: DbScope,
): Promise<KnownWord> {
  return withDb(scope, async (db) => {
    const key = knowledgeKey(language, lemma);
    const existing = await db.get("knowledge", key);
    // Una inferencia pasiva jamás revive lo que el lector borró
    // (misma regla que mergeKnowledgeWrite): la lápida queda intacta.
    if (existing?.deleted) return existing;
    const count = (existing?.passiveSeenCount ?? 0) + 1;
    const currentProb = existing?.estimatedKnownProb ?? 0;
    const nextProb = 1 - (1 - currentProb) * 0.82;
    const status: "unknown" | "familiar" | "known" =
      existing?.known
        ? "known"
        : count >= 3
          ? "familiar"
          : (existing?.status ?? "unknown");
    const now = Date.now();
    const updated: KnownWord = {
      key,
      language,
      lemma: lemma.toLowerCase(),
      known: existing?.known ?? (status === "known"),
      source: existing?.source ?? "inferred",
      updatedAt: now,
      passiveSeenCount: count,
      estimatedKnownProb: nextProb,
      status,
    };
    await db.put("knowledge", updated);
    return updated;
  });
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

// Vista mínima de un store dentro de una transacción para los merges
// por fila; la cumplen tanto el store real de idb como el simulado de
// las pruebas.
type RowStore<Row> = {
  get(key: string): Promise<Row | undefined>;
  put(row: Row): Promise<unknown>;
};

// Merges fila a fila dentro de una transacción abierta: lee lo que ya
// existe, aplica la regla de fuentes/estado y escribe solo lo que
// cambió. Devuelve las filas efectivamente escritas para sincronizar.
async function mergeKnowledgeRows(
  store: RowStore<KnownWord>,
  rows: Omit<KnownWord, "key" | "updatedAt">[],
  now: number,
): Promise<KnownWord[]> {
  const written: KnownWord[] = [];
  for (const row of rows) {
    const existing = await store.get(knowledgeKey(row.language, row.lemma));
    const entry = mergePreparationKnowledge(existing, row, now);
    if (!entry) continue;
    await store.put(entry);
    written.push(entry);
  }
  return written;
}

async function mergeSavedWordRows(
  store: RowStore<SavedWord>,
  words: Omit<SavedWord, "key" | "savedAt">[],
  now: number,
): Promise<SavedWord[]> {
  const written: SavedWord[] = [];
  for (const word of words) {
    const existing = await store.get(wordKey(word.language, word.form));
    const entry = mergePreparationWord(existing, word, now);
    if (!entry) continue;
    await store.put(entry);
    written.push(entry);
  }
  return written;
}

// Aborta la transacción para que el lote sea todo o nada: una
// excepción entre peticiones la deja inactiva e IDB confirmaría lo ya
// encolado. abort() sobre una ya cerrada lanza; se ignora.
async function abortQuietly(
  tx: { abort(): void },
  err: unknown,
): Promise<never> {
  try {
    tx.abort();
  } catch {
    /* la transacción ya terminó */
  }
  throw err;
}

// Lote confirmado de una ronda de preparación: evidencia de
// conocimiento, palabras desconocidas del Cuaderno y el registro de
// la ronda, en una sola transacción. Si cualquier escritura falla,
// ninguna tabla cambia. Devuelve las filas efectivamente escritas
// para que quien llame las sincronice después — aquí no entra nada
// de red.
export async function savePreparationBatch(
  input: {
    record: PreparationRecord;
    // `preparationRecordKey(record.bookHash, record.targetId)` — la
    // arma quien llama para no importar preparation.ts desde aquí.
    recordKey: string;
    knowledge: Omit<KnownWord, "key" | "updatedAt">[];
    words: Omit<SavedWord, "key" | "savedAt">[];
  },
  scope?: DbScope,
): Promise<{ knowledge: KnownWord[]; words: SavedWord[] }> {
  return withDb(scope, async (db) => {
    const now = Date.now();
    const tx = db.transaction(
      ["knowledge", "savedWords", "session"],
      "readwrite",
    );

    try {
      const knowledge = await mergeKnowledgeRows(
        tx.objectStore("knowledge"),
        input.knowledge,
        now,
      );
      const words = await mergeSavedWordRows(
        tx.objectStore("savedWords"),
        input.words,
        now,
      );
      await tx
        .objectStore("session")
        .put(JSON.stringify(input.record), input.recordKey);
      await tx.done;
      return { knowledge, words };
    } catch (err) {
      return abortQuietly(tx, err);
    }
  });
}

// Ronda de calibración: la evidencia y las palabras desconocidas que
// entran al Cuaderno en una sola transacción — un fallo a mitad no
// deja media ronda. Mismo contrato que savePreparationBatch, sin
// registro de ronda (la calibración no pertenece a un libro).
export async function saveCalibrationBatch(
  input: {
    knowledge: Omit<KnownWord, "key" | "updatedAt">[];
    words: Omit<SavedWord, "key" | "savedAt">[];
  },
  scope?: DbScope,
): Promise<{ knowledge: KnownWord[]; words: SavedWord[] }> {
  return withDb(scope, async (db) => {
    const now = Date.now();
    const tx = db.transaction(["knowledge", "savedWords"], "readwrite");
    try {
      const knowledge = await mergeKnowledgeRows(
        tx.objectStore("knowledge"),
        input.knowledge,
        now,
      );
      const words = await mergeSavedWordRows(
        tx.objectStore("savedWords"),
        input.words,
        now,
      );
      await tx.done;
      return { knowledge, words };
    } catch (err) {
      return abortQuietly(tx, err);
    }
  });
}

// ---------- Compañero (journal, baselines, registros, recepciones) ----------
//
// El progreso del juego ya no vive como un JSON entero en «gameState»:
// se proyecta desde cuatro colecciones convergentes (contratos A–D).
// Aquí solo hay almacenamiento y fusión; las reglas puras de
// proyección y merge están en shared/companion-data para que el
// servidor las aplique igual.

// Claves de session del compañero. «gameState» y «companion» son las
// v1 selladas por la migración; el resto nace con la versión 9 de la
// base. Las exporta idb (no game.ts) porque la migración anónimo→
// cuenta las necesita y game.ts ya importa de aquí.
export const GAME_STATE_KEY = "gameState";
export const GAME_KEY = "companion";
export const COMPANION_BASELINES_KEY = "companionBaselines:v1";
export const COMPANION_PROFILE_KEY = "companionProfile:v1";
export const COMPANION_DEVICE_PREFS_KEY = "companionDevicePrefs:v1";
export const COMPANION_MIGRATION_KEY = "companionMigration:v1";
// Confirmaciones del servidor por categoría: el sync (fase 3) calcula
// pendientes como local − acked, sin borrar el journal.
export const COMPANION_ACKED_KEY = "companionAcked:v1";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Mapa originId → baseline tal como viaja en session. Una entrada sin
// forma de baseline se descarta (datos dañados no se propagan a la
// proyección ni al sync); JSON inválido devuelve el mapa vacío.
function parseCompanionBaselines(
  raw: string | undefined,
): Record<string, LegacyGameBaseline> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const out: Record<string, LegacyGameBaseline> = {};
    for (const [originId, value] of Object.entries(parsed)) {
      if (
        isRecord(value) &&
        value.version === 1 &&
        value.originId === originId &&
        isRecord(value.state)
      )
        out[originId] = value as unknown as LegacyGameBaseline;
    }
    return out;
  } catch {
    return {};
  }
}

function parseCompanionRegisters(raw: string | undefined): CompanionRegister[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CompanionRegister =>
        isRecord(item) &&
        typeof item.field === "string" &&
        (COMPANION_FIELDS as readonly string[]).includes(item.field) &&
        typeof item.updatedAt === "number" &&
        typeof item.operationId === "string",
    );
  } catch {
    return [];
  }
}

export async function readCompanionBaselines(
  scope?: DbScope,
): Promise<Record<string, LegacyGameBaseline>> {
  return withDb(scope, async (db) =>
    parseCompanionBaselines(await db.get("session", COMPANION_BASELINES_KEY)),
  );
}

// Inserta el baseline en el mapa por originId: los baselines son
// inmutables, así que uno ya presente jamás se reescribe.
export async function putCompanionBaseline(
  baseline: LegacyGameBaseline,
  scope?: DbScope,
) {
  return withDb(scope, async (db) => {
    const tx = db.transaction("session", "readwrite");
    const session = tx.objectStore("session");
    const map = parseCompanionBaselines(
      await session.get(COMPANION_BASELINES_KEY),
    );
    if (!map[baseline.originId]) {
      map[baseline.originId] = baseline;
      await session.put(JSON.stringify(map), COMPANION_BASELINES_KEY);
    }
    await tx.done;
  });
}

export async function listCompanionEvents(
  scope?: DbScope,
): Promise<GameJournalEvent[]> {
  return withDb(scope, (db) => db.getAll("companionEvents"));
}

export async function listCompanionReceipts(
  scope?: DbScope,
): Promise<CompanionReceipt[]> {
  return withDb(scope, (db) => db.getAll("companionReceipts"));
}

// Mismo id con otro contenido: el journal es inmutable y la
// divergencia es conflicto real, nunca un overwrite silencioso.
export class CompanionEventConflictError extends Error {
  constructor(readonly id: string) {
    super("companion event conflict");
    this.name = "CompanionEventConflictError";
  }
}

// Anexa eventos al journal en una sola transacción. Idempotente: un
// id ya presente con el mismo contenido es un no-op; con contenido
// distinto aborta el lote completo.
export async function appendCompanionEvents(
  events: GameJournalEvent[],
  scope?: DbScope,
): Promise<void> {
  return withDb(scope, async (db) => {
    const tx = db.transaction("companionEvents", "readwrite");
    try {
      const store = tx.objectStore("companionEvents");
      for (const event of events) {
        const existing = await store.get(event.id);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(event))
            throw new CompanionEventConflictError(event.id);
          continue;
        }
        await store.put(event);
      }
      await tx.done;
    } catch (err) {
      return abortQuietly(tx, err);
    }
  });
}

// Unión por id conservando el menor sello: una recepción repetida
// (reenvío, réplica) jamás la borra ni la retrasa.
export async function mergeCompanionReceipts(
  receipts: CompanionReceipt[],
  scope?: DbScope,
): Promise<void> {
  return withDb(scope, async (db) => {
    const tx = db.transaction("companionReceipts", "readwrite");
    try {
      const store = tx.objectStore("companionReceipts");
      for (const receipt of receipts) {
        const existing = await store.get(receipt.id);
        if (!existing || receipt.at < existing.at)
          await store.put({ id: receipt.id, at: receipt.at });
      }
      await tx.done;
    } catch (err) {
      return abortQuietly(tx, err);
    }
  });
}

export async function readCompanionRegisters(
  scope?: DbScope,
): Promise<CompanionRegister[]> {
  return withDb(scope, async (db) =>
    parseCompanionRegisters(await db.get("session", COMPANION_PROFILE_KEY)),
  );
}

// Fusiona los registros entrantes con los guardados y conserva los
// ganadores por campo (mayor sello updatedAt, operationId). Así una
// escritura local y un lote del sync compiten con la misma regla.
export async function putCompanionRegisters(
  registers: CompanionRegister[],
  scope?: DbScope,
): Promise<void> {
  if (!registers.length) return;
  return withDb(scope, async (db) => {
    const tx = db.transaction("session", "readwrite");
    const session = tx.objectStore("session");
    const merged = mergeCompanionRegister([
      ...parseCompanionRegisters(await session.get(COMPANION_PROFILE_KEY)),
      ...registers,
    ]);
    await session.put(JSON.stringify(merged), COMPANION_PROFILE_KEY);
    await tx.done;
  });
}

export async function readCompanionDevicePrefs(
  scope?: DbScope,
): Promise<CompanionDevicePrefs | null> {
  return withDb(scope, async (db) => {
    const raw = await db.get("session", COMPANION_DEVICE_PREFS_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !isRecord(parsed) ||
        parsed.version !== 1 ||
        typeof parsed.soundEnabled !== "boolean" ||
        !(COMPANION_MOTION as readonly unknown[]).includes(parsed.motion)
      )
        return null;
      // Los ambientes por libro son opcionales: se conservan sólo las claves
      // con un valor del catálogo (basura fuera, resto intacto).
      const moods = parsed.bookMoods;
      const cleanMoods: Record<string, string> = {};
      if (isRecord(moods)) {
        for (const [key, value] of Object.entries(moods)) {
          if (typeof value === "string" && (BOOK_MOODS as readonly string[]).includes(value)) {
            cleanMoods[key] = value;
          }
        }
      }
      return {
        version: 1,
        soundEnabled: parsed.soundEnabled,
        motion: parsed.motion as CompanionDevicePrefs["motion"],
        bookMoods: cleanMoods as CompanionDevicePrefs["bookMoods"],
      };
    } catch {
      return null;
    }
  });
}

export async function saveCompanionDevicePrefs(
  prefs: CompanionDevicePrefs,
  scope?: DbScope,
) {
  return withDb(scope, (db) =>
    db.put("session", JSON.stringify(prefs), COMPANION_DEVICE_PREFS_KEY),
  );
}

// Lo ya confirmado por el servidor, por categoría. Es solo un sello
// de progreso del sync: nunca se usa para podar el journal. Para los
// registros se guardan los operationId confirmados — el sello del
// registro es su identidad, no el campo (otro operationId posterior
// sobre el mismo campo sigue pendiente).
export interface CompanionAcked {
  baselines: string[];
  events: string[];
  fields: string[];
  receipts: string[];
}

const EMPTY_ACKED: CompanionAcked = {
  baselines: [],
  events: [],
  fields: [],
  receipts: [],
};

export async function readCompanionAcked(
  scope?: DbScope,
): Promise<CompanionAcked> {
  return withDb(scope, async (db) => {
    const raw = await db.get("session", COMPANION_ACKED_KEY);
    if (!raw) return { ...EMPTY_ACKED };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return { ...EMPTY_ACKED };
      const list = (v: unknown) =>
        Array.isArray(v)
          ? v.filter((x): x is string => typeof x === "string")
          : [];
      return {
        baselines: list(parsed.baselines),
        events: list(parsed.events),
        fields: list(parsed.fields),
        receipts: list(parsed.receipts),
      };
    } catch {
      return { ...EMPTY_ACKED };
    }
  });
}

export async function saveCompanionAcked(acked: CompanionAcked, scope?: DbScope) {
  return withDb(scope, (db) =>
    db.put("session", JSON.stringify(acked), COMPANION_ACKED_KEY),
  );
}

// Un gameState v1 «válido para sellar»: versión 1 con stats objeto y
// XP numérica — el mismo umbral que usaba loadGame antes de leerlo.
// Lo que no parsea se conserva tal cual (hadState + corrupt) y se
// informa, jamás se resetea.
function parseGameStateV1(raw: string): GameState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      isRecord(parsed) &&
      parsed.version === 1 &&
      typeof parsed.xp === "number" &&
      isRecord(parsed.stats)
    )
      return parsed as unknown as GameState;
    return null;
  } catch {
    return null;
  }
}

export interface CompanionMigrationResult {
  already: boolean;
  // originId del baseline creado (null si no había nada que sellar).
  originId?: string | null;
  // Había un gameState v1 guardado, parseara o no.
  hadState?: boolean;
  // Había gameState pero no parseó como v1: se conserva intacto y se
  // sella igual para no reintentarlo en cada premio.
  corrupt?: boolean;
}

// Núcleo de la migración v1→journal sobre una base concreta. Lee y
// sella en UNA transacción de session: si el sello ya existe no hace
// nada; si hay un gameState válido lo fotografía como baseline con un
// originId nuevo y deja el string original intacto. Compartido por la
// llamada pública (base del contexto) y la migración anónimo→cuenta.
async function migrateGameStateV1In(
  db: IDBPDatabase<LectaDB>,
): Promise<CompanionMigrationResult> {
  const tx = db.transaction("session", "readwrite");
  try {
    const session = tx.objectStore("session");
    if ((await session.get(COMPANION_MIGRATION_KEY)) !== undefined) {
      await tx.done;
      return { already: true };
    }
    const raw = await session.get(GAME_STATE_KEY);
    const hadState = raw !== undefined;
    let originId: string | null = null;
    let corrupt = false;
    if (typeof raw === "string") {
      const state = parseGameStateV1(raw);
      if (state) {
        originId = crypto.randomUUID();
        const baselines = parseCompanionBaselines(
          await session.get(COMPANION_BASELINES_KEY),
        );
        baselines[originId] = { version: 1, originId, state };
        await session.put(
          JSON.stringify(baselines),
          COMPANION_BASELINES_KEY,
        );
      } else {
        corrupt = true;
      }
    }
    // El sello se escribe siempre: sin gameState (originId null) o con
    // uno dañado, la migración ya corrió y no se repite.
    await session.put(
      JSON.stringify({ migratedAt: Date.now(), originId }),
      COMPANION_MIGRATION_KEY,
    );
    await tx.done;
    return { already: false, originId, hadState, corrupt };
  } catch (err) {
    return abortQuietly(tx, err);
  }
}

export function migrateGameStateV1(
  scope?: DbScope,
): Promise<CompanionMigrationResult> {
  return withDb(scope, migrateGameStateV1In);
}

// Los hechos estables del premio (los que fija el emisor); los flags
// derivados (racha, elegibilidad del libro) se calculan dentro de la
// transacción con el snapshot vigente, no con la caché del llamador.
export interface CompanionEventDraft {
  id: string;
  at: number;
  dayKey: string;
  event: GameJournalEvent["event"];
  interval?: { startedAt: number; endedAt: number };
}

// Anexa el premio al journal y, EN LA MISMA TRANSACCIÓN, los receipts
// «achievement-credit» que la proyección actualizada deja pendientes:
// el evento y sus créditos quedan confirmados juntos o no quedan.
// Si el id ya existe debe ser la misma jugada (mismos hechos): se
// reusa el evento guardado con sus flags congelados — un reintento no
// recalcula la racha. Hechos distintos bajo un mismo id es conflicto
// y aborta sin escribir nada.
export async function commitCompanionEvent(
  draft: CompanionEventDraft,
  scope?: DbScope,
): Promise<void> {
  return withDb(scope, async (db) => {
    const tx = db.transaction(
      ["session", "companionEvents", "companionReceipts"],
      "readwrite",
    );
    try {
      const session = tx.objectStore("session");
      const eventsStore = tx.objectStore("companionEvents");
      const receiptsStore = tx.objectStore("companionReceipts");
      const [baselinesRaw, registersRaw, storedEvents, storedReceipts] =
        await Promise.all([
          session.get(COMPANION_BASELINES_KEY),
          session.get(COMPANION_PROFILE_KEY),
          eventsStore.getAll(),
          receiptsStore.getAll(),
        ]);
      const registers = parseCompanionRegisters(registersRaw);
      const baselines = Object.values(parseCompanionBaselines(baselinesRaw));

      const existing = storedEvents.find((e) => e.id === draft.id);
      let event: GameJournalEvent;
      if (existing) {
        const sameFacts =
          existing.at === draft.at &&
          existing.dayKey === draft.dayKey &&
          JSON.stringify(existing.event) === JSON.stringify(draft.event) &&
          JSON.stringify(existing.interval ?? null) ===
            JSON.stringify(draft.interval ?? null);
        if (!sameFacts) throw new CompanionEventConflictError(draft.id);
        event = existing;
      } else {
        const projected = projectGame({
          baselines,
          events: storedEvents,
          registers,
          receipts: storedReceipts,
        }).state;
        event = {
          version: 1,
          id: draft.id,
          at: draft.at,
          dayKey: draft.dayKey,
          streakBonus: projected.stats.streakDays > 1,
          event: draft.event,
        };
        // El crédito por libro lo congela el emisor: solo si el libro
        // aún no estaba terminado en el snapshot vigente.
        if (draft.event.kind === "book_finished")
          event.bookCreditEligible = !projected.finishedBooks.includes(
            draft.event.bookHash,
          );
        if (draft.interval) event.interval = draft.interval;
        await eventsStore.put(event);
      }

      // Créditos de logro pendientes con el evento ya en el journal;
      // se sellan con el `at` del premio que los descubrió.
      const snapshot: CompanionSnapshot = {
        baselines,
        events: existing ? storedEvents : [...storedEvents, event],
        registers,
        receipts: storedReceipts,
      };
      const receiptAt = new Map(storedReceipts.map((r) => [r.id, r.at]));
      for (const achievementId of pendingAchievementCredits(snapshot)) {
        const id = receiptIdFor("achievement-credit", achievementId);
        const known = receiptAt.get(id);
        // La recepción une por sello mínimo: solo se escribe si falta
        // o si este premio la sella antes de lo ya conocido.
        if (known === undefined || draft.at < known) {
          await receiptsStore.put({ id, at: draft.at });
          receiptAt.set(id, draft.at);
        }
      }
      await tx.done;
    } catch (err) {
      return abortQuietly(tx, err);
    }
  });
}

// ---------- Memoria local del diccionario (lexiconCache) ----------

export const lexiconCacheKey = (language: string, form: string) =>
  `${language}:${form.trim().toLowerCase()}`;

export async function getCachedLexicon(
  language: string,
  form: string,
  scope?: DbScope,
): Promise<LexiconEntry[] | null> {
  return withDb(scope, async (db) => {
    const row = await db.get("lexiconCache", lexiconCacheKey(language, form));
    return row ? row.entries : null;
  });
}

export async function saveCachedLexicon(
  language: string,
  form: string,
  entries: LexiconEntry[],
  scope?: DbScope,
): Promise<void> {
  if (!entries.length) return;
  const key = lexiconCacheKey(language, form);
  return withDb(scope, async (db) => {
    await db.put("lexiconCache", {
      key,
      form: form.trim().toLowerCase(),
      language,
      entries,
      cachedAt: Date.now(),
    });
  });
}

export async function saveCachedLexiconBatch(
  language: string,
  entriesByForm: Record<string, LexiconEntry[]>,
  scope?: DbScope,
): Promise<void> {
  const forms = Object.keys(entriesByForm);
  if (!forms.length) return;
  return withDb(scope, async (db) => {
    const tx = db.transaction("lexiconCache", "readwrite");
    const store = tx.objectStore("lexiconCache");
    const now = Date.now();
    for (const form of forms) {
      const entries = entriesByForm[form];
      if (!entries || !entries.length) continue;
      await store.put({
        key: lexiconCacheKey(language, form),
        form: form.trim().toLowerCase(),
        language,
        entries,
        cachedAt: now,
      });
    }
    await tx.done;
  });
}

export async function getCachedLexiconBatch(
  language: string,
  forms: string[],
  scope?: DbScope,
): Promise<Record<string, LexiconEntry[]>> {
  if (!forms.length) return {};
  return withDb(scope, async (db) => {
    const tx = db.transaction("lexiconCache", "readonly");
    const store = tx.objectStore("lexiconCache");
    const result: Record<string, LexiconEntry[]> = {};
    for (const form of forms) {
      const row = await store.get(lexiconCacheKey(language, form));
      if (row && row.entries?.length) {
        result[form] = row.entries;
      }
    }
    await tx.done;
    return result;
  });
}

export async function countCachedLexicon(
  language?: string,
  scope?: DbScope,
): Promise<number> {
  return withDb(scope, async (db) => {
    if (!language) {
      const all = await db.getAllKeys("lexiconCache");
      return all.length;
    }
    const all = await db.getAll("lexiconCache");
    return all.filter((item) => item.language === language).length;
  });
}

export async function clearCachedLexicon(scope?: DbScope): Promise<void> {
  return withDb(scope, async (db) => {
    const tx = db.transaction("lexiconCache", "readwrite");
    await tx.objectStore("lexiconCache").clear();
    await tx.done;
  });
}

export const SMART_ASSISTS_SESSION_KEY = "lecta:smart_assists:v1";

export async function saveSmartAssistsPrefsIdb(
  prefs: Record<string, unknown> | object,
  scope?: DbScope,
): Promise<void> {
  try {
    await withDb(scope, (db) =>
      db.put("session", JSON.stringify(prefs), SMART_ASSISTS_SESSION_KEY),
    );
  } catch {
    // Silently ignore in environments where IDB cannot be accessed
  }
}

export async function loadSmartAssistsPrefsIdb(
  scope?: DbScope,
): Promise<Record<string, unknown> | null> {
  try {
    return await withDb(scope, async (db) => {
      const raw = await db.get("session", SMART_ASSISTS_SESSION_KEY);
      if (!raw || typeof raw !== "string") return null;
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    });
  } catch {
    return null;
  }
}

export type { BookMeta } from "./cover";

export interface WordMeaning {
  word: string;
  lemma?: string;
  partOfSpeech?: string;
  ContextualMeaning?: string;
  definitions: string[];
  examples?: string[];
  source?: string;
}

export type VocabEntry = SavedWord & {
  id: string;
  note?: string;
};

export async function getBookWithData(
  hash: string,
  scope?: DbScope,
): Promise<StoredBook | undefined> {
  return getStoredBook(hash, scope);
}

