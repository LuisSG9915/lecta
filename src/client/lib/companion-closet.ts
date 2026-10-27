// Armario del compañero: toda la lógica que decide QUÉ se ve y QUÉ falta.
//
// Reglas que este módulo hace cumplir (y que antes vivían repartidas entre
// el componente y el proveedor):
// - Un pelaje no es una prenda: vive en su selector y no en la rejilla.
// - Cada prenda sabe exigir su requisito con NÚMEROS: lo que falta de nivel
//   o el avance del logro («38 de 100 palabras»), nunca un candado mudo.
// - Los pelajes legados con id de paleta (tuxedo, latte, ginger, mist,
//   calico) no se muestran: no los otorga ninguna ruta de recompensa y
//   dibujan la misma paleta que su pelaje-* equivalente. Se conservan en el
//   catálogo porque un registro guardado con ese id debe seguir validando.
//
// Lógica pura: entra el estado del juego, sale lo que la hoja pinta.

import {
  COMPANION_ARTICLES,
  COMPANION_COATS,
  COMPANION_COAT_IDS,
  type BookMood,
  type CompanionArticle,
  type CompanionCoatId,
  type EquippedItems,
  type EquippedSlot,
} from "../../shared/companion-data";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_FAMILIES,
  COAT_LEVELS,
  FAMILY_METRIC,
  ITEM_ACHIEVEMENT_REWARDS,
  LEVELS,
  rewardForLevel,
  type Achievement,
  type GameState,
} from "./gamification";

// Orden de pintado de las ranuras: de la cabeza a los pies.
export const SLOT_ORDER: EquippedSlot[] = ["head", "neck", "face", "body", "coat"];

export const SLOT_LABELS: Record<EquippedSlot, string> = {
  head: "Cabeza",
  neck: "Cuello",
  face: "Ojos",
  body: "Escenario",
  coat: "Pelaje",
};

// Seis vistas de una sola dimensión: las prendas por ranura, el pelaje
// (que no es prenda) y los looks (que son conjuntos). Una a la vez — el
// panel mide 226 px y apilar bloques dejaba la rejilla fuera de pantalla.
export type ClosetFilter = "all" | "looks" | EquippedSlot;

export const CLOSET_FILTERS: { id: ClosetFilter; label: string }[] = [
  { id: "all", label: "Todo" },
  { id: "head", label: SLOT_LABELS.head },
  { id: "neck", label: SLOT_LABELS.neck },
  { id: "face", label: SLOT_LABELS.face },
  { id: "body", label: SLOT_LABELS.body },
  { id: "coat", label: SLOT_LABELS.coat },
  { id: "looks", label: "Looks" },
];

// Nombres visibles. Los pelajes usan el nombre de su paleta («Naranja
// Miel», no «Atigrado») para que el selector y la rejilla hablen igual.
export const ARTICLE_LABELS: Record<string, string> = {
  chaleco: "Chaleco",
  capa: "Capa de terciopelo",
  bufanda: "Bufanda",
  collar: "Collar",
  corbatin: "Corbatín",
  moño: "Moño",
  boina: "Boina de provincia",
  anteojos: "Anteojos",
  monoculo: "Monóculo",
  tuxedo: "Tuxedo",
  latte: "Crema Canela",
  ginger: "Naranja Miel",
  mist: "Gris Neblina",
  calico: "Calicó Literario",
  beret_poet: "Boina de Poeta",
  wizard_hat: "Sombrero de Sabio",
  laurel_crown: "Corona de Laurel",
  headphones_cozy: "Audífonos de Estudio",
  scarf_amber: "Bufanda de Invierno",
  cape_modernist: "Capa Azul de Darío",
  bowtie_scholar: "Moño de Académico",
  detective_cape: "Esclavina de Detective",
  glasses_round: "Gafas de Lectura",
  monocle_gold: "Monóculo de Crítico",
  stage_rainy_window: "Ventana Lluviosa",
  stage_ancient_library: "Biblioteca Nocturna",
  panuelo: "Pañuelo de lectura",
  gafas_sol: "Gafas de sol",
  abrigo: "Abrigo de invierno",
  pluma: "Pluma de escribano",
};

