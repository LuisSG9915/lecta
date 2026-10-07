// Sincronización del compañero por cuenta: un ciclo completo baja las
// cuatro colecciones del servidor (barrido paginado desde el inicio,
// sin cursor incremental — así una fila insertada «antes» de donde
// iba la página llega igual en la próxima pasada) y sube lo que el
// dispositivo tiene pendiente. Pendiente = local − confirmado: el
// sello `companionAcked:v1` guarda los ids que el servidor ya aceptó
// (o devolvió: lo que viene de él ya está confirmado por definición).
// Nada de esto inventa actividad: el pull jamás emite eventos ni XP —
// solo reconcilia recepciones de logro que el journal alcanzó.

import { accountFetch } from "./account-fetch";
import {
  appendCompanionEvents,
  captureDbScope,
  CompanionEventConflictError,
  isDbScopeActive,
  listCompanionEvents,
  listCompanionReceipts,
  mergeCompanionReceipts,
  putCompanionBaseline,
  putCompanionRegisters,
  readCompanionAcked,
  readCompanionBaselines,
  readCompanionRegisters,
  saveCompanionAcked,
  saveSessionValue,
  type CompanionAcked,
  type DbScope,
} from "./idb";
import {
  emitGameChanged,
  loadGameSnapshot,
  resetGameCache,
  subscribeGame,
} from "./game";
import {
  COMPANION_BATCH_LIMIT,
  mergeCompanionRegister,
  mergeLegacyBaselines,
  pendingAchievementCredits,
  receiptIdFor,
  validateCompanionBatch,
  type CompanionBatch,
  type CompanionReceipt,
  type CompanionRegister,
  type CompanionSnapshot,
  type GameJournalEvent,
  type LegacyGameBaseline,
} from "../../shared/companion-data";
import {
  ACHIEVEMENTS,
  daysBetween,
  RARE_ZIPF_BELOW,
  type GameStats,
} from "../../shared/gamification";

const LAST_SYNC_KEY = "companionLastSyncAt";
const KINDS = ["baselines", "events", "fields", "receipts"] as const;
type CompanionKind = (typeof KINDS)[number];

export type CompanionSyncResult = { pulled: number; pending: number };

type AckedSets = {
  baselines: Set<string>;
  events: Set<string>;
  fields: Set<string>;
  receipts: Set<string>;
};

const ackedSets = (acked: CompanionAcked): AckedSets => ({
  baselines: new Set(acked.baselines),
  events: new Set(acked.events),
  fields: new Set(acked.fields),
  receipts: new Set(acked.receipts),
});

const persistAcked = (sets: AckedSets, bound: DbScope) =>
  saveCompanionAcked(
    {
      baselines: [...sets.baselines],
      events: [...sets.events],
      fields: [...sets.fields],
      receipts: [...sets.receipts],
    },
    bound,
  );

// Lo que este dispositivo tiene y el servidor aún no confirmó. Los
// registros viajan por operationId: otro sello posterior sobre el
// mismo campo sigue pendiente aunque el anterior ya se confirmó.
async function pendingBatch(
  bound: DbScope,
  sets: AckedSets,
): Promise<CompanionBatch> {
  const [baselines, events, registers, receipts] = await Promise.all([
    readCompanionBaselines(bound),
    listCompanionEvents(bound),
    readCompanionRegisters(bound),
    listCompanionReceipts(bound),
  ]);
  return {
    version: 1,
    baselines: Object.values(baselines).filter(
      (b) => !sets.baselines.has(b.originId),
    ),
    events: events.filter((e) => !sets.events.has(e.id)),
    fields: registers.filter((r) => !sets.fields.has(r.operationId)),
    receipts: receipts.filter((r) => !sets.receipts.has(r.id)),
  };
}

const pendingCount = (batch: CompanionBatch) =>
  batch.baselines.length +
  batch.events.length +
  batch.fields.length +
  batch.receipts.length;

// Corta un lote de ≤ COMPANION_BATCH_LIMIT mezclando categorías en
// orden estable; consume lo cortado de `pending` (splice).
function takeBatch(pending: CompanionBatch): CompanionBatch {
  const out: CompanionBatch = {
    version: 1,
    baselines: [],
    events: [],
    fields: [],
    receipts: [],
  };
  let room = COMPANION_BATCH_LIMIT;
  for (const key of KINDS) {
    if (room <= 0) break;
    const taken = pending[key].splice(0, room);
    out[key] = taken as never;
    room -= taken.length;
  }
  return out;
}

