// Banco editorial del examen inicial. La muestra deja de ser un
// random sobre todo el catálogo (que escogía fichas sin definición o
// irrelevantes como «step» o «jalifa») y pasa a salir de esta lista
// revisada: lemas comunes del español general, con acepción cargada
// y dentro de su banda zipf. El worker verifica la banda contra la
// medición real — un lema fuera de su banda simplemente no entra.
//
// Seis bandas de 0.5 entre 2.0 y 5.0, el mismo rango que usaba el
// muestreo anterior: lo raro primero (2.0), lo cotidiano al final
// (5.0). Doce lemas por banda dan suficiente rotación para que dos
// muestras no repitan siempre lo mismo.
//
// Versión: se guarda con el borrador del examen; al cambiar la lista
// se sube la versión para no restaurar respuestas contra otra muestra.
export type CalibrationProfile = "native" | "learner";

export const CALIBRATION_BANK_VERSION = "es-bank-v3";
export const CALIBRATION_BANK_EN_VERSION = "en-bank-v1";

// Bandas del examen para lectores nativos (vocabulario literario y expresivo graduado).
export const CALIBRATION_BANDS_NATIVE: readonly (readonly [number, number])[] = [
  [2.0, 2.3],
  [2.3, 2.6],
  [2.6, 2.9],
  [2.9, 3.2],
  [3.2, 3.5],
  [3.5, 3.8],
];

// Bandas del examen para aprendices de español como lengua extranjera.
export const CALIBRATION_BANDS_LEARNER: readonly (readonly [number, number])[] = [
  [2.0, 2.5],
  [2.5, 3.0],
  [3.0, 3.5],
  [3.5, 4.0],
  [4.0, 4.5],
  [4.5, 5.0],
];

// Bandas por defecto (retrocompatibilidad).
export const CALIBRATION_BANDS = CALIBRATION_BANDS_LEARNER;

// Cuántas palabras por banda salen en la muestra (6 × 3 = 18, en
// tres pasos de seis).
export const CALIBRATION_PER_BAND = 3;

// Banco para hispanohablantes nativos (vocabulario literario y expresivo graduado).
export const CALIBRATION_BANK_NATIVE: readonly (readonly string[])[] = [
  // [2.0, 2.3) — cultas y literarias selectas
  [
    "diletante",
    "truculento",
    "resquemor",
    "alborozo",
    "altivez",
    "purpúreo",
    "hibernar",
    "cimitarra",
    "advenedizo",
    "escenificar",
    "amargor",
    "hilaridad",
  ],
  // [2.3, 2.6) — narrativa expresiva y literaria
  [
    "soslayar",
    "displicente",
    "congoja",
    "taciturno",
    "zancada",
    "baladí",
    "subyugar",
    "parco",
    "desparpajo",
    "inacabado",
    "sobresalto",
    "batacazo",
  ],
  // [2.6, 2.9) — emociones, tensión y matices narrativos
  [
    "pusilánime",
    "tedio",
    "sagaz",
    "ignominia",
    "torniquete",
    "suspicacia",
    "zarpar",
    "camisón",
    "zozobra",
    "pescuezo",
    "desazón",
    "sosiego",
  ],
  // [2.9, 3.2) — literarias comunes
  [
    "estupor",
    "vestigio",
    "vehemencia",
    "aflicción",
    "regocijo",
    "perplejo",
    "reproche",
    "apacible",
    "desolación",
    "desdén",
    "recelo",
    "destello",
  ],
  // [3.2, 3.5) — narrativa descriptiva y figurativa
  [
    "saborear",
    "efímero",
    "desmayo",
    "conjetura",
    "orfanato",
    "júbilo",
    "simular",
    "esquivar",
    "melancolía",
    "aislar",
    "cautela",
    "tarro",
  ],
  // [3.5, 3.8) — vocabulario expresivo estándar
  [
    "alejar",
    "alboroto",
    "anhelo",
    "asombro",
    "delirio",
    "fatiga",
    "ubicar",
    "desigual",
    "percibir",
    "inquietud",
    "mudo",
    "dilema",
  ],
];

