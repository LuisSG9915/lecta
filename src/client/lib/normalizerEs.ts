// src/client/lib/normalizerEs.ts
// Normalizador de texto en español para el motor neural Piper VITS (es_MX).
// El G2P de @piper-plus salta dígitos y símbolos: aquí se expanden a palabras
// pronunciables ANTES de fonemizar — números, decimales, años, ordinales,
// números romanos en contextos de capítulo, abreviaturas y símbolos.
//
// Incluye un mapa corto de excepciones para la «x» mexicana: el G2P la
// fonemiza /ks/ por defecto, pero en topónimos y gentilicios mexicanos
// históricos suena /x/ — se reescribe a «j» (que el G2P sí mapea a /x/).
//
// Pensado para EPUBs en español mexicano: miles con coma («1,250») y decimal
// con punto («1.50»); también se entienden «1.250,50» (EU) y «1 250 000».

const UNITS = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince",
];

const TEENS = ["dieciséis", "diecisiete", "dieciocho", "diecinueve"];

const TENS = [
  "", "", "veinte", "treinta", "cuarenta", "cincuenta",
  "sesenta", "setenta", "ochenta", "noventa",
];

// 21–29 se dicen «veintiuno»…«veintinueve» (eufonía), el resto «treinta y uno».
const TWENTIES = [
  "", "veintiuno", "veintidós", "veintitrés", "veinticuatro",
  "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
];

const HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

/** 0–99 en palabras («cincuenta», «noventa y nueve», «veintidós»). */
function underHundred(n: number): string {
  if (n <= 15) return UNITS[n];
  if (n <= 19) return TEENS[n - 16];
  if (n === 20) return "veinte";
  if (n <= 29) return TWENTIES[n - 20];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t] : `${TENS[t]} y ${UNITS[u]}`;
}

/** 0–999 en palabras («ciento uno», «novecientos noventa y nueve»). */
function underThousand(n: number): string {
  if (n === 0) return "";
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h === 1 && rem === 0) {
    parts.push("cien");
  } else {
    if (h > 0) parts.push(HUNDREDS[h]);
    if (rem > 0) parts.push(underHundred(rem));
  }
  return parts.join(" ");
}

/**
 * Convierte un entero a palabras en español.
 * 0→cero, 100→cien, 101→ciento uno, 1000→mil, 1_000_000→un millón.
 */
export function numberToSpanishWords(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  n = Math.floor(n);
  if (n === 0) return "cero";
  if (n < 0) return `menos ${numberToSpanishWords(-n)}`;

  const parts: string[] = [];
  let rest = n;

  // Escalas grandes primero (de mayor a menor).
  if (rest >= 1_000_000_000) {
    const count = Math.floor(rest / 1_000_000_000);
    parts.push(count === 1 ? "mil millones" : `${underThousand(count)} mil millones`);
    rest %= 1_000_000_000;
  }
  if (rest >= 1_000_000) {
    const count = Math.floor(rest / 1_000_000);
    parts.push(count === 1 ? "un millón" : `${underThousand(count)} millones`);
    rest %= 1_000_000;
  }
  if (rest >= 1_000) {
    const count = Math.floor(rest / 1_000);
    // «mil» es invariable: 2000 → «dos mil».
    parts.push(count === 1 ? "mil" : `${underThousand(count)} mil`);
    rest %= 1_000;
  }
  if (rest > 0) parts.push(underThousand(rest));
  return parts.join(" ");
}

const ORDINAL_UNITS = [
  "", "primero", "segundo", "tercero", "cuarto", "quinto",
  "sexto", "sétimo", "octavo", "noveno", "décimo",
];

const ORDINAL_TEENS = [
  "undécimo", "duodécimo", "decimotercero", "decimocuarto", "decimoquinto",
  "decimosexto", "decimoséptimo", "decimoctavo", "decimonoveno",
];

const ORDINAL_TENS = [
  "", "", "vigésimo", "trigésimo", "cuadragésimo", "quincuagésimo",
  "sexagésimo", "septuagésimo", "octogésimo", "nonagésimo",
];

const ORDINAL_HUNDREDS = [
  "", "centésimo", "ducentésimo", "tricentésimo", "cuadringentésimo",
  "quingentésimo", "sexcentésimo", "septingentésimo", "octingentésimo",
  "noningentésimo",
];

