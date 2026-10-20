// src/client/lib/kittenNormalize.ts
// Normalizador de texto en inglés para KittenTTS alineado con kittenml/preprocess.py.
// Convierte números, monedas, porcentajes, horas, rangos, ordinales, abreviaturas
// y expresiones literarias a texto en palabras pronunciable en fonética natural.

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];

const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

const SCALES = ["", "thousand", "million", "billion", "trillion"];

const ORDINAL_EXCEPTIONS: Record<string, string> = {
  one: "first",
  two: "second",
  three: "third",
  four: "fourth",
  five: "fifth",
  six: "sixth",
  seven: "seventh",
  eight: "eighth",
  nine: "ninth",
  twelve: "twelfth",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "dollar",
  "€": "euro",
  "£": "pound",
  "¥": "yen",
  "₹": "rupee",
  "₩": "won",
  "₿": "bitcoin",
};

const ROMAN_MAP: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
  XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20,
  XXI: 21, XXII: 22, XXIII: 23, XXIV: 24, XXV: 25, XXX: 30, XL: 40, L: 50,
  LX: 60, LXX: 70, LXXX: 80, XC: 90, C: 100, D: 500, M: 1000,
};

function threeDigitsToWords(n: number): string {
  if (n === 0) return "";
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  if (hundreds) {
    parts.push(`${ONES[hundreds]} hundred`);
  }
  if (remainder < 20) {
    if (remainder) parts.push(ONES[remainder]);
  } else {
    const tens = Math.floor(remainder / 10);
    const ones = remainder % 10;
    parts.push(ones ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens]);
  }
  return parts.join(" ");
}

/**
 * Convierte un número entero a su representación en palabras en inglés.
 * Sigue la regla de X hundred (1200 -> "twelve hundred").
 */
export function numberToEnglishWords(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  n = Math.floor(n);
  if (n === 0) return "zero";
  if (n < 0) return `negative ${numberToEnglishWords(-n)}`;

  // 1100–9900 múltiplos de 100 leídos como "X hundred"
  if (n >= 100 && n <= 9999 && n % 100 === 0 && n % 1000 !== 0) {
    const hundreds = Math.floor(n / 100);
    if (hundreds < 20) return `${ONES[hundreds]} hundred`;
  }

  const parts: string[] = [];
  let temp = n;
  for (let i = 0; i < SCALES.length && temp > 0; i++) {
    const chunk = temp % 1000;
    if (chunk) {
      const chunkWords = threeDigitsToWords(chunk);
      parts.unshift(SCALES[i] ? `${chunkWords} ${SCALES[i]}` : chunkWords);
    }
    temp = Math.floor(temp / 1000);
  }
  return parts.join(" ");
}

/**
 * Convierte números decimales a palabras (ej: 3.14 -> "three point one four").
 */
export function floatToWords(value: number | string, decimalSep = "point"): string {
  const text = String(value);
  const isNegative = text.startsWith("-");
  const clean = isNegative ? text.slice(1) : text;

  if (clean.includes(".")) {
    const [intPart, decPart] = clean.split(".", 2);
    const intWords = intPart ? numberToEnglishWords(parseInt(intPart, 10)) : "zero";
    const decWords = Array.from(decPart)
      .map((d) => (d === "0" ? "zero" : ONES[parseInt(d, 10)] || d))
      .join(" ");
    const res = `${intWords} ${decimalSep} ${decWords}`;
    return isNegative ? `negative ${res}` : res;
  }

  const num = parseInt(clean, 10);
  const res = isNaN(num) ? clean : numberToEnglishWords(num);
  return isNegative ? `negative ${res}` : res;
}

/**
 * Convierte un ordinal a palabras (ej: 1st -> "first", 21st -> "twenty-first").
 */
