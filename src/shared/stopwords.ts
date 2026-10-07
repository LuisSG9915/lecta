// Palabras funcionales del español (artículos, preposiciones, conjunciones,
// pronombres, auxiliares y sus formas comunes): no son vocabulario que se
// aprende, así que se excluyen del análisis de "palabras difíciles" y del
// enriquecimiento por IA. Compartido entre cliente y worker.
const SPANISH_STOPWORDS = [
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

const stopwordSet = new Set(SPANISH_STOPWORDS);

export function isStopword(form: string, language = "es") {
  return language === "es" && stopwordSet.has(form.trim().toLowerCase());
}
