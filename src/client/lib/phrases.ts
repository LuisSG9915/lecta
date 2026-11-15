// Locuciones del Wikcionario en el cliente (fase B). El índice lo
// genera scripts/lexicon-phrases.mjs desde el dump y se sirve como
// asset estático: la detección no toca la red ni la IA — solo el
// análisis léxico del capítulo que ya está en memoria.
//
// El match es por LEMA token a token: cada token de la locución
// («morder», «el», «anzuelo») se compara contra los lemas del token
// correspondiente de la oración («mordido» → morder), así las
// formas flexionadas matchean igual que la superficie literal.
//
// El banco de locuciones y la detección multilingüe viven en
// src/shared/foreign-idioms.ts (los usa también el worker para las
// guías de pantalla): aquí se reexportan con los mismos nombres.

import {
  CORE_FOREIGN_IDIOMS,
  detectMultiwordPhrases,
  type DetectedMultiwordPhrase,
} from "../../shared/foreign-idioms";

export {
  CORE_FOREIGN_IDIOMS,
  IDIOM_SPECIAL_PATTERNS,
  U_START,
  U_END,
  getIdiomRegex,
  detectMultiwordPhrases,
  type DetectedMultiwordPhrase,
} from "../../shared/foreign-idioms";

export type PhraseHit = {
  // La locución tal como la lematiza el Wikcionario («picar el
  // anzuelo» o el alias «morder el anzuelo»).
  lemma: string;
  pos: string | null;
  definitions: string[];
};

export type PhraseIndex = {
  // token normalizado de la locución → índices en `phrases`: la
  // palabra tocada puede estar en cualquier posición de la frase.
  byToken: Map<string, number[]>;
  phrases: { tokens: string[]; hit: PhraseHit }[];
};

// Los lemas del índice y las formas del análisis se comparan en
// minúsculas conservando acentos — la misma normalización que usa
// el catálogo para sus formas.
const norm = (token: string) =>
  token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

const phraseTokens = (phrase: string) =>
  phrase
    .split(/\s+/)
    .map(norm)
    .filter(Boolean);

type PhrasesPayload = {
  entries?: { p: string; pos: string | null; d: string[] }[];
};

export const buildPhraseIndex = (payload: PhrasesPayload): PhraseIndex => {
  const index: PhraseIndex = { byToken: new Map(), phrases: [] };
  for (const entry of payload.entries ?? []) {
    const tokens = phraseTokens(entry.p);
    if (tokens.length < 2) continue;
    const id = index.phrases.length;
    index.phrases.push({
      tokens,
      hit: { lemma: entry.p, pos: entry.pos, definitions: entry.d },
    });
    for (const token of tokens) {
      const bucket = index.byToken.get(token);
      if (bucket) bucket.push(id);
      else index.byToken.set(token, [id]);
    }
  }
  return index;
};

let phrasesPromise: Promise<PhraseIndex | null> | null = null;

// Singleton perezoso: un solo fetch en la vida de la app. Ante
// cualquier fallo devuelve null — la ficha funciona igual sin él.
export function loadPhrases(): Promise<PhraseIndex | null> {
  phrasesPromise ??= fetch("/lexicon/locuciones.es.json")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => (data ? buildPhraseIndex(data as PhrasesPayload) : null))
    .catch(() => null);
  return phrasesPromise;
}

// Solo para pruebas: reinicia el singleton.
export function resetPhrasesForTest() {
  phrasesPromise = null;
}

// Lemas de un token de la oración: la superficie misma más los
// lemas de sus fichas del catálogo. Siempre devuelve al menos el
// token — así las frases sin flexión matchean aunque el capítulo
// aún no tenga análisis.
export type LemmaOf = (token: string) => ReadonlySet<string>;

export function lemmaOfFromEntries(
  entries: Record<string, { lemma: string }[]> | undefined,
): LemmaOf {
  const cache = new Map<string, Set<string>>();
  return (token) => {
    let lemmas = cache.get(token);
    if (!lemmas) {
      lemmas = new Set([token]);
      for (const entry of entries?.[token] ?? []) {
        lemmas.add(norm(entry.lemma));
      }
      cache.set(token, lemmas);
    }
    return lemmas;
  };
}

