// Tu recorrido: funciones puras para derivar el progreso global,
// etapas FSRS de vocabulario, récords personales e historial de lectura
// a partir de datos reales del dispositivo (sin tablas nuevas).

import type { KnownWord, SavedReview, SavedWord } from "./idb";
import type { Card } from "./fsrs";
import { markLevel } from "./word-level";
import {
  DEFAULT_USER_LANGUAGE_PROFILE,
  getThetaForLanguage,
  loadUserLanguageProfile,
  type UserLanguageProfile,
} from "./profile-models";
import {
  dayKeyOf,
  mergeIntervals,
  timeByDay,
  totalMs,
  type TimeInterval,
} from "./reading-activity";

export interface WordStages {
  newCount: number;
  learningCount: number;
  settledCount: number;
  masteredCount: number;
  total: number;
}

export function wordStages(words: SavedWord[]): WordStages {
  let newCount = 0;
  let learningCount = 0;
  let settledCount = 0;
  let masteredCount = 0;

  const active = words.filter((w) => !w.deleted);
  for (const w of active) {
    const lvl = markLevel(w.card);
    if (lvl === "new") {
      newCount++;
    } else if (lvl === "learning") {
      learningCount++;
    } else if (lvl === "settled") {
      settledCount++;
    } else {
      // markLevel devuelve null cuando stability >= 90 y reps > 0
      masteredCount++;
    }
  }

  return {
    newCount,
    learningCount,
    settledCount,
    masteredCount,
    total: active.length,
  };
}

export function totalReadingMs(intervals: TimeInterval[]): number {
  return totalMs(intervals);
}

export interface RetentionSummary {
  /** Total de repasos verificados (excluye autoinformes 'declared'). */
  verifiedReviewsCount: number;
  /** Porcentaje de aciertos sobre repasos verificados, o null si aún no hay. */
  recallRatePct: number | null;
  /** Palabras activas con al menos un repaso y estabilidad FSRS ≥ 7 días. */
  retained7dCount: number;
  /** Palabras activas con al menos un repaso y estabilidad FSRS ≥ 30 días. */
  retained30dCount: number;
}

// Retención medible con lo que ya se guarda: la calificación de cada
// repaso y la estabilidad FSRS de cada tarjeta. No mide comprensión;
// mide si el vocabulario sigue disponible con el tiempo.
export function computeRetentionSummary(
  words: SavedWord[],
  reviews: SavedReview[],
): RetentionSummary {
  const verified = reviews.filter((r) => r.kind !== "declared");
  let hits = 0;
  for (const r of verified) {
    if (r.rating === "good" || r.rating === "easy" || r.rating === "correct") {
      hits += 1;
    }
  }
  const recallRatePct =
    verified.length > 0 ? Math.round((hits / verified.length) * 100) : null;

  let retained7dCount = 0;
  let retained30dCount = 0;
  for (const w of words) {
    if (w.deleted) continue;
    const reps = w.card?.reps ?? 0;
    const stability = w.card?.stability ?? 0;
    if (reps <= 0) continue;
    if (stability >= 7) retained7dCount += 1;
    if (stability >= 30) retained30dCount += 1;
  }

  return {
    verifiedReviewsCount: verified.length,
    recallRatePct,
    retained7dCount,
    retained30dCount,
  };
}

export interface ReadingRecords {
  bestReadingDay: { dayKey: string; minutes: number } | null;
  longestSessionMinutes: number;
  bestWordsDay: { dayKey: string; count: number } | null;
  bestReviewsDay: { dayKey: string; count: number } | null;
}

