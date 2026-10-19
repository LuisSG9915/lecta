import type { LexiconEntry } from "./lexicon";
import type { MarkLevel } from "./word-level";
import type { PresentedReason } from "./idb";
import { predictSection } from "./knowledge";
import { isWordToken } from "../../shared/word-form";
import { isStopword } from "../../shared/stopwords";
import { preparationAnswerKey, type PreparationRow } from "./preparation";
import {
  betaFromZipf,
  predictWordMasteryProbability,
  estimateWordKnowProbability,
} from "./profile-models";

// Utilidades puras del lector predictivo: preparan entradas para
// predictSection (knowledge.ts) y para la tarjeta «Antes de leer».

// Formas que en la sección aparecen SIEMPRE con inicial mayúscula y
// nunca en minúscula: suelen ser nombres propios o extranjerismos.
// predictSection las trata como cualquier otra, pero no gastan el
// lote automático de definiciones con IA. `surfaceForms` son las
// formas únicas tal como salieron del segmentador (con su caja
// original); el resultado va en minúsculas.
export function capitalOnlyForms(surfaceForms: string[]): Set<string> {
  const capitalized = new Set<string>();
  const lowercased = new Set<string>();
  for (const surface of surfaceForms) {
    const first = surface.charAt(0);
    if (!first) continue;
    const lower = surface.toLowerCase();
    // Si el primer carácter no cambia al bajar a minúsculas, la
    // aparición cuenta como «en minúsculas» (incluye dígitos y
    // caracteres sin caja): nunca entra a capitalOnly.
    if (first.toLowerCase() === first) lowercased.add(lower);
    else capitalized.add(lower);
  }
  const result = new Set<string>();
  for (const form of capitalized) if (!lowercased.has(form)) result.add(form);
  return result;
}

// Primera oración del texto que contiene la forma como palabra
// completa (sin distinguir mayúsculas). Sirve de contexto para la
// ficha y el guardado cuando la palabra se toca desde la tarjeta,
// donde no hay un punto del texto que indique la oración.
export function firstSentenceWith(
  text: string,
  form: string,
  language = "es",
): string | undefined {
  const lower = form.toLowerCase();
  const words = new Intl.Segmenter(language, { granularity: "word" });
  for (const sentence of new Intl.Segmenter(language, { granularity: "sentence" }).segment(text)) {
    for (const part of words.segment(sentence.segment)) {
      if (part.isWordLike && part.segment.toLowerCase() === lower)
        return sentence.segment.trim();
    }
  }
  return undefined;
}

// ¿La forma guardada entra al grupo «por aprender» de la preparación?
// Niveles nuevos/aprendiendo, y también una asentada que el lector
// declaró desconocida: la evidencia explícita manda sobre el nivel de
// la tarjeta — entra sin tocar su estabilidad ni su card. Un
// «ya la conozco» la saca del grupo sea cual sea el nivel; una
// dominada (sin nivel) no pasa por aquí — la forma no está en el
// mapa de guardadas y la predice la regla de evidencia de
// predictSection.
export function preparationLearning(
  level: "new" | "learning" | "settled" | null | undefined,
  evidence: { known: boolean } | undefined,
): boolean {
  if (evidence?.known === true) return false;
  if (level === "new" || level === "learning") return true;
  return level === "settled" && evidence?.known === false;
}

// Mapa de evidencia por lema en minúsculas, como lo espera
// predictSection: consulta por lema de la ficha o por la forma misma.
export function toKnowledgeMap(
  rows: readonly { lemma: string; known: boolean }[],
): Map<string, { lemma: string; known: boolean }> {
  const map = new Map<string, { lemma: string; known: boolean }>();
  for (const row of rows) {
    const lemma = row.lemma.toLowerCase();
    map.set(lemma, { lemma, known: row.known });
  }
  return map;
}

// ---------- Utilidad de siguiente capítulo (Next-Chapter Utility) ----------

export interface NextChapterUtilityOptions {
  zipf: number | null | undefined;
  userTheta?: number;
  threshold?: number;
  chapterFreq?: number;
  bookFreq?: number;
  isPhrase?: boolean;
  alpha?: number;
  isSecondLanguage?: boolean;
}

/**
 * Función de utilidad Next-Chapter Utility U(w):
 * U(w) = P(unknown | w, theta) * (1 + 1.4 ln(1 + f_cap) + 0.6 ln(1 + f_libro)) * W_zona * B_locucion * W_l2
 */
