// Datos del compañero (el gato): contrato puro entre cliente y Worker
// para sincronizar el progreso por cuenta sin perder el avance que ya
// existía en gameState v1. Nada aquí toca IndexedDB, DOM, red ni
// reloj: la misma comparación corre en el cliente (proyección local)
// y en el servidor (validación del lote), para que ambas réplicas
// converjan al mismo resultado sin importar el orden de llegada.
//
// Modelo (plan «gato interactivo y sincronizado», contratos A–D):
// - baselines: fotos inmutables del gameState v1 previo a migrar, una
//   por réplica (originId). Se fusionan por MAYOR avance: el XP toma
//   el máximo (no se suma), los contadores toman el máximo por campo y
//   logros/libros/cofres se unen.
// - events: journal de actividad nueva con metadata congelada al emitir
//   (id, at, dayKey local del emisor, streakBonus). La proyección los
//   recorre en orden (at, id) y acredita cada id una sola vez.
// - registers: perfil mutable por campo; gana el mayor sello
//   (updatedAt, operationId) y null es dato legítimo (ropa quitada).
// - receipts: hechos monotónicos «<categoría>:<clave>» que unen por id
//   con el sello mínimo positivo. El XP de un logro siempre sale del
//   catálogo ACHIEVEMENTS, nunca del payload del cliente.

import {
  ACHIEVEMENTS,
  daysBetween,
  emptyGameState,
  LEVELS,
  levelFor,
  RARE_ZIPF_BELOW,
  rewardForLevel,
  STREAK_XP_BONUS,
  XP_REVIEW,
  type GameChest,
  type GameEvent,
  type GameState,
  type GameStats,
} from "./gamification";
import type { ReviewRating } from "./reading-data";

// ---------- Tipos del contrato ----------

// Foto inmutable del gameState v1 anterior a la migración. Se crea una
// vez por origen y no se vuelve a editar; una proyección que ya tiene
// eventos nuevos jamás se captura como baseline.
export interface LegacyGameBaseline {
  version: 1;
  originId: string;
  state: GameState;
}

// Evento del journal: la metadata la fija el emisor (incluido dayKey
// en SU zona horaria y el flag streakBonus ya decidido) para que el
// receptor no tenga que reinterpretar nada.
export interface GameJournalEvent {
  version: 1;
  id: string;
  at: number;
  dayKey: string;
  streakBonus: boolean;
  event: GameEvent;
  // Solo para book_finished: el emisor lo fija si el libro aún no
  // estaba terminado en su snapshot; la proyección acredita un solo
  // evento elegible por hash.
  bookCreditEligible?: boolean;
  interval?: { startedAt: number; endedAt: number };
}

export const COMPANION_FIELDS = [
  "enabled",
  "name",
  "readingPresence",
  "equipped.body",
  "equipped.neck",
  "equipped.head",
  "equipped.face",
  "equipped.coat",
  "lastCare",
] as const;
export type CompanionField = (typeof COMPANION_FIELDS)[number];

export const READING_PRESENCE = ["off", "visits", "always", "playful"] as const;
export type ReadingPresence = (typeof READING_PRESENCE)[number];

// Movimiento del compañero: «system» sigue al sistema operativo,
// «reduced» anima menos aunque el sistema no lo pida y «full» conserva
// las animaciones del gato aunque el sistema pida reducir.
export const COMPANION_MOTION = ["system", "reduced", "full"] as const;
export type CompanionMotion = (typeof COMPANION_MOTION)[number];

export type CompanionCare = { kind: "pet" | "feed" | "play"; at: number };

// Escritura de un campo del perfil. El valor permitido depende del
// campo: enabled boolean; name string; readingPresence uno de
// READING_PRESENCE; equipped.* id de accesorio o null explícito;
// lastCare CompanionCare. null cuenta como dato, no como ausencia.
export interface CompanionRegister {
  field: CompanionField;
  value: unknown;
  updatedAt: number;
  operationId: string;
}

export const RECEIPT_KINDS = [
  "achievement-credit",
  "chest-open",
  "achievement-seen",
  "stage-seen",
  "level-seen",
] as const;
export type CompanionReceiptKind = (typeof RECEIPT_KINDS)[number];

// Recepción monotónica: id «<categoría>:<clave>» y el primer sello
// positivo conocido. Las categorías no se mezclan — ver un logro no
// acredita y acreditar no marca como visto.
export interface CompanionReceipt {
  id: string;
  at: number;
}

export function receiptIdFor(kind: CompanionReceiptKind, key: string): string {
  return `${kind}:${key}`;
}