// Banco editorial para estudiantes de español (graduado desde cotidiano).
export const CALIBRATION_BANK_LEARNER: readonly (readonly string[])[] = [
  // [2.0, 2.5) — raras pero reconocibles para un estudiante intermedio/avanzado.
  [
    "subyugar",
    "zancada",
    "hibernar",
    "injertar",
    "tartán",
    "bajamar",
    "escenificar",
    "trivialidad",
    "cimitarra",
    "amargor",
    "purpúreo",
    "picacho",
  ],
  // [2.5, 3.0)
  [
    "berrinche",
    "pescuezo",
    "candelero",
    "serrucho",
    "torniquete",
    "zarpar",
    "gruñón",
    "desprender",
    "inacabado",
    "parco",
    "inmemorial",
    "batacazo",
  ],
  // [3.0, 3.5)
  [
    "esquivar",
    "aislar",
    "sujetar",
    "moler",
    "desmayo",
    "yugo",
    "simular",
    "tarro",
    "sardina",
    "castaña",
    "saborear",
    "orfanato",
  ],
  // [3.5, 4.0)
  [
    "panza",
    "asombro",
    "ubicar",
    "alejar",
    "cohete",
    "diente",
    "máscara",
    "dilema",
    "percibir",
    "pretender",
    "mudo",
    "desigual",
  ],
  // [4.0, 4.5) — cotidianas para casi cualquier lector.
  [
    "temor",
    "eficaz",
    "urgente",
    "orgulloso",
    "ciego",
    "patio",
    "quitar",
    "funcionar",
    "bloquear",
    "sombrero",
    "defecto",
    "patente",
  ],
  // [4.5, 5.0) — las más frecuentes de la muestra.
  [
    "lluvia",
    "viento",
    "paciente",
    "profundo",
    "hermoso",
    "barrio",
    "cuarto",
    "escuchar",
    "llorar",
    "triste",
    "destino",
    "propósito",
  ],
];

// Alias para retrocompatibilidad
export const CALIBRATION_BANK = CALIBRATION_BANK_NATIVE;

// Banco editorial en inglés repartido en las mismas 6 bandas zipf.
export const CALIBRATION_BANK_EN: readonly (readonly string[])[] = [
  // [2.0, 2.5) — infrecuentes / literarias (CEFR C1–C2).
  [
    "clandestine",
    "surreptitious",
    "ephemeral",
    "blunder",
    "aloof",
    "haughty",
    "kindle",
    "fathom",
    "ponder",
    "yearn",
    "solace",
    "uncanny",
  ],
  // [2.5, 3.0) — avanzadas / menos cotidianas (CEFR B2–C1).
  [
    "awkward",
    "bewilder",
    "clumsy",
    "stubborn",
    "gloomy",
    "reckless",
    "thrive",
    "glimpse",
    "scarce",
    "tedious",
    "tremble",
    "subtle",
  ],
  // [3.0, 3.5) — intermedias altas (CEFR B1–B2).
  [
    "whisper",
    "wander",
    "delight",
    "harsh",
    "grief",
    "sorrow",
    "bargain",
    "praise",
    "venture",
    "conceal",
    "scatter",
    "damp",
  ],
  // [3.5, 4.0) — intermedias / cotidianas (CEFR B1).
  [
    "afraid",
    "narrow",
    "smooth",
    "proud",
    "lonely",
    "afford",
    "sudden",
    "hollow",
    "gentle",
    "brave",
    "crowd",
    "threat",
  ],
  // [4.0, 4.5) — elementales comunes (CEFR A2–B1).
  [
    "village",
    "bridge",
    "silver",
    "garden",
    "shadow",
    "quiet",
    "clever",
    "hungry",
    "pocket",
    "danger",
    "winter",
    "trouble",
  ],
  // [4.5, 5.0) — básicas / alta frecuencia (CEFR A1–A2).
  [
    "friend",
    "summer",
    "father",
    "river",
    "sleep",
    "happy",
    "window",
    "doctor",
    "travel",
    "simple",
    "yellow",
    "water",
  ],
];

