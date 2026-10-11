// Juego del Cuaderno: puntos de lectura (XP), niveles, logros, cofres
// y el cuidado del gato de biblioteca. Lógica pura — ninguna función
// toca almacenamiento ni DOM; el estado entra y sale serializado para
// que la capa de IO (game.ts) lo guarde donde convenga.
//
// Vive en shared/ porque el cliente y el Worker deben usar la misma
// fuente de umbrales, fórmulas y XP por calificación (el servidor
// valida lotes del compañero sin reimplementar reglas).
//
// Decisiones de diseño:
// - El XP es fraccional internamente (un minuto de lectura = 1); la
//   interfaz muestra enteros. Así un intervalo corto no se pierde.
// - El gato se cuida con cualquier actividad real (cada award toca
//   caredAt): nunca pide atención extra, solo refleja el uso.
// - Los cofres guardan su contenido al crearse (reward ya resuelto),
//   para que abrir sea solo revelar — sin sorteos en el momento.

import type { ReviewRating } from "./reading-data";

// ---------- Estado ----------

export interface GameStats {
  minutes: number;
  longestSessionMin: number;
  consulted: number;
  saved: number;
  rareSaved: number;
  reviews: number;
  booksFinished: number;
  streakDays: number;
  lastDayKey: string | null;
}

export interface GameChest {
  id: string;
  source: "level" | "achievement";
  // Lo que dice la tarjeta cerrada y lo que revela al abrir.
  label: string;
  reward: string;
  createdAt: number;
  openedAt: number | null;
}

export interface GameState {
  version: 1;
  xp: number;
  stats: GameStats;
  // id de logro → cuándo se desbloqueó.
  achievements: Record<string, number>;
  chests: GameChest[];
  finishedBooks: string[];
  caredAt: number;
}

export const emptyGameState = (): GameState => ({
  version: 1,
  xp: 0,
  stats: {
    minutes: 0,
    longestSessionMin: 0,
    consulted: 0,
    saved: 0,
    rareSaved: 0,
    reviews: 0,
    booksFinished: 0,
    streakDays: 0,
    lastDayKey: null,
  },
  achievements: {},
  chests: [],
  finishedBooks: [],
  caredAt: 0,
});

// ---------- Eventos ----------

export type GameEvent =
  | { kind: "read"; ms: number }
  | { kind: "consulted" }
  | { kind: "saved"; zipf: number | null }
  | { kind: "review"; rating: ReviewRating }
  | { kind: "book_finished"; bookHash: string };

// Palabra rara: zipf bajo en la escala de frecuencia (menos de ~1 por
// 3 millones de palabras). Las sin dato no cuentan — mejor callar que
// regalar el bonus a cualquier guardada.
export const RARE_ZIPF_BELOW = 3.0;

export const XP_REVIEW: Partial<Record<ReviewRating, number>> = {
  again: 1,
  wrong: 1,
  hard: 2,
  good: 3,
  correct: 3,
  easy: 4,
  known: 4,
};

// Día de racha: la actividad de ayer continúa la racha; cualquier
// hueco mayor la reinicia a 1 (hoy cuenta como día activo).
export const dayKeyOf = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

export const daysBetween = (a: string, b: string) => {
  const ms = Date.parse(`${a}T00:00:00`) - Date.parse(`${b}T00:00:00`);
  return Math.round(ms / 86_400_000);
};

// ---------- Niveles y etapas del gato ----------

export interface GameLevel {
  name: string;
  xp: number;
}

export const LEVELS: GameLevel[] = [
  { name: "Inicio", xp: 0 },
  { name: "Apuntador", xp: 30 },
  { name: "Lector constante", xp: 90 },
  { name: "Subrayador", xp: 180 },
  { name: "Marginalia", xp: 320 },
  { name: "Explorador", xp: 520 },
  { name: "Lexicógrafo", xp: 800 },
  { name: "Bibliófilo", xp: 1150 },
  { name: "Guardián del estante", xp: 1600 },
  { name: "Bibliotecario", xp: 2200 },
];