// La clave puede traer ":" propios (un cofre se abre con su clave
// canónica «level:2»), así que se corta solo en el primero.
export function parseReceiptId(
  id: string,
): { kind: CompanionReceiptKind; key: string } | null {
  const cut = id.indexOf(":");
  if (cut <= 0) return null;
  const kind = id.slice(0, cut);
  const key = id.slice(cut + 1);
  if (!key || !(RECEIPT_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as CompanionReceiptKind, key };
}

// Preferencias del dispositivo: viven solo en esta máquina y no se
// sincronizan (el sonido arranca apagado a propósito).
// Ambiente que el lector asignó a un libro («poesía», «misterio»…) para que
// el gato proponga su look. Es una preferencia de LECTURA, pero vive en el
// dispositivo: no viaja en el sync para no meter un registro nuevo en el
// contrato (y para no castigar a un cliente viejo con filas rechazadas).
export type BookMood = "poesia" | "aventura" | "misterio" | "clasico";

export const BOOK_MOODS: readonly BookMood[] = [
  "poesia",
  "aventura",
  "misterio",
  "clasico",
] as const;

export interface CompanionDevicePrefs {
  version: 1;
  soundEnabled: boolean;
  motion: CompanionMotion;
  // Por hash de libro: { "<bookHash>": "poesia" }
  bookMoods?: Partial<Record<string, BookMood>>;
}

// Todo lo que alimenta la proyección: baselines legados + journal +
// registros de perfil + recepciones.
export interface CompanionSnapshot {
  baselines: LegacyGameBaseline[];
  events: GameJournalEvent[];
  registers: CompanionRegister[];
  receipts: CompanionReceipt[];
}

// Lote que el cliente manda a PUT /api/companion: mismas cuatro
// colecciones del snapshot (los registros viajan en «fields»).
export type CompanionBatch = {
  version: 1;
  baselines: LegacyGameBaseline[];
  events: GameJournalEvent[];
  fields: CompanionRegister[];
  receipts: CompanionReceipt[];
};

// Catálogo inicial de prendas y su ranura (una por campo equipped.*).
// bufanda y collar comparten «neck» y se excluyen; las demás combinan.
// Los pelajes comparten «coat»: no son prenda sino el color del
// pelaje, y se desbloquean por nivel (COAT_LEVELS), no por cofre.
// «estampa» es recompensa de logro, no prenda, y no aparece aquí.
export const COMPANION_ARTICLES = {
  chaleco: "body",
  capa: "body",
  bufanda: "neck",
  collar: "neck",
  corbatin: "neck",
  moño: "head",
  boina: "head",
  anteojos: "face",
  monoculo: "face",
  "pelaje-atigrado": "coat",
  "pelaje-gris": "coat",
  "pelaje-calico": "coat",
  "pelaje-siames": "coat",
  "pelaje-negro": "coat",
  "pelaje-tuxedo": "coat",
  "pelaje-dorado": "coat",
  // Cinco pelajes principales (coatId):
  tuxedo: "coat",
  latte: "coat",
  ginger: "coat",
  mist: "coat",
  calico: "coat",
  // Nuevos accesorios Fase 3:
  beret_poet: "head",
  wizard_hat: "head",
  laurel_crown: "head",
  headphones_cozy: "head",
  scarf_amber: "neck",
  cape_modernist: "neck",
  bowtie_scholar: "neck",
  detective_cape: "neck",
  glasses_round: "face",
  monocle_gold: "face",
  stage_rainy_window: "body",
  stage_ancient_library: "body",
  // Plantilla de prendas nuevas (2026-10-26): cuatro ejemplos completos.
  panuelo: "neck",
  gafas_sol: "face",
  abrigo: "body",
  pluma: "head",
} as const;
export type CompanionArticle = keyof typeof COMPANION_ARTICLES;
export type EquippedSlot = (typeof COMPANION_ARTICLES)[CompanionArticle];

// Pelajes del gato compañero (Bloque 1): 5 paletas de pelaje con alto contraste
export type CompanionCoatId = "tuxedo" | "latte" | "ginger" | "mist" | "calico";

export interface CompanionCoatDef {
  id: CompanionCoatId;
  name: string;
  description: string;
  fur: string;
  chest: string;
  accent: string;
  eyes: string;
  nose: string;
  earInner: string;
  pawPads: string;
  rimLight?: string;
  articleId: string;
}

export const COMPANION_COATS: Record<CompanionCoatId, CompanionCoatDef> = {
  tuxedo: {
    id: "tuxedo",
    name: "Tinta y Crema",
    description: "Pelaje negro azulado aterciopelado con borde de luz y pecho blanco crema",
    fur: "#232730",
    chest: "#FAF3E8",
    accent: "#FAF3E8",
    eyes: "#E8A838",
    nose: "#E07A72",
    earInner: "#F4A698",
    pawPads: "#F4A698",
    rimLight: "#4A5264",
    articleId: "pelaje-tuxedo",
  },
  latte: {
    id: "latte",
    name: "Crema Canela",
    description: "Cuerpo crema tostado con orejas y patitas café canela y ojos azul zafiro",
    fur: "#F3E3CE",
    chest: "#FAF4EB",
    accent: "#8C6246",
    eyes: "#5B9BD5",
    nose: "#8A5A52",
    earInner: "#D9A78F",
    pawPads: "#D9A78F",
    articleId: "pelaje-siames",
  },
  ginger: {
    id: "ginger",
    name: "Naranja Miel",
    description: "Pelaje naranja cálido con rayitas frontales y ojos verde esmeralda",
    fur: "#E88846",
    chest: "#FFF6EA",
    accent: "#B85A22",
    eyes: "#4EA874",
    nose: "#E07A72",
    earInner: "#F4A698",
    pawPads: "#F4A698",
    articleId: "pelaje-atigrado",
  },
  mist: {
    id: "mist",
    name: "Gris Neblina",
    description: "Pelaje gris perla claro con sombras lavanda y ojos miel",
    fur: "#B8C2CC",
    chest: "#FFFFFF",
    accent: "#7E8896",
    eyes: "#D4A054",
    nose: "#C98A94",
    earInner: "#E2BAC2",
    pawPads: "#E2BAC2",
    articleId: "pelaje-gris",
  },
  calico: {
    id: "calico",
    name: "Calicó Literario",
    description: "Base crema marfil con manchas orgánicas en terracota y carbón suave",
    fur: "#FAF4EB",
    chest: "#FFFFFF",
    accent: "#D97941",
    eyes: "#4EA874",
    nose: "#E07A72",
    earInner: "#F4A698",
    pawPads: "#F4A698",
    articleId: "pelaje-calico",
  },
};

export const COMPANION_COAT_IDS: readonly CompanionCoatId[] = [
  "tuxedo",
  "latte",
  "ginger",
  "mist",
  "calico",
] as const;

export function resolveCoatId(articleOrCoatId?: string | null): CompanionCoatId {
  if (!articleOrCoatId) return "tuxedo";
  if (
    articleOrCoatId === "tuxedo" ||
    articleOrCoatId === "pelaje-tuxedo" ||
    articleOrCoatId === "pelaje-negro"
  )
    return "tuxedo";
  if (articleOrCoatId === "latte" || articleOrCoatId === "pelaje-siames")
    return "latte";
  if (
    articleOrCoatId === "ginger" ||
    articleOrCoatId === "pelaje-atigrado" ||
    articleOrCoatId === "pelaje-dorado"
  )
    return "ginger";
  if (articleOrCoatId === "mist" || articleOrCoatId === "pelaje-gris")
    return "mist";
  if (articleOrCoatId === "calico" || articleOrCoatId === "pelaje-calico")
    return "calico";
  return "tuxedo";
}

// ---------- Claves canónicas de cofres ----------

// Los cofres viejos tienen id uuid por dispositivo: dos réplicas del
// mismo baseline traen el mismo cofre con distinto id. La identidad
// real es el contenido — logro del catálogo o nivel cruzado — así que
// la clave canónica («achievement:<id>» / «level:<índice>») es lo que
// deduplica; lo que no se reconoce con certeza se conserva como
// «legacy:<id original>» sin adivinar ni borrar.
export function chestSourceKey(
  source: "achievement" | "level",
  ref: string | number,
): string {
  return `${source}:${ref}`;
}

export function canonicalChestKey(chest: GameChest): string {
  if (chest.source === "achievement") {
    const hit = ACHIEVEMENTS.find((a) => a.title === chest.label);
    if (hit) return chestSourceKey("achievement", hit.id);
    return `legacy:${chest.id}`;
  }
  // Los cofres de nivel nacieron como «Nivel N · nombre» con N base 1.
  // Solo se canonicaliza si el número y el nombre coinciden con el
  // catálogo — una coincidencia parcial no basta para reclamar la clave.
  const m = /^Nivel (\d+) · (.+)$/u.exec(chest.label);
  if (m) {
    const idx = Number(m[1]) - 1;
    if (
      String(idx + 1) === m[1] &&
      idx >= 0 &&
      idx < LEVELS.length &&
      LEVELS[idx].name === m[2]
    )
      return chestSourceKey("level", idx);
  }
  return `legacy:${chest.id}`;
}

type ChestKey =
  | { source: "achievement"; id: string }
  | { source: "level"; level: number }
  | { source: "legacy"; id: string };

// Parsea una clave canónica completa (la que lleva un receipt
// «chest-open:» o el id de un cofre ya fusionado). legacy acepta
// cualquier resto no vacío: es un id que no supimos mapear.
function parseChestKey(key: string): ChestKey | null {
  const cut = key.indexOf(":");
  if (cut <= 0) return null;
  const head = key.slice(0, cut);
  const rest = key.slice(cut + 1);
  if (!rest) return null;
  if (head === "achievement")
    return ACHIEVEMENTS.some((a) => a.id === rest)
      ? { source: "achievement", id: rest }
      : null;
  if (head === "level") {
    const n = /^\d+$/.test(rest) ? Number(rest) : NaN;
    return Number.isInteger(n) && n >= 0 && n < LEVELS.length && String(n) === rest
      ? { source: "level", level: n }
      : null;
  }
  if (head === "legacy") return { source: "legacy", id: rest };
  return null;
}

// ---------- Merge de baselines ----------

// Menor sello positivo; si ninguno lo es, conserva el mayor — mejor un
// sello extraño que un logro borrado por accidente.
const mergeStamp = (cur: number | undefined, at: number): number => {
  if (cur === undefined) return at;
  if (cur > 0 && at > 0) return Math.min(cur, at);
  return cur > 0 ? cur : Math.max(cur, at);
};

// Qué copia «representa» a un cofre duplicado: una abierta gana a una
// cerrada; entre abiertas la apertura más temprana, entre cerradas la
// creación más temprana; el id solo desempata para determinismo.
const chestRank = (c: GameChest): [number, number, string] =>
  c.openedAt !== null ? [1, c.openedAt, c.id] : [0, c.createdAt, c.id];

const rankLess = (a: [number, number, string], b: [number, number, string]) =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

interface ChestAcc {
  winner: GameChest;
  createdAt: number;
  openedAt: number | null;
}

const chestAccPut = (acc: ChestAcc | undefined, chest: GameChest): ChestAcc =>
  !acc
    ? { winner: chest, createdAt: chest.createdAt, openedAt: chest.openedAt }
    : {
        winner: rankLess(chestRank(chest), chestRank(acc.winner)) ? chest : acc.winner,
        createdAt: Math.min(acc.createdAt, chest.createdAt),
        openedAt:
          acc.openedAt !== null && chest.openedAt !== null
            ? Math.min(acc.openedAt, chest.openedAt)
            : (acc.openedAt ?? chest.openedAt),
      };

// Orden canónico de cofres: el de llegada no importa para el conjunto
// final, así que se ordena por (createdAt, id) para que la salida sea
// idéntica sin importar cómo se armó la lista de entrada.
const chestOrder = (a: GameChest, b: GameChest) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Une baselines tomando el mayor avance por campo: NO suma estados.
// XP=máximo; contadores=máximo por campo; libros y logros=unión (logro
// con el menor sello positivo); cofres=unión por clave canónica con
// apertura monotónica. La pareja (lastDayKey, streakDays) viaja junta
// del baseline con fecha más reciente — nunca se mezcla una fecha
// nueva con una racha vieja.
export function mergeLegacyBaselines(list: LegacyGameBaseline[]): GameState {
  const out = emptyGameState();
  const stats = out.stats;
  const books = new Set<string>();
  const chestByKey = new Map<string, ChestAcc>();

  for (const b of list) {
    const s = b.state;
    out.xp = Math.max(out.xp, s.xp);
    stats.minutes = Math.max(stats.minutes, s.stats.minutes);
    stats.longestSessionMin = Math.max(
      stats.longestSessionMin,
      s.stats.longestSessionMin,
    );
    stats.consulted = Math.max(stats.consulted, s.stats.consulted);
    stats.saved = Math.max(stats.saved, s.stats.saved);
    stats.rareSaved = Math.max(stats.rareSaved, s.stats.rareSaved);
    stats.reviews = Math.max(stats.reviews, s.stats.reviews);
    stats.booksFinished = Math.max(stats.booksFinished, s.stats.booksFinished);
    for (const hash of s.finishedBooks) books.add(hash);
    for (const [id, at] of Object.entries(s.achievements))
      out.achievements[id] = mergeStamp(out.achievements[id], at);
    out.caredAt = Math.max(out.caredAt, s.caredAt);

    // «YYYY-MM-DD» ordena cronológicamente como texto; null queda como
    // «sin fecha» y pierde contra cualquier día real.
    const candKey = s.stats.lastDayKey ?? "";
    const curKey = stats.lastDayKey ?? "";
    if (
      candKey > curKey ||
      (candKey === curKey && s.stats.streakDays > stats.streakDays)
    ) {
      stats.streakDays = s.stats.streakDays;
      stats.lastDayKey = s.stats.lastDayKey;
    }

    for (const chest of s.chests) {
      const key = canonicalChestKey(chest);
      chestByKey.set(key, chestAccPut(chestByKey.get(key), chest));
    }
  }

  // La cuenta nunca queda por debajo de los libros efectivamente unidos.
  stats.booksFinished = Math.max(stats.booksFinished, books.size);
  out.finishedBooks = [...books].sort();
  out.chests = [...chestByKey.entries()]
    .map(([key, acc]) => ({
      id: key,
      source: acc.winner.source,
      label: acc.winner.label,
      reward: acc.winner.reward,
      createdAt: acc.createdAt,
      openedAt: acc.openedAt,
    }))
    .sort(chestOrder);
  return out;
}

// ---------- Registros del perfil ----------

// Última escritura gana por campo con llave (updatedAt, operationId)
// comparada en código — nada de localeCompare ni reloj local: toda
// réplica con el mismo conjunto converge al mismo ganador, y un null
// (prenda quitada) compite y gana igual que cualquier valor.
export function mergeCompanionRegister(
  regs: CompanionRegister[],
): CompanionRegister[] {
  const byField = new Map<string, CompanionRegister>();
  for (const reg of regs) {
    const cur = byField.get(reg.field);
    if (
      !cur ||
      reg.updatedAt > cur.updatedAt ||
      (reg.updatedAt === cur.updatedAt && reg.operationId > cur.operationId)
    )
      byField.set(reg.field, reg);
  }
  return [...byField.values()].sort((a, b) =>
    a.field < b.field ? -1 : a.field > b.field ? 1 : 0,
  );
}

// Lo que el gato trae puesto por ranura; campo ausente o valor no
// texto = ranura vacía.
export type EquippedItems = Record<EquippedSlot, string | null>;

export function getEquippedItems(registers: CompanionRegister[]): EquippedItems {
  const out: EquippedItems = {
    body: null,
    neck: null,
    head: null,
    face: null,
    coat: null,
  };
  for (const reg of mergeCompanionRegister(registers)) {
    if (!reg.field.startsWith("equipped.")) continue;
    const slot = reg.field.slice("equipped.".length) as EquippedSlot;
    out[slot] = typeof reg.value === "string" ? reg.value : null;
  }
  return out;
}

// ---------- Proyección ----------

export interface GameProjection {
  state: GameState;
  // XP que aportó cada evento único del journal (0 cuando no contó:
  // libro ya acreditado, evento no elegible). La suma del mapa es lo
  // que los eventos agregan sobre el baseline.
  contributions: Map<string, number>;
  // Logros acreditados vía receipts «achievement-credit» conocidos.
  creditedAchievements: string[];
}

// Milisegundos que cuenta un read: el intervalo medido si viaja, si no
// el ms declarado (la validación exige que coincidan cuando hay ambos).
const readMsOf = (e: GameJournalEvent): number =>
  e.event.kind === "read"
    ? e.interval
      ? e.interval.endedAt - e.interval.startedAt
      : e.event.ms
    : 0;

// Aporte ya congelado: el bonus de racha se decidió al emitir y no se
// recalcula — el mismo ×1.1 con el mismo redondeo de applyGameEvent.
const withStreakBonus = (e: GameJournalEvent, c: number) =>
  e.streakBonus ? Math.round(c * STREAK_XP_BONUS * 10) / 10 : c;

// Une receipts por id con el sello mínimo positivo: repetidos (reenvío
// o merge de réplicas) no duplican ni borran una recepción.
const mergeReceipts = (receipts: CompanionReceipt[]): Map<string, number> => {
  const byId = new Map<string, number>();
  for (const r of receipts) {
    if (!(r.at > 0)) continue;
    const cur = byId.get(r.id);
    if (cur === undefined || r.at < cur) byId.set(r.id, r.at);
  }
  return byId;
};

function computeProjection(
  snapshot: CompanionSnapshot,
  now?: number,
): GameProjection {
  const base = mergeLegacyBaselines(snapshot.baselines);

  // Orden canónico (at, id): mismo conjunto de entrada produce la misma
  // salida sin depender del orden de llegada ni de relojes locales.
  const events = [...snapshot.events]
    .filter((e) => now === undefined || e.at <= now)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const unique: GameJournalEvent[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    // Mismo id = misma entrada; si las copias difieren queda la primera
    // en (at, id) — el conflicto real lo rechaza el servidor.
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    unique.push(e);
  }

  const receiptsById = mergeReceipts(
    snapshot.receipts.filter((r) => now === undefined || r.at <= now),
  );

  const stats: GameStats = { ...base.stats };
  const finishedBooks = new Set(base.finishedBooks);
  const contributions = new Map<string, number>();
  const achievements: Record<string, number> = { ...base.achievements };
  let caredAt = base.caredAt;

  // Los book_finished elegibles se agrupan por hash: un libro cerrado
  // acredita una sola vez aunque se termine en varios dispositivos.
  const bookGroups = new Map<string, GameJournalEvent[]>();

  for (const e of unique) {
    if (e.at > caredAt) caredAt = e.at;
    const ev = e.event;
    switch (ev.kind) {
      case "read": {
        const minutes = readMsOf(e) / 60_000;
        stats.minutes += minutes;
        stats.longestSessionMin = Math.max(stats.longestSessionMin, minutes);
        contributions.set(e.id, withStreakBonus(e, minutes));
        break;
      }
      case "consulted":
        stats.consulted += 1;
        contributions.set(e.id, withStreakBonus(e, 2));
        break;
      case "saved": {
        const rare = ev.zipf !== null && ev.zipf < RARE_ZIPF_BELOW;
        stats.saved += 1;
        if (rare) stats.rareSaved += 1;
        contributions.set(e.id, withStreakBonus(e, rare ? 7 : 3));
        break;
      }
      case "review":
        stats.reviews += 1;
        contributions.set(e.id, withStreakBonus(e, XP_REVIEW[ev.rating] ?? 1));
        break;
      case "book_finished":
        if (e.bookCreditEligible === true) {
          const group = bookGroups.get(ev.bookHash);
          if (group) group.push(e);
          else bookGroups.set(ev.bookHash, [e]);
        } else {
          contributions.set(e.id, 0);
        }
        break;
    }
  }

  // Un crédito por hash: dentro del grupo gana el mayor aporte ya
  // congelado (dos emisores pudieron fijar streakBonus distinto); al
  // empate queda el primero en (at, id), que es el orden de iteración.
  for (const [hash, group] of bookGroups) {
    let winner = group[0];
    let best = withStreakBonus(winner, 50);
    for (const e of group.slice(1)) {
      const c = withStreakBonus(e, 50);
      if (c > best) {
        best = c;
        winner = e;
      }
    }
    for (const e of group) contributions.set(e.id, e === winner ? best : 0);
    finishedBooks.add(hash);
  }
  stats.booksFinished = Math.max(base.stats.booksFinished, finishedBooks.size);

  // Racha: se replican los dayKey capturados por cada emisor (no la
  // zona del receptor) con la regla de applyGameEvent — día siguiente
  // suma uno, un salto de un solo día con racha ≥ 3 lo salva el
  // marcapáginas protector, cualquier otro hueco reinicia. La pareja del
  // baseline es el frente sellado: un día anterior o igual no rebobina la racha.
  let { lastDayKey, streakDays } = base.stats;
  const days = [...new Set(unique.map((e) => e.dayKey))].sort();
  for (const day of days) {
    if (lastDayKey !== null && day <= lastDayKey) continue;
    const gap = lastDayKey ? daysBetween(day, lastDayKey) : Infinity;
    const savedByShield = gap === 2 && streakDays >= 3;
    streakDays = gap === 1 || savedByShield ? streakDays + 1 : 1;
    lastDayKey = day;
  }
  stats.streakDays = streakDays;
  stats.lastDayKey = lastDayKey;

  // Créditos de logro: el XP sale del catálogo ACHIEVEMENTS, jamás del
  // payload. Se suman aunque un baseline tardío ya contenga el logro —
  // lo ganado no se retira (coincidencia viejo/nuevo aprobada). Se
  // recorren por (at, id) para sellos y cofres deterministas.
  const creditedAchievements: string[] = [];
  const creditAt = new Map<string, number>();
  let creditXp = 0;
  const sortedReceipts = [...receiptsById].sort(
    (a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  for (const [rid, at] of sortedReceipts) {
    const parsed = parseReceiptId(rid);
    if (!parsed || parsed.kind !== "achievement-credit") continue;
    const a = ACHIEVEMENTS.find((x) => x.id === parsed.key);
    if (!a) continue; // fuera del catálogo: no acredita ni marca
    creditedAchievements.push(a.id);
    creditAt.set(a.id, at);
    creditXp += a.xp;
    achievements[a.id] = mergeStamp(achievements[a.id], at);
  }

  let contributionSum = 0;
  for (const c of contributions.values()) contributionSum += c;
  const xp = base.xp + contributionSum + creditXp;

  // Línea de tiempo de ganancias para fechar los cofres de nivel: cada
  // evento aporta en su `at` y cada crédito en el sello de su receipt.
  const gains: { at: number; id: string; amt: number }[] = [];
  for (const e of unique)
    gains.push({ at: e.at, id: e.id, amt: contributions.get(e.id) ?? 0 });
  for (const [rid, at] of sortedReceipts) {
    const parsed = parseReceiptId(rid);
    if (!parsed || parsed.kind !== "achievement-credit") continue;
    const a = ACHIEVEMENTS.find((x) => x.id === parsed.key);
    if (a) gains.push({ at, id: rid, amt: a.xp });
  }
  gains.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const baseLevel = levelFor(base.xp);
  const crossedAt = new Map<number, number>();
  let running = base.xp;
  for (const g of gains) {
    const before = levelFor(running);
    running += g.amt;
    const after = levelFor(running);
    for (let lvl = before + 1; lvl <= after; lvl += 1)
      if (!crossedAt.has(lvl)) crossedAt.set(lvl, g.at);
  }

  // Cofres: los del baseline ya vienen canonicalizados del merge; los
  // nuevos nacen de receipts (logro) o de umbrales cruzados (nivel) con
  // id canónico. Nunca se duplica una clave que el baseline ya tenga.
  const chests = new Map<string, GameChest>();
  for (const c of base.chests) chests.set(c.id, { ...c });
  const openReceiptAt = (key: string): number | null =>
    receiptsById.get(receiptIdFor("chest-open", key)) ?? null;
  for (const c of chests.values()) {
    const opened = openReceiptAt(c.id);
    if (opened !== null && (c.openedAt === null || opened < c.openedAt))
      c.openedAt = opened;
  }
  for (const id of creditedAchievements) {
    const a = ACHIEVEMENTS.find((x) => x.id === id)!;
    const key = chestSourceKey("achievement", id);
    if (!chests.has(key))
      chests.set(key, {
        id: key,
        source: "achievement",
        label: a.title,
        reward: a.id.startsWith("libro_") ? "Exlibris conmemorativo" : `Estampa · ${a.title}`,
        createdAt: creditAt.get(id)!,
        openedAt: openReceiptAt(key),
      });
  }
  const finalLevel = levelFor(xp);
  for (let lvl = baseLevel + 1; lvl <= finalLevel; lvl += 1) {
    const key = chestSourceKey("level", lvl);
    if (!chests.has(key))
      chests.set(key, {
        id: key,
        source: "level",
        label: `Nivel ${lvl + 1} · ${LEVELS[lvl].name}`,
        reward: rewardForLevel(lvl),
        // Todo nivel ≤ finalLevel quedó cruzado en la línea de tiempo.
        createdAt: crossedAt.get(lvl)!,
        openedAt: openReceiptAt(key),
      });
  }

  const state: GameState = {
    version: 1,
    xp,
    stats,
    achievements,
    chests: [...chests.values()].sort(chestOrder),
    finishedBooks: [...finishedBooks].sort(),
    caredAt,
  };
  return { state, contributions, creditedAchievements };
}

// Proyección determinista del snapshot a un GameState listo para la UI.
// `now` acota «a fecha de»: eventos y receipts con at mayor se ignoran
// (omítelo para proyectar todo lo conocido).
export function projectGame(
  snapshot: CompanionSnapshot,
  now?: number,
): GameProjection {
  return computeProjection(snapshot, now);
}

// Los cofres visibles son los de la proyección: baseline canonicados +
// uno por crédito de logro + uno por nivel cruzado respecto al nivel
// del baseline.
export function projectChests(
  snapshot: CompanionSnapshot,
  now?: number,
): GameChest[] {
  return computeProjection(snapshot, now).state.chests;
}

// Logros que el journal NUEVO alcanza y que ni los baselines ni los
// receipts acreditaron todavía. Los baselines por sí solos no generan
// créditos: hace falta al menos un evento posterior a la migración.
// El llamador los guarda como receipts «achievement-credit:<id>» una
// sola vez, antes de publicar la UI.
export function pendingAchievementCredits(
  snapshot: CompanionSnapshot,
): string[] {
  if (snapshot.events.length === 0) return [];
  const { state } = computeProjection(snapshot);
  return ACHIEVEMENTS.filter(
    (a) => state.achievements[a.id] === undefined && a.check(state.stats),
  ).map((a) => a.id);
}

// Mejor racha histórica: parte de la racha sellada en los baselines y
// recorre los días activos del journal aplicando la misma regla de
// continuidad y marcapáginas protector (salto de 1 día con racha ≥ 3).
// Devuelve el máximo valor que alcanzó la racha.
export function bestStreak(snapshot: CompanionSnapshot): number {
  const base = mergeLegacyBaselines(snapshot.baselines);
  let maxStreak = base.stats.streakDays;
  let { lastDayKey, streakDays } = base.stats;

  const seen = new Set<string>();
  const unique: GameJournalEvent[] = [];
  for (const e of snapshot.events) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      unique.push(e);
    }
  }

  const days = [...new Set(unique.map((e) => e.dayKey))].sort();
  for (const day of days) {
    if (lastDayKey !== null && day <= lastDayKey) continue;
    const gap = lastDayKey ? daysBetween(day, lastDayKey) : Infinity;
    const savedByShield = gap === 2 && streakDays >= 3;
    streakDays = gap === 1 || savedByShield ? streakDays + 1 : 1;
    lastDayKey = day;
    if (streakDays > maxStreak) maxStreak = streakDays;
  }
  return maxStreak;
}

// ---------- Validación del lote (PUT /api/companion) ----------
//
// El servidor rechaza el lote completo si algo no cuadra — sin recorte
// silencioso. Los motivos van a logs: cortos, en inglés y sin eco del
// payload.

export const COMPANION_BATCH_LIMIT = 120;
export const COMPANION_ID_LIMIT = 200;
// Un read admite hasta 30 min de margen ante pestañas suspendidas; el
// rollover normal del lector sigue siendo de 5 min, esto es solo el
// límite de la API.
export const COMPANION_READ_MAX_MS = 30 * 60_000;
export const COMPANION_NAME_MAX = 24;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= COMPANION_ID_LIMIT;
const isStamp = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

// ¿«YYYY-MM-DD» existe en el calendario? Se valida por mes y año
// bisiesto en vez de Date.parse, que acepta desbordes («02-31»).
const isLeap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const MONTH_DAYS = [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const isDayKey = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  const max = month === 2 ? (isLeap(Number(m[1])) ? 29 : 28) : MONTH_DAYS[month - 1];
  return day >= 1 && day <= max;
};

// Nombre propio: 1–24 caracteres tras trim/NFC y sin controles.
const isCompanionName = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  const t = v.normalize("NFC").trim();
  const len = [...t].length;
  return len >= 1 && len <= COMPANION_NAME_MAX && !/\p{Cc}/u.test(t);
};