// Busca la locución MÁS LARGA que cubra la palabra tocada dentro de
// su oración. Cada token de la frase debe corresponder —por lema—
// al token palabra consecutivo del texto; la palabra tocada tiene
// que quedar dentro de la ventana (tocar «trampa» en «no cayó en
// la trampa» no dispara «morder el anzuelo»).
export function matchPhrase(
  index: PhraseIndex,
  sentence: string,
  tappedWord: string,
  lemmaOf: LemmaOf,
): PhraseHit | null {
  const tapped = norm(tappedWord);
  if (!tapped) return null;
  const sentTokens = [
    ...new Intl.Segmenter("es", { granularity: "word" }).segment(sentence),
  ]
    .filter((part) => part.isWordLike)
    .map((part) => norm(part.segment));

  const tappedPositions: number[] = [];
  sentTokens.forEach((token, i) => {
    if (token === tapped) tappedPositions.push(i);
  });
  if (!tappedPositions.length) return null;

  // Candidatas: frases que contienen algún lema del token tocado.
  const candidates = new Set<number>();
  for (const lemma of lemmaOf(tapped)) {
    for (const id of index.byToken.get(lemma) ?? []) candidates.add(id);
  }

  let best: { length: number; start: number; hit: PhraseHit } | null = null;
  const sentLemmas = sentTokens.map((token) => lemmaOf(token));
  for (const id of candidates) {
    const phrase = index.phrases[id];
    const len = phrase.tokens.length;
    if (len <= (best?.length ?? 0)) continue;
    if (len > sentTokens.length) continue;
    for (const tappedPos of tappedPositions) {
      // Ventanas de `len` tokens que cubren la posición tocada.
      const firstStart = Math.max(0, tappedPos - len + 1);
      const lastStart = Math.min(tappedPos, sentTokens.length - len);
      for (let start = firstStart; start <= lastStart; start++) {
        let j = 0;
        while (j < len && sentLemmas[start + j].has(phrase.tokens[j])) j++;
        if (j === len) {
          best = { length: len, start, hit: phrase.hit };
          break;
        }
      }
    }
  }
  return best?.hit ?? null;
}

// ---------------------------------------------------------------------------
// Extensión multilingüe y adaptativa (Track 11 — Fase 1)
// ---------------------------------------------------------------------------

export type BilingualScaffoldingTier = 1 | 2 | 3 | "off";

export interface BilingualScaffoldingProfile {
  /** 'auto': adapta entre Nivel 1, 2 y 3 según la densidad del párrafo y el usuario; 'off': desactivado */
  mode: "auto" | "tier-1-only" | "tier-3-always" | "off";
  /** IDs de libros donde el usuario desactivó la asistencia bilingüe */
  mutedBookIds: string[];
  /** Sesgo aprendido por idioma (-0.35 = lector muy autónomo, +0.35 = prefiere más apoyo) */
  autonomyBiasByLang: Record<string, number>;
}

export const DEFAULT_BILINGUAL_PROFILE: BilingualScaffoldingProfile = {
  mode: "auto",
  mutedBookIds: [],
  autonomyBiasByLang: {},
};

/**
 * Busca si una palabra tocada dentro de una oración forma parte de una locución o phrasal verb.
 */
export function matchForeignIdiom(
  sentence: string,
  tappedWord: string,
  lang = "en",
  targetGlossLang: "es" | "en" = "es",
  idioms = CORE_FOREIGN_IDIOMS,
): DetectedMultiwordPhrase | null {
  const normTapped = norm(tappedWord);
  if (!normTapped) return null;

  const detected = detectMultiwordPhrases(sentence, lang, targetGlossLang, idioms);
  for (const item of detected) {
    const words = item.phrase.toLowerCase().split(/[^\p{L}\p{N}]+/gu).map(norm).filter(Boolean);
    if (words.includes(normTapped)) {
      return item;
    }
  }
  return null;
}