export function nextChapterUtility(opts: NextChapterUtilityOptions): number {
  const theta =
    opts.userTheta ??
    (opts.threshold != null ? Math.max(0, 7.0 - opts.threshold) : 4.0);
  const bw =
    opts.zipf != null && Number.isFinite(opts.zipf)
      ? Math.max(0, 7.0 - opts.zipf)
      : 4.0;
  const alpha = opts.alpha ?? 1.0;

  // P(unknown | w, theta) = 1 / (1 + exp(alpha * (theta - bw)))
  const pUnknown = 1 / (1 + Math.exp(alpha * (theta - bw)));

  // Recompensa de Frecuencia en la Obra: 1 + 1.4 * ln(1 + f_cap) + 0.6 * ln(1 + f_libro)
  const fCap = Math.max(1, opts.chapterFreq ?? 1);
  const fBook = Math.max(fCap, opts.bookFreq ?? fCap);
  const freqReward = 1 + 1.4 * Math.log(1 + fCap) + 0.6 * Math.log(1 + fBook);

  // W_zona: campana de Zona de Desarrollo Próximo (i+1)
  // Premia con 1.25x si 0 <= bw - theta <= 1.2
  // Penaliza con 0.6x si bw - theta > 2.5
  const delta = bw - theta;
  let wZona = 1.0;
  if (delta >= 0 && delta <= 1.2) {
    wZona = 1.25;
  } else if (delta > 2.5) {
    wZona = 0.6;
  }

  // B_locucion: 1.3 si es locución o frase hecha, 1.0 si palabra individual
  const bLocucion = opts.isPhrase ? 1.3 : 1.0;

  // Ponderación de utilidad narrativa L2 (segunda lengua):
  // Prioriza palabras con repetición (frecuencia >= 2) y vocabulario útil (B1-C1)
  // sobre hapax legomena oscuras de una sola aparición.
  let wL2 = 1.0;
  if (opts.isSecondLanguage) {
    const isRepeated = fCap >= 2 || fBook >= 2;
    const isSweetSpotB1C1 =
      (opts.zipf != null && opts.zipf >= 2.5 && opts.zipf <= 4.2) ||
      (bw >= 2.8 && bw <= 4.5);
    const isObscureHapax = !isRepeated && (bw > 4.5 || (opts.zipf != null && opts.zipf < 2.5));

    if (isRepeated) {
      wL2 *= 1.35;
    }
    if (isSweetSpotB1C1) {
      wL2 *= 1.2;
    }
    if (isObscureHapax) {
      wL2 *= 0.65;
    }
  }

  return pUnknown * freqReward * wZona * bLocucion * wL2;
}

// ---------- Filas de la preparación ----------

// Fila de la hoja: la PreparationRow completa vive aparte (por clave)
// para armar evidencia al confirmar; aquí va lo que se muestra y por
// qué se eligió — `reason` alimenta el historial de trayecto.
export type SuggestionRow = {
  key: string;
  form: string;
  lemma?: string | null;
  pos?: string | null;
  meaning?: string;
  context?: string;
  contextSnippet?: string;
  learning?: boolean;
  reason: PresentedReason;
  zipf?: number | null;
};

export type SuggestionRows = {
  // Selección principal: predichas (raras o explícitas) y «por
  // aprender». Son las que piden respuesta al entrar.
  rows: SuggestionRow[];
  // Consulta secundaria: el catálogo no tiene ficha o medición para
  // decidir — se ofrecen colapsadas, sin declararlas raras ni comunes.
  uncertain: SuggestionRow[];
  // Candidatas que no cupieron en la selección principal: la hoja las
  // ofrece en una consulta aparte — no se descartan ni se declaran
  // conocidas por el recorte.
  deferred: SuggestionRow[];
};

// Tope de filas de la consulta secundaria (la lista puede ser larga
// en capítulos con muchas formas fuera del catálogo).
export const UNCERTAIN_ROWS_CAP = 40;

// Tope global de la selección principal: incluye predichas, formas
// sin ficha declaradas y palabras ya guardadas. Lo que no cabe va a
// `deferred` — jamás «40 predichas más las aprendiendo ilimitadas».
export const PREPARATION_ROWS_CAP = 40;