const isArticleFor = (slot: EquippedSlot) => (v: unknown) =>
  v === null ||
  (typeof v === "string" &&
    Object.hasOwn(COMPANION_ARTICLES, v) &&
    COMPANION_ARTICLES[v as CompanionArticle] === slot);

const FIELD_CHECKS: Record<CompanionField, (v: unknown) => boolean> = {
  enabled: (v) => typeof v === "boolean",
  name: isCompanionName,
  readingPresence: (v) => (READING_PRESENCE as readonly unknown[]).includes(v),
  "equipped.body": isArticleFor("body"),
  "equipped.neck": isArticleFor("neck"),
  "equipped.head": isArticleFor("head"),
  "equipped.face": isArticleFor("face"),
  "equipped.coat": isArticleFor("coat"),
  lastCare: (v) =>
    isObj(v) &&
    (v.kind === "pet" || v.kind === "feed" || v.kind === "play") &&
    isStamp(v.at),
};

// Shape v1 del gameState sellado en un baseline: XP finita ≥0 (puede
// ser fraccionaria), contadores enteros seguros, achievements como
// registro de sellos positivos y cofres con su forma completa.
function cleanGameState(v: unknown): GameState | null {
  if (!isObj(v) || v.version !== 1) return null;
  if (typeof v.xp !== "number" || !Number.isFinite(v.xp) || v.xp < 0) return null;
  const st = v.stats;
  if (!isObj(st)) return null;
  const real = (k: string) => {
    const n = st[k];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const int = (k: string) => {
    const n = st[k];
    return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const minutes = real("minutes");
  const longestSessionMin = real("longestSessionMin");
  const consulted = int("consulted");
  const saved = int("saved");
  const rareSaved = int("rareSaved");
  const reviews = int("reviews");
  const booksFinished = int("booksFinished");
  const streakDays = int("streakDays");
  if (
    minutes === null ||
    longestSessionMin === null ||
    consulted === null ||
    saved === null ||
    rareSaved === null ||
    reviews === null ||
    booksFinished === null ||
    streakDays === null
  )
    return null;
  const lastDayKey = st.lastDayKey;
  if (!(lastDayKey === null || isDayKey(lastDayKey))) return null;

  if (!isObj(v.achievements)) return null;
  const achievements: Record<string, number> = {};
  for (const [id, at] of Object.entries(v.achievements)) {
    if (
      id.length === 0 ||
      id.length > COMPANION_ID_LIMIT ||
      typeof at !== "number" ||
      !Number.isFinite(at) ||
      at <= 0
    )
      return null;
    achievements[id] = at;
  }

  if (!Array.isArray(v.chests)) return null;
  const chests: GameChest[] = [];
  for (const c of v.chests) {
    if (
      !isObj(c) ||
      !isId(c.id) ||
      (c.source !== "level" && c.source !== "achievement") ||
      typeof c.label !== "string" ||
      c.label.length === 0 ||
      c.label.length > COMPANION_ID_LIMIT ||
      typeof c.reward !== "string" ||
      c.reward.length > COMPANION_ID_LIMIT ||
      !isStamp(c.createdAt) ||
      !(c.openedAt === null || isStamp(c.openedAt))
    )
      return null;
    chests.push({
      id: c.id,
      source: c.source,
      label: c.label,
      reward: c.reward,
      createdAt: c.createdAt,
      openedAt: c.openedAt,
    });
  }

  if (!Array.isArray(v.finishedBooks) || v.finishedBooks.some((h) => !isId(h)))
    return null;
  if (
    typeof v.caredAt !== "number" ||
    !Number.isSafeInteger(v.caredAt) ||
    v.caredAt < 0
  )
    return null;

  return {
    version: 1,
    xp: v.xp,
    stats: {
      minutes,
      longestSessionMin,
      consulted,
      saved,
      rareSaved,
      reviews,
      booksFinished,
      streakDays,
      lastDayKey,
    },
    achievements,
    chests,
    finishedBooks: [...(v.finishedBooks as string[])],
    caredAt: v.caredAt,
  };
}

function cleanJournalEvent(v: unknown): GameJournalEvent | null {
  if (!isObj(v) || v.version !== 1) return null;
  if (!isId(v.id) || !isStamp(v.at) || !isDayKey(v.dayKey)) return null;
  if (typeof v.streakBonus !== "boolean") return null;
  if (v.bookCreditEligible !== undefined && typeof v.bookCreditEligible !== "boolean")
    return null;

  let interval: { startedAt: number; endedAt: number } | undefined;
  if (v.interval !== undefined) {
    if (
      !isObj(v.interval) ||
      !isStamp(v.interval.startedAt) ||
      !isStamp(v.interval.endedAt) ||
      v.interval.endedAt <= v.interval.startedAt
    )
      return null;
    interval = { startedAt: v.interval.startedAt, endedAt: v.interval.endedAt };
  }

  const ev = v.event;
  if (!isObj(ev) || typeof ev.kind !== "string") return null;
  let event: GameEvent;
  switch (ev.kind) {
    case "read": {
      if (
        typeof ev.ms !== "number" ||
        !Number.isFinite(ev.ms) ||
        ev.ms <= 0 ||
        ev.ms > COMPANION_READ_MAX_MS
      )
        return null;
      // Con intervalo presente el ms declarado es exactamente su duración.
      if (interval && ev.ms !== interval.endedAt - interval.startedAt) return null;
      event = { kind: "read", ms: ev.ms };
      break;
    }
    case "consulted":
      event = { kind: "consulted" };
      break;
    case "saved": {
      const z = ev.zipf;
      if (
        !(
          z === null ||
          (typeof z === "number" && Number.isFinite(z) && z >= 0 && z <= 10)
        )
      )
        return null;
      event = { kind: "saved", zipf: z };
      break;
    }
    case "review": {
      if (typeof ev.rating !== "string" || !Object.hasOwn(XP_REVIEW, ev.rating))
        return null;
      event = { kind: "review", rating: ev.rating as ReviewRating };
      break;
    }
    case "book_finished": {
      if (!isId(ev.bookHash)) return null;
      event = { kind: "book_finished", bookHash: ev.bookHash };
      break;
    }
    default:
      return null;
  }

  const out: GameJournalEvent = {
    version: 1,
    id: v.id,
    at: v.at,
    dayKey: v.dayKey,
    streakBonus: v.streakBonus,
    event,
  };
  if (v.bookCreditEligible !== undefined) out.bookCreditEligible = v.bookCreditEligible;
  if (interval) out.interval = interval;
  return out;
}

function cleanRegister(v: unknown): CompanionRegister | null {
  if (!isObj(v) || !isStamp(v.updatedAt) || !isId(v.operationId)) return null;
  if (
    typeof v.field !== "string" ||
    !(COMPANION_FIELDS as readonly string[]).includes(v.field)
  )
    return null;
  const field = v.field as CompanionField;
  if (!FIELD_CHECKS[field](v.value)) return null;
  return {
    field,
    value: v.value,
    updatedAt: v.updatedAt,
    operationId: v.operationId,
  };
}

export interface ValidateCompanionBatchOptions {
  unknownCatalog?: "reject" | "keep";
}

function cleanReceipt(
  v: unknown,
  options?: ValidateCompanionBatchOptions,
): CompanionReceipt | null {
  if (!isObj(v) || !isId(v.id) || !isStamp(v.at)) return null;
  const parsed = parseReceiptId(v.id);
  if (!parsed) {
    if (options?.unknownCatalog === "keep") {
      const cut = v.id.indexOf(":");
      if (cut > 0 && v.id.slice(cut + 1).length > 0) {
        return { id: v.id, at: v.at };
      }
    }
    return null;
  }
  switch (parsed.kind) {
    case "achievement-credit":
    case "achievement-seen":
      // Solo ids del catálogo: el XP siempre sale de ACHIEVEMENTS.
      if (!ACHIEVEMENTS.some((a) => a.id === parsed.key)) {
        if (options?.unknownCatalog === "keep") return { id: v.id, at: v.at };
        return null;
      }
      break;
    case "chest-open":
      if (!parseChestKey(parsed.key)) {
        if (options?.unknownCatalog === "keep") return { id: v.id, at: v.at };
        return null;
      }
      break;
    case "stage-seen": {
      // Etapas del gato: índices 0..4 en decimal canónico.
      if (!/^[0-4]$/.test(parsed.key)) {
        if (options?.unknownCatalog === "keep") return { id: v.id, at: v.at };
        return null;
      }
      break;
    }
    case "level-seen": {
      // Niveles del juego: índices 1..LEVELS.length - 1 en decimal canónico.
      const n = Number(parsed.key);
      if (!/^[1-9]$/.test(parsed.key) || n >= LEVELS.length) {
        if (options?.unknownCatalog === "keep") return { id: v.id, at: v.at };
        return null;
      }
      break;
    }
  }
  return { id: v.id, at: v.at };
}

// Valida el lote completo de PUT /api/companion. Devuelve el batch ya
// normalizado (mismos valores, campos extra descartados) o un motivo
// corto en inglés para logs. Además de la forma, rechaza el mismo id
// de baseline/evento llegando con contenido distinto dentro del lote —
// el servidor lo reporta como conflicto, no como duplicado inocuo.
export function validateCompanionBatch(
  body: unknown,
  options?: ValidateCompanionBatchOptions,
): { ok: true; batch: CompanionBatch } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (!isObj(body) || body.version !== 1) return fail("bad batch version");
  const { baselines, events, fields, receipts } = body;
  if (
    !Array.isArray(baselines) ||
    !Array.isArray(events) ||
    !Array.isArray(fields) ||
    !Array.isArray(receipts)
  )
    return fail("missing batch section");
  if (
    baselines.length + events.length + fields.length + receipts.length >
    COMPANION_BATCH_LIMIT
  )
    return fail("batch too large");

  const out: CompanionBatch = {
    version: 1,
    baselines: [],
    events: [],
    fields: [],
    receipts: [],
  };

  const baselineSigs = new Map<string, string>();
  for (const raw of baselines) {
    if (!isObj(raw) || raw.version !== 1 || !isId(raw.originId))
      return fail("bad baseline");
    const state = cleanGameState(raw.state);
    if (!state) return fail("bad baseline state");
    const clean: LegacyGameBaseline = { version: 1, originId: raw.originId, state };
    const sig = JSON.stringify(clean);
    const prev = baselineSigs.get(clean.originId);
    if (prev !== undefined && prev !== sig) return fail("conflicting baseline id");
    baselineSigs.set(clean.originId, sig);
    out.baselines.push(clean);
  }

  const eventSigs = new Map<string, string>();
  for (const raw of events) {
    const clean = cleanJournalEvent(raw);
    if (!clean) return fail("bad event");
    const sig = JSON.stringify(clean);
    const prev = eventSigs.get(clean.id);
    if (prev !== undefined && prev !== sig) return fail("conflicting event id");
    eventSigs.set(clean.id, sig);
    out.events.push(clean);
  }

  for (const raw of fields) {
    const clean = cleanRegister(raw);
    if (!clean) return fail("bad field");
    out.fields.push(clean);
  }

  for (const raw of receipts) {
    const clean = cleanReceipt(raw, options);
    if (!clean) return fail("bad receipt");
    out.receipts.push(clean);
  }

  return { ok: true, batch: out };
}
