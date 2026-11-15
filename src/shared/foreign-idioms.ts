// Banco de locuciones y phrasal verbs frecuentes en L2 (inglés,
// francés, español) con detección multilingüe offline en < 1 ms.
// Vive en shared porque lo usan dos lados: el cliente (ficha de
// palabra, andamiaje bilingüe) y el worker (guías de «Series y
// películas», donde las frases detectadas en el subtítulo se
// guardan solo como claves de este banco — nunca como texto).
//
// La lógica se movió tal cual desde src/client/lib/phrases.ts:
// phrases.ts la reexporta con los mismos nombres y sin cambios de
// comportamiento.

export interface DetectedMultiwordPhrase {
  phrase: string;
  normalizedId: string;
  lang: string;
  gloss: string;
  startIndex: number;
  endIndex: number;
  difficultyBeta: number;
}

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

export const U_START = "(?:(?<=[^\\p{L}\\p{N}])|^)";
export const U_END = "(?=[^\\p{L}\\p{N}]|$)";

export const IDIOM_SPECIAL_PATTERNS: Record<string, string> = {
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

export function getIdiomRegex(pattern: string): RegExp {
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