// La respuesta del PUT solo vale si trae las cuatro listas de ids
// confirmados como strings; cualquier otra forma invalida el envío.
function cleanAccepted(data: unknown): AckedSets | null {
  if (typeof data !== "object" || data === null) return null;
  const accepted = (data as { accepted?: unknown }).accepted;
  if (typeof accepted !== "object" || accepted === null) return null;
  const list = (v: unknown): Set<string> | null =>
    Array.isArray(v) && v.every((x) => typeof x === "string")
      ? new Set(v as string[])
      : null;
  const baselines = list((accepted as Record<string, unknown>).baselines);
  const events = list((accepted as Record<string, unknown>).events);
  const fields = list((accepted as Record<string, unknown>).fields);
  const receipts = list((accepted as Record<string, unknown>).receipts);
  if (!baselines || !events || !fields || !receipts) return null;
  return { baselines, events, fields, receipts };
}

// Empuja los pendientes al servidor en lotes de ≤120. Cada lote que
// confirma une sus ids al sello (leído y guardado por lote, así un
// corte a la mitad no reenvía lo ya aceptado). Devuelve false ante
// cualquier fallo, contexto vencido o respuesta inválida — el sello
// de «al día» solo lo pone un ciclo completo.
export async function pushCompanionChanges(
  scope?: DbScope,
): Promise<boolean> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId) return true;
  if (!isDbScopeActive(bound)) return false;
  try {
    const sets = ackedSets(await readCompanionAcked(bound));
    const pending = await pendingBatch(bound, sets);
    while (pendingCount(pending) > 0) {
      if (!isDbScopeActive(bound)) return false;
      const slice = takeBatch(pending);
      const response = await accountFetch(
        "/api/companion",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(slice),
        },
        bound,
      );
      if (!response.ok) return false;
      const data: unknown = await response.json().catch(() => null);
      const accepted = cleanAccepted(data);
      if (!accepted) return false;
      if (!isDbScopeActive(bound)) return false;
      // Solo cuentan los ids que enviamos y el servidor confirmó.
      for (const b of slice.baselines)
        if (accepted.baselines.has(b.originId)) sets.baselines.add(b.originId);
      for (const e of slice.events)
        if (accepted.events.has(e.id)) sets.events.add(e.id);
      for (const f of slice.fields)
        if (accepted.fields.has(f.operationId)) sets.fields.add(f.operationId);
      for (const r of slice.receipts)
        if (accepted.receipts.has(r.id)) sets.receipts.add(r.id);
      await persistAcked(sets, bound);
    }
    return true;
  } catch {
    return false;
  }
}

// Una página del GET es válida si tiene su lista de ítems y un cursor
// (string o null). Los ítems pasan por validateCompanionBatch como un
// lote de una sola categoría — mismo contrato que el PUT.
function cleanPage(
  data: unknown,
  kind: CompanionKind,
): { items: never[]; nextCursor: string | null } | null {
  if (typeof data !== "object" || data === null) return null;
  const { items, nextCursor } = data as {
    items?: unknown;
    nextCursor?: unknown;
  };
  if (!Array.isArray(items)) return null;
  if (nextCursor !== null && typeof nextCursor !== "string") return null;
  const batch: CompanionBatch = {
    version: 1,
    baselines: [],
    events: [],
    fields: [],
    receipts: [],
  };
  (batch[kind] as unknown[]) = items;
  const validated = validateCompanionBatch(batch);
  if (!validated.ok) return null;
  return {
    items: validated.batch[kind] as never[],
    nextCursor: nextCursor as string | null,
  };
}

