// Capa de IO del juego del Cuaderno: la preferencia «companion»
// (mismo patrón que «Usar IA») y el snapshot del compañero en
// IndexedDB — journal de premios + baselines v1 + recepciones +
// registros de perfil, todo por cuenta. El GameState que ve la
// interfaz es una PROYECCIÓN pura del snapshot (projectGame): ya no
// se guarda un JSON entero y dos réplicas con el mismo journal
// convergen al mismo estado. `award` sigue siendo auxiliar como
// trackReadingEvent: el llamador lo invoca con `void` y un fallo
// jamás interrumpe lectura ni repaso.

import {
  captureDbScope,
  commitCompanionEvent,
  isDbScopeActive,
  listCompanionEvents,
  listCompanionReceipts,
  loadSessionValue,
  mergeCompanionReceipts,
  migrateGameStateV1,
  putCompanionRegisters,
  readCompanionBaselines,
  readCompanionDevicePrefs,
  readCompanionRegisters,
  saveCompanionDevicePrefs as writeCompanionDevicePrefs,
  saveSessionValue,
  GAME_KEY,
  type DbScope,
} from "./idb";
import {
  canonicalChestKey,
  mergeCompanionRegister,
  projectGame,
  receiptIdFor,
  type BookMood,
  type CompanionDevicePrefs,
  type CompanionField,
  type CompanionRegister,
  type CompanionReceiptKind,
  type CompanionSnapshot,
} from "../../shared/companion-data";
import { dayKeyOf } from "./reading-activity";
import {
  emptyGameState,
  type GameChest,
  type GameEvent,
  type GameState,
} from "./gamification";

export { GAME_KEY };
export type { GameEvent, GameState } from "./gamification";

// «YYYY-MM-DD» en la zona local del dispositivo — la misma regla con
// la que el lector corta su meta diaria (reading-activity). El dayKey
// viaja congelado en cada evento del journal.
export function localDayKey(ts: number): string {
  return dayKeyOf(ts, Intl.DateTimeFormat().resolvedOptions().timeZone);
}

// Preferencia «enabled»: el registro sincronizado manda cuando
// existe; si no hay, el «companion» v1 local decide para que un
// opt-out anterior siga apagado. Encendido por defecto.
export async function loadGameEnabled(scope?: DbScope): Promise<boolean> {
  try {
    const reg = await readCompanionField("enabled", scope);
    if (reg) return reg.value === true;
    return (await loadSessionValue(GAME_KEY, scope)) !== "0";
  } catch {
    return true;
  }
}

export async function saveGameEnabled(on: boolean, scope?: DbScope) {
  const bound = scope ?? captureDbScope();
  // El registro sincronizado primero; la llave v1 después, para que
  // un cliente viejo lea el mismo apagado. Si la primera escritura
  // falla nada queda a medias y el llamador ve el error.
  await writeCompanionField("enabled", on, bound);
  await saveSessionValue(GAME_KEY, on ? "1" : "0", bound);
  if (isDbScopeActive(bound)) notify();
}

// ---------- Estado en memoria + persistencia ----------

// La caché va etiquetada con el contexto de cuenta que la produjo:
// un premio o una lectura bajo un contexto vencido jamás presenta ni
// persiste el estado de la cuenta nueva.
let cache: { scope: DbScope; state: GameState } | null = null;
// Las escrituras se encolan: lectura (Reader) y repaso (Cuaderno)
// pueden coincidir y dos commits en vuelo pisarían sellos. La cola no
// se reinicia al cambiar de cuenta — cada tarea encolada lleva su
// propio contexto y aborta sola si el suyo venció.
let queue: Promise<void> = Promise.resolve();

const listeners = new Set<() => void>();

