// Tu recorrido: funciones puras para derivar el progreso global,
// etapas FSRS de vocabulario, récords personales e historial de lectura
// a partir de datos reales del dispositivo (sin tablas nuevas).

import type { KnownWord, SavedReview, SavedWord } from "./idb";
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

