// Qué cuenta como palabra candidata a vocabulario. Compartido entre
// el segmentador (worker), el análisis de capítulo y la hoja de
// preparación para que ningún token espurio —dígitos, puntuación
// residual, siglas cortas— llegue a sugerirse.

// Solo letras del español (con tildes, ñ y ü) y al menos tres
// caracteres: «1», «10», «3,5», «sí», «él» o «a1b» no son
// vocabulario que se aprende.
const WORD_TOKEN = /^[a-záéíóúüñ]{3,}$/i;

export function isWordToken(form: string): boolean {
  return WORD_TOKEN.test(form.trim());
}

// Raíces candidatas de un adverbio en «-mente»: la base sin el
// sufijo («perfectamente» → «perfecta») y, si termina en -a, la forma
// masculina del lema («perfecta» → «perfecto») por si la tabla de
// formas no enlaza el femenino. Bases de menos de tres letras se
// descartan («mente» misma queda en «», «demente» en «de») — no hay
// adjetivo tan corto que derive adverbios.
export function menteBaseForms(form: string): string[] {
  if (!form.endsWith("mente")) return [];
  const root = form.slice(0, -"mente".length);
  if (root.length < 3) return [];
  return root.endsWith("a") ? [root, `${root.slice(0, -1)}o`] : [root];
}

export type ContextualPos = "sustantivo" | "verbo" | null;

const ES_DETERMINERS = new Set([
  "el", "la", "los", "las",
  "un", "una", "unos", "unas",
  "mi", "tu", "su", "mis", "tus", "sus",
  "este", "esta", "estos", "estas",
  "ese", "esa", "esos", "esas",
  "aquel", "aquella", "aquellos", "aquellas",
  "ningún", "ningun", "ninguna", "ningunos", "ningunas",
  "algún", "algun", "alguna", "algunos", "algunas",
  "cada", "cualquier", "cualesquier",
  "otro", "otra", "otros", "otras",
  "mucho", "mucha", "muchos", "muchas",
  "poco", "poca", "pocos", "pocas",
  "tanto", "tanta", "tantos", "tantas",
  "demasiado", "demasiada", "demasiados", "demasiadas",
  "del", "al", "sendos", "sendas",
  "nuestro", "nuestra", "nuestros", "nuestras",
  "vuestro", "vuestra", "vuestros", "vuestras",
]);

const EN_DETERMINERS = new Set([
  "the", "a", "an", "this", "that", "these", "those",
  "my", "your", "his", "her", "its", "our", "their",
  "every", "each", "any", "no", "of", "some", "many",
  "much", "few", "several", "all", "both",
]);

const ES_VERB_MARKERS = new Set([
  "me", "te", "se", "nos", "os", "le", "les",
  "yo", "tú", "él", "ella", "usted", "ustedes",
  "nosotros", "nosotras", "vosotros", "vosotras", "ellos", "ellas",
  "he", "has", "ha", "hemos", "habéis", "habeis", "han",
  "había", "habias", "habia", "habíamos", "habian", "habían",
  "suelo", "suele", "suelen",
  "debo", "debe", "deben",
  "quiero", "quiere", "quieren",
  "puedo", "puede", "pueden",
  "voy", "va", "van",
]);

const EN_VERB_MARKERS = new Set([
  "i", "you", "he", "she", "it", "we", "they",
  "will", "did", "do", "does", "would", "could", "should",
  "can", "must", "might", "may", "to",
]);

/**
 * Infiere la categoría gramatical más probable ('sustantivo' o 'verbo')
 * de una palabra en su oración hábitat a partir de su vecindad sintáctica inmediata.
 */