// Una línea por prenda, en la voz del armario: qué es y por qué existe.
export const ARTICLE_STORIES: Record<string, string> = {
  chaleco: "Lana de biblioteca y botones de nácar gastado. El primero de todos.",
  capa: "Terciopelo de teatro para leer en voz alta cuando nadie mira.",
  bufanda: "Tejida en una tarde de lluvia; todavía huele a invierno.",
  collar: "Un cascabel discreto para que se sepa por dónde andas.",
  corbatin: "Corbatín de recital: el nudo torcido de quien llega tarde a su libro.",
  moño: "Moño de regalo: alguien pensó que un libro era para ti.",
  boina: "Ladeada con deliberación, como quien subraya sin lápiz.",
  anteojos: "Con estos puestos, el mundo se ordena en renglones.",
  monoculo: "Mira la página como si tuviera algo que demostrarle.",
  // Pelajes: la descripción de la paleta manda (ver COMPANION_COATS).
  beret_poet: "La usa quien lee de un tirón y luego suspira sin motivo.",
  wizard_hat: "Para quien repasa hasta que las palabras le obedecen.",
  laurel_crown: "Cinco libros terminados, ningún resumen de por medio.",
  headphones_cozy: "Una hora de mundo apagado, sólo la página.",
  scarf_amber: "Siete días seguidos sin fallar: eso abriga de verdad.",
  cape_modernist: "Azul de Darío, con un cisne bordado en el forro.",
  bowtie_scholar: "Se anuda solo cuando preguntas mucho y bien.",
  detective_cape: "Para cazar palabras raras por las calles del libro.",
  glasses_round: "Cien palabras guardadas y ya no se lee igual.",
  monocle_gold: "Vocabulario firme, opinión formada, ceja levantada.",
  stage_rainy_window: "Leer mientras afuera llueve es un privilegio de tarde.",
  stage_ancient_library: "Veinticinco horas y una lámpara que nunca se apaga.",
  panuelo: "Metido al cuello antes de ir a la biblioteca: abriga poco y adorna mucho.",
  gafas_sol: "Para leer al sol y no perderse la página por un destello.",
  abrigo: "De lana gruesa y dos botones, para las tardes que no acaban de calentar.",
  pluma: "De escribano: la usó para marcar la última página del primer libro que terminó.",
};

// Ids de paleta antiguos que no se muestran (ver cabecera).
export const HIDDEN_ARTICLES: readonly string[] = [
  "tuxedo",
  "latte",
  "ginger",
  "mist",
  "calico",
];

const ALL_ARTICLES = Object.keys(COMPANION_ARTICLES) as CompanionArticle[];

const isCoatPalette = (article: CompanionArticle): boolean =>
  COMPANION_ARTICLES[article] === "coat";

// Prendas de una ranura (sin pelajes: esos van en `coatCards`).
export const articlesFor = (slot: EquippedSlot): CompanionArticle[] =>
  ALL_ARTICLES.filter(
    (article) =>
      COMPANION_ARTICLES[article] === slot &&
      slot !== "coat" &&
      !HIDDEN_ARTICLES.includes(article),
  );

// Los pelajes del selector, como tarjetas con su paleta y su nombre.
export interface CoatCard {
  id: CompanionCoatId;
  article: CompanionArticle;
  name: string;
  story: string;
  fur: string;
  chest: string;
}

export const coatCards = (): CoatCard[] =>
  COMPANION_COAT_IDS.map((id) => {
    const coat = COMPANION_COATS[id];
    return {
      id,
      article: coat.articleId as CompanionArticle,
      name: coat.name,
      story: coat.description,
      fur: coat.fur,
      chest: coat.chest,
    };
  });

// Artículos de la rejilla según el filtro activo. `null` = «sin prenda»
// (la fila vacía se pinta aparte, al principio de la rejilla).
export const gridArticles = (filter: ClosetFilter): CompanionArticle[] =>
  filter === "all"
    ? (["head", "neck", "face", "body"] as EquippedSlot[]).flatMap(articlesFor)
    : filter === "coat" || filter === "looks"
      ? []
      : articlesFor(filter);