export function subscribeGame(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const notify = () => {
  for (const fn of listeners) fn();
};

// Lee las cuatro colecciones que alimentan la proyección.
const readSnapshot = async (scope: DbScope): Promise<CompanionSnapshot> => {
  const [baselines, events, registers, receipts] = await Promise.all([
    readCompanionBaselines(scope),
    listCompanionEvents(scope),
    readCompanionRegisters(scope),
    listCompanionReceipts(scope),
  ]);
  return { baselines: Object.values(baselines), events, registers, receipts };
};

// Relee el snapshot tras un commit y refresca caché + suscriptores
// solo si el contexto sigue vigente: jamás se publica lo de otra
// cuenta ni se avisa antes de persistir.
const refreshAfterCommit = async (bound: DbScope) => {
  const snapshot = await readSnapshot(bound);
  if (!isDbScopeActive(bound)) return;
  cache = { scope: bound, state: projectGame(snapshot).state };
  notify();
};

export async function loadGame(scope?: DbScope): Promise<GameState> {
  const bound = scope ?? captureDbScope();
  if (
    cache &&
    isDbScopeActive(cache.scope) &&
    cache.scope.userId === bound.userId
  )
    return cache.state;
  try {
    // El gameState v1 se sella antes de proyectar (idempotente, una
    // transacción): así el avance anterior se ve desde la primera
    // lectura del panel, sin esperar al primer premio nuevo.
    await migrateGameStateV1(bound);
    const snapshot = await readSnapshot(bound);
    const state = projectGame(snapshot).state;
    // Solo se memoriza el estado del contexto vigente: una lectura
    // tardía de la cuenta anterior no tapa la de la cuenta activa.
    if (isDbScopeActive(bound)) cache = { scope: bound, state };
    return state;
  } catch {
    /* estado dañado: se proyecta limpio, sin drama */
    return emptyGameState();
  }
}

// El snapshot crudo para el sync (fase 3): siempre fresco del disco —
// la caché proyectada no es autoridad para reconciliar.
export async function loadGameSnapshot(
  scope?: DbScope,
): Promise<CompanionSnapshot> {
  const bound = scope ?? captureDbScope();
  return readSnapshot(bound);
}

// Metadata que fija el emisor y viaja congelada en el journal: id
// estable por jugada, sello de tiempo y día local de SU zona. Con ella
// el evento es reintentable y la proyección determinista en cualquier
// réplica.
export type AwardMeta = {
  id: string;
  at: number;
  dayKey: string;
  interval?: { startedAt: number; endedAt: number };
};

// Anexa el evento al journal si el juego está encendido (con el juego
// apagado no se registra nada, como antes). Encola la escritura con el
// contexto que la originó y aborta en silencio si venció: nunca se
// aplica a la cuenta nueva. La migración v1 corre antes del primer
// premio; el evento y los créditos de logro que descubre confirman en
// una sola transacción; caché y aviso llegan solo después del commit.
// Devuelve la promesa de la cola.
export function award(
  event: GameEvent,
  scope: DbScope | undefined,
  meta: AwardMeta,
): Promise<void> {
  const bound = scope ?? captureDbScope();
  queue = queue.then(async () => {
    try {
      if (!isDbScopeActive(bound)) return;
      if (!(await loadGameEnabled(bound))) return;
      if (!isDbScopeActive(bound)) return;
      await migrateGameStateV1(bound);
      if (!isDbScopeActive(bound)) return;
      await commitCompanionEvent(
        {
          id: meta.id,
          at: meta.at,
          dayKey: meta.dayKey,
          event,
          interval: meta.interval,
        },
        bound,
      );
      if (!isDbScopeActive(bound)) return;
      await refreshAfterCommit(bound);
    } catch {
      /* el juego es extra: un fallo no debe notarse */
    }
  });
  return queue;
}

// Consulta con premio una vez por palabra e idioma en el día local:
// reabrir la misma ficha no vuelve a pagar. El registro vive en la
// sesión de la cuenta (clave nueva y versionada); la guarda en memoria
// cubre dos aperturas seguidas antes de que la escritura confirme.
export const CONSULT_AWARDS_SESSION_KEY = "lecta:consult_awards:v1";
const consultAwardedInMemory = new Set<string>();

export async function awardConsultOncePerDay(
  language: string,
  word: string,
  scope?: DbScope,
  now = Date.now(),
): Promise<boolean> {
  const bound = scope ?? captureDbScope();
  const dayKey = localDayKey(now);
  const wordKey = `${language.slice(0, 2).toLowerCase()}:${word.trim().toLowerCase()}`;
  const memoryKey = `${bound.userId ?? "anon"}|${dayKey}|${wordKey}`;
  if (consultAwardedInMemory.has(memoryKey)) return false;
  consultAwardedInMemory.add(memoryKey);
  const raw = await loadSessionValue(CONSULT_AWARDS_SESSION_KEY, bound).catch(
    () => undefined,
  );
  let keys: string[] = [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : null;
    if (parsed?.dayKey === dayKey && Array.isArray(parsed.keys))
      keys = parsed.keys.filter(
        (key: unknown): key is string => typeof key === "string",
      );
  } catch {
    // registro ilegible: se empieza el día de cero
  }
  if (keys.includes(wordKey)) return false;
  keys.push(wordKey);
  await saveSessionValue(
    CONSULT_AWARDS_SESSION_KEY,
    JSON.stringify({ dayKey, keys }),
    bound,
  ).catch(() => undefined);
  await award({ kind: "consulted" }, bound, {
    id: `consult:${crypto.randomUUID()}`,
    at: now,
    dayKey,
  });
  return true;
}

// La proyección ya entrega ids canónicos («achievement:x», «level:n»,
// «legacy:y»); esos pasan tal cual. Un id suelto de la versión vieja
// se traduce buscando su cofre y, si no se reconoce, se conserva como
// «legacy:<id>»: la apertura queda registrada sin adivinar contenido.
function canonicalChestId(id: string, chests: GameChest[]): string {
  if (/^(achievement|level|legacy):.+/.test(id)) return id;
  const chest = chests.find((c) => c.id === id);
  return chest ? canonicalChestKey(chest) : `legacy:${id}`;
}

// Abrir un cofre es una recepción «chest-open:<clave canónica>»: la
// apertura une por id con el sello mínimo y el contenido ya venía
// resuelto — el receipt solo marca el acto.
export function openGameChest(id: string, scope?: DbScope): Promise<void> {
  const bound = scope ?? captureDbScope();
  queue = queue.then(async () => {
    try {
      if (!isDbScopeActive(bound)) return;
      const chests = (await loadGame(bound)).chests;
      const key = canonicalChestId(id, chests);
      await mergeCompanionReceipts(
        [{ id: receiptIdFor("chest-open", key), at: Date.now() }],
        bound,
      );
      if (!isDbScopeActive(bound)) return;
      await refreshAfterCommit(bound);
    } catch {
      /* igual: silencio */
    }
  });
  return queue;
}

// Marca una recepción genérica (los avisos vistos de logro/etapa de
// las celebraciones; el cofre lo cubre openGameChest). Monotónica:
// repetirla une por id quedándose con el sello mínimo.
export function markCompanionReceipt(
  kind: CompanionReceiptKind,
  key: string,
  scope?: DbScope,
): Promise<void> {
  const bound = scope ?? captureDbScope();
  queue = queue.then(async () => {
    try {
      if (!isDbScopeActive(bound)) return;
      await mergeCompanionReceipts(
        [{ id: receiptIdFor(kind, key), at: Date.now() }],
        bound,
      );
      await refreshAfterCommit(bound);
    } catch {
      /* igual: silencio */
    }
  });
  return queue;
}

// ---------- Perfil (registros por campo) ----------

// El registro vigente de un campo, ya arbitrado por sello.
export async function readCompanionField(
  field: CompanionField,
  scope?: DbScope,
): Promise<CompanionRegister | undefined> {
  const bound = scope ?? captureDbScope();
  const regs = mergeCompanionRegister(await readCompanionRegisters(bound));
  return regs.find((reg) => reg.field === field);
}

// Escribe un campo del perfil con sello monótono local
// (max(ahora, previo+1)) y operationId nuevo para el desempate entre
// réplicas. Propaga el error: quien edita nombre/ropa debe poder
// avisar si el guardado falló — nada de éxito ficticio.
export async function writeCompanionField(
  field: CompanionField,
  value: unknown,
  scope?: DbScope,
): Promise<void> {
  const bound = scope ?? captureDbScope();
  const prev = await readCompanionField(field, bound);
  const register: CompanionRegister = {
    field,
    value,
    updatedAt: Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1),
    operationId: crypto.randomUUID(),
  };
  await putCompanionRegisters([register], bound);
  if (isDbScopeActive(bound)) notify();
}