export function levelFor(xp: number): number {
  let level = 0;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (xp >= LEVELS[i].xp) level = i;
  }
  return level;
}

// Progreso dentro del nivel actual, para la barra del Cuaderno.
export function levelProgress(xp: number): {
  level: number;
  name: string;
  floor: number;
  ceil: number | null;
  ratio: number;
} {
  const level = levelFor(xp);
  const floor = LEVELS[level].xp;
  const next = LEVELS[level + 1];
  if (!next) return { level, name: LEVELS[level].name, floor, ceil: null, ratio: 1 };
  return {
    level,
    name: LEVELS[level].name,
    floor,
    ceil: next.xp,
    ratio: Math.min(1, Math.max(0, (xp - floor) / (next.xp - floor))),
  };
}

// El gato crece con el nivel: gatito → gatito atento → gato → gato
// con collar → gato bibliotecario. 5 etapas sobre los 10 niveles.
export function catStageForLevel(level: number): number {
  if (level >= 8) return 4;
  if (level >= 6) return 3;
  if (level >= 4) return 2;
  if (level >= 2) return 1;
  return 0;
}

export type CatMood = "awake" | "sleepy" | "asleep";

// El gato se duerme si nadie lee ni repasa: despierto < 36 h, con
// sueño hasta 4 días, dormido después. Amable a propósito — basta
// cualquier actividad para despertarlo; no hay castigo ni contador.
export function catMood(state: GameState, now: number): CatMood {
  const idle = now - state.caredAt;
  if (idle < 36 * 3_600_000) return "awake";
  if (idle < 4 * 86_400_000) return "sleepy";
  return "asleep";
}

// ---------- Logros y familias ----------

export type AchievementFamily =
  | "palabras"
  | "raras"
  | "consultas"
  | "lectura"
  | "sesion"
  | "racha"
  | "repasos"
  | "libros";

export interface AchievementFamilyInfo {
  id: AchievementFamily;
  order: number;
  name: string;
  unit: { singular: string; plural: string };
  glyph:
    | "pluma"
    | "gema"
    | "lupa"
    | "reloj"
    | "reloj-arena"
    | "calendario"
    | "tarjeta"
    | "libro";
}

export const ACHIEVEMENT_FAMILIES: Record<AchievementFamily, AchievementFamilyInfo> = {
  palabras: {
    id: "palabras",
    order: 0,
    name: "Palabras guardadas",
    unit: { singular: "palabra", plural: "palabras" },
    glyph: "pluma",
  },
  raras: {
    id: "raras",
    order: 1,
    name: "Palabras raras",
    unit: { singular: "palabra rara", plural: "palabras raras" },
    glyph: "gema",
  },
  consultas: {
    id: "consultas",
    order: 2,
    name: "Consultas",
    unit: { singular: "consulta", plural: "consultas" },
    glyph: "lupa",
  },
  lectura: {
    id: "lectura",
    order: 3,
    name: "Horas leídas",
    unit: { singular: "hora", plural: "horas" },
    glyph: "reloj",
  },
  sesion: {
    id: "sesion",
    order: 4,
    name: "Sesión larga",
    unit: { singular: "minuto", plural: "minutos" },
    glyph: "reloj-arena",
  },
  racha: {
    id: "racha",
    order: 5,
    name: "Racha",
    unit: { singular: "día", plural: "días" },
    glyph: "calendario",
  },
  repasos: {
    id: "repasos",
    order: 6,
    name: "Repasos",
    unit: { singular: "repaso", plural: "repasos" },
    glyph: "tarjeta",
  },
  libros: {
    id: "libros",
    order: 7,
    name: "Libros concluidos",
    unit: { singular: "libro", plural: "libros" },
    glyph: "libro",
  },
};

export const ACHIEVEMENT_FAMILY_ORDER: AchievementFamily[] = [
  "palabras",
  "raras",
  "consultas",
  "lectura",
  "sesion",
  "racha",
  "repasos",
  "libros",
];