// Lo tuyo primero: en «Todo» lo que ya puedes usar no puede quedar
// enterrado bajo veinte candados. El resto conserva el orden de ranura.
export function sortForGrid(
  articles: readonly CompanionArticle[],
  owned: ReadonlySet<string>,
  seasonal?: string | null,
): CompanionArticle[] {
  return [...articles].sort((a, b) => {
    // La de temporada es la primera: el motivo del día manda sobre el orden.
    const seaA = a === seasonal ? 0 : 1;
    const seaB = b === seasonal ? 0 : 1;
    if (seaA !== seaB) return seaA - seaB;
    const ownA = owned.has(a) ? 0 : 1;
    const ownB = owned.has(b) ? 0 : 1;
    return ownA - ownB;
  });
}

// ---- Requisitos ----

export type ClosetRequirement =
  | { kind: "free" }
  | {
      kind: "level";
      level: number;
      missing: number;
      ratio: number;
      text: string;
      // La distancia en la moneda que el lector entiende: minutos de
      // lectura (1 punto = 1 minuto leído).
      equivalent: string;
    }
  | {
      kind: "achievement";
      achievementId: string;
      title: string;
      desc: string;
      current: number;
      goal: number;
      ratio: number;
      text: string;
    };

// Nivel visible (1-based) que desbloquea la prenda, o null si no es de nivel.
export function requiredLevel(article: string): number | null {
  const coat = COAT_LEVELS[article];
  if (coat !== undefined) return coat + 1;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (rewardForLevel(i) === article) return i + 1;
  }
  return null;
}

// Puntos de tinta → tiempo de lectura. 1 punto = 1 minuto leído, así que
// «faltan 320 pts» es «unas 5 h 20 min leyendo»: la distancia se entiende.
export function readingTimeFor(points: number): string {
  const total = Math.max(0, Math.round(points / 5) * 5);
  if (total < 60) return `≈ ${total} min de lectura`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0
    ? `≈ ${hours} h de lectura`
    : `≈ ${hours} h ${minutes} min de lectura`;
}

const achievementFor = (article: string): Achievement | null => {
  const reward = ITEM_ACHIEVEMENT_REWARDS[article];
  if (!reward) return null;
  return ACHIEVEMENTS.find((a) => a.id === reward.id) ?? null;
};

// Requisito legible: lo que falta para tener la prenda, con número.
// `null` = prenda sin requisito (el chaleco) o ya disponible.
export function closetRequirement(
  article: CompanionArticle,
  state: GameState | null,
  owned: ReadonlySet<string>,
): ClosetRequirement | null {
  if (owned.has(article)) return null;
  if (!state) return null;

  // El logro va primero: cuando una prenda tiene dos caminos (el corbatín es
  // regalo del nivel 2 y del logro de diez minutos), manda el más corto —
  // el comportamiento concreto, no la escalera abstracta.
  const ach = achievementFor(article);
  if (ach) {
    const current = Math.floor(FAMILY_METRIC[ach.family](state.stats));
    const goal = ach.goal;
    const unit = ACHIEVEMENT_FAMILIES[ach.family].unit;
    const ratio = goal > 0 ? Math.min(1, Math.max(0, current / goal)) : 0;
    // «Horas leídas» cuenta horas en el logro y minutos en las estadísticas:
    // se muestra con un decimal; el resto va en unidades enteras.
    const shownCurrent =
      ach.family === "lectura" ? Math.round(current * 10) / 10 : Math.floor(current);
    const percent = Math.round(ratio * 100);
    const progressText =
      shownCurrent === 0
        ? ""
        : goal >= 5
          ? `${shownCurrent} de ${goal} ${goal === 1 ? unit.singular : unit.plural}`
          : `${percent}%`;
    return {
      kind: "achievement",
      achievementId: ach.id,
      title: ach.title,
      desc: ach.desc,
      current: shownCurrent,
      goal,
      ratio,
      text: progressText ? `${ach.desc} · ${progressText}` : ach.desc,
    };
  }

  const level = requiredLevel(article);
  if (level !== null) {
    const index = level - 1;
    const start = LEVELS[index]?.xp ?? 0;
    const prev = index > 0 ? (LEVELS[index - 1]?.xp ?? 0) : 0;
    const missing = Math.max(0, Math.ceil(start - state.xp));
    const ratio = start > prev ? Math.min(1, Math.max(0, (state.xp - prev) / (start - prev))) : 1;
    return {
      kind: "level",
      level,
      missing,
      ratio,
      text: missing > 0 ? `Nivel ${level} · faltan ${missing} pts` : `Nivel ${level}`,
      equivalent: missing >= 10 ? readingTimeFor(missing).replace("≈ ", "unas ") : "",
    };
  }

  return { kind: "free" };
}