// Une una página validada en el almacenamiento local y marca sus ids
// como confirmados (vinieron del servidor). El journal es inmutable:
// un id remoto que ya existe local con otro contenido se omite — el
// remoto manda y la copia divergente queda solo en este dispositivo —
// pero el id se confirma igual porque reintentarlo chocaría siempre.
// Devuelve cuántos ítems incorporaron datos nuevos (un reenvío de lo
// ya conocido cuenta 0) — el ciclo lo usa para avisar a la UI solo
// cuando de verdad cambió algo.
async function mergePage(
  kind: CompanionKind,
  items: never[],
  bound: DbScope,
  sets: AckedSets,
): Promise<number> {
  switch (kind) {
    case "baselines": {
      const baselines = items as unknown as LegacyGameBaseline[];
      const known = await readCompanionBaselines(bound);
      let applied = 0;
      for (const baseline of baselines) {
        if (!known[baseline.originId]) applied++;
        await putCompanionBaseline(baseline, bound);
      }
      for (const b of baselines) sets.baselines.add(b.originId);
      return applied;
    }
    case "events": {
      const events = items as unknown as GameJournalEvent[];
      const localById = new Map(
        (await listCompanionEvents(bound)).map((e) => [e.id, e]),
      );
      const toAppend: GameJournalEvent[] = [];
      for (const e of events) {
        sets.events.add(e.id);
        // Ya presente: idéntico es no-op y divergente se omite — el
        // remoto manda, el id queda confirmado de todas formas y
        // nada cambió en el journal local.
        if (localById.has(e.id)) continue;
        toAppend.push(e);
      }
      let applied = 0;
      try {
        await appendCompanionEvents(toAppend, bound);
        applied = toAppend.length;
      } catch (err) {
        // Un conflicto inesperado no tira la página: se reintenta por
        // ítem saltando los que chocan (sus ids ya están confirmados).
        if (!(err instanceof CompanionEventConflictError)) throw err;
        for (const e of toAppend) {
          try {
            await appendCompanionEvents([e], bound);
            applied++;
          } catch {
            /* copia local divergente: se queda quieta */
          }
        }
      }
      return applied;
    }
    case "fields": {
      const registers = items as CompanionRegister[];
      const current = mergeCompanionRegister(
        await readCompanionRegisters(bound),
      );
      const before = new Map(current.map((r) => [r.field, r.operationId]));
      await putCompanionRegisters(registers as never[], bound);
      // El ganador por campo cambia solo si llega un operationId
      // distinto — un campo remoto ya dominado por uno local cuenta 0.
      const merged = mergeCompanionRegister([...current, ...registers]);
      let applied = 0;
      for (const r of merged)
        if (before.get(r.field) !== r.operationId) applied++;
      for (const r of registers) sets.fields.add(r.operationId);
      return applied;
    }
    case "receipts": {
      const receipts = items as CompanionReceipt[];
      const known = new Map(
        (await listCompanionReceipts(bound)).map((r) => [r.id, r.at]),
      );
      let applied = 0;
      for (const r of receipts) {
        const cur = known.get(r.id);
        if (cur === undefined || r.at < cur) applied++;
      }
      await mergeCompanionReceipts(receipts, bound);
      for (const r of receipts) sets.receipts.add(r.id);
      return applied;
    }
  }
}

// Baja una colección completa paginando desde el inicio. Devuelve los
// ítems recibidos y los que incorporaron algo nuevo, o null si una
// página falló, vino inválida o el contexto venció — en ese caso no
// se toca el sello de confirmados.
async function pullKind(
  kind: CompanionKind,
  bound: DbScope,
  sets: AckedSets,
): Promise<{ received: number; applied: number } | null> {
  let cursor: string | null = null;
  let received = 0;
  let applied = 0;
  for (;;) {
    if (!isDbScopeActive(bound)) return null;
    const url =
      `/api/companion?kind=${kind}` +
      (cursor !== null ? `&after=${encodeURIComponent(cursor)}` : "");
    let data: unknown;
    try {
      const response = await accountFetch(url, undefined, bound);
      if (!response.ok) return null;
      data = await response.json();
    } catch {
      return null;
    }
    if (!isDbScopeActive(bound)) return null;
    const page = cleanPage(data, kind);
    if (!page) return null;
    // El cursor debe avanzar: uno igual o menor repetiría la página
    // para siempre — se trata como respuesta inválida.
    if (
      page.nextCursor !== null &&
      cursor !== null &&
      page.nextCursor <= cursor
    )
      return null;
    try {
      applied += await mergePage(kind, page.items, bound, sets);
    } catch {
      return null;
    }
    received += page.items.length;
    if (page.nextCursor === null) return { received, applied };
    cursor = page.nextCursor;
  }
}