/**
 * Calcula la Densidad de Fricción Léxica D_p combinando la proporción de palabras/locuciones
 * cuya dificultad beta_w supera el nivel theta del lector y la longitud media de cláusula.
 */
export function calculateLexicalFrictionDensity(
  wordDifficulties: number[],
  theta: number,
  avgClauseWords: number,
): number {
  if (wordDifficulties.length === 0) return 0;
  const probSum = wordDifficulties.reduce((sum, beta) => {
    const pKnow = 1 / (1 + Math.exp(-(theta - beta)));
    return sum + (1 - pKnow);
  }, 0);
  const lexicalComponent = probSum / wordDifficulties.length;
  const syntacticPenalty = Math.max(0, (avgClauseWords - 18) / 20) * 0.15;
  return lexicalComponent + syntacticPenalty;
}

/**
 * Calcula qué nivel de andamiaje bilingüe (1, 2 o 3) necesita un párrafo específico
 * según la competencia del usuario (theta) y su sesgo de autonomía aprendido.
 */
export function selectOptimalScaffoldingTier(
  paragraphText: string,
  unknownWordRatio: number, // 0.0 a 1.0
  lang: string,
  profile: BilingualScaffoldingProfile,
  bookId?: string,
): BilingualScaffoldingTier {
  if (profile.mode === "off") return "off";
  if (bookId && profile.mutedBookIds.includes(bookId)) return "off";
  if (profile.mode === "tier-1-only") return 1;
  if (profile.mode === "tier-3-always") return 3;

  const langKey = lang.slice(0, 2).toLowerCase() || "en";
  const bias = profile.autonomyBiasByLang[langKey] ?? 0.0;

  // Calcular longitud media de cláusula en palabras
  const clauses = paragraphText
    .split(/[,;:—–.!?]+/)
    .filter((c) => c.trim().length > 0);
  const totalWords = paragraphText.trim() ? paragraphText.trim().split(/\s+/).length : 0;
  const avgClauseWords = clauses.length > 0 ? totalWords / clauses.length : totalWords;

  const syntacticPenalty = Math.max(0, (avgClauseWords - 18) / 20) * 0.15;
  const effectiveFriction = unknownWordRatio * 4.5 + syntacticPenalty + bias;

  if (effectiveFriction < 0.28) return 1;
  if (effectiveFriction < 0.52) return 2;
  return 3;
}

/**
 * Ajusta el modelo de autonomía bilingüe según el comportamiento real del lector:
 * - action = 'escalated': el usuario pidió más traducción de la que se mostró inicialmente.
 * - action = 'read-autonomously': el usuario leyó el párrafo sin pedir traducción adicional.
 */
export function updateBilingualAutonomyProfile(
  profile: BilingualScaffoldingProfile,
  lang: string,
  action: "escalated" | "read-autonomously",
): BilingualScaffoldingProfile {
  const langKey = lang.slice(0, 2).toLowerCase() || "en";
  const currentBias = profile.autonomyBiasByLang[langKey] ?? 0.0;
  const delta = action === "escalated" ? 0.055 : -0.015;
  const nextBias = Math.max(-0.35, Math.min(0.35, currentBias + delta));

  return {
    ...profile,
    autonomyBiasByLang: {
      ...profile.autonomyBiasByLang,
      [langKey]: Number(nextBias.toFixed(4)),
    },
  };
}

export const BILINGUAL_PROFILE_KEY = "lecta:bilingual_scaffolding_profile:v1";

export function loadBilingualScaffoldingProfile(): BilingualScaffoldingProfile {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(BILINGUAL_PROFILE_KEY) : null;
    if (!raw) return { ...DEFAULT_BILINGUAL_PROFILE };
    const parsed = JSON.parse(raw) as Partial<BilingualScaffoldingProfile>;
    return {
      mode:
        parsed.mode === "auto" ||
        parsed.mode === "tier-1-only" ||
        parsed.mode === "tier-3-always" ||
        parsed.mode === "off"
          ? parsed.mode
          : DEFAULT_BILINGUAL_PROFILE.mode,
      mutedBookIds: Array.isArray(parsed.mutedBookIds) ? parsed.mutedBookIds : [],
      autonomyBiasByLang:
        typeof parsed.autonomyBiasByLang === "object" && parsed.autonomyBiasByLang !== null
          ? parsed.autonomyBiasByLang
          : {},
    };
  } catch {
    return { ...DEFAULT_BILINGUAL_PROFILE };
  }
}