// Nombre visible del gato: el registro «name» o «Gato» si aún no se
// bautiza. La validación de forma (1–24, sin controles) la hace el
// editor al escribir; aquí solo se lee.
export async function loadCompanionName(scope?: DbScope): Promise<string> {
  try {
    const reg = await readCompanionField("name", scope);
    return typeof reg?.value === "string" && reg.value ? reg.value : "Gato";
  } catch {
    return "Gato";
  }
}

const DEFAULT_DEVICE_PREFS: CompanionDevicePrefs = {
  version: 1,
  soundEnabled: false,
  motion: "system",
};

// Preferencias de ESTE dispositivo (no sincronizan): el sonido nace
// apagado a propósito y el movimiento sigue al sistema.
export async function loadCompanionDevicePrefs(
  scope?: DbScope,
): Promise<CompanionDevicePrefs> {
  try {
    return (await readCompanionDevicePrefs(scope)) ?? DEFAULT_DEVICE_PREFS;
  } catch {
    return DEFAULT_DEVICE_PREFS;
  }
}

// Ambiente de un libro («poesía», «misterio»…) para que el gato proponga su
// look. Vive en las preferencias del dispositivo: un libro concreto en esta
// copia, sin tocar el contrato del sync. Sin aviso a los suscriptores del
// juego: no cambia XP, ropa ni constancia — sólo una etiqueta de lectura.
export async function saveCompanionBookMood(
  bookId: string,
  mood: BookMood | null,
  scope?: DbScope,
): Promise<void> {
  if (!bookId) return;
  const bound = scope ?? captureDbScope();
  const prefs = await loadCompanionDevicePrefs(bound);
  const bookMoods = { ...(prefs.bookMoods ?? {}) };
  if (mood) bookMoods[bookId] = mood;
  else delete bookMoods[bookId];
  await writeCompanionDevicePrefs({ ...prefs, bookMoods }, bound);
}