// El `at` con que nace cada recepción de logro reconciliada: el
// primer evento del journal en cuyo punto acumulado el logro ya se
// alcanzaba. Replica la misma acumulación que la proyección —
// minutos por lectura, contadores, libros elegibles por hash y la
// racha recorrida por dayKeys ordenados — así el sello es el real del
// desbloqueo y une por mínimo con lo que otra réplica haya puesto.
function creditStamps(
  snapshot: CompanionSnapshot,
  ids: string[],
): Map<string, number> {
  const wanted = ACHIEVEMENTS.filter((a) => ids.includes(a.id));
  const out = new Map<string, number>();
  const base = mergeLegacyBaselines(snapshot.baselines);
  const stats: GameStats = { ...base.stats };
  const mark = (at: number, view: GameStats) => {
    for (const a of wanted)
      if (!out.has(a.id) && a.check(view)) out.set(a.id, at);
  };
  // Ya desbloqueado por los baselines solos: no hay evento claro, el
  // llamador lo sella con la fecha actual.
  mark(NaN, stats);

  const seen = new Set<string>();
  const events = [...snapshot.events]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const finished = new Set(base.finishedBooks);
  const dayFirstAt = new Map<string, number>();
  for (const e of events) {
    if (!dayFirstAt.has(e.dayKey)) dayFirstAt.set(e.dayKey, e.at);
    const ev = e.event;
    switch (ev.kind) {
      case "read": {
        const ms = e.interval ? e.interval.endedAt - e.interval.startedAt : ev.ms;
        const minutes = ms / 60_000;
        stats.minutes += minutes;
        stats.longestSessionMin = Math.max(stats.longestSessionMin, minutes);
        break;
      }
      case "consulted":
        stats.consulted += 1;
        break;
      case "saved":
        stats.saved += 1;
        if (ev.zipf !== null && ev.zipf < RARE_ZIPF_BELOW) stats.rareSaved += 1;
        break;
      case "review":
        stats.reviews += 1;
        break;
      case "book_finished":
        if (e.bookCreditEligible === true) finished.add(ev.bookHash);
        break;
    }
    stats.booksFinished = Math.max(stats.booksFinished, finished.size);
    mark(e.at, stats);
  }

  // La racha se recorre por dayKeys ordenados, como la proyección; el
  // desbloqueo se sella con el primer evento del día que la cruza.
  let { lastDayKey, streakDays } = base.stats;
  const days = [...new Set(events.map((e) => e.dayKey))].sort();
  for (const day of days) {
    if (lastDayKey !== null && day <= lastDayKey) continue;
    const gap = lastDayKey ? daysBetween(day, lastDayKey) : Infinity;
    streakDays = gap === 1 ? streakDays + 1 : 1;
    lastDayKey = day;
    mark(dayFirstAt.get(day)!, { ...stats, streakDays, lastDayKey });
  }
  return out;
}

// Tras el pull pueden faltar recepciones «achievement-credit» de
// logros que el journal ya alcanza (los descubrió otro dispositivo).
// Se anexan sin llamar a award ni emitir nada: es reconciliación de
// metadatos, jamás actividad nueva.
async function reconcileCredits(bound: DbScope): Promise<number | null> {
  if (!isDbScopeActive(bound)) return null;
  const snapshot = await loadGameSnapshot(bound);
  const pending = pendingAchievementCredits(snapshot);
  if (!pending.length) return 0;
  const stamps = creditStamps(snapshot, pending);
  const known = new Map(snapshot.receipts.map((r) => [r.id, r.at]));
  const receipts: CompanionReceipt[] = [];
  for (const id of pending) {
    const rid = receiptIdFor("achievement-credit", id);
    const stamp = stamps.get(id);
    const at = stamp !== undefined && Number.isFinite(stamp) ? stamp : Date.now();
    const cur = known.get(rid);
    if (cur === undefined || at < cur) receipts.push({ id: rid, at });
  }
  if (!receipts.length) return 0;
  if (!isDbScopeActive(bound)) return null;
  await mergeCompanionReceipts(receipts, bound);
  return receipts.length;
}

// ---------- Ciclo y planificador ----------

// Verdadero mientras corre un ciclo: el aviso que el propio ciclo
// emite tras fusionar lo bajado no debe reprogramar otro ciclo (el
// push ya corrió dentro). Solo los commits externos programan.
let inCycle = false;

