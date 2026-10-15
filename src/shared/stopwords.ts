// Palabras funcionales del español (artículos, preposiciones, conjunciones,
// pronombres, auxiliares y sus formas comunes): no son vocabulario que se
// aprende, así que se excluyen del análisis de "palabras difíciles" y del
// enriquecimiento por IA. Compartido entre cliente y worker.
export const SPANISH_STOPWORDS = [
  // artículos y contracciones
  "el", "la", "los", "las", "un", "una", "unos", "unas", "lo", "al", "del",
  // preposiciones
  "a", "de", "en", "ante", "bajo", "con", "contra", "desde", "durante",
  "entre", "hacia", "hasta", "para", "por", "según", "sin", "sobre", "tras",
  // conjunciones
  "y", "e", "o", "u", "ni", "pero", "mas", "sino", "si", "que", "como",
  "porque", "pues", "aunque", "mientras", "cuando", "donde", "cuanto",
  // pronombres personales y átonos
  "yo", "tú", "él", "ella", "usted", "nosotros", "nosotras", "vosotros",
  "vosotras", "ellos", "ellas", "ustedes", "me", "te", "se", "nos", "os",
  "le", "les",
  // posesivos y demostrativos
  "mi", "tu", "su", "mis", "tus", "sus", "nuestro", "nuestra", "nuestros",
  "nuestras", "vuestro", "vuestra", "vuestros", "vuestras", "este", "esta",
  "estos", "estas", "ese", "esa", "esos", "esas", "aquel", "aquella",
  "aquellos", "aquellas", "esto", "eso", "aquello", "cuyo", "cuya",
  "cuyos", "cuyas",
  // indefinidos y cuantificadores
  "todo", "toda", "todos", "todas", "otro", "otra", "otros", "otras",
  "mismo", "misma", "mismos", "mismas", "algo", "nada", "alguien", "nadie",
  "quien", "quienes", "cual", "cuales", "cualquier", "cualesquiera", "cada",
  "mucho", "mucha", "muchos", "muchas", "poco", "poca", "pocos", "pocas",
  "bastante", "demasiado", "menos", "tanto", "tanta", "tantos", "tantas",
  "tan", "varios", "varias", "algún", "alguno", "alguna", "algunos",
  "algunas", "ningún", "ninguno", "ninguna", "ningunos", "ningunas",
  "ambos", "ambas", "demás", "tal", "tales",
  // numerales en texto: cardinales, ordinales y múltiplos
  "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho",
  "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
  "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte",
  "veintiún", "veintiuno", "veintidós", "veintitrés", "veinticuatro",
  "veinticinco", "veintiséis", "veintisiete", "veintiocho",
  "veintinueve", "treinta", "cuarenta", "cincuenta", "sesenta",
  "setenta", "ochenta", "noventa", "cien", "ciento", "cientos",
  "cienta", "cientas", "doscientos", "doscientas", "trescientos",
  "trescientas", "cuatrocientos", "cuatrocientas", "quinientos",
  "quinientas", "seiscientos", "seiscientas", "setecientos",
  "setecientas", "ochocientos", "ochocientas", "novecientos",
  "novecientas", "mil", "millón", "millones", "billón", "billones",
  "trillón", "trillones", "primer", "primero", "primera", "segundo",
  "segunda", "tercer", "tercero", "tercera", "cuarto", "cuarta",
  "quinto", "quinta", "sexto", "sexta", "séptimo", "séptima", "octavo",
  "octava", "noveno", "novena", "décimo", "décima", "undécimo",
  "duodécimo", "vigésimo", "centésimo",
  // saludos e interjecciones
  "hola", "adiós", "chao", "chau", "eh", "ah", "oh", "uh", "ay", "uy",
  "uf", "ajá", "mmm", "ey", "hey", "olé", "bravo", "ojalá", "vale",
  "venga", "dale", "ándale", "andale", "órale", "híjole", "bah", "ejem",
  // adverbios locativos, temporales y de modo frecuentes
  "más", "muy", "ya", "no", "sí", "también", "tampoco", "solo", "siquiera",
  "así", "aquí", "ahí", "allí", "acá", "allá", "ahora", "después",
  "antes", "luego", "entonces", "siempre", "nunca", "jamás", "casi",
  "acaso", "quizá", "quizás", "incluso", "además", "apenas", "abajo",
  "arriba", "atrás", "delante", "detrás", "adelante", "adentro",
  "afuera", "dentro", "fuera", "cerca", "lejos", "encima", "debajo",
  "alrededor", "enfrente", "ayer", "hoy", "mañana", "anoche",
  "anteayer", "antier", "aún", "aun", "todavía", "recién", "enseguida",
  "despacio", "pronto", "tarde", "temprano", "obstante", "asimismo",
  "aparte",
  // auxiliares y formas comunes de ser/estar/haber
  "ser", "estar", "haber", "es", "son", "soy", "eres", "somos", "era",
  "eran", "fue", "fueron", "será", "está", "están", "estoy", "estás",
  "estaba", "hay", "ha", "han", "he", "has", "hemos", "había",
];