export interface ClosetHint {
  article: CompanionArticle;
  label: string;
  requirement: ClosetRequirement;
  ratio: number;
  // Cuánto falta en su propia unidad: desempata cuando nadie avanza aún.
  distance: number;
}

const distanceOf = (req: ClosetRequirement): number =>
  req.kind === "level"
    ? req.missing
    : req.kind === "achievement"
      ? Math.max(0, req.goal - req.current)
      : 0;

// A igual avance (típico al empezar, todo en 0 %) manda la escalera de
// niveles antes que los logros: «faltan 30 pts» es una distancia
// comparable; «1 hora» y «30 puntos» no lo son.
const kindRank = (req: ClosetRequirement): number =>
  req.kind === "level" ? 0 : req.kind === "achievement" ? 1 : 2;

// La prenda bloqueada MÁS CERCA de conseguirse: es la frase que convierte
// el armario en una lista de cosas por hacer («a 13 puntos de las Gafas»).
export function nextUnlock(
  state: GameState | null,
  owned: ReadonlySet<string>,
  candidates: readonly CompanionArticle[],
): ClosetHint | null {
  if (!state) return null;
  let best: ClosetHint | null = null;
  for (const article of candidates) {
    if (owned.has(article)) continue;
    const requirement = closetRequirement(article, state, owned);
    if (!requirement || requirement.kind === "free") continue;
    const ratio = requirement.ratio;
    const distance = distanceOf(requirement);
    // Más avance gana; a igual avance, la escalera de niveles y dentro de
    // ella la meta más barata: a 30 puntos del corbatín antes que a 320 del
    // moño, y antes que el logro de «una hora» (que no es comparable).
    const wins =
      !best ||
      ratio > best.ratio + 1e-9 ||
      (Math.abs(ratio - best.ratio) <= 1e-9 &&
        (kindRank(requirement) < kindRank(best.requirement) ||
          (kindRank(requirement) === kindRank(best.requirement) &&
            distance < best.distance)));
    if (wins) {
      best = {
        article,
        label: labelFor(article),
        requirement,
        ratio,
        distance,
      };
    }
  }
  return best;
}

export function labelFor(article: CompanionArticle): string {
  if (isCoatPalette(article)) {
    const card = coatCards().find((c) => c.article === article);
    if (card) return card.name;
  }
  return ARTICLE_LABELS[article] ?? article;
}

export function storyFor(article: CompanionArticle): string {
  if (isCoatPalette(article)) {
    const card = coatCards().find((c) => c.article === article);
    if (card) return card.story;
  }
  return ARTICLE_STORIES[article] ?? "";
}

// ---- Inventario por ranura ----

export interface SlotInventory {
  slot: EquippedSlot;
  label: string;
  owned: number;
  total: number;
}

export function slotInventory(
  owned: ReadonlySet<string>,
  filter?: EquippedSlot,
): SlotInventory[] {
  const slots: EquippedSlot[] = filter
    ? [filter]
    : (["head", "neck", "face", "body", "coat"] as EquippedSlot[]);
  return slots.map((slot) => {
    const list =
      slot === "coat"
        ? coatCards().map((c) => c.article)
        : articlesFor(slot);
    return {
      slot,
      label: SLOT_LABELS[slot],
      owned: list.filter((article) => owned.has(article)).length,
      total: list.length,
    };
  });
}

// ---- Looks (un toque, cinco ranuras) ----

export interface CompanionLook {
  id: string;
  name: string;
  hint: string;
  // Sólo las ranuras que el look define; las ausentes se dejan como están.
  items: Partial<EquippedItems>;
}