export function saveBilingualScaffoldingProfile(
  profile: BilingualScaffoldingProfile,
): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(BILINGUAL_PROFILE_KEY, JSON.stringify(profile));
    }
  } catch {
    // ignorar quota error
  }
}

export function muteBilingualForBook(bookId: string): void {
  if (!bookId) return;
  const p = loadBilingualScaffoldingProfile();
  if (!p.mutedBookIds.includes(bookId)) {
    saveBilingualScaffoldingProfile({
      ...p,
      mutedBookIds: [...p.mutedBookIds, bookId],
    });
  }
}

export function unmuteBilingualForBook(bookId: string): void {
  if (!bookId) return;
  const p = loadBilingualScaffoldingProfile();
  saveBilingualScaffoldingProfile({
    ...p,
    mutedBookIds: p.mutedBookIds.filter((id) => id !== bookId),
  });
}

export function setBilingualMode(
  mode: BilingualScaffoldingProfile["mode"],
): void {
  const p = loadBilingualScaffoldingProfile();
  saveBilingualScaffoldingProfile({ ...p, mode });
}

export interface PhraseEntry {
  phrase: string;
  meaning: string;
  example?: string;
}

export interface PhrasesIndex {
  getAll: () => PhraseEntry[];
  findInSentence: (sentence: string, word?: string) => PhraseEntry | undefined;
}

export function createPhrasesIndex(index: PhraseIndex): PhrasesIndex {
  const allEntries: PhraseEntry[] = index.phrases.map((p) => ({
    phrase: p.hit.lemma,
    meaning: p.hit.definitions.join("; ") || p.hit.pos || "",
  }));
  return {
    getAll: () => allEntries,
    findInSentence: (sentence: string, word?: string) => {
      const hit = matchPhrase(index, sentence, word || "", (t) => new Set([t]));
      if (!hit) return undefined;
      return {
        phrase: hit.lemma,
        meaning: hit.definitions.join("; ") || hit.pos || "",
      };
    },
  };
}

export async function loadPhrasesIndex(): Promise<PhrasesIndex | null> {
  const index = await loadPhrases();
  if (!index) return null;
  return createPhrasesIndex(index);
}

export function clearPhraseMarks(doc: Document): void {
  if (!doc?.body) return;
  const marks = doc.querySelectorAll("mark.lecta-phrase-mark, mark.phrase-mark");
  marks.forEach((mark) => {
    mark.replaceWith(...mark.childNodes);
  });
  doc.body.normalize();
}

export function applyPhraseMarks(doc: Document, phrases: PhraseEntry[]): void {
  if (!doc?.body || !phrases || !phrases.length) return;
  const phraseMap = new Map<string, PhraseEntry>();
  for (const p of phrases) {
    if (p.phrase) phraseMap.set(p.phrase.toLowerCase(), p);
  }
  if (!phraseMap.size) return;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("mark.lecta-phrase-mark, mark.phrase-mark, script, style")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    textNodes.push(n as Text);
    n = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue;
    if (!text) continue;
    const lower = text.toLowerCase();
    for (const [lowerPhrase, entry] of phraseMap.entries()) {
      const idx = lower.indexOf(lowerPhrase);
      if (idx !== -1) {
        const before = textNode.splitText(idx);
        before.splitText(lowerPhrase.length);
        const mark = doc.createElement("mark");
        mark.className = "lecta-phrase-mark phrase-mark";
        mark.dataset.phrase = entry.phrase;
        mark.textContent = before.nodeValue;
        before.parentNode?.replaceChild(mark, before);
        break;
      }
    }
  }
}

