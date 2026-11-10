// Resaltado morfológico de la palabra objetivo dentro de la cita del
// libro: reconoce flexiones del español (corrían → correr, pensó →
// pensar, duerme → dormir) para que la ficha y los ejercicios marquen
// el término real del pasaje y no solo la forma literal.

const stripDiacritics = (str: string) =>
  str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Normaliza alternancias vocálicas y diptongaciones frecuentes en raíces del español
// (pensar -> piensa, dormir -> duerme, pedir -> pidió, sentir -> sintió)
const foldSpanishDiphthongs = (str: string) =>
  stripDiacritics(str)
    .replace(/ie/g, "e")
    .replace(/ue/g, "o")
    .replace(/qu/g, "c")
    .replace(/gu(?=[ei])/g, "g");

// Extrae la raíz léxica aproximada eliminando desinencias verbales y nominales comunes
function extractLexicalStem(word: string): string {
  const clean = stripDiacritics(word).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  if (clean.length <= 3) return clean;
  const stripped = clean.replace(
    /(?:amiento|imiento|aciones|iciones|abamos|ieramos|aramos|asteis|isteis|aremos|eremos|iremos|arian|erian|irian|ando|iendo|aron|ieron|aban|ian|ando|adas|ados|idas|idos|arse|erse|irse|acion|icion|mente|anza|idad|ar|er|ir|as|es|os|an|en|in|on|ado|ido|aba|ia|ad|ed|id|s)$/u,
    "",
  );
  return stripped.length >= 3 ? stripped : clean.slice(0, Math.max(3, clean.length - 2));
}

export function findEpisodicHighlightRange(
  context: string,
  form: string,
  lemma?: string,
): { start: number; end: number } | null {
  const cleanForm = form.trim().replace(/^[.,;:!?¡¿"'«»([]—–-]+|[.,;:!?¡¿"'«»([]—–-]+$/g, "");
  const cleanLemma = lemma?.trim().replace(/^[.,;:!?¡¿"'«»([]—–-]+|[.,;:!?¡¿"'«»([]—–-]+$/g, "");
  const candidates = [cleanForm, cleanLemma, form.trim()].filter(
    (c): c is string => Boolean(c && c.length > 0),
  );
  if (!candidates.length) return null;

  // Tokenizar palabras del pasaje respetando caracteres Unicode (NFC y NFD)
  const tokens = Array.from(context.matchAll(/[\p{L}\p{M}]+/gu));

  // 1. Si el candidato es una locución (contiene espacios), buscar secuencia de tokens en coordenadas originales
  for (const cand of candidates) {
    if (/\s/.test(cand)) {
      const candWords = Array.from(cand.matchAll(/[\p{L}\p{M}]+/gu)).map((m) =>
        stripDiacritics(m[0]),
      );
      if (candWords.length > 0 && tokens.length >= candWords.length) {
        for (let i = 0; i <= tokens.length - candWords.length; i++) {
          let allMatch = true;
          for (let k = 0; k < candWords.length; k++) {
            if (stripDiacritics(tokens[i + k][0]) !== candWords[k]) {
              allMatch = false;
              break;
            }
          }
          if (allMatch) {
            const firstTok = tokens[i];
            const lastTok = tokens[i + candWords.length - 1];
            if (firstTok.index !== undefined && lastTok.index !== undefined) {
              return {
                start: firstTok.index,
                end: lastTok.index + lastTok[0].length,
              };
            }
          }
        }
      }
      const rawIdx = context.toLowerCase().indexOf(cand.toLowerCase());
      if (rawIdx !== -1) return { start: rawIdx, end: rawIdx + cand.length };
    }
  }

  // 2. Coincidencia exacta de token completo (case-insensitive)
  for (const cand of candidates) {
    const lowerCand = cand.toLowerCase();
    const exact = tokens.find((t) => t[0].toLowerCase() === lowerCand);
    if (exact && exact.index !== undefined) {
      return { start: exact.index, end: exact.index + exact[0].length };
    }
  }

  // 3. Coincidencia de token completo ignorando tildes/diacríticos
  for (const cand of candidates) {
    const normCand = stripDiacritics(cand);
    const match = tokens.find((t) => stripDiacritics(t[0]) === normCand);
    if (match && match.index !== undefined) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }

  // 4. Buscador de raíz morfológica (lexical stem matcher) para formas conjugadas o flexionadas
  for (const cand of candidates) {
    const rawStem = extractLexicalStem(cand);
    const foldedStem = foldSpanishDiphthongs(rawStem);
    if (rawStem.length < 3) continue;

    for (const token of tokens) {
      const tokenText = token[0];
      const normToken = stripDiacritics(tokenText);
      const tokenStem = extractLexicalStem(tokenText);

      const matchesRawStem =
        normToken.startsWith(rawStem) ||
        (tokenStem.length >= 3 && (rawStem.startsWith(tokenStem) || tokenStem.startsWith(rawStem)));

      const foldedToken = foldSpanishDiphthongs(tokenText);
      const foldedTokenStem = foldSpanishDiphthongs(tokenStem);
      const matchesFoldedStem =
        foldedStem.length >= 3 &&
        (foldedToken.startsWith(foldedStem) ||
          (foldedTokenStem.length >= 3 &&
            (foldedStem.startsWith(foldedTokenStem) || foldedTokenStem.startsWith(foldedStem))));

      if (matchesRawStem || matchesFoldedStem) {
        return { start: token.index!, end: token.index! + tokenText.length };
      }
    }
  }

  // 5. Fallback final por subcadena si contiene caracteres no léxicos
  const fallbackIdx = context.toLowerCase().indexOf(cleanForm.toLowerCase());
  if (fallbackIdx !== -1 && cleanForm.length > 0) {
    return { start: fallbackIdx, end: fallbackIdx + cleanForm.length };
  }

  return null;
}

// Resalta la palabra (o su flexión morfológica) dentro del contexto del libro con estilo ámbar suave (Hueco 3.1)
export function renderHighlightedContext(
  context: string | null | undefined,
  form: string,
  lemma?: string,
) {
  if (!context) return null;
  if (!form || !form.trim()) return context;
  const range = findEpisodicHighlightRange(context, form, lemma);
  if (!range) return context;
  const before = context.slice(0, range.start);
  const match = context.slice(range.start, range.end);
  const after = context.slice(range.end);
  return (
    <>
      {before}
      <mark className="nb-word-quote-highlight">{match}</mark>
      {after}
    </>
  );
}