export function ordinalToWords(n: number): string {
  const word = numberToEnglishWords(n);
  if (word.includes("-")) {
    const lastDash = word.lastIndexOf("-");
    const prefix = word.slice(0, lastDash);
    const last = word.slice(lastDash + 1);
    const lastOrd = ORDINAL_EXCEPTIONS[last] || (last.endsWith("t") ? `${last}h` : last.endsWith("e") ? `${last.slice(0, -1)}th` : `${last}th`);
    return `${prefix}-${lastOrd}`;
  }

  const parts = word.split(" ");
  if (parts.length > 1) {
    const last = parts.pop()!;
    const lastOrd = ORDINAL_EXCEPTIONS[last] || (last.endsWith("t") ? `${last}h` : last.endsWith("e") ? `${last.slice(0, -1)}th` : `${last}th`);
    return `${parts.join(" ")} ${lastOrd}`;
  }

  return (
    ORDINAL_EXCEPTIONS[word] ||
    (word.endsWith("t") ? `${word}h` : word.endsWith("e") ? `${word.slice(0, -1)}th` : `${word}th`)
  );
}

/**
 * Convierte números romanos a palabras (ej: "Chapter IV" -> "Chapter four").
 */
export function romanToWords(val: string): string {
  const upper = val.toUpperCase();
  if (ROMAN_MAP[upper]) return numberToEnglishWords(ROMAN_MAP[upper]);
  const num = parseInt(val, 10);
  if (!isNaN(num)) return numberToEnglishWords(num);
  return val;
}

/**
 * Expande monedas ($10 -> "ten dollars", €5 -> "five euros", etc.)
 */
function expandCurrency(text: string): string {
  return text.replace(/([$€£¥₹₩₿])\s*([\d,]+(?:\.\d+)?)\s*([KMBT])?(?![a-zA-Z\d])/g, (_, sym, numStr, scale) => {
    const name = CURRENCY_SYMBOLS[sym] || "dollars";
    const rawNum = parseFloat(numStr.replace(/,/g, ""));
    if (isNaN(rawNum)) return `${numStr} ${name}`;

    let multiplier = 1;
    let scaleWord = "";
    if (scale === "K") { multiplier = 1000; scaleWord = " thousand"; }
    else if (scale === "M") { multiplier = 1000000; scaleWord = " million"; }
    else if (scale === "B") { multiplier = 1000000000; scaleWord = " billion"; }
    else if (scale === "T") { multiplier = 1000000000000; scaleWord = " trillion"; }

    let amountWords: string;
    if (scaleWord) {
      amountWords = `${floatToWords(rawNum)}${scaleWord}`;
    } else if (numStr.includes(".")) {
      amountWords = floatToWords(rawNum);
    } else {
      amountWords = numberToEnglishWords(rawNum * multiplier);
    }

    const plural = (rawNum * multiplier === 1 && !scaleWord) ? name : `${name}s`;
    return `${amountWords} ${plural}`;
  });
}

/**
 * Expande porcentajes (ej: 50% -> "fifty percent")
 */
function expandPercentages(text: string): string {
  return text.replace(/(-?\d+(?:\.\d+)?)\s*%/g, (_, val) => {
    return `${floatToWords(val)} percent`;
  });
}

/**
 * Expande décadas (ej: 1990s -> "nineteen nineties", '90s -> "nineties")
 */
function expandDecades(text: string): string {
  const DECADE_WORDS: Record<string, string> = {
    "10": "tens", "20": "twenties", "30": "thirties", "40": "forties",
    "50": "fifties", "60": "sixties", "70": "seventies", "80": "eighties", "90": "nineties",
  };

  let t = text.replace(/\b(19|20)([2-9]0)s\b/g, (_, century, dec) => {
    const cWord = century === "19" ? "nineteen" : "twenty";
    const dWord = DECADE_WORDS[dec] || dec;
    return `${cWord} ${dWord}`;
  });

  t = t.replace(/(?:'|\b)([2-9]0)s\b/g, (_, dec) => {
    return DECADE_WORDS[dec] || `${dec}s`;
  });

  return t;
}

/**
 * Expande rangos numéricos (ej: "10-20" -> "10 to 20")
 */
function expandRanges(text: string): string {
  return text.replace(/\b(\d+)\s*[-–]\s*(\d+)\b/g, "$1 to $2");
}