export function readingRecords(
  intervals: TimeInterval[],
  words: SavedWord[],
  reviews: SavedReview[],
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ReadingRecords {
  // 1. Día más lector (en minutos)
  const days = timeByDay(intervals, timeZone);
  let bestReadingDay: { dayKey: string; minutes: number } | null = null;
  for (const d of days) {
    const minutes = Math.round(d.ms / 60_000);
    if (!bestReadingDay || minutes > bestReadingDay.minutes) {
      bestReadingDay = { dayKey: d.dayKey, minutes };
    }
  }

  // 2. Sesión más larga (en minutos)
  const merged = mergeIntervals(intervals);
  let longestSessionMs = 0;
  for (const item of merged) {
    const dur = item.endedAt - item.startedAt;
    if (dur > longestSessionMs) longestSessionMs = dur;
  }
  const longestSessionMinutes = Math.round(longestSessionMs / 60_000);

  // 3. Día con más palabras guardadas
  const wordsByDay = new Map<string, number>();
  for (const w of words) {
    if (w.deleted || !w.savedAt) continue;
    const key = dayKeyOf(w.savedAt, timeZone);
    wordsByDay.set(key, (wordsByDay.get(key) ?? 0) + 1);
  }
  let bestWordsDay: { dayKey: string; count: number } | null = null;
  for (const [dayKey, count] of wordsByDay) {
    if (!bestWordsDay || count > bestWordsDay.count) {
      bestWordsDay = { dayKey, count };
    }
  }

  // 4. Día con más repasos
  const reviewsByDay = new Map<string, number>();
  for (const r of reviews) {
    if (!r.createdAt) continue;
    const key = dayKeyOf(r.createdAt, timeZone);
    reviewsByDay.set(key, (reviewsByDay.get(key) ?? 0) + 1);
  }
  let bestReviewsDay: { dayKey: string; count: number } | null = null;
  for (const [dayKey, count] of reviewsByDay) {
    if (!bestReviewsDay || count > bestReviewsDay.count) {
      bestReviewsDay = { dayKey, count };
    }
  }

  return {
    bestReadingDay,
    longestSessionMinutes,
    bestWordsDay,
    bestReviewsDay,
  };
}

export function finishedBookHashes(
  positions: { bookHash: string; progress?: number; ratio?: number }[],
  finishedBooks: string[] = [],
): string[] {
  const result = new Set<string>(finishedBooks);
  for (const pos of positions) {
    if ((pos.progress ?? 0) >= 0.99 || (pos.ratio ?? 0) >= 0.99) {
      result.add(pos.bookHash);
    }
  }
  return [...result];
}

// ---------- Caminillo de vocabulario (palabras que el recorrido detecta) ----------

// El recorrido sabe dos cosas por separado: cuántas palabras se guardaron y
// cuánto tiempo se leyó. Lo que no decía es *cuáles* son las que faltan por
// consolidar. `walkPathWords` cruza las tarjetas FSRS con los repasos reales
// del historial y produce una lista corta, ordenada por urgencia pedagógica,
// con el motivo de por qué cada palabra está en el caminillo. Es pura y sin
// tablas nuevas: deriva todo de `savedWords` y `reviews` que ya se leen.

export type WalkReason = "nueva" | "repaso" | "olvido" | "fragil";

export interface WalkWord {
  key: string;
  form: string;
  lemma?: string;
  language: string;
  reason: WalkReason;
  /** Estabilidad FSRS en días (0 si nunca se ha repasado). */
  stability: number;
  /** Repasos registrados para esa forma/lema en el historial. */
  reviewCount: number;
  /** Fallos (`again`) registrados: evidencia de que se escapó. */
  lapseCount: number;
  savedAt: number;
  bookTitle?: string;
  contextSnippet?: string;
}

export interface WordWalk {
  /** Palabras ordenadas por urgencia y recortadas a `cap`. */
  words: WalkWord[];
  /** Total de palabras candidatas antes del recorte. */
  totalCandidates: number;
  dueCount: number;
  newCount: number;
  fragileCount: number;
  /** Etiqueta legible del idioma de la primera palabra, o null si vacío. */
  primaryLanguage: string | null;
}

const WALK_REASON_WEIGHT: Record<WalkReason, number> = {
  repaso: 0,
  nueva: 1,
  olvido: 2,
  fragil: 3,
};

export const WALK_CAP_DEFAULT = 8;

// Un día de tolerancia: una tarjeta programada para dentro de tres horas
// sigue siendo «de hoy». La fecha de vencimiento de ts-fsrs puede venir como
// Date o como ISO según el camino por el que llegó la fila (local o sync).
const DUE_GRACE_MS = 86_400_000;

function dueToMs(due: Card["due"]): number | null {
  if (!due) return null;
  if (due instanceof Date) {
    const t = due.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof due === "number") return Number.isFinite(due) ? due : null;
  if (typeof due === "string") {
    const t = Date.parse(due);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * Caminillo de vocabulario: qué palabras tocar ahora mismo.
 *
 * - `repaso`: vencida o por vencer dentro de `dueHorizonDays` (la cola FSRS).
 * - `nueva`: guardada y todavía sin primer repaso real.
 * - `olvido`: fallada al menos una vez (`again`) y aún inestable.
 * - `fragil`: repasada pero con estabilidad < 2 días (a punto de caerse).
 *
 * La prioridad es pedagógica: primero lo vencido, luego lo olvidado, después
 * lo frágil y al final lo nuevo; dentro de cada grupo, por estabilidad
 * creciente y por guardado más reciente.
 */
export function walkPathWords(
  words: SavedWord[],
  reviews: SavedReview[] = [],
  options: {
    now?: number;
    cap?: number;
    dueHorizonDays?: number;
    language?: string | null;
  } = {},
): WordWalk {
  const now = options.now ?? Date.now();
  const cap = Math.max(1, options.cap ?? WALK_CAP_DEFAULT);
  const horizonMs = (options.dueHorizonDays ?? 1) * 86_400_000 + DUE_GRACE_MS;
  const langFilter = options.language
    ? options.language.slice(0, 2).toLowerCase()
    : null;

  // Historial por palabra: se indexan forma y lema en minúsculas porque el
  // repaso se anota con la forma que se vio en el texto y la tarjeta vive
  // bajo el lema.
  const reviewCount = new Map<string, number>();
  const lapseCount = new Map<string, number>();
  for (const r of reviews) {
    if (!r || !r.form) continue;
    const keys = new Set([
      `${(r.language || "es").slice(0, 2).toLowerCase()}:${r.form.toLowerCase()}`,
      r.form.toLowerCase(),
    ]);
    for (const k of keys) {
      reviewCount.set(k, (reviewCount.get(k) ?? 0) + 1);
      if (r.rating === "again") {
        lapseCount.set(k, (lapseCount.get(k) ?? 0) + 1);
      }
    }
  }

  const candidates: WalkWord[] = [];
  let dueCount = 0;
  let newCount = 0;
  let fragileCount = 0;

  for (const w of words) {
    if (w.deleted) continue;
    const lang = (w.language || "es").slice(0, 2).toLowerCase();
    if (langFilter && lang !== langFilter) continue;

    const card = w.card;
    const stability = card?.stability ?? 0;
    const reps = card?.reps ?? 0;
    const dueMs = dueToMs(card?.due as Card["due"] | undefined);

    const idKeys = [
      `${lang}:${(w.lemma || w.form || "").toLowerCase()}`,
      `${lang}:${(w.form || "").toLowerCase()}`,
      (w.lemma || "").toLowerCase(),
      (w.form || "").toLowerCase(),
    ];
    let counted = 0;
    let failed = 0;
    for (const k of idKeys) {
      if (!k) continue;
      counted += reviewCount.get(k) ?? 0;
      failed += lapseCount.get(k) ?? 0;
    }

    let reason: WalkReason;
    if (dueMs !== null && dueMs <= now + horizonMs && reps > 0) {
      reason = "repaso";
    } else if (failed > 0 && stability < 21) {
      reason = "olvido";
    } else if (reps === 0) {
      reason = "nueva";
    } else if (stability < 2) {
      reason = "fragil";
    } else {
      continue;
    }

    if (reason === "repaso") dueCount += 1;
    else if (reason === "nueva") newCount += 1;
    else fragileCount += 1;

    candidates.push({
      key: w.key,
      form: w.form,
      lemma: w.lemma,
      language: w.language,
      reason,
      stability,
      reviewCount: counted,
      lapseCount: failed,
      savedAt: w.savedAt,
      bookTitle: w.bookTitle,
      contextSnippet: w.contextSnippet,
    });
  }

  candidates.sort((a, b) => {
    const byReason = WALK_REASON_WEIGHT[a.reason] - WALK_REASON_WEIGHT[b.reason];
    if (byReason !== 0) return byReason;
    if (a.stability !== b.stability) return a.stability - b.stability;
    return b.savedAt - a.savedAt;
  });

  const primaryLanguage =
    candidates.length > 0
      ? (candidates[0].language || "es").slice(0, 2).toLowerCase()
      : null;

  return {
    words: candidates.slice(0, cap),
    totalCandidates: candidates.length,
    dueCount,
    newCount,
    fragileCount,
    primaryLanguage,
  };
}

export interface WeekHistoryItem {
  weekIndex: number; // 0 = hace 7 semanas, 7 = esta semana
  label: string;
  minutes: number;
}

export function weeksHistory(
  intervals: TimeInterval[],
  weeksCount: number = 8,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
  nowMs: number = Date.now(),
): WeekHistoryItem[] {
  const days = timeByDay(intervals, timeZone);
  const msByDay = new Map(days.map((d) => [d.dayKey, d.ms]));

  const ONE_DAY_MS = 86_400_000;
  const result: WeekHistoryItem[] = [];

  // Construimos las últimas `weeksCount` semanas (de la más vieja a la actual)
  for (let w = weeksCount - 1; w >= 0; w--) {
    let weekMs = 0;
    // Cada semana comprende 7 días terminando en `nowMs - w * 7 días`
    const weekEndMs = nowMs - w * 7 * ONE_DAY_MS;
    for (let d = 6; d >= 0; d--) {
      const dayMs = weekEndMs - d * ONE_DAY_MS;
      const key = dayKeyOf(dayMs, timeZone);
      weekMs += msByDay.get(key) ?? 0;
    }
    const weekIndex = weeksCount - 1 - w;
    const label = w === 0 ? "Esta sem." : w === 1 ? "Sem. ant." : `Sem. -${w}`;
    result.push({
      weekIndex,
      label,
      minutes: Math.round(weekMs / 60_000),
    });
  }

  return result;
}

export function bookLabel(book?: {
  title?: string;
  name?: string;
  author?: string;
}): { title: string; author: string } {
  return {
    title: book?.title || book?.name || "Libro terminado",
    author: book?.author || "",
  };
}

// ---------- Rangos Literarios y Sendero de Tinta (Lecta v2.0) ----------

export interface LiteraryRank {
  level: number;
  name: string;
  minInkPoints: number;
  rewardDescription: string;
  rewardItem?: string;
  description?: string;
}

export const LITERARY_RANKS: LiteraryRank[] = [
  {
    level: 1,
    name: "Caminante de Papel",
    minInkPoints: 0,
    rewardDescription: "Pluma de Inicio",
    description: "Tus primeros pasos trazando senderos con tinta y papel.",
  },
  {
    level: 2,
    name: "Aprendiz de Tinta",
    minInkPoints: 100,
    rewardDescription: "Gafas de Lectura",
    rewardItem: "gafas_lector",
    description: "Reconoces giros estilísticos y enriqueces tu léxico diario.",
  },
  {
    level: 3,
    name: "Tejedor de Frases",
    minInkPoints: 300,
    rewardDescription: "Bufanda Borgoña",
    rewardItem: "bufanda_roja",
    description: "Las estructuras complejas fluyen con cadencia natural.",
  },
  {
    level: 4,
    name: "Explorador de Sintaxis",
    minInkPoints: 600,
    rewardDescription: "Boina Verde",
    rewardItem: "boina_verde",
    description: "Navegas párrafos densos con agudeza y ritmo sostenido.",
  },
  {
    level: 5,
    name: "Alquimista Léxico",
    minInkPoints: 1000,
    rewardDescription: "Monóculo Dorado",
    rewardItem: "monoculo",
    description: "Transformas palabras desconocidas en gemas de sabiduría.",
  },
  {
    level: 6,
    name: "Maestro de la Biblioteca",
    minInkPoints: 1500,
    rewardDescription: "Capa de Erudito",
    rewardItem: "capa_erudito",
    description: "Has conquistado las cumbres del conocimiento literario.",
  },
];

export function calculateInkPoints(
  minutesRead: number,
  masteredWordsCount: number,
  strategiesCount: number = 0,
): number {
  return Math.max(0, minutesRead * 2 + masteredWordsCount * 10 + strategiesCount * 25);
}

export interface LiteraryRankProgress {
  currentRank: LiteraryRank;
  nextRank: LiteraryRank | null;
  progressPct: number;
  currentPoints: number;
  pointsToNext: number;
}

export function literaryRankFor(inkPoints: number): LiteraryRankProgress {
  let currentRank = LITERARY_RANKS[0];
  for (const rank of LITERARY_RANKS) {
    if (inkPoints >= rank.minInkPoints) {
      currentRank = rank;
    }
  }
  const nextRank = LITERARY_RANKS.find((r) => r.level === currentRank.level + 1) ?? null;
  if (!nextRank) {
    return {
      currentRank,
      nextRank: null,
      progressPct: 100,
      currentPoints: inkPoints,
      pointsToNext: 0,
    };
  }
  const span = nextRank.minInkPoints - currentRank.minInkPoints;
  const gained = inkPoints - currentRank.minInkPoints;
  const progressPct = Math.min(100, Math.max(0, Math.round((gained / span) * 100)));
  const pointsToNext = Math.max(0, nextRank.minInkPoints - inkPoints);
  return {
    currentRank,
    nextRank,
    progressPct,
    currentPoints: inkPoints,
    pointsToNext,
  };
}

export interface InkMilestoneNode {
  id: string;
  title: string;
  requiredInk: number;
  reward: string;
  tip: string;
  status: "completed" | "current" | "upcoming";
}

export const INK_MILESTONES: Omit<InkMilestoneNode, "status">[] = [
  { id: "m1", title: "Primeras Líneas", requiredInk: 50, reward: "Cinta Marcapáginas", tip: "Lee 15 minutos en el modo Enfoque Profundo para concentrarte mejor." },
  { id: "m2", title: "Aprendiz de Tinta", requiredInk: 100, reward: "Gafas de Lectura", tip: "Domina 4 palabras en el Cuaderno para ganar puntos rápidamente." },
  { id: "m3", title: "Ritmo Constante", requiredInk: 200, reward: "Tintero de Bronce", tip: "Mantén una racha de 3 días para ganar un Escudo de Ronroneo." },
  { id: "m4", title: "Tejedor de Frases", requiredInk: 300, reward: "Bufanda Borgoña", tip: "Prueba la lectura con Líneas Sintácticas para oraciones complejas." },
  { id: "m5", title: "Explorador de Sintaxis", requiredInk: 600, reward: "Boina Verde", tip: "Pre-entrena palabras antes de iniciar capítulos largos." },
  { id: "m6", title: "Alquimista Léxico", requiredInk: 1000, reward: "Monóculo Dorado", tip: "Revisa palabras difíciles en tu Cuaderno con juegos de vocabulario." },
  { id: "m7", title: "Maestro de la Biblioteca", requiredInk: 1500, reward: "Capa de Erudito", tip: "Completa un libro entero para sellar tu Exlibris personal." },
];

export function inkPathNodes(
  currentInk: number,
  milestones = INK_MILESTONES,
): {
  nodes: InkMilestoneNode[];
  currentNode: InkMilestoneNode;
  nextNode: InkMilestoneNode | null;
  remainingText: string;
} {
  const nextIdx = milestones.findIndex((m) => m.requiredInk > currentInk);
  const currentIdx = nextIdx === -1 ? milestones.length - 1 : Math.max(0, nextIdx - 1);

  const nodes: InkMilestoneNode[] = milestones.map((m, idx) => {
    let status: InkMilestoneNode["status"] = "upcoming";
    if (currentInk >= m.requiredInk) {
      status = "completed";
    } else if (idx === nextIdx) {
      status = "current";
    }
    return { ...m, status };
  });

  const nextNode = nextIdx !== -1 ? nodes[nextIdx] : null;
  const currentNode = nodes[currentIdx];

  let remainingText = "¡Has completado todos los hitos del Sendero de Tinta!";
  if (nextNode) {
    const diff = nextNode.requiredInk - currentInk;
    const estMinutes = Math.ceil(diff / 2);
    const estWords = Math.ceil(diff / 10);
    remainingText = `Faltan ~${estMinutes} min de lectura enfocada o ${estWords} palabras dominadas para desbloquear: «${nextNode.reward}»`;
  }

  return {
    nodes,
    currentNode,
    nextNode,
    remainingText,
  };
}

// ---------- Evolución Léxica por Idioma (θ_{u,L}) ----------

export type SupportedGrowthLang = "es" | "en";

export interface LanguageLexicalCurvePoint {
  index: number;
  theta: number;          // Valor interno (-3 a +3)
  normalizedScore: number; // Escala 0 a 100 para renderizar en SVG y barras
  timestamp?: number;
}

export interface LanguageLexicalGrowth {
  lang: SupportedGrowthLang;
  langLabel: string;       // 'Español' | 'Inglés'
  currentTheta: number;
  normalizedLevel: number; // 0..100
  stageTitle: string;      // Ej: 'Base en construcción' | 'Lectura fluida' | 'Horizonte literario' | 'Maestría léxica'
  stageSubtitle: string;   // Explicación breve y cálida en 1 línea
  passiveMasteredCount: number; // Palabras dominadas leyendo de corrido (pre-lectura / sin toque)
  activeQueriedCount: number;   // Palabras aprendidas por consulta activa / toque
  totalMasteredCount: number;
  passiveRatioPercent: number;  // 0..100 (% de fluidez sin fricción)
  curvePoints: LanguageLexicalCurvePoint[]; // Mínimo 2 puntos (o estado inicial suave) para dibujar el sparkline SVG
}

/**
 * Mapea el parámetro theta continuo (-3 a +3) a una escala visual de 5 a 100.
 */
export function normalizeThetaScore(theta: number): number {
  if (typeof theta !== "number" || Number.isNaN(theta)) {
    return 50;
  }
  return Math.round(Math.max(5, Math.min(100, ((theta + 2.5) / 5) * 100)));
}

/**
 * Retorna las etiquetas editoriales y cálidas de la etapa de crecimiento léxico según el nivel normalizado.
 */
export function lexicalGrowthStage(normalizedScore: number): {
  stageTitle: string;
  stageSubtitle: string;
} {
  if (normalizedScore < 40) {
    return {
      stageTitle: "Base en construcción",
      stageSubtitle: "Consolidando vocabulario fundamental y giros cotidianos.",
    };
  }
  if (normalizedScore < 65) {
    return {
      stageTitle: "Lectura fluida",
      stageSubtitle: "Lectura natural y disfrute de la mayoría de expresiones.",
    };
  }
  if (normalizedScore < 85) {
    return {
      stageTitle: "Horizonte literario",
      stageSubtitle: "Afinidad con estructuras complejas, matices y vocabulario enriquecido.",
    };
  }
  return {
    stageTitle: "Maestría léxica",
    stageSubtitle: "Dominio profundo de obras exigentes y clásicos de la literatura.",
  };
}

export interface LanguageLexicalGrowthParams {
  profile?: Partial<UserLanguageProfile> | null;
  knownWords?: Array<Partial<KnownWord>> | null;
  savedWords?: Array<Partial<SavedWord>> | null;
  activeLanguages?: string[] | null;
  books?: Array<{ language?: string }> | null;
}

export function computeLanguageLexicalGrowth(
  paramsOrKnown?:
    | LanguageLexicalGrowthParams
    | Array<Partial<KnownWord>>
    | Array<Partial<SavedWord>>
    | null,
  maybeSavedWords?: Array<Partial<SavedWord>> | null,
  maybeProfile?: Partial<UserLanguageProfile> | null,
): LanguageLexicalGrowth[] {
  let profile: Partial<UserLanguageProfile> | null = null;
  let knownWords: Array<Partial<KnownWord>> = [];
  let savedWords: Array<Partial<SavedWord>> = [];
  let activeLanguages: string[] = [];
  let books: Array<{ language?: string }> = [];

  if (Array.isArray(paramsOrKnown)) {
    if (
      paramsOrKnown.length > 0 &&
      "savedAt" in paramsOrKnown[0] &&
      !("known" in paramsOrKnown[0])
    ) {
      savedWords = paramsOrKnown as Array<Partial<SavedWord>>;
      if (Array.isArray(maybeSavedWords)) {
        knownWords = maybeSavedWords as Array<Partial<KnownWord>>;
      }
    } else {
      knownWords = paramsOrKnown as Array<Partial<KnownWord>>;
      savedWords = maybeSavedWords ?? [];
    }
    profile = maybeProfile ?? null;
  } else if (paramsOrKnown && typeof paramsOrKnown === "object") {
    profile = paramsOrKnown.profile ?? null;
    knownWords = paramsOrKnown.knownWords ?? [];
    savedWords = paramsOrKnown.savedWords ?? [];
    activeLanguages = paramsOrKnown.activeLanguages ?? [];
    books = paramsOrKnown.books ?? [];
  }

  const effectiveProfile: UserLanguageProfile = {
    ...DEFAULT_USER_LANGUAGE_PROFILE,
    ...(profile ?? (typeof window !== "undefined" ? loadUserLanguageProfile() : {})),
    thetaByLang: {
      ...DEFAULT_USER_LANGUAGE_PROFILE.thetaByLang,
      ...(profile?.thetaByLang ?? {}),
    },
    chaptersCompletedByLang: {
      ...DEFAULT_USER_LANGUAGE_PROFILE.chaptersCompletedByLang,
      ...(profile?.chaptersCompletedByLang ?? {}),
    },
  };

  // Determinar si 'en' tiene actividad registrada
  const hasEnWord =
    knownWords.some(
      (w) => !w.deleted && (w.language || "").slice(0, 2).toLowerCase() === "en",
    ) ||
    savedWords.some(
      (w) => !w.deleted && (w.language || "").slice(0, 2).toLowerCase() === "en",
    );

  const hasEnBook = books.some(
    (b) => (b.language || "").slice(0, 2).toLowerCase() === "en",
  );

  const hasEnActivity =
    hasEnWord ||
    hasEnBook ||
    activeLanguages.some((l) => l.slice(0, 2).toLowerCase() === "en") ||
    (effectiveProfile.chaptersCompletedByLang.en ?? 0) > 0 ||
    (profile?.thetaByLang?.en !== undefined &&
      profile.thetaByLang.en !== 0.0 &&
      profile.thetaByLang.en !== -0.6);

  const langsToProcess: SupportedGrowthLang[] = hasEnActivity ? ["es", "en"] : ["es"];

  return langsToProcess.map((lang) => {
    const currentTheta = getThetaForLanguage(effectiveProfile, lang, "es");
    const normalizedLevel = normalizeThetaScore(currentTheta);
    const { stageTitle, stageSubtitle } = lexicalGrowthStage(normalizedLevel);

    const activeLemmas = new Set<string>();
    const passiveLemmas = new Set<string>();

    for (const kw of knownWords) {
      if (kw.deleted) continue;
      const kwLang = (kw.language || "es").slice(0, 2).toLowerCase();
      if (kwLang !== lang) continue;
      const lemma = (kw.lemma || kw.key || "").trim().toLowerCase();
      if (!lemma) continue;

      const isExplicitQuery =
        kw.source === "saved" ||
        kw.source === "lookup" ||
        kw.source === "in-chapter-lookup" ||
        kw.source === "word_consulted" ||
        kw.source === "active";

      if (isExplicitQuery) {
        activeLemmas.add(lemma);
        passiveLemmas.delete(lemma);
        continue;
      }

      const isPassiveConsolidated =
        kw.status === "familiar" ||
        (kw.passiveSeenCount ?? 0) >= 3 ||
        kw.source === "passive" ||
        kw.source === "passive_frontier" ||
        kw.source === "preparation" ||
        kw.source === "pre-chapter-primed" ||
        kw.source === "declared" ||
        kw.source === "explicit" ||
        kw.source === "explicit_known" ||
        (kw.known === true && kw.status !== "unknown");

      if (isPassiveConsolidated && !activeLemmas.has(lemma)) {
        passiveLemmas.add(lemma);
      }
    }

    for (const sw of savedWords) {
      if (sw.deleted) continue;
      const swLang = (sw.language || "es").slice(0, 2).toLowerCase();
      if (swLang !== lang) continue;
      const lemma = (sw.lemma || sw.form || sw.key || "").trim().toLowerCase();
      if (!lemma) continue;

      activeLemmas.add(lemma);
      passiveLemmas.delete(lemma);
    }

    const passiveMasteredCount = passiveLemmas.size;
    const activeQueriedCount = activeLemmas.size;
    const totalMasteredCount = passiveMasteredCount + activeQueriedCount;
    const passiveRatioPercent =
      totalMasteredCount > 0
        ? Math.round((passiveMasteredCount / totalMasteredCount) * 100)
        : 0;

    const initialPrior = lang === "es" ? 0.0 : -0.6;
    const curvePoints: LanguageLexicalCurvePoint[] = [];

    if (Math.abs(currentTheta - initialPrior) > 0.05) {
      curvePoints.push({
        index: 0,
        theta: initialPrior,
        normalizedScore: normalizeThetaScore(initialPrior),
      });

      if (Math.abs(currentTheta - initialPrior) > 0.4) {
        const midTheta = Number(((initialPrior + currentTheta) / 2).toFixed(2));
        curvePoints.push({
          index: 1,
          theta: midTheta,
          normalizedScore: normalizeThetaScore(midTheta),
        });
      }

      curvePoints.push({
        index: curvePoints.length,
        theta: currentTheta,
        normalizedScore: normalizedLevel,
      });
    } else {
      curvePoints.push(
        {
          index: 0,
          theta: currentTheta,
          normalizedScore: normalizedLevel,
        },
        {
          index: 1,
          theta: currentTheta,
          normalizedScore: normalizedLevel,
        },
      );
    }

    return {
      lang,
      langLabel: lang === "es" ? "Español" : "Inglés",
      currentTheta,
      normalizedLevel,
      stageTitle,
      stageSubtitle,
      passiveMasteredCount,
      activeQueriedCount,
      totalMasteredCount,
      passiveRatioPercent,
      curvePoints,
    };
  });
}

export const languageLexicalGrowth = computeLanguageLexicalGrowth;

