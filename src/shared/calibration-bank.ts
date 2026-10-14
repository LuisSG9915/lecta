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

// Definiciones de apoyo y verificación en español para los lemas del banco editorial.
export const CALIBRATION_DEFINITIONS_ES: Readonly<Record<string, string>> = {
  // [2.0, 2.3)
  diletante: "Persona que cultiva un arte o disciplina por afición y no de forma profesional.",
  truculento: "Que impresiona por su crueldad, dramatismo o violencia excesiva.",
  resquemor: "Sentimiento de resentimiento, disgusto o desazón que persiste en el ánimo.",
  alborozo: "Alegría intensa manifestada con muestras exteriores de regocijo.",
  altivez: "Orgullo, soberbia o actitud de superioridad frente a los demás.",
  purpúreo: "De color púrpura o con tonos rojizos y morados intensos.",
  hibernar: "Pasar el invierno en estado de letargo o inactividad biológica.",
  cimitarra: "Sable de hoja curva originario de Oriente.",
  advenedizo: "Persona que ha ascendido rápidamente a una posición sin mérito propio.",
  escenificar: "Poner en escena o representar teatralmente una acción o conflicto.",
  amargor: "Sabor o sensación amarga, o pesadumbre y tristeza en el ánimo.",
  hilaridad: "Risa bulliciosa o alegría ruidosa manifestada por un grupo.",
  // [2.3, 2.6)
  soslayar: "Evitar o esquivar una dificultad, pregunta o compromiso con habilidad.",
  displicente: "Que muestra desinterés, desdén, frialdad o falta de entusiasmo.",
  congoja: "Angustia, aflicción o tristeza intensa acompañada de opresión.",
  taciturno: "Callado, silencioso o habitualmente melancólico y poco comunicativo.",
  zancada: "Paso largo que se da con rapidez y decisión.",
  baladí: "De escaso valor, insignificante o de poca importancia.",
  subyugar: "Someter o cautivar con fuerza irresistible la voluntad o atención.",
  parco: "Escaso, sobrio o moderado en el hablar o en el actuar.",
  desparpajo: "Facilidad, desenvoltura o desenfado al hablar o comportarse.",
  inacabado: "Que no está terminado o concluido.",
  sobresalto: "Sensación repentina de temor, sorpresa o alarma provocada por un imprevisto.",
  batacazo: "Golpe o caída repentina, o fracaso inesperado y resonante.",
  // [2.6, 2.9)
  pusilánime: "Falto de ánimo, valor o resolución ante los momentos difíciles.",
  tedio: "Aburrimiento extremo o sensación de fastidio por la monotonía.",
  sagaz: "Astuto, agudo y con gran perspicacia para entender las cosas.",
  ignominia: "Deshonra pública, afrenta o vergüenza grave.",
  torniquete: "Instrumento o ligadura que comprime un vaso sanguíneo para detener el sangrado.",
  suspicacia: "Desconfianza, propensión a sospechar mala intención o engaño.",
  zarpar: "Levar anclas y salir un barco del puerto o fondeadero.",
  camisón: "Prenda de vestir holgada y cómoda que se usa para dormir.",
  zozobra: "Inquietud, angustia o estado de ansiedad ante un riesgo o peligro.",
  pescuezo: "Parte posterior del cuello, o cuello en general.",
  desazón: "Sensación de intranquilidad, desasosiego o disgusto interior.",
  sosiego: "Tranquilidad, calma o serenidad del ánimo.",
  // [2.9, 3.2)
  estupor: "Asombro o desconcierto extremo que impide reaccionar o hablar.",
  vestigio: "Huella, resto o indicio que perdura de algo antiguo o desaparecido.",
  vehemencia: "Fuerza, pasión o apasionamiento intenso al expresar ideas o sentimientos.",
  aflicción: "Sufrimiento, pena profunda o dolor moral.",
  regocijo: "Alegría viva y expansiva que produce satisfacción y contento.",
  perplejo: "Dudoso, incierto o confundido sin saber qué pensar o cómo actuar.",
  reproche: "Censura, queja o recriminación que se dirige a alguien por su conducta.",
  apacible: "Tranquilo, sereno, agradable y libre de turbulencias.",
  desolación: "Tristeza honda causada por la soledad, ruina o desconsuelo.",
  desdén: "Actitud de indiferencia, desprecio o menosprecio hacia algo o alguien.",
  recelo: "Temor o desconfianza ante algo que se sospecha desfavorable o peligroso.",
  destello: "Resplandor o rayo de luz vivo y de corta duración.",
  // [3.2, 3.5)
  saborear: "Degustar y apreciar con deleite el sabor de un alimento o experiencia.",
  efímero: "Que tiene una duración muy corta, pasajero o fugaz.",
  desmayo: "Pérdida momentánea del conocimiento o debilitamiento repentino de fuerzas.",
  conjetura: "Juicio u opinión formado a partir de indicios sin certeza absoluta.",
  orfanato: "Institución benéfica dedicada a la acogida y crianza de niños huérfanos.",
  júbilo: "Alegría muy viva y manifestada con muestras de gran entusiasmo.",
  simular: "Fingir o representar algo que no es real para ocultar la verdad.",
  esquivar: "Evitar un golpe, obstáculo o encuentro mediante un movimiento rápido.",
  melancolía: "Estado anímico de tristeza vaga, sosegada y nostálgica.",
  aislar: "Separar o apartar a alguien o algo de su entorno para mantenerlo independiente.",
  cautela: "Precaución y reserva prudente con que se procede para prevenir dificultades.",
  tarro: "Recipiente cilíndrico de vidrio o barro usado para conservar alimentos.",
  // [3.5, 3.8)
  alejar: "Poner lejos o distanciar en el espacio, en el tiempo o en el pensamiento.",
  alboroto: "Desorden, algarabía o tumulto ruidoso producido por un grupo.",
  anhelo: "Deseo vehemente y constante de conseguir o vivir alguna cosa.",
  asombro: "Sensación de gran sorpresa, admiración o extrañeza ante algo extraordinario.",
  delirio: "Alteración mental caracterizada por desvaríos, alucinaciones o ideas desordenadas.",
  fatiga: "Cansancio intenso provocado por un esfuerzo continuado o prolongado.",
  ubicar: "Situar o localizar algo en un lugar o espacio determinado.",
  desigual: "Que no es igual en cantidad, calidad, fuerza o proporción.",
  percibir: "Recibir sensaciones por medio de los sentidos o advertir y comprender algo.",
  inquietud: "Falta de tranquilidad, preocupación o desasosiego del ánimo.",
  mudo: "Privado del habla o que no emite sonido ni palabra en un momento dado.",
  dilema: "Situación en que es preciso elegir entre dos opciones complejas.",
  // Learner extras
  injertar: "Introducir o implantar una parte de una planta en otra para que crezcan juntas.",
  tartán: "Tejido de lana con un patrón característico de cuadros cruzados.",
  bajamar: "Momento en que el mar alcanza su menor altura en el ciclo de la marea.",
  trivialidad: "Cosa que carece de importancia, interés o trascendencia.",
  picacho: "Punta o cumbre aguda y elevada de una montaña o risco.",
  berrinche: "Enojo o llanto infantil violento y desmedido por una frustración.",
  candelero: "Soporte con un platillo y una boquilla para sostener una vela erguida.",
  serrucho: "Herramienta manual de corte con hoja ancha y dentada que termina en mango.",
  gruñón: "Que gruñe, protesta con frecuencia o muestra mal humor habitualmente.",
  desprender: "Separar, desatar o desunir algo que estaba adherido o sujeto.",
  inmemorial: "Tan antiguo que no queda memoria ni recuerdo exacto de cuándo comenzó.",
  sujetar: "Sostener o asir algo para que no se caiga, mueva o escape.",
  moler: "Reducir a polvo o trozos diminutos un cuerpo sólido mediante presión.",
  yugo: "Pieza de madera con que se uncen los bueyes, o carga pesada que sujeta.",
  sardina: "Pez marino plateado de cuerpo alargado muy común y apreciado en la cocina.",
  castaña: "Fruto seco del castaño de corteza marrón y pulpa blanca y nutritiva.",
  panza: "Vientre o parte abultada del cuerpo de los animales o personas.",
  cohete: "Aparato pirotécnico o vehículo propulsado por la combustión de gases.",
  diente: "Pieza ósea dura engastada en las mandíbulas que sirve para masticar.",
  máscara: "Objeto que cubre total o parcialmente el rostro para ocultar la identidad.",
  pretender: "Querer conseguir algo, aspirar a un fin o tener intención de realizarlo.",
  temor: "Miedo o sospecha de que suceda algo perjudicial o desagradable.",
  eficaz: "Que produce el efecto deseado o tiene capacidad para lograrlo.",
  urgente: "Que precisa de una atención, solución o acción inmediata sin demora.",
  orgulloso: "Satisfecho por los propios logros, o con exceso de autoestima.",
  ciego: "Que carece del sentido de la vista, o que no puede ver temporalmente.",
  patio: "Espacio abierto y cerrado por paredes o galerías dentro de un edificio.",
  quitar: "Apartar, retirar o despojar a algo o alguien de un lugar o pertenencia.",
  funcionar: "Desempeñar una máquina, sistema o persona su función adecuadamente.",
  bloquear: "Impedir el paso, la acción o el funcionamiento normal de algo.",
  sombrero: "Prenda de vestir para cubrir la cabeza, generalmente con ala y copa.",
  defecto: "Imperfección, fallo o carencia que menoscaba las cualidades de algo.",
  patente: "Claro, evidente o visible a simple vista; o título de invención registrada.",
  lluvia: "Precipitación de agua en forma de gotas que caen de las nubes.",
  viento: "Corriente de aire producida en la atmósfera por causas naturales.",
  paciente: "Que tiene paciencia y serenidad para esperar o soportar dificultades.",
  profundo: "Que tiene gran distancia entre el fondo y la superficie, o de hondo calado.",
  hermoso: "Que agrada a la vista por su belleza, armonía o proporción.",
  barrio: "Cada una de las zonas o distritos en que se divide una población.",
  cuarto: "Habitación o pieza de una vivienda.",
  escuchar: "Prestar atención a lo que se oye con intención de entenderlo.",
  llorar: "Derramar lágrimas en señal de dolor, tristeza, alegría o conmoción.",
  triste: "Afligido, apenado o que inspira desánimo y melancolía.",
  destino: "Fuerza o encadenamiento de sucesos considerado inevitable; o meta de viaje.",
  propósito: "Intención o ánimo firme de hacer o dejar de hacer algo determinado.",
};