/**
 * Normalización completa de texto en inglés para KittenTTS.
 */
export function normalizeEnglishText(text: string): string {
  if (!text) return "";
  let t = text;

  // 1. Diálogos literarios: rayas largas y semirrayas a pausa breve
  t = t.replace(/[—–]/g, ", ");

  // 2. Monedas, porcentajes, décadas y rangos (procesados antes de remover puntuación)
  t = expandCurrency(t);
  t = expandPercentages(t);
  t = expandDecades(t);
  t = expandRanges(t);

  // 3. Comillas tipográficas, latinas e inglesas (preservando apóstrofes internos de contracciones)
  t = t.replace(/[“”"«»‘]/g, "");
  t = t.replace(/(^|[\s;:,.!?¡¿—…"«»“”])['’]+|['’]+([\s;:,.!?¡¿—…"«»“”]|$)/g, "$1$2");
  t = t.replace(/’/g, "'");

  // 4. Signos de apertura en español
  t = t.replace(/[¿¡]/g, "");

  // 5. Normalizar acentos a su base ASCII
  t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 6. Abreviaturas literarias y comunes
  t = t.replace(/\bMr\./gi, "Mister");
  t = t.replace(/\bMr\b/gi, "Mister");
  t = t.replace(/\bMrs\./gi, "Missus");
  t = t.replace(/\bMrs\b/gi, "Missus");
  t = t.replace(/\bMs\./gi, "Miss");
  t = t.replace(/\bMs\b/gi, "Miss");
  t = t.replace(/\bDr\./gi, "Doctor");
  t = t.replace(/\bDr\b/gi, "Doctor");
  t = t.replace(/\bSt\.\s+/gi, "Saint ");
  t = t.replace(/\bProf\./gi, "Professor");
  t = t.replace(/\bCapt\./gi, "Captain");
  t = t.replace(/\bGen\./gi, "General");
  t = t.replace(/\bCol\./gi, "Colonel");
  t = t.replace(/\bLt\./gi, "Lieutenant");
  t = t.replace(/\bRev\./gi, "Reverend");
  t = t.replace(/\be\.g\.,?\s*/gi, "for example, ");
  t = t.replace(/\bi\.e\.,?\s*/gi, "that is, ");
  t = t.replace(/\betc\./gi, "etcetera");
  t = t.replace(/\bvs\./gi, "versus");

  // 7. Capítulos y partes con números romanos o arábigos
  t = t.replace(/\b(Chapter|Part|Section|Volume|Book|Act|Scene)\s+([0-9IVXLCDM]+)\b/gi, (_, heading, val) => {
    return `${heading} ${romanToWords(val)}`;
  });

  // 8. Títulos reales ("Henry VIII", "Louis XIV")
  t = t.replace(/\b(King|Queen|Emperor|Pope|Prince)?\s*([A-Z][a-z]+)\s+([IVXLCDM]+)\b/g, (match, title, name, roman) => {
    const num = ROMAN_MAP[roman.toUpperCase()];
    if (!num) return match;
    const ord = ordinalToWords(num);
    return title ? `${title} ${name} the ${ord}` : `${name} the ${ord}`;
  });

  // 9. Ordinales (1st -> first, 2nd -> second, 3rd -> third, 42nd -> forty-second)
  t = t.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, (_, digits) => {
    const num = parseInt(digits, 10);
    return isNaN(num) ? _ : ordinalToWords(num);
  });

  // 10. Números decimales aislados (ej: 3.14 -> "three point one four")
  t = t.replace(/\b(\d+)\.(\d+)\b/g, (_, integer, decimal) => {
    return floatToWords(`${integer}.${decimal}`);
  });

  // 11. Números enteros aislados a palabras
  t = t.replace(/\b\d+\b/g, (match) => {
    const num = parseInt(match, 10);
    return isNaN(num) ? match : numberToEnglishWords(num);
  });

  // 12. Limpiar espacios múltiples y comas iniciales huérfanas por guiones de diálogo
  return t.replace(/^[,\s]+/, "").replace(/\s+/g, " ").trim();
}
