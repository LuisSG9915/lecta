import { isStopword } from "../../shared/stopwords";
import { isCommonEnglishWord } from "../../shared/english-core-lexicon";
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
  "monsieur", "madame", "mademoiselle", "herr", "frau", "madam",
  "san", "santa", "st",
]);

export const COMMON_CAPITALIZED_NOUNS = new Set([
  // Escena, espacio, tiempo y personas (EN)
  "hall", "security", "door", "room", "window", "house", "street", "place",
  "office", "table", "voice", "hand", "hands", "eyes", "eye", "face", "head",
  "mind", "life", "world", "morning", "afternoon", "evening", "night", "day",
  "days", "time", "year", "years", "moment", "man", "men", "woman", "women",
  "boy", "boys", "girl", "girls", "child", "children", "people", "person",
  "friend", "friends", "father", "mother", "brother", "sister",
  // Escena, espacio, tiempo y personas (ES)
  "puerta", "puertas", "sala", "salas", "habitación", "habitacion", "habitaciones",
  "ventana", "ventanas", "casa", "casas", "calle", "calles", "hombre", "hombres",
  "mujer", "mujeres", "niño", "niña", "niños", "niñas", "mañana", "tarde", "noche",
  "noches", "día", "dia", "días", "dias", "tiempo", "momento", "momentos", "gente",
  "padre", "madre", "padres", "hermano", "hermana", "amigo", "amiga", "amigos",
  // Números escritos (EN + ES)
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "twenty", "hundred", "thousand",
  "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "once", "doce", "veinte", "cien", "ciento", "mil",
  // Días de la semana y meses (EN + ES)
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "lunes", "martes", "miércoles", "miercoles", "jueves", "viernes", "sábado", "sabado", "domingo",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
  // Puntos cardinales y colores
  "north", "south", "east", "west", "norte", "sur", "este", "oeste",
  "red", "blue", "green", "yellow", "black", "white",
  "rojo", "azul", "verde", "amarillo", "negro", "blanco",
  // Rótulos estructurales
  "chapter", "part", "section", "book", "prologue", "epilogue",
  "capítulo", "capitulo", "parte", "sección", "seccion", "libro", "prólogo", "prologo", "epílogo", "epilogo",
  // Otros comunes
  "lecta",
]);

/**
 * Determina con precisión si una posición dada dentro de un texto corresponde
 * a una posición intraoracional (no al inicio de párrafo/línea ni tras puntuación de corte).
 */
