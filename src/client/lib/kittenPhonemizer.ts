// src/client/lib/kittenPhonemizer.ts
// Fonemizador IPA y Tokenizador para KittenTTS en Lecta.
// Alineado estrictamente con:
// - kittenml/kittentts_legacy/onnx_model.py (178 símbolos, padding 0 al inicio y fin)
// - kittenml/preprocess.py (normalización previa de texto)

import { normalizeEnglishText } from "./kittenNormalize";

// 1. Vocabulario oficial de 178 símbolos de KittenTTS (KittenML / StyleTTS2)
export const KITTEN_PAD = "$";
export const KITTEN_PUNCTUATION = ';:,.!?¡¿—…"«»“” ';
export const KITTEN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const KITTEN_LETTERS_IPA =
  "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";

export const KITTEN_SYMBOLS: readonly string[] = [
  KITTEN_PAD,
  ...Array.from(KITTEN_PUNCTUATION),
  ...Array.from(KITTEN_LETTERS),
  ...Array.from(KITTEN_LETTERS_IPA),
];

// Mapa de correspondencia símbolo -> ID numérico [0..177]
export const KITTEN_VOCAB_MAP = new Map<string, number>();
for (let i = 0; i < KITTEN_SYMBOLS.length; i++) {
  KITTEN_VOCAB_MAP.set(KITTEN_SYMBOLS[i], i);
}

