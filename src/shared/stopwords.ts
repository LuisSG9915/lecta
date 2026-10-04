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
  "quien", "quienes", "cual", "cuales", "cada", "mucho", "mucha", "muchos",
  "muchas", "poco", "poca", "pocos", "pocas", "bastante", "demasiado",
  "menos", "tanto", "tanta", "tantos", "tantas", "tan", "varios", "varias",
  // adverbios frecuentes
  "más", "muy", "ya", "no", "sí", "también", "tampoco", "solo", "siquiera",
  "así", "aquí", "ahí", "allí", "ahora", "después", "antes", "luego",
  "entonces", "siempre", "nunca", "jamás", "casi", "acaso", "quizá",
  "quizás", "incluso", "además", "apenas",
  // auxiliares y formas comunes de ser/estar/haber
  "ser", "estar", "haber", "es", "son", "soy", "eres", "somos", "era",
  "eran", "fue", "fueron", "será", "está", "están", "estoy", "estás",
  "estaba", "hay", "ha", "han", "he", "has", "hemos", "había",
];

const stopwordSet = new Set(SPANISH_STOPWORDS);

export function isStopword(form: string, language = "es") {
  return language === "es" && stopwordSet.has(form.trim().toLowerCase());
}