export function inferContextualPos(
  targetWord: string,
  contextSentence?: string | null,
  language = "es",
): ContextualPos {
  if (!targetWord || !contextSentence?.trim()) return null;

  const cleanTarget = targetWord.trim().toLowerCase();
  if (!cleanTarget) return null;

  const normalizedSentence = contextSentence
    .toLowerCase()
    .replace(/[¿?¡!«»“”"()[\],;:.\-–—\n\r\t]/g, " ");

  const tokens = normalizedSentence.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  const targetIdx = tokens.findIndex((t) => t === cleanTarget);
  if (targetIdx <= 0) return null;

  const prevToken = tokens[targetIdx - 1];
  const prevPrevToken = targetIdx >= 2 ? tokens[targetIdx - 2] : null;

  const isEnglish = language === "en";
  const determiners = isEnglish ? EN_DETERMINERS : ES_DETERMINERS;
  const verbMarkers = isEnglish ? EN_VERB_MARKERS : ES_VERB_MARKERS;

  // 1. Regla Sustantivo/Adjetivo: precedido por un determinante (directo o con modificador intermedio)
  if (determiners.has(prevToken)) {
    return "sustantivo";
  }

  if (prevPrevToken && determiners.has(prevPrevToken)) {
    return "sustantivo";
  }

  // 2. Regla Verbo: precedido por un marcador verbal / pronombre proclítico
  if (verbMarkers.has(prevToken)) {
    return "verbo";
  }

  if (
    prevPrevToken &&
    verbMarkers.has(prevPrevToken) &&
    (prevToken === "no" || prevToken === "ya" || prevToken === "nunca" || prevToken === "jamás" || prevToken === "not")
  ) {
    return "verbo";
  }

  return null;
}

const COMMON_LEXICAL_FAMILIES: Record<string, string[]> = {
  afrenta: ["afrentar", "afrentoso", "afrentado"],
  afrentar: ["afrenta", "afrentoso", "afrentado"],
  lector: ["lectura", "leer", "legible"],
  leer: ["lector", "lectura", "legible"],
  lectura: ["lector", "leer", "legible"],
  caminar: ["camino", "caminante", "caminata"],
  camino: ["caminar", "caminante", "caminata"],
  sombra: ["sombrío", "ensombrecer", "asombrar"],
  sombrío: ["sombra", "ensombrecer", "asombrar"],
  luz: ["luminoso", "iluminar", "lucidez"],
  luminoso: ["luz", "iluminar", "lucidez"],
  noche: ["nocturno", "anochecer", "trasnochar"],
  nocturno: ["noche", "anochecer", "trasnochar"],
  tierra: ["terrestre", "enterrar", "desterrar"],
  mar: ["marino", "marejada", "marinero"],
  fuego: ["fogoso", "hoguera", "fogonazo"],
  muerte: ["mortal", "morir", "inmortal"],
  vida: ["vital", "vivir", "revivir"],
  viento: ["ventisca", "ventarrón", "ventilar"],
  dolor: ["doloroso", "doler", "adolorido"],
  amor: ["amoroso", "enamorar", "desamor"],
  memoria: ["memorable", "conmemorar", "rememorar"],
  olvido: ["olvidar", "olvidadizo", "inolvidable"],
  pensar: ["pensamiento", "pensativo", "repensar"],
  silencio: ["silencioso", "silenciar", "ensordecedor"],
  soledad: ["solitario", "desolado", "solo"],
  tiempo: ["temporal", "intemporal", "temporada"],
  palabra: ["palabrería", "palabrero", "parlamento"],
};

/**
 * Devuelve hasta 3 términos emparentados morfológicamente (familia léxica).
 */
export function findLexicalFamily(word: string, language = "es"): string[] {
  const clean = word.trim().toLowerCase();
  if (clean.length < 3) return [];

  if (language === "es") {
    const direct = COMMON_LEXICAL_FAMILIES[clean];
    if (direct) {
      return direct.filter((w) => w !== clean).slice(0, 3);
    }

    // Reglas morfológicas productivas del español
    let candidates: string[] = [];
    if (clean.endsWith("amiento") || clean.endsWith("imiento")) {
      const root = clean.slice(0, -7);
      candidates = [`${root}ar`, `${root}ado`, `${root}ador`];
    } else if (clean.endsWith("ación") || clean.endsWith("acion")) {
      const root = clean.slice(0, -5);
      candidates = [`${root}ar`, `${root}ado`, `${root}ativo`];
    } else if (clean.endsWith("oso") || clean.endsWith("osa")) {
      const root = clean.slice(0, -3);
      candidates = [`${root}ar`, `${root}a`, `${root}idad`];
    } else if (clean.endsWith("ar")) {
      const root = clean.slice(0, -2);
      candidates = [`${root}ado`, `${root}ador`, `${root}ación`];
    } else if (clean.endsWith("er") || clean.endsWith("ir")) {
      const root = clean.slice(0, -2);
      candidates = [`${root}ido`, `${root}iente`, `${root}imiento`];
    } else if (clean.endsWith("a") || clean.endsWith("o")) {
      const root = clean.slice(0, -1);
      candidates = [`${root}ar`, `${root}oso`, `${root}ado`];
    }

    return Array.from(new Set(candidates))
      .filter((w) => w !== clean && w.length >= 3)
      .slice(0, 3);
  }

  // Fallback simple para inglés
  if (language === "en") {
    if (clean.endsWith("ing")) {
      const root = clean.slice(0, -3);
      return [`${root}ed`, `${root}er`, root].filter((w) => w !== clean && w.length >= 3).slice(0, 3);
    }
    if (clean.endsWith("ed")) {
      const root = clean.slice(0, -2);
      return [`${root}ing`, `${root}er`, root].filter((w) => w !== clean && w.length >= 3).slice(0, 3);
    }
  }

  return [];
}

/**
 * Genera formas base o lemas candidatos para buscar una palabra flexionada
 * en el diccionario local (español o inglés).
 */
export function generateLookupCandidates(word: string, language = "es"): string[] {
  const clean = word.trim().toLowerCase();
  if (!clean) return [];

  const candidates: string[] = [clean];

  if (language === "en") {
    // 1. -ies (> 4 letras) -> -y (ej. memories -> memory)
    if (clean.endsWith("ies") && clean.length > 4) {
      candidates.push(`${clean.slice(0, -3)}y`);
    }

    // 2. -ied (> 4 letras) -> -y (ej. replied -> reply)
    if (clean.endsWith("ied") && clean.length > 4) {
      candidates.push(`${clean.slice(0, -3)}y`);
    }

    // 3. -ing (> 5 letras) -> sin ing, con e final, sin consonante duplicada
    if (clean.endsWith("ing") && clean.length > 5) {
      const root = clean.slice(0, -3);
      candidates.push(root);
      candidates.push(`${root}e`);
      if (root.length >= 3 && root[root.length - 1] === root[root.length - 2]) {
        candidates.push(root.slice(0, -1));
      }
    }

    // 4. -ed (> 4 letras) -> sin ed, sin d, sin consonante duplicada
    if (clean.endsWith("ed") && clean.length > 4) {
      const rootNoEd = clean.slice(0, -2);
      candidates.push(rootNoEd);
      candidates.push(clean.slice(0, -1)); // sin d (loved -> love)
      if (rootNoEd.length >= 3 && rootNoEd[rootNoEd.length - 1] === rootNoEd[rootNoEd.length - 2]) {
        candidates.push(rootNoEd.slice(0, -1));
      }
    }

    // 5. -ly (> 4 letras) -> sin ly, o -ily -> -y
    if (clean.endsWith("ly") && clean.length > 4) {
      candidates.push(clean.slice(0, -2));
      if (clean.endsWith("ily") && clean.length > 4) {
        candidates.push(`${clean.slice(0, -3)}y`);
      }
    }

    // 6. -es (> 3 letras) -> sin es o sin s
    if (clean.endsWith("es") && clean.length > 3) {
      candidates.push(clean.slice(0, -2));
      candidates.push(clean.slice(0, -1));
    }

    // 7. -s (> 3 letras, excluyendo -ss) -> sin s
    if (clean.endsWith("s") && !clean.endsWith("ss") && clean.length > 3) {
      candidates.push(clean.slice(0, -1));
    }
  } else {
    // Español
    for (const base of menteBaseForms(clean)) {
      candidates.push(base);
    }
  }

  return Array.from(new Set(candidates)).filter((c) => c.length >= 2);
}

/**
 * Normaliza una forma superficial a su lema base más probable para consulta o comparación.
 */
export function normalizeWordForm(word: string, language = "es"): string {
  const clean = word.trim().toLowerCase();
  if (!clean) return "";
  const lang = language.slice(0, 2).toLowerCase();

  if (lang === "en") {
    // 1. -ies / -ied (> 4 letras) -> -y (memories -> memory, replied -> reply)
    if ((clean.endsWith("ies") || clean.endsWith("ied")) && clean.length > 4) {
      return `${clean.slice(0, -3)}y`;
    }
    // 2. -ly / -ily (> 4 letras) -> base / -y (reluctantly -> reluctant, happily -> happy)
    if (clean.endsWith("ly") && clean.length > 4) {
      if (clean.endsWith("ily")) return `${clean.slice(0, -3)}y`;
      return clean.slice(0, -2);
    }
    // 3. -ing (> 5 letras) -> base / desduplicación consonante (lingering -> linger, running -> run)
    if (clean.endsWith("ing") && clean.length > 5) {
      const root = clean.slice(0, -3);
      if (root.length >= 3 && root[root.length - 1] === root[root.length - 2]) {
        return root.slice(0, -1);
      }
      return root;
    }
    // 4. -ed (> 4 letras) -> base / desduplicación consonante (whispered -> whisper, stopped -> stop)
    if (clean.endsWith("ed") && clean.length > 4) {
      const root = clean.slice(0, -2);
      if (root.length >= 3 && root[root.length - 1] === root[root.length - 2]) {
        return root.slice(0, -1);
      }
      return root;
    }
    // 5. -es (> 4 letras) -> base (watches -> watch)
    if (clean.endsWith("es") && clean.length > 4) {
      if (clean.endsWith("shes") || clean.endsWith("ches") || clean.endsWith("sses") || clean.endsWith("xes")) {
        return clean.slice(0, -2);
      }
      return clean.slice(0, -1);
    }
    // 6. -s (> 3 letras) -> base (shadows -> shadow)
    if (clean.endsWith("s") && !clean.endsWith("ss") && clean.length > 3) {
      return clean.slice(0, -1);
    }
    return clean;
  }

  // Español
  if (clean.endsWith("mente") && clean.length > 6) {
    const bases = menteBaseForms(clean);
    if (bases.length > 0) return bases[bases.length - 1];
  }

  return clean;
}