export const FAMILY_METRIC: Record<AchievementFamily, (s: GameStats) => number> = {
  palabras: (s) => s.saved,
  raras: (s) => s.rareSaved,
  consultas: (s) => s.consulted,
  lectura: (s) => s.minutes / 60,
  sesion: (s) => s.longestSessionMin,
  racha: (s) => s.streakDays,
  repasos: (s) => s.reviews,
  libros: (s) => s.booksFinished,
};

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  xp: number;
  family: AchievementFamily;
  goal: number;
  check: (stats: GameStats) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  // 24 logros originales conservando id, título, desc, xp e invariante de canonicalChestKey
  { id: "palabra_1", title: "Primera palabra", desc: "Guarda tu primera palabra", xp: 10, family: "palabras", goal: 1, check: (s) => s.saved >= 1 },
  { id: "palabras_10", title: "Vocabulario joven", desc: "Guarda 10 palabras", xp: 20, family: "palabras", goal: 10, check: (s) => s.saved >= 10 },
  { id: "palabras_50", title: "Vocabulario firme", desc: "Guarda 50 palabras", xp: 60, family: "palabras", goal: 50, check: (s) => s.saved >= 50 },
  { id: "palabras_100", title: "Cien en el cuaderno", desc: "Guarda 100 palabras", xp: 120, family: "palabras", goal: 100, check: (s) => s.saved >= 100 },
  { id: "palabras_500", title: "Diccionario propio", desc: "Guarda 500 palabras", xp: 250, family: "palabras", goal: 500, check: (s) => s.saved >= 500 },
  { id: "raras_5", title: "Cazarraras", desc: "Guarda 5 palabras raras", xp: 50, family: "raras", goal: 5, check: (s) => s.rareSaved >= 5 },
  { id: "raras_25", title: "Ojo de filólogo", desc: "Guarda 25 palabras raras", xp: 150, family: "raras", goal: 25, check: (s) => s.rareSaved >= 25 },
  { id: "curioso_50", title: "Curioso", desc: "Consulta 50 palabras", xp: 40, family: "consultas", goal: 50, check: (s) => s.consulted >= 50 },
  { id: "curioso_200", title: "No suelta el diccionario", desc: "Consulta 200 palabras", xp: 100, family: "consultas", goal: 200, check: (s) => s.consulted >= 200 },
  { id: "lectura_1h", title: "Primera hora", desc: "Lee 1 hora en total", xp: 30, family: "lectura", goal: 1, check: (s) => s.minutes >= 60 },
  { id: "lectura_10h", title: "Lector de oficio", desc: "Lee 10 horas en total", xp: 150, family: "lectura", goal: 10, check: (s) => s.minutes >= 600 },
  { id: "lectura_50h", title: "Habitante del estante", desc: "Lee 50 horas en total", xp: 400, family: "lectura", goal: 50, check: (s) => s.minutes >= 3000 },
  { id: "maraton", title: "Maratón", desc: "Lee 30 minutos de una sentada", xp: 40, family: "sesion", goal: 30, check: (s) => s.longestSessionMin >= 30 },
  { id: "racha_3", title: "Tres días seguidos", desc: "Lee 3 días en racha", xp: 30, family: "racha", goal: 3, check: (s) => s.streakDays >= 3 },
  { id: "racha_7", title: "Semana lectora", desc: "Lee 7 días en racha", xp: 80, family: "racha", goal: 7, check: (s) => s.streakDays >= 7 },
  { id: "racha_30", title: "Mes de tinta", desc: "Lee 30 días en racha", xp: 300, family: "racha", goal: 30, check: (s) => s.streakDays >= 30 },
  { id: "repasos_5", title: "Primeros repasos", desc: "Haz 5 repasos de vocabulario", xp: 15, family: "repasos", goal: 5, check: (s) => s.reviews >= 5 },
  { id: "repasos_25", title: "Memoria en marcha", desc: "Haz 25 repasos de vocabulario", xp: 40, family: "repasos", goal: 25, check: (s) => s.reviews >= 25 },
  { id: "repasos_50", title: "Mente en forma", desc: "Haz 50 repasos de vocabulario", xp: 70, family: "repasos", goal: 50, check: (s) => s.reviews >= 50 },
  { id: "repasos_100", title: "Memoria de acero", desc: "Haz 100 repasos de vocabulario", xp: 120, family: "repasos", goal: 100, check: (s) => s.reviews >= 100 },
  { id: "repasos_200", title: "Léxico de hierro", desc: "Haz 200 repasos de vocabulario", xp: 180, family: "repasos", goal: 200, check: (s) => s.reviews >= 200 },
  { id: "repasos_400", title: "Archivo viviente", desc: "Haz 400 repasos de vocabulario", xp: 300, family: "repasos", goal: 400, check: (s) => s.reviews >= 400 },
  { id: "libro_1", title: "Primer libro cerrado", desc: "Termina un libro", xp: 80, family: "libros", goal: 1, check: (s) => s.booksFinished >= 1 },
  { id: "libro_3", title: "Devoralibros", desc: "Termina 3 libros", xp: 200, family: "libros", goal: 3, check: (s) => s.booksFinished >= 3 },
  // 12 logros nuevos agregados al final
  { id: "palabras_250", title: "Cuaderno lleno", desc: "Guarda 250 palabras", xp: 180, family: "palabras", goal: 250, check: (s) => s.saved >= 250 },
  { id: "palabras_1000", title: "Mil palabras propias", desc: "Guarda 1000 palabras", xp: 400, family: "palabras", goal: 1000, check: (s) => s.saved >= 1000 },
  { id: "raras_75", title: "Coleccionista de rarezas", desc: "Guarda 75 palabras raras", xp: 250, family: "raras", goal: 75, check: (s) => s.rareSaved >= 75 },
  { id: "curioso_500", title: "Lector con lupa", desc: "Consulta 500 palabras", xp: 180, family: "consultas", goal: 500, check: (s) => s.consulted >= 500 },
  { id: "lectura_25h", title: "Lector de tardes largas", desc: "Lee 25 horas en total", xp: 250, family: "lectura", goal: 25, check: (s) => s.minutes / 60 >= 25 },
  { id: "lectura_100h", title: "Cien horas de tinta", desc: "Lee 100 horas en total", xp: 600, family: "lectura", goal: 100, check: (s) => s.minutes / 60 >= 100 },
  { id: "sesion_60", title: "Hora sin interrupciones", desc: "Lee 60 minutos de una sentada", xp: 70, family: "sesion", goal: 60, check: (s) => s.longestSessionMin >= 60 },
  { id: "racha_14", title: "Dos semanas seguidas", desc: "Lee 14 días en racha", xp: 150, family: "racha", goal: 14, check: (s) => s.streakDays >= 14 },
  { id: "racha_100", title: "Cien días de lectura", desc: "Lee 100 días en racha", xp: 700, family: "racha", goal: 100, check: (s) => s.streakDays >= 100 },
  { id: "repasos_800", title: "Memoria de archivo", desc: "Haz 800 repasos de vocabulario", xp: 450, family: "repasos", goal: 800, check: (s) => s.reviews >= 800 },
  { id: "libro_5", title: "Estante propio", desc: "Termina 5 libros", xp: 300, family: "libros", goal: 5, check: (s) => s.booksFinished >= 5 },
  { id: "libro_10", title: "Diez libros cerrados", desc: "Termina 10 libros", xp: 500, family: "libros", goal: 10, check: (s) => s.booksFinished >= 10 },
];