/** 1–999 en ordinal («vigésimo primero», «centésimo segundo»). */
function ordinalUnderThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h > 0) parts.push(ORDINAL_HUNDREDS[h]);
  if (rem > 0) {
    if (rem <= 10) {
      parts.push(ORDINAL_UNITS[rem]);
    } else if (rem <= 19) {
      parts.push(ORDINAL_TEENS[rem - 11]);
    } else {
      const t = Math.floor(rem / 10);
      const u = rem % 10;
      parts.push(u === 0 ? ORDINAL_TENS[t] : `${ORDINAL_TENS[t]} ${ORDINAL_UNITS[u]}`);
    }
  }
  return parts.join(" ");
}

/**
 * Ordinal en masculino; `feminine` cambia la -o final por -a
 * (primero→primera, vigésimo→vigésima, centésimo→centésima).
 * Para n ≥ 1000 devuelve el cardinal (los ordinales de miles son raros).
 */
export function ordinalToSpanishWords(n: number, feminine = false): string {
  if (!Number.isFinite(n) || n <= 0) return numberToSpanishWords(n);
  n = Math.floor(n);
  if (n >= 1000) return numberToSpanishWords(n);
  const words = ordinalUnderThousand(n);
  return feminine ? words.replace(/o\b/g, "a") : words;
}

const ROMAN_VALUES: Record<string, number> = {
  I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
};

/** «XIV»→14, «III»→3; null si no es un romano válido. */
export function romanToNumber(roman: string): number | null {
  const upper = roman.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(upper) || upper.length > 10) return null;
  let total = 0;
  let prev = 0;
  for (let i = upper.length - 1; i >= 0; i--) {
    const v = ROMAN_VALUES[upper[i]];
    if (!v) return null;
    if (v < prev) {
      // Solo resta válida: I ante V/X, X ante L/C, C ante D/M.
      if (v * 5 !== prev && v * 10 !== prev) return null;
      total -= v;
    } else {
      total += v;
    }
    prev = Math.max(prev, v);
  }
  return total > 0 ? total : null;
}

// Encabezados de obra donde un romano es casi siempre numeración, no sigla.
const ROMAN_CONTEXT =
  /\b(cap[ií]tulo|cap\.?|tomo|parte|libro|volumen|vol\.?|siglo|acto|escena|canto|episodio|temporada|entrega|secci[óo]n|p[áa]rrafo|art[íi]culo|ley|decreto|t[íi]tulo)\s+([IVXLCDM]{1,8})\b/gi;

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bSres\./g, "señores"],
  [/\bSras\./g, "señoras"],
  [/\bSr\./g, "señor"],
  [/\bSra\./g, "señora"],
  [/\bSrta\.?/g, "señorita"],
  [/\bDras\./g, "doctores"],
  [/\bDra\./g, "doctora"],
  [/\bDr\./g, "doctor"],
  [/\bLic\./g, "licenciado"],
  [/\bIng\./g, "ingeniero"],
  [/\bArq\./g, "arquitecto"],
  [/\bProf\./g, "profesor"],
  [/\bSto\.?/g, "Santo"],
  [/\bSta\.?/g, "Santa"],
  [/\bp[áa]gs\./gi, "páginas"],
  [/\bp[áa]g\./gi, "página"],
  [/\bcaps?\./gi, "capítulo"],
  [/\bn[úu]ms?\./gi, "número"],
  [/\bfigs?\./gi, "figura"],
  [/\bvols?\./gi, "volumen"],
  [/\beds?\./gi, "edición"],
  [/\baprox\./gi, "aproximadamente"],
  [/\bavda?\.?/gi, "Avenida"],
  [/\bav\.?/gi, "Avenida"],
  [/\betc\./gi, "etcétera"],
  [/\bvs\.?/gi, "versus"],
  [/\bnº\.?/gi, "número"],
  [/\bn\.º/gi, "número"],
  [/\bNo\./g, "número"],
];