// 2. Diccionario fonético determinista IPA de las palabras más comunes e irregulares en inglés
export const COMMON_IPA_DICT: Record<string, string> = {
  // Saludos e interjecciones comunes
  hello: "hɛloʊ",
  hi: "haɪ",
  hey: "heɪ",

  // Artículos, pronombres y determinantes
  the: "ðə",
  a: "ə",
  an: "æn",
  this: "ðɪs",
  that: "ðæt",
  these: "ðiːz",
  those: "ðoʊz",
  i: "aɪ",
  you: "juː",
  he: "hiː",
  she: "ʃiː",
  it: "ɪt",
  we: "wiː",
  they: "ðeɪ",
  me: "miː",
  him: "hɪm",
  her: "hɜː",
  us: "ʌs",
  them: "ðɛm",
  my: "maɪ",
  your: "jɔː",
  his: "hɪz",
  its: "ɪts",
  our: "aʊə",
  their: "ðɛə",
  who: "huː",
  whom: "huːm",
  whose: "huːz",
  what: "wɒt",
  which: "wɪʧ",
  where: "wɛə",
  when: "wɛn",
  why: "waɪ",
  how: "haʊ",
  some: "sʌm",
  any: "ɛni",
  every: "ɛvɹi",
  all: "ɔːl",
  each: "iːʧ",
  both: "boʊθ",
  few: "fjuː",
  many: "mɛni",
  much: "mʌʧ",
  more: "mɔː",
  most: "moʊst",
  other: "ʌðə",
  others: "ʌðəz",
  another: "ənʌðə",
  such: "sʌʧ",
  same: "seɪm",

  // Verbos auxiliares y copulativos
  is: "ɪz",
  am: "æm",
  are: "ɑː",
  was: "wɒz",
  were: "wɜː",
  be: "biː",
  been: "biːn",
  being: "biːɪŋ",
  have: "hæv",
  has: "hæz",
  had: "hæd",
  do: "duː",
  does: "dʌz",
  did: "dɪd",
  can: "kæn",
  could: "kʊd",
  will: "wɪl",
  would: "wʊd",
  shall: "ʃæl",
  should: "ʃʊd",
  may: "meɪ",
  might: "maɪt",
  must: "mʌst",

  // Contracciones frecuentes
  dont: "doʊnt",
  wont: "woʊnt",
  cant: "kænt",
  didnt: "dɪdənt",
  isnt: "ɪzənt",
  arent: "ɑːnt",
  wasnt: "wɒzənt",
  werent: "wɜːnt",
  hasnt: "hæzənt",
  havent: "hævənt",
  hadnt: "hædənt",
  wouldnt: "wʊdənt",
  couldnt: "kʊdənt",
  shouldnt: "ʃʊdənt",
  im: "aɪm",
  youre: "jɔː",
  hes: "hiːz",
  shes: "ʃiːz",
  its_contr: "ɪts",
  were_contr: "wɪə",
  theyre: "ðɛə",
  ive: "aɪv",
  youve: "juːv",
  weve: "wiːv",
  theyve: "ðeɪv",
  id: "aɪd",
  youd: "juːd",
  hed: "hiːd",
  shed: "ʃiːd",
  wed: "wiːd",
  theyd: "ðeɪd",
  ill: "aɪl",
  youll: "juːl",
  hell: "hiːl",
  shell: "ʃiːl",
  well_contr: "wiːl",
  theyll: "ðeɪl",

  // Verbos comunes e irregulares
  say: "seɪ",
  says: "sɛz",
  said: "sɛd",
  go: "ɡoʊ",
  goes: "ɡoʊz",
  went: "wɛnt",
  gone: "ɡɒn",
  going: "ɡoʊɪŋ",
  get: "ɡɛt",
  gets: "ɡɛts",
  got: "ɡɒt",
  gotten: "ɡɒtən",
  make: "meɪk",
  makes: "meɪks",
  made: "meɪd",
  know: "noʊ",
  knows: "noʊz",
  knew: "njuː",
  known: "noʊn",
  think: "θɪŋk",
  thinks: "θɪŋks",
  thought: "θɔːt",
  take: "teɪk",
  takes: "teɪks",
  took: "tʊk",
  taken: "teɪkən",
  see: "siː",
  sees: "siːz",
  saw: "sɔː",
  seen: "siːn",
  come: "kʌm",
  comes: "kʌmz",
  came: "keɪm",
  want: "wɒnt",
  wants: "wɒnts",
  wanted: "wɒntɪd",
  look: "lʊk",
  looks: "lʊks",
  looked: "lʊkt",
  use: "juːz",
  uses: "juːzɪz",
  used: "juːzd",
  find: "faɪnd",
  finds: "faɪndz",
  found: "faʊnd",
  give: "ɡɪv",
  gives: "ɡɪvz",
  gave: "ɡeɪv",
  given: "ɡɪvən",
  tell: "tɛl",
  tells: "tɛlz",
  told: "toʊld",
  work: "wɜːk",
  call: "kɔːl",
  called: "kɔːld",
  try: "tɹaɪ",
  ask: "ɑːsk",
  asked: "ɑːskt",
  need: "niːd",
  needed: "niːdɪd",
  feel: "fiːl",
  felt: "fɛlt",
  become: "bɪkʌm",
  became: "bɪkeɪm",
  leave: "liːv",
  left: "lɛft",
  put: "pʊt",
  mean: "miːn",
  meant: "mɛnt",
  keep: "kiːp",
  kept: "kɛpt",
  let: "lɛt",
  begin: "bɪɡɪn",
  began: "bɪɡæn",
  begun: "bɪɡʌn",
  seem: "siːm",
  seemed: "siːmd",
  help: "hɛlp",
  talk: "tɔːk",
  turn: "tɜːn",
  turned: "tɜːnd",
  start: "stɑːt",
  show: "ʃoʊ",
  showed: "ʃoʊd",
  shown: "ʃoʊn",
  hear: "hɪə",
  heard: "hɜːd",
  play: "pleɪ",
  run: "ɹʌn",
  ran: "ɹæn",
  move: "muːv",
  like: "laɪk",
  live: "lɪv",
  lived: "lɪvd",
  believe: "bɪliːv",
  hold: "hoʊld",
  held: "hɛld",
  bring: "bɹɪŋ",
  brought: "bɹɔːt",
  happen: "hæpən",
  happened: "hæpənd",
  write: "ɹaɪt",
  wrote: "ɹoʊt",
  written: "ɹɪtən",
  sit: "sɪt",
  sat: "sæt",
  stand: "stænd",
  stood: "stʊd",
  lose: "luːz",
  lost: "lɒst",
  pay: "peɪ",
  paid: "peɪd",
  meet: "miːt",
  met: "mɛt",
  learn: "lɜːn",
  change: "ʧeɪnʤ",
  lead: "liːd",
  led: "lɛd",
  understand: "ʌndəstænd",
  understood: "ʌndəstʊd",
  watch: "wɒʧ",
  follow: "fɒloʊ",
  stop: "stɒp",
  stopped: "stɒpt",
  speak: "spiːk",
  spoke: "spoʊk",
  spoken: "spoʊkən",
  read: "ɹiːd",
  allow: "əlaʊ",
  add: "æd",
  spend: "spɛnd",
  spent: "spɛnt",
  grow: "ɡɹoʊ",
  grew: "ɡɹuː",
  grown: "ɡɹoʊn",
  open: "oʊpən",
  walk: "wɔːk",
  walked: "wɔːkt",
  win: "wɪn",
  won: "wʌn",
  remember: "ɹɪmɛmbə",
  love: "lʌv",
  loved: "lʌvd",
  appear: "əpɪə",
  appeared: "əpɪəd",
  buy: "baɪ",
  bought: "bɔːt",
  wait: "weɪt",
  waited: "weɪtɪd",
  die: "daɪ",
  died: "daɪd",
  send: "sɛnd",
  sent: "sɛnt",
  build: "bɪld",
  built: "bɪlt",
  stay: "steɪ",
  fall: "fɔːl",
  fell: "fɛl",
  fallen: "fɔːlən",
  cut: "kʌt",
  reach: "ɹiːʧ",
  reached: "ɹiːʧt",
  kill: "kɪl",
  remain: "ɹɪmeɪn",

  // Preposiciones y conjunciones
  of: "ʌv",
  to: "tuː",
  in: "ɪn",
  for: "fɔː",
  on: "ɒn",
  with: "wɪð",
  at: "æt",
  by: "baɪ",
  from: "fɹʌm",
  up: "ʌp",
  about: "əbaʊt",
  into: "ɪntuː",
  over: "oʊvə",
  after: "ɑːftə",
  beneath: "bɪniːθ",
  under: "ʌndə",
  above: "əbʌv",
  between: "bɪtwiːn",
  through: "θɹuː",
  during: "djʊəɹɪŋ",
  without: "wɪðaʊt",
  before: "bɪfɔː",
  around: "əɹaʊnd",
  among: "əmʌŋ",
  and: "ænd",
  but: "bʌt",
  or: "ɔː",
  as: "æz",
  if: "ɪf",
  than: "ðæn",
  because: "bɪkɒz",
  while: "waɪl",
  so: "soʊ",
  though: "ðoʊ",
  although: "ɔːlðoʊ",

  // Adverbios
  not: "nɒt",
  no: "noʊ",
  yes: "jɛs",
  now: "naʊ",
  then: "ðɛn",
  there: "ðɛə",
  here: "hɪə",
  just: "ʤʌst",
  also: "ɔːlsoʊ",
  well: "wɛl",
  only: "oʊnli",
  very: "vɛɹi",
  even: "iːvən",
  back: "bæk",
  down: "daʊn",
  still: "stɪl",
  too: "tuː",
  never: "nɛvə",
  always: "ɔːlweɪz",
  again: "əɡɛn",
  away: "əweɪ",
  often: "ɒfən",
  together: "təɡɛðə",
  once: "wʌns",
  almost: "ɔːlmoʊst",
  enough: "ɪnʌf",
  perhaps: "pəhæps",
  probably: "pɹɒbəbli",
  already: "ɔːlɹɛdi",
  soon: "suːn",
  ever: "ɛvə",

  // Números
  zero: "zɪəɹoʊ",
  one: "wʌn",
  two: "tuː",
  three: "θɹiː",
  four: "fɔː",
  five: "faɪv",
  six: "sɪks",
  seven: "sɛvən",
  eight: "eɪt",
  nine: "naɪn",
  ten: "tɛn",
  eleven: "ɪlɛvən",
  twelve: "twɛlv",
  thirteen: "θɜːtiːn",
  fourteen: "fɔːtiːn",
  fifteen: "fɪftiːn",
  sixteen: "sɪkstiːn",
  seventeen: "sɛvəntiːn",
  eighteen: "eɪtiːn",
  nineteen: "naɪntiːn",
  twenty: "twɛnti",
  thirty: "θɜːti",
  forty: "fɔːti",
  fifty: "fɪfti",
  sixty: "sɪksti",
  seventy: "sɛvənti",
  eighty: "eɪti",
  ninety: "naɪnti",
  hundred: "hʌndɹəd",
  thousand: "θaʊzənd",
  million: "mɪljən",
  first: "fɜːst",
  second: "sɛkənd",
  third: "θɜːd",
  fourth: "fɔːθ",
  fifth: "fɪfθ",

  // Sustantivos y términos literarios
  time: "taɪm",
  year: "jɪə",
  years: "jɪəz",
  people: "piːpəl",
  way: "weɪ",
  day: "deɪ",
  days: "deɪz",
  man: "mæn",
  men: "mɛn",
  woman: "wʊmən",
  women: "wɪmɪn",
  child: "ʧaɪld",
  children: "ʧɪldɹən",
  thing: "θɪŋ",
  things: "θɪŋz",
  life: "laɪf",
  world: "wɜːld",
  hand: "hænd",
  hands: "hændz",
  part: "pɑːt",
  place: "pleɪs",
  case: "keɪs",
  week: "wiːk",
  night: "naɪt",
  point: "pɔɪnt",
  home: "hoʊm",
  water: "wɔːtə",
  room: "ɹuːm",
  mother: "mʌðə",
  father: "fɑːðə",
  sister: "sɪstə",
  brother: "bɹʌðə",
  story: "stɔːɹi",
  right: "ɹaɪt",
  book: "bʊk",
  books: "bʊks",
  eye: "aɪ",
  eyes: "aɪz",
  word: "wɜːd",
  words: "wɜːdz",
  head: "hɛd",
  house: "haʊs",
  friend: "fɹɛnd",
  hour: "aʊə",
  line: "laɪn",
  end: "ɛnd",
  door: "dɔː",
  girl: "ɡɜːl",
  boy: "bɔɪ",
  name: "neɪm",
  named: "neɪmd",
  lily: "lɪli",
  needle: "niːdəl",
  chapter: "ʧæptə",
  mister: "mɪstə",
  missus: "mɪsɪz",
  miss: "mɪs",
  doctor: "dɒktə",
  saint: "seɪnt",
  paul: "pɔːl",
  church: "ʧɜːʧ",
  steps: "stɛps",
  heart: "hɑːt",
  voice: "vɔɪs",
  silence: "saɪləns",
  shadow: "ʃædoʊ",
  death: "dɛθ",
  dream: "dɹiːm",
  truth: "tɹuːθ",
  light: "laɪt",
  dark: "dɑːk",
  little: "lɪtəl",
  great: "ɡɹeɪt",
  small: "smɔːl",
  large: "lɑːʤ",
  young: "jʌŋ",
  old: "oʊld",
  good: "ɡʊd",
  bad: "bæd",
  new: "njuː",
  high: "haɪ",
  long: "lɒŋ",
};