export const COMPANION_LOOKS: CompanionLook[] = [
  // El primer look se puede poner desde el minuto cero (chaleco + el primer
  // pelaje): un «Looks» todo apagado no enseña para qué sirve.
  {
    id: "uniforme",
    name: "Uniforme de biblioteca",
    hint: "Chaleco y pelaje naranja",
    items: {
      body: "chaleco",
      coat: "pelaje-atigrado",
    },
  },
  {
    id: "lluvia",
    name: "Noche de lluvia",
    hint: "Ventana, bufanda y pelaje gris",
    items: {
      body: "stage_rainy_window",
      neck: "scarf_amber",
      coat: "pelaje-gris",
    },
  },
  {
    id: "detective",
    name: "Detective de biblioteca",
    hint: "Esclavina, boina y monóculo",
    items: {
      neck: "detective_cape",
      head: "beret_poet",
      face: "monocle_gold",
      coat: "pelaje-tuxedo",
    },
  },
  {
    id: "poeta",
    name: "Poeta de provincia",
    hint: "Corbatín, boina y pelaje atigrado",
    items: {
      neck: "corbatin",
      head: "boina",
      coat: "pelaje-atigrado",
    },
  },
];

export interface LookStatus {
  look: CompanionLook;
  // Prendas del look que esta copia ya tiene (las únicas que se ponen).
  available: Partial<EquippedItems>;
  missing: CompanionArticle[];
  ready: boolean;
}

export function lookStatus(
  look: CompanionLook,
  owned: ReadonlySet<string>,
): LookStatus {
  const available: Partial<EquippedItems> = {};
  const missing: CompanionArticle[] = [];
  for (const [slot, article] of Object.entries(look.items) as [
    EquippedSlot,
    string,
  ][]) {
    if (owned.has(article)) available[slot] = article;
    else missing.push(article as CompanionArticle);
  }
  return { look, available, missing, ready: missing.length === 0 };
}

// ---- Selección ----

// Distinta de `equipped`: es la prenda que la ficha describe. Se resuelve
// de forma determinista para que el estado inicial no dependa del render.
export function initialSelection(
  filter: ClosetFilter,
  equipped: EquippedItems,
): CompanionArticle | null {
  if (filter === "all" || filter === "looks") return null;
  const current = equipped[filter];
  if (current && !HIDDEN_ARTICLES.includes(current)) {
    return current as CompanionArticle;
  }
  const list = filter === "coat" ? coatCards().map((c) => c.article) : articlesFor(filter);
  return list[0] ?? null;
}

// ---- Voz del gato al vestirse ----

// Frase corta por ranura: el cambio de ropa es un momento, no un setState.
// Determinista (sin azar) para que la hoja sea predecible y probable.
const CLOSET_COMMENTS: Record<EquippedSlot, string> = {
  head: "Me queda bien, ¿verdad?",
  neck: "Un poco apretado, pero elegante.",
  face: "Ahora veo doble las metáforas.",
  body: "¿Salgo así a leer?",
  coat: "Mírame: otro gato, la misma biblioteca.",
};

export function closetComment(
  article: CompanionArticle | null,
): string | null {
  if (!article) return "Sin nada puesto, como vine al mundo.";
  const slot = COMPANION_ARTICLES[article];
  if (!slot) return null;
  return CLOSET_COMMENTS[slot] ?? null;
}

// ---- Look al azar ----

// «Sorpréndeme»: un look con lo que ya tienes. Probar ropa debe ser gratis
// y divertido; el azar sólo elige entre prendas TUYAS y siempre cambia al
// menos una ranura (un botón que no cambia nada no es un botón).
// `random` se inyecta para que la prueba sea determinista.
export function surpriseLook(
  owned: ReadonlySet<string>,
  equipped: EquippedItems,
  random: () => number = Math.random,
): Partial<EquippedItems> | null {
  const slots: EquippedSlot[] = ["head", "neck", "face", "body"];
  const optionsFor = (slot: EquippedSlot): (string | null)[] => {
    const list =
      slot === "coat"
        ? coatCards().map((c) => c.article).filter((a) => owned.has(a))
        : articlesFor(slot).filter((a) => owned.has(a));
    // Siempre existe «sin prenda»: quitarse algo también es un look.
    return [null, ...list];
  };
  const pick = (slot: EquippedSlot): string | null => {
    const options = optionsFor(slot);
    const index = Math.min(
      options.length - 1,
      Math.floor(random() * options.length),
    );
    return options[index] ?? null;
  };

  const next: Partial<EquippedItems> = {};
  for (const slot of [...slots, "coat" as EquippedSlot]) {
    next[slot] = pick(slot);
  }

  const changed = (Object.keys(next) as EquippedSlot[]).some(
    (slot) => (next[slot] ?? null) !== (equipped[slot] ?? null),
  );
  if (changed) return next;

  // Salió idéntico: cambia la primera ranura con más de una opción.
  for (const slot of [...slots, "coat" as EquippedSlot]) {
    const options = optionsFor(slot).filter(
      (article) => article !== (equipped[slot] ?? null),
    );
    if (options.length === 0) continue;
    next[slot] = options[0];
    return next;
  }
  return null;
}

