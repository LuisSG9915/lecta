// Locuciones del Wikcionario en el cliente (fase B). El índice lo
// genera scripts/lexicon-phrases.mjs desde el dump y se sirve como
// asset estático: la detección no toca la red ni la IA — solo el
// análisis léxico del capítulo que ya está en memoria.
//
// El match es por LEMA token a token: cada token de la locución
// («morder», «el», «anzuelo») se compara contra los lemas del token
// correspondiente de la oración («mordido» → morder), así las
// formas flexionadas matchean igual que la superficie literal.

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

export interface DetectedMultiwordPhrase {
  phrase: string;
  normalizedId: string;
  lang: string;
  gloss: string;
  startIndex: number;
  endIndex: number;
  difficultyBeta: number;
}

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
 * Banco base de locuciones y phrasal verbs frecuentes en L2 (inglés/francés/español)
 * para detección instantánea offline en < 1ms.
 */
export const CORE_FOREIGN_IDIOMS: Array<{
  lang: string;
  pattern: string;
  glossEs: string;
  glossEn: string;
  beta: number;
}> = [
  { lang: "en", pattern: "take for granted", glossEs: "dar por sentado", glossEn: "assume as certain", beta: 0.6 },
  { lang: "en", pattern: "make up mind", glossEs: "decidirse", glossEn: "decide", beta: 0.4 },
  { lang: "en", pattern: "catch off guard", glossEs: "tomar por sorpresa", glossEn: "surprise", beta: 0.8 },
  { lang: "en", pattern: "in the long run", glossEs: "a la larga", glossEn: "eventually", beta: 0.5 },
  { lang: "en", pattern: "at stake", glossEs: "en juego / en riesgo", glossEn: "at risk", beta: 0.7 },
  { lang: "en", pattern: "bear in mind", glossEs: "tener en cuenta", glossEn: "remember", beta: 0.5 },
  { lang: "en", pattern: "out of the blue", glossEs: "de repente / sin previo aviso", glossEn: "unexpectedly", beta: 0.7 },
  { lang: "fr", pattern: "avoir beau", glossEs: "por más que / aunque", glossEn: "no matter how much", beta: 0.9 },
  { lang: "fr", pattern: "en vouloir à", glossEs: "guardar rencor a", glossEn: "hold a grudge against", beta: 1.0 },
  { lang: "es", pattern: "a duras penas", glossEs: "con gran dificultad", glossEn: "barely / with difficulty", beta: 0.6 },
  { lang: "es", pattern: "dar por sentado", glossEs: "asumir como seguro", glossEn: "take for granted", beta: 0.5 },
];

const U_START = "(?:(?<=[^\\p{L}\\p{N}])|^)";
const U_END = "(?=[^\\p{L}\\p{N}]|$)";

const IDIOM_SPECIAL_PATTERNS: Record<string, string> = {
  "take for granted": `${U_START}(?:take|takes|took|taken|taking)(?:\\s+[\\p{L}\\p{N}]+)?\\s+for\\s+granted${U_END}`,
  "make up mind": `${U_START}(?:make|makes|made|making)\\s+up(?:\\s+(?:one's|his|her|their|my|our|your))?\\s+mind${U_END}`,
  "catch off guard": `${U_START}(?:catch|catches|caught|catching)(?:\\s+[\\p{L}\\p{N}]+)?\\s+off\\s+guard${U_END}`,
  "in the long run": `${U_START}in\\s+the\\s+long\\s+run${U_END}`,
  "at stake": `${U_START}at\\s+stake${U_END}`,
  "bear in mind": `${U_START}(?:bear|bears|bore|borne|bearing)\\s+in\\s+mind${U_END}`,
  "out of the blue": `${U_START}out\\s+of\\s+the\\s+blue${U_END}`,
  "avoir beau": `${U_START}(?:avoir|ai|as|a|avons|avez|ont|avais|avait|avions|aviez|avaient|eut|eurent)\\s+beau${U_END}`,
  "en vouloir à": `${U_START}en\\s+(?:vouloir|veux|veut|voulons|voulez|veulent|voulais|voulait|voulurent)\\s+[àa]${U_END}`,
  "a duras penas": `${U_START}[aá]\\s+duras\\s+penas${U_END}`,
  "dar por sentado": `${U_START}(?:dar|da|doy|das|damos|dan|dio|dieron|daba|daban|dando|dado)\\s+por\\s+sentado${U_END}`,
};

const regexCache = new Map<string, RegExp>();

function getIdiomRegex(pattern: string): RegExp {
  let rx = regexCache.get(pattern);
  if (!rx) {
    const rawPattern =
      IDIOM_SPECIAL_PATTERNS[pattern] ??
      `${U_START}${pattern
        .trim()
        .split(/\\s+/)
        .map((t) => t.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"))
        .join("\\s+")}${U_END}`;
    rx = new RegExp(rawPattern, "gui");
    regexCache.set(pattern, rx);
  }
  return rx;
}

/**
 * Detecta locuciones multilingües, expresiones idiomáticas y phrasal verbs en un texto
 * con soporte para español, inglés y francés en < 1ms sin dependencias de red.
 */
export function detectMultiwordPhrases(
  text: string,
  lang = "en",
  targetGlossLang: "es" | "en" = "es",
  idioms = CORE_FOREIGN_IDIOMS,
): DetectedMultiwordPhrase[] {
  if (!text) return [];
  const langKey = lang.slice(0, 2).toLowerCase();
  const relevant = idioms.filter((item) => item.lang.toLowerCase() === langKey);
  if (!relevant.length) return [];

  const detected: DetectedMultiwordPhrase[] = [];

  for (const item of relevant) {
    const rx = getIdiomRegex(item.pattern);
    rx.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rx.exec(text)) !== null) {
      const phrase = match[0];
      const startIndex = match.index;
      const endIndex = startIndex + phrase.length;
      const gloss = targetGlossLang === "en" ? item.glossEn : item.glossEs;

      detected.push({
        phrase,
        normalizedId: item.pattern,
        lang: item.lang,
        gloss,
        startIndex,
        endIndex,
        difficultyBeta: item.beta,
      });

      if (phrase.length === 0) {
        rx.lastIndex++;
      }
    }
  }

  // Ordenar por startIndex y en caso de solapamiento preferir la coincidencia más larga
  detected.sort(
    (a, b) =>
      a.startIndex - b.startIndex ||
      (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex),
  );

  const nonOverlapping: DetectedMultiwordPhrase[] = [];
  let lastEnd = -1;
  for (const d of detected) {
    if (d.startIndex >= lastEnd) {
      nonOverlapping.push(d);
      lastEnd = d.endIndex;
    }
  }

  return nonOverlapping;
}

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