/**
 * Conversión determinista de ortografía inglesa a IPA para palabras no presentes en el diccionario.
 * Sigue las reglas de correspondencia grafema-fonema (G2P) estándar del inglés estadounidense.
 */
export function convertEnglishWordToIpa(raw: string): string {
  // Si la palabra ya contiene caracteres fonéticos IPA, preservarla
  if (/[ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒˈˌː]/.test(raw)) {
    return raw;
  }

  // Normalizar contracciones sin apóstrofe para búsqueda en diccionario
  const clean = raw.toLowerCase().replace(/['']/g, "");
  if (COMMON_IPA_DICT[clean]) {
    return COMMON_IPA_DICT[clean];
  }

  const w = clean;
  let ipa = "";
  let i = 0;
  const n = w.length;

  while (i < n) {
    const rem = w.slice(i);

    // Patrones de 4 letras
    if (rem.startsWith("tion")) { ipa += "ʃən"; i += 4; continue; }
    if (rem.startsWith("sion")) { ipa += "ʃən"; i += 4; continue; }
    if (rem.startsWith("eigh")) { ipa += "eɪ"; i += 4; continue; }
    if (rem.startsWith("ight")) { ipa += "aɪt"; i += 4; continue; }
    if (rem.startsWith("ough")) { ipa += "ɔː"; i += 4; continue; }

    // Patrones de 3 letras
    if (rem.startsWith("tch")) { ipa += "ʧ"; i += 3; continue; }
    if (rem.startsWith("dge")) { ipa += "ʤ"; i += 3; continue; }
    if (rem.startsWith("igh")) { ipa += "aɪ"; i += 3; continue; }
    if (rem.startsWith("ing")) { ipa += "ɪŋ"; i += 3; continue; }
    if (rem.startsWith("all")) { ipa += "ɔːl"; i += 3; continue; }

    // Patrones de 2 letras
    if (rem.startsWith("th")) { ipa += "θ"; i += 2; continue; }
    if (rem.startsWith("sh")) { ipa += "ʃ"; i += 2; continue; }
    if (rem.startsWith("ch")) { ipa += "ʧ"; i += 2; continue; }
    if (rem.startsWith("ph")) { ipa += "f"; i += 2; continue; }
    if (rem.startsWith("wh")) { ipa += "w"; i += 2; continue; }
    if (rem.startsWith("qu")) { ipa += "kw"; i += 2; continue; }
    if (rem.startsWith("ck")) { ipa += "k"; i += 2; continue; }
    if (rem.startsWith("ng")) { ipa += "ŋ"; i += 2; continue; }
    if (rem.startsWith("nk")) { ipa += "ŋk"; i += 2; continue; }
    if (rem.startsWith("ee") || rem.startsWith("ea")) { ipa += "iː"; i += 2; continue; }
    if (rem.startsWith("oo")) { ipa += "uː"; i += 2; continue; }
    if (rem.startsWith("ou") || rem.startsWith("ow")) { ipa += "aʊ"; i += 2; continue; }
    if (rem.startsWith("oi") || rem.startsWith("oy")) { ipa += "ɔɪ"; i += 2; continue; }
    if (rem.startsWith("ai") || rem.startsWith("ay")) { ipa += "eɪ"; i += 2; continue; }
    if (rem.startsWith("oa")) { ipa += "oʊ"; i += 2; continue; }
    if (rem.startsWith("au") || rem.startsWith("aw")) { ipa += "ɔː"; i += 2; continue; }
    if (rem.startsWith("ar")) { ipa += "ɑː"; i += 2; continue; }
    if (rem.startsWith("er") || rem.startsWith("ir") || rem.startsWith("ur")) { ipa += "ɜː"; i += 2; continue; }
    if (rem.startsWith("or")) { ipa += "ɔː"; i += 2; continue; }
    if (rem.startsWith("wr")) { ipa += "ɹ"; i += 2; continue; }
    if (rem.startsWith("kn") && i === 0) { ipa += "n"; i += 2; continue; }
    if (rem.startsWith("ed") && i === n - 2) { ipa += "d"; i += 2; continue; }

    // Regla de silent 'e' (magic e: vocal + consonante + e al final de la palabra)
    if (i === n - 3 && w[n - 1] === "e") {
      const vowel = rem[0];
      const consonant = rem[1];
      if ("bcdfghjklmnpqrstvwxyz".includes(consonant)) {
        if (vowel === "a") { ipa += "eɪ" + (consonant === "r" ? "ɹ" : consonant); i += 3; continue; }
        if (vowel === "i") { ipa += "aɪ" + (consonant === "r" ? "ɹ" : consonant); i += 3; continue; }
        if (vowel === "o") { ipa += "oʊ" + (consonant === "r" ? "ɹ" : consonant); i += 3; continue; }
        if (vowel === "u") { ipa += "juː" + (consonant === "r" ? "ɹ" : consonant); i += 3; continue; }
        if (vowel === "e") { ipa += "iː" + (consonant === "r" ? "ɹ" : consonant); i += 3; continue; }
      }
    }

    // Reglas de 1 letra
    const c = rem[0];
    if (c === "a") {
      ipa += "æ";
    } else if (c === "e") {
      ipa += (i === n - 1 && n > 2 ? "" : "ɛ");
    } else if (c === "i") {
      ipa += "ɪ";
    } else if (c === "o") {
      ipa += "ɒ";
    } else if (c === "u") {
      ipa += "ʌ";
    } else if (c === "y") {
      ipa += (i === 0 ? "j" : (i === n - 1 ? "i" : "ɪ"));
    } else if (c === "c") {
      const next = w[i + 1];
      ipa += (next === "e" || next === "i" || next === "y" ? "s" : "k");
    } else if (c === "g") {
      const next = w[i + 1];
      ipa += (next === "e" || next === "i" || next === "y" ? "ʤ" : "ɡ");
    } else if (c === "j") {
      ipa += "ʤ";
    } else if (c === "r") {
      ipa += "ɹ";
    } else if (c === "x") {
      ipa += "ks";
    } else {
      ipa += c;
    }
    i++;
  }

  return ipa;
}