// Construye las filas de la hoja desde un análisis listo: predichas
// con ficha, las que ya están en el Cuaderno («aprendiendo») y, en la
// bandeja secundaria, lo que el catálogo no sabe medir. Las formas
// solo capitalizadas sin ficha (nombres propios, extranjerismos como
// «Billy») quedan fuera — siguen consultables en el texto, pero no
// son vocabulario que se prepare. La evidencia explícita
// «no la conozco» manda sobre todo lo demás: entra a la selección
// principal aunque la forma no tenga ficha.
export function buildSuggestionRows(input: {
  language: string;
  forms: string[];
  entries: Record<string, LexiconEntry[]>;
  capitalOnly: ReadonlySet<string>;
  text: string;
  saved: ReadonlyMap<string, MarkLevel>;
  knowledge: ReadonlyMap<
    string,
    {
      lemma: string;
      known: boolean;
      status?: "unknown" | "familiar" | "known";
      passiveSeenCount?: number;
      estimatedKnownProb?: number;
    }
  >;
  threshold: number;
  // Datos léxicos completos por clave: los necesita el confirmar para
  // armar evidencia y palabras sin volver a buscarlos.
  lex?: Map<string, PreparationRow>;
  userTheta?: number;
  bookFrequencies?: ReadonlyMap<string, number>;
  isSecondLanguage?: boolean;
}): SuggestionRows {
  const { language, entries, capitalOnly, text, saved, knowledge, threshold, lex } = input;
  // Frecuencias de aparición de formas en el capítulo para Next-Chapter Utility
  const chapterFrequencies = new Map<string, number>();
  for (const f of input.forms) {
    const lower = f.toLowerCase();
    chapterFrequencies.set(lower, (chapterFrequencies.get(lower) ?? 0) + 1);
  }
  // Barrera local además de la del análisis: dígitos, puntuación
  // residual y palabras funcionales nunca llegan a la hoja, ni a la
  // selección ni a la consulta secundaria.
  const forms = input.forms.filter(
    (form) => isWordToken(form) && !isStopword(form, language),
  );
  const prediction = predictSection(
    forms,
    entries,
    new Set(saved.keys()),
    knowledge,
    threshold,
  );
  // La selección principal se arma por prioridad: evidencia
  // desconocida primero, «por aprender» después y rareza al final.
  // Dentro de cada grupo se conserva el orden de llegada (las
  // candidatas ya vienen ordenadas por rareza).
  const explicit: SuggestionRow[] = [];
  const learning: SuggestionRow[] = [];
  const rarity: SuggestionRow[] = [];
  const uncertain: SuggestionRow[] = [];
  // Una sola candidata por clave de respuesta (lema): dos formas del
  // mismo lema serían dos filas con la misma evidencia.
  const seenKeys = new Set<string>();
  const pushRow = (
    row: PreparationRow,
    extras: { learning?: boolean; reason: PresentedReason; zipf?: number | null },
  ) => {
    const key = preparationAnswerKey(language, row);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const target =
      extras.reason === "explicit_unknown"
        ? explicit
        : extras.reason === "learning"
          ? learning
          : extras.reason === "rarity"
            ? rarity
            : uncertain;
    target.push({
      key,
      form: row.form,
      lemma: row.lemma,
      pos: row.pos,
      meaning: row.meaning,
      context: row.context,
      contextSnippet:
        row.contextSnippet ??
        (row.context ? extractChapterContextSnippet(row.context, row.form) : undefined),
      learning: extras.learning,
      reason: extras.reason,
      zipf: extras.zipf,
    });
    if (lex && !lex.has(key)) lex.set(key, row);
  };

  // Las claves de evidencia son lemas en minúsculas; la forma puede
  // venir capitalizada («Billy» se guarda como «billy»).
  const evidenceFor = (form: string, lemma?: string | null) =>
    knowledge.get(lemma ?? form) ??
    knowledge.get(form) ??
    knowledge.get(form.toLowerCase());
  const knownExplicitly = (form: string, lemma?: string | null) =>
    evidenceFor(form, lemma)?.known === true;
  const unknownExplicitly = (form: string, lemma?: string | null) =>
    evidenceFor(form, lemma)?.known === false;

  // Candidatas con ficha: las predichas y las que el tope interno
  // dejó diferidas compiten aquí por los lugares principales — una
  // explícita de poca rareza jamás pierde su lugar contra una rara
  // sin evidencia solo por el orden de la lista.
  for (const item of [...prediction.predicted, ...prediction.deferred]) {
    const entry = item.entry;
    const sense = entry.senses[0];
    pushRow(
      {
        form: item.form,
        lemma: entry.lemma,
        pos: entry.pos,
        meaning: sense?.definition,
        context: firstSentenceWith(text, item.form, language),
        senseEntryId: entry.entryId,
        senseOrder: sense?.senseOrder,
      },
      {
        reason: unknownExplicitly(item.form, entry.lemma)
          ? "explicit_unknown"
          : "rarity",
        zipf: entry.zipf,
      },
    );
  }
  // Palabras del capítulo ya en el Cuaderno: nuevas/aprendiendo, y
  // también asentadas declaradas desconocidas — la evidencia manda
  // sin tocar su tarjeta. Conocidas y dominadas se excluyen; un
  // «no la conozco» sobre una dominada no pasa por aquí — la predice
  // la regla de evidencia. Con respuesta explícita cuentan en el
  // grupo de evidencia, no en el de repaso.
  for (const form of forms) {
    const level = saved.get(form);
    if (level == null) continue;
    const entry = entries[form]?.[0];
    const evidence = knowledge.get(entry?.lemma ?? form) ?? knowledge.get(form);
    if (!preparationLearning(level, evidence)) continue;
    const sense = entry?.senses[0];
    pushRow(
      {
        form,
        lemma: entry?.lemma,
        pos: entry?.pos,
        meaning: sense?.definition,
        context: firstSentenceWith(text, form, language),
        senseEntryId: entry?.entryId,
        senseOrder: sense?.senseOrder,
      },
      {
        learning: true,
        reason:
          evidence?.known === false ? "explicit_unknown" : "learning",
        zipf: entry?.zipf,
      },
    );
  }
  // Catálogo sin información suficiente: fichas sin medición y formas
  // sin ficha. Con evidencia explícita van a la selección principal;
  // declaradas conocidas se omiten; el resto ofrece consulta
  // secundaria. Los nombres solo capitalizados se descartan.
  const pushUncertain = (form: string, entry?: LexiconEntry) => {
    const explicit = unknownExplicitly(form, entry?.lemma);
    // Un «no la conozco» manda sobre el filtro de nombres: si el
    // lector la declara, la forma entra aunque parezca nombre propio.
    if (capitalOnly.has(form) && !explicit) return;
    if (knownExplicitly(form, entry?.lemma)) return;
    if (!explicit && uncertain.length >= UNCERTAIN_ROWS_CAP) return;
    const sense = entry?.senses[0];
    pushRow(
      {
        form,
        lemma: entry?.lemma,
        pos: entry?.pos,
        meaning: sense?.definition,
        context: firstSentenceWith(text, form, language),
        senseEntryId: entry?.entryId,
        senseOrder: sense?.senseOrder,
      },
      {
        reason: explicit ? "explicit_unknown" : "catalog_uncertain",
        zipf: entry?.zipf ?? null,
      },
    );
  };
  for (const item of prediction.uncertain) pushUncertain(item.form, item.entry);
  for (const form of prediction.missing) pushUncertain(form);

  // Ordenamiento contextual Next-Chapter Utility de las candidatas de rareza:
  // Combina probabilidad logística de desconocimiento, recompensa por frecuencia
  // en la obra, campana de Zona de Desarrollo Próximo (i+1) y bonificación de locución.
  const utilityOf = (row: SuggestionRow) =>
    nextChapterUtility({
      zipf: row.zipf,
      userTheta: input.userTheta,
      threshold,
      chapterFreq: chapterFrequencies.get(row.form.toLowerCase()) ?? 1,
      bookFreq: input.bookFrequencies?.get(row.form.toLowerCase()),
      isPhrase:
        row.pos === "locución" ||
        row.pos?.includes("locución") ||
        row.form.includes(" "),
      isSecondLanguage: input.isSecondLanguage,
    });

  rarity.sort((a, b) => {
    const diff = utilityOf(b) - utilityOf(a);
    if (Math.abs(diff) > 1e-6) return diff;
    const za = a.zipf ?? Number.POSITIVE_INFINITY;
    const zb = b.zipf ?? Number.POSITIVE_INFINITY;
    return za - zb || a.form.localeCompare(b.form);
  });

  // Corte global: 40 lugares por prioridad (evidencia, aprendiendo,
  // rareza); el resto queda consultable en la lista diferida.
  const all = [...explicit, ...learning, ...rarity];
  return {
    rows: all.slice(0, PREPARATION_ROWS_CAP),
    uncertain,
    deferred: all.slice(PREPARATION_ROWS_CAP),
  };
}

