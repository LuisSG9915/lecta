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
