// Tu recorrido: funciones puras para derivar el progreso global,
// etapas FSRS de vocabulario, récords personales e historial de lectura
// a partir de datos reales del dispositivo (sin tablas nuevas).

import type { SavedReview, SavedWord } from "./idb";
import { markLevel } from "./word-level";
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