export function isIntraSentencePosition(text: string, offset: number): boolean {
  if (offset <= 0) return false;

  let i = offset - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "\n" || ch === "\r") {
      // Precedido por salto de línea/inicio de párrafo
      return false;
    }
    // Ignorar espacios y comillas/signos de apertura
    if (/[ \t\f\v\u00A0«"“”'‘’¿¡([/]/.test(ch)) {
      i--;
      continue;
    }
    break;
  }

  if (i < 0) return false;

  const prevChar = text[i];
  // Si el caracter no-espacio/no-apertura previo es de corte oracional o raya de diálogo
  if (/[.!?…:;—–-]/.test(prevChar)) {
    return false;
  }

  return true;
}

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

  // Si es un honorífico, verificamos si va seguido de un nombre propio en la misma frase
  if (HONORIFICS.has(lower)) {
    const trimmed = surroundingSentence.trim().replace(/^[«"“'¿¡—–-\s]+/, "");
    const words = trimmed.split(/\s+/);
    if (words.length >= 2) {
      const firstWordClean = words[0].replace(/[^\p{L}]/gu, "").toLowerCase();
      if (firstWordClean === lower) {
        const secondClean = words[1].replace(/[^\p{L}]/gu, "");
        if (
          secondClean.length > 1 &&
          secondClean.charAt(0) === secondClean.charAt(0).toUpperCase() &&
          secondClean.charAt(0) !== secondClean.charAt(0).toLowerCase() &&
          !isStopword(secondClean.toLowerCase(), lang) &&
          !COMMON_CAPITALIZED_NOUNS.has(secondClean.toLowerCase())
        ) {
          return true;
        }
      }
    }
    return false;
  }

  if (isStopword(lower, lang) || isStopword(lower, "en") || isStopword(lower, "es")) {
    return false;
  }

  if (COMMON_CAPITALIZED_NOUNS.has(lower)) {
    return false;
  }

  if (lang === "en" && isCommonEnglishWord(lower)) {
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
      secondWordClean.charAt(0) !== secondWordClean.charAt(0).toLowerCase() &&
      !isStopword(secondWordClean.toLowerCase(), lang) &&
      !COMMON_CAPITALIZED_NOUNS.has(secondWordClean.toLowerCase())
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Extrae candidatos de personajes válidos de una página de texto aplicando
 * filtros de stopwords, sustantivos comunes capitalizados y contexto intraoracional.
 */
export function extractCharacterCandidates(pageText: string, lang = "es"): string[] {
  if (!pageText || pageText.trim().length === 0) return [];

  // Captura cadenas de 1 a 4 tokens capitalizados consecutivos tolerando comillas/apóstrofes iniciales
  const regex = /((?<![\p{L}])[«“"'(¿¡—–\s-]*([A-ZÁÉÍÓÚÜÑ][\p{Ll}áéíóúüñ]{1,}(?:\s+[A-ZÁÉÍÓÚÜÑ][\p{Ll}áéíóúüñ]{1,}){0,3}))/gu;

  interface CandidateGroup {
    name: string;
    tokens: string[];
    count: number;
    hasIntraSentence: boolean;
  }

  const groups = new Map<string, CandidateGroup>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(pageText)) !== null) {
    const fullMatch = match[0];
    const candidateName = match[2]?.trim();
    if (!candidateName) continue;

    const candidateOffset = match.index + fullMatch.indexOf(candidateName);
    const tokens = candidateName.split(/\s+/);
    if (tokens.length === 0) continue;

    // Validación de tokens
    let valid = true;
    const hasInitialHonorific = tokens.length >= 2 && HONORIFICS.has(tokens[0].toLowerCase());

    for (let i = 0; i < tokens.length; i++) {
      if (i === 0 && hasInitialHonorific) continue; // Exención de honorífico inicial
      const tokLower = tokens[i].toLowerCase();
      if (
        isStopword(tokLower, lang) ||
        isStopword(tokLower, "en") ||
        isStopword(tokLower, "es") ||
        COMMON_CAPITALIZED_NOUNS.has(tokLower)
      ) {
        valid = false;
        break;
      }
    }

    if (!valid) continue;

    const isIntra = isIntraSentencePosition(pageText, candidateOffset);

    // Regla estricta para candidatos de 1 sola palabra
    if (tokens.length === 1) {
      const singleLower = tokens[0].toLowerCase();
      // 1. Descartar si el token en minúsculas está en HONORIFICS
      if (HONORIFICS.has(singleLower)) continue;
      // 2. Descartar si en inglés pertenece al vocabulario común de english-core-lexicon
      if (isCommonEnglishWord(singleLower)) continue;
    }

    const existing = groups.get(candidateName);
    if (existing) {
      existing.count += 1;
      if (isIntra) existing.hasIntraSentence = true;
    } else {
      groups.set(candidateName, {
        name: candidateName,
        tokens,
        count: 1,
        hasIntraSentence: isIntra,
      });
    }
  }

  // Filtrar candidatos de 1 sola palabra que no tengan al menos 1 aparición intraoracional
  const candidates = Array.from(groups.values()).filter((c) => {
    if (c.tokens.length === 1) {
      return c.hasIntraSentence;
    }
    return true;
  });

  // Ordenar priorizando:
  // 1. Candidatos con recurrencia (count >= 2) o compuestos (tokens >= 2)
  // 2. Mayor número de apariciones (count desc)
  // 3. Mayor longitud de tokens (tokens.length desc)
  candidates.sort((a, b) => {
    const aPriority = a.count >= 2 || a.tokens.length >= 2 ? 1 : 0;
    const bPriority = b.count >= 2 || b.tokens.length >= 2 ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    if (b.count !== a.count) return b.count - a.count;
    if (b.tokens.length !== a.tokens.length) return b.tokens.length - a.tokens.length;
    return a.name.localeCompare(b.name);
  });

  return candidates.slice(0, 4).map((c) => c.name);
}

/**
 * Construye la ficha de memoria de un personaje garantizando CERO SPOILERS
 * (nunca inspecciona texto posterior a `boundary`).
 */
export function buildZeroSpoilerCharacterCard(
  targetName: string,
  chapters: Array<{ index: number; title: string; plainText: string }>,
  boundary: SpoilerBoundary,
  lang = "es",
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
            !isStopword(tokLower, lang) &&
            !HONORIFICS.has(tokLower) &&
            !COMMON_CAPITALIZED_NOUNS.has(tokLower)
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
  lang?: string;
}): Promise<CharacterCardInfo[]> {
  const { pageText, currentChapterIndex, bookId, lang = "es" } = params;

  const uniqueNames = extractCharacterCandidates(pageText, lang);
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