/**
 * Extrae la palabra de mayor utilidad léxica de una oración para la captura al vuelo en TTS (Innovación 4).
 * Descarta stopwords, signos de puntuación y números, priorizando términos de mayor rareza/utilidad.
 */
export function extractKeyWordFromSentence(
  sentence: string,
  language = "es",
  catalogEntries?: Map<string, LexiconEntry | null>,
): { form: string; lemma?: string; pos?: string } | null {
  if (!sentence || typeof sentence !== "string") return null;
  const clean = sentence.trim();
  if (!clean) return null;

  const segmenter =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter(language, { granularity: "word" })
      : null;

  const rawTokens: string[] = [];
  if (segmenter) {
    for (const part of segmenter.segment(clean)) {
      if (part.isWordLike && isWordToken(part.segment)) {
        rawTokens.push(part.segment);
      }
    }
  } else {
    const matches = clean.match(/[\p{L}\p{M}]+/gu) ?? [];
    for (const m of matches) {
      if (isWordToken(m)) rawTokens.push(m);
    }
  }

  // Filtrar stopwords y palabras demasiado cortas (< 3 letras)
  const candidates = rawTokens.filter((token) => {
    const lower = token.toLowerCase();
    return lower.length >= 3 && !isStopword(lower, language);
  });

  if (candidates.length === 0) {
    const fallback = rawTokens.filter((t) => t.length >= 2).sort((a, b) => b.length - a.length)[0];
    if (!fallback) return null;
    return { form: fallback };
  }

  // Puntuación por rareza / catálogo / longitud
  const scored = candidates.map((form) => {
    const lower = form.toLowerCase();
    const entry = catalogEntries?.get(lower);
    let score = 0;
    if (entry?.zipf != null) {
      score += Math.max(0, 7.5 - entry.zipf) * 10;
    } else {
      score += 15;
    }
    score += Math.min(10, form.length);
    if (form[0] === form[0].toUpperCase() && form[0] !== form[0].toLowerCase()) {
      score += 4;
    }
    return {
      form,
      lemma: entry?.lemma ?? form.toLowerCase(),
      pos: entry?.pos ?? undefined,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return { form: best.form, lemma: best.lemma, pos: best.pos };
}

// ---------- Selector Científico de Palabras Pre-Capítulo (ZPD + Cowan) ----------

/** Límite cognitivo de Cowan (4 ± 1 bloques) por defecto para pre-lectura */
export const MAX_PREVIEW_WORDS = 5;
export const MIN_PREVIEW_WORDS = 3;
export const MAX_PREVIEW_WORDS_L2_TECHNICAL = 7;
export const MAX_CONTEXT_SNIPPET_CHARS = 140;

export type LexicalPosTag = "verb" | "noun" | "adj" | "adv" | "phrase" | "other";

/**
 * Peso semántico W_POS(w): prioriza verbos de acción, adjetivos de tono,
 * sustantivos clave y locuciones sobre adverbios o formas neutras.
 */
export function getSemanticPosWeight(pos?: LexicalPosTag | string | null): number {
  if (!pos) return 1.0;
  const norm = pos.toLowerCase();
  if (norm.startsWith("phrase") || norm.startsWith("loc")) return 1.3;
  if (norm.startsWith("v")) return 1.25;
  if (norm.startsWith("adj")) return 1.2;
  if (norm.startsWith("n") || norm.startsWith("sust")) return 1.15;
  if (norm.startsWith("adv")) return 0.9;
  return 1.0;
}

/**
 * Zona de Desarrollo Próximo de Vygotsky: Zona(\theta_{u,L}, \beta_w)
 * Campana gaussiana centrada ligeramente por encima del nivel actual del lector
 * (\mu = \theta_{u,L} + 0.35, \sigma = 1.05) para impulsar aprendizaje sin frustración.
 */
export function computeZpdZoneWeight(thetaUL: number, betaW: number): number {
  const targetDifficulty = thetaUL + 0.35;
  const sigma = 1.05;
  const z = (betaW - targetDifficulty) / sigma;
  return Math.exp(-0.5 * z * z);
}

/**
 * Puntaje de Utilidad Pre-Capítulo U(w, c, u):
 * U(w, c, u) = (1 - P(conoce_{u,w})) * ln(1 + freq_{w,c}) * Zona(\theta_{u,L}, \beta_w) * W_POS(w)
 */
export function computePreChapterWordUtility(params: {
  thetaUL: number;
  betaW: number;
  freqInChapter: number;
  pos?: LexicalPosTag | string | null;
  knowledgeStatus?: "known" | "learning" | "seen" | "unknown" | null;
  stability?: number | null;
  lastSeenTimestampMs?: number | null;
  nowMs?: number;
}): {
  utility: number;
  pKnow: number;
  unknownProb: number;
  freqImpact: number;
  zoneWeight: number;
  posWeight: number;
} {
  const {
    thetaUL,
    betaW,
    freqInChapter,
    pos,
    knowledgeStatus,
    stability,
    lastSeenTimestampMs,
    nowMs,
  } = params;

  const pKnow = estimateWordKnowProbability({
    thetaUL,
    betaW,
    knowledgeStatus,
    stability,
    lastSeenTimestampMs,
    nowMs,
  });

  const unknownProb = Math.max(0, 1 - pKnow);
  const freqImpact = Math.log(1 + Math.max(1, freqInChapter));
  const zoneWeight = computeZpdZoneWeight(thetaUL, betaW);
  const posWeight = getSemanticPosWeight(pos);

  const utility = unknownProb * freqImpact * zoneWeight * posWeight;

  return {
    utility,
    pKnow,
    unknownProb,
    freqImpact,
    zoneWeight,
    posWeight,
  };
}

/**
 * Extrae la cita real del capítulo donde aparece la palabra (máx. 140 caracteres)
 * sin cortar palabras a la mitad, lista para el priming contextual en SectionPreview.tsx.
 */
export function extractChapterContextSnippet(
  chapterText: string,
  surfaceWord: string,
  maxChars: number = MAX_CONTEXT_SNIPPET_CHARS,
): string {
  if (!chapterText || !surfaceWord) return "";

  const cleanText = chapterText.replace(/\s+/g, " ").trim();
  const escaped = surfaceWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^\\p{L}])(${escaped})(?=$|[^\\p{L}])`, "iu");
  const match = regex.exec(cleanText);

  if (!match) {
    return cleanText.slice(0, maxChars);
  }

  const wordStart = match.index + match[1].length;
  const wordEnd = wordStart + match[2].length;

  // Delimitar por la oración contenedora (. ! ? ¡ ¿ ; \n)
  let sentenceStart = wordStart;
  while (sentenceStart > 0 && !/[.!?¡¿;\n]/.test(cleanText[sentenceStart - 1])) {
    sentenceStart--;
  }
  let sentenceEnd = wordEnd;
  while (sentenceEnd < cleanText.length && !/[.!?;\n]/.test(cleanText[sentenceEnd])) {
    sentenceEnd++;
  }
  if (sentenceEnd < cleanText.length && /[.!?]/.test(cleanText[sentenceEnd])) {
    sentenceEnd++;
  }

  const sentence = cleanText.slice(sentenceStart, sentenceEnd).trim();
  if (sentence.length <= maxChars) {
    return sentence;
  }

  // Si la oración supera los 140 caracteres, centrar ventana alrededor de la palabra
  const relStart = Math.max(0, wordStart - sentenceStart);
  const halfWindow = Math.floor((maxChars - surfaceWord.length) / 2);
  let sliceStart = Math.max(0, relStart - halfWindow);
  let sliceEnd = Math.min(sentence.length, sliceStart + maxChars);

  if (sliceEnd - sliceStart < maxChars) {
    sliceStart = Math.max(0, sliceEnd - maxChars);
  }

  // Ajustar a límites de palabra para no cortar sílabas
  if (sliceStart > 0) {
    const nextSpace = sentence.indexOf(" ", sliceStart);
    if (nextSpace !== -1 && nextSpace < relStart) {
      sliceStart = nextSpace + 1;
    }
  }
  if (sliceEnd < sentence.length) {
    const prevSpace = sentence.lastIndexOf(" ", sliceEnd);
    if (prevSpace > relStart + surfaceWord.length) {
      sliceEnd = prevSpace;
    }
  }

  const prefix = sliceStart > 0 ? "…" : "";
  const suffix = sliceEnd < sentence.length ? "…" : "";
  return `${prefix}${sentence.slice(sliceStart, sliceEnd).trim()}${suffix}`;
}

export interface ChapterPrimingCandidate {
  lemma: string;
  surfaceForm: string;
  lang: string;
  beta: number; // Dificultad intrínseca de la palabra (-3 a +3.5)
  chapterFrequency: number;
  partOfSpeech?: "noun" | "verb" | "adj" | "adv" | "phrase" | "other";
  shortGloss: string; // Glosa breve o traducción contextual (L2)
  contextSentence: string; // Oración real del capítulo (máx. 140 caracteres)
  contextSnippet?: string; // Cita contextual exacta (máx. 140 caracteres)
  fsrsRetrievability?: number; // Si ya está en FSRS (0 a 1)
  isKnownExplicitly?: boolean;
}

export interface ScoredPrimingWord extends ChapterPrimingCandidate {
  utilityScore: number;
  unknownProbability: number;
}

/**
 * Calcula la campana gaussiana de la Zona de Desarrollo Próximo (Vygotsky).
 * Prioriza palabras que están ligeramente por encima del nivel actual del lector (theta + 0.6).
 */
export function computeZpdWeight(
  theta: number,
  beta: number,
  isForeignLanguage: boolean,
): number {
  const optimalChallengeOffset = isForeignLanguage ? 0.35 : 0.65;
  const targetBeta = theta + optimalChallengeOffset;
  const sigma = isForeignLanguage ? 1.15 : 1.0;
  const diff = beta - targetBeta;
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

export const POS_WEIGHTS: Record<string, number> = {
  phrase: 1.35, // Locuciones / phrasal verbs son críticos para no perder contexto en L2
  verb: 1.25, // Núcleo de la acción narrativa
  adj: 1.15, // Tono y atmósfera
  noun: 1.10,
  adv: 0.90,
  other: 0.75,
};

export function selectOptimalChapterPrimingWords(
  candidates: ChapterPrimingCandidate[],
  userTheta: number,
  options: {
    maxWords: number;
    isForeignLanguage: boolean;
    minUtilityThreshold?: number;
  },
): ScoredPrimingWord[] {
  const minThreshold = options.minUtilityThreshold ?? 0.22;

  const scored: ScoredPrimingWord[] = [];

  for (const item of candidates) {
    if (item.isKnownExplicitly) continue;

    // 1. Probabilidad de que el usuario NO conozca o haya olvidado la palabra
    const pKnown =
      item.fsrsRetrievability !== undefined
        ? item.fsrsRetrievability
        : predictWordMasteryProbability(userTheta, item.beta);

    const unknownProb = 1 - pKnown;
    if (unknownProb < 0.25) continue; // El usuario ya la domina con >75% de probabilidad

    // 2. Impacto en la cobertura léxica del capítulo
    const frequencyImpact = Math.log(1 + item.chapterFrequency);

    // 3. Ajuste a la Zona de Desarrollo Próximo
    const zpdWeight = computeZpdWeight(
      userTheta,
      item.beta,
      options.isForeignLanguage,
    );

    // 4. Peso semántico por categoría gramatical
    const posWeight = POS_WEIGHTS[item.partOfSpeech ?? "other"] ?? 1.0;

    // 5. Bonificación FSRS si es una palabra vista antes que está a punto de olvidarse (R entre 0.30 y 0.75)
    const fsrsBoost =
      item.fsrsRetrievability !== undefined &&
      item.fsrsRetrievability >= 0.3 &&
      item.fsrsRetrievability <= 0.75
        ? 1.3
        : 1.0;

    const utilityScore =
      unknownProb * frequencyImpact * zpdWeight * posWeight * fsrsBoost;

    if (utilityScore >= minThreshold) {
      scored.push({
        ...item,
        utilityScore: Number(utilityScore.toFixed(4)),
        unknownProbability: Number(unknownProb.toFixed(3)),
      });
    }
  }

  // Ordenar de mayor utilidad cognitiva a menor y cortar según límite de memoria de trabajo (Cowan)
  return scored
    .sort((a, b) => b.utilityScore - a.utilityScore)
    .slice(0, options.maxWords);
}

/**
 * Trunca y limpia una oración contextual a un máximo de caracteres sin cortar palabras.
 */
export function cleanContextSentence(
  sentence: string | undefined,
  maxChars = 140,
): string {
  if (!sentence) return "";
  const trimmed = sentence.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export function normalizePosCategory(
  pos?: string | null,
): ChapterPrimingCandidate["partOfSpeech"] {
  if (!pos) return "other";
  const p = pos.toLowerCase();
  if (p.includes("phrase") || p.includes("locución") || p.includes("modismo"))
    return "phrase";
  if (p.includes("verb") || p.includes("verbo")) return "verb";
  if (p.includes("adj") || p.includes("adjetivo")) return "adj";
  if (p.includes("adv") || p.includes("adverbio")) return "adv";
  if (p.includes("noun") || p.includes("sustantivo") || p.includes("nombre"))
    return "noun";
  return "other";
}

export function buildChapterPrimingCandidates(input: {
  forms: string[];
  entries: Record<string, LexiconEntry[]>;
  text: string;
  lang: string;
  userTheta?: number;
  isForeignLanguage?: boolean;
  knowledge?: ReadonlyMap<string, { lemma: string; known: boolean }>;
  fsrsRetrievabilities?: ReadonlyMap<string, number>;
  maxWords?: number;
  glosses?: ReadonlyMap<string, string>;
}): ScoredPrimingWord[] {
  const {
    forms,
    entries,
    text,
    lang,
    userTheta = 0.0,
    isForeignLanguage = false,
    knowledge,
    fsrsRetrievabilities,
    maxWords = 4,
    glosses,
  } = input;

  const frequencies = new Map<string, number>();
  for (const f of forms) {
    const lower = f.toLowerCase();
    if (isWordToken(lower) && !isStopword(lower, lang)) {
      frequencies.set(lower, (frequencies.get(lower) ?? 0) + 1);
    }
  }

  const seenLemmas = new Set<string>();
  const candidates: ChapterPrimingCandidate[] = [];

  for (const [form, freq] of frequencies) {
    const entry = entries[form]?.[0];
    const lemma = (entry?.lemma ?? form).toLowerCase();
    if (seenLemmas.has(lemma)) continue;
    seenLemmas.add(lemma);

    const isKnown =
      knowledge?.get(lemma)?.known === true || knowledge?.get(form)?.known === true;
    const beta = betaFromZipf(entry?.zipf);
    const pos = normalizePosCategory(entry?.pos);
    const shortGloss =
      glosses?.get(lemma) ??
      glosses?.get(form) ??
      entry?.senses?.[0]?.definition ??
      "";
    const rawContext = firstSentenceWith(text, form, lang);
    const contextSnippet = extractChapterContextSnippet(rawContext ?? text, form, 140);
    const contextSentence = contextSnippet || cleanContextSentence(rawContext, 140);
    const fsrsRetrievability =
      fsrsRetrievabilities?.get(lemma) ?? fsrsRetrievabilities?.get(form);

    candidates.push({
      lemma,
      surfaceForm: form,
      lang,
      beta,
      chapterFrequency: freq,
      partOfSpeech: pos,
      shortGloss,
      contextSentence,
      contextSnippet,
      fsrsRetrievability,
      isKnownExplicitly: isKnown,
    });
  }

  return selectOptimalChapterPrimingWords(candidates, userTheta, {
    maxWords,
    isForeignLanguage,
  });
}

export interface SectionWord {
  word: string;
  sentence?: string;
  count?: number;
}

export function extractSectionWords(
  doc: Document,
  options?: { maxWords?: number; language?: string },
): SectionWord[] {
  const maxWords = options?.maxWords ?? 18;
  const lang = options?.language ?? "es";
  const text = doc.body?.textContent ?? "";
  if (!text.trim()) return [];

  const segmenter = new Intl.Segmenter(lang, { granularity: "word" });
  const freq = new Map<string, { count: number; sentence?: string }>();
  const sentences = [...new Intl.Segmenter(lang, { granularity: "sentence" }).segment(text)];

  for (const s of sentences) {
    const sText = s.segment.trim();
    for (const w of segmenter.segment(sText)) {
      if (!w.isWordLike) continue;
      const word = w.segment;
      const lower = word.toLowerCase();
      if (lower.length < 3 || isStopword(lower)) continue;
      const current = freq.get(lower);
      if (!current) {
        freq.set(lower, { count: 1, sentence: sText });
      } else {
        current.count++;
      }
    }
  }

  const sorted = [...freq.entries()].sort((a, b) => b[1].count - a[1].count);
  return sorted.slice(0, maxWords).map(([word, data]) => ({
    word,
    sentence: data.sentence,
    count: data.count,
  }));
}


