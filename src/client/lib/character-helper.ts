import { isStopword } from "../../shared/stopwords";
import { searchBookMentions, type SearchSection, type SearchTocRow } from "./book-search";

export interface SpoilerBoundary {
  /** Índice del capítulo actual (0-based) */
  chapterIndex: number;
  /** Desplazamiento máximo de carácter o párrafo dentro del capítulo actual */
  charOffsetInChapter?: number;
}

export interface CharacterMention {
  chapterIndex: number;
  chapterTitle: string;
  sentence: string;
  charOffset: number;
}

export interface CharacterMemoryCard {
  name: string;
  aliases: string[];
  totalMentionsUpToCursor: number;
  firstMention: CharacterMention | null;
  recentMention: CharacterMention | null;
  coOccurringCharacters: string[]; // Otros personajes que aparecen en las mismas oraciones
}

export interface CharacterCardInfo {
  name: string;
  oneLiner: string;
}

export const HONORIFICS = new Set([
  "don", "doña", "sr", "sra", "srta", "dr", "dra", "capitán", "general",
  "mr", "mrs", "ms", "miss", "sir", "lady", "lord", "captain", "prof",
  "monsieur", "madame", "mademoiselle", "herr", "frau",
]);

/**
 * Determina si un token seleccionado dentro de una oración es probablemente un nombre propio (Personaje/Lugar)
 */