export interface FamilyProgress {
  family: AchievementFamily;
  info: AchievementFamilyInfo;
  ranksEarned: number;
  ranksTotal: number;
  achievements: Achievement[];
  nextAchievement: Achievement | null;
  current: number;
  goal: number;
  ratio: number;
}

export function familyProgress(state: GameState): Record<AchievementFamily, FamilyProgress> {
  const result = {} as Record<AchievementFamily, FamilyProgress>;
  for (const fam of ACHIEVEMENT_FAMILY_ORDER) {
    const info = ACHIEVEMENT_FAMILIES[fam];
    const achievements = ACHIEVEMENTS.filter((a) => a.family === fam).sort((a, b) => a.goal - b.goal);
    const ranksTotal = achievements.length;
    const ranksEarned = achievements.filter((a) => Boolean(state.achievements[a.id])).length;
    const nextAchievement = achievements.find((a) => !state.achievements[a.id]) ?? null;
    const current = FAMILY_METRIC[fam](state.stats);
    const maxGoal = achievements[achievements.length - 1]?.goal ?? 0;
    const goal = nextAchievement ? nextAchievement.goal : maxGoal;
    const ratio = nextAchievement
      ? goal > 0
        ? Math.min(1, Math.max(0, current / goal))
        : 0
      : 1;
    result[fam] = {
      family: fam,
      info,
      ranksEarned,
      ranksTotal,
      achievements,
      nextAchievement,
      current,
      goal,
      ratio,
    };
  }
  return result;
}

