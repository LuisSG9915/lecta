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

// 2. Diccionario fonético determinista IPA de las palabras más comunes e irregulares en inglés (en-us rótico con acento ˈ)
export const COMMON_IPA_DICT: Record<string, string> = {
  // Saludos e interjecciones comunes
  hello: "həˈloʊ",
  hi: "ˈhaɪ",
  hey: "ˈheɪ",

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
  her: "hɚ",
  us: "ʌs",
  them: "ðɛm",
  my: "maɪ",
  your: "jʊɹ",
  his: "hɪz",
  its: "ɪts",
  our: "ˈaʊɚ",
  their: "ðɛɹ",
  who: "huː",
  whom: "huːm",
  whose: "huːz",
  what: "wɑːt",
  which: "wɪtʃ",
  where: "wɛɹ",
  when: "wɛn",
  why: "waɪ",
  how: "haʊ",
  some: "sʌm",
  any: "ˈɛni",
  every: "ˈɛvɹi",
  all: "ɔːl",
  each: "iːtʃ",
  both: "boʊθ",
  few: "fjuː",
  many: "ˈmɛni",
  much: "mʌtʃ",
  more: "mɔːɹ",
  most: "moʊst",
  other: "ˈʌðɚ",
  others: "ˈʌðɚz",
  another: "əˈnʌðɚ",
  such: "sʌtʃ",
  same: "seɪm",

  // Verbos auxiliares y copulativos
  is: "ɪz",
  am: "æm",
  are: "ɑːɹ",
  was: "wʌz",
  were: "wɜːɹ",
  be: "biː",
  been: "bɪn",
  being: "ˈbiːɪŋ",
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

  // Contracciones frecuentes (con y sin apóstrofe)
  "don't": "ˈdoʊnt",
  dont: "ˈdoʊnt",
  "won't": "ˈwoʊnt",
  wont: "ˈwoʊnt",
  "can't": "ˈkænt",
  cant: "ˈkænt",
  "didn't": "ˈdɪdənt",
  didnt: "ˈdɪdənt",
  "isn't": "ˈɪzənt",
  isnt: "ˈɪzənt",
  "aren't": "ˈɑːɹənt",
  arent: "ˈɑːɹənt",
  "wasn't": "ˈwʌzənt",
  wasnt: "ˈwʌzənt",
  "weren't": "ˈwɜːnt",
  werent: "ˈwɜːnt",
  "hasn't": "ˈhæzənt",
  hasnt: "ˈhæzənt",
  "haven't": "ˈhævənt",
  havent: "ˈhævənt",
  "hadn't": "ˈhædənt",
  hadnt: "ˈhædənt",
  "wouldn't": "ˈwʊdənt",
  wouldnt: "ˈwʊdənt",
  "couldn't": "ˈkʊdənt",
  couldnt: "ˈkʊdənt",
  "shouldn't": "ˈʃʊdənt",
  shouldnt: "ˈʃʊdənt",
  "i'm": "aɪm",
  im: "aɪm",
  "you're": "jʊɹ",
  youre: "jʊɹ",
  "he's": "hiːz",
  hes: "hiːz",
  "she's": "ʃiːz",
  shes: "ʃiːz",
  "it's": "ɪts",
  its_contr: "ɪts",
  "we're": "wɪɹ",
  were_contr: "wɪɹ",
  "they're": "ðɛɹ",
  theyre: "ðɛɹ",
  "i've": "aɪv",
  ive: "aɪv",
  "you've": "juːv",
  youve: "juːv",
  "we've": "wiːv",
  weve: "wiːv",
  "they've": "ðeɪv",
  theyve: "ðeɪv",
  "i'd": "aɪd",
  id: "aɪd",
  "you'd": "juːd",
  youd: "juːd",
  "he'd": "hiːd",
  hed: "hiːd",
  "she'd": "ʃiːd",
  shed: "ʃiːd",
  "we'd": "wiːd",
  wed: "wiːd",
  "they'd": "ðeɪd",
  theyd: "ðeɪd",
  "i'll": "aɪl",
  ill: "aɪl",
  "you'll": "juːl",
  youll: "juːl",
  "he'll": "hiːl",
  hell: "hiːl",
  "she'll": "ʃiːl",
  shell: "ʃiːl",
  "we'll": "wiːl",
  well_contr: "wiːl",
  "they'll": "ðeɪl",
  theyll: "ðeɪl",

  // Verbos comunes e irregulares
  say: "ˈseɪ",
  says: "ˈsɛz",
  said: "ˈsɛd",
  go: "ˈɡoʊ",
  goes: "ˈɡoʊz",
  went: "ˈwɛnt",
  gone: "ˈɡɑːn",
  going: "ˈɡoʊɪŋ",
  get: "ˈɡɛt",
  gets: "ˈɡɛts",
  got: "ˈɡɑːt",
  gotten: "ˈɡɑːtən",
  make: "ˈmeɪk",
  makes: "ˈmeɪks",
  made: "ˈmeɪd",
  know: "ˈnoʊ",
  knows: "ˈnoʊz",
  knew: "ˈnuː",
  known: "ˈnoʊn",
  think: "ˈθɪŋk",
  thinks: "ˈθɪŋks",
  thought: "ˈθɔːt",
  take: "ˈteɪk",
  takes: "ˈteɪks",
  took: "ˈtʊk",
  taken: "ˈteɪkən",
  see: "ˈsiː",
  sees: "ˈsiːz",
  saw: "ˈsɔː",
  seen: "ˈsiːn",
  come: "ˈkʌm",
  comes: "ˈkʌmz",
  came: "ˈkeɪm",
  want: "ˈwɑːnt",
  wants: "ˈwɑːnts",
  wanted: "ˈwɑːntɪd",
  look: "ˈlʊk",
  looks: "ˈlʊks",
  looked: "ˈlʊkt",
  use: "ˈjuːz",
  uses: "ˈjuːzɪz",
  used: "ˈjuːzd",
  find: "ˈfaɪnd",
  finds: "ˈfaɪndz",
  found: "ˈfaʊnd",
  give: "ˈɡɪv",
  gives: "ˈɡɪvz",
  gave: "ˈɡeɪv",
  given: "ˈɡɪvən",
  tell: "ˈtɛl",
  tells: "ˈtɛlz",
  told: "ˈtoʊld",
  work: "ˈwɜːk",
  call: "ˈkɔːl",
  called: "ˈkɔːld",
  try: "ˈtɹaɪ",
  ask: "ˈæsk",
  asked: "ˈæskt",
  need: "ˈniːd",
  needed: "ˈniːdɪd",
  feel: "ˈfiːl",
  felt: "ˈfɛlt",
  become: "bɪˈkʌm",
  became: "bɪˈkeɪm",
  leave: "ˈliːv",
  left: "ˈlɛft",
  put: "ˈpʊt",
  mean: "ˈmiːn",
  meant: "ˈmɛnt",
  keep: "ˈkiːp",
  kept: "ˈkɛpt",
  let: "ˈlɛt",
  begin: "bɪˈɡɪn",
  began: "bɪˈɡæn",
  begun: "bɪˈɡʌn",
  seem: "ˈsiːm",
  seemed: "ˈsiːmd",
  help: "ˈhɛlp",
  talk: "ˈtɔːk",
  turn: "ˈtɜːn",
  turned: "ˈtɜːnd",
  start: "ˈstɑːɹt",
  show: "ˈʃoʊ",
  showed: "ˈʃoʊd",
  shown: "ˈʃoʊn",
  hear: "ˈhɪɹ",
  heard: "ˈhɜːd",
  play: "ˈpleɪ",
  run: "ˈɹʌn",
  ran: "ˈɹæn",
  move: "ˈmuːv",
  like: "ˈlaɪk",
  live: "ˈlɪv",
  lived: "ˈlɪvd",
  believe: "bɪˈliːv",
  hold: "ˈhoʊld",
  held: "ˈhɛld",
  bring: "ˈbɹɪŋ",
  brought: "ˈbɹɔːt",
  happen: "ˈhæpən",
  happened: "ˈhæpənd",
  write: "ˈɹaɪt",
  wrote: "ˈɹoʊt",
  written: "ˈɹɪtən",
  sit: "ˈsɪt",
  sat: "ˈsæt",
  stand: "ˈstænd",
  stood: "ˈstʊd",
  lose: "ˈluːz",
  lost: "ˈlɔːst",
  pay: "ˈpeɪ",
  paid: "ˈpeɪd",
  meet: "ˈmiːt",
  met: "ˈmɛt",
  learn: "ˈlɜːn",
  change: "ˈtʃeɪndʒ",
  lead: "ˈliːd",
  led: "ˈlɛd",
  understand: "ˌʌndɚˈstænd",
  understood: "ˌʌndɚˈstʊd",
  watch: "ˈwɑːtʃ",
  follow: "ˈfɑːloʊ",
  stop: "ˈstɑːp",
  stopped: "ˈstɑːpt",
  speak: "ˈspiːk",
  spoke: "ˈspoʊk",
  spoken: "ˈspoʊkən",
  read: "ˈɹiːd",
  allow: "əˈlaʊ",
  add: "ˈæd",
  spend: "ˈspɛnd",
  spent: "ˈspɛnt",
  grow: "ˈɡɹoʊ",
  grew: "ˈɡɹuː",
  grown: "ˈɡɹoʊn",
  open: "ˈoʊpən",
  walk: "ˈwɔːk",
  walked: "ˈwɔːkt",
  win: "ˈwɪn",
  won: "ˈwʌn",
  remember: "ɹɪˈmɛmbɚ",
  love: "ˈlʌv",
  loved: "ˈlʌvd",
  appear: "əˈpɪɹ",
  appeared: "əˈpɪɹd",
  buy: "ˈbaɪ",
  bought: "ˈbɔːt",
  wait: "ˈweɪt",
  waited: "ˈweɪtɪd",
  die: "ˈdaɪ",
  died: "ˈdaɪd",
  send: "ˈsɛnd",
  sent: "ˈsɛnt",
  build: "ˈbɪld",
  built: "ˈbɪlt",
  stay: "ˈsteɪ",
  fall: "ˈfɔːl",
  fell: "ˈfɛl",
  fallen: "ˈfɔːlən",
  cut: "ˈkʌt",
  reach: "ˈɹiːtʃ",
  reached: "ˈɹiːtʃt",
  kill: "ˈkɪl",
  remain: "ɹɪˈmeɪn",

  // Preposiciones y conjunciones
  of: "ʌv",
  to: "tuː",
  in: "ɪn",
  for: "fɔːɹ",
  on: "ɑːn",
  with: "wɪð",
  at: "æt",
  by: "baɪ",
  from: "fɹʌm",
  up: "ʌp",
  about: "əˈbaʊt",
  into: "ˈɪntuː",
  over: "ˈoʊvɚ",
  after: "ˈæftɚ",
  beneath: "bɪˈniːθ",
  under: "ˈʌndɚ",
  above: "əˈbʌv",
  between: "bɪˈtwiːn",
  through: "θɹuː",
  during: "ˈdʊɹɪŋ",
  without: "wɪðˈaʊt",
  before: "bɪˈfɔːɹ",
  around: "əˈɹaʊnd",
  among: "əˈmʌŋ",
  and: "ænd",
  but: "bʌt",
  or: "ɔːɹ",
  as: "æz",
  if: "ɪf",
  than: "ðæn",
  because: "bɪˈkɔːz",
  while: "waɪl",
  so: "soʊ",
  though: "ðoʊ",
  although: "ɔːlˈðoʊ",

  // Adverbios
  not: "ˈnɑːt",
  no: "ˈnoʊ",
  yes: "ˈjɛs",
  now: "ˈnaʊ",
  then: "ˈðɛn",
  there: "ðɛɹ",
  here: "ˈhɪɹ",
  just: "ˈdʒʌst",
  also: "ˈɔːlsoʊ",
  well: "ˈwɛl",
  only: "ˈoʊnli",
  very: "ˈvɛɹi",
  even: "ˈiːvən",
  back: "ˈbæk",
  down: "ˈdaʊn",
  still: "ˈstɪl",
  too: "ˈtuː",
  never: "ˈnɛvɚ",
  always: "ˈɔːlweɪz",
  again: "əˈɡɛn",
  away: "əˈweɪ",
  often: "ˈɑːfən",
  together: "təˈɡɛðɚ",
  once: "ˈwʌns",
  almost: "ˈɔːlmoʊst",
  enough: "ɪˈnʌf",
  perhaps: "pɚˈhæps",
  probably: "ˈpɹɑːbəbli",
  already: "ɔːlˈɹɛdi",
  soon: "ˈsuːn",
  ever: "ˈɛvɚ",

  // Números
  zero: "ˈzɪɹoʊ",
  one: "ˈwʌn",
  two: "ˈtuː",
  three: "ˈθɹiː",
  four: "ˈfɔːɹ",
  five: "ˈfaɪv",
  six: "ˈsɪks",
  seven: "ˈsɛvən",
  eight: "ˈeɪt",
  nine: "ˈnaɪn",
  ten: "ˈtɛn",
  eleven: "ɪˈlɛvən",
  twelve: "ˈtwɛlv",
  thirteen: "θɜːɹˈtiːn",
  fourteen: "fɔːɹˈtiːn",
  fifteen: "fɪfˈtiːn",
  sixteen: "sɪksˈtiːn",
  seventeen: "sɛvənˈtiːn",
  eighteen: "eɪˈtiːn",
  nineteen: "naɪnˈtiːn",
  twenty: "ˈtwɛnti",
  thirty: "ˈθɜːɹti",
  forty: "ˈfɔːɹti",
  fifty: "ˈfɪfti",
  sixty: "ˈsɪksti",
  seventy: "ˈsɛvənti",
  eighty: "ˈeɪti",
  ninety: "ˈnaɪnti",
  hundred: "ˈhʌndɹəd",
  thousand: "ˈθaʊzənd",
  million: "ˈmɪljən",
  first: "ˈfɜːst",
  second: "ˈsɛkənd",
  third: "ˈθɜːɹd",
  fourth: "ˈfɔːɹθ",
  fifth: "ˈfɪfθ",

  // Sustantivos y términos literarios
  time: "ˈtaɪm",
  year: "ˈjɪɹ",
  years: "ˈjɪɹz",
  people: "ˈpiːpəl",
  way: "ˈweɪ",
  day: "ˈdeɪ",
  days: "ˈdeɪz",
  man: "ˈmæn",
  men: "ˈmɛn",
  woman: "ˈwʊmən",
  women: "ˈwɪmɪn",
  child: "ˈtʃaɪld",
  children: "ˈtʃɪldɹən",
  thing: "ˈθɪŋ",
  things: "ˈθɪŋz",
  life: "ˈlaɪf",
  world: "ˈwɜːɹld",
  hand: "ˈhænd",
  hands: "ˈhændz",
  part: "ˈpɑːɹt",
  place: "ˈpleɪs",
  case: "ˈkeɪs",
  week: "ˈwiːk",
  night: "ˈnaɪt",
  point: "ˈpɔɪnt",
  home: "ˈhoʊm",
  water: "ˈwɔːɾɚ",
  room: "ˈɹuːm",
  mother: "ˈmʌðɚ",
  father: "ˈfɑːðɚ",
  sister: "ˈsɪstɚ",
  brother: "ˈbɹʌðɚ",
  story: "ˈstɔːɹi",
  right: "ˈɹaɪt",
  book: "ˈbʊk",
  books: "ˈbʊks",
  eye: "ˈaɪ",
  eyes: "ˈaɪz",
  word: "ˈwɜːd",
  words: "ˈwɜːdz",
  head: "ˈhɛd",
  house: "ˈhaʊs",
  friend: "ˈfɹɛnd",
  hour: "ˈaʊɚ",
  line: "ˈlaɪn",
  end: "ˈɛnd",
  door: "ˈdɔːɹ",
  girl: "ˈɡɜːl",
  boy: "ˈbɔɪ",
  name: "ˈneɪm",
  named: "ˈneɪmd",
  lily: "ˈlɪli",
  needle: "ˈniːdəl",
  chapter: "ˈtʃæptɚ",
  mister: "ˈmɪstɚ",
  missus: "ˈmɪsɪz",
  miss: "ˈmɪs",
  doctor: "ˈdɑːktɚ",
  saint: "ˈseɪnt",
  paul: "ˈpɔːl",
  church: "ˈtʃɜːtʃ",
  steps: "ˈstɛps",
  heart: "ˈhɑːɹt",
  voice: "ˈvɔɪs",
  silence: "ˈsaɪləns",
  shadow: "ˈʃædoʊ",
  death: "ˈdɛθ",
  dream: "ˈdɹiːm",
  truth: "ˈtɹuːθ",
  light: "ˈlaɪt",
  dark: "ˈdɑːɹk",
  little: "ˈlɪɾəl",
  great: "ˈɡɹeɪt",
  small: "ˈsmɔːl",
  large: "ˈlɑːɹdʒ",
  young: "ˈjʌŋ",
  old: "ˈoʊld",
  good: "ˈɡʊd",
  bad: "ˈbæd",
  new: "ˈnuː",
  high: "ˈhaɪ",
  long: "ˈlɔːŋ",
  morning: "ˈmɔːɹnɪŋ",
  nothing: "ˈnʌθɪŋ",
  something: "ˈsʌmθɪŋ",
  everything: "ˈɛvɹiˌθɪŋ",
};