export function isLikelyProperNoun(
  surfaceToken: string,
  surroundingSentence: string,
  lang = "es",
): boolean {
  const clean = surfaceToken.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  if (clean.length < 2) return false;

  const firstChar = clean.charAt(0);
  if (firstChar !== firstChar.toUpperCase() || firstChar === firstChar.toLowerCase()) {
    return false;
  }

  const lower = clean.toLowerCase();
  if (isStopword(lower, lang) && !HONORIFICS.has(lower)) {
    return false;
  }

  // Si no está al inicio de la oración y empieza con mayúscula, es altamente probable que sea nombre propio
  const trimmedSentence = surroundingSentence.trim().replace(/^[«"“'¿¡—–-\s]+/, "");
  if (!trimmedSentence.startsWith(clean)) {
    return true;
  }

  // Si está al inicio de la oración, verificamos si va precedido o seguido de otra palabra capitalizada o título
  const words = trimmedSentence.split(/\s+/);
  if (words.length >= 2) {
    const firstWordLower = words[0].replace(/[^\p{L}]/gu, "").toLowerCase();
    const secondWordClean = words[1].replace(/[^\p{L}]/gu, "");
    if (HONORIFICS.has(firstWordLower)) return true;
    if (
      secondWordClean.length > 1 &&
      secondWordClean.charAt(0) === secondWordClean.charAt(0).toUpperCase() &&
      secondWordClean.charAt(0) !== secondWordClean.charAt(0).toLowerCase()
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Construye la ficha de memoria de un personaje garantizando CERO SPOILERS
 * (nunca inspecciona texto posterior a `boundary`).
 */
export function buildZeroSpoilerCharacterCard(
  targetName: string,
  chapters: Array<{ index: number; title: string; plainText: string }>,
  boundary: SpoilerBoundary,
): CharacterMemoryCard {
  const cleanTarget = targetName.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  if (cleanTarget.length < 2) {
    return {
      name: cleanTarget,
      aliases: [],
      totalMentionsUpToCursor: 0,
      firstMention: null,
      recentMention: null,
      coOccurringCharacters: [],
    };
  }

  const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordRegex = new RegExp(`\\b${escaped}\\b`, "i");

  const mentions: CharacterMention[] = [];
  const coCharacters = new Map<string, number>();
  const aliasesSet = new Set<string>();

  // Orden cronológico estricto de capítulos
  const sortedChapters = [...chapters].sort((a, b) => a.index - b.index);

  for (const ch of sortedChapters) {
    // BARRERA CERO SPOILERS: Ignorar cualquier capítulo futuro
    if (ch.index > boundary.chapterIndex) break;

    const allowedText =
      ch.index === boundary.chapterIndex && boundary.charOffsetInChapter !== undefined
        ? ch.plainText.slice(0, boundary.charOffsetInChapter)
        : ch.plainText;

    if (!wordRegex.test(allowedText)) continue;

    // Dividir en oraciones conservando desplazamientos aproximados y evitando cortes en abreviaturas (Dr., Sr., Mr., etc.)
    const sentences = allowedText.split(
      /(?<!\b(?:Dr|Dra|Sr|Sra|Srta|Mr|Mrs|Ms|Prof)\.)(?<=[.!?…])\s+|\n+/i,
    );
    let runningOffset = 0;

    for (const rawSentence of sentences) {
      const sentence = rawSentence.trim();
      const currentOffset = runningOffset;
      runningOffset += rawSentence.length + 1;

      if (sentence.length < 10) continue;
      if (wordRegex.test(sentence)) {
        const compactSentence =
          sentence.length <= 165 ? sentence : `${sentence.slice(0, 162).trim()}…`;

        mentions.push({
          chapterIndex: ch.index,
          chapterTitle: ch.title || `Capítulo ${ch.index + 1}`,
          sentence: compactSentence,
          charOffset: currentOffset,
        });

        // Buscar variantes o títulos honoríficos asociados (alias)
        const honorificPattern = new RegExp(`\\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\\s+${escaped})\\b`, "gi");
        let hMatch: RegExpExecArray | null;
        while ((hMatch = honorificPattern.exec(sentence)) !== null) {
          const cand = hMatch[1]?.trim();
          if (cand && cand.toLowerCase() !== cleanTarget.toLowerCase()) {
            aliasesSet.add(cand);
          }
        }

        // Detectar otros nombres propios en la misma escena/oración
        const tokens = sentence.split(/\s+/);
        for (let i = 1; i < tokens.length; i++) {
          const tok = tokens[i].replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
          const tokLower = tok.toLowerCase();
          if (
            tok.length >= 3 &&
            tokLower !== cleanTarget.toLowerCase() &&
            tok.charAt(0) === tok.charAt(0).toUpperCase() &&
            tok.charAt(0) !== tok.charAt(0).toLowerCase() &&
            !isStopword(tokLower, "es") &&
            !isStopword(tokLower, "en") &&
            !HONORIFICS.has(tokLower)
          ) {
            coCharacters.set(tok, (coCharacters.get(tok) ?? 0) + 1);
          }
        }
      }
    }
  }

  const firstMention = mentions.length > 0 ? mentions[0] : null;
  const recentMention =
    mentions.length > 1 ? mentions[mentions.length - 1] : null;

  const topCompanions = Array.from(coCharacters.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  return {
    name: cleanTarget,
    aliases: Array.from(aliasesSet).slice(0, 3),
    totalMentionsUpToCursor: mentions.length,
    firstMention,
    recentMention,
    coOccurringCharacters: topCompanions,
  };
}

/**
 * Escanea la página actual y busca referencias pasadas sin spoilers.
 * Corta el arreglo de capítulos en el índice actual (currentChapterIndex - 1 hacia atrás)
 * para que sea matemáticamente imposible un spoiler del futuro.
 */
export async function getCharactersOnPageWithoutSpoilers(params: {
  pageText: string;
  currentChapterIndex: number;
  bookId: string;
  sections?: SearchSection[];
  toc?: SearchTocRow[];
}): Promise<CharacterCardInfo[]> {
  const { pageText, currentChapterIndex, bookId } = params;

  // Extraer palabras capitalizadas candidatas a nombres propios (dos palabras o una palabra relevante)
  const twoWordMatches = pageText.match(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/gu) || [];
  const singleWordMatches = pageText.match(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/gu) || [];
  const stopNames = new Set([
    "Capítulo", "Capitulo", "Sección", "Seccion", "Libro", "Parte",
    "Lecta", "The", "And", "This", "That", "Cuando", "Donde", "Pero",
    "Entonces", "Mientras", "Aunque", "Luego", "Desde", "Hasta",
  ]);
  const filteredSingle = singleWordMatches.filter((w) => !stopNames.has(w));
  const matches = [...twoWordMatches, ...filteredSingle];
  const uniqueNames = Array.from(new Set(matches)).slice(0, 4);

  const results: CharacterCardInfo[] = [];

  for (const name of uniqueNames) {
    // Buscar exclusivamente en capítulos anteriores (currentChapterIndex - 1 hacia atrás)
    const history = await searchBookMentions({
      bookId,
      query: name,
      maxChapterIndex: currentChapterIndex - 1,
      sections: params.sections,
      toc: params.toc,
    });

    if (history.length > 0) {
      results.push({
        name,
        oneLiner: history[0].shortContextSnippet || "Mencionado anteriormente en la historia.",
      });
    }
  }

  return results;
}