/**
 * Convierte un texto completo normalizado a su representación fonética IPA,
 * respetando espacios y signos de puntuación de KittenTTS.
 */
export function phonemizeText(text: string): string {
  if (!text) return "";
  const normalized = normalizeEnglishText(text);

  // Tokenizar en palabras y signos de puntuación / espacios
  const tokens = normalized.match(/[\w']+|[^\w\s]|\s+/g) || [];
  const phonemesList: string[] = [];

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      phonemesList.push(" ");
    } else if (/^[^\w\s]+$/.test(token)) {
      // Preservar puntuación soportada
      phonemesList.push(token);
    } else {
      // Palabra: buscar en diccionario o aplicar reglas G2P
      const cleanWord = token.toLowerCase();
      const ipaWord = COMMON_IPA_DICT[cleanWord] || convertEnglishWordToIpa(token);
      phonemesList.push(ipaWord);
    }
  }

  return phonemesList.join("").replace(/\s+/g, " ").trim();
}

/**
 * Convierte un texto fonemizado a IDs numéricos [0..177] para KittenTTS.
 * Cada símbolo se mapea según KITTEN_VOCAB_MAP.
 * Se envuelve con el token de padding `0` ($) al inicio y al final: [0, ...tokenIds, 0].
 */
export function textToTokenIds(phonemizedText: string): number[] {
  const ids: number[] = [];

  for (const char of phonemizedText) {
    const id = KITTEN_VOCAB_MAP.get(char);
    if (id !== undefined) {
      ids.push(id);
    }
  }

  // Si no se reconoció ningún símbolo, incluir espacio mínimo
  const baseTokens = ids.length > 0 ? ids : [KITTEN_VOCAB_MAP.get(" ") ?? 16];

  // Envolver la secuencia con tokens de padding 0 al inicio y al final
  return [0, ...baseTokens, 0];
}

/**
 * Pipeline completo de preparación de tokens:
 * Texto normalizado -> Fonemas IPA -> Token IDs numéricos con padding [0, ...ids, 0]
 */
export function prepareKittenInputIds(text: string): number[] {
  const phonemes = phonemizeText(text);
  return textToTokenIds(phonemes);
}