// Palabras funcionales del inglés (artículos, preposiciones, pronombres,
// conjunciones, auxiliares, números y adverbios gramaticales comunes).
export const ENGLISH_STOPWORDS = [
  // artículos
  "the", "a", "an",
  // preposiciones
  "of", "in", "to", "for", "with", "on", "at", "from", "by", "about",
  "as", "into", "like", "through", "after", "over", "between", "out",
  "against", "during", "without", "before", "under", "around", "among",
  "upon", "off", "across", "behind", "beyond", "within", "along",
  "towards", "toward", "near", "despite", "above", "below", "throughout",
  // conjunciones
  "and", "but", "or", "nor", "so", "yet", "because", "although", "though",
  "while", "whereas", "if", "unless", "whether", "since", "than",
  // pronombres personales, reflexivos y posesivos
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their", "mine",
  "yours", "hers", "ours", "theirs", "myself", "yourself", "himself",
  "herself", "itself", "ourselves", "yourselves", "themselves",
  // demostrativos e interrogativos/relativos
  "this", "that", "these", "those", "who", "whom", "whose", "which",
  "what", "whatever", "whoever", "whomever", "whichever",
  // indefinidos y cuantificadores
  "all", "some", "any", "no", "every", "each", "both", "either", "neither",
  "another", "other", "others", "such", "someone", "somebody", "something",
  "anyone", "anybody", "anything", "everyone", "everybody", "everything",
  "nobody", "nothing", "none", "many", "much", "few", "fewer", "little",
  "more", "most", "less", "least", "several", "enough",
  // numerales cardinales y ordinales
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million",
  "billion", "first", "second", "third", "fourth", "fifth", "last", "next",
  // auxiliares, modales y formas de be / have / do
  "be", "am", "is", "are", "was", "were", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did", "doing", "done",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  // contracciones frecuentes normalizadas
  "don", "doesn", "didn", "won", "wouldn", "can", "couldn", "shouldn",
  "isn", "aren", "wasn", "weren", "hasn", "haven", "hadn",
  // adverbios locativos, temporales y de modo comunes
  "not", "too", "very", "also", "just", "only", "now", "then", "there",
  "here", "where", "when", "why", "how", "again", "always", "never",
  "sometimes", "often", "already", "still", "ever", "even", "rather",
  "quite", "almost", "together", "well", "back", "away", "far", "soon",
  "today", "yesterday", "tomorrow", "tonight", "perhaps", "maybe",
  // saludos e interjecciones comunes
  "hello", "hi", "hey", "bye", "goodbye", "yes", "yeah", "yep", "nope",
  "oh", "ah", "wow", "please", "thanks", "thank",
];

const spanishStopwordSet = new Set(SPANISH_STOPWORDS);
const englishStopwordSet = new Set(ENGLISH_STOPWORDS);

export function isStopword(form: string, language: "es" | "en" | string = "es"): boolean {
  const normalized = form.trim().toLowerCase();
  if (language === "en") return englishStopwordSet.has(normalized);
  if (language === "es") return spanishStopwordSet.has(normalized);
  return false;
}