// Frases cortas de contexto natural para los lemas clave del banco.
export const CALIBRATION_SAMPLE_CONTEXTS: Readonly<Record<string, string>> = {
  // Cultas y literarias
  diletante: "Aquel diletante frecuentaba los salones literarios sin comprometerse con ninguna corriente artística.",
  truculento: "El relato tomó un giro truculento que sobrecogió a los oyentes reunidos junto al fuego.",
  resquemor: "Guardaba cierto resquemor por las palabras ásperas que habían cruzado aquella tarde.",
  alborozo: "La noticia de la victoria fue recibida con gran alborozo en cada rincón del pueblo.",
  altivez: "Respondió con una altivez serena que desarmó por completo los reproches de sus acusadores.",
  purpúreo: "El cielo purpúreo del atardecer recortaba la silueta de los cipreses en la colina.",
  hibernar: "Algunos mamíferos de la montaña buscan cuevas profundas para hibernar durante el invierno.",
  cimitarra: "El guardia desenvainó una cimitarra de hoja curvada que brilló bajo la luna.",
  advenedizo: "Los viejos cortesanos miraban con recelo al advenedizo que acababa de llegar a palacio.",
  escenificar: "Decidieron escenificar la escena cumbre de la novela en el patio del claustro.",
  amargor: "Sintió un ligero amargor en el café que le devolvió el recuerdo de las mañanas de lluvia.",
  hilaridad: "Su ocurrencia espontánea provocó una sincera hilaridad entre todos los comensales.",
  soslayar: "Intentó soslayar el tema espinoso para no incomodar a los invitados a la cena.",
  displicente: "Hizo un ademán displicente con la mano, restándole valor al esfuerzo de su ayudante.",
  congoja: "Una honda congoja le oprimió el pecho al despedirse de su familia en el andén.",
  taciturno: "Era un viajero taciturno que prefería contemplar el paisaje antes que conversar.",
  zancada: "Avanzó a grandes zancadas por la galería para alcanzar al mensajero antes de que partiera.",
  baladí: "No tenía sentido enredarse en una disputa baladí cuando el tiempo apremiaba.",
  subyugar: "La belleza sublime de la cordillera logró subyugar la mirada de los caminantes.",
  parco: "Fue parco en sus palabras de agradecimiento, pero su mirada transmitía una gratitud sincera.",
  desparpajo: "Subió al escenario con un desparpajo admirable y se ganó de inmediato al público.",
  inacabado: "El óleo inacabado reposaba sobre el caballete cubierto por un lienzo protector.",
  sobresalto: "Un ruido seco tras la biblioteca le provocó un sobresalto en medio del silencio nocturno.",
  batacazo: "El candidato favorito sufrió un duro batacazo en el escrutinio final de votos.",
  pusilánime: "Nadie esperaba una respuesta tan pusilánime de quien siempre presumió de valentía.",
  tedio: "Las horas muertas en la sala de espera transcurrían en un pesado tedio.",
  sagaz: "El detective, siempre sagaz, descubrió la clave escondida en la última línea del diario.",
  ignominia: "Soportó la ignominia del destierro sin perder en ningún instante su dignidad.",
  torniquete: "El enfermero aplicó un torniquete improvisado sobre la herida para cortar la hemorragia.",
  suspicacia: "Observaba el trato amable de su rival con cierta suspicacia y recelo.",
  zarpar: "La carabela aguardaba el cambio favorable del viento para zarpar hacia altamar.",
  camisón: "La anciana se envolvió en su camisón de franela antes de acercarse a la ventana.",
  zozobra: "Los marineros vivieron horas de intensa zozobra mientras el oleaje azotaba la nave.",
  pescuezo: "El cisne estiró el pescuezo sobre el agua cristalina para alcanzar la orilla.",
  desazón: "Una extraña desazón lo acompañó durante toda la jornada sin saber bien por qué.",
  sosiego: "El murmullo del arroyo trajo por fin el sosiego que su mente fatigada necesitaba.",
  estupor: "Los testigos contemplaron el derrumbe con estupor, paralizados por la sorpresa.",
  vestigio: "Apenas quedaba un vestigio del antiguo puente de piedra destruido por la crecida.",
  vehemencia: "Defendió su tesis con una vehemencia que encendió el debate en toda la sala.",
  aflicción: "Sus ojos cansados revelaban una profunda aflicción que intentaba ocultar.",
  regocijo: "La noticia del regreso de la expedición causó un sincero regocijo en la comarca.",
  perplejo: "El profesor quedó perplejo ante la ingeniosa respuesta formulada por la alumna.",
  reproche: "No halló ningún reproche en sus palabras, sino un tono de afecto y comprensión.",
  apacible: "Pasearon durante horas por el sendero apacible que rodeaba la laguna.",
  desolación: "La desolación del desierto tras la tormenta transmitía una quietud sobrecogedora.",
  desdén: "Miró la propuesta con evidente desdén y la apartó a un lado sin responder.",
  recelo: "Aceptó la invitación con prudente recelo, temiendo alguna intención oculta.",
  destello: "Un fugaz destello en el horizonte indicó la posición de la torre de señales.",
  saborear: "Se detuvo a saborear lentamente aquel primer café humeante de la mañana.",
  efímero: "El éxito fue efímero, pues a los pocos meses nadie recordaba la novedad.",
  desmayo: "El intenso calor de la tarde provocó el desmayo de una de las vendedoras de flores.",
  conjetura: "Aquella hipótesis no era más que una conjetura carente de datos comprobados.",
  orfanato: "La fundación destinaba fondos anuales para mejorar las instalaciones del orfanato.",
  júbilo: "Gritos de júbilo estallaron en la plaza cuando el reloj dio las doce campanadas.",
  simular: "Supo simular sorpresa aunque conocía el secreto desde hacía varias semanas.",
  esquivar: "Logró esquivar la bicicleta a tiempo dando un ágil salto hacia la acera.",
  melancolía: "El tañido lejano de la campana sumió su mente en una dulce melancolía.",
  aislar: "Requirieron aislar el laboratorio para evitar interferencias acústicas del exterior.",
  cautela: "Abrió la pesada cancela con cautela para no despertar a los perros guardianes.",
  tarro: "Colocó la miel silvestre en un tarro de cristal sellado con cera virgen.",
  alejar: "El viento del norte ayudó a alejar los densos nubarrones de la bahía.",
  alboroto: "Los gorriones armaron un alegre alboroto entre las ramas floridas del cerezo.",
  anhelo: "Guardaba en su interior el íntimo anhelo de reencontrarse con su tierra natal.",
  asombro: "La agilidad del acróbata despertó el asombro unánime del graderío.",
  delirio: "La fiebre alta le provocó un delirio en el que confundía sombras con personas.",
  fatiga: "Tras cruzar el desfiladero a pie, la fatiga comenzó a entorpecer sus pasos.",
  ubicar: "El cartógrafo intentaba ubicar la posición del faro en el mapa antiguo de la costa.",
  desigual: "Los combatientes libraron un combate desigual contra fuerzas muy superiores.",
  percibir: "A través del cristal empañado creyó percibir la silueta de un viajero solitario.",
  inquietud: "Una sutil inquietud se dibujó en su semblante al escuchar las noticias de ultramar.",
  mudo: "El impacto de la revelación lo dejó mudo por varios instantes.",
  dilema: "Se debatía ante el dilema de revelar la verdad o salvaguardar la paz familiar.",
  // Contextos en inglés
  clandestine: "They held a clandestine meeting under the cover of night.",
  surreptitious: "She cast a surreptitious glance at the clock on the wall.",
  ephemeral: "The sunset painted the sky in ephemeral shades of gold.",
  blunder: "He realized his blunder as soon as the words left his mouth.",
  aloof: "He remained aloof from the crowd, observing everything in silence.",
  haughty: "Her haughty expression softened when she saw the children playing.",
  kindle: "A small spark was enough to kindle the dry branches in the fireplace.",
  fathom: "He could not fathom why she had made such a sudden decision.",
  ponder: "She sat by the window to ponder the strange letter she had received.",
  yearn: "On cold winter evenings, they would yearn for the warmth of summer.",
  solace: "Music was the only solace he could find during those difficult months.",
  uncanny: "She had an uncanny ability to guess exactly what people were thinking.",
};

// Contexto de muestra editorial para acompañar la palabra en la calibración.
export function calibrationSampleContext(lemma: string, language = "es"): string | null {
  const normalized = lemma.trim().toLowerCase();
  if (CALIBRATION_SAMPLE_CONTEXTS[normalized]) {
    return CALIBRATION_SAMPLE_CONTEXTS[normalized];
  }
  if (language === "en") {
    return CALIBRATION_SAMPLE_CONTEXTS[normalized] ?? null;
  }
  return null;
}

// Definición de respaldo cuando el catálogo no tenga acepción cargada.
export function calibrationFallbackDefinition(lemma: string, language = "es"): string | null {
  const normalized = lemma.trim().toLowerCase();
  if (language === "en") return CALIBRATION_DEFINITIONS_EN[normalized] ?? null;
  return CALIBRATION_DEFINITIONS_ES[normalized] ?? null;
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