// Palabras gramaticales átonas que no llevan acento primario por defecto
const UNSTRESSED_FUNCTION_WORDS = new Set([
  "the", "a", "an", "and", "but", "or", "nor", "for", "so", "yet",
  "at", "by", "in", "of", "on", "to", "up", "as", "if", "than",
  "with", "into", "from"
]);

/**
 * Conversión determinista de ortografía inglesa a IPA para palabras no presentes en el diccionario.
 * Sigue las reglas de correspondencia grafema-fonema (G2P) estándar del inglés estadounidense (en-us).
 */
export function convertEnglishWordToIpa(raw: string): string {
  // Si la palabra ya contiene caracteres fonéticos IPA, preservarla normalizando ligaduras
  if (/[ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒˈˌː]/.test(raw)) {
    return raw.replace(/ʧ/g, "tʃ").replace(/ʤ/g, "dʒ");
  }

  const lower = raw.toLowerCase().trim();
  if (COMMON_IPA_DICT[lower]) {
    return COMMON_IPA_DICT[lower];
  }

  // Normalizar contracciones con apóstrofe tipográfico
  const cleanWithApostrophe = lower.replace(/['']/g, "'");
  if (COMMON_IPA_DICT[cleanWithApostrophe]) {
    return COMMON_IPA_DICT[cleanWithApostrophe];
  }

  // Si no contenía apóstrofe, intentar búsqueda directa
  if (!cleanWithApostrophe.includes("'")) {
    const cleanWithout = cleanWithApostrophe.replace(/['']/g, "");
    if (COMMON_IPA_DICT[cleanWithout]) {
      return COMMON_IPA_DICT[cleanWithout];
    }
  }

  const w = cleanWithApostrophe.replace(/['']/g, "");
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
    if (rem.startsWith("tch")) { ipa += "tʃ"; i += 3; continue; }
    if (rem.startsWith("dge")) { ipa += "dʒ"; i += 3; continue; }
    if (rem.startsWith("igh")) { ipa += "aɪ"; i += 3; continue; }
    if (rem.startsWith("ing")) { ipa += "ɪŋ"; i += 3; continue; }
    if (rem.startsWith("all")) { ipa += "ɔːl"; i += 3; continue; }

    // Patrones de 2 letras
    if (rem.startsWith("th")) {
      const prevVowel = i > 0 && "aeiou".includes(w[i - 1]);
      const nextVowel = i + 2 < n && "aeiou".includes(w[i + 2]);
      ipa += prevVowel && nextVowel ? "ð" : "θ";
      i += 2;
      continue;
    }
    if (rem.startsWith("sh")) { ipa += "ʃ"; i += 2; continue; }
    if (rem.startsWith("ch")) { ipa += "tʃ"; i += 2; continue; }
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
    if (rem.startsWith("ar")) { ipa += "ɑːɹ"; i += 2; continue; }
    if (rem.startsWith("er") || rem.startsWith("ir") || rem.startsWith("ur")) {
      // En final de palabra (o antes de 's' final) usar ɚ; en posición interna ɜːɹ
      const isEnd = i + 2 === n || (i + 2 === n - 1 && w[n - 1] === "s");
      ipa += isEnd ? "ɚ" : "ɜːɹ";
      i += 2;
      continue;
    }
    if (rem.startsWith("or")) { ipa += "ɔːɹ"; i += 2; continue; }
    if (rem.startsWith("wr")) { ipa += "ɹ"; i += 2; continue; }
    if (rem.startsWith("kn") && i === 0) { ipa += "n"; i += 2; continue; }
    if (rem.startsWith("ed") && i === n - 2 && n >= 4) { ipa += "d"; i += 2; continue; }

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
      ipa += "ɑː"; // Inglés estadounidense rótico: ɑː en lugar de británico ɒ
    } else if (c === "u") {
      ipa += "ʌ";
    } else if (c === "y") {
      ipa += (i === 0 ? "j" : (i === n - 1 ? "i" : "ɪ"));
    } else if (c === "c") {
      const next = w[i + 1];
      ipa += (next === "e" || next === "i" || next === "y" ? "s" : "k");
    } else if (c === "g") {
      const next = w[i + 1];
      ipa += (next === "e" || next === "i" || next === "y" ? "dʒ" : "ɡ");
    } else if (c === "j") {
      ipa += "dʒ";
    } else if (c === "r") {
      ipa += "ɹ";
    } else if (c === "x") {
      ipa += "ks";
    } else {
      ipa += c;
    }
    i++;
  }

  // Aplicar siempre marca de acento primario "ˈ" en palabras de contenido de 1 o más sílabas
  const cleanWordNoApostrophe = cleanWithApostrophe.replace(/'/g, "");
  if (!UNSTRESSED_FUNCTION_WORDS.has(cleanWordNoApostrophe) && !ipa.includes("ˈ") && !ipa.includes("ˌ")) {
    const vowelCount = (ipa.match(/[ɑɐɒæɔəɘɚɛɜɝɞɨɪʊʌiueo]/g) || []).length;
    if (vowelCount >= 1) {
      ipa = "ˈ" + ipa;
    }
  }

  return ipa.replace(/ʧ/g, "tʃ").replace(/ʤ/g, "dʒ");
}