export function listFamilyProgress(state: GameState): FamilyProgress[] {
  const map = familyProgress(state);
  return ACHIEVEMENT_FAMILY_ORDER.map((fam) => map[fam]);
}

// Accesorios que regala cada subida de nivel (los cofres de logros
// guardan estampas). Son cosméticos: se dibujan sobre el gato.
const LEVEL_REWARDS: Record<number, string> = {
  1: "corbatin",
  2: "bufanda",
  3: "boina",
  4: "moño",
  5: "monoculo",
  6: "collar",
  7: "capa",
  8: "anteojos",
};

export function rewardForLevel(level: number): string {
  return LEVEL_REWARDS[level] ?? "estampa";
}

// Pelajes: el color del pelaje, en los niveles que los cofres no
// cubren — así cada subida regala algo (nivel impar = pelaje, nivel
// par = prenda). No son cofres: se desbloquean por el nivel
// proyectado, lo que los hace retroactivos — quien ya cruzó el
// umbral tiene su pelaje sin depender de un cofre antiguo.
export const COAT_LEVELS: Record<string, number> = {
  "pelaje-atigrado": 1,
  "pelaje-calico": 2,
  "pelaje-gris": 3,
  "pelaje-siames": 5,
  "pelaje-negro": 6,
  "pelaje-tuxedo": 7,
  "pelaje-dorado": 9,
};

// Pelajes ya ganados: los que pide un nivel alcanzado.
export function unlockedCoats(state: GameState): string[] {
  const level = levelFor(state.xp);
  return Object.keys(COAT_LEVELS).filter((coat) => COAT_LEVELS[coat] <= level);
}

// Nivel visible (1-based) que desbloquea el pelaje; null si el id no
// es un pelaje del catálogo.
export function requiredCoatLevel(article: string): number | null {
  const at = COAT_LEVELS[article];
  return at === undefined ? null : at + 1;
}

export const ACCESSORY_LABELS: Record<string, string> = {
  chaleco: "Chaleco del gato",
  capa: "Capa de terciopelo",
  bufanda: "Bufanda del gato",
  collar: "Collar del gato",
  corbatin: "Corbatín del gato",
  moño: "Moño del gato",
  boina: "Boina de poeta",
  anteojos: "Anteojos del gato",
  monoculo: "Monóculo de época",
  estampa: "Estampa conmemorativa",
};

// ---------- Aplicar eventos ----------

export interface AwardResult {
  state: GameState;
  gained: number;
  unlocked: Achievement[];
  // Índice del nivel nuevo cuando el evento cruzó un umbral.
  leveledTo: number | null;
  newChests: GameChest[];
}

export const STREAK_XP_BONUS = 1.1;