// Palabras con «x» que en español mexicano suenan /x/ (como «j»), no /ks/.
// El G2P las emitiría /ks/; se reescriben a «j» antes de fonemizar.
// La j suena /x/ en todos estos casos (realización estándar en México).
const MEXICAN_X_EXCEPTIONS: Array<[RegExp, string | ((w: string) => string)]> = [
  // Familia México/mexicano/a/os/as — la x va entre vocales → /ks/ por defecto.
  [/\bm[eé]xic\w*\b/gi, (w) => w.replace(/[xX]/, "j")],
  [/\b[oó]axac\w*\b/gi, (w) => w.replace(/[xX]/, "j")],
  [/\bXalapa\b/g, "Jalapa"],
  [/\bMexicali\b/g, "Mejicali"],
  [/\bTexas\b/g, "Tejas"],
  [/\bTlaxcala\b/g, "Tlajcala"],
  [/\bXochimilco\b/g, "Jochimilco"],
  [/\bIxtapaluca\b/g, "Ijtapaluca"],
  [/\bUxmal\b/g, "Ujmal"],
];

/**
 * Reescribe las excepciones de «x» mexicana a «j» para que el G2P las
 * fonemice /x/ en lugar de /ks/. Solo afecta al texto que va al fonemizador.
 */
export function applyMexicanXExceptions(text: string): string {
  if (!text) return "";
  let t = text;
  for (const [re, rep] of MEXICAN_X_EXCEPTIONS) {
    t = t.replace(re, (m) => (typeof rep === "string" ? rep : rep(m)));
  }
  return t;
}

// Separadores de miles con espacio: normal, no-break (\u00A0) y thin (\u202F).
const SPACE_THOUSANDS = /[\u0020\u00A0\u202F]/;

// Símbolos → palabras. $ se lee «pesos» en contexto es_MX.
function expandSymbols(text: string): string {
  let t = text;
  t = t.replace(/\$\s*(\d+(?:[.,]\d+)?)/g, "$1 pesos"); // $500 → 500 pesos
  t = t.replace(/\$\s*/g, " pesos ");
  t = t.replace(/€/g, " euros ");
  t = t.replace(/£/g, " libras ");
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*%/g, "$1 por ciento");
  t = t.replace(/%\s*/g, " por ciento ");
  t = t.replace(/°\s*C\b/gi, " grados centígrados ");
  t = t.replace(/°\s*F\b/gi, " grados Fahrenheit ");
  t = t.replace(/°/g, " grados ");
  return t;
}

// «1,250.50» (US/MX) → miles con coma; «1.250,50» (EU) → miles con punto
// SOLO cuando además hay coma decimal (si no, el punto es decimal en es_MX);
// «1 250 000» → miles con espacio. Devuelve [entero, fracción|null].
function parseGroupedNumber(raw: string): { int: string; frac: string | null } | null {
  if (/\s/.test(raw)) {
    const digits = raw.replace(/\s/g, "");
    return /^\d+$/.test(digits) ? { int: digits, frac: null } : null;
  }
  const us = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/.exec(raw);
  if (us) return { int: us[1].replace(/,/g, ""), frac: us[2] ?? null };
  const eu = /^(\d{1,3}(?:\.\d{3})+),(\d+)$/.exec(raw);
  if (eu) return { int: eu[1].replace(/\./g, ""), frac: eu[2] };
  return null;
}

function decimalToWords(intPart: string, fracPart: string | null): string {
  const intWords = numberToSpanishWords(parseInt(intPart, 10));
  if (!fracPart) return intWords;

  // Fracción de ≤2 dígitos se lee como número («punto cincuenta», «punto
  // catorce»); «05» conserva el cero («punto cero cinco») para no leerse .5.
  // De >2 dígitos se deletrea («punto uno cuatro uno» para π).
  if (fracPart.length <= 2) {
    if (/^0\d$/.test(fracPart)) {
      return `${intWords} punto cero ${UNITS[parseInt(fracPart[1], 10)]}`;
    }
    const fracWords = numberToSpanishWords(parseInt(fracPart, 10));
    return fracWords === "cero" ? `${intWords} punto` : `${intWords} punto ${fracWords}`;
  }
  const digits = fracPart
    .split("")
    .map((d) => (d === "0" ? "cero" : UNITS[parseInt(d, 10)]))
    .join(" ");
  return `${intWords} punto ${digits}`;
}