/**
 * Convierte un texto completo normalizado a su representación fonética IPA,
 * respetando espacios y signos de puntuación de KittenTTS.
 */
export function phonemizeText(text: string): string {
  if (!text) return "";
  const normalized = normalizeEnglishText(text);

  // Tokenizar en palabras y signos de puntuación / espacios, preservando apóstrofes y marcas de acento
  const tokens = normalized.match(/[\w'ˈˌ]+|[^\w\s'ˈˌ]|\s+/g) || [];
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
      const normalizedApostrophe = cleanWord.replace(/['']/g, "'");
      const ipaWord =
        COMMON_IPA_DICT[normalizedApostrophe] ||
        COMMON_IPA_DICT[cleanWord] ||
        convertEnglishWordToIpa(token);
      phonemesList.push(ipaWord);
    }
  }

  return phonemesList
    .join("")
    .replace(/ʧ/g, "tʃ")
    .replace(/ʤ/g, "dʒ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convierte un texto fonemizado a IDs numéricos [0..177] para KittenTTS.
 * Cada símbolo se mapea según KITTEN_VOCAB_MAP.
 * Se envuelve con el token de padding `0` ($) al inicio y al final: [0, ...tokenIds, 0].
 */
export function textToTokenIds(phonemizedText: string): number[] {
  // Asegurar que ninguna ligadura no entrenada ʧ o ʤ llegue al mapeador de tokens
  const sanitized = phonemizedText.replace(/ʧ/g, "tʃ").replace(/ʤ/g, "dʒ");
  const ids: number[] = [];

  for (const char of sanitized) {
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