async function cycle(bound: DbScope): Promise<CompanionSyncResult | null> {
  inCycle = true;
  try {
    if (!bound.userId || !isDbScopeActive(bound)) return null;
    const sets = ackedSets(await readCompanionAcked(bound));
    let pulled = 0;
    let applied = 0;
    for (const kind of KINDS) {
      const page = await pullKind(kind, bound, sets);
      if (page === null) return null;
      pulled += page.received;
      applied += page.applied;
    }
    if (!isDbScopeActive(bound)) return null;
    // Lo bajado queda confirmado antes de empujar: así un evento
    // divergente (mismo id, otro contenido) no se reenvía nunca — el
    // servidor ya tiene SU versión — y lo bajado no vuelve a subir.
    await persistAcked(sets, bound);
    const credits = await reconcileCredits(bound);
    if (credits === null) return null;
    if (!(await pushCompanionChanges(bound))) return null;
    if (!isDbScopeActive(bound)) return null;
    await saveSessionValue(LAST_SYNC_KEY, String(Date.now()), bound);
    const pending = pendingCount(
      await pendingBatch(bound, ackedSets(await readCompanionAcked(bound))),
    );
    // Si se incorporó algo nuevo, la caché proyectada quedó vieja:
    // se suelta y se avisa — así la UI muestra lo bajado sin recargar.
    // (Recibir ítems que ya se tenían — barrido completo cada ciclo —
    // no cuenta: avisar por ellos re-dispararía el planificador.)
    if (applied > 0 || credits > 0) {
      resetGameCache();
      emitGameChanged();
    }
    return { pulled, pending };
  } catch {
    return null;
  } finally {
    inCycle = false;
  }
}

let inflight: Promise<CompanionSyncResult | null> | null = null;
let rerunRequested = false;

// Un ciclo en vuelo por cuenta: si entra otro llamado mientras corre
// se marca la repetición y, al terminar, corre un ciclo más con el
// contexto que esté vigente entonces (una cuenta nueva hereda la
// pasada; una vencida la aborta el propio ciclo).
export function syncCompanion(
  scope?: DbScope,
): Promise<CompanionSyncResult | null> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return Promise.resolve(null);
  if (inflight) {
    rerunRequested = true;
    return inflight;
  }
  const run = (async () => {
    let result = await cycle(bound);
    while (rerunRequested) {
      rerunRequested = false;
      const next = captureDbScope();
      if (!next.userId || !isDbScopeActive(next)) break;
      const again = await cycle(next);
      if (!again) break;
      result = result
        ? { pulled: result.pulled + again.pulled, pending: again.pending }
        : again;
    }
    return result;
  })();
  inflight = run;
  void run.then(
    () => {
      if (inflight === run) inflight = null;
    },
    () => {
      if (inflight === run) inflight = null;
    },
  );
  return run;
}

// Planificador: las escrituras del juego (cada commit avisa por
// subscribeGame) se agrupan en un envío a los 2 s y el ritmo queda
// tapado a un ciclo cada 15 s — ningún gesto decorativo genera red.
const FLUSH_DELAY_MS = 2_000;
const MIN_CYCLE_MS = 15_000;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastCycleAt = 0;

async function runScheduled() {
  const elapsed = Date.now() - lastCycleAt;
  if (lastCycleAt > 0 && elapsed < MIN_CYCLE_MS) {
    if (flushTimer === null)
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void runScheduled();
      }, MIN_CYCLE_MS - elapsed);
    return;
  }
  lastCycleAt = Date.now();
  const result = await syncCompanion().catch(() => null);
  // Ciclo fallido o sin cuenta: no cuenta contra el mínimo — el
  // próximo cambio reintenta sin esperar el cuarto de minuto.
  if (result === null) lastCycleAt = 0;
}

// Punto de entrada del planificador: «hubo un cambio, programa el
// envío». Devuelve void — quien llama no espera la red.
export function scheduleCompanionSync(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void runScheduled();
  }, FLUSH_DELAY_MS);
}

// Alias semántico para quien escribe datos (el notify del juego):
// misma acción con el nombre que se lee en el llamador.
export const requestCompanionSync = scheduleCompanionSync;

// El juego ya avisa cada commit (award, cofre, recepción, campo de
// perfil): la suscripción vive aquí y game.ts no necesita conocer
// este módulo. El aviso que emite el propio ciclo tras el pull se
// omite — los datos ya quedaron empujados en esa misma pasada.
subscribeGame(() => {
  if (!inCycle) scheduleCompanionSync();
});

// Al volver a la app (otra pestaña, minimizada o el dispositivo que
// se dejó abierto) corre un ciclo: así lo que subió otro dispositivo
// aparece sin recargar. MIN_CYCLE_MS ya amortigua ráfagas de refocus.
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void runScheduled();
  });
if (typeof window !== "undefined")
  window.addEventListener("focus", () => void runScheduled());