// Guardar preferencias del dispositivo avisa a los suscriptores: el
// proveedor relee «motion» (y el sonido) al instante — así el cambio
// de Cuenta se aplica sin esperar a otro commit del juego.
export async function saveCompanionDevicePrefs(
  prefs: CompanionDevicePrefs,
  scope?: DbScope,
) {
  const bound = scope ?? captureDbScope();
  await writeCompanionDevicePrefs(prefs, bound);
  if (isDbScopeActive(bound)) notify();
}

// Aviso a los suscriptores sin escritura propia: el sync lo usa tras
// fusionar lo que bajó del servidor, para que la UI reproyecte sin
// esperar un commit local. La caché ya debe quedar suelta con
// resetGameCache antes de avisar.
export function emitGameChanged() {
  notify();
}

// Para pruebas y cambio de cuenta: suelta el estado en memoria. La
// cola y los listeners siguen — cada tarea encolada lleva su contexto
// y aborta sola si venció; las suscripciones las maneja el desmontaje.
export function resetGameCache() {
  cache = null;
  consultAwardedInMemory.clear();
}

// Recompensa XP de consolidación episódica al resolver una palabra al final del capítulo
export function awardEpisodicConsolidation(
  grade: 1 | 2 | 3 | 4,
  scope?: DbScope,
  customMeta?: Partial<AwardMeta>,
): Promise<void> {
  const ratingMap: Record<1 | 2 | 3 | 4, "again" | "hard" | "good" | "easy"> = {
    1: "again",
    2: "hard",
    3: "good",
    4: "easy",
  };
  const now = Date.now();
  const meta: AwardMeta = {
    id: customMeta?.id ?? `consolidation:${now}:${crypto.randomUUID()}`,
    at: customMeta?.at ?? now,
    dayKey: customMeta?.dayKey ?? localDayKey(now),
    interval: customMeta?.interval,
  };
  return award({ kind: "review", rating: ratingMap[grade] }, scope, meta);
}

export type {
  ClozeOptionsResult,
  ConsolidationAttemptMetrics,
  ConsolidationModality,
  EpisodicWordItem,
  MorphologicalDistractorOptions,
  PostChapterConsolidationPrefs,
} from "./practice";
export {
  buildPostChapterConsolidationQueue,
  recordModalityAttempt,
  loadPostChapterConsolidationPrefs,
  savePostChapterConsolidationPrefs,
  muteConsolidationForBook,
  unmuteConsolidationForBook,
  disableConsolidationGlobally,
  enableConsolidationGlobally,
  isConsolidationActive,
  generateMorphologicalDistractors,
  generateClozeOptions,
  DEFAULT_CONSOLIDATION_PREFS,
} from "./practice";