// ---- Prenda de temporada ----

// Una ventana de calendario sobre una prenda que YA existe: no hay arte
// nuevo ni inventario paralelo, sólo un motivo para volver al armario y una
// prenda que se pone delante. Durante su ventana la tarjeta se etiqueta, va
// la primera de su ranura y el gato la propone en la pista.
export interface SeasonalWindow {
  // Mes inicial y final, 1 = enero. La ventana puede cruzar el año (12 → 2).
  from: number;
  to: number;
  article: CompanionArticle;
  label: string;
  // Qué se cuenta al usuario sobre por qué ahora.
  reason: string;
}

export const SEASONAL_WINDOWS: SeasonalWindow[] = [
  {
    from: 12,
    to: 2,
    article: "scarf_amber",
    label: "Bufanda de Invierno",
    reason: "Hace frío: es su temporada",
  },
  {
    from: 3,
    to: 5,
    article: "stage_rainy_window",
    label: "Ventana Lluviosa",
    reason: "Aguas de primavera: llueve en la página",
  },
  {
    from: 6,
    to: 8,
    article: "glasses_round",
    label: "Gafas de Lectura",
    reason: "Luz de verano: gafas para leer al sol",
  },
  {
    from: 9,
    to: 11,
    article: "cape_modernist",
    label: "Capa Azul de Darío",
    reason: "Otoño modernista: vuelve el azul de Darío",
  },
];

// Ventana activa para una fecha (mes 1–12) o null si ninguna aplica.
export function seasonalWindow(month: number): SeasonalWindow | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return (
    SEASONAL_WINDOWS.find((w) =>
      w.from <= w.to
        ? month >= w.from && month <= w.to
        : month >= w.from || month <= w.to,
    ) ?? null
  );
}

// Con la fecha real del dispositivo; se inyecta en pruebas.
export function seasonalNow(now: Date = new Date()): SeasonalWindow | null {
  return seasonalWindow(now.getMonth() + 1);
}

// ---- Ambiente por libro ----

// Cuatro ambientes: cada uno apunta a un look que ya existe. No inventamos
// ropa nueva, sólo damos al lector una forma de decir «para este libro, así».
export interface BookMoodOption {
  id: BookMood;
  name: string;
  hint: string;
  lookId: string;
}

export const BOOK_MOOD_OPTIONS: BookMoodOption[] = [
  {
    id: "poesia",
    name: "Poesía",
    hint: "Boina, corbatín y un gato de provincia",
    lookId: "poeta",
  },
  {
    id: "aventura",
    name: "Aventura",
    hint: "Chaleco de explorador de biblioteca",
    lookId: "uniforme",
  },
  {
    id: "misterio",
    name: "Misterio",
    hint: "Esclavina, monóculo y pelaje tinta",
    lookId: "detective",
  },
  {
    id: "clasico",
    name: "Clásico",
    hint: "Ventana lluviosa y bufanda de invierno",
    lookId: "lluvia",
  },
];

export function bookMoodOption(mood: BookMood | null): BookMoodOption | null {
  if (!mood) return null;
  return BOOK_MOOD_OPTIONS.find((m) => m.id === mood) ?? null;
}

// El look que corresponde al ambiente elegido para el libro abierto.
export function lookForMood(mood: BookMood | null): CompanionLook | null {
  const option = bookMoodOption(mood);
  if (!option) return null;
  return COMPANION_LOOKS.find((l) => l.id === option.lookId) ?? null;
}