// Definiciones bilingües / de apoyo para los lemas en inglés del banco.
export const CALIBRATION_DEFINITIONS_EN: Readonly<Record<string, string>> = {
  // [2.0, 2.5)
  clandestine: "Hecho en secreto o de forma oculta.",
  surreptitious: "Obtenido o realizado con disimulo y a escondidas.",
  ephemeral: "Que dura muy poco tiempo o es pasajero.",
  blunder: "Error o equivocación torpe y grave.",
  aloof: "Distante, reservado o poco comunicativo.",
  haughty: "Arrogante, orgulloso y con desdén hacia los demás.",
  kindle: "Encender fuego o avivar un sentimiento o pasión.",
  fathom: "Comprender o penetrar el sentido profundo de algo.",
  ponder: "Pensar detenidamente y con calma sobre algo.",
  yearn: "Sentir un deseo profundo o anhelo vehemente.",
  solace: "Consuelo o alivio en medio del dolor o la tristeza.",
  uncanny: "Misterioso, extraño o inquietante.",
  // [2.5, 3.0)
  awkward: "Incómodo, torpe o difícil de manejar.",
  bewilder: "Desconcertar o confundir por completo a alguien.",
  clumsy: "Torpe en movimientos o en el trato.",
  stubborn: "Terco, obstinado o difícil de doblegar.",
  gloomy: "Sombrío, oscuro o desanimado.",
  reckless: "Temerario, imprudente o descuidado ante el peligro.",
  thrive: "Prosperar, florecer o desarrollarse con éxito.",
  glimpse: "Vistazo rápido o visión fugaz de algo.",
  scarce: "Escaso o difícil de encontrar.",
  tedious: "Tedioso, aburrido y pesado por su monotonía.",
  tremble: "Temblar de frío, miedo o emoción.",
  subtle: "Sutil, delicado o difícil de percibir a simple vista.",
  // [3.0, 3.5)
  whisper: "Susurrar o hablar en voz muy baja.",
  wander: "Vagar, pasear sin rumbo o perderse en pensamientos.",
  delight: "Gran placer, satisfacción o deleite.",
  harsh: "Áspero, severo o desagradable al oído o tacto.",
  grief: "Pena profunda o tristeza por una gran pérdida.",
  sorrow: "Dolor del alma, pesar o aflicción.",
  bargain: "Trato ventajoso o compra a buen precio.",
  praise: "Elogiar, alabar o aplaudir las cualidades de alguien.",
  venture: "Aventurarse a hacer algo arriesgado o nueva empresa.",
  conceal: "Ocultar o esconder algo a la vista o conocimiento de otros.",
  scatter: "Esparcir, dispersar o desparramar en varias direcciones.",
  damp: "Ligeramente húmedo o mojado.",
  // [3.5, 4.0)
  afraid: "Temeroso, asustado o con miedo.",
  narrow: "Estrecho o de poca anchura.",
  smooth: "Liso, suave o sin asperezas ni sobresaltos.",
  proud: "Orgulloso o satisfecho de sus logros o seres queridos.",
  lonely: "Solitario o triste por falta de compañía.",
  afford: "Poder permitirse pagar o hacer algo.",
  sudden: "Repentino, imprevisto o rápido.",
  hollow: "Hueco, vacío por dentro.",
  gentle: "Amable, dócil, suave o cariñoso.",
  brave: "Valiente, decidido ante el miedo o peligro.",
  crowd: "Multitud o grupo grande de personas reunidas.",
  threat: "Amenaza o anuncio de un mal inminente.",
  // [4.0, 4.5)
  village: "Pueblo o aldea pequeña.",
  bridge: "Puente que cruza un río, camino o vía.",
  silver: "Plata o de color plateado.",
  garden: "Jardín o terreno donde se cultivan flores o plantas.",
  shadow: "Sombra que proyecta un cuerpo al tapar la luz.",
  quiet: "Silencioso, tranquilo o en calma.",
  clever: "Listo, ingenioso o hábil para resolver problemas.",
  hungry: "Hambriento o con ganas de comer.",
  pocket: "Bolsillo de una prenda para guardar objetos.",
  danger: "Peligro o riesgo de daño.",
  winter: "Invierno, la estación más fría del año.",
  trouble: "Problema, dificultad o molestia.",
  // [4.5, 5.0)
  friend: "Amigo o persona cercana con afecto mutuo.",
  summer: "Verano, la estación más calurosa del año.",
  father: "Padre o progenitor masculino.",
  river: "Río o corriente natural de agua.",
  sleep: "Dormir o estado de reposo natural del cuerpo.",
  happy: "Feliz, alegre o contento.",
  window: "Ventana que da luz y ventilación a una habitación.",
  doctor: "Médico o persona dedicada a curar enfermos.",
  travel: "Viajar o trasladarse a otros lugares.",
  simple: "Sencillo, fácil de entender o sin adornos excesivos.",
  yellow: "Amarillo o de color semejante al del oro o el sol.",
  water: "Agua, líquido vital transparente e inodoro.",
};