function expandNumbers(text: string): string {
  let t = text;

  // 1. Rangos numéricos «46-47» → «46 a 47» (antes de expandir enteros).
  t = t.replace(/\b(\d+)\s*[-–]\s*(\d+)\b/g, "$1 a $2");

  // 2. Números con miles: «1,250.50» (US/MX), «1.250,50» (EU), «1 250 000».
  t = t.replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, (m) => {
    const grouped = parseGroupedNumber(m);
    return grouped ? decimalToWords(grouped.int, grouped.frac) : m;
  });
  t = t.replace(/\b\d{1,3}(?:\.\d{3})+,\d+\b/g, (m) => {
    const grouped = parseGroupedNumber(m);
    return grouped ? decimalToWords(grouped.int, grouped.frac) : m;
  });
  t = t.replace(new RegExp(`\\b\\d{1,3}(?:${SPACE_THOUSANDS.source}\\d{3})+\\b`, "g"), (m) => {
    const digits = m.replace(/\s/g, "");
    return /^\d+$/.test(digits) ? numberToSpanishWords(parseInt(digits, 10)) : m;
  });

  // 3. Decimales simples: «3.14», «2,5» → «punto» (es_MX: punto decimal).
  t = t.replace(/\b(\d+)\.(\d+)\b/g, (_, i, f) => decimalToWords(i, f));
  t = t.replace(/\b(\d+),(\d+)\b/g, (_, i, f) => decimalToWords(i, f));

  // 4. Enteros aislados → cardinal.
  t = t.replace(/\b\d+\b/g, (m) => numberToSpanishWords(parseInt(m, 10)));

  return t;
}

function expandOrdinals(text: string): string {
  // «1º», «1.º», «1°» masculino; «1ª», «1.ª» femenino — antes de expandir
  // enteros porque llevan el indicador pegado (el punto es opcional).
  // «º»/«ª» no son word-chars en JS: sin \b final o nunca casarían.
  let t = text.replace(/\b(\d{1,3})\.?\s*ª/g, (_, n) =>
    ordinalToSpanishWords(parseInt(n, 10), true),
  );
  t = t.replace(/\b(\d{1,3})\.?\s*º/g, (_, n) =>
    ordinalToSpanishWords(parseInt(n, 10), false),
  );
  t = t.replace(/\b(\d{1,3})°\b/g, (_, n) =>
    ordinalToSpanishWords(parseInt(n, 10), false),
  );
  return t;
}

function expandRomans(text: string): string {
  return text.replace(ROMAN_CONTEXT, (match, heading: string, roman: string) => {
    const n = romanToNumber(roman);
    if (n === null || n > 100) return match;
    return `${heading} ${numberToSpanishWords(n)}`;
  });
}

function cleanTypography(text: string): string {
  let t = text.normalize("NFC");
  // Comillas latinas, inglesas y angulares: el contenido se conserva.
  t = t.replace(/[«»“”‘’„‟″‶"]/g, "");
  // Rayas de diálogo/inciso → pausa respiratoria.
  t = t.replace(/[—–]/g, ", ");
  // Elipsis: pausa; si ya viene seguida de cierre, el cierre manda.
  t = t.replace(/…+\s*([.!?;:])?/g, (_m, close) => (close ? close : ", "));
  return t;
}

/**
 * Normalización completa de una oración/sección en español antes del G2P.
 * Devuelve texto plano con la «x» mexicana corregida, números, romanos,
 * abreviaturas y símbolos ya expandidos a palabras pronunciables.
 */
export function normalizeSpanishText(text: string): string {
  if (!text) return "";
  let t = cleanTypography(text);

  // Excepción fonética «x»→«j» (/x/ en vez de /ks/) antes de todo lo demás.
  t = applyMexicanXExceptions(t);

  // Símbolos primero: «$500» y «50%» deben leerse con su unidad.
  t = expandSymbols(t);

  // Ordinales con indicador («3.º» → «tercero») antes de enteros.
  t = expandOrdinals(t);

  // Romanos en contexto de obra («Capítulo XIV» → «capítulo catorce»).
  t = expandRomans(t);

  // Abreviaturas: el punto se absorbe en la sustitución.
  for (const [re, rep] of ABBREVIATIONS) {
    t = t.replace(re, rep);
  }

  // Números al final: con agrupadores, decimales y enteros.
  t = expandNumbers(t);

  // Espacios y comas huérfanas por rayas de diálogo al inicio.
  t = t.replace(/^[,\s]+/, "").replace(/\s+/g, " ").trim();
  return t;
}