export function applyGameEvent(
  prev: GameState,
  event: GameEvent,
  now: number,
  idFor: () => string,
): AwardResult {
  const state: GameState = {
    ...prev,
    stats: { ...prev.stats },
    achievements: { ...prev.achievements },
    chests: [...prev.chests],
    finishedBooks: [...prev.finishedBooks],
  };
  const stats = state.stats;

  // Racha de días: se evalúa en cada evento para que cualquier
  // actividad la alimente. Un salto de un solo día con racha previa
  // ≥ 3 días queda protegido por el marcapáginas del compañero.
  const today = dayKeyOf(now);
  if (stats.lastDayKey !== today) {
    const gap = stats.lastDayKey ? daysBetween(today, stats.lastDayKey) : Infinity;
    const savedByShield = gap === 2 && stats.streakDays >= 3;
    stats.streakDays = gap === 1 || savedByShield ? stats.streakDays + 1 : 1;
    stats.lastDayKey = today;
  }

  let gained = 0;
  switch (event.kind) {
    case "read": {
      const minutes = event.ms / 60_000;
      stats.minutes += minutes;
      stats.longestSessionMin = Math.max(stats.longestSessionMin, minutes);
      gained += minutes;
      break;
    }
    case "consulted":
      stats.consulted += 1;
      gained += 2;
      break;
    case "saved":
      stats.saved += 1;
      gained += 3;
      if (event.zipf !== null && event.zipf < RARE_ZIPF_BELOW) {
        stats.rareSaved += 1;
        gained += 4;
      }
      break;
    case "review":
      stats.reviews += 1;
      gained += XP_REVIEW[event.rating] ?? 1;
      break;
    case "book_finished":
      if (state.finishedBooks.includes(event.bookHash)) break;
      state.finishedBooks.push(event.bookHash);
      stats.booksFinished += 1;
      gained += 50;
      break;
  }

  if (stats.streakDays > 1) gained = Math.round(gained * STREAK_XP_BONUS * 10) / 10;

  const before = levelFor(state.xp);
  state.xp += gained;
  state.caredAt = now;

  const unlocked: Achievement[] = [];
  const newChests: GameChest[] = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements[a.id] || !a.check(stats)) continue;
    state.achievements[a.id] = now;
    unlocked.push(a);
    state.xp += a.xp;
    newChests.push({
      id: idFor(),
      source: "achievement",
      label: a.title,
      reward: a.id.startsWith("libro_") ? "Exlibris conmemorativo" : `Estampa · ${a.title}`,
      createdAt: now,
      openedAt: null,
    });
  }

  // Los cofres de nivel se evalúan al final: el bonus de un logro
  // también puede cruzar umbrales, y cada nivel cruzado regala uno.
  const after = levelFor(state.xp);
  const leveledTo = after > before ? after : null;
  for (let level = before + 1; level <= after; level += 1) {
    newChests.push({
      id: idFor(),
      source: "level",
      label: `Nivel ${level + 1} · ${LEVELS[level].name}`,
      reward: rewardForLevel(level),
      createdAt: now,
      openedAt: null,
    });
  }
  state.chests.push(...newChests);

  return { state, gained, unlocked, leveledTo, newChests };
}

// Abrir un cofre solo lo marca: el contenido ya vino resuelto.
export function openChest(state: GameState, id: string, now: number): GameState {
  const chests = state.chests.map((chest) =>
    chest.id === id && chest.openedAt === null ? { ...chest, openedAt: now } : chest,
  );
  return { ...state, chests };
}

export function pendingChests(state: GameState): GameChest[] {
  return state.chests.filter((chest) => chest.openedAt === null);
}

// Accesorios que el gato luce: los regalos de nivel ya abiertos
// o correspondientes a niveles ya alcanzados en el progreso.
export function unlockedAccessories(state: GameState): string[] {
  const fromChests = state.chests
    .filter((chest) => chest.source === "level" && chest.openedAt !== null)
    .map((chest) => chest.reward);
  const currentLvl = levelFor(state.xp);
  const fromLevel = Object.entries(LEVEL_REWARDS)
    .filter(([lvl]) => Number(lvl) <= currentLvl)
    .map(([, reward]) => reward);
  return [...new Set([...fromChests, ...fromLevel])];
}