// Bandas correspondientes según perfil e idioma.
export function calibrationBandsFor(
  profile: CalibrationProfile = "native",
  language = "es",
): readonly (readonly [number, number])[] {
  if (language === "en") return CALIBRATION_BANDS_LEARNER;
  return profile === "native" ? CALIBRATION_BANDS_NATIVE : CALIBRATION_BANDS_LEARNER;
}

// Banco correspondiente según perfil e idioma.
export function calibrationBankFor(
  profile: CalibrationProfile = "native",
  language = "es",
): readonly (readonly string[])[] {
  if (language === "en") return CALIBRATION_BANK_EN;
  return profile === "native" ? CALIBRATION_BANK_NATIVE : CALIBRATION_BANK_LEARNER;
}

// Banco correspondiente según idioma (por defecto perfil nativo para español).
export function calibrationBank(
  language = "es",
  profile: CalibrationProfile = "native",
): readonly (readonly string[])[] {
  return calibrationBankFor(profile, language);
}

// Versión del banco para asociar al borrador de calibración.
export function calibrationBankVersion(
  language = "es",
  profile: CalibrationProfile = "native",
): string {
  if (language === "en") return CALIBRATION_BANK_EN_VERSION;
  return `${CALIBRATION_BANK_VERSION}:${profile}`;
}

// Definición de respaldo cuando el catálogo no tenga acepción cargada.
export function calibrationFallbackDefinition(lemma: string, language = "es"): string | null {
  if (language === "en") return CALIBRATION_DEFINITIONS_EN[lemma] ?? null;
  return null;
}

// Medición zipf estimada a partir de la banda editorial para lemas del banco.
export function calibrationBankZipf(
  lemma: string,
  language = "es",
  profile: CalibrationProfile = "native",
): number | null {
  const normalized = lemma.trim().toLowerCase();
  const primaryBank = calibrationBankFor(profile, language);
  const primaryBands = calibrationBandsFor(profile, language);
  for (let band = 0; band < primaryBank.length; band++) {
    if (primaryBank[band].includes(normalized)) {
      const [lo, hi] = primaryBands[band];
      return Number(((lo + hi) / 2).toFixed(2));
    }
  }
  // Fallback al otro banco si es español para asegurar mediciones de respaldo
  if (language === "es") {
    const otherProfile = profile === "native" ? "learner" : "native";
    const otherBank = calibrationBankFor(otherProfile, language);
    const otherBands = calibrationBandsFor(otherProfile, language);
    for (let band = 0; band < otherBank.length; band++) {
      if (otherBank[band].includes(normalized)) {
        const [lo, hi] = otherBands[band];
        return Number(((lo + hi) / 2).toFixed(2));
      }
    }
  }
  return null;
}

// Índice de banda para una medición zipf; -1 fuera del rango.
export function calibrationBandIndex(
  zipf: number,
  profile: CalibrationProfile = "native",
  language = "es",
): number {
  const bands = calibrationBandsFor(profile, language);
  return bands.findIndex(([lo, hi]) => zipf >= lo && zipf < hi);
}

// Lista plana de lemas del banco (para el WHERE del catálogo).
export function calibrationBankLemmas(
  language = "es",
  profile: CalibrationProfile = "native",
): string[] {
  return calibrationBankFor(profile, language).flat();
}

