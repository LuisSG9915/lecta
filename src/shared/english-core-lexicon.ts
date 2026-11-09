import type { LexiconEntry } from "./lexicon";
import {
  CALIBRATION_DEFINITIONS_EN,
  calibrationBankZipf,
} from "./calibration-bank";
import { generateLookupCandidates } from "./word-form";

export interface EnglishCoreItem {
  definition: string;
  pos?: string;
  translation?: string;
}

/**
 * Diccionario base offline de supervivencia inglés-español con ~2279 palabras
 * narrativas y literarias de alta frecuencia en novelas en inglés.
 */
export const ENGLISH_CORE_LEXICON: Record<string, EnglishCoreItem> = {
  // Palabras destacadas en el objetivo y narrativa frecuente
  linger: {
    pos: "verbo",
    translation: "demorarse / persistir",
    definition: "Quedarse más tiempo de lo necesario en un lugar o resistirse a desaparecer.",
  },
  reluctant: {
    pos: "adjetivo",
    translation: "renuente / reacio",
    definition: "Poco dispuesto, que muestra resistencia o vacilación para hacer algo.",
  },
  glimpse: {
    pos: "sustantivo",
    translation: "vistazo / destello fugaz",
    definition: "Visión rápida, breve o incompleta de algo o alguien.",
  },
  subtle: {
    pos: "adjetivo",
    translation: "sutil / tenue",
    definition: "Delicado, tenue o difícil de percibir a simple vista.",
  },
  dreary: {
    pos: "adjetivo",
    translation: "sombrío / lúgubre",
    definition: "Deprimente, triste o monótono, falto de luz o alegría.",
  },
  fathom: {
    pos: "verbo",
    translation: "comprender / desentrañar",
    definition: "Penetrar o entender el sentido profundo o misterioso de algo.",
  },
  eloquent: {
    pos: "adjetivo",
    translation: "elocuente / expresivo",
    definition: "Que habla o se expresa con fluidez, elegancia y fuerza persuasiva.",
  },
  upheaval: {
    pos: "sustantivo",
    translation: "trastorno / convulsión",
    definition: "Cambio radical, repentino o violento en una situación o sociedad.",
  },
  ephemeral: {
    pos: "adjetivo",
    translation: "efímero / pasajero",
    definition: "Que dura un periodo de tiempo muy breve y fugaz.",
  },
  ubiquitous: {
    pos: "adjetivo",
    translation: "oblicuo / omnipresente",
    definition: "Que parece estar presente en todas partes al mismo tiempo.",
  },
  arduous: {
    pos: "adjetivo",
    translation: "arduo / penoso",
    definition: "Muy difícil, agotador o que requiere un gran esfuerzo sostenido.",
  },
  ostentatious: {
    pos: "adjetivo",
    translation: "ostentoso / presumido",
    definition: "Que hace exhibición vana y exagerada de riquezas o cualidades.",
  },
  grim: {
    pos: "adjetivo",
    translation: "sombrío / severo",
    definition: "Sin esperanza, severo, implacable o amenazante en apariencia.",
  },
  whisper: {
    pos: "verbo",
    translation: "susurrar",
    definition: "Hablar en voz muy baja o emitir un sonido suave como el viento.",
  },
  shadow: {
    pos: "sustantivo",
    translation: "sombra",
    definition: "Oscuridad o silueta proyectada al bloquear la luz.",
  },
  sorrow: {
    pos: "sustantivo",
    translation: "pesar / tristeza profunda",
    definition: "Dolor anímico intenso causado por una pérdida o aflicción.",
  },
  oath: {
    pos: "sustantivo",
    translation: "juramento / voto",
    definition: "Promesa solemne hecha invocando a algo sagrado o por honor.",
  },
  realm: {
    pos: "sustantivo",
    translation: "reino / dominio",
    definition: "Territorio gobernado por un monarca o ámbito de conocimiento.",
  },
  blade: {
    pos: "sustantivo",
    translation: "hoja / espada",
    definition: "Parte cortante o afilada de un arma o herramienta, o la espada misma.",
  },
  dread: {
    pos: "sustantivo",
    translation: "pavor / temor intenso",
    definition: "Miedo profundo y angustioso ante una amenaza inminente.",
  },
  fierce: {
    pos: "adjetivo",
    translation: "feroz / encarnizado",
    definition: "Agresivo, salvaje, intenso o implacable.",
  },
  solemn: {
    pos: "adjetivo",
    translation: "solemne / grave",
    definition: "Serio, formal y digno, que inspira respeto o reverencia.",
  },
  weary: {
    pos: "adjetivo",
    translation: "exhausto / fatigado",
    definition: "Físicamente o mentalmente cansado por esfuerzo prolongado.",
  },
  beneath: {
    pos: "preposición",
    translation: "debajo de / bajo",
    definition: "En un lugar inferior a algo o cubierto por ello.",
  },
  wander: {
    pos: "verbo",
    translation: "vagar / deambular",
    definition: "Caminar sin rumbo fijo o perderse en pensamientos.",
  },
  gaze: {
    pos: "verbo",
    translation: "mirar fijamente / contemplar",
    definition: "Observar atentamente y con fijeza por asombro, admiración o distracción.",
  },
  sigh: {
    pos: "verbo",
    translation: "suspirar",
    definition: "Exhalar audiblemente en señal de alivio, tristeza o cansancio.",
  },
  tremble: {
    pos: "verbo",
    translation: "temblar",
    definition: "Agitarse con movimientos rápidos e involuntarios por frío, miedo o emoción.",
  },
  dagger: {
    pos: "sustantivo",
    translation: "daga / puñal",
    definition: "Arma blanca corta de hoja puntiaguda y afilada por ambos lados.",
  },
  fate: {
    pos: "sustantivo",
    translation: "destino / sino",
    definition: "Poder sobrenatural inevitable que rige los acontecimientos de la vida.",
  },
  grief: {
    pos: "sustantivo",
    translation: "duelo / pena profunda",
    definition: "Sufrimiento profundo y desconsuelo por la muerte de alguien o tragedia.",
  },
  wrath: {
    pos: "sustantivo",
    translation: "ira / cólera",
    definition: "Enojo extremo, furia destructiva o indignación violenta.",
  },
  kin: {
    pos: "sustantivo",
    translation: "parientes / linaje",
    definition: "Familia, parientes consanguíneos o clan de origen.",
  },
  foe: {
    pos: "sustantivo",
    translation: "enemigo / adversario",
    definition: "Adversario hostil en una contienda, batalla o conflicto.",
  },
  abyss: {
    pos: "sustantivo",
    translation: "abismo",
    definition: "Profundidad inmensa, insondable y peligrosa.",
  },
  anguish: {
    pos: "sustantivo",
    translation: "angustia",
    definition: "Dolor físico o mental agudo y desesperante.",
  },
  beacon: {
    pos: "sustantivo",
    translation: "faro / almenara",
    definition: "Luz o señal visible usada para guiar, alertar o inspirar esperanza.",
  },
  bleak: {
    pos: "adjetivo",
    translation: "desolado / inhóspito",
    definition: "Frío, desapacible, sin vegetación ni esperanza.",
  },
  boundless: {
    pos: "adjetivo",
    translation: "ilimitado / infinito",
    definition: "Que no tiene fronteras, límites ni fin aparente.",
  },
  cavern: {
    pos: "sustantivo",
    translation: "caverna / cueva",
    definition: "Cueva grande y profunda, a menudo subterránea.",
  },
  cinder: {
    pos: "sustantivo",
    translation: "ceniza / brasa",
    definition: "Trozo de carbón o madera que ha ardido sin llama viva.",
  },
  crest: {
    pos: "sustantivo",
    translation: "cresta / cima",
    definition: "Punto más alto de una montaña, colina u ola.",
  },
  dawn: {
    pos: "sustantivo",
    translation: "amanecer / alba",
    definition: "Primera luz del día antes de que salga el sol, o inicio de algo.",
  },
  dusk: {
    pos: "sustantivo",
    translation: "atardecer / crepúsculo",
    definition: "Periodo del día cuando cae el sol y empieza la noche.",
  },
  embers: {
    pos: "sustantivo",
    translation: "ascuas / rescoldos",
    definition: "Restos encendidos de un fuego que ya no tiene llamas vivas.",
  },
  fathomless: {
    pos: "adjetivo",
    translation: "insondable",
    definition: "Tan profundo que es imposible medirlo o comprenderlo.",
  },
  flicker: {
    pos: "verbo",
    translation: "parpadear / titilar",
    definition: "Brillar o arder con una luz inestable y trémula.",
  },
  frenzy: {
    pos: "sustantivo",
    translation: "frenesí / delirio",
    definition: "Estado de gran excitación, descontrol o furor desmedido.",
  },
  frost: {
    pos: "sustantivo",
    translation: "escarcha / helada",
    definition: "Capa fina de hielo que se forma por la congelación del rocío.",
  },
  furrow: {
    pos: "sustantivo",
    translation: "surco",
    definition: "Zanja estrecha en la tierra o arruga marcada en la frente.",
  },
  ghastly: {
    pos: "adjetivo",
    translation: "espeluznante / cadavérico",
    definition: "Que causa horror y espanto o tiene aspecto fantasmal y pálido.",
  },
  shimmer: {
    pos: "verbo",
    translation: "brillar tenuemente",
    definition: "Reflejar una luz trémula, suave y ondulante.",
  },
  shudder: {
    pos: "verbo",
    translation: "estremecerse",
    definition: "Temblar intensamente de horror, asco o frío repentino.",
  },
  slumber: {
    pos: "sustantivo",
    translation: "sueño / letargo",
    definition: "Estado de descanso apacible o reposo prolongado.",
  },
  smother: {
    pos: "verbo",
    translation: "asfixiar / sofocar",
    definition: "Impedir la respiración o apagar un fuego cubriéndolo por completo.",
  },
  shroud: {
    pos: "sustantivo",
    translation: "mortaja / velo",
    definition: "Cosa que cubre u oculta algo, o lienzo para envolver difuntos.",
  },
  stealthy: {
    pos: "adjetivo",
    translation: "sigiloso / furtivo",
    definition: "Que actúa en silencio y con disimulo para no ser descubierto.",
  },
  stride: {
    pos: "sustantivo",
    translation: "zancada / paso firme",
    definition: "Paso largo, decidido y enérgico al caminar.",
  },
  swoon: {
    pos: "verbo",
    translation: "desmayarse",
    definition: "Perder momentáneamente el conocimiento por debilidad o impresión.",
  },
  twilight: {
    pos: "sustantivo",
    translation: "crepúsculo / penumbra",
    definition: "Claridad suave y difusa entre la puesta del sol y la noche.",
  },
  uncanny: {
    pos: "adjetivo",
    translation: "inquietante / sobrenatural",
    definition: "Extraño, misterioso y que produce una vaga sensación de inquietud.",
  },
  vanish: {
    pos: "verbo",
    translation: "desvanecerse / desaparecer",
    definition: "Dejar de verse de forma rápida, mágica o total.",
  },
  veil: {
    pos: "sustantivo",
    translation: "velo",
    definition: "Tela fina y transparente para tapar algo, o aquello que nubla la visión.",
  },
  vigil: {
    pos: "sustantivo",
    translation: "vigilia / vela",
    definition: "Periodo en que se permanece despierto cuidando o custodiando algo.",
  },
  wither: {
    pos: "verbo",
    translation: "marchitarse",
    definition: "Secarse y perder el vigor, la frescura o la lozanía.",
  },
  yield: {
    pos: "verbo",
    translation: "ceder / rendirse",
    definition: "Dar paso, someterse a la fuerza o producir fruto.",
  },
  yearn: {
    pos: "verbo",
    translation: "anhelar",
    definition: "Desear algo apasionadamente y con nostalgia o dolor.",
  },
  zeal: {
    pos: "sustantivo",
    translation: "celo / fervor",
    definition: "Gran entusiasmo, devoción y energía puestos en una causa.",
  },
  wound: {
    pos: "sustantivo",
    translation: "herida",
    definition: "Lesión física o herida moral producida en el alma.",
  },
  weep: {
    pos: "verbo",
    translation: "llorar",
    definition: "Derramar lágrimas en señal de dolor, desconsuelo o emoción.",
  },
  wistful: {
    pos: "adjetivo",
    translation: "melancólico / añorante",
    definition: "Pensativo con un anhelo teñido de tristeza nostálgica.",
  },
  wretched: {
    pos: "adjetivo",
    translation: "desdichado / miserable",
    definition: "Muy infeliz, desgraciado o en un estado deplorable.",
  },
  vile: {
    pos: "adjetivo",
    translation: "vil / despreciable",
    definition: "Moralmente despreciable, indigno y abominable.",
  },
  venom: {
    pos: "sustantivo",
    translation: "veneno / ponzoña",
    definition: "Sustancia tóxica o malicia amarga y ponzoñosa.",
  },
  turmoil: {
    pos: "sustantivo",
    translation: "torbellino / conmoción",
    definition: "Gran desorden, caos, confusión o agitación interior.",
  },
  trample: {
    pos: "verbo",
    translation: "pisotear",
    definition: "Pisar pesadamente causando daño o destrucción.",
  },
  tread: {
    pos: "verbo",
    translation: "pisar / andar",
    definition: "Poner el pie sobre algo al caminar.",
  },
  severed: {
    pos: "adjetivo",
    translation: "cortado / amputado",
    definition: "Separado tajantemente de un solo golpe o corte limpio.",
  },
  savage: {
    pos: "adjetivo",
    translation: "salvaje / brutal",
    definition: "Feroz, primitivo y carente de piedad o civilización.",
  },
  rustle: {
    pos: "sustantivo",
    translation: "crujido suave / susurro",
    definition: "Ruido sordo producido por el roce de hojas secas o telas.",
  },
  ruthless: {
    pos: "adjetivo",
    translation: "despiadado / implacable",
    definition: "Que no muestra compasión, piedad ni remordimiento.",
  },
  sanctuary: {
    pos: "sustantivo",
    translation: "santuario / refugio",
    definition: "Lugar sagrado o sitio seguro de protección y amparo.",
  },
  scorn: {
    pos: "sustantivo",
    translation: "desdén / desprecio",
    definition: "Sentimiento y actitud de rechazo orgulloso hacia algo o alguien.",
  },
  scowl: {
    pos: "verbo",
    translation: "fruncir el ceño",
    definition: "Hacer un gesto adusto de desagrado o enfado con la mirada.",
  },
  sear: {
    pos: "verbo",
    translation: "abrasar / chamuscar",
    definition: "Quemar intensamente la superficie de algo con calor ardiente.",
  },
  seize: {
    pos: "verbo",
    translation: "apoderarse / agarrar",
    definition: "Tomar algo con fuerza, rapidez o de forma repentina.",
  },
  shatter: {
    pos: "verbo",
    translation: "hacerse añicos",
    definition: "Romperse en pedazos pequeños con violencia o destruir esperanzas.",
  },
  slay: {
    pos: "verbo",
    translation: "matar / liquidar",
    definition: "Quitar la vida violentamente, especialmente en combate.",
  },
  smirk: {
    pos: "sustantivo",
    translation: "sonrisa burlona",
    definition: "Sonrisa afectada, arrogante o de satisfacción maliciosa.",
  },
  smolder: {
    pos: "verbo",
    translation: "arder sin llama",
    definition: "Consumirse lentamente sin producir llamas vivas, o hervir de ira contenida.",
  },
  snare: {
    pos: "sustantivo",
    translation: "trampa / lazo",
    definition: "Trampa para apresar animales o celada engañosa.",
  },
  snarl: {
    pos: "verbo",
    translation: "gruñir",
    definition: "Mostrar los dientes y emitir un sonido amenazador de furia.",
  },
  spear: {
    pos: "sustantivo",
    translation: "lanza",
    definition: "Arma compuesta de un asta larga de madera con punta afilada.",
  },
  splinter: {
    pos: "sustantivo",
    translation: "astilla",
    definition: "Fragmento pequeño, largo y afilado de madera, vidrio o hueso.",
  },
  spite: {
    pos: "sustantivo",
    translation: "despecho / rencor",
    definition: "Deseo malévolo de herir, molestar o frustrar a alguien.",
  },
  stalk: {
    pos: "verbo",
    translation: "acechar",
    definition: "Seguir sigilosamente los pasos de una presa o persona.",
  },
  stout: {
    pos: "adjetivo",
    translation: "robusto / corpulento",
    definition: "Fuerte, grueso, sólido y de complexión firme.",
  },
  strife: {
    pos: "sustantivo",
    translation: "conflicto / contienda",
    definition: "Lucha amarga, discordia o enfrentamiento violento entre facciones.",
  },
  sullen: {
    pos: "adjetivo",
    translation: "huraño / hosco",
    definition: "Malhumorado, sombrío y poco dispuesto a conversar.",
  },
  summit: {
    pos: "sustantivo",
    translation: "cumbre / cima",
    definition: "Punto más elevado de una cumbre o montaña.",
  },
  summon: {
    pos: "verbo",
    translation: "convocar / invocar",
    definition: "Llamar con autoridad para que alguien se presente o reunir fuerzas.",
  },
  sunder: {
    pos: "verbo",
    translation: "desgajar / separar",
    definition: "Separar violentamente o partir en dos.",
  },
  surge: {
    pos: "verbo",
    translation: "surgir / agitarse",
    definition: "Elevarse repentinamente como una ola o crecer con fuerza.",
  },
  sworn: {
    pos: "adjetivo",
    translation: "jurado",
    definition: "Comprometido bajo juramento solemne o declarado irrevocablemente.",
  },
  taint: {
    pos: "verbo",
    translation: "contaminar / manchar",
    definition: "Corromper, ensuciar o degradar la pureza o reputación de algo.",
  },
  talon: {
    pos: "sustantivo",
    translation: "garra",
    definition: "Uña afilada y curvada de un ave de rapiña.",
  },
  tavern: {
    pos: "sustantivo",
    translation: "taberna",
    definition: "Establecimiento popular donde se sirve bebida y comida rústica.",
  },
  thaw: {
    pos: "verbo",
    translation: "descongelar / deshelar",
    definition: "Derretirse el hielo o la nieve al subir la temperatura.",
  },
  throng: {
    pos: "sustantivo",
    translation: "muchedumbre / gentío",
    definition: "Gran multitud apretada de personas reunidas en un lugar.",
  },
  toil: {
    pos: "sustantivo",
    translation: "fatiga / arduo trabajo",
    definition: "Trabajo duro, agotador y continuo.",
  },
  tomb: {
    pos: "sustantivo",
    translation: "tumba / sepulcro",
    definition: "Monumento o fosa donde yacen los restos de un difunto.",
  },
  torment: {
    pos: "sustantivo",
    translation: "tormento / suplicio",
    definition: "Gran sufrimiento físico, angustia mental o dolor agudo.",
  },
  treacherous: {
    pos: "adjetivo",
    translation: "traicionero / peligroso",
    definition: "Falso, desleal o aparentemente seguro pero lleno de peligros ocultos.",
  },
  tremor: {
    pos: "sustantivo",
    translation: "temblor",
    definition: "Sacudida involuntaria o ligero temblor de tierra.",
  },
  tumult: {
    pos: "sustantivo",
    translation: "tumulto / alboroto",
    definition: "Gran confusión, griterío y desorden ocasionado por una multitud.",
  },
  tyrant: {
    pos: "sustantivo",
    translation: "tirano",
    definition: "Gobernante despótico y cruel que abusa de su poder.",
  },
  unravel: {
    pos: "verbo",
    translation: "desentrañar / desenredar",
    definition: "Deshacer un tejido o resolver un enigma complejo.",
  },
  valiant: {
    pos: "adjetivo",
    translation: "valeroso / bravo",
    definition: "Que actúa con heroísmo, coraje y valentía indomable.",
  },
  vault: {
    pos: "sustantivo",
    translation: "bóveda / cripta",
    definition: "Estructura curva del techo o cámara subterránea segura.",
  },
  vestige: {
    pos: "sustantivo",
    translation: "vestigio / rastro",
    definition: "Huella o resto que queda de algo antiguo que ha desaparecido.",
  },
  visage: {
    pos: "sustantivo",
    translation: "semblante / rostro",
    definition: "Aspecto o expresión de la cara de una persona.",
  },
  vow: {
    pos: "sustantivo",
    translation: "voto / promesa",
    definition: "Promesa solemne dedicada a un propósito de honor.",
  },
  wage: {
    pos: "verbo",
    translation: "librar (batalla)",
    definition: "Llevar a cabo una guerra, campaña o combate continuado.",
  },
  wail: {
    pos: "verbo",
    translation: "gemir / lamentarse",
    definition: "Emitir un llanto largo y agudo cargado de angustia.",
  },
  warden: {
    pos: "sustantivo",
    translation: "guardián / custodio",
    definition: "Persona encargada de vigilar, gobernar o custodiar un recinto o frontera.",
  },
  wary: {
    pos: "adjetivo",
    translation: "cauteloso / precavido",
    definition: "Alerta y desconfiado ante posibles engaños o peligros.",
  },
  waver: {
    pos: "verbo",
    translation: "vacilar / titubear",
    definition: "Dudar en una decisión o perder firmeza en una postura.",
  },
  woe: {
    pos: "sustantivo",
    translation: "desdicha / aflicción",
    definition: "Gran sufrimiento, desgracia o aflicción que abruma el corazón.",
  },
  clandestine: {
    pos: "adjetivo",
    translation: "clandestino / secreto",
    definition: "Hecho en secreto o de forma oculta a las autoridades.",
  },
  surreptitious: {
    pos: "adjetivo",
    translation: "subrepticio / furtivo",
    definition: "Obtenido o realizado con disimulo y a escondidas.",
  },
  aloof: {
    pos: "adjetivo",
    translation: "distante / apartado",
    definition: "Reservado, frío o poco comunicativo con los demás.",
  },
  haughty: {
    pos: "adjetivo",
    translation: "altivo / arrogante",
    definition: "Orgulloso y con desdén despectivo hacia el prójimo.",
  },
  kindle: {
    pos: "verbo",
    translation: "encender / avivar",
    definition: "Prender fuego o despertar un sentimiento intenso en el alma.",
  },
  ponder: {
    pos: "verbo",
    translation: "meditar / sopesar",
    definition: "Pensar detenidamente y con calma sobre un asunto delicado.",
  },
  solace: {
    pos: "sustantivo",
    translation: "consuelo / alivio",
    definition: "Alivio y consuelo en medio del dolor o la soledad.",
  },
  awkward: {
    pos: "adjetivo",
    translation: "incómodo / torpe",
    definition: "Falto de naturalidad, embarazoso o difícil de manejar.",
  },
  bewilder: {
    pos: "verbo",
    translation: "desconcertar / anonadar",
    definition: "Confundir o asombrar por completo a alguien dejándolo sin respuesta.",
  },
  clumsy: {
    pos: "adjetivo",
    translation: "torpe / tosco",
    definition: "Falto de destreza física o de tacto en el trato social.",
  },
  stubborn: {
    pos: "adjetivo",
    translation: "obstinado / terco",
    definition: "Que mantiene firmemente su postura sin escuchar razones.",
  },
  gloomy: {
    pos: "adjetivo",
    translation: "sombrío / taciturno",
    definition: "Poco iluminado o con un estado de ánimo cargado de pesadumbre.",
  },
  reckless: {
    pos: "adjetivo",
    translation: "temerario / imprudente",
    definition: "Que actúa sin pensar en las consecuencias ni en el peligro.",
  },
  thrive: {
    pos: "verbo",
    translation: "prosperar / florecer",
    definition: "Crecer con fuerza, vigor y éxito en un entorno propicio.",
  },
  scarce: {
    pos: "adjetivo",
    translation: "escaso",
    definition: "Que existe en poca cantidad o resulta difícil de encontrar.",
  },
  tedious: {
    pos: "adjetivo",
    translation: "tedioso / monótono",
    definition: "Aburrido, pesado y que cansa por su excesiva lentitud.",
  },
  delight: {
    pos: "sustantivo",
    translation: "deleite / gozo",
    definition: "Sentimiento de gran placer, alegría o satisfacción exquisita.",
  },
  harsh: {
    pos: "adjetivo",
    translation: "áspero / severo",
    definition: "Desagradable a los sentidos, implacable o riguroso en el trato.",
  },
  bargain: {
    pos: "sustantivo",
    translation: "trato / ganga",
    definition: "Acuerdo beneficioso o compra conseguida a precio ventajoso.",
  },
  praise: {
    pos: "sustantivo",
    translation: "elogio / alabanza",
    definition: "Palabras que reconocen el mérito, virtud o bondad de alguien.",
  },
  venture: {
    pos: "verbo",
    translation: "aventurarse / osar",
    definition: "Atreverse a emprender una acción que conlleva riesgo.",
  },
  conceal: {
    pos: "verbo",
    translation: "ocultar / disimular",
    definition: "Tapar algo para que no se vea o guardar un secreto celosamente.",
  },
  scatter: {
    pos: "verbo",
    translation: "esparcir / dispersar",
    definition: "Arrojar o distribuir cosas en distintas direcciones.",
  },
  damp: {
    pos: "adjetivo",
    translation: "húmedo",
    definition: "Ligeramente empapado o cubierto de rocío.",
  },
  afraid: {
    pos: "adjetivo",
    translation: "asustado / temeroso",
    definition: "Que siente miedo ante un peligro real o imaginario.",
  },
  narrow: {
    pos: "adjetivo",
    translation: "estrecho / angosto",
    definition: "De poca anchura o paso reducido.",
  },
  smooth: {
    pos: "adjetivo",
    translation: "liso / suave",
    definition: "Sin asperezas ni arrugas al tacto, o fluido sin tropiezos.",
  },
  proud: {
    pos: "adjetivo",
    translation: "orgulloso",
    definition: "Que tiene satisfacción por sus propios actos o noble estima.",
  },
  lonely: {
    pos: "adjetivo",
    translation: "solitario / desamparado",
    definition: "Triste por encontrarse privado de compañía o afecto.",
  },
  afford: {
    pos: "verbo",
    translation: "permitirse / costear",
    definition: "Tener recursos económicos o tiempo suficiente para algo.",
  },
  sudden: {
    pos: "adjetivo",
    translation: "repentino / súbito",
    definition: "Que ocurre de forma imprevista y en un instante.",
  },
  hollow: {
    pos: "adjetivo",
    translation: "hueco / vacío",
    definition: "Que tiene un espacio vacío en su interior o carece de sinceridad.",
  },
  gentle: {
    pos: "adjetivo",
    translation: "apacible / bondadoso",
    definition: "Tierno, moderado y que no causa daño ni aspereza.",
  },
  brave: {
    pos: "adjetivo",
    translation: "valiente / intrépido",
    definition: "Dispuesto a afrontar el miedo o el dolor con entereza.",
  },
  crowd: {
    pos: "sustantivo",
    translation: "multitud",
    definition: "Gran número de personas congregadas en un mismo lugar.",
  },
  threat: {
    pos: "sustantivo",
    translation: "amenaza",
    definition: "Advertencia o señal de un daño que se avecina.",
  },
  danger: {
    pos: "sustantivo",
    translation: "peligro",
    definition: "Circunstancia en que es posible que ocurra una desgracia.",
  },
  trouble: {
    pos: "sustantivo",
    translation: "dificultad / problema",
    definition: "Situación penosa, conflicto o molestia imprevista.",
  },
  friend: {
    pos: "sustantivo",
    translation: "amigo",
    definition: "Persona con la que se mantiene una relación de afecto y confianza mutua.",
  },
  clever: {
    pos: "adjetivo",
    translation: "listo / ingenioso",
    definition: "De mente despierta, rápida y hábil para hallar soluciones.",
  },
  quiet: {
    pos: "adjetivo",
    translation: "silencioso / tranquilo",
    definition: "Libre de ruidos estrepitosos o agitaciones.",
  },
  garden: {
    pos: "sustantivo",
    translation: "jardín",
    definition: "Terreno donde se cultivan plantas y flores para recreo.",
  },
  silver: {
    pos: "sustantivo",
    translation: "plata",
    definition: "Metal noble brillante o brillo grisáceo de la luna.",
  },
  winter: {
    pos: "sustantivo",
    translation: "invierno",
    definition: "Estación más fría del año caracterizada por heladas y noches largas.",
  },
  river: {
    pos: "sustantivo",
    translation: "río",
    definition: "Corriente de agua continua que desemboca en otro río o mar.",
  },
  summer: {
    pos: "sustantivo",
    translation: "verano",
    definition: "Época más calurosa del año con días largos y sol radiante.",
  },
  father: {
    pos: "sustantivo",
    translation: "padre",
    definition: "Progenitor varón o patriarca de una familia.",
  },
  ancestor: {
    pos: "sustantivo",
    translation: "antepasado / ancestro",
    definition: "Ascendiente familiar de una estirpe o linaje pretérito.",
  },
  banish: {
    pos: "verbo",
    translation: "desterrar / expulsar",
    definition: "Obligar a alguien a abandonar su patria o alejar un pensamiento.",
  },
  beckon: {
    pos: "verbo",
    translation: "hacer señas / llamar",
    definition: "Llamar a alguien con gestos de la mano o atraer con la mirada.",
  },
  bestow: {
    pos: "verbo",
    translation: "otorgar / conferir",
    definition: "Conceder un honor, regalo o don valioso con formalidad.",
  },
  captive: {
    pos: "sustantivo",
    translation: "cautivo / prisionero",
    definition: "Persona privada de libertad por la fuerza de un enemigo.",
  },
  chasm: {
    pos: "sustantivo",
    translation: "grieta / abismo",
    definition: "Abertura profunda y escarpada en la tierra o abismo insalvable.",
  },
  cloak: {
    pos: "sustantivo",
    translation: "capa / manto",
    definition: "Prenda holgada sin mangas que envuelve el cuerpo o manto que oculta algo.",
  },
  crimson: {
    pos: "adjetivo",
    translation: "carmesí / rojo encendido",
    definition: "Rojo profundo y vivo semejante al color de la sangre arterial.",
  },
  curse: {
    pos: "sustantivo",
    translation: "maldición",
    definition: "Voto o conjuro maligno que invoca la desgracia sobre alguien.",
  },
  deceive: {
    pos: "verbo",
    translation: "engañar / burlar",
    definition: "Hacer creer como verdadero algo falso induciendo a error.",
  },
  defile: {
    pos: "verbo",
    translation: "profanar / manchar",
    definition: "Mancillar la pureza, santidad o nobleza de un lugar o memoria.",
  },
  descend: {
    pos: "verbo",
    translation: "descender / bajar",
    definition: "Bajar de un lugar alto a otro inferior o abalanzarse sobre algo.",
  },
  despair: {
    pos: "sustantivo",
    translation: "desesperación",
    definition: "Pérdida absoluta de toda esperanza o consuelo humano.",
  },
  ember: {
    pos: "sustantivo",
    translation: "brasa / ascua",
    definition: "Trozo de carbón o leña que arde en rescoldo sin llama viva.",
  },
  endure: {
    pos: "verbo",
    translation: "soportar / perdurar",
    definition: "Resistir el sufrimiento con paciencia o mantenerse firme con el tiempo.",
  },
  exile: {
    pos: "sustantivo",
    translation: "exilio / desierro",
    definition: "Separación forzosa de una persona de su tierra natal.",
  },
  fade: {
    pos: "verbo",
    translation: "desvanecerse / palidecer",
    definition: "Perder gradualmente intensidad, brillo, color o fuerza vital.",
  },
  faint: {
    pos: "adjetivo",
    translation: "débil / tenue",
    definition: "Apenas perceptible para la vista, el oído o de fuerzas escasas.",
  },
  forsake: {
    pos: "verbo",
    translation: "abandonar / desamparar",
    definition: "Dejar a alguien en la soledad o renunciar a una causa leal.",
  },
  fortress: {
    pos: "sustantivo",
    translation: "fortaleza / baluarte",
    definition: "Edificación fortificada inexpugnable destinada a la defensa.",
  },
  fury: {
    pos: "sustantivo",
    translation: "furia / cólera",
    definition: "Ira violenta, arrebato salvaje o violencia desatada de los elementos.",
  },
  glimmer: {
    pos: "sustantivo",
    translation: "vislumbre / destello tenue",
    definition: "Luz débil e intermitente o leve indicio de esperanza.",
  },
  gloom: {
    pos: "sustantivo",
    translation: "penumbra / tristeza",
    definition: "Oscuridad melancólica o pesadumbre que abruma el ánimo.",
  },
  haven: {
    pos: "sustantivo",
    translation: "refugio / puerto seguro",
    definition: "Lugar seguro de descanso y protección contra el peligro.",
  },
  hearth: {
    pos: "sustantivo",
    translation: "hogar / fogón",
    definition: "Lugar del fuego en la casa, símbolo de calor familiar y abrigo.",
  },
  heed: {
    pos: "verbo",
    translation: "hacer caso / prestar atención",
    definition: "Atender a un consejo, advertencia o mandato prudente.",
  },
  heir: {
    pos: "sustantivo",
    translation: "heredero",
    definition: "Persona destinada por linaje o ley a recibir un título o posesión.",
  },
  ignite: {
    pos: "verbo",
    translation: "encender / prender fuego",
    definition: "Hacer arder un combustible o encender una pasión ardiente.",
  },
  illusion: {
    pos: "sustantivo",
    translation: "ilusión / espejismo",
    definition: "Percepción engañosa que no corresponde a la realidad tangible.",
  },
  invoke: {
    pos: "verbo",
    translation: "invocar",
    definition: "Llamar a un poder superior, ley o espíritu en ayuda.",
  },
  keen: {
    pos: "adjetivo",
    translation: "agudo / afilado",
    definition: "De filo penetrante, percepción lúcida o dolor punzante.",
  },
  lineage: {
    pos: "sustantivo",
    translation: "linaje / estirpe",
    definition: "Ascendencia genealógica y noble sucesión de una familia.",
  },
  mantle: {
    pos: "sustantivo",
    translation: "manto / capa",
    definition: "Manto que cubre los hombros o envoltura protectora simbólica.",
  },
  mourn: {
    pos: "verbo",
    translation: "hacer duelo / llorar",
    definition: "Sentir y manifestar tristeza profunda por la muerte de alguien.",
  },
  mutter: {
    pos: "verbo",
    translation: "murmurar / mascullar",
    definition: "Hablar entre dientes con queja contenida o sonido sordo.",
  },
  noble: {
    pos: "adjetivo",
    translation: "noble / ilustre",
    definition: "De alto rango, preclaro linaje o generosidad de alma.",
  },
  obscure: {
    pos: "adjetivo",
    translation: "oscuro / recóndito",
    definition: "Difícil de percibir, comprender o apartado del mundo visible.",
  },
  ordeal: {
    pos: "sustantivo",
    translation: "dura prueba / calvario",
    definition: "Experiencia sumamente dolorosa, amarga o rigurosa.",
  },
  perilous: {
    pos: "adjetivo",
    translation: "peligroso / arriesgado",
    definition: "Lleno de riesgos graves que amenazan la integridad física o moral.",
  },
  perish: {
    pos: "verbo",
    translation: "perecer / sucumbir",
    definition: "Dejar de existir, morir violentamente o consumirse en la nada.",
  },
  pledge: {
    pos: "sustantivo",
    translation: "promesa solemne",
    definition: "Compromiso de honor o fianza dada en garantía de fidelidad.",
  },
  plight: {
    pos: "sustantivo",
    translation: "difícil situación / apuro",
    definition: "Estado lamentable, desdichado o situación de gran aprieto.",
  },
  plunder: {
    pos: "sustantivo",
    translation: "saqueo / botín",
    definition: "Bienes arrebatados al enemigo en guerra mediante pillaje.",
  },
  prevail: {
    pos: "verbo",
    translation: "prevalecer / triunfar",
    definition: "Imponerse con superioridad o mantenerse victorioso ante la adversidad.",
  },
  quiver: {
    pos: "verbo",
    translation: "temblar / estremecerse",
    definition: "Agitarse con temblor involuntario por frío, miedo o emoción.",
  },
  radiance: {
    pos: "sustantivo",
    translation: "resplandor / fulgor",
    definition: "Brillo deslumbrante y luminoso emitido por un cuerpo celeste.",
  },
  rebel: {
    pos: "sustantivo",
    translation: "rebelde / insurgente",
    definition: "Persona que se subleva contra una autoridad o tirano opresor.",
  },
  reckon: {
    pos: "verbo",
    translation: "estimar / considerar",
    definition: "Calcular mentalmente o formarse un juicio reflexivo sobre algo.",
  },
  relic: {
    pos: "sustantivo",
    translation: "reliquia / vestigio",
    definition: "Objeto sagrado conservado del pasado o resto venerable.",
  },
  renounce: {
    pos: "verbo",
    translation: "renunciar",
    definition: "Abandonar voluntariamente un derecho, creencia o pretensión.",
  },
  repel: {
    pos: "verbo",
    translation: "repeler / rechazar",
    definition: "Hacer retroceder con fuerza a un atacante o causar aversión.",
  },
  resent: {
    pos: "verbo",
    translation: "guardar rencor",
    definition: "Sentir enfado o indignación amarga por una afrenta o trato injusto.",
  },
  resolute: {
    pos: "adjetivo",
    translation: "resuelto / decidido",
    definition: "Firme en sus propósitos y sin temor ante las dificultades.",
  },
  rival: {
    pos: "sustantivo",
    translation: "rival / adversario",
    definition: "Persona que compite con otra por el mismo objetivo o honor.",
  },
  rumor: {
    pos: "sustantivo",
    translation: "rumor / murmullo",
    definition: "Noticia difusa que corre entre la gente sin confirmación certera.",
  },
  scent: {
    pos: "sustantivo",
    translation: "aroma / rastro oloroso",
    definition: "Fragancia característica o pista que sigue un sabueso.",
  },
  sinister: {
    pos: "adjetivo",
    translation: "siniestro / amenazador",
    definition: "Que presagia desdichas o infunde sospecha de maldad oculta.",
  },
  spark: {
    pos: "sustantivo",
    translation: "chispa / centella",
    definition: "Partícula encendida que salta del fuego o destello de ingenio.",
  },
  specter: {
    pos: "sustantivo",
    translation: "espectro / aparecido",
    definition: "Fantasma o visión fantasmal que infunde terror pavoroso.",
  },
  vanquish: {
    pos: "verbo",
    translation: "vencer / derrotar",
    definition: "Derrotar y someter por completo al enemigo en la contienda.",
  },
  amber: {
    pos: "sustantivo",
    translation: "ámbar",
    definition: "Resina fósil brillante de color amarillo dorado cálido.",
  },
  abode: {
    pos: "sustantivo",
    translation: "morada / domicilio",
    definition: "Lugar donde alguien habita, vive o fija su residencia.",
  },
  afflict: {
    pos: "verbo",
    translation: "afligir / atormentar",
    definition: "Causar sufrimiento físico o abatimiento moral a alguien.",
  },
  appal: {
    pos: "verbo",
    translation: "horrorizar / espantar",
    definition: "Llenar de consternación, espanto o pavor a los testigos.",
  },
  armor: {
    pos: "sustantivo",
    translation: "armadura / coraza",
    definition: "Vestidura de metal defensiva para proteger el cuerpo en combate.",
  },
  astonish: {
    pos: "verbo",
    translation: "asombrar / pasmar",
    definition: "Sorprender extraordinariamente causando gran extrañeza y pasmo.",
  },
  avenge: {
    pos: "verbo",
    translation: "vengar",
    definition: "Tomar satisfacción de un agravio o daño recibido en la honra.",
  },
  banner: {
    pos: "sustantivo",
    translation: "estandarte / bandera",
    definition: "Insignia o enseña que identifica a un ejército o casa noble.",
  },
  barren: {
    pos: "adjetivo",
    translation: "estéril / yermo",
    definition: "Tierra donde no crece vegetación o carente de frutos fértiles.",
  },
  betrayal: {
    pos: "sustantivo",
    translation: "traición / deslealtad",
    definition: "Violación grave de la fidelidad debida a un amigo o señor.",
  },
  bough: {
    pos: "sustantivo",
    translation: "rama gruesa",
    definition: "Rama principal y robusta que brota del tronco de un árbol.",
  },
  brittle: {
    pos: "adjetivo",
    translation: "quebradizo / frágil",
    definition: "Que se rompe con facilidad al menor golpe o flexión.",
  },
  citadel: {
    pos: "sustantivo",
    translation: "ciudadela / alcázar",
    definition: "Recinto fortificado en la parte más alta de una ciudad.",
  },
  clatter: {
    pos: "sustantivo",
    translation: "estrépito / traqueteo",
    definition: "Ruido seco producido por el choque repetido de objetos duros.",
  },
  covert: {
    pos: "adjetivo",
    translation: "secreto / encubierto",
    definition: "Hecho a escondidas sin que nadie lo perciba abiertamente.",
  },
  crave: {
    pos: "verbo",
    translation: "ansiar / anhelar",
    definition: "Sentir un deseo imperioso y vehemente de conseguir algo.",
  },
  cunning: {
    pos: "adjetivo",
    translation: "astuto / taimado",
    definition: "Hábil para engañar con destreza e ingenio disimulado.",
  },
  dawning: {
    pos: "sustantivo",
    translation: "amanecer / despuntar",
    definition: "Momento en que la primera luz del día asoma en el horizonte.",
  },
  deceit: {
    pos: "sustantivo",
    translation: "engaño / falsedad",
    definition: "Falta de verdad premeditada con ánimo de perjudicar a otro.",
  },
  devour: {
    pos: "verbo",
    translation: "devorar / engullir",
    definition: "Comer con voracidad animal o consumir por completo el fuego.",
  },
  disquiet: {
    pos: "sustantivo",
    translation: "inquietud / desasosiego",
    definition: "Intranquilidad de ánimo provocada por sospechas o temores.",
  },
  domain: {
    pos: "sustantivo",
    translation: "dominio / señorío",
    definition: "Tierras o territorio sujeto a la autoridad de un soberano.",
  },
  downfall: {
    pos: "sustantivo",
    translation: "caída / ruina",
    definition: "Pérdida súbita del poder, la fortuna o la gloria personal.",
  },
  dwell: {
    pos: "verbo",
    translation: "habitar / morar",
    definition: "Vivir de continuo en un lugar o detenerse largamente en una idea.",
  },
  elude: {
    pos: "verbo",
    translation: "eludir / esquivar",
    definition: "Evitar con agilidad un golpe, captura o entendimiento claro.",
  },
  enslave: {
    pos: "verbo",
    translation: "esclavizar / sojuzgar",
    definition: "Someter a alguien privándolo de su libertad y albedrío.",
  },
  gallant: {
    pos: "adjetivo",
    translation: "galardo / bizarro",
    definition: "Valiente, generoso y noble en sus modales y hazañas.",
  },
  glance: {
    pos: "sustantivo",
    translation: "mirada rápida / vistazo",
    definition: "Mirada fugaz que se dirige a algo sin detenerse.",
  },
  grudge: {
    pos: "sustantivo",
    translation: "rencor / resentimiento",
    definition: "Sentimiento amargo de enemistad guardado por una ofensa pasada.",
  },
  herald: {
    pos: "sustantivo",
    translation: "heraldo / emisario",
    definition: "Mensajero oficial que anuncia decretos, batallas o sucesos.",
  },
  homage: {
    pos: "sustantivo",
    translation: "homenaje / pleitesía",
    definition: "Muestra solemne de respeto, reverencia o sumisión leal.",
  },
  horde: {
    pos: "sustantivo",
    translation: "horda / multitud bárbara",
    definition: "Grupo numeroso y desordenado que avanza con furia.",
  },
  immortal: {
    pos: "adjetivo",
    translation: "inmortal / eterno",
    definition: "Que no puede morir o cuya memoria perdura por los siglos.",
  },
  imperil: {
    pos: "verbo",
    translation: "poner en peligro",
    definition: "Exponer a un riesgo inminente de destrucción o daño grave.",
  },
  javelin: {
    pos: "sustantivo",
    translation: "jabalina / dardo",
    definition: "Arma arrojadiza compuesta de asta y punta afilada de hierro.",
  },
  maiden: {
    pos: "sustantivo",
    translation: "doncella / doncella joven",
    definition: "Joven soltera o muchacha de inocencia noble.",
  },
  salvage: {
    pos: "verbo",
    translation: "rescatar / salvar",
    definition: "Recuperar algo valioso de entre los restos de un desastre o naufragio.",
  },
  scythe: {
    pos: "sustantivo",
    translation: "guadaña",
    definition: "Herramienta de hoja curvada usada para segar mieses o símbolo de la muerte.",
  },
  sheath: {
    pos: "sustantivo",
    translation: "vaina / funda",
    definition: "Funda defensiva ajustada para guardar espadas o puñales.",
  },
  shriek: {
    pos: "sustantivo",
    translation: "chillido desgarrador",
    definition: "Grito agudo y estridente causado por el pánico o dolor extremo.",
  },
  torrent: {
    pos: "sustantivo",
    translation: "torrente / tromba",
    definition: "Corriente impetuosa de agua o avalancha incontrolable de emociones.",
  },
  treachery: {
    pos: "sustantivo",
    translation: "alevosía / traición",
    definition: "Acción ruin y desleal cometida con premeditación y cautela.",
  },
  warrior: {
    pos: "sustantivo",
    translation: "guerrero / combatiente",
    definition: "Persona diestra en las artes de la guerra y la batalla.",
  },
  "as-is": {
    pos: "locución",
    translation: "tal cual",
    definition: "Expresión que indica que algo se acepta o entrega en su estado actual, sin cambios ni garantías.",
  },
  "to-do": {
    pos: "sustantivo",
    translation: "lista de tareas",
    definition: "Lista de tareas o asuntos pendientes que deben realizarse.",
  },
  "time": {
    pos: "sustantivo",
    translation: "tiempo",
    definition: "Magnitud que mide la duración de los acontecimientos y el intervalo entre ellos.",
  },
  "also": {
    pos: "adverbio",
    translation: "también, además",
    definition: "Indica que algo se suma o añade a lo ya mencionado.",
  },
  "like": {
    pos: "verbo",
    translation: "gustar",
    definition: "Sentir agrado o afición por algo o alguien.",
  },
  "can-can": {
    pos: "sustantivo",
    translation: "cancán",
    definition: "Baile francés de ritmo rápido en el que las bailarinas levantan las piernas.",
  },
  "one-up": {
    pos: "verbo",
    translation: "llevar ventaja",
    definition: "Superar o aventajar a alguien, especialmente para demostrar superioridad.",
  },
  "good": {
    pos: "adjetivo",
    translation: "bueno, buena",
    definition: "Que tiene las cualidades positivas o deseables propias de su naturaleza.",
  },
  "what-if": {
    pos: "sustantivo",
    translation: "hipótesis, escenario hipotético",
    definition: "Suposición o escenario imaginario que explora posibles consecuencias o resultados alternativos.",
  },
  "so-and-so": {
    pos: "pronombre",
    translation: "fulano de tal",
    definition: "Persona indeterminada o cuyo nombre no se menciona.",
  },
  "know": {
    pos: "verbo",
    translation: "saber, conocer",
    definition: "Tener conocimiento o información sobre algo, o estar familiarizado con una persona o cosa.",
  },
  "first": {
    pos: "adjetivo",
    translation: "primero",
    definition: "Que precede a todos los demás en orden, tiempo o importancia.",
  },
  "make": {
    pos: "verbo",
    translation: "hacer, fabricar",
    definition: "Producir, crear o fabricar algo material o inmaterial.",
  },
  "think": {
    pos: "verbo",
    translation: "pensar, creer",
    definition: "Formar ideas o creencias en la mente; considerar o reflexionar sobre algo.",
  },
  "people": {
    pos: "sustantivo",
    translation: "gente, personas",
    definition: "Conjunto de personas que forman una comunidad o grupo.",
  },
  "because": {
    pos: "conjunción",
    translation: "porque",
    definition: "Conjunción que introduce la causa o el motivo de algo.",
  },
  "back": {
    pos: "sustantivo",
    translation: "espalda",
    definition: "Parte posterior del cuerpo humano, desde los hombros hasta la cintura.",
  },
  "want": {
    pos: "verbo",
    translation: "querer, desear",
    definition: "Tener el deseo o la intención de hacer algo o de poseer algo.",
  },
  "has-been": {
    pos: "sustantivo",
    translation: "vieja gloria, fracasado",
    definition: "Persona que fue famosa o exitosa pero ya ha perdido su relevancia o prestigio.",
  },
  "time-out": {
    pos: "sustantivo",
    translation: "tiempo muerto",
    definition: "Pausa breve en un juego o actividad para descansar o reagruparse.",
  },
  "much": {
    pos: "determinante",
    translation: "mucho, mucha",
    definition: "Cantidad grande o abundante de algo.",
  },
  "know-all": {
    pos: "sustantivo",
    translation: "sabelotodo",
    definition: "Persona que presume de saberlo todo o que actúa como si lo supiera.",
  },
  "well": {
    pos: "sustantivo",
    translation: "pozo",
    definition: "Perforación en la tierra para extraer agua u otro líquido.",
  },
  "get-up": {
    pos: "sustantivo",
    translation: "atuendo, vestimenta",
    definition: "Conjunto de ropa que lleva una persona, especialmente si es llamativo o elaborado.",
  },
  "right": {
    pos: "sustantivo",
    translation: "derecho, derecha",
    definition: "Facultad o poder moral o legal de exigir algo o de actuar de cierta manera.",
  },
  "work": {
    pos: "sustantivo",
    translation: "trabajo, obra",
    definition: "Actividad física o intelectual que se realiza para producir algo o ganar un salario.",
  },
  "year": {
    pos: "sustantivo",
    translation: "año",
    definition: "Período de doce meses que corresponde a una revolución terrestre alrededor del Sol.",
  },
  "work-in": {
    pos: "sustantivo",
    translation: "ocupación de puesto",
    definition: "Acción de ocupar un lugar de trabajo como protesta o medida de presión laboral.",
  },
  "even": {
    pos: "adverbio",
    translation: "incluso, aun",
    definition: "Indica que algo es más de lo esperado o se incluye en lo dicho.",
  },
  "know-it-all": {
    pos: "sustantivo",
    translation: "sabelotodo",
    definition: "Persona que presume de saberlo todo y no admite correcciones.",
  },
  "make-up": {
    pos: "sustantivo",
    translation: "maquillaje",
    definition: "Productos cosméticos usados para embellecer o resaltar el rostro.",
  },
  "many": {
    pos: "determinante",
    translation: "muchos, muchas",
    definition: "Indica una cantidad grande o numerosa de personas o cosas.",
  },
  "never": {
    pos: "adverbio",
    translation: "nunca, jamás",
    definition: "Indica que una acción no ocurre en ningún momento.",
  },
  "still": {
    pos: "adverbio",
    translation: "todavía, aún",
    definition: "Indica que algo continúa ocurriendo o es válido hasta el momento presente.",
  },
  "take": {
    pos: "verbo",
    translation: "tomar, llevar",
    definition: "Coger o asir algo, o trasladarlo de un lugar a otro.",
  },
  "world": {
    pos: "sustantivo",
    translation: "mundo",
    definition: "Conjunto de todo lo que existe, especialmente la Tierra y sus habitantes.",
  },
  "two-time": {
    pos: "verbo",
    translation: "ser infiel a",
    definition: "Engañar a alguien teniendo una relación amorosa paralela a escondidas.",
  },
  "life": {
    pos: "sustantivo",
    translation: "vida",
    definition: "Estado de actividad de los seres orgánicos; también, período de existencia de algo o alguien.",
  },
  "great": {
    pos: "adjetivo",
    translation: "grande, genial, estupendo",
    definition: "Que es muy bueno, importante o de gran tamaño o calidad.",
  },
  "back-up": {
    pos: "sustantivo",
    translation: "copia de seguridad",
    definition: "Copia de datos o archivos para recuperarlos en caso de pérdida o fallo.",
  },
  "know-how": {
    pos: "sustantivo",
    translation: "conocimientos técnicos",
    definition: "Conjunto de conocimientos prácticos y habilidades para realizar una tarea.",
  },
  "last": {
    pos: "adjetivo",
    translation: "último, final",
    definition: "Que es el final o el más reciente en una serie o secuencia.",
  },
  "best": {
    pos: "adjetivo",
    translation: "mejor",
    definition: "Superlativo de bueno; que posee la mayor calidad o excelencia entre varios.",
  },
  "one-off": {
    pos: "adjetivo",
    translation: "único, irrepetible",
    definition: "Que ocurre una sola vez y no se repite.",
  },
  "work-up": {
    pos: "sustantivo",
    translation: "evaluación diagnóstica",
    definition: "Conjunto de pruebas y estudios para diagnosticar una enfermedad.",
  },
  "love": {
    pos: "sustantivo",
    translation: "amor",
    definition: "Sentimiento de afecto, cariño y apego hacia otra persona o cosa.",
  },
  "while": {
    pos: "conjunción",
    translation: "mientras, mientras que",
    definition: "Indica simultaneidad o contraste entre dos acciones o situaciones.",
  },
  "work-out": {
    pos: "sustantivo",
    translation: "rutina de ejercicio",
    definition: "Sesión de ejercicio físico planificada para mejorar la condición o la salud.",
  },
  "long": {
    pos: "adjetivo",
    translation: "largo",
    definition: "Que tiene una gran longitud o extensión.",
  },
  "look": {
    pos: "verbo",
    translation: "mirar, parecer",
    definition: "Dirigir la vista hacia algo o tener cierta apariencia.",
  },
  "something": {
    pos: "pronombre",
    translation: "algo, alguna cosa",
    definition: "Pronombre indefinido que designa una cosa no especificada o indeterminada.",
  },
  "home": {
    pos: "sustantivo",
    translation: "hogar, casa",
    definition: "Lugar donde una persona vive, especialmente con su familia.",
  },
  "day-time": {
    pos: "sustantivo",
    translation: "horario diurno",
    definition: "Período del día en que hay luz solar.",
  },
  "take-out": {
    pos: "sustantivo",
    translation: "comida para llevar",
    definition: "Comida preparada en un restaurante para consumir fuera del local.",
  },
  "every": {
    pos: "determinante",
    translation: "cada, todo",
    definition: "Determinante que indica la totalidad de los elementos de un conjunto sin excepción.",
  },
  "up-take": {
    pos: "sustantivo",
    translation: "absorción, consumo, captación",
    definition: "Proceso de absorber o asimilar una sustancia, información o recurso.",
  },
  "come": {
    pos: "verbo",
    translation: "venir, llegar",
    definition: "Moverse hacia el lugar donde está el hablante o el punto de referencia.",
  },
  "take-up": {
    pos: "sustantivo",
    translation: "adopción, aceptación",
    definition: "Grado en que algo es aceptado o utilizado por el público.",
  },
  "part": {
    pos: "sustantivo",
    translation: "parte, porción",
    definition: "Cada una de las porciones en que se divide un todo.",
  },
  "state": {
    pos: "sustantivo",
    translation: "estado, condición",
    definition: "Situación o condición en que se encuentra algo o alguien en un momento determinado.",
  },
  "better": {
    pos: "adjetivo",
    translation: "mejor",
    definition: "Comparativo de bueno; que es de mayor calidad o superior a otra cosa.",
  },
  "around": {
    pos: "adverbio",
    translation: "alrededor, cerca",
    definition: "Indica proximidad, movimiento en círculo o aproximación a un lugar o cantidad.",
  },
  "three": {
    pos: "determinante",
    translation: "tres",
    definition: "Número cardinal que equivale a dos más uno.",
  },
  "find": {
    pos: "verbo",
    translation: "encontrar, hallar",
    definition: "Descubrir o localizar algo que se busca o que estaba oculto.",
  },
  "come-on": {
    pos: "sustantivo",
    translation: "señuelo, anzuelo, provocación",
    definition: "Táctica o gesto para atraer, seducir o engañar a alguien.",
  },
  "always": {
    pos: "adverbio",
    translation: "siempre",
    definition: "En todo momento o en cualquier ocasión, sin excepción.",
  },
  "help": {
    pos: "sustantivo",
    translation: "ayuda, auxilio",
    definition: "Acción de prestar asistencia o apoyo a alguien que lo necesita.",
  },
  "little": {
    pos: "adjetivo",
    translation: "pequeño, poco",
    definition: "Que tiene tamaño o cantidad reducida.",
  },
  "since": {
    pos: "conjunción",
    translation: "desde que, porque, ya que",
    definition: "Indica el punto de partida temporal o una causa o razón.",
  },
  "another": {
    pos: "determinante",
    translation: "otro, otra, uno más",
    definition: "Determinante que indica una persona o cosa adicional o distinta de la ya mencionada.",
  },
  "he-man": {
    pos: "sustantivo",
    translation: "hombre muy viril",
    definition: "Hombre que exhibe una masculinidad fuerte y exagerada, asociada a la fuerza física.",
  },
  "high": {
    pos: "adjetivo",
    translation: "alto",
    definition: "Que tiene gran altura o se encuentra a gran distancia del suelo.",
  },
  "down-and-out": {
    pos: "adjetivo",
    translation: "indigente, arruinado",
    definition: "Persona sin recursos ni hogar que vive en la miseria.",
  },
  "life-time": {
    pos: "sustantivo",
    translation: "tiempo de vida",
    definition: "Período de tiempo que dura la vida de una persona o cosa.",
  },
  "give": {
    pos: "verbo",
    translation: "dar, entregar",
    definition: "Transferir algo a alguien de forma voluntaria.",
  },
  "down-time": {
    pos: "sustantivo",
    translation: "tiempo de inactividad",
    definition: "Período en que un sistema o máquina no está operativo o disponible.",
  },
  "house": {
    pos: "sustantivo",
    translation: "casa",
    definition: "Edificio destinado a vivienda, generalmente para una familia.",
  },
  "game": {
    pos: "sustantivo",
    translation: "juego, partido",
    definition: "Actividad recreativa con reglas, o competencia deportiva.",
  },
  "look-up": {
    pos: "sustantivo",
    translation: "consulta, búsqueda",
    definition: "Acción de buscar información en una fuente o base de datos.",
  },
  "thing": {
    pos: "sustantivo",
    translation: "cosa, objeto",
    definition: "Objeto material o entidad de cualquier tipo que se puede percibir o concebir.",
  },
  "look-out": {
    pos: "sustantivo",
    translation: "puesto de vigilancia",
    definition: "Lugar o persona encargada de vigilar y dar aviso de lo que ocurre.",
  },
  "place": {
    pos: "sustantivo",
    translation: "lugar, sitio",
    definition: "Espacio o ubicación donde ocurre algo o donde está alguien o algo.",
  },
  "school": {
    pos: "sustantivo",
    translation: "escuela, colegio",
    definition: "Institución donde se imparte enseñanza a los estudiantes.",
  },
  "take-over": {
    pos: "sustantivo",
    translation: "adquisición, toma de control",
    definition: "Acción de adquirir el control de una empresa o entidad, generalmente mediante compra de acciones.",
  },
  "going-over": {
    pos: "sustantivo",
    translation: "repaso, paliza, revisión",
    definition: "Acción de examinar, revisar o reprender algo o a alguien con severidad.",
  },
  "next": {
    pos: "adjetivo/adverbio",
    translation: "siguiente, próximo",
    definition: "Que viene inmediatamente después en orden o tiempo.",
  },
  "well-being": {
    pos: "sustantivo",
    translation: "bienestar",
    definition: "Estado de satisfacción física, mental y social de una persona.",
  },
  "in-house": {
    pos: "adjetivo",
    translation: "interno, en la empresa",
    definition: "Que se realiza dentro de una organización o empresa, con recursos propios.",
  },
  "found": {
    pos: "verbo",
    translation: "fundar, establecer",
    definition: "Crear o establecer algo, como una empresa, ciudad o institución.",
  },
  "show": {
    pos: "sustantivo",
    translation: "espectáculo, programa",
    definition: "Representación o programa de entretenimiento ofrecido al público.",
  },
  "feel": {
    pos: "verbo",
    translation: "sentir, tocar",
    definition: "Percibir sensaciones físicas o emocionales, o experimentar una impresión.",
  },
  "right-of-way": {
    pos: "sustantivo",
    translation: "derecho de paso",
    definition: "Derecho preferente de una persona o vehículo a pasar antes que otros.",
  },
  "team": {
    pos: "sustantivo",
    translation: "equipo",
    definition: "Grupo de personas que trabajan juntas para lograr un objetivo común.",
  },
  "ever": {
    pos: "adverbio",
    translation: "alguna vez, siempre",
    definition: "En algún momento del pasado, presente o futuro; o en todo tiempo.",
  },
  "family": {
    pos: "sustantivo",
    translation: "familia",
    definition: "Grupo de personas unidas por lazos de parentesco o convivencia.",
  },
  "sure": {
    pos: "adjetivo",
    translation: "seguro, cierto",
    definition: "Que es seguro, cierto o que no tiene duda sobre algo.",
  },
  "high-up": {
    pos: "sustantivo",
    translation: "persona de alto rango",
    definition: "Persona que ocupa una posición de gran autoridad o influencia.",
  },
  "money": {
    pos: "sustantivo",
    translation: "dinero",
    definition: "Medio de pago aceptado para comprar bienes y servicios o saldar deudas.",
  },
  "part-time": {
    pos: "adjetivo",
    translation: "a tiempo parcial",
    definition: "Que se realiza durante una parte de la jornada laboral habitual.",
  },
  "keep": {
    pos: "verbo",
    translation: "guardar, mantener, conservar",
    definition: "Tener o conservar algo en un estado o lugar determinado.",
  },
  "second": {
    pos: "sustantivo",
    translation: "segundo (unidad de tiempo)",
    definition: "Unidad de tiempo que equivale a la sexagésima parte de un minuto.",
  },
  "free": {
    pos: "adjetivo",
    translation: "libre, gratis",
    definition: "Que no está sometido a restricciones o que no cuesta dinero.",
  },
  "off-day": {
    pos: "sustantivo",
    translation: "día malo",
    definition: "Día en que las cosas no salen bien o el rendimiento es inferior a lo habitual.",
  },
  "someone": {
    pos: "pronombre",
    translation: "alguien",
    definition: "Persona indeterminada o no especificada.",
  },
  "please": {
    pos: "verbo",
    translation: "complacer, agradar",
    definition: "Causar satisfacción o gusto a alguien, o satisfacer su deseo.",
  },
  "away": {
    pos: "adverbio",
    translation: "lejos, fuera",
    definition: "Indica distancia o separación de un lugar o persona.",
  },
  "left": {
    pos: "adjetivo",
    translation: "izquierdo, izquierda",
    definition: "Que está situado en el lado opuesto al derecho o que corresponde a ese lado.",
  },
  "over-use": {
    pos: "sustantivo",
    translation: "uso excesivo",
    definition: "Uso de algo en exceso o más de lo necesario o recomendable.",
  },
  "take-off": {
    pos: "sustantivo",
    translation: "despegue, despegue de avión",
    definition: "Momento en que un avión se separa del suelo y comienza a volar.",
  },
  "work-life": {
    pos: "sustantivo",
    translation: "equilibrio vida-trabajo",
    definition: "Relación equilibrada entre la vida laboral y la vida personal.",
  },
  "city": {
    pos: "sustantivo",
    translation: "ciudad",
    definition: "Núcleo urbano de gran población y actividad, con gobierno y servicios propios.",
  },
  "number": {
    pos: "sustantivo",
    translation: "número",
    definition: "Cantidad o símbolo que representa una cantidad o posición en una serie.",
  },
  "night": {
    pos: "sustantivo",
    translation: "noche",
    definition: "Período de oscuridad entre el atardecer y el amanecer.",
  },
  "over-look": {
    pos: "verbo",
    translation: "pasar por alto",
    definition: "No notar o ignorar algo por descuido o falta de atención.",
  },
  "name": {
    pos: "sustantivo",
    translation: "nombre",
    definition: "Palabra que designa o identifica a una persona, animal o cosa.",
  },
  "company": {
    pos: "sustantivo",
    translation: "empresa, compañía",
    definition: "Organización dedicada a actividades comerciales o industriales con fines lucrativos.",
  },
  "play": {
    pos: "verbo",
    translation: "jugar, tocar, reproducir",
    definition: "Realizar una actividad recreativa o ejecutar una acción musical o dramática.",
  },
  "until": {
    pos: "preposición",
    translation: "hasta",
    definition: "Indica el límite temporal o espacial en el que algo termina o cesa.",
  },
  "doing": {
    pos: "sustantivo",
    translation: "acción, hacer",
    definition: "Acción o actividad que se realiza; también forma del verbo hacer en gerundio.",
  },
  "real": {
    pos: "adjetivo",
    translation: "real, verdadero",
    definition: "Que existe o es verdadero, no imaginario ni ficticio.",
  },
  "still-life": {
    pos: "sustantivo",
    translation: "naturaleza muerta",
    definition: "Género pictórico que representa objetos inanimados como frutas, flores o utensilios.",
  },
  "come-back": {
    pos: "sustantivo",
    translation: "regreso, vuelta, retorno",
    definition: "Acción de volver a un lugar o de recuperar una posición o éxito anterior.",
  },
  "up-end": {
    pos: "verbo",
    translation: "volcar, poner de pie",
    definition: "Volcar o poner algo de pie, invirtiendo su posición normal.",
  },
  "no-show": {
    pos: "sustantivo",
    translation: "persona que no se presenta",
    definition: "Persona que no asiste a una cita, reserva o compromiso sin avisar.",
  },
  "go-between": {
    pos: "sustantivo",
    translation: "intermediario, mediador",
    definition: "Persona que actúa como enlace entre dos partes para facilitar un acuerdo o comunicación.",
  },
  "thought": {
    pos: "sustantivo",
    translation: "pensamiento, idea",
    definition: "Idea o reflexión que se forma en la mente.",
  },
  "however": {
    pos: "adverbio",
    translation: "sin embargo",
    definition: "Indica contraste o oposición con lo dicho anteriormente.",
  },
  "life-world": {
    pos: "sustantivo",
    translation: "mundo de la vida",
    definition: "Mundo cotidiano vivido y experimentado subjetivamente por las personas.",
  },
  "group": {
    pos: "sustantivo",
    translation: "grupo",
    definition: "Conjunto de personas o cosas que comparten una característica o están juntas.",
  },
  "on-set": {
    pos: "sustantivo",
    translation: "inicio del rodaje",
    definition: "Momento en que comienza el rodaje de una producción audiovisual.",
  },
  "different": {
    pos: "adjetivo",
    translation: "diferente, distinto",
    definition: "Que no es igual a otra cosa o persona, que presenta diferencias.",
  },
  "public": {
    pos: "adjetivo",
    translation: "público, pública",
    definition: "Que es conocido o accesible por todos, no privado.",
  },
  "set-to": {
    pos: "sustantivo",
    translation: "pelea, altercado",
    definition: "Discusión o pelea breve pero intensa entre dos o más personas.",
  },
  "government": {
    pos: "sustantivo",
    translation: "gobierno",
    definition: "Conjunto de personas e instituciones que dirigen y administran un Estado.",
  },
  "care": {
    pos: "sustantivo",
    translation: "cuidado, atención",
    definition: "Atención o preocupación que se presta a alguien o algo para su bienestar.",
  },
  "start": {
    pos: "verbo",
    translation: "empezar, comenzar, iniciar",
    definition: "Comenzar una acción o actividad desde un punto determinado.",
  },
  "business": {
    pos: "sustantivo",
    translation: "negocio, empresa",
    definition: "Actividad económica o entidad dedicada a producir o vender bienes y servicios.",
  },
  "free-for-all": {
    pos: "sustantivo",
    translation: "todos contra todos",
    definition: "Situación caótica o disputa sin reglas en la que todos participan libremente.",
  },
  "in-group": {
    pos: "sustantivo",
    translation: "grupo de pertenencia",
    definition: "Grupo social al que una persona pertenece y con el que se identifica.",
  },
  "times": {
    pos: "sustantivo",
    translation: "veces, tiempos",
    definition: "Plural de 'time'; ocasiones o momentos en que ocurre algo.",
  },
  "system": {
    pos: "sustantivo",
    translation: "sistema",
    definition: "Conjunto de elementos organizados que interactúan para cumplir una función.",
  },
  "anything": {
    pos: "pronombre",
    translation: "cualquier cosa",
    definition: "Pronombre indefinido que se refiere a una cosa no especificada.",
  },
  "case": {
    pos: "sustantivo",
    translation: "caso, estuche",
    definition: "Situación o circunstancia; también recipiente para guardar o transportar algo.",
  },
  "already": {
    pos: "adverbio",
    translation: "ya",
    definition: "Indica que algo ha ocurrido antes del momento presente o antes de lo esperado.",
  },
  "week": {
    pos: "sustantivo",
    translation: "semana",
    definition: "Período de siete días consecutivos, generalmente contado de lunes a domingo.",
  },
  "person": {
    pos: "sustantivo",
    translation: "persona",
    definition: "Ser humano considerado individualmente, con identidad propia.",
  },
  "nothing": {
    pos: "pronombre",
    translation: "nada",
    definition: "Ausencia total de algo o inexistencia de cualquier cosa.",
  },
  "everything": {
    pos: "pronombre",
    translation: "todo, todas las cosas",
    definition: "Conjunto de todas las cosas o la totalidad de algo.",
  },
  "enough": {
    pos: "adverbio",
    translation: "suficiente, bastante",
    definition: "Indica que una cantidad o grado es todo lo necesario o todo lo que se puede tolerar.",
  },
  "change": {
    pos: "sustantivo",
    translation: "cambio, cambio de moneda",
    definition: "Acción o efecto de cambiar; también dinero suelto o vuelto de una compra.",
  },
  "let-up": {
    pos: "sustantivo",
    translation: "pausa, respiro, tregua",
    definition: "Momento de descanso o disminución de la intensidad de algo.",
  },
  "today": {
    pos: "adverbio",
    translation: "hoy",
    definition: "En el día actual o presente.",
  },
  "full": {
    pos: "adjetivo",
    translation: "lleno, completo",
    definition: "Que contiene todo lo que puede caber o le falta espacio libre.",
  },
  "read": {
    pos: "verbo",
    translation: "leer",
    definition: "Interpretar el significado de un texto escrito.",
  },
  "live": {
    pos: "verbo",
    translation: "vivir",
    definition: "Tener vida o existir; habitar en un lugar.",
  },
  "making": {
    pos: "sustantivo",
    translation: "fabricación, creación",
    definition: "Acción o proceso de crear, producir o fabricar algo.",
  },
  "four": {
    pos: "determinante",
    translation: "cuatro",
    definition: "Número cardinal que equivale a tres más uno.",
  },
  "point": {
    pos: "sustantivo",
    translation: "punto",
    definition: "Marca o señal pequeña de forma circular o alargada.",
  },
  "mean": {
    pos: "verbo",
    translation: "significar, querer decir",
    definition: "Tener una palabra o expresión un determinado significado o sentido.",
  },
  "hard": {
    pos: "adjetivo",
    translation: "duro, difícil",
    definition: "Que es resistente, sólido o que presenta dificultad para realizarse o entenderse.",
  },
  "set-up": {
    pos: "sustantivo",
    translation: "configuración, montaje, arreglo",
    definition: "Acción y efecto de preparar, organizar o montar algo, o el conjunto resultante.",
  },
  "support": {
    pos: "sustantivo",
    translation: "apoyo, soporte",
    definition: "Ayuda o respaldo que se brinda a alguien o algo para sostenerlo o facilitarlo.",
  },
  "including": {
    pos: "preposición",
    translation: "incluyendo, incluso",
    definition: "Introduce un elemento que forma parte de un conjunto mencionado.",
  },
  "night-time": {
    pos: "sustantivo",
    translation: "horas de la noche",
    definition: "Período de tiempo durante la noche, especialmente cuando está oscuro.",
  },
  "states": {
    pos: "sustantivo",
    translation: "estados",
    definition: "Plural de estado; naciones o divisiones territoriales con gobierno propio.",
  },
  "power": {
    pos: "sustantivo",
    translation: "poder, energía, potencia",
    definition: "Capacidad o fuerza para hacer algo o influir en otros.",
  },
  "music": {
    pos: "sustantivo",
    translation: "música",
    definition: "Arte de combinar sonidos y silencios de forma agradable al oído.",
  },
  "stop": {
    pos: "sustantivo",
    translation: "parada, alto",
    definition: "Lugar o señal donde algo se detiene; también acción de detenerse.",
  },
  "work-place": {
    pos: "sustantivo",
    translation: "lugar de trabajo",
    definition: "Espacio físico donde una persona desempeña su actividad laboral.",
  },
  "water": {
    pos: "sustantivo",
    translation: "agua",
    definition: "Líquido transparente, incoloro e inodoro esencial para la vida.",
  },
  "tell": {
    pos: "verbo",
    translation: "decir, contar",
    definition: "Comunicar algo a alguien mediante palabras.",
  },
  "believe": {
    pos: "verbo",
    translation: "creer",
    definition: "Tener por cierto algo o aceptar que es verdad.",
  },
  "national": {
    pos: "adjetivo",
    translation: "nacional",
    definition: "Relativo o perteneciente a una nación o país.",
  },
  "out-group": {
    pos: "sustantivo",
    translation: "exogrupo, grupo externo",
    definition: "Grupo social al que no pertenece un individuo y hacia el que suele mostrar menor favoritismo.",
  },
  "head": {
    pos: "sustantivo",
    translation: "cabeza",
    definition: "Parte superior del cuerpo humano y de muchos animales, que contiene el cerebro y los órganos sensoriales.",
  },
  "call": {
    pos: "verbo",
    translation: "llamar",
    definition: "Comunicarse con alguien por teléfono o mediante la voz.",
  },
  "top-up": {
    pos: "sustantivo",
    translation: "recarga, pago adicional",
    definition: "Cantidad adicional de dinero o crédito que se añade a una cuenta o servicio.",
  },
  "white": {
    pos: "adjetivo",
    translation: "blanco",
    definition: "De color claro, como la leche o la nieve.",
  },
  "give-and-take": {
    pos: "sustantivo",
    translation: "toma y daca",
    definition: "Intercambio mutuo de concesiones o beneficios entre dos partes.",
  },
  "out-top": {
    pos: "verbo",
    translation: "superar, exceder",
    definition: "Sobrepasar o exceder a algo o alguien en altura, cantidad o calidad.",
  },
  "small": {
    pos: "adjetivo",
    translation: "pequeño, pequeño/a",
    definition: "Que tiene un tamaño, cantidad o intensidad reducidos en comparación con lo normal.",
  },
  "side": {
    pos: "sustantivo",
    translation: "lado",
    definition: "Cada una de las superficies o caras de un objeto o figura.",
  },
  "though": {
    pos: "conjunción",
    translation: "aunque, sin embargo",
    definition: "Introduce una idea contraria o concesiva; equivale a 'aunque' o 'sin embargo'.",
  },
  "american": {
    pos: "adjetivo",
    translation: "estadounidense, americano",
    definition: "Relativo a Estados Unidos o a América.",
  },
  "less": {
    pos: "adverbio",
    translation: "menos",
    definition: "Indica una cantidad o grado menor que otra cosa.",
  },
  "left-over": {
    pos: "sustantivo",
    translation: "sobras, restos",
    definition: "Restos de comida o material que quedan después de haber usado o consumido la mayor parte.",
  },
  "head-on": {
    pos: "adjetivo/adverbio",
    translation: "de frente, frontal",
    definition: "Que se produce directamente de frente o sin rodeos, como un choque o enfrentamiento frontal.",
  },
  "line": {
    pos: "sustantivo",
    translation: "línea, fila, cola",
    definition: "Trazo continuo o serie de elementos dispuestos uno tras otro.",
  },
  "party": {
    pos: "sustantivo",
    translation: "fiesta, partido político",
    definition: "Reunión social para celebrar o divertirse; también organización política que busca el poder.",
  },
  "show-off": {
    pos: "sustantivo",
    translation: "presumido, fanfarrón",
    definition: "Persona que presume o alardea de sus logros o cualidades para llamar la atención.",
  },
  "order": {
    pos: "sustantivo",
    translation: "orden, pedido",
    definition: "Disposición o secuencia de cosas; también mandato o solicitud de compra.",
  },
  "team-work": {
    pos: "sustantivo",
    translation: "trabajo en equipo",
    definition: "Colaboración coordinada de un grupo para alcanzar un objetivo común.",
  },
  "in-service": {
    pos: "adjetivo",
    translation: "en servicio",
    definition: "Que se realiza o recibe durante el ejercicio activo de una profesión u ocupación.",
  },
  "service": {
    pos: "sustantivo",
    translation: "servicio",
    definition: "Trabajo o actividad que se realiza para satisfacer una necesidad de otra persona.",
  },
  "season": {
    pos: "sustantivo",
    translation: "estación, temporada",
    definition: "Cada una de las cuatro divisiones del año o un período determinado de tiempo.",
  },
  "shit": {
    pos: "sustantivo",
    translation: "mierda, porquería",
    definition: "Excremento o cosa de mala calidad; también se usa como insulto o interjección.",
  },
  "country": {
    pos: "sustantivo",
    translation: "país, nación",
    definition: "Territorio con gobierno propio y fronteras definidas, habitado por una comunidad.",
  },
  "thank": {
    pos: "verbo",
    translation: "agradecer, dar gracias",
    definition: "Expresar gratitud hacia alguien por un favor o beneficio recibido.",
  },
  "open": {
    pos: "verbo",
    translation: "abrir",
    definition: "Acción de permitir el acceso o levantar una tapa o puerta.",
  },
  "everyone": {
    pos: "pronombre",
    translation: "todo el mundo",
    definition: "Pronombre indefinido que se refiere a todas las personas de un grupo o en general.",
  },
  "run-in": {
    pos: "sustantivo",
    translation: "enfrentamiento, altercado",
    definition: "Discusión o conflicto breve y acalorado entre dos o más personas.",
  },
  "united": {
    pos: "adjetivo",
    translation: "unido, unida",
    definition: "Que está junto o en armonía con otros formando una unidad.",
  },
  "full-time": {
    pos: "adjetivo",
    translation: "a tiempo completo",
    definition: "Que se realiza durante toda la jornada laboral establecida.",
  },
  "will-power": {
    pos: "sustantivo",
    translation: "fuerza de voluntad",
    definition: "Capacidad de controlar la propia conducta y perseverar para alcanzar metas.",
  },
  "general": {
    pos: "adjetivo",
    translation: "general, común",
    definition: "Que es común o se aplica a la mayoría de personas o cosas.",
  },
  "black": {
    pos: "adjetivo",
    translation: "negro",
    definition: "De color muy oscuro, como el carbón o la noche sin luz.",
  },
  "by-line": {
    pos: "sustantivo",
    translation: "línea de autor",
    definition: "Línea que indica el nombre del autor de un artículo o texto.",
  },
  "call-up": {
    pos: "sustantivo",
    translation: "llamada a filas",
    definition: "Convocatoria oficial para incorporarse al servicio militar o a un puesto de trabajo.",
  },
  "area": {
    pos: "sustantivo",
    translation: "área, superficie, zona",
    definition: "Extensión de superficie delimitada o región con una función o característica determinada.",
  },
  "good-looking": {
    pos: "adjetivo",
    translation: "atractivo, guapo, bien parecido",
    definition: "Que tiene un aspecto físico agradable o atractivo.",
  },
  "set-back": {
    pos: "sustantivo",
    translation: "contratiempo, revés",
    definition: "Un obstáculo o retraso que impide el progreso o el éxito de algo.",
  },
  "following": {
    pos: "adjetivo",
    translation: "siguiente",
    definition: "Que viene después o va detrás en orden o secuencia.",
  },
  "together": {
    pos: "adverbio",
    translation: "juntos, en conjunto",
    definition: "Indica que dos o más personas o cosas están reunidas, unidas o en compañía.",
  },
  "whole": {
    pos: "adjetivo",
    translation: "entero, completo",
    definition: "Que está completo o no le falta ninguna parte.",
  },
  "face": {
    pos: "sustantivo",
    translation: "cara, rostro",
    definition: "Parte frontal de la cabeza humana donde están los ojos, la nariz y la boca.",
  },
  "in-law": {
    pos: "sustantivo",
    translation: "pariente político",
    definition: "Persona emparentada por matrimonio, no por consanguinidad.",
  },
  "after-care": {
    pos: "sustantivo",
    translation: "cuidados posteriores",
    definition: "Atención y asistencia continuada tras un tratamiento, cirugía o alta.",
  },
  "five": {
    pos: "sustantivo",
    translation: "cinco",
    definition: "Número cardinal que equivale a cuatro más uno.",
  },
  "put-down": {
    pos: "sustantivo",
    translation: "menosprecio, humillación",
    definition: "Comentario o acción que rebaja o humilla a alguien.",
  },
  "president": {
    pos: "sustantivo",
    translation: "presidente, presidenta",
    definition: "Persona que ejerce la máxima autoridad en un país, organización o institución.",
  },
  "try-out": {
    pos: "sustantivo",
    translation: "prueba, periodo de prueba",
    definition: "Prueba o período para evaluar el rendimiento o aptitud de alguien o algo.",
  },
  "maybe": {
    pos: "adverbio",
    translation: "tal vez, quizás",
    definition: "Indica posibilidad o duda sobre lo que se expresa.",
  },
  "kind": {
    pos: "adjetivo",
    translation: "amable, bondadoso",
    definition: "Que tiene disposición a hacer el bien y tratar con afecto a los demás.",
  },
  "working": {
    pos: "adjetivo",
    translation: "que trabaja, laboral",
    definition: "Que realiza un trabajo o que está en funcionamiento activo.",
  },
  "hope": {
    pos: "sustantivo",
    translation: "esperanza",
    definition: "Sentimiento de confianza en que algo deseado sucederá o es posible.",
  },
  "course": {
    pos: "sustantivo",
    translation: "curso, asignatura",
    definition: "Conjunto de enseñanzas sobre una materia o programa educativo.",
  },
  "health": {
    pos: "sustantivo",
    translation: "salud",
    definition: "Estado de bienestar físico, mental y social de una persona.",
  },
  "story": {
    pos: "sustantivo",
    translation: "historia, relato",
    definition: "Narración de hechos reales o imaginarios, o relato breve de ficción.",
  },
  "important": {
    pos: "adjetivo",
    translation: "importante, relevante",
    definition: "Que tiene gran valor, influencia o significado en un contexto determinado.",
  },
  "line-up": {
    pos: "sustantivo",
    translation: "alineación, formación",
    definition: "Conjunto ordenado de personas o cosas dispuestas en fila o secuencia.",
  },
  "play-off": {
    pos: "sustantivo",
    translation: "partido de desempate",
    definition: "Partido o serie final que decide el ganador tras un empate.",
  },
  "means": {
    pos: "sustantivo",
    translation: "medios, recursos",
    definition: "Recursos o métodos disponibles para lograr un objetivo.",
  },
  "news": {
    pos: "sustantivo",
    translation: "noticias, novedades",
    definition: "Información sobre hechos recientes de interés público.",
  },
  "within": {
    pos: "preposición",
    translation: "dentro de",
    definition: "Indica que algo está en el interior de un lugar, espacio o límite.",
  },
  "run-up": {
    pos: "sustantivo",
    translation: "período previo",
    definition: "Período de tiempo anterior a un evento importante.",
  },
  "able": {
    pos: "adjetivo",
    translation: "capaz, hábil",
    definition: "Que tiene capacidad o aptitud para hacer algo.",
  },
  "by-law": {
    pos: "sustantivo",
    translation: "ordenanza municipal",
    definition: "Norma o reglamento establecido por una autoridad local o una organización.",
  },
  "early": {
    pos: "adjetivo/adverbio",
    translation: "temprano, pronto",
    definition: "Que ocurre o sucede antes del tiempo habitual o esperado.",
  },
  "information": {
    pos: "sustantivo",
    translation: "información",
    definition: "Conjunto de datos o conocimientos que permiten conocer algo o reducir la incertidumbre.",
  },
  "change-over": {
    pos: "sustantivo",
    translation: "cambio, transición",
    definition: "Acción de pasar de un sistema, método o situación a otro.",
  },
  "good-for-nothing": {
    pos: "adjetivo",
    translation: "inútil, holgazán",
    definition: "Persona que no sirve para nada o es incapaz de ser útil.",
  },
  "off-set": {
    pos: "sustantivo",
    translation: "compensación, contrapeso",
    definition: "Cantidad o efecto que compensa o equilibra otra cosa.",
  },
  "book": {
    pos: "sustantivo",
    translation: "libro",
    definition: "Conjunto de hojas encuadernadas con texto o imágenes para leer.",
  },
  "local": {
    pos: "adjetivo",
    translation: "local, del lugar",
    definition: "Perteneciente o relativo a un lugar o a una localidad determinada.",
  },
  "run-time": {
    pos: "sustantivo",
    translation: "tiempo de ejecución",
    definition: "Período en que un programa está ejecutándose en el ordenador.",
  },
  "time-line": {
    pos: "sustantivo",
    translation: "línea de tiempo",
    definition: "Representación gráfica de una secuencia de eventos ordenados cronológicamente.",
  },
  "young": {
    pos: "adjetivo",
    translation: "joven",
    definition: "Que tiene poca edad o lleva poco tiempo existiendo.",
  },
  "post": {
    pos: "sustantivo",
    translation: "poste, correo, publicación",
    definition: "Elemento vertical de soporte, servicio de correo o mensaje publicado en línea.",
  },
  "group-work": {
    pos: "sustantivo",
    translation: "trabajo en grupo",
    definition: "Actividad realizada conjuntamente por varias personas para alcanzar un objetivo común.",
  },
  "out-general": {
    pos: "verbo",
    translation: "superar en estrategia militar",
    definition: "Derrotar a un oponente mediante una mejor estrategia o táctica militar.",
  },
  "full-back": {
    pos: "sustantivo",
    translation: "lateral defensivo",
    definition: "Jugador de fútbol que defiende por las bandas del campo.",
  },
  "talk": {
    pos: "verbo",
    translation: "hablar, conversar",
    definition: "Expresar ideas o pensamientos mediante palabras.",
  },
  "social": {
    pos: "adjetivo",
    translation: "social",
    definition: "Relativo a la sociedad o a las relaciones entre personas.",
  },
  "black-out": {
    pos: "sustantivo",
    translation: "apagón, pérdida de conocimiento",
    definition: "Interrupción del suministro eléctrico o pérdida temporal de la conciencia.",
  },
  "fact": {
    pos: "sustantivo",
    translation: "hecho, dato",
    definition: "Algo que se sabe que es verdadero o que realmente ocurrió.",
  },
  "court": {
    pos: "sustantivo",
    translation: "tribunal, corte, cancha",
    definition: "Lugar donde se imparte justicia o se practican deportes como el tenis.",
  },
  "video": {
    pos: "sustantivo",
    translation: "video",
    definition: "Grabación o reproducción de imágenes en movimiento, generalmente con sonido.",
  },
  "given": {
    pos: "adjetivo",
    translation: "dado, determinada",
    definition: "Que se establece o se supone como punto de partida o condición.",
  },
  "day-care": {
    pos: "sustantivo",
    translation: "guardería infantil",
    definition: "Centro donde se cuida y atiende a niños pequeños durante el día.",
  },
  "half": {
    pos: "sustantivo",
    translation: "mitad",
    definition: "Cada una de las dos partes iguales en que se divide un todo.",
  },
  "level": {
    pos: "sustantivo",
    translation: "nivel",
    definition: "Grado o posición alcanzada en una escala o jerarquía.",
  },
  "mind": {
    pos: "sustantivo",
    translation: "mente",
    definition: "Facultad del ser humano para pensar, razonar y tener conciencia.",
  },
  "make-believe": {
    pos: "sustantivo",
    translation: "fantasía, simulación",
    definition: "Ficción o simulación que se presenta como real en un juego o relato.",
  },
  "hand": {
    pos: "sustantivo",
    translation: "mano",
    definition: "Parte del cuerpo humano situada al final del brazo, con dedos y pulgar.",
  },
  "person-year": {
    pos: "sustantivo",
    translation: "año-persona",
    definition: "Unidad que representa el trabajo de una persona durante un año.",
  },
  "week-day": {
    pos: "sustantivo",
    translation: "día laborable",
    definition: "Día de la semana que no es festivo ni fin de semana.",
  },
  "stop-over": {
    pos: "sustantivo",
    translation: "escala, parada intermedia",
    definition: "Parada breve en un viaje antes de continuar al destino final.",
  },
  "true": {
    pos: "adjetivo",
    translation: "verdadero, cierto",
    definition: "Que se ajusta a la realidad o a los hechos; que es cierto o verídico.",
  },
  "often": {
    pos: "adverbio",
    translation: "a menudo, frecuentemente",
    definition: "Indica que algo ocurre con frecuencia o muchas veces.",
  },
  "single": {
    pos: "adjetivo",
    translation: "soltero, único, individual",
    definition: "Que no tiene pareja o que es uno solo, no doble ni múltiple.",
  },
  "about-face": {
    pos: "sustantivo",
    translation: "cambio radical de actitud",
    definition: "Giro completo en la posición, opinión o actitud de alguien.",
  },
  "body": {
    pos: "sustantivo",
    translation: "cuerpo",
    definition: "Parte material de un ser vivo que comprende todos sus órganos y estructuras.",
  },
  "control": {
    pos: "sustantivo",
    translation: "control, dominio",
    definition: "Capacidad o autoridad para dirigir, regular o dominar algo o a alguien.",
  },
  "become": {
    pos: "verbo",
    translation: "convertirse en, llegar a ser",
    definition: "Pasar a ser o a tener una nueva condición o estado.",
  },
  "coming": {
    pos: "sustantivo",
    translation: "llegada, venida",
    definition: "Acción de llegar o acercarse a un lugar.",
  },
  "death": {
    pos: "sustantivo",
    translation: "muerte",
    definition: "Fin de la vida de un ser vivo.",
  },
  "problem": {
    pos: "sustantivo",
    translation: "problema",
    definition: "Situación o cuestión que requiere una solución o que causa dificultad.",
  },
  "get-together": {
    pos: "sustantivo",
    translation: "reunión, encuentro informal",
    definition: "Reunión informal de personas para socializar o celebrar algo.",
  },
  "food": {
    pos: "sustantivo",
    translation: "comida, alimento",
    definition: "Sustancia que se ingiere para nutrir el organismo y mantener la vida.",
  },
  "south": {
    pos: "sustantivo",
    translation: "sur",
    definition: "Punto cardinal situado en dirección opuesta al norte.",
  },
  "office": {
    pos: "sustantivo",
    translation: "oficina",
    definition: "Lugar donde se realizan tareas administrativas o profesionales.",
  },
  "city-state": {
    pos: "sustantivo",
    translation: "ciudad-estado",
    definition: "Ciudad soberana que constituye un Estado independiente por sí misma.",
  },
  "fuck": {
    pos: "verbo",
    translation: "joder, follar",
    definition: "Mantener relaciones sexuales o, como interjección, expresar enfado o sorpresa.",
  },
  "war-time": {
    pos: "adjetivo",
    translation: "de tiempo de guerra",
    definition: "Relativo al período en que se libra una guerra o conflicto armado.",
  },
  "history": {
    pos: "sustantivo",
    translation: "historia",
    definition: "Conjunto de acontecimientos pasados y su estudio o narración.",
  },
  "research": {
    pos: "sustantivo",
    translation: "investigación, estudio",
    definition: "Estudio sistemático para descubrir o interpretar hechos y ampliar el conocimiento.",
  },
  "large": {
    pos: "adjetivo",
    translation: "grande, amplio",
    definition: "Que tiene un tamaño, extensión o cantidad mayor de lo normal.",
  },
  "almost": {
    pos: "adverbio",
    translation: "casi, por poco",
    definition: "Indica que algo está muy cerca de ser o suceder, pero no completamente.",
  },
  "known": {
    pos: "adjetivo",
    translation: "conocido, sabido",
    definition: "Que es conocido o reconocido por otros; de lo que se tiene conocimiento.",
  },
  "room": {
    pos: "sustantivo",
    translation: "habitación, cuarto, sala",
    definition: "Espacio cerrado dentro de un edificio, delimitado por paredes, destinado a un uso específico.",
  },
  "taking": {
    pos: "sustantivo",
    translation: "toma, acción de tomar",
    definition: "Acción o efecto de tomar algo; también se refiere a la captura o recepción.",
  },
  "university": {
    pos: "sustantivo",
    translation: "universidad",
    definition: "Institución de educación superior donde se imparten estudios y se otorgan títulos académicos.",
  },
  "several": {
    pos: "determinante",
    translation: "varios, varios/as",
    definition: "Indica una cantidad indeterminada pero superior a dos.",
  },
  "anyone": {
    pos: "pronombre",
    translation: "cualquiera, alguien, nadie",
    definition: "Pronombre indefinido que se refiere a cualquier persona, sin especificar quién.",
  },
  "wrong": {
    pos: "adjetivo",
    translation: "incorrecto, equivocado",
    definition: "Que no es correcto o que no se ajusta a la verdad o a la norma.",
  },
  "pretty": {
    pos: "adjetivo",
    translation: "bonito, lindo",
    definition: "Que resulta agradable a la vista por su belleza o armonía.",
  },
  "matter": {
    pos: "sustantivo",
    translation: "materia, asunto, cuestión",
    definition: "Sustancia física o tema del que se trata algo.",
  },
  "remember": {
    pos: "verbo",
    translation: "recordar",
    definition: "Tener en la memoria o traer a la mente algo del pasado.",
  },
  "girl": {
    pos: "sustantivo",
    translation: "niña, chica",
    definition: "Persona de sexo femenino, especialmente una niña o adolescente.",
  },
  "along": {
    pos: "preposición",
    translation: "a lo largo de",
    definition: "Indica movimiento o extensión siguiendo la longitud de algo.",
  },
  "well-order": {
    pos: "sustantivo",
    translation: "buen orden",
    definition: "Orden o disposición correcta y adecuada de las cosas.",
  },
  "nice": {
    pos: "adjetivo",
    translation: "agradable, simpático",
    definition: "Que resulta agradable, amable o satisfactorio para alguien.",
  },
  "life-support": {
    pos: "sustantivo",
    translation: "soporte vital",
    definition: "Sistema o conjunto de medios que mantiene las funciones vitales de un paciente.",
  },
  "time-course": {
    pos: "sustantivo",
    translation: "evolución temporal",
    definition: "Desarrollo o variación de un fenómeno a lo largo del tiempo.",
  },
  "off-white": {
    pos: "adjetivo",
    translation: "blanco roto",
    definition: "Color blanco con una ligera tonalidad amarilla o grisácea.",
  },
  "read-through": {
    pos: "sustantivo",
    translation: "lectura completa",
    definition: "Lectura completa de un texto o guion para revisarlo o ensayarlo.",
  },
  "saying": {
    pos: "sustantivo",
    translation: "dicho, refrán",
    definition: "Frase breve de sabiduría popular que expresa una verdad general.",
  },
  "hand-out": {
    pos: "sustantivo",
    translation: "folleto, hoja informativa",
    definition: "Documento impreso que se reparte a los asistentes de una reunión o clase.",
  },
  "close": {
    pos: "verbo",
    translation: "cerrar",
    definition: "Acción de mover algo para que deje de estar abierto o cubra una abertura.",
  },
  "give-away": {
    pos: "sustantivo",
    translation: "regalo promocional",
    definition: "Artículo que se regala con fines promocionales o de marketing.",
  },
  "york": {
    pos: "sustantivo",
    translation: "York (ciudad inglesa)",
    definition: "Ciudad histórica del norte de Inglaterra, capital del condado de Yorkshire.",
  },
  "understand": {
    pos: "verbo",
    translation: "entender, comprender",
    definition: "Captar el significado o el sentido de algo.",
  },
  "class": {
    pos: "sustantivo",
    translation: "clase",
    definition: "Grupo de estudiantes que reciben enseñanza juntos o asignatura que se imparte.",
  },
  "idea": {
    pos: "sustantivo",
    translation: "idea, concepto, noción",
    definition: "Representación mental de algo, concepto o plan que se forma en la mente.",
  },
  "half-time": {
    pos: "sustantivo",
    translation: "medio tiempo",
    definition: "Pausa entre las dos mitades de un partido o espectáculo.",
  },
  "love-making": {
    pos: "sustantivo",
    translation: "relaciones sexuales",
    definition: "Actividad sexual entre personas, especialmente referida al acto íntimo.",
  },
  "past": {
    pos: "sustantivo, adjetivo, preposición, adverbio",
    translation: "pasado, más allá de",
    definition: "Tiempo anterior al presente; también indica movimiento más allá de un punto.",
  },
  "international": {
    pos: "adjetivo",
    translation: "internacional",
    definition: "Que se relaciona con dos o más naciones o países.",
  },
  "possible": {
    pos: "adjetivo",
    translation: "posible",
    definition: "Que puede ocurrir, existir o realizarse.",
  },
  "run-off": {
    pos: "sustantivo",
    translation: "segunda vuelta",
    definition: "Votación final entre los dos candidatos más votados para desempatar una elección.",
  },
  "cause": {
    pos: "sustantivo",
    translation: "causa, motivo",
    definition: "Razón o motivo por el que sucede algo.",
  },
  "down-side": {
    pos: "sustantivo",
    translation: "desventaja, lado negativo",
    definition: "Aspecto negativo o inconveniente de una situación o decisión.",
  },
  "human": {
    pos: "adjetivo",
    translation: "humano",
    definition: "Relativo al ser humano o propio de él.",
  },
  "happy": {
    pos: "adjetivo",
    translation: "feliz, contento",
    definition: "Que siente o muestra alegría, satisfacción o bienestar.",
  },
  "series": {
    pos: "sustantivo",
    translation: "serie",
    definition: "Conjunto de cosas o eventos relacionados que se suceden uno tras otro.",
  },
  "move": {
    pos: "verbo",
    translation: "mover, moverse",
    definition: "Cambiar de lugar o posición algo o alguien.",
  },
  "wait": {
    pos: "verbo",
    translation: "esperar",
    definition: "Permanecer en un lugar o dejar de actuar hasta que ocurra algo.",
  },
  "d-day": {
    pos: "sustantivo",
    translation: "día D",
    definition: "Fecha clave para el inicio de una operación militar o de un acontecimiento decisivo.",
  },
  "question": {
    pos: "sustantivo",
    translation: "pregunta",
    definition: "Interrogación o duda que se plantea para obtener información o resolver algo.",
  },
  "woman": {
    pos: "sustantivo",
    translation: "mujer",
    definition: "Persona adulta de sexo femenino.",
  },
  "community": {
    pos: "sustantivo",
    translation: "comunidad",
    definition: "Grupo de personas que comparten intereses, valores o un espacio común.",
  },
  "life-line": {
    pos: "sustantivo",
    translation: "línea de vida",
    definition: "Cuerda o cable que sirve para salvar o asegurar a una persona en peligro.",
  },
  "leave": {
    pos: "verbo",
    translation: "irse, salir, dejar",
    definition: "Alejarse de un lugar o permitir que algo quede en un sitio.",
  },
  "late": {
    pos: "adjetivo",
    translation: "tarde, tardío",
    definition: "Que ocurre o llega después del tiempo esperado o habitual.",
  },
  "north": {
    pos: "sustantivo",
    translation: "norte",
    definition: "Punto cardinal que indica la dirección hacia el polo norte.",
  },
  "either": {
    pos: "conjunción",
    translation: "cualquiera de los dos",
    definition: "Indica una elección entre dos opciones o alternativas posibles.",
  },
  "special": {
    pos: "adjetivo",
    translation: "especial, particular",
    definition: "Que se distingue de lo común por alguna cualidad o característica.",
  },
  "run-through": {
    pos: "sustantivo",
    translation: "ensayo general",
    definition: "Ensayo completo de una obra o espectáculo antes de su presentación.",
  },
  "future": {
    pos: "sustantivo",
    translation: "futuro",
    definition: "Tiempo que está por venir o que aún no ha ocurrido.",
  },
  "watch": {
    pos: "sustantivo",
    translation: "reloj de pulsera",
    definition: "Instrumento que sirve para medir el tiempo y se lleva en la muñeca.",
  },
  "face-off": {
    pos: "sustantivo",
    translation: "enfrentamiento",
    definition: "Enfrentamiento directo entre dos personas o equipos.",
  },
  "morning": {
    pos: "sustantivo",
    translation: "mañana",
    definition: "Parte del día que va desde el amanecer hasta el mediodía.",
  },
  "million": {
    pos: "sustantivo",
    translation: "millón",
    definition: "Número cardinal equivalente a mil millares.",
  },
  "police": {
    pos: "sustantivo",
    translation: "policía",
    definition: "Cuerpo encargado de mantener el orden público y hacer cumplir la ley.",
  },
  "light": {
    pos: "sustantivo",
    translation: "luz",
    definition: "Radiación electromagnética que hace posible la visión.",
  },
  "stay": {
    pos: "verbo",
    translation: "quedarse, permanecer",
    definition: "Permanecer en un lugar o en un estado determinado.",
  },
  "deal": {
    pos: "sustantivo",
    translation: "acuerdo, trato",
    definition: "Acuerdo o convenio entre dos o más partes sobre un asunto.",
  },
  "yes-man": {
    pos: "sustantivo",
    translation: "adulador, pelota",
    definition: "Persona que siempre está de acuerdo con sus superiores para ganar su favor.",
  },
  "half-back": {
    pos: "sustantivo",
    translation: "medio apertura",
    definition: "Jugador de rugby que ocupa una posición entre los delanteros y los tres cuartos.",
  },
  "close-up": {
    pos: "sustantivo",
    translation: "primer plano",
    definition: "Toma fotográfica o cinematográfica de un objeto o persona desde muy cerca.",
  },
  "rather": {
    pos: "adverbio",
    translation: "más bien, bastante",
    definition: "Adverbio que indica preferencia, grado o contraste; equivale a 'más bien' o 'bastante'.",
  },
  "report": {
    pos: "sustantivo",
    translation: "informe, reporte",
    definition: "Documento que presenta información organizada sobre un tema o suceso.",
  },
  "reason": {
    pos: "sustantivo",
    translation: "razón, motivo",
    definition: "Facultad de pensar o causa que explica algo.",
  },
  "short": {
    pos: "adjetivo",
    translation: "corto, bajo",
    definition: "Que tiene poca longitud, altura o duración.",
  },
  "turn": {
    pos: "verbo",
    translation: "girar, dar vuelta",
    definition: "Mover algo o moverse alrededor de un eje o punto central.",
  },
  "third": {
    pos: "adjetivo",
    translation: "tercero, tercera",
    definition: "Que ocupa el lugar número tres en una serie ordenada.",
  },
  "soon": {
    pos: "adverbio",
    translation: "pronto, dentro de poco",
    definition: "Indica que algo ocurrirá en un tiempo breve o cercano al momento presente.",
  },
  "among": {
    pos: "preposición",
    translation: "entre",
    definition: "Indica que algo está rodeado o en medio de un grupo de cosas o personas.",
  },
  "check": {
    pos: "sustantivo",
    translation: "cheque, comprobación, marca",
    definition: "Documento de pago o acción de verificar y confirmar algo.",
  },
  "check-in": {
    pos: "sustantivo",
    translation: "registro de entrada",
    definition: "Proceso de registrarse al llegar a un hotel, aeropuerto o evento.",
  },
  "development": {
    pos: "sustantivo",
    translation: "desarrollo",
    definition: "Proceso de crecimiento, evolución o mejora de algo o alguien.",
  },
  "heart": {
    pos: "sustantivo",
    translation: "corazón",
    definition: "Órgano muscular que bombea la sangre por el cuerpo.",
  },
  "myself": {
    pos: "pronombre",
    translation: "yo mismo",
    definition: "Pronombre reflexivo que indica que la acción recae sobre el propio hablante.",
  },
  "turn-on": {
    pos: "sustantivo",
    translation: "estímulo excitante",
    definition: "Algo que provoca excitación o interés, especialmente de tipo sexual.",
  },
  "week-end": {
    pos: "sustantivo",
    translation: "fin de semana",
    definition: "Período de descanso semanal que comprende generalmente el sábado y el domingo.",
  },
  "whether": {
    pos: "conjunción",
    translation: "si",
    definition: "Introduce una duda o alternativa entre dos o más posibilidades.",
  },
  "yourself": {
    pos: "pronombre",
    translation: "tú mismo",
    definition: "Pronombre reflexivo que indica que la acción recae sobre la propia persona.",
  },
  "although": {
    pos: "conjunción",
    translation: "aunque, si bien",
    definition: "Conjunción que introduce una idea contraria o concesiva a lo expresado.",
  },
  "end-point": {
    pos: "sustantivo",
    translation: "punto final",
    definition: "Punto que marca el final o límite de algo, como un proceso o recorrido.",
  },
  "form": {
    pos: "sustantivo",
    translation: "forma, formulario",
    definition: "Figura o configuración exterior de algo, o documento con espacios para rellenar.",
  },
  "fire": {
    pos: "sustantivo",
    translation: "fuego",
    definition: "Combustión que produce luz, calor y llamas.",
  },
  "child": {
    pos: "sustantivo",
    translation: "niño, niña",
    definition: "Persona de corta edad, desde el nacimiento hasta la adolescencia.",
  },
  "living": {
    pos: "sustantivo",
    translation: "sustento, modo de vida",
    definition: "Medio o recursos con los que una persona se mantiene económicamente.",
  },
  "half-day": {
    pos: "sustantivo",
    translation: "medio día",
    definition: "Período de medio día, generalmente la mitad de una jornada laboral o escolar.",
  },
  "major": {
    pos: "adjetivo",
    translation: "principal, mayor",
    definition: "Que es más importante, grande o grave que otros de su misma clase.",
  },
  "phone": {
    pos: "sustantivo",
    translation: "teléfono",
    definition: "Dispositivo que permite comunicarse a distancia mediante señales eléctricas o inalámbricas.",
  },
  "help-line": {
    pos: "sustantivo",
    translation: "línea de ayuda",
    definition: "Servicio telefónico o en línea que ofrece asistencia o información a los usuarios.",
  },
  "media": {
    pos: "sustantivo",
    translation: "medios de comunicación",
    definition: "Conjunto de medios de comunicación social, como prensa, radio y televisión.",
  },
  "behind": {
    pos: "preposición",
    translation: "detrás de",
    definition: "Indica que algo está en la parte posterior o inferior a otra cosa.",
  },
  "building": {
    pos: "sustantivo",
    translation: "edificio, construcción",
    definition: "Estructura construida con materiales para ser habitada o usada.",
  },
  "house-party": {
    pos: "sustantivo",
    translation: "fiesta en casa",
    definition: "Reunión social celebrada en una casa, generalmente con invitados que se quedan a dormir.",
  },
  "half-life": {
    pos: "sustantivo",
    translation: "vida media",
    definition: "Tiempo que tarda una sustancia en reducirse a la mitad de su cantidad inicial.",
  },
  "about-turn": {
    pos: "sustantivo",
    translation: "cambio de sentido",
    definition: "Giro completo de 180 grados para cambiar de dirección o de opinión.",
  },
  "easy": {
    pos: "adjetivo",
    translation: "fácil, sencillo",
    definition: "Que requiere poco esfuerzo o dificultad para realizarse o comprenderse.",
  },
  "near": {
    pos: "preposición",
    translation: "cerca de",
    definition: "Indica proximidad en el espacio o el tiempo respecto a un punto de referencia.",
  },
  "phone-in": {
    pos: "sustantivo",
    translation: "programa de participación telefónica",
    definition: "Programa de radio o TV en el que el público participa llamando por teléfono.",
  },
  "pay-off": {
    pos: "sustantivo",
    translation: "pago, recompensa, soborno",
    definition: "Cantidad pagada como recompensa, resultado beneficioso o dinero entregado para obtener un favor.",
  },
  "money-making": {
    pos: "adjetivo",
    translation: "lucrativo, rentable",
    definition: "Que produce ganancias o beneficios económicos.",
  },
  "plan": {
    pos: "sustantivo",
    translation: "plan, proyecto",
    definition: "Conjunto de acciones organizadas para alcanzar un objetivo determinado.",
  },
  "political": {
    pos: "adjetivo",
    translation: "político, política",
    definition: "Relativo a la política o al gobierno y a los asuntos públicos.",
  },
  "quite": {
    pos: "adverbio",
    translation: "bastante, muy, totalmente",
    definition: "Adverbio que indica un grado alto o completo de una cualidad o acción.",
  },
  "west": {
    pos: "sustantivo",
    translation: "oeste, poniente",
    definition: "Punto cardinal situado en la dirección donde se pone el sol.",
  },
  "market": {
    pos: "sustantivo",
    translation: "mercado",
    definition: "Lugar o sistema donde se compran y venden bienes y servicios.",
  },
  "available": {
    pos: "adjetivo",
    translation: "disponible",
    definition: "Que se puede usar, obtener o encontrar cuando se necesita.",
  },
  "education": {
    pos: "sustantivo",
    translation: "educación, formación",
    definition: "Proceso de enseñar o adquirir conocimientos, habilidades y valores.",
  },
  "former": {
    pos: "adjetivo",
    translation: "anterior, antiguo",
    definition: "Que precede en el tiempo o ya no ocupa un cargo o posición.",
  },
  "front": {
    pos: "sustantivo",
    translation: "frente, parte delantera",
    definition: "Parte anterior o delantera de algo, o línea de combate.",
  },
  "list": {
    pos: "sustantivo",
    translation: "lista",
    definition: "Serie de elementos ordenados o enumerados de forma consecutiva.",
  },
  "sometimes": {
    pos: "adverbio",
    translation: "a veces",
    definition: "Indica que algo ocurre en algunas ocasiones, no siempre.",
  },
  "turn-up": {
    pos: "sustantivo",
    translation: "vuelta, dobladillo",
    definition: "Parte de una prenda que se dobla hacia fuera, o sorpresa inesperada.",
  },
  "ready": {
    pos: "adjetivo",
    translation: "listo, preparado",
    definition: "Que está preparado o dispuesto para hacer algo o para su uso.",
  },
  "street": {
    pos: "sustantivo",
    translation: "calle",
    definition: "Vía pública urbana, generalmente pavimentada, destinada al tránsito de personas y vehículos.",
  },
  "final": {
    pos: "adjetivo",
    translation: "final, último",
    definition: "Que es el último o concluye una serie o proceso.",
  },
  "turn-out": {
    pos: "sustantivo",
    translation: "asistencia, concurrencia",
    definition: "Número de personas que asisten a un evento o lugar.",
  },
  "wrong-take": {
    pos: "sustantivo",
    translation: "error de interpretación",
    definition: "Interpretación incorrecta o equivocada de algo.",
  },
  "check-out": {
    pos: "sustantivo",
    translation: "salida, caja, facturación",
    definition: "Acción de pagar y salir de un hotel o establecimiento, o la caja donde se paga.",
  },
  "current": {
    pos: "adjetivo",
    translation: "actual, corriente",
    definition: "Que ocurre o existe en el momento presente.",
  },
  "bring": {
    pos: "verbo",
    translation: "traer, llevar",
    definition: "Llevar o conducir algo o a alguien hacia el lugar donde está quien habla.",
  },
  "example": {
    pos: "sustantivo",
    translation: "ejemplo",
    definition: "Cosa o persona que sirve como modelo o muestra para imitar o explicar algo.",
  },
  "experience": {
    pos: "sustantivo",
    translation: "experiencia",
    definition: "Conocimiento o habilidad adquiridos mediante la práctica o la vivencia de situaciones.",
  },
  "check-up": {
    pos: "sustantivo",
    translation: "revisión médica",
    definition: "Examen médico general para comprobar el estado de salud de una persona.",
  },
  "meet": {
    pos: "verbo",
    translation: "conocer, encontrarse con",
    definition: "Encontrarse con alguien o algo en un lugar determinado.",
  },
  "london": {
    pos: "sustantivo",
    translation: "Londres",
    definition: "Capital del Reino Unido, situada a orillas del río Támesis.",
  },
  "program": {
    pos: "sustantivo",
    translation: "programa",
    definition: "Conjunto de instrucciones que ejecuta una computadora o plan organizado de actividades.",
  },
  "college": {
    pos: "sustantivo",
    translation: "universidad, colegio universitario",
    definition: "Institución de educación superior donde se imparten estudios y se otorgan títulos académicos.",
  },
  "baby": {
    pos: "sustantivo",
    translation: "bebé, nene",
    definition: "Niño o niña de muy corta edad, especialmente durante sus primeros meses de vida.",
  },
  "do-it-yourself": {
    pos: "locución",
    translation: "hazlo tú mismo",
    definition: "Actividad de hacer reparaciones o manualidades por cuenta propia sin profesionales.",
  },
  "hand-me-down": {
    pos: "sustantivo",
    translation: "ropa usada heredada",
    definition: "Prenda o artículo usado que pasa de una persona a otra, generalmente de mayor a menor.",
  },
  "type": {
    pos: "sustantivo",
    translation: "tipo, clase",
    definition: "Categoría o clase que comparte características comunes con otros elementos.",
  },
  "see-saw": {
    pos: "sustantivo",
    translation: "balancín, sube y baja",
    definition: "Juego infantil consistente en una tabla apoyada en un punto central que sube y baja alternativamente.",
  },
  "song": {
    pos: "sustantivo",
    translation: "canción",
    definition: "Composición musical con letra que se canta.",
  },
  "march": {
    pos: "sustantivo",
    translation: "marcha, desfile",
    definition: "Acción de caminar de forma ordenada y rítmica, especialmente en grupo o con fines militares.",
  },
  "chance": {
    pos: "sustantivo",
    translation: "oportunidad, azar",
    definition: "Circunstancia o posibilidad de que ocurra algo, o casualidad.",
  },
  "study": {
    pos: "sustantivo",
    translation: "estudio",
    definition: "Acción de adquirir conocimientos mediante la lectura, la observación o la práctica.",
  },
  "process": {
    pos: "sustantivo",
    translation: "proceso, procedimiento",
    definition: "Conjunto de etapas o acciones que se realizan para lograr un resultado.",
  },
  "across": {
    pos: "preposición",
    translation: "a través de",
    definition: "Indica movimiento o extensión de un lado a otro de algo.",
  },
  "word": {
    pos: "sustantivo",
    translation: "palabra",
    definition: "Unidad del lenguaje con significado que se escribe entre espacios.",
  },
  "month": {
    pos: "sustantivo",
    translation: "mes",
    definition: "Cada uno de los doce períodos en que se divide el año.",
  },
  "action": {
    pos: "sustantivo",
    translation: "acción",
    definition: "Hecho o efecto de hacer algo; actividad o movimiento.",
  },
  "outside": {
    pos: "adverbio",
    translation: "afuera, fuera",
    definition: "En o hacia el exterior de un lugar o espacio.",
  },
  "himself": {
    pos: "pronombre",
    translation: "él mismo, sí mismo",
    definition: "Pronombre reflexivo que indica que la acción recae sobre el propio sujeto masculino.",
  },
  "self": {
    pos: "sustantivo",
    translation: "yo, sí mismo",
    definition: "La identidad o persona propia de un individuo; el ser esencial de alguien.",
  },
  "clear": {
    pos: "adjetivo",
    translation: "claro, despejado, transparente",
    definition: "Que no tiene nada que impida la visión o el paso de la luz.",
  },
  "cost": {
    pos: "sustantivo",
    translation: "costo, coste",
    definition: "Cantidad de dinero o esfuerzo necesaria para obtener o hacer algo.",
  },
  "turn-over": {
    pos: "sustantivo",
    translation: "rotación de personal",
    definition: "Índice de empleados que dejan y son reemplazados en una empresa.",
  },
  "back-form": {
    pos: "sustantivo",
    translation: "formación regresiva",
    definition: "Palabra creada por derivación inversa a partir de otra más larga.",
  },
  "board": {
    pos: "sustantivo",
    translation: "tabla, tablero",
    definition: "Pieza plana de madera u otro material usada para construir o escribir.",
  },
  "instead": {
    pos: "adverbio",
    translation: "en lugar de",
    definition: "Indica que algo sustituye o reemplaza a otra cosa.",
  },
  "in-road": {
    pos: "sustantivo",
    translation: "entrada de camino",
    definition: "Punto de acceso o entrada a una vía o camino.",
  },
  "light-year": {
    pos: "sustantivo",
    translation: "año luz",
    definition: "Unidad de distancia astronómica equivalente a la distancia que recorre la luz en un año.",
  },
  "moment": {
    pos: "sustantivo",
    translation: "momento, instante",
    definition: "Punto específico en el tiempo en que ocurre algo.",
  },
  "main": {
    pos: "adjetivo",
    translation: "principal, más importante",
    definition: "Que es el más importante o destacado entre varios.",
  },
  "road": {
    pos: "sustantivo",
    translation: "carretera, camino",
    definition: "Vía de comunicación terrestre por la que circulan vehículos o personas.",
  },
  "field": {
    pos: "sustantivo",
    translation: "campo",
    definition: "Terreno amplio, generalmente abierto, destinado a cultivo, pasto o actividades al aire libre.",
  },
  "town": {
    pos: "sustantivo",
    translation: "pueblo, ciudad",
    definition: "Núcleo de población, generalmente menor que una ciudad, con cierta organización administrativa.",
  },
  "book-keep": {
    pos: "verbo",
    translation: "llevar la contabilidad",
    definition: "Registrar y organizar las cuentas y transacciones financieras de una empresa o entidad.",
  },
  "mother": {
    pos: "sustantivo",
    translation: "madre",
    definition: "Mujer que ha dado a luz o criado a un hijo.",
  },
  "department": {
    pos: "sustantivo",
    translation: "departamento, sección",
    definition: "División de una organización o empresa con funciones específicas.",
  },
  "court-house": {
    pos: "sustantivo",
    translation: "juzgado, palacio de justicia",
    definition: "Edificio donde se administran justicia y se celebran juicios.",
  },
  "fine": {
    pos: "adjetivo",
    translation: "fino, excelente, multa",
    definition: "De alta calidad, muy delgado o sanción económica según el contexto.",
  },
  "energy": {
    pos: "sustantivo",
    translation: "energía",
    definition: "Capacidad para realizar trabajo o producir cambios en un sistema.",
  },
  "issue": {
    pos: "sustantivo",
    translation: "asunto, problema, edición",
    definition: "Tema o problema que se discute, o cada número de una publicación periódica.",
  },
  "force": {
    pos: "sustantivo",
    translation: "fuerza, poder",
    definition: "Capacidad física o influencia que se ejerce sobre algo o alguien.",
  },
  "fight": {
    pos: "sustantivo",
    translation: "pelea, lucha",
    definition: "Enfrentamiento físico o verbal entre dos o más personas o grupos.",
  },
  "price": {
    pos: "sustantivo",
    translation: "precio",
    definition: "Cantidad de dinero que se paga por un bien o servicio.",
  },
  "on-road": {
    pos: "adjetivo",
    translation: "en carretera",
    definition: "Que se realiza o se encuentra en la vía pública o carretera.",
  },
  "mother-to-be": {
    pos: "sustantivo",
    translation: "futura madre",
    definition: "Mujer que está embarazada o espera un hijo.",
  },
  "hear": {
    pos: "verbo",
    translation: "oír, escuchar",
    definition: "Percibir sonidos con el oído o prestar atención a lo que se dice.",
  },
  "running": {
    pos: "sustantivo",
    translation: "correr, carrera",
    definition: "Acción de desplazarse a pie de forma rápida y continua.",
  },
  "rest": {
    pos: "sustantivo",
    translation: "descanso, reposo",
    definition: "Período de inactividad para recuperar fuerzas o aliviar la fatiga.",
  },
  "space": {
    pos: "sustantivo",
    translation: "espacio",
    definition: "Extensión o área que existe entre las cosas o que está libre para ocuparse.",
  },
  "term": {
    pos: "sustantivo",
    translation: "término, plazo, condición",
    definition: "Palabra, expresión o período con un significado o límite determinado.",
  },
  "beautiful": {
    pos: "adjetivo",
    translation: "hermoso, bello, precioso",
    definition: "Que tiene cualidades que producen placer a los sentidos o al espíritu.",
  },
  "turn-off": {
    pos: "sustantivo",
    translation: "desagrado, cosa que repele",
    definition: "Algo que produce rechazo o desagrado y hace perder el interés.",
  },
  "date": {
    pos: "sustantivo",
    translation: "fecha; cita; dátil",
    definition: "Día del calendario, encuentro romántico o fruto de la palmera datilera.",
  },
  "wife": {
    pos: "sustantivo",
    translation: "esposa",
    definition: "Mujer casada con respecto a su cónyuge.",
  },
  "land": {
    pos: "sustantivo",
    translation: "tierra, terreno",
    definition: "Superficie sólida de la corteza terrestre o extensión de terreno.",
  },
  "low-down": {
    pos: "sustantivo",
    translation: "información confidencial",
    definition: "Información secreta o privilegiada sobre algo o alguien.",
  },
  "self-will": {
    pos: "sustantivo",
    translation: "voluntad propia",
    definition: "Actitud obstinada de imponer la propia voluntad sin ceder a otros.",
  },
  "miss": {
    pos: "verbo",
    translation: "extrañar, echar de menos",
    definition: "Sentir la ausencia o falta de alguien o algo.",
  },
  "site": {
    pos: "sustantivo",
    translation: "sitio, lugar, emplazamiento",
    definition: "Lugar o espacio donde se ubica algo, especialmente un terreno o una página web.",
  },
  "shot": {
    pos: "sustantivo",
    translation: "disparo, tiro",
    definition: "Acción de disparar un arma o proyectil.",
  },
  "strong": {
    pos: "adjetivo",
    translation: "fuerte",
    definition: "Que tiene gran fuerza o resistencia física o moral.",
  },
  "project": {
    pos: "sustantivo",
    translation: "proyecto, plan",
    definition: "Plan o conjunto de actividades organizadas para alcanzar un objetivo determinado.",
  },
  "account": {
    pos: "sustantivo",
    translation: "cuenta",
    definition: "Registro de ingresos y gastos o estado financiero de una persona o entidad.",
  },
  "life-form": {
    pos: "sustantivo",
    translation: "forma de vida",
    definition: "Ser vivo o entidad biológica que existe en un entorno determinado.",
  },
  "include": {
    pos: "verbo",
    translation: "incluir, contener",
    definition: "Contener o abarcar algo dentro de sí o formar parte de un conjunto.",
  },
  "period": {
    pos: "sustantivo",
    translation: "período, punto, menstruación",
    definition: "Intervalo de tiempo determinado; también signo de puntuación o ciclo menstrual.",
  },
  "cut-out": {
    pos: "sustantivo",
    translation: "recorte, silueta recortada",
    definition: "Figura o pieza recortada de papel u otro material, generalmente con forma definida.",
  },
  "june": {
    pos: "sustantivo",
    translation: "junio",
    definition: "Sexto mes del año en el calendario gregoriano, con treinta días.",
  },
  "position": {
    pos: "sustantivo",
    translation: "posición, puesto, ubicación",
    definition: "Lugar o situación que ocupa algo o alguien en el espacio o en un orden.",
  },
  "record": {
    pos: "sustantivo",
    translation: "registro, disco, récord",
    definition: "Documento o soporte que conserva información; también marca máxima o disco musical.",
  },
  "similar": {
    pos: "adjetivo",
    translation: "similar, parecido",
    definition: "Que tiene semejanza o parecido con otra cosa.",
  },
  "white-water": {
    pos: "sustantivo",
    translation: "aguas bravas",
    definition: "Corriente de agua rápida y turbulenta, como en rápidos de ríos.",
  },
  "total": {
    pos: "adjetivo",
    translation: "total, completo",
    definition: "Que comprende o abarca todas las partes o aspectos de algo, sin excepción.",
  },
  "common": {
    pos: "adjetivo",
    translation: "común, corriente",
    definition: "Que se encuentra o sucede con frecuencia o es compartido por varios.",
  },
  "club": {
    pos: "sustantivo",
    translation: "club, asociación",
    definition: "Grupo de personas que se reúnen por un interés común o lugar donde se reúnen.",
  },
  "film": {
    pos: "sustantivo",
    translation: "película, filme",
    definition: "Obra cinematográfica o cinta que se graba y proyecta en el cine.",
  },
  "lead": {
    pos: "sustantivo",
    translation: "plomo",
    definition: "Metal pesado, blando, de color gris azulado y muy denso.",
  },
  "lead-in": {
    pos: "sustantivo",
    translation: "introducción, entrada",
    definition: "Parte inicial que introduce o prepara un tema, programa o texto.",
  },
  "likely": {
    pos: "adjetivo",
    translation: "probable, posible",
    definition: "Que tiene muchas probabilidades de ocurrir o de ser verdad.",
  },
  "one-shot": {
    pos: "sustantivo",
    translation: "tiro único",
    definition: "Disparo o intento único que se realiza una sola vez.",
  },
  "perfect": {
    pos: "adjetivo",
    translation: "perfecto, impecable",
    definition: "Que reúne todas las cualidades deseables y no tiene ningún defecto.",
  },
  "public-health": {
    pos: "sustantivo",
    translation: "salud pública",
    definition: "Disciplina que protege y mejora la salud de las poblaciones.",
  },
  "re-do": {
    pos: "verbo",
    translation: "volver a hacer",
    definition: "Hacer de nuevo algo que ya se había hecho.",
  },
  "re-up": {
    pos: "sustantivo",
    translation: "renovación de suministro",
    definition: "Acción de volver a abastecerse o renovar un suministro, especialmente drogas.",
  },
  "military": {
    pos: "adjetivo",
    translation: "militar",
    definition: "Relativo a las fuerzas armadas o a la guerra.",
  },
  "share": {
    pos: "verbo",
    translation: "compartir",
    definition: "Dar parte de algo propio para que otro lo use o disfrute.",
  },
  "personal": {
    pos: "adjetivo",
    translation: "personal, privado",
    definition: "Perteneciente o relativo a la persona o a lo privado de ella.",
  },
  "security": {
    pos: "sustantivo",
    translation: "seguridad",
    definition: "Estado de estar libre de peligro o riesgo.",
  },

  "april": {
    pos: "sustantivo",
    translation: "abril",
    definition: "Cuarto mes del año en el calendario gregoriano, de 30 días.",
  },
  "center": {
    pos: "sustantivo",
    translation: "centro",
    definition: "Punto o lugar que está en medio de algo o alrededor del cual se organiza.",
  },
  "english": {
    pos: "sustantivo",
    translation: "inglés",
    definition: "Idioma germánico originario de Inglaterra y hablado en muchos países.",
  },
  "couple": {
    pos: "sustantivo",
    translation: "pareja, par",
    definition: "Conjunto de dos personas o cosas unidas por una relación o semejanza.",
  },
  "county": {
    pos: "sustantivo",
    translation: "condado",
    definition: "División territorial o administrativa de un país, especialmente en Estados Unidos o Reino Unido.",
  },
  "hold": {
    pos: "verbo",
    translation: "sostener, mantener, agarrar",
    definition: "Sujetar o mantener algo con la mano o en una posición determinada.",
  },
  "industry": {
    pos: "sustantivo",
    translation: "industria",
    definition: "Conjunto de actividades económicas dedicadas a la transformación de materias primas en productos.",
  },
  "dead": {
    pos: "adjetivo",
    translation: "muerto, sin vida",
    definition: "Que ha dejado de vivir o carece de vida.",
  },
  "inside": {
    pos: "preposición",
    translation: "dentro de",
    definition: "Indica que algo está en el interior de un lugar o espacio.",
  },
  "player": {
    pos: "sustantivo",
    translation: "jugador, reproductor",
    definition: "Persona que juega o dispositivo que reproduce contenido audiovisual.",
  },
  "online": {
    pos: "adjetivo",
    translation: "en línea",
    definition: "Que está conectado a una red informática o disponible a través de internet.",
  },
  "sense": {
    pos: "sustantivo",
    translation: "sentido, sensación",
    definition: "Capacidad de percibir estímulos o significado de algo.",
  },
  "return": {
    pos: "verbo",
    translation: "volver, regresar, devolver",
    definition: "Ir de nuevo al lugar de donde se partió o restituir algo a su dueño.",
  },
  "private": {
    pos: "adjetivo",
    translation: "privado, particular",
    definition: "Que pertenece a una persona o grupo y no es de uso o acceso público.",
  },
  "star": {
    pos: "sustantivo",
    translation: "estrella",
    definition: "Cuerpo celeste que brilla con luz propia en el cielo nocturno.",
  },
  "happen": {
    pos: "verbo",
    translation: "suceder, ocurrir, pasar",
    definition: "Ocurrir o tener lugar un hecho o acontecimiento.",
  },
  "test": {
    pos: "sustantivo",
    translation: "prueba, examen",
    definition: "Evaluación o examen para medir conocimientos o habilidades.",
  },
  "view": {
    pos: "sustantivo",
    translation: "vista, panorama",
    definition: "Lo que se puede ver desde un lugar determinado.",
  },
  "british": {
    pos: "adjetivo",
    translation: "británico, del Reino Unido",
    definition: "Relativo al Reino Unido, su pueblo o su cultura.",
  },
  "break": {
    pos: "verbo",
    translation: "romper, quebrar",
    definition: "Separar o dividir algo en partes por fuerza o presión.",
  },
  "middle": {
    pos: "sustantivo",
    translation: "medio, centro",
    definition: "Punto o parte central de algo, equidistante de sus extremos.",
  },
  "event": {
    pos: "sustantivo",
    translation: "evento, acontecimiento",
    definition: "Suceso o acontecimiento que ocurre en un lugar y momento determinados.",
  },
  "hour": {
    pos: "sustantivo",
    translation: "hora",
    definition: "Período de tiempo de sesenta minutos.",
  },
  "member": {
    pos: "sustantivo",
    translation: "miembro",
    definition: "Persona que forma parte de un grupo, organización o comunidad.",
  },
  "present": {
    pos: "sustantivo",
    translation: "regalo, presente",
    definition: "Cosa que se da a alguien como muestra de afecto o cortesía.",
  },
  "training": {
    pos: "sustantivo",
    translation: "entrenamiento, formación",
    definition: "Proceso de adquirir habilidades o conocimientos mediante práctica y estudio.",
  },
  "sorry": {
    pos: "adjetivo",
    translation: "arrepentido, lamentando",
    definition: "Que siente pesar o arrepentimiento por algo que ha hecho o que ha ocurrido.",
  },
  "result": {
    pos: "sustantivo",
    translation: "resultado",
    definition: "Efecto o consecuencia de una acción, proceso o suceso.",
  },
  "wish": {
    pos: "verbo",
    translation: "desear, querer",
    definition: "Sentir deseo o anhelo de que algo ocurra o sea realidad.",
  },
  "july": {
    pos: "sustantivo",
    translation: "julio",
    definition: "Séptimo mes del año en el calendario gregoriano, con 31 días.",
  },
  "answer": {
    pos: "sustantivo",
    translation: "respuesta, contestación",
    definition: "Acción o efecto de responder a una pregunta o solicitud.",
  },
  "guess": {
    pos: "verbo",
    translation: "adivinar, suponer",
    definition: "Formar una opinión o conjetura sin tener certeza absoluta.",
  },
  "interest": {
    pos: "sustantivo",
    translation: "interés",
    definition: "Sentimiento de curiosidad o atención hacia algo o alguien.",
  },
  "learn": {
    pos: "verbo",
    translation: "aprender",
    definition: "Adquirir conocimiento o habilidad mediante el estudio o la experiencia.",
  },
  "gold": {
    pos: "sustantivo",
    translation: "oro",
    definition: "Metal precioso amarillo, brillante y muy valorado usado en joyería y como reserva de valor.",
  },
  "design": {
    pos: "sustantivo",
    translation: "diseño",
    definition: "Representación gráfica o conceptual de un objeto o proyecto.",
  },
  "king": {
    pos: "sustantivo",
    translation: "rey",
    definition: "Monarca o soberano varón de un reino.",
  },
  "policy": {
    pos: "sustantivo",
    translation: "política, póliza",
    definition: "Conjunto de normas o directrices; también documento de seguro.",
  },
  "society": {
    pos: "sustantivo",
    translation: "sociedad",
    definition: "Conjunto de personas que conviven y se relacionan bajo normas comunes.",
  },
  "bank": {
    pos: "sustantivo",
    translation: "banco",
    definition: "Institución financiera que recibe depósitos y concede préstamos.",
  },
  "alone": {
    pos: "adjetivo/adverbio",
    translation: "solo, sola",
    definition: "Que está sin compañía o sin ayuda de nadie.",
  },
  "average": {
    pos: "sustantivo, adjetivo, verbo",
    translation: "promedio, media; medio; promediar",
    definition: "Valor medio obtenido al dividir la suma de varias cantidades entre su número.",
  },
  "church": {
    pos: "sustantivo",
    translation: "iglesia",
    definition: "Edificio o comunidad cristiana dedicada al culto religioso.",
  },
  "certain": {
    pos: "adjetivo",
    translation: "cierto, seguro, determinado",
    definition: "Que es seguro, verdadero o que se refiere a algo específico sin nombrarlo.",
  },
  "east": {
    pos: "sustantivo",
    translation: "este",
    definition: "Punto cardinal por donde sale el sol.",
  },
  "original": {
    pos: "adjetivo",
    translation: "original, auténtico, primitivo",
    definition: "Que es propio o característico de alguien o algo, o que no es copia de otra cosa.",
  },
  "medical": {
    pos: "adjetivo",
    translation: "médico, relativo a la medicina",
    definition: "Perteneciente o relativo a la medicina o a la práctica de curar enfermedades.",
  },
  "park": {
    pos: "sustantivo",
    translation: "parque",
    definition: "Zona verde pública destinada al recreo y esparcimiento.",
  },
  "movie": {
    pos: "sustantivo",
    translation: "película",
    definition: "Obra cinematográfica que narra una historia mediante imágenes en movimiento.",
  },
  "role": {
    pos: "sustantivo",
    translation: "papel, función",
    definition: "Función o papel que desempeña una persona o cosa en una situación determinada.",
  },
  "press": {
    pos: "sustantivo",
    translation: "prensa, imprenta",
    definition: "Máquina o conjunto de medios que imprimen y difunden información.",
  },
  "themselves": {
    pos: "pronombre",
    translation: "ellos mismos",
    definition: "Pronombre reflexivo que indica que la acción recae sobre el sujeto plural que la realiza.",
  },
  "performance": {
    pos: "sustantivo",
    translation: "rendimiento, actuación, desempeño",
    definition: "Resultado o nivel de eficacia con que se realiza una actividad o tarea.",
  },
  "worth": {
    pos: "sustantivo",
    translation: "valor, mérito",
    definition: "Cualidad o valor que hace a alguien o algo digno de aprecio o estima.",
  },
  "september": {
    pos: "sustantivo",
    translation: "septiembre",
    definition: "Noveno mes del año en el calendario gregoriano, con 30 días.",
  },
  "cool": {
    pos: "adjetivo",
    translation: "genial, guay, fresco",
    definition: "Que es atractivo, moderno o agradable; también se refiere a algo fresco o a temperatura moderada.",
  },
  "ground": {
    pos: "sustantivo",
    translation: "suelo, tierra",
    definition: "Superficie de la tierra o terreno sobre el que se está.",
  },
  "bill": {
    pos: "sustantivo",
    translation: "factura, cuenta",
    definition: "Documento que detalla los bienes o servicios prestados y su importe a pagar.",
  },
  "relationship": {
    pos: "sustantivo",
    translation: "relación",
    definition: "Vínculo o conexión entre personas, cosas o ideas.",
  },
  "director": {
    pos: "sustantivo",
    translation: "director, directora",
    definition: "Persona que dirige una organización, empresa, proyecto o actividad.",
  },
  "sound": {
    pos: "sustantivo",
    translation: "sonido",
    definition: "Sensación producida en el oído por vibraciones del aire u otro medio.",
  },
  "source": {
    pos: "sustantivo",
    translation: "fuente, origen",
    definition: "Lugar o cosa de donde procede o se origina algo.",
  },
  "value": {
    pos: "sustantivo",
    translation: "valor",
    definition: "Cualidad o mérito que hace que algo sea apreciado o importante.",
  },
  "provide": {
    pos: "verbo",
    translation: "proporcionar, suministrar",
    definition: "Dar o poner a disposición de alguien algo que necesita o requiere.",
  },
  "evidence": {
    pos: "sustantivo",
    translation: "evidencia, prueba",
    definition: "Prueba o testimonio que sirve para demostrar la verdad de un hecho.",
  },
  "meeting": {
    pos: "sustantivo",
    translation: "reunión, encuentro",
    definition: "Encuentro de personas para tratar un tema o asunto.",
  },
  "official": {
    pos: "adjetivo",
    translation: "oficial",
    definition: "Relativo al cargo, autoridad o institución que ejerce el poder público.",
  },
  "follow": {
    pos: "verbo",
    translation: "seguir",
    definition: "Ir detrás de alguien o algo, o continuar su ejemplo o camino.",
  },
  "reading": {
    pos: "sustantivo",
    translation: "lectura",
    definition: "Acción de leer o interpretar un texto.",
  },
  "production": {
    pos: "sustantivo",
    translation: "producción",
    definition: "Acción o proceso de fabricar, crear o generar bienes, servicios o resultados.",
  },
  "round": {
    pos: "adjetivo",
    translation: "redondo, circular",
    definition: "Que tiene forma de círculo o esfera, o que carece de ángulos.",
  },
  "stand": {
    pos: "sustantivo",
    translation: "puesto, tribuna, soporte",
    definition: "Estructura o mueble donde se coloca algo, o lugar desde el que se vende o expone.",
  },
  "save": {
    pos: "verbo",
    translation: "guardar, ahorrar, salvar",
    definition: "Conservar algo para uso futuro, rescatar de un peligro o almacenar datos.",
  },
  "stuff": {
    pos: "sustantivo",
    translation: "cosas, material",
    definition: "Conjunto de cosas o materia indeterminada de la que se habla.",
  },
  "rate": {
    pos: "sustantivo",
    translation: "tasa, tarifa, índice",
    definition: "Cantidad o proporción que se usa como referencia para medir o calcular algo.",
  },
  "whatever": {
    pos: "pronombre",
    translation: "lo que sea",
    definition: "Pronombre que expresa indiferencia o falta de restricción sobre algo.",
  },
  "amount": {
    pos: "sustantivo",
    translation: "cantidad, monto, importe",
    definition: "Cantidad o suma de algo, especialmente de dinero o de una sustancia.",
  },
  "drive": {
    pos: "verbo",
    translation: "conducir, manejar",
    definition: "Operar un vehículo para desplazarse de un lugar a otro.",
  },
  "blue": {
    pos: "adjetivo",
    translation: "azul",
    definition: "Color del cielo despejado, entre el verde y el violeta.",
  },
  "fast": {
    pos: "adjetivo",
    translation: "rápido, veloz",
    definition: "Que se mueve o actúa a gran velocidad.",
  },
  "federal": {
    pos: "adjetivo",
    translation: "federal",
    definition: "Relativo a la federación o a la unión de estados que forman un país.",
  },
  "fall": {
    pos: "verbo",
    translation: "caer",
    definition: "Moverse hacia abajo por la acción de la gravedad.",
  },
  "felt": {
    pos: "sustantivo",
    translation: "fieltro",
    definition: "Tela gruesa y afelpada hecha de fibras de lana o pelo prensadas.",
  },
  "feeling": {
    pos: "sustantivo",
    translation: "sentimiento, sensación",
    definition: "Estado emocional o sensación física que experimenta una persona.",
  },
  "league": {
    pos: "sustantivo",
    translation: "liga, asociación",
    definition: "Grupo de personas o entidades unidas por un objetivo o interés común.",
  },
  "green": {
    pos: "adjetivo",
    translation: "verde",
    definition: "Color de la luz que se encuentra entre el amarillo y el azul en el espectro visible.",
  },
  "management": {
    pos: "sustantivo",
    translation: "gestión, administración",
    definition: "Acción y efecto de gestionar o administrar recursos, personas o procesos.",
  },
  "picture": {
    pos: "sustantivo",
    translation: "imagen, cuadro, foto",
    definition: "Representación visual de algo, como una imagen, pintura o fotografía.",
  },
  "match": {
    pos: "sustantivo",
    translation: "partido, fósforo, cerilla",
    definition: "Competición deportiva o pequeño objeto que produce fuego al frotarlo.",
  },
  "trust": {
    pos: "sustantivo",
    translation: "confianza",
    definition: "Creencia firme en la honestidad y fiabilidad de alguien o algo.",
  },
  "model": {
    pos: "sustantivo",
    translation: "modelo",
    definition: "Persona o cosa que sirve de referencia o ejemplo a imitar.",
  },
  "step": {
    pos: "sustantivo",
    translation: "paso, escalón",
    definition: "Movimiento o acción de levantar un pie y volverlo a apoyar para avanzar.",
  },
  "size": {
    pos: "sustantivo",
    translation: "tamaño, talla",
    definition: "Dimensiones o medidas de una cosa, o talla de una prenda o persona.",
  },
  "central": {
    pos: "adjetivo",
    translation: "central, céntrico",
    definition: "Que está en el centro o es el más importante de un conjunto.",
  },
  "page": {
    pos: "sustantivo",
    translation: "página",
    definition: "Cada una de las caras de una hoja de papel o de un libro.",
  },
  "forward": {
    pos: "adverbio",
    translation: "hacia adelante",
    definition: "Indica movimiento o dirección hacia la parte delantera o hacia el frente.",
  },
  "range": {
    pos: "sustantivo",
    translation: "rango, alcance, gama",
    definition: "Conjunto de valores o elementos entre un límite inferior y uno superior.",
  },
  "science": {
    pos: "sustantivo",
    translation: "ciencia",
    definition: "Conjunto de conocimientos obtenidos mediante la observación y el razonamiento sistemático.",
  },
  "review": {
    pos: "sustantivo",
    translation: "reseña, revisión",
    definition: "Análisis o examen crítico de algo, como una obra o un producto.",
  },
  "trade": {
    pos: "sustantivo",
    translation: "comercio, oficio",
    definition: "Actividad de comprar y vender bienes o servicios, o el oficio que se ejerce.",
  },
  "upon": {
    pos: "preposición",
    translation: "sobre, encima de",
    definition: "Indica posición superior o contacto con una superficie, o un momento inmediato a otro.",
  },
  "various": {
    pos: "adjetivo",
    translation: "varios, diversas",
    definition: "Que se refiere a un conjunto de cosas o personas diferentes entre sí.",
  },
  "october": {
    pos: "sustantivo",
    translation: "octubre",
    definition: "Décimo mes del año en el calendario gregoriano, con 31 días.",
  },
  "character": {
    pos: "sustantivo",
    translation: "personaje; carácter",
    definition: "Persona o ser de una obra de ficción, o conjunto de rasgos que definen a alguien.",
  },
  "brother": {
    pos: "sustantivo",
    translation: "hermano",
    definition: "Persona de sexo masculino respecto a los hijos de sus mismos padres.",
  },
  "attention": {
    pos: "sustantivo",
    translation: "atención",
    definition: "Capacidad de concentrarse en algo o interés que se presta a alguien o algo.",
  },
  "football": {
    pos: "sustantivo",
    translation: "fútbol",
    definition: "Deporte de equipo en el que dos equipos intentan marcar goles con un balón.",
  },
  "chief": {
    pos: "sustantivo",
    translation: "jefe, líder",
    definition: "Persona que dirige o encabeza un grupo, organización o tribu.",
  },
  "natural": {
    pos: "adjetivo",
    translation: "natural, innato",
    definition: "Que pertenece a la naturaleza o se produce sin intervención humana.",
  },
  "lower": {
    pos: "verbo",
    translation: "bajar, reducir, disminuir",
    definition: "Hacer que algo descienda o disminuya en cantidad, nivel o intensidad.",
  },
  "property": {
    pos: "sustantivo",
    translation: "propiedad, bien",
    definition: "Cosa que pertenece a alguien o atributo o cualidad de algo.",
  },
  "hate": {
    pos: "verbo",
    translation: "odiar, detestar",
    definition: "Sentir aversión o rechazo intenso hacia alguien o algo.",
  },
  "send": {
    pos: "verbo",
    translation: "enviar, mandar",
    definition: "Hacer que algo o alguien vaya de un lugar a otro.",
  },
  "august": {
    pos: "adjetivo",
    translation: "augusto, majestuoso, venerable",
    definition: "Que inspira respeto y admiración por su dignidad o grandeza.",
  },
  "style": {
    pos: "sustantivo",
    translation: "estilo",
    definition: "Manera característica de expresarse, vestir o hacer algo.",
  },
  "quality": {
    pos: "sustantivo",
    translation: "calidad",
    definition: "Conjunto de propiedades o características que definen a una persona o cosa.",
  },
  "november": {
    pos: "sustantivo",
    translation: "noviembre",
    definition: "Undécimo mes del año en el calendario gregoriano, con 30 días.",
  },
  "vote": {
    pos: "sustantivo",
    translation: "voto",
    definition: "Expresión formal de una elección o preferencia en una votación.",
  },
  "complete": {
    pos: "adjetivo",
    translation: "completo, entero",
    definition: "Que tiene todas sus partes o elementos, sin que falte nada.",
  },
  "blood": {
    pos: "sustantivo",
    translation: "sangre",
    definition: "Líquido rojo que circula por el cuerpo y transporta oxígeno y nutrientes.",
  },
  "china": {
    pos: "sustantivo",
    translation: "porcelana, vajilla de porcelana",
    definition: "Material cerámico fino y translúcido, o la vajilla fabricada con él.",
  },
  "itself": {
    pos: "pronombre",
    translation: "sí mismo, él mismo",
    definition: "Pronombre reflexivo que indica que la acción recae sobre la propia cosa o persona mencionada.",
  },
  "hell": {
    pos: "sustantivo",
    translation: "infierno",
    definition: "Lugar o estado de castigo eterno asociado al mal y al sufrimiento.",
  },
  "economic": {
    pos: "adjetivo",
    translation: "económico, relativo a la economía",
    definition: "Perteneciente o relativo a la economía o que permite ahorrar recursos.",
  },
  "lord": {
    pos: "sustantivo",
    translation: "señor, amo, noble",
    definition: "Persona con autoridad, dominio o título nobiliario sobre otros.",
  },
  "serious": {
    pos: "adjetivo",
    translation: "serio, grave",
    definition: "Que actúa con reflexión y responsabilidad, sin frivolidad.",
  },
  "stage": {
    pos: "sustantivo",
    translation: "escenario, etapa, fase",
    definition: "Lugar donde se presentan espectáculos o cada fase de un proceso.",
  },
  "title": {
    pos: "sustantivo",
    translation: "título",
    definition: "Palabra o frase que identifica una obra, cargo o persona.",
  },
  "language": {
    pos: "sustantivo",
    translation: "idioma, lenguaje",
    definition: "Sistema de comunicación verbal propio de una comunidad humana.",
  },
  "january": {
    pos: "sustantivo",
    translation: "enero",
    definition: "Primer mes del año en el calendario gregoriano, con 31 días.",
  },
  "born": {
    pos: "adjetivo",
    translation: "nacido",
    definition: "Que ha venido al mundo mediante el nacimiento.",
  },
  "french": {
    pos: "sustantivo",
    translation: "francés",
    definition: "Persona originaria de Francia o relativa a ese país.",
  },
  "attack": {
    pos: "sustantivo",
    translation: "ataque",
    definition: "Acción de agredir o dañar a alguien o algo.",
  },
  "article": {
    pos: "sustantivo",
    translation: "artículo",
    definition: "Palabra que acompaña al sustantivo para determinarlo o cuantificarlo.",
  },
  "decision": {
    pos: "sustantivo",
    translation: "decisión",
    definition: "Elección o determinación que se toma tras considerar varias opciones.",
  },
  "enjoy": {
    pos: "verbo",
    translation: "disfrutar, gozar",
    definition: "Sentir placer o satisfacción al hacer o experimentar algo.",
  },
  "damn": {
    pos: "interjección",
    translation: "¡maldita sea!",
    definition: "Expresa enojo, frustración o sorpresa ante una situación.",
  },
  "entire": {
    pos: "adjetivo",
    translation: "entero, completo",
    definition: "Que incluye todas las partes o elementos de algo, sin que falte ninguno.",
  },
  "perhaps": {
    pos: "adverbio",
    translation: "tal vez, quizás",
    definition: "Expresa duda o posibilidad sobre lo que se dice.",
  },
  "kill": {
    pos: "verbo",
    translation: "matar, asesinar",
    definition: "Quitar la vida a un ser vivo.",
  },
  "release": {
    pos: "sustantivo",
    translation: "lanzamiento, liberación",
    definition: "Acción de poner en libertad o hacer disponible algo al público.",
  },
  "poor": {
    pos: "adjetivo",
    translation: "pobre",
    definition: "Que carece de recursos económicos o de lo necesario para vivir.",
  },
  "european": {
    pos: "adjetivo",
    translation: "europeo, europea",
    definition: "Relativo a Europa o a sus habitantes.",
  },
  "technology": {
    pos: "sustantivo",
    translation: "tecnología",
    definition: "Conjunto de conocimientos y técnicas aplicados para crear bienes o servicios.",
  },
  "website": {
    pos: "sustantivo",
    translation: "sitio web",
    definition: "Conjunto de páginas web relacionadas accesibles mediante una dirección en internet.",
  },
  "situation": {
    pos: "sustantivo",
    translation: "situación",
    definition: "Conjunto de circunstancias en que se encuentra alguien o algo en un momento dado.",
  },
  "code": {
    pos: "sustantivo",
    translation: "código",
    definition: "Conjunto de reglas o símbolos que representan información de forma sistemática.",
  },
  "continue": {
    pos: "verbo",
    translation: "continuar, seguir",
    definition: "Seguir haciendo algo o proseguir una acción sin interrupción.",
  },
  "council": {
    pos: "sustantivo",
    translation: "consejo, ayuntamiento",
    definition: "Grupo de personas que se reúnen para deliberar, asesorar o gobernar.",
  },
  "cover": {
    pos: "sustantivo",
    translation: "cubierta, portada",
    definition: "Parte exterior que protege o cubre algo, como la tapa de un libro o la cubierta de un objeto.",
  },
  "choice": {
    pos: "sustantivo",
    translation: "elección, opción",
    definition: "Acto de elegir entre varias posibilidades o la opción seleccionada.",
  },
  "foreign": {
    pos: "adjetivo",
    translation: "extranjero, foráneo",
    definition: "Que pertenece o es originario de otro país o nación.",
  },
  "financial": {
    pos: "adjetivo",
    translation: "financiero, financiera",
    definition: "Relativo a las finanzas o al manejo del dinero.",
  },
  "door": {
    pos: "sustantivo",
    translation: "puerta",
    definition: "Abertura en una pared para entrar o salir de un lugar.",
  },
  "legal": {
    pos: "adjetivo",
    translation: "legal, lícito, jurídico",
    definition: "Conforme a la ley o relativo al derecho y sus normas.",
  },
  "lose": {
    pos: "verbo",
    translation: "perder",
    definition: "Dejar de tener algo que se poseía o no conservarlo.",
  },
  "election": {
    pos: "sustantivo",
    translation: "elección, comicios",
    definition: "Proceso por el que se elige a alguien para un cargo mediante votación.",
  },
  "hair": {
    pos: "sustantivo",
    translation: "cabello, pelo",
    definition: "Conjunto de filamentos que crecen en la piel de personas y animales.",
  },
  "increase": {
    pos: "verbo",
    translation: "aumentar, incrementar",
    definition: "Hacer que algo sea mayor en cantidad, tamaño o intensidad.",
  },
  "pick": {
    pos: "verbo",
    translation: "recoger, elegir",
    definition: "Seleccionar o tomar algo entre varias opciones.",
  },
  "seem": {
    pos: "verbo",
    translation: "parecer",
    definition: "Dar la impresión de ser o de estar de una determinada manera.",
  },
  "seven": {
    pos: "sustantivo",
    translation: "siete",
    definition: "Número cardinal que equivale a seis más uno.",
  },
  "race": {
    pos: "sustantivo",
    translation: "carrera, raza",
    definition: "Competición de velocidad o grupo étnico de personas.",
  },
  "simple": {
    pos: "adjetivo",
    translation: "simple, sencillo",
    definition: "Que no tiene complicación o que está formado por pocos elementos.",
  },
  "sign": {
    pos: "sustantivo",
    translation: "letrero, señal",
    definition: "Objeto o marca que indica o comunica algo.",
  },
  "walk": {
    pos: "verbo",
    translation: "caminar, andar",
    definition: "Moverse a pie de un lugar a otro a paso moderado.",
  },
  "december": {
    pos: "sustantivo",
    translation: "diciembre",
    definition: "Duodécimo y último mes del año en el calendario gregoriano.",
  },
  "staff": {
    pos: "sustantivo",
    translation: "personal, equipo",
    definition: "Conjunto de personas que trabajan en una organización o empresa.",
  },
  "super": {
    pos: "adjetivo",
    translation: "súper, excelente",
    definition: "Que es muy bueno, excelente o de calidad superior.",
  },
  "union": {
    pos: "sustantivo",
    translation: "unión, sindicato",
    definition: "Asociación de trabajadores o acción de unir cosas o personas.",
  },
  "daily": {
    pos: "adjetivo",
    translation: "diario, cotidiano",
    definition: "Que ocurre o se hace todos los días.",
  },
  "career": {
    pos: "sustantivo",
    translation: "carrera profesional",
    definition: "Trayectoria profesional de una persona a lo largo de su vida laboral.",
  },
  "daughter": {
    pos: "sustantivo",
    translation: "hija",
    definition: "Persona de sexo femenino respecto de sus padres.",
  },
  "crazy": {
    pos: "adjetivo",
    translation: "loco, demente",
    definition: "Que ha perdido la razón o se comporta de forma irracional.",
  },
  "hospital": {
    pos: "sustantivo",
    translation: "hospital",
    definition: "Establecimiento donde se atiende y trata a enfermos y heridos.",
  },
  "difficult": {
    pos: "adjetivo",
    translation: "difícil",
    definition: "Que presenta dificultad u obstáculos para realizarse o comprenderse.",
  },
  "paper": {
    pos: "sustantivo",
    translation: "papel",
    definition: "Material delgado hecho de pasta de celulosa, usado para escribir, imprimir o envolver.",
  },
  "modern": {
    pos: "adjetivo",
    translation: "moderno, moderna",
    definition: "Que pertenece al tiempo presente o a una época reciente.",
  },
  "popular": {
    pos: "adjetivo",
    translation: "popular, del pueblo",
    definition: "Que es conocido, aceptado o apreciado por mucha gente.",
  },
  "loss": {
    pos: "sustantivo",
    translation: "pérdida",
    definition: "Pérdida o privación de algo que se tenía o poseía.",
  },
  "figure": {
    pos: "sustantivo",
    translation: "figura, cifra, forma",
    definition: "Representación, forma o cifra que muestra el aspecto o valor de algo.",
  },
  "safe": {
    pos: "adjetivo",
    translation: "seguro, a salvo",
    definition: "Que está libre de peligro o riesgo.",
  },
  "voice": {
    pos: "sustantivo",
    translation: "voz",
    definition: "Sonido producido por las cuerdas vocales al hablar o cantar.",
  },
  "version": {
    pos: "sustantivo",
    translation: "versión",
    definition: "Cada una de las formas o interpretaciones de algo, como un texto o programa.",
  },
  "army": {
    pos: "sustantivo",
    translation: "ejército",
    definition: "Conjunto organizado de fuerzas militares de un país.",
  },
  "writing": {
    pos: "sustantivo",
    translation: "escritura, texto escrito",
    definition: "Acción o efecto de escribir; también obra o texto escrito.",
  },
  "earth": {
    pos: "sustantivo",
    translation: "tierra, suelo",
    definition: "El planeta en que vivimos o la superficie sólida del suelo.",
  },
  "forget": {
    pos: "verbo",
    translation: "olvidar",
    definition: "Dejar de tener en la memoria algo o a alguien.",
  },
  "goal": {
    pos: "sustantivo",
    translation: "meta, objetivo",
    definition: "Fin o propósito que se pretende alcanzar con una acción.",
  },
  "internet": {
    pos: "sustantivo",
    translation: "red de redes",
    definition: "Red mundial de computadoras interconectadas que comparten información.",
  },
  "huge": {
    pos: "adjetivo",
    translation: "enorme, gigantesco",
    definition: "Que es extremadamente grande en tamaño, cantidad o grado.",
  },
  "listen": {
    pos: "verbo",
    translation: "escuchar",
    definition: "Prestar atención a un sonido o a lo que alguien dice.",
  },
  "okay": {
    pos: "interjección",
    translation: "vale, de acuerdo",
    definition: "Expresión para indicar aprobación, conformidad o que algo está bien.",
  },
  "practice": {
    pos: "sustantivo",
    translation: "práctica",
    definition: "Ejercicio repetido de una actividad para mejorar una habilidad o destreza.",
  },
  "success": {
    pos: "sustantivo",
    translation: "éxito, triunfo",
    definition: "Resultado favorable o logro de lo que se desea o intenta.",
  },
  "towards": {
    pos: "preposición",
    translation: "hacia, en dirección a",
    definition: "Indica la dirección o el destino hacia el que se orienta algo o alguien.",
  },
  "access": {
    pos: "sustantivo",
    translation: "acceso",
    definition: "Facultad o medio para entrar, llegar o usar algo.",
  },
  "base": {
    pos: "sustantivo",
    translation: "base, fundamento",
    definition: "Parte inferior o fundamento sobre el que se apoya algo.",
  },
  "deep": {
    pos: "adjetivo",
    translation: "profundo, hondo",
    definition: "Que tiene gran distancia desde la superficie hasta el fondo o que es intenso y penetrante.",
  },
  "offer": {
    pos: "verbo",
    translation: "ofrecer",
    definition: "Presentar algo a alguien para que lo acepte o rechace.",
  },
  "mark": {
    pos: "sustantivo",
    translation: "marca, señal",
    definition: "Una señal o indicio visible que deja algo sobre una superficie.",
  },
  "risk": {
    pos: "sustantivo",
    translation: "riesgo, peligro",
    definition: "Posibilidad de que ocurra un daño o resultado adverso.",
  },
  "professional": {
    pos: "adjetivo",
    translation: "profesional",
    definition: "Relativo a una profesión o realizado por alguien capacitado en ella.",
  },
  "pass": {
    pos: "sustantivo",
    translation: "pase",
    definition: "Documento o permiso que autoriza a alguien a entrar o circular en un lugar.",
  },
  "truth": {
    pos: "sustantivo",
    translation: "verdad",
    definition: "Conformidad de lo que se dice con lo que se siente o se piensa.",
  },
  "table": {
    pos: "sustantivo",
    translation: "mesa",
    definition: "Mueble con superficie plana sostenida por patas, usado para comer o trabajar.",
  },
  "sleep": {
    pos: "verbo",
    translation: "dormir",
    definition: "Descansar con los ojos cerrados y sin conciencia, generalmente por la noche.",
  },
  "ball": {
    pos: "sustantivo",
    translation: "pelota, bola, balón",
    definition: "Objeto esférico que se usa en juegos y deportes.",
  },
  "district": {
    pos: "sustantivo",
    translation: "distrito, zona",
    definition: "Área o región delimitada de un territorio con características o administración propias.",
  },
  "build": {
    pos: "verbo",
    translation: "construir, edificar",
    definition: "Crear o levantar una estructura o edificio uniendo materiales o partes.",
  },
  "dark": {
    pos: "adjetivo",
    translation: "oscuro, sombrío",
    definition: "Que tiene poca o ninguna luz; que carece de claridad o luminosidad.",
  },
  "card": {
    pos: "sustantivo",
    translation: "tarjeta, carta",
    definition: "Pieza rectangular de cartón o plástico usada para jugar, identificar o pagar.",
  },
  "note": {
    pos: "sustantivo",
    translation: "nota",
    definition: "Comunicación breve escrita o mensaje que se envía o se deja a alguien.",
  },
  "minister": {
    pos: "sustantivo",
    translation: "ministro, ministra",
    definition: "Persona que dirige un departamento del gobierno o ejerce un cargo de autoridad.",
  },
  "percent": {
    pos: "sustantivo",
    translation: "por ciento",
    definition: "Expresa una proporción o tasa calculada sobre una base de cien unidades.",
  },
  "piece": {
    pos: "sustantivo",
    translation: "pieza, trozo",
    definition: "Parte o porción de un todo, generalmente separada de él.",
  },
  "straight": {
    pos: "adjetivo",
    translation: "recto, derecho",
    definition: "Que no tiene curvas ni inclinaciones; también se refiere a alguien heterosexual.",
  },
  "february": {
    pos: "sustantivo",
    translation: "febrero",
    definition: "Segundo mes del año, de 28 o 29 días, entre enero y marzo.",
  },
  "visit": {
    pos: "verbo",
    translation: "visitar",
    definition: "Ir a ver a alguien o acudir a un lugar.",
  },
  "culture": {
    pos: "sustantivo",
    translation: "cultura",
    definition: "Conjunto de conocimientos, costumbres y formas de vida de un pueblo o grupo social.",
  },
  "recent": {
    pos: "adjetivo",
    translation: "reciente, recién ocurrido",
    definition: "Que ha ocurrido o aparecido hace poco tiempo.",
  },
  "growth": {
    pos: "sustantivo",
    translation: "crecimiento",
    definition: "Aumento o desarrollo progresivo de algo en tamaño, cantidad o importancia.",
  },
  "wall": {
    pos: "sustantivo",
    translation: "pared, muro",
    definition: "Estructura vertical que delimita o cierra un espacio.",
  },
  "response": {
    pos: "sustantivo",
    translation: "respuesta",
    definition: "Acción o efecto de responder a una pregunta, estímulo o situación.",
  },
  "pain": {
    pos: "sustantivo",
    translation: "dolor",
    definition: "Sensación desagradable física o emocional causada por daño o enfermedad.",
  },
  "rock": {
    pos: "sustantivo",
    translation: "roca, piedra",
    definition: "Masa sólida de materia mineral que forma parte de la corteza terrestre.",
  },
  "speak": {
    pos: "verbo",
    translation: "hablar",
    definition: "Expresar ideas o pensamientos mediante palabras.",
  },
  "officer": {
    pos: "sustantivo",
    translation: "oficial, agente",
    definition: "Persona que ocupa un cargo de mando o autoridad, especialmente en el ejército o la policía.",
  },
  "standard": {
    pos: "sustantivo",
    translation: "estándar, norma",
    definition: "Conjunto de reglas o criterios que sirven como referencia para medir o evaluar algo.",
  },
  "respect": {
    pos: "sustantivo",
    translation: "respeto",
    definition: "Sentimiento de consideración y estima hacia alguien o algo.",
  },
  "specific": {
    pos: "adjetivo",
    translation: "específico, concreto, determinado",
    definition: "Que es preciso, determinado o particular, sin ambigüedad ni generalidad.",
  },
  "tonight": {
    pos: "adverbio",
    translation: "esta noche",
    definition: "En la noche del día de hoy.",
  },
  "album": {
    pos: "sustantivo",
    translation: "álbum",
    definition: "Colección de canciones, fotografías o sellos reunidos en un mismo soporte.",
  },
  "charge": {
    pos: "sustantivo",
    translation: "cargo, acusación, carga",
    definition: "Responsabilidad, acusación formal o energía eléctrica almacenada.",
  },
  "century": {
    pos: "sustantivo",
    translation: "siglo",
    definition: "Período de cien años.",
  },
  "write": {
    pos: "verbo",
    translation: "escribir",
    definition: "Representar ideas o palabras mediante signos gráficos sobre un soporte.",
  },
  "effect": {
    pos: "sustantivo",
    translation: "efecto, resultado",
    definition: "Resultado o consecuencia de una acción o causa.",
  },
  "cold": {
    pos: "adjetivo",
    translation: "frío, resfriado",
    definition: "Que tiene una temperatura baja o que carece de calor.",
  },
  "create": {
    pos: "verbo",
    translation: "crear",
    definition: "Producir o dar origen a algo nuevo, como una idea, obra o cosa.",
  },
  "except": {
    pos: "preposición",
    translation: "excepto, salvo",
    definition: "Indica exclusión o excepción de algo mencionado.",
  },
  "eight": {
    pos: "sustantivo",
    translation: "ocho",
    definition: "Número cardinal que equivale a siete más uno.",
  },
  "network": {
    pos: "sustantivo",
    translation: "red",
    definition: "Conjunto de elementos interconectados que comparten información o recursos.",
  },
  "peace": {
    pos: "sustantivo",
    translation: "paz",
    definition: "Estado de tranquilidad y ausencia de conflictos o guerras.",
  },
  "funny": {
    pos: "adjetivo",
    translation: "gracioso, divertido",
    definition: "Que causa risa o diversión; también puede significar extraño o sospechoso.",
  },
  "sales": {
    pos: "sustantivo",
    translation: "ventas",
    definition: "Actividades relacionadas con la venta de bienes o servicios.",
  },
  "student": {
    pos: "sustantivo",
    translation: "estudiante, alumno",
    definition: "Persona que cursa estudios en un centro educativo.",
  },
  "tomorrow": {
    pos: "adverbio",
    translation: "mañana",
    definition: "Día siguiente al actual.",
  },
  "store": {
    pos: "sustantivo",
    translation: "tienda, comercio",
    definition: "Establecimiento donde se venden productos o mercancías al público.",
  },
  "chinese": {
    pos: "adjetivo",
    translation: "chino, de China",
    definition: "Relativo a China, su gente, su lengua o su cultura.",
  },
  "weight": {
    pos: "sustantivo",
    translation: "peso",
    definition: "Medida de la fuerza gravitatoria que actúa sobre un cuerpo.",
  },
  "track": {
    pos: "sustantivo",
    translation: "pista, vía, sendero",
    definition: "Camino o vía marcada por la que se transita o se sigue un recorrido.",
  },
  "russian": {
    pos: "adjetivo",
    translation: "ruso, de Rusia",
    definition: "Relativo a Rusia, su gente, su lengua o su cultura.",
  },
  "ahead": {
    pos: "adverbio",
    translation: "adelante, por delante",
    definition: "Indica que algo está o va delante en el espacio o en el tiempo.",
  },
  "association": {
    pos: "sustantivo",
    translation: "asociación",
    definition: "Grupo de personas o entidades organizadas para un fin común.",
  },
  "allow": {
    pos: "verbo",
    translation: "permitir, dejar",
    definition: "Dar permiso o consentimiento para que algo ocurra o se haga.",
  },
  "addition": {
    pos: "sustantivo",
    translation: "suma, adición",
    definition: "Operación matemática de sumar dos o más cantidades para obtener un total.",
  },
  "anti": {
    pos: "prefijo",
    translation: "anti, contra",
    definition: "Prefijo que indica oposición o contrariedad.",
  },
  "brown": {
    pos: "adjetivo",
    translation: "marrón, café",
    definition: "Color oscuro similar al de la tierra o la madera.",
  },
  "beat": {
    pos: "verbo",
    translation: "golpear, vencer, latir",
    definition: "Golpear repetidamente o derrotar a alguien; también, pulsar rítmicamente.",
  },
  "capital": {
    pos: "sustantivo",
    translation: "capital, mayúscula",
    definition: "Ciudad principal o letra mayúscula; también dinero o recursos invertidos.",
  },
  "conference": {
    pos: "sustantivo",
    translation: "conferencia, congreso",
    definition: "Reunión de personas para tratar un tema, a menudo con ponentes.",
  },
  "committee": {
    pos: "sustantivo",
    translation: "comité, comisión",
    definition: "Grupo de personas designadas para tomar decisiones o realizar una tarea en nombre de una organización.",
  },
  "difference": {
    pos: "sustantivo",
    translation: "diferencia",
    definition: "Cualidad o aspecto por el que una cosa se distingue de otra.",
  },
  "island": {
    pos: "sustantivo",
    translation: "isla",
    definition: "Porción de tierra rodeada de agua por todas partes.",
  },
  "double": {
    pos: "adjetivo",
    translation: "doble",
    definition: "Que es dos veces mayor o que consta de dos partes iguales.",
  },
  "expect": {
    pos: "verbo",
    translation: "esperar, suponer",
    definition: "Creer que algo va a suceder o que alguien actuará de cierta manera.",
  },
  "normal": {
    pos: "adjetivo",
    translation: "normal, habitual, corriente",
    definition: "Que se ajusta a lo común, habitual o a la norma establecida.",
  },
  "potential": {
    pos: "adjetivo",
    translation: "potencial, posible",
    definition: "Que tiene la capacidad o posibilidad de existir o desarrollarse en el futuro.",
  },
  "population": {
    pos: "sustantivo",
    translation: "población",
    definition: "Conjunto de personas que habitan un lugar o territorio determinado.",
  },
  "radio": {
    pos: "sustantivo",
    translation: "radio",
    definition: "Aparato que recibe y reproduce señales de audio transmitidas por ondas electromagnéticas.",
  },
  "treatment": {
    pos: "sustantivo",
    translation: "tratamiento, terapia",
    definition: "Conjunto de medios o procedimientos usados para curar o aliviar una enfermedad.",
  },
  "pressure": {
    pos: "sustantivo",
    translation: "presión",
    definition: "Fuerza que se ejerce sobre una superficie o influencia para persuadir a alguien.",
  },
  "text": {
    pos: "sustantivo",
    translation: "texto",
    definition: "Conjunto de palabras escritas que forman un mensaje o documento.",
  },
  "western": {
    pos: "sustantivo",
    translation: "película del oeste",
    definition: "Género cinematográfico ambientado en el viejo oeste estadounidense.",
  },
  "beginning": {
    pos: "sustantivo",
    translation: "principio, comienzo, inicio",
    definition: "Momento o punto en que algo empieza o se inicia.",
  },
  "station": {
    pos: "sustantivo",
    translation: "estación, terminal",
    definition: "Lugar o edificio donde se detienen trenes, autobuses u otros medios de transporte.",
  },
  "content": {
    pos: "sustantivo",
    translation: "contenido",
    definition: "Conjunto de cosas o ideas que están dentro de algo o que se expresan en una obra.",
  },
  "california": {
    pos: "sustantivo",
    translation: "California",
    definition: "Estado de Estados Unidos situado en la costa oeste.",
  },
  "credit": {
    pos: "sustantivo",
    translation: "crédito",
    definition: "Cantidad de dinero prestada o confianza en la solvencia de alguien.",
  },
  "campaign": {
    pos: "sustantivo",
    translation: "campaña",
    definition: "Conjunto de acciones organizadas para lograr un objetivo político, militar o publicitario.",
  },
  "despite": {
    pos: "preposición",
    translation: "a pesar de",
    definition: "Indica que algo ocurre sin que lo impida un obstáculo o circunstancia contraria.",
  },
  "cross": {
    pos: "sustantivo",
    translation: "cruz",
    definition: "Figura formada por dos líneas que se cortan perpendicularmente.",
  },
  "female": {
    pos: "adjetivo",
    translation: "femenino, hembra",
    definition: "Que pertenece al sexo que produce óvulos o que tiene órganos reproductores femeninos.",
  },
  "focus": {
    pos: "sustantivo",
    translation: "enfoque, foco",
    definition: "Centro de atención o punto principal de algo.",
  },
  "husband": {
    pos: "sustantivo",
    translation: "marido, esposo",
    definition: "Hombre casado, considerado en relación con su cónyuge.",
  },
  "individual": {
    pos: "adjetivo",
    translation: "individual, particular",
    definition: "Que se refiere a una sola persona o cosa, considerada por separado.",
  },
  "join": {
    pos: "verbo",
    translation: "unir, juntar",
    definition: "Unir o conectar dos o más cosas para formar un todo.",
  },
  "previous": {
    pos: "adjetivo",
    translation: "previo, anterior",
    definition: "Que precede en tiempo u orden a otra cosa.",
  },
  "message": {
    pos: "sustantivo",
    translation: "mensaje",
    definition: "Comunicación oral o escrita que una persona envía a otra.",
  },
  "section": {
    pos: "sustantivo",
    translation: "sección, parte",
    definition: "Parte o división de un todo, especialmente de un documento, obra o lugar.",
  },
  "sort": {
    pos: "sustantivo",
    translation: "tipo, clase",
    definition: "Conjunto de cosas o personas que comparten características comunes.",
  },
  "speed": {
    pos: "sustantivo",
    translation: "velocidad",
    definition: "Rapidez con que se mueve o actúa algo o alguien.",
  },
  "particular": {
    pos: "adjetivo",
    translation: "particular, específico",
    definition: "Que es propio o característico de una persona o cosa, o que se refiere a un caso concreto.",
  },
  "region": {
    pos: "sustantivo",
    translation: "región, zona, área",
    definition: "Porción de territorio delimitada por características geográficas o administrativas.",
  },
  "travel": {
    pos: "sustantivo",
    translation: "viaje, viajar",
    definition: "Acción de desplazarse de un lugar a otro, generalmente a cierta distancia.",
  },
  "consider": {
    pos: "verbo",
    translation: "considerar, tener en cuenta",
    definition: "Tener en cuenta o reflexionar sobre algo antes de tomar una decisión.",
  },
  "drop": {
    pos: "sustantivo",
    translation: "gota",
    definition: "Pequeña cantidad de líquido con forma esférica que cae o pende.",
  },
  "link": {
    pos: "sustantivo",
    translation: "enlace, vínculo",
    definition: "Elemento que conecta o une dos cosas o personas entre sí.",
  },
  "fair": {
    pos: "adjetivo",
    translation: "justo, equitativo",
    definition: "Que actúa con justicia e imparcialidad, tratando a todos por igual.",
  },
  "contact": {
    pos: "sustantivo",
    translation: "contacto",
    definition: "Persona o cosa con la que se tiene comunicación o relación.",
  },
  "sale": {
    pos: "sustantivo",
    translation: "venta, rebaja",
    definition: "Acción de vender algo o precio rebajado de un producto.",
  },
  "throughout": {
    pos: "preposición",
    translation: "a lo largo de, durante todo",
    definition: "Indica que algo ocurre o se extiende durante todo un período o en todo un lugar.",
  },
  "welcome": {
    pos: "sustantivo",
    translation: "bienvenida",
    definition: "Palabra o gesto con que se recibe a alguien con cortesía y alegría.",
  },
  "positive": {
    pos: "adjetivo",
    translation: "positivo, optimista",
    definition: "Que es afirmativo, favorable o muestra optimismo ante las situaciones.",
  },
  "additional": {
    pos: "adjetivo",
    translation: "adicional, extra",
    definition: "Que se añade o suma a algo ya existente.",
  },
  "tour": {
    pos: "sustantivo",
    translation: "gira, recorrido turístico",
    definition: "Viaje o recorrido organizado para visitar lugares de interés.",
  },
  "extra": {
    pos: "adjetivo",
    translation: "adicional, extra",
    definition: "Que se añade a lo normal o esperado, o que es de calidad superior.",
  },
  "beyond": {
    pos: "preposición",
    translation: "más allá de",
    definition: "Indica que algo está más lejos o supera un límite.",
  },
  "minute": {
    pos: "sustantivo",
    translation: "minuto",
    definition: "Unidad de tiempo equivalente a sesenta segundos.",
  },
  "nature": {
    pos: "sustantivo",
    translation: "naturaleza",
    definition: "Conjunto de seres y fenómenos del mundo físico y su orden inherente.",
  },
  "quick": {
    pos: "adjetivo",
    translation: "rápido, veloz",
    definition: "Que se mueve o actúa con gran velocidad.",
  },
  "significant": {
    pos: "adjetivo",
    translation: "significativo, importante",
    definition: "Que tiene importancia, relevancia o un efecto notable.",
  },
  "sell": {
    pos: "verbo",
    translation: "vender",
    definition: "Transferir la propiedad de algo a otra persona a cambio de dinero.",
  },
  "winning": {
    pos: "adjetivo",
    translation: "ganador, triunfador",
    definition: "Que gana o tiene éxito en una competición o actividad.",
  },
  "unless": {
    pos: "conjunción",
    translation: "a menos que",
    definition: "Introduce una condición negativa que impide que ocurra lo expresado en la oración principal.",
  },
  "clean": {
    pos: "adjetivo",
    translation: "limpio, aseado",
    definition: "Que no tiene suciedad ni manchas.",
  },
  "computer": {
    pos: "sustantivo",
    translation: "computadora, ordenador",
    definition: "Máquina electrónica que procesa datos y ejecuta programas informáticos.",
  },
  "agree": {
    pos: "verbo",
    translation: "estar de acuerdo",
    definition: "Aceptar o compartir la misma opinión o parecer que otra persona.",
  },
  "construction": {
    pos: "sustantivo",
    translation: "construcción",
    definition: "Acción o efecto de construir algo, como un edificio u obra.",
  },
  "episode": {
    pos: "sustantivo",
    translation: "episodio, capítulo",
    definition: "Cada una de las partes en que se divide una serie, obra o suceso.",
  },
  "favorite": {
    pos: "adjetivo",
    translation: "favorito, preferido",
    definition: "Que es preferido o tiene la preferencia de alguien sobre otros.",
  },
  "income": {
    pos: "sustantivo",
    translation: "ingreso, renta",
    definition: "Dinero que una persona o entidad recibe regularmente por su trabajo o inversiones.",
  },
  "justice": {
    pos: "sustantivo",
    translation: "justicia",
    definition: "Principio moral que consiste en dar a cada uno lo que le corresponde.",
  },
  "movement": {
    pos: "sustantivo",
    translation: "movimiento",
    definition: "Acción o efecto de mover o moverse algo o alguien.",
  },
  "manager": {
    pos: "sustantivo",
    translation: "gerente, director",
    definition: "Persona que dirige o administra una empresa, equipo o negocio.",
  },
  "photo": {
    pos: "sustantivo",
    translation: "foto, fotografía",
    definition: "Imagen obtenida mediante la acción de la luz sobre una superficie sensible.",
  },
  "scene": {
    pos: "sustantivo",
    translation: "escena, lugar",
    definition: "Lugar o parte de una obra donde ocurre una acción.",
  },
  "safety": {
    pos: "sustantivo",
    translation: "seguridad",
    definition: "Condición de estar libre de peligro o riesgo.",
  },
  "statement": {
    pos: "sustantivo",
    translation: "declaración, afirmación",
    definition: "Expresión oral o escrita en la que se comunica algo de forma clara.",
  },
  "ability": {
    pos: "sustantivo",
    translation: "habilidad, capacidad",
    definition: "Capacidad o aptitud para realizar algo.",
  },
  "friday": {
    pos: "sustantivo",
    translation: "viernes",
    definition: "Quinto día de la semana, entre el jueves y el sábado.",
  },
  "coach": {
    pos: "sustantivo",
    translation: "entrenador, autobús",
    definition: "Persona que entrena a un deportista o equipo; también vehículo para transportar pasajeros.",
  },
  "spend": {
    pos: "verbo",
    translation: "gastar, pasar tiempo",
    definition: "Usar dinero o tiempo en algo, o emplear recursos para un fin.",
  },
  "calling": {
    pos: "sustantivo",
    translation: "vocación, llamamiento",
    definition: "Inclinación o impulso hacia una profesión o misión, o acción de llamar.",
  },
  "collection": {
    pos: "sustantivo",
    translation: "colección",
    definition: "Conjunto de objetos o elementos reunidos y organizados según un criterio.",
  },
  "knowledge": {
    pos: "sustantivo",
    translation: "conocimiento, saber",
    definition: "Conjunto de información y comprensión adquiridas mediante estudio o experiencia.",
  },
  "heavy": {
    pos: "adjetivo",
    translation: "pesado",
    definition: "Que tiene mucho peso o que resulta difícil de levantar o mover.",
  },
  "search": {
    pos: "verbo",
    translation: "buscar, registrar",
    definition: "Examinar o registrar algo para encontrar a una persona u objeto.",
  },
  "subject": {
    pos: "sustantivo",
    translation: "tema, asignatura, súbdito",
    definition: "Persona o cosa de la que se habla, o materia de estudio.",
  },
  "wide": {
    pos: "adjetivo",
    translation: "ancho, amplio",
    definition: "Que tiene gran extensión de un lado a otro.",
  },
  "train": {
    pos: "sustantivo",
    translation: "tren",
    definition: "Vehículo ferroviario que circula sobre raíles para transportar pasajeros o mercancías.",
  },
  "german": {
    pos: "sustantivo",
    translation: "alemán, germano",
    definition: "Persona natural de Alemania o de habla alemana.",
  },
  "author": {
    pos: "sustantivo",
    translation: "autor, autora",
    definition: "Persona que crea o escribe una obra literaria, artística o científica.",
  },
  "centre": {
    pos: "sustantivo",
    translation: "centro",
    definition: "Punto o lugar central de algo, o institución dedicada a una actividad específica.",
  },
  "global": {
    pos: "adjetivo",
    translation: "global, mundial",
    definition: "Que abarca o se refiere al conjunto total de algo, no solo a una parte.",
  },
  "hotel": {
    pos: "sustantivo",
    translation: "hotel, alojamiento",
    definition: "Establecimiento donde se alojan huéspedes a cambio de un pago.",
  },
  "claim": {
    pos: "sustantivo",
    translation: "reclamación, afirmación",
    definition: "Afirmación de que algo es cierto o derecho a exigir algo.",
  },
  "judge": {
    pos: "sustantivo",
    translation: "juez, jueza",
    definition: "Persona que decide y sentencia en un juicio o tribunal.",
  },
  "leader": {
    pos: "sustantivo",
    translation: "líder, dirigente",
    definition: "Persona que dirige o encabeza un grupo, organización o movimiento.",
  },
  "fear": {
    pos: "sustantivo",
    translation: "miedo, temor",
    definition: "Emoción de angustia ante un peligro o amenaza real o imaginaria.",
  },
  "lady": {
    pos: "sustantivo",
    translation: "dama, señora",
    definition: "Mujer adulta, especialmente la que tiene modales refinados o una posición social distinguida.",
  },
  "nobody": {
    pos: "pronombre",
    translation: "nadie, ninguna persona",
    definition: "Pronombre que indica que no existe ninguna persona o que ninguna persona realiza la acción.",
  },
  "opportunity": {
    pos: "sustantivo",
    translation: "oportunidad",
    definition: "Circunstancia favorable que permite hacer o lograr algo.",
  },
  "material": {
    pos: "sustantivo",
    translation: "material, sustancia",
    definition: "Sustancia o conjunto de cosas con que se hace algo o que sirven para un fin.",
  },
  "plus": {
    pos: "preposición",
    translation: "más",
    definition: "Indica suma o adición de una cantidad a otra.",
  },
  "product": {
    pos: "sustantivo",
    translation: "producto",
    definition: "Resultado o cosa producida por un proceso natural, industrial o intelectual.",
  },
  "letter": {
    pos: "sustantivo",
    translation: "carta, letra",
    definition: "Mensaje escrito que se envía a alguien, o cada signo gráfico del alfabeto.",
  },
  "regular": {
    pos: "adjetivo",
    translation: "regular, habitual, normal",
    definition: "Que sigue una norma, es habitual o se ajusta a lo establecido.",
  },
  "sister": {
    pos: "sustantivo",
    translation: "hermana",
    definition: "Mujer o hija que comparte uno o ambos progenitores con otra persona.",
  },
  "secretary": {
    pos: "sustantivo",
    translation: "secretario, secretaria",
    definition: "Persona que se encarga de tareas administrativas y de oficina.",
  },
  "unit": {
    pos: "sustantivo",
    translation: "unidad",
    definition: "Cantidad o elemento individual considerado como una sola entidad.",
  },
  "annual": {
    pos: "adjetivo",
    translation: "anual",
    definition: "Que ocurre o se repite una vez al año.",
  },
  "anymore": {
    pos: "adverbio",
    translation: "ya no",
    definition: "Indica que algo ha dejado de ocurrir o ya no es así.",
  },
  "battle": {
    pos: "sustantivo",
    translation: "batalla, combate",
    definition: "Enfrentamiento armado entre ejércitos o fuerzas contrarias.",
  },
  "brain": {
    pos: "sustantivo",
    translation: "cerebro",
    definition: "Órgano del sistema nervioso central que controla las funciones del cuerpo y el pensamiento.",
  },
  "contract": {
    pos: "sustantivo",
    translation: "contrato",
    definition: "Acuerdo legal entre dos o más partes que crea obligaciones exigibles.",
  },
  "degree": {
    pos: "sustantivo",
    translation: "grado, título, nivel",
    definition: "Unidad de medida de ángulos o temperatura, o nivel alcanzado en estudios o una escala.",
  },
  "floor": {
    pos: "sustantivo",
    translation: "suelo, piso",
    definition: "Superficie inferior de una habitación sobre la que se camina.",
  },
  "hurt": {
    pos: "verbo",
    translation: "doler, herir, lastimar",
    definition: "Causar dolor físico o daño a alguien o algo.",
  },
  "image": {
    pos: "sustantivo",
    translation: "imagen",
    definition: "Representación visual de algo, como una figura, fotografía o ilustración.",
  },
  "insurance": {
    pos: "sustantivo",
    translation: "seguro",
    definition: "Contrato por el que se cubre un riesgo mediante el pago de una prima.",
  },
  "majority": {
    pos: "sustantivo",
    translation: "mayoría",
    definition: "Parte mayor de un conjunto de personas o cosas respecto al total.",
  },
  "opinion": {
    pos: "sustantivo",
    translation: "opinión",
    definition: "Juicio o valoración que una persona tiene sobre algo o alguien.",
  },
  "opening": {
    pos: "sustantivo",
    translation: "apertura, hueco, inauguración",
    definition: "Acción de abrir algo o espacio por donde se accede a un lugar.",
  },
  "physical": {
    pos: "adjetivo",
    translation: "físico, corporal",
    definition: "Relativo al cuerpo o a la naturaleza material de las cosas.",
  },
  "reach": {
    pos: "verbo",
    translation: "alcanzar, llegar a",
    definition: "Llegar a un lugar o alcanzar un objetivo o cosa.",
  },
  "rule": {
    pos: "sustantivo",
    translation: "regla, norma",
    definition: "Principio o norma que establece cómo debe hacerse algo o regular una conducta.",
  },
  "successful": {
    pos: "adjetivo",
    translation: "exitoso, próspero",
    definition: "Que tiene éxito o resulta favorable en lo que emprende.",
  },
  "stupid": {
    pos: "adjetivo",
    translation: "estúpido, tonto",
    definition: "Que carece de inteligencia o sentido común.",
  },
  "australian": {
    pos: "adjetivo",
    translation: "australiano",
    definition: "Relativo a Australia o a sus habitantes.",
  },
  "active": {
    pos: "adjetivo",
    translation: "activo, activa",
    definition: "Que tiene la capacidad de actuar o funcionar con energía y eficacia.",
  },
  "approach": {
    pos: "sustantivo",
    translation: "enfoque, acercamiento",
    definition: "Manera de abordar o considerar un asunto, o acción de acercarse a algo.",
  },
  "cancer": {
    pos: "sustantivo",
    translation: "cáncer",
    definition: "Enfermedad caracterizada por el crecimiento anormal e invasivo de células.",
  },
  "administration": {
    pos: "sustantivo",
    translation: "administración",
    definition: "Acción de administrar o gestionar bienes, recursos u organizaciones.",
  },
  "civil": {
    pos: "adjetivo",
    translation: "civil, cortés",
    definition: "Relativo a los ciudadanos o a la convivencia social; también significa cortés y educado.",
  },
  "dance": {
    pos: "sustantivo",
    translation: "baile, danza",
    definition: "Movimiento rítmico del cuerpo, generalmente al compás de la música.",
  },
  "defense": {
    pos: "sustantivo",
    translation: "defensa",
    definition: "Acción o efecto de defender o protegerse contra un ataque o peligro.",
  },
  "direction": {
    pos: "sustantivo",
    translation: "dirección",
    definition: "Rumbo o camino que sigue algo o alguien hacia un destino.",
  },
  "independent": {
    pos: "adjetivo",
    translation: "independiente",
    definition: "Que no depende de otra persona o cosa para existir o funcionar.",
  },
  "master": {
    pos: "sustantivo",
    translation: "amo, maestro",
    definition: "Persona que tiene autoridad o control sobre otros, o que domina una habilidad.",
  },
  "none": {
    pos: "pronombre",
    translation: "ninguno, nada",
    definition: "Pronombre que indica la ausencia total de algo o alguien.",
  },
  "ship": {
    pos: "sustantivo",
    translation: "barco, buque",
    definition: "Embarcación grande que navega por el mar o por ríos.",
  },
  "stock": {
    pos: "sustantivo",
    translation: "existencias, inventario",
    definition: "Conjunto de mercancías o productos almacenados disponibles para la venta o uso.",
  },
  "trump": {
    pos: "sustantivo",
    translation: "triunfo, carta de triunfo",
    definition: "En juegos de naipes, carta del palo que gana sobre las demás.",
  },
  "wonder": {
    pos: "sustantivo",
    translation: "asombro, maravilla",
    definition: "Sentimiento de admiración o sorpresa ante algo extraordinario o desconocido.",
  },
  "worst": {
    pos: "adjetivo",
    translation: "el peor",
    definition: "Superlativo de malo; que es de la peor calidad o el más desfavorable.",
  },
  "sunday": {
    pos: "sustantivo",
    translation: "domingo",
    definition: "Séptimo día de la semana, dedicado al descanso y al culto religioso.",
  },
  "weekend": {
    pos: "sustantivo",
    translation: "fin de semana",
    definition: "Período de descanso semanal que comprende generalmente el sábado y el domingo.",
  },
  "band": {
    pos: "sustantivo",
    translation: "banda, grupo musical",
    definition: "Conjunto de músicos que interpretan canciones juntos.",
  },
  "awesome": {
    pos: "adjetivo",
    translation: "impresionante, increíble",
    definition: "Que causa asombro o admiración por su grandeza o calidad.",
  },
  "beach": {
    pos: "sustantivo",
    translation: "playa",
    definition: "Zona de arena o piedras junto al mar o un lago.",
  },
  "cash": {
    pos: "sustantivo",
    translation: "dinero en efectivo",
    definition: "Dinero en billetes y monedas, a diferencia de cheques o tarjetas.",
  },
  "effort": {
    pos: "sustantivo",
    translation: "esfuerzo",
    definition: "Empleo de energía o trabajo para lograr un objetivo o superar una dificultad.",
  },
  "imagine": {
    pos: "verbo",
    translation: "imaginar, suponer",
    definition: "Formar en la mente una idea o representación de algo que no está presente.",
  },
  "impact": {
    pos: "sustantivo",
    translation: "impacto",
    definition: "Efecto fuerte o choque de un objeto contra otro.",
  },
  "lack": {
    pos: "sustantivo",
    translation: "falta, carencia",
    definition: "Ausencia o escasez de algo que se necesita o se desea.",
  },
  "commercial": {
    pos: "adjetivo",
    translation: "comercial",
    definition: "Relativo al comercio o a la actividad de compra y venta de bienes y servicios.",
  },
  "learning": {
    pos: "sustantivo",
    translation: "aprendizaje",
    definition: "Proceso de adquirir conocimientos o habilidades mediante estudio o experiencia.",
  },
  "organization": {
    pos: "sustantivo",
    translation: "organización",
    definition: "Entidad o grupo estructurado con un fin determinado.",
  },
  "multiple": {
    pos: "adjetivo",
    translation: "múltiple, varios",
    definition: "Que comprende o incluye varias cosas, elementos o partes a la vez.",
  },
  "operation": {
    pos: "sustantivo",
    translation: "operación",
    definition: "Acción o efecto de operar, especialmente una intervención quirúrgica o un procedimiento.",
  },
  "protect": {
    pos: "verbo",
    translation: "proteger",
    definition: "Resguardar a alguien o algo de un daño o peligro.",
  },
  "secret": {
    pos: "sustantivo",
    translation: "secreto",
    definition: "Algo que se mantiene oculto o reservado para no ser conocido por otros.",
  },
  "senior": {
    pos: "adjetivo",
    translation: "de mayor edad",
    definition: "Que tiene más edad o antigüedad que otra persona en un grupo.",
  },
  "telling": {
    pos: "adjetivo",
    translation: "revelador, significativo",
    definition: "Que revela o pone de manifiesto algo de forma clara y significativa.",
  },
  "spring": {
    pos: "sustantivo",
    translation: "primavera; manantial; resorte",
    definition: "Estación del año, fuente de agua natural o pieza elástica.",
  },
  "christmas": {
    pos: "sustantivo",
    translation: "Navidad",
    definition: "Fiesta cristiana que celebra el nacimiento de Jesucristo, el 25 de diciembre.",
  },
  "wear": {
    pos: "verbo",
    translation: "llevar puesto",
    definition: "Tener una prenda u objeto sobre el cuerpo.",
  },
  "address": {
    pos: "sustantivo",
    translation: "dirección, señas",
    definition: "Conjunto de datos que indican dónde vive o se ubica alguien o algo.",
  },
  "indian": {
    pos: "adjetivo",
    translation: "indio, de la India",
    definition: "Relativo a la India o a sus habitantes, cultura o lenguas.",
  },
  "analysis": {
    pos: "sustantivo",
    translation: "análisis",
    definition: "Examen detallado de algo para comprender sus componentes o su naturaleza.",
  },
  "anyway": {
    pos: "adverbio",
    translation: "de todos modos",
    definition: "Indica que algo se hace o sucede sin importar las circunstancias o lo dicho antes.",
  },
  "choose": {
    pos: "verbo",
    translation: "elegir, escoger",
    definition: "Seleccionar una opción entre varias alternativas.",
  },
  "color": {
    pos: "sustantivo",
    translation: "color",
    definition: "Cualidad visual que percibimos según la luz reflejada por un objeto.",
  },
  "direct": {
    pos: "adjetivo",
    translation: "directo, recto",
    definition: "Que va de un punto a otro sin desviarse ni detenerse.",
  },
  "competition": {
    pos: "sustantivo",
    translation: "competencia, competición",
    definition: "Actividad en la que personas o entidades rivalizan por alcanzar un mismo objetivo o premio.",
  },
  "commission": {
    pos: "sustantivo",
    translation: "comisión",
    definition: "Grupo de personas encargadas de una función o tarea específica.",
  },
  "dream": {
    pos: "sustantivo",
    translation: "sueño",
    definition: "Imagen o serie de imágenes que la mente experimenta mientras se duerme.",
  },
  "finish": {
    pos: "verbo",
    translation: "terminar, acabar",
    definition: "Llevar algo a su término o conclusión.",
  },
  "grand": {
    pos: "adjetivo",
    translation: "grande, magnífico, importante",
    definition: "Que es grande, imponente o de gran importancia o calidad.",
  },
  "marriage": {
    pos: "sustantivo",
    translation: "matrimonio, casamiento",
    definition: "Unión legal o religiosa entre dos personas que establece derechos y deberes.",
  },
  "luck": {
    pos: "sustantivo",
    translation: "suerte",
    definition: "Fuerza que se cree que determina los acontecimientos favorables o desfavorables.",
  },
  "necessary": {
    pos: "adjetivo",
    translation: "necesario, precisa",
    definition: "Que es indispensable o se requiere para un fin determinado.",
  },
  "rich": {
    pos: "adjetivo",
    translation: "rico, adinerado",
    definition: "Que posee muchos bienes o recursos económicos.",
  },
  "skin": {
    pos: "sustantivo",
    translation: "piel",
    definition: "Órgano externo que cubre el cuerpo de personas y animales.",
  },
  "thus": {
    pos: "adverbio",
    translation: "por lo tanto",
    definition: "Indica consecuencia o conclusión de lo dicho anteriormente.",
  },
  "touch": {
    pos: "verbo",
    translation: "tocar",
    definition: "Entrar en contacto físico con algo o alguien.",
  },
  "sweet": {
    pos: "adjetivo",
    translation: "dulce",
    definition: "Que tiene sabor agradable similar al del azúcar o la miel.",
  },
  "facebook": {
    pos: "sustantivo",
    translation: "red social Facebook",
    definition: "Red social en línea fundada por Mark Zuckerberg para conectar personas.",
  },
  "yesterday": {
    pos: "adverbio",
    translation: "ayer",
    definition: "Adverbio que indica el día inmediatamente anterior al de hoy.",
  },
  "damage": {
    pos: "sustantivo",
    translation: "daño, perjuicio",
    definition: "Perjuicio o deterioro causado a algo o a alguien.",
  },
  "congress": {
    pos: "sustantivo",
    translation: "congreso",
    definition: "Reunión de personas o representantes para debatir y tomar decisiones sobre asuntos comunes.",
  },
  "doctor": {
    pos: "sustantivo",
    translation: "médico, doctor",
    definition: "Persona con título universitario que ejerce la medicina o posee un doctorado.",
  },
  "disease": {
    pos: "sustantivo",
    translation: "enfermedad",
    definition: "Alteración del estado de salud normal del organismo.",
  },
  "doubt": {
    pos: "sustantivo",
    translation: "duda",
    definition: "Falta de certeza o confianza sobre algo.",
  },
  "drink": {
    pos: "verbo",
    translation: "beber, tomar",
    definition: "Ingerir un líquido por la boca.",
  },
  "fish": {
    pos: "sustantivo",
    translation: "pez, pescado",
    definition: "Animal acuático vertebrado con aletas y branquias; o su carne usada como alimento.",
  },
  "driving": {
    pos: "sustantivo",
    translation: "conducción, manejo",
    definition: "Acción de conducir un vehículo o de guiar a alguien.",
  },
  "glad": {
    pos: "adjetivo",
    translation: "contento, alegre",
    definition: "Que siente alegría o satisfacción por algo.",
  },
  "grow": {
    pos: "verbo",
    translation: "crecer, cultivar",
    definition: "Aumentar de tamaño o desarrollar plantas mediante cuidado y cultivo.",
  },
  "machine": {
    pos: "sustantivo",
    translation: "máquina",
    definition: "Artefacto o dispositivo que realiza un trabajo o transforma energía.",
  },
  "notice": {
    pos: "sustantivo",
    translation: "aviso, notificación",
    definition: "Comunicación o advertencia que se hace pública o se da a alguien sobre algo.",
  },
  "planning": {
    pos: "sustantivo",
    translation: "planificación",
    definition: "Proceso de organizar y coordinar acciones para alcanzar un objetivo.",
  },
  "overall": {
    pos: "adjetivo",
    translation: "general, total",
    definition: "Que abarca o considera algo en su conjunto, sin excluir ninguna parte.",
  },
  "professor": {
    pos: "sustantivo",
    translation: "profesor, catedrático",
    definition: "Persona que enseña o imparte clases en una universidad o institución educativa.",
  },
  "trip": {
    pos: "sustantivo",
    translation: "viaje, excursión",
    definition: "Desplazamiento a un lugar para visitarlo o realizar una actividad.",
  },
  "carry": {
    pos: "verbo",
    translation: "llevar, cargar",
    definition: "Transportar o sostener algo para trasladarlo de un lugar a otro.",
  },
  "basic": {
    pos: "adjetivo",
    translation: "básico, fundamental",
    definition: "Que constituye la base o lo esencial de algo.",
  },
  "captain": {
    pos: "sustantivo",
    translation: "capitán",
    definition: "Persona que dirige un equipo, barco o grupo.",
  },
  "crime": {
    pos: "sustantivo",
    translation: "crimen, delito",
    definition: "Acción o conducta que viola la ley y es castigada por ella.",
  },
  "effective": {
    pos: "adjetivo",
    translation: "eficaz, efectivo",
    definition: "Que produce el resultado o efecto esperado.",
  },
  "explain": {
    pos: "verbo",
    translation: "explicar, aclarar",
    definition: "Dar a conocer el significado o las causas de algo de forma clara.",
  },
  "holding": {
    pos: "sustantivo",
    translation: "tenencia, participación",
    definition: "Posesión o participación que alguien tiene en una empresa o propiedad.",
  },
  "japan": {
    pos: "sustantivo",
    translation: "Japón, país asiático",
    definition: "País insular de Asia Oriental, conocido por su cultura y tecnología.",
  },
  "male": {
    pos: "adjetivo",
    translation: "masculino, varón",
    definition: "Que pertenece al sexo que produce espermatozoides o relativo a él.",
  },
  "plant": {
    pos: "sustantivo",
    translation: "planta",
    definition: "Ser vivo que crece en la tierra o el agua y produce su propio alimento.",
  },
  "smith": {
    pos: "sustantivo",
    translation: "herrero, forjador",
    definition: "Persona que trabaja el metal forjándolo con martillo y yunque.",
  },
  "reality": {
    pos: "sustantivo",
    translation: "realidad",
    definition: "Conjunto de cosas que existen realmente, en oposición a lo imaginario.",
  },
  "texas": {
    pos: "sustantivo",
    translation: "Texas",
    definition: "Estado del sur de Estados Unidos, limítrofe con México.",
  },
  "spot": {
    pos: "sustantivo",
    translation: "lugar, sitio, punto",
    definition: "Lugar o punto específico en el espacio o en una superficie.",
  },
  "worse": {
    pos: "adjetivo",
    translation: "peor",
    definition: "Comparativo irregular de 'bad'; indica mayor maldad o inferior calidad.",
  },
  "christian": {
    pos: "adjetivo",
    translation: "cristiano",
    definition: "Relativo al cristianismo o persona que profesa la fe en Cristo.",
  },
  "agreement": {
    pos: "sustantivo",
    translation: "acuerdo, convenio",
    definition: "Convenio o conformidad entre dos o más partes sobre un asunto.",
  },
  "advice": {
    pos: "sustantivo",
    translation: "consejo, recomendación",
    definition: "Opinión o sugerencia que se da a alguien para ayudarle a actuar o decidir.",
  },
  "award": {
    pos: "sustantivo",
    translation: "premio, galardón",
    definition: "Reconocimiento o distinción que se otorga a alguien por su mérito o logro.",
  },
  "block": {
    pos: "sustantivo",
    translation: "bloque, cuadra, manzana",
    definition: "Pieza sólida o área urbana delimitada por calles.",
  },
  "challenge": {
    pos: "sustantivo",
    translation: "desafío, reto",
    definition: "Situación o tarea difícil que pone a prueba la capacidad o habilidad de alguien.",
  },
  "comment": {
    pos: "sustantivo",
    translation: "comentario",
    definition: "Opinión o aclaración que se expresa sobre algo.",
  },
  "equipment": {
    pos: "sustantivo",
    translation: "equipo, equipamiento",
    definition: "Conjunto de herramientas, máquinas o utensilios necesarios para una actividad o tarea.",
  },
  "killing": {
    pos: "sustantivo",
    translation: "asesinato, matanza",
    definition: "Acción de quitar la vida a alguien o a un gran número de personas.",
  },
  "holy": {
    pos: "adjetivo",
    translation: "sagrado, santo",
    definition: "Que es digno de veneración por estar consagrado a Dios o a lo divino.",
  },
  "nation": {
    pos: "sustantivo",
    translation: "nación",
    definition: "Comunidad de personas con historia, cultura y territorio comunes.",
  },
  "otherwise": {
    pos: "adverbio",
    translation: "de lo contrario",
    definition: "Indica que si no se cumple lo dicho, ocurrirá otra cosa o se actuará de otra manera.",
  },
  "peter": {
    pos: "sustantivo",
    translation: "pene",
    definition: "Órgano sexual masculino; en inglés coloquial, forma vulgar para referirse al pene.",
  },
  "primary": {
    pos: "adjetivo",
    translation: "primario, principal",
    definition: "Que es primero en orden, importancia o jerarquía.",
  },
  "purpose": {
    pos: "sustantivo",
    translation: "propósito, finalidad",
    definition: "Objetivo o razón por la que se hace o existe algo.",
  },
  "responsible": {
    pos: "adjetivo",
    translation: "responsable",
    definition: "Que tiene la obligación de responder por sus actos o de cumplir una tarea.",
  },
  "shop": {
    pos: "sustantivo",
    translation: "tienda, comercio",
    definition: "Establecimiento donde se venden productos o servicios al público.",
  },
  "showing": {
    pos: "sustantivo",
    translation: "proyección, exhibición, demostración",
    definition: "Acción de exhibir o presentar algo, como una película o una prueba.",
  },
  "sick": {
    pos: "adjetivo",
    translation: "enfermo, mareado",
    definition: "Que padece una enfermedad o siente malestar físico.",
  },
  "teacher": {
    pos: "sustantivo",
    translation: "profesor, maestro",
    definition: "Persona que enseña o instruye a otros en una materia o disciplina.",
  },
  "theory": {
    pos: "sustantivo",
    translation: "teoría",
    definition: "Conjunto de ideas o principios que explican un fenómeno.",
  },
  "saturday": {
    pos: "sustantivo",
    translation: "sábado",
    definition: "Sexto día de la semana, entre el viernes y el domingo.",
  },
  "avoid": {
    pos: "verbo",
    translation: "evitar, eludir",
    definition: "Alejarse o impedir algo para no enfrentarlo o sufrir sus consecuencias.",
  },
  "agency": {
    pos: "sustantivo",
    translation: "agencia",
    definition: "Empresa u organización que gestiona servicios o negocios por cuenta de otros.",
  },
  "camera": {
    pos: "sustantivo",
    translation: "cámara",
    definition: "Dispositivo que captura imágenes o graba vídeo.",
  },
  "catch": {
    pos: "verbo",
    translation: "atrapar, agarrar",
    definition: "Tomar o sujetar algo que se mueve o cae.",
  },
  "cell": {
    pos: "sustantivo",
    translation: "célula, celda",
    definition: "Unidad básica de los seres vivos o pequeña habitación cerrada.",
  },
  "coast": {
    pos: "sustantivo",
    translation: "costa, litoral",
    definition: "Zona de tierra que bordea el mar o un gran lago.",
  },
  "drug": {
    pos: "sustantivo",
    translation: "droga, medicamento",
    definition: "Sustancia que se usa como medicamento o que altera el funcionamiento del cuerpo.",
  },
  "economy": {
    pos: "sustantivo",
    translation: "economía",
    definition: "Sistema de producción, distribución y consumo de bienes y servicios en una sociedad.",
  },
  "foot": {
    pos: "sustantivo",
    translation: "pie",
    definition: "Parte inferior de la pierna que sostiene el cuerpo y permite caminar.",
  },
  "executive": {
    pos: "sustantivo",
    translation: "ejecutivo, directivo",
    definition: "Persona con autoridad para tomar decisiones en una organización o empresa.",
  },
  "environment": {
    pos: "sustantivo",
    translation: "medio ambiente",
    definition: "Conjunto de condiciones naturales, sociales y culturales que rodean y afectan a los seres vivos.",
  },
  "hall": {
    pos: "sustantivo",
    translation: "salón, vestíbulo",
    definition: "Sala o espacio amplio de un edificio, como vestíbulo o salón de actos.",
  },
  "mass": {
    pos: "sustantivo",
    translation: "masa",
    definition: "Cantidad de materia que forma un cuerpo.",
  },
  "meaning": {
    pos: "sustantivo",
    translation: "significado, sentido",
    definition: "Concepto o idea que se expresa mediante una palabra, frase o signo.",
  },
  "mission": {
    pos: "sustantivo",
    translation: "misión, tarea",
    definition: "Objetivo o encargo que una persona o grupo debe cumplir.",
  },
  "nine": {
    pos: "sustantivo",
    translation: "nueve",
    definition: "Número cardinal que equivale a ocho más uno.",
  },
  "politics": {
    pos: "sustantivo",
    translation: "política",
    definition: "Actividad relacionada con el gobierno y la administración pública de una sociedad.",
  },
  "status": {
    pos: "sustantivo",
    translation: "estatus, estado, situación",
    definition: "Posición o condición de una persona o cosa en un contexto social o determinado.",
  },
  "therefore": {
    pos: "adverbio",
    translation: "por lo tanto",
    definition: "Indica que lo que se expresa es consecuencia de lo dicho anteriormente.",
  },
  "trial": {
    pos: "sustantivo",
    translation: "juicio, prueba, ensayo",
    definition: "Proceso judicial o prueba para evaluar algo o a alguien.",
  },
  "google": {
    pos: "sustantivo",
    translation: "Google, buscador Google",
    definition: "Motor de búsqueda en internet de la empresa Google.",
  },
  "weather": {
    pos: "sustantivo",
    translation: "tiempo, clima",
    definition: "Estado de la atmósfera en un lugar y momento determinados.",
  },
  "activity": {
    pos: "sustantivo",
    translation: "actividad",
    definition: "Conjunto de acciones o tareas que se realizan con un propósito determinado.",
  },
  "application": {
    pos: "sustantivo",
    translation: "solicitud, aplicación",
    definition: "Documento o programa informático; también acción de aplicar algo.",
  },
  "coffee": {
    pos: "sustantivo",
    translation: "café",
    definition: "Bebida oscura y amarga elaborada a partir de granos tostados y molidos de la planta del café.",
  },
  "condition": {
    pos: "sustantivo",
    translation: "condición, estado",
    definition: "Estado o circunstancia en que se encuentra algo o alguien.",
  },
  "complex": {
    pos: "adjetivo",
    translation: "complejo, complicado",
    definition: "Que está formado por varios elementos o es difícil de entender.",
  },
  "evening": {
    pos: "sustantivo",
    translation: "noche, tarde",
    definition: "Parte del día entre la tarde y la noche, o el final del día.",
  },
  "division": {
    pos: "sustantivo",
    translation: "división",
    definition: "Acción de dividir o separar algo en partes.",
  },
  "flight": {
    pos: "sustantivo",
    translation: "vuelo",
    definition: "Acción de volar o desplazarse por el aire un ave, aeronave o persona.",
  },
  "heat": {
    pos: "sustantivo",
    translation: "calor",
    definition: "Energía térmica que se transfiere entre cuerpos debido a una diferencia de temperatura.",
  },
  "freedom": {
    pos: "sustantivo",
    translation: "libertad",
    definition: "Facultad natural del ser humano para obrar y elegir sin coacción externa.",
  },
  "interview": {
    pos: "sustantivo",
    translation: "entrevista",
    definition: "Conversación entre dos o más personas para obtener información o evaluar a alguien.",
  },
  "library": {
    pos: "sustantivo",
    translation: "biblioteca",
    definition: "Lugar donde se guardan y consultan libros y otros materiales para lectura o estudio.",
  },
  "location": {
    pos: "sustantivo",
    translation: "ubicación, lugar",
    definition: "Lugar o sitio donde se encuentra algo o alguien.",
  },
  "murder": {
    pos: "sustantivo",
    translation: "asesinato, homicidio",
    definition: "Acción de matar a una persona de forma intencionada e ilegal.",
  },
  "queen": {
    pos: "sustantivo",
    translation: "reina",
    definition: "Mujer que ejerce la soberanía de un reino o es esposa del rey.",
  },
  "sitting": {
    pos: "sustantivo",
    translation: "sesión, sentada",
    definition: "Acción de estar sentado o reunión en la que se delibera.",
  },
  "standing": {
    pos: "adjetivo",
    translation: "de pie, permanente",
    definition: "Que está de pie o que es permanente y estable en el tiempo.",
  },
  "accept": {
    pos: "verbo",
    translation: "aceptar, recibir",
    definition: "Recibir o admitir algo de forma voluntaria.",
  },
  "actual": {
    pos: "adjetivo",
    translation: "real, verdadero",
    definition: "Que existe o es real, en oposición a lo imaginado o supuesto.",
  },
  "appear": {
    pos: "verbo",
    translation: "aparecer, parecer",
    definition: "Mostrarse o hacerse visible algo o alguien; también parecer o dar la impresión de ser.",
  },
  "attempt": {
    pos: "sustantivo",
    translation: "intento, tentativa",
    definition: "Acción de tratar de hacer algo, especialmente si es difícil.",
  },
  "broke": {
    pos: "adjetivo",
    translation: "sin dinero, arruinado",
    definition: "Que no tiene dinero o recursos económicos; falto de fondos.",
  },
  "channel": {
    pos: "sustantivo",
    translation: "canal",
    definition: "Cauce artificial o natural por donde se conduce el agua u otra cosa.",
  },
  "distance": {
    pos: "sustantivo",
    translation: "distancia",
    definition: "Espacio o intervalo entre dos puntos o personas.",
  },
  "exchange": {
    pos: "sustantivo",
    translation: "intercambio, canje",
    definition: "Acción de dar una cosa por otra, generalmente de igual valor.",
  },
  "finding": {
    pos: "sustantivo",
    translation: "hallazgo, resultado",
    definition: "Resultado o conclusión obtenida de una investigación o estudio.",
  },
  "fell": {
    pos: "verbo",
    translation: "pasado de fall; talar",
    definition: "Pasado de 'fall' (caer); también significa talar un árbol o derribar algo.",
  },
  "glass": {
    pos: "sustantivo",
    translation: "vaso, vidrio",
    definition: "Material transparente y frágil, o recipiente para beber hecho de él.",
  },
  "mobile": {
    pos: "adjetivo",
    translation: "móvil, portátil",
    definition: "Que puede moverse o trasladarse de un lugar a otro.",
  },
  "northern": {
    pos: "adjetivo",
    translation: "del norte, norteño",
    definition: "Que pertenece o está situado en el norte.",
  },
  "powerful": {
    pos: "adjetivo",
    translation: "poderoso, potente, fuerte",
    definition: "Que tiene gran poder, fuerza o capacidad para influir o producir efectos.",
  },
  "protection": {
    pos: "sustantivo",
    translation: "protección",
    definition: "Acción de resguardar a alguien o algo de un daño o peligro.",
  },
  "prior": {
    pos: "adjetivo",
    translation: "previo, anterior",
    definition: "Que existe o sucede antes en el tiempo o en el orden.",
  },
  "receive": {
    pos: "verbo",
    translation: "recibir",
    definition: "Tomar o aceptar algo que se da, se envía o se entrega.",
  },
  "religious": {
    pos: "adjetivo",
    translation: "religioso, devoto",
    definition: "Relativo a la religión o que profesa una creencia religiosa.",
  },
  "ride": {
    pos: "verbo",
    translation: "montar, viajar",
    definition: "Desplazarse sobre un animal o vehículo, o viajar en un medio de transporte.",
  },
  "royal": {
    pos: "adjetivo",
    translation: "real, regio",
    definition: "Perteneciente o relativo al rey o a la realeza.",
  },
  "screen": {
    pos: "sustantivo",
    translation: "pantalla",
    definition: "Superficie donde se muestran imágenes o información.",
  },
  "serve": {
    pos: "verbo",
    translation: "servir",
    definition: "Prestar un servicio o realizar una función para alguien.",
  },
  "slow": {
    pos: "adjetivo",
    translation: "lento, despacio",
    definition: "Que se mueve o actúa con poca velocidad o que requiere mucho tiempo.",
  },
  "species": {
    pos: "sustantivo",
    translation: "especie",
    definition: "Conjunto de seres vivos con características comunes que pueden reproducirse entre sí.",
  },
  "speech": {
    pos: "sustantivo",
    translation: "discurso, habla",
    definition: "Facultad o acto de hablar; también discurso pronunciado ante un público.",
  },
  "tree": {
    pos: "sustantivo",
    translation: "árbol",
    definition: "Planta perenne de tallo leñoso que se ramifica a cierta altura del suelo.",
  },
  "traffic": {
    pos: "sustantivo",
    translation: "tráfico",
    definition: "Circulación de vehículos o personas por una vía.",
  },
  "wonderful": {
    pos: "adjetivo",
    translation: "maravilloso, fantástico",
    definition: "Que causa admiración o placer por su excelencia o belleza.",
  },
  "begin": {
    pos: "verbo",
    translation: "empezar, comenzar",
    definition: "Iniciar una acción o dar comienzo a algo.",
  },
  "airport": {
    pos: "sustantivo",
    translation: "aeropuerto",
    definition: "Lugar donde despegan y aterrizan aviones y se atiende a los pasajeros.",
  },
  "bottom": {
    pos: "sustantivo",
    translation: "fondo, parte inferior",
    definition: "La parte más baja o inferior de algo.",
  },
  "demand": {
    pos: "sustantivo",
    translation: "demanda, exigencia",
    definition: "Petición o exigencia firme de algo que se considera necesario o debido.",
  },
  "everybody": {
    pos: "pronombre",
    translation: "todo el mundo",
    definition: "Pronombre indefinido que se refiere a todas las personas de un grupo.",
  },
  "famous": {
    pos: "adjetivo",
    translation: "famoso, célebre",
    definition: "Que es muy conocido por el público por sus méritos o cualidades.",
  },
  "engine": {
    pos: "sustantivo",
    translation: "motor",
    definition: "Máquina que transforma energía en movimiento para realizar un trabajo.",
  },
  "investment": {
    pos: "sustantivo",
    translation: "inversión",
    definition: "Colocación de capital en un activo o proyecto con la expectativa de obtener beneficios futuros.",
  },
  "partner": {
    pos: "sustantivo",
    translation: "socio, compañero, pareja",
    definition: "Persona que comparte una actividad, negocio o relación con otra.",
  },
  "southern": {
    pos: "adjetivo",
    translation: "del sur, sureño",
    definition: "Relativo al sur o situado en la parte sur de un lugar.",
  },
  "structure": {
    pos: "sustantivo",
    translation: "estructura",
    definition: "Conjunto de elementos organizados que forman un todo coherente.",
  },
  "traditional": {
    pos: "adjetivo",
    translation: "tradicional",
    definition: "Que sigue las costumbres o normas establecidas por la tradición.",
  },
  "twice": {
    pos: "adverbio",
    translation: "dos veces",
    definition: "Indica que algo ocurre dos veces o se duplica en cantidad.",
  },
  "wind": {
    pos: "sustantivo",
    translation: "viento",
    definition: "Corriente de aire que se desplaza por la atmósfera.",
  },
  "worry": {
    pos: "verbo",
    translation: "preocuparse, inquietarse",
    definition: "Sentir inquietud o ansiedad por algo que puede ocurrir.",
  },
  "twitter": {
    pos: "sustantivo",
    translation: "red social Twitter",
    definition: "Red social de microblogging para publicar mensajes cortos.",
  },
  "americans": {
    pos: "sustantivo",
    translation: "estadounidenses, americanos",
    definition: "Personas originarias o ciudadanas de Estados Unidos.",
  },
  "solution": {
    pos: "sustantivo",
    translation: "solución",
    definition: "Respuesta o medio para resolver un problema o dificultad.",
  },
  "brand": {
    pos: "sustantivo",
    translation: "marca, marca comercial",
    definition: "Nombre o símbolo que identifica un producto o empresa en el mercado.",
  },
  "square": {
    pos: "sustantivo",
    translation: "cuadrado, plaza",
    definition: "Figura geométrica de cuatro lados iguales y cuatro ángulos rectos, o espacio público abierto.",
  },
  "cent": {
    pos: "sustantivo",
    translation: "centavo",
    definition: "Unidad monetaria equivalente a la centésima parte de un dólar o de otra moneda.",
  },
  "count": {
    pos: "sustantivo",
    translation: "cuenta, conde",
    definition: "Acción de contar o enumerar; también título nobiliario.",
  },
  "critical": {
    pos: "adjetivo",
    translation: "crítico, crucial",
    definition: "Que es decisivo, fundamental o muy importante para algo.",
  },
  "fourth": {
    pos: "adjetivo",
    translation: "cuarto",
    definition: "Que ocupa el lugar número cuatro en una serie o orden.",
  },
  "digital": {
    pos: "adjetivo",
    translation: "digital",
    definition: "Relativo a los dedos o a la tecnología que usa datos numéricos.",
  },
  "fresh": {
    pos: "adjetivo",
    translation: "fresco, reciente, nuevo",
    definition: "Que está recién hecho, obtenido o ha conservado sus cualidades originales.",
  },
  "lake": {
    pos: "sustantivo",
    translation: "lago",
    definition: "Masa de agua dulce rodeada de tierra, generalmente de gran tamaño.",
  },
  "mental": {
    pos: "adjetivo",
    translation: "mental, de la mente",
    definition: "Relativo a la mente o a los procesos mentales.",
  },
  "mouth": {
    pos: "sustantivo",
    translation: "boca",
    definition: "Abertura en la cara por donde se come y se habla.",
  },
  "realize": {
    pos: "verbo",
    translation: "darse cuenta",
    definition: "Comprender o tomar conciencia de algo que antes no se percibía.",
  },
  "scale": {
    pos: "sustantivo",
    translation: "escala, balanza",
    definition: "Instrumento o escala para medir peso, tamaño o magnitud.",
  },
  "score": {
    pos: "sustantivo",
    translation: "puntuación, marcador",
    definition: "Número de puntos obtenidos en un juego o competición.",
  },
  "remain": {
    pos: "verbo",
    translation: "permanecer, quedarse",
    definition: "Continuar en un lugar o estado sin cambiar.",
  },
  "owner": {
    pos: "sustantivo",
    translation: "dueño, propietario",
    definition: "Persona que posee o tiene derecho sobre algo.",
  },
  "separate": {
    pos: "verbo",
    translation: "separar, dividir",
    definition: "Acción de apartar o dividir elementos que estaban juntos.",
  },
  "smart": {
    pos: "adjetivo",
    translation: "inteligente, listo",
    definition: "Que tiene buena capacidad de aprender, comprender o razonar.",
  },
  "throw": {
    pos: "verbo",
    translation: "lanzar, tirar",
    definition: "Impulsar algo por el aire con la mano para que recorra una distancia.",
  },
  "wedding": {
    pos: "sustantivo",
    translation: "boda, casamiento",
    definition: "Ceremonia en la que dos personas se casan y celebran su unión.",
  },
  "acting": {
    pos: "sustantivo",
    translation: "actuación, interpretación",
    definition: "Acción de interpretar un papel en una obra dramática, cine o televisión.",
  },
  "surface": {
    pos: "sustantivo",
    translation: "superficie",
    definition: "Parte exterior o cara visible de un objeto o cuerpo.",
  },
  "african": {
    pos: "adjetivo",
    translation: "africano, de África",
    definition: "Relativo a África o a sus habitantes, culturas o lenguas.",
  },
  "benefit": {
    pos: "sustantivo",
    translation: "beneficio, ventaja",
    definition: "Ventaja o provecho que se obtiene de algo.",
  },
  "budget": {
    pos: "sustantivo",
    translation: "presupuesto",
    definition: "Cantidad de dinero disponible o planificada para un fin determinado.",
  },
  "estate": {
    pos: "sustantivo",
    translation: "finca, propiedad, patrimonio",
    definition: "Propiedad rural o conjunto de bienes y derechos de una persona.",
  },
  "click": {
    pos: "sustantivo",
    translation: "clic, chasquido",
    definition: "Sonido breve y seco, o acción de pulsar un botón del ratón o dispositivo.",
  },
  "faith": {
    pos: "sustantivo",
    translation: "fe, confianza",
    definition: "Creencia firme en algo o alguien sin necesidad de pruebas.",
  },
  "fashion": {
    pos: "sustantivo",
    translation: "moda, estilo",
    definition: "Manera o tendencia predominante de vestir, comportarse o hacer algo en un momento.",
  },
  "feature": {
    pos: "sustantivo",
    translation: "característica, rasgo",
    definition: "Cualidad o elemento distintivo que forma parte de algo.",
  },
  "generation": {
    pos: "sustantivo",
    translation: "generación",
    definition: "Conjunto de personas nacidas en la misma época o el acto de producir algo.",
  },
  "fund": {
    pos: "sustantivo",
    translation: "fondo, capital",
    definition: "Conjunto de recursos financieros destinados a un fin determinado.",
  },
  "hearing": {
    pos: "sustantivo",
    translation: "audiencia, oído",
    definition: "Facultad de percibir sonidos o sesión oficial para escuchar un caso.",
  },
  "metal": {
    pos: "sustantivo",
    translation: "metal",
    definition: "Material sólido, generalmente brillante y buen conductor del calor y la electricidad.",
  },
  "hill": {
    pos: "sustantivo",
    translation: "colina, cerro",
    definition: "Elevación natural del terreno, de menor altura que una montaña.",
  },
  "jack": {
    pos: "sustantivo",
    translation: "gato hidráulico",
    definition: "Herramienta para levantar objetos pesados, especialmente para cambiar neumáticos.",
  },
  "profile": {
    pos: "sustantivo",
    translation: "perfil",
    definition: "Conjunto de rasgos o características que definen a una persona o cosa.",
  },
  "pull": {
    pos: "verbo",
    translation: "tirar, jalar, atraer",
    definition: "Ejercer fuerza sobre algo para moverlo hacia uno mismo o en una dirección.",
  },
  "push": {
    pos: "verbo",
    translation: "empujar",
    definition: "Ejercer fuerza sobre algo para moverlo o desplazarlo.",
  },
  "rose": {
    pos: "sustantivo",
    translation: "rosa",
    definition: "Flor del rosal, generalmente fragante y de diversos colores.",
  },
  "seat": {
    pos: "sustantivo",
    translation: "asiento, silla",
    definition: "Mueble o lugar destinado para sentarse una persona.",
  },
  "sexual": {
    pos: "adjetivo",
    translation: "sexual",
    definition: "Relativo al sexo o a la sexualidad.",
  },
  "target": {
    pos: "sustantivo",
    translation: "objetivo, blanco",
    definition: "Persona, objeto o lugar al que se dirige una acción, un ataque o un propósito.",
  },
  "understanding": {
    pos: "sustantivo",
    translation: "entendimiento, comprensión",
    definition: "Capacidad de comprender o el acuerdo entre personas.",
  },
  "village": {
    pos: "sustantivo",
    translation: "pueblo, aldea",
    definition: "Población pequeña, generalmente rural, con pocos habitantes.",
  },
  "agent": {
    pos: "sustantivo",
    translation: "agente",
    definition: "Persona o cosa que actúa o produce un efecto.",
  },
  "animal": {
    pos: "sustantivo",
    translation: "animal",
    definition: "Ser vivo que se alimenta de materia orgánica y generalmente puede moverse.",
  },
  "apply": {
    pos: "verbo",
    translation: "aplicar, solicitar",
    definition: "Poner algo en práctica o hacer una solicitud formal para algo.",
  },
  "authority": {
    pos: "sustantivo",
    translation: "autoridad, poder",
    definition: "Facultad o poder para mandar, gobernar o tomar decisiones.",
  },
  "basis": {
    pos: "sustantivo",
    translation: "base, fundamento",
    definition: "Principio o fundamento en que se apoya algo.",
  },
  "draw": {
    pos: "verbo",
    translation: "dibujar, atraer",
    definition: "Trazar una figura o imagen sobre una superficie; también atraer o sacar algo.",
  },
  "dude": {
    pos: "sustantivo",
    translation: "tío, colega, amigo",
    definition: "Persona, generalmente hombre, tratada de forma informal y amistosa.",
  },
  "enter": {
    pos: "verbo",
    translation: "entrar",
    definition: "Pasar de fuera a dentro de un lugar.",
  },
  "foundation": {
    pos: "sustantivo",
    translation: "fundamento, base, cimiento",
    definition: "Parte inferior o base sobre la que se apoya una construcción o una idea.",
  },
  "gain": {
    pos: "verbo",
    translation: "ganar, obtener",
    definition: "Obtener o adquirir algo, especialmente una ventaja o beneficio.",
  },
  "japanese": {
    pos: "adjetivo",
    translation: "japonés, japonesa",
    definition: "Relativo a Japón, su lengua, cultura o sus habitantes.",
  },
  "memory": {
    pos: "sustantivo",
    translation: "memoria",
    definition: "Capacidad de la mente para almacenar y recordar información o experiencias.",
  },
  "prime": {
    pos: "adjetivo",
    translation: "primero, principal",
    definition: "Que es el primero en orden, importancia o calidad.",
  },
  "rise": {
    pos: "verbo",
    translation: "subir, elevarse, alzarse",
    definition: "Moverse hacia arriba o aumentar de nivel, cantidad o intensidad.",
  },
  "ring": {
    pos: "sustantivo",
    translation: "anillo, sortija",
    definition: "Objeto circular que se lleva en el dedo como adorno o símbolo.",
  },
  "soul": {
    pos: "sustantivo",
    translation: "alma, espíritu",
    definition: "Parte inmaterial del ser humano que se considera principio de la vida y la conciencia.",
  },
  "spread": {
    pos: "sustantivo",
    translation: "propagación, difusión",
    definition: "Acción o efecto de extender o difundir algo por un área.",
  },
  "supply": {
    pos: "sustantivo",
    translation: "suministro, provisión",
    definition: "Cantidad de bienes o recursos disponibles para satisfacer una necesidad.",
  },
  "waste": {
    pos: "sustantivo",
    translation: "desperdicio, residuo, basura",
    definition: "Material o sustancia que se descarta por no ser útil o aprovechable.",
  },
  "weird": {
    pos: "adjetivo",
    translation: "extraño, raro",
    definition: "Que resulta extraño, raro o poco habitual.",
  },
  "monday": {
    pos: "sustantivo",
    translation: "lunes",
    definition: "Primer día de la semana laboral, después del domingo.",
  },
  "adult": {
    pos: "sustantivo",
    translation: "adulto, persona mayor",
    definition: "Persona que ha alcanzado la madurez o la edad legal.",
  },
  "artist": {
    pos: "sustantivo",
    translation: "artista",
    definition: "Persona que crea o practica el arte, especialmente las bellas artes.",
  },
  "chairman": {
    pos: "sustantivo",
    translation: "presidente, director",
    definition: "Persona que preside o dirige una reunión, organización o empresa.",
  },
  "edition": {
    pos: "sustantivo",
    translation: "edición",
    definition: "Versión publicada de una obra o publicación.",
  },
  "engineering": {
    pos: "sustantivo",
    translation: "ingeniería",
    definition: "Disciplina que aplica principios científicos y matemáticos para diseñar y construir soluciones técnicas.",
  },
  "grade": {
    pos: "sustantivo",
    translation: "grado, nota, curso",
    definition: "Nivel, calificación o año escolar que indica una posición o medida.",
  },
  "happening": {
    pos: "sustantivo",
    translation: "acontecimiento, suceso",
    definition: "Suceso o evento que ocurre, especialmente uno notable o interesante.",
  },
  "healthy": {
    pos: "adjetivo",
    translation: "saludable, sano",
    definition: "Que tiene buena salud o es beneficioso para la salud.",
  },
  "institute": {
    pos: "sustantivo",
    translation: "instituto, institución",
    definition: "Organización dedicada a la investigación, educación o una actividad específica.",
  },
  "method": {
    pos: "sustantivo",
    translation: "método",
    definition: "Procedimiento o conjunto de pasos ordenados para lograr un objetivo o realizar una tarea.",
  },
  "mike": {
    pos: "sustantivo",
    translation: "micrófono",
    definition: "Dispositivo que convierte ondas sonoras en señales eléctricas para amplificarlas o grabarlas.",
  },
  "option": {
    pos: "sustantivo",
    translation: "opción, alternativa",
    definition: "Posibilidad de elegir entre varias alternativas o cursos de acción.",
  },
  "prison": {
    pos: "sustantivo",
    translation: "prisión, cárcel",
    definition: "Lugar donde se recluye a personas condenadas por delitos.",
  },
  "remains": {
    pos: "sustantivo",
    translation: "restos, vestigios",
    definition: "Partes o fragmentos que quedan de algo destruido o desaparecido.",
  },
  "senate": {
    pos: "sustantivo",
    translation: "senado",
    definition: "Cámara legislativa o consejo de gobierno en algunos países y organizaciones.",
  },
  "somebody": {
    pos: "pronombre",
    translation: "alguien, alguna persona",
    definition: "Persona indeterminada o no especificada.",
  },
  "stone": {
    pos: "sustantivo",
    translation: "piedra",
    definition: "Materia mineral dura y sólida que se encuentra en la naturaleza.",
  },
  "strength": {
    pos: "sustantivo",
    translation: "fuerza, fortaleza",
    definition: "Capacidad física o moral para resistir, actuar o soportar esfuerzos.",
  },
  "wild": {
    pos: "adjetivo",
    translation: "salvaje, silvestre",
    definition: "Que vive o crece en la naturaleza sin intervención humana.",
  },
  "winner": {
    pos: "sustantivo",
    translation: "ganador, vencedor",
    definition: "Persona o cosa que gana una competición, premio o disputa.",
  },
  "window": {
    pos: "sustantivo",
    translation: "ventana",
    definition: "Abertura en una pared para permitir la entrada de luz y aire.",
  },
  "camp": {
    pos: "sustantivo",
    translation: "campamento, campo",
    definition: "Lugar al aire libre donde se instalan tiendas o refugios temporales.",
  },
  "cast": {
    pos: "verbo",
    translation: "lanzar, emitir, repartir",
    definition: "Verbo que significa lanzar algo, emitir un voto o asignar papeles en una obra.",
  },
  "correct": {
    pos: "adjetivo",
    translation: "correcto, exacto",
    definition: "Que está libre de errores o se ajusta a la verdad o a una norma.",
  },
  "christ": {
    pos: "sustantivo",
    translation: "Cristo",
    definition: "Título dado a Jesús de Nazaret como el Mesías ungido.",
  },
  "dangerous": {
    pos: "adjetivo",
    translation: "peligroso, arriesgado",
    definition: "Que implica riesgo o puede causar daño.",
  },
  "firm": {
    pos: "adjetivo",
    translation: "firme, sólido",
    definition: "Que es estable, resistente o no se mueve ni cambia fácilmente.",
  },
  "handle": {
    pos: "sustantivo",
    translation: "mango, asa, tirador",
    definition: "Parte por la que se agarra o sujeta un objeto, como una puerta o una taza.",
  },
  "improve": {
    pos: "verbo",
    translation: "mejorar",
    definition: "Hacer que algo sea mejor o aumentar su calidad.",
  },
  "indeed": {
    pos: "adverbio",
    translation: "de hecho, ciertamente",
    definition: "Se usa para confirmar o enfatizar la veracidad de algo dicho.",
  },
  "negative": {
    pos: "adjetivo",
    translation: "negativo",
    definition: "Que expresa oposición, carencia o ausencia de algo.",
  },
  "prevent": {
    pos: "verbo",
    translation: "prevenir, evitar, impedir",
    definition: "Evitar que algo ocurra o impedir que alguien haga algo.",
  },
  "spirit": {
    pos: "sustantivo",
    translation: "espíritu, ánimo",
    definition: "Parte inmaterial del ser humano o estado de ánimo de una persona.",
  },
  "television": {
    pos: "sustantivo",
    translation: "televisión, televisor",
    definition: "Aparato electrónico que recibe y muestra imágenes y sonido transmitidos.",
  },
  "till": {
    pos: "preposición",
    translation: "hasta",
    definition: "Indica el límite temporal o espacial de una acción o estado.",
  },
  "advantage": {
    pos: "sustantivo",
    translation: "ventaja, beneficio",
    definition: "Circunstancia que pone a alguien en una posición más favorable respecto a otros.",
  },
  "aware": {
    pos: "adjetivo",
    translation: "consciente, enterado",
    definition: "Que tiene conocimiento o percepción de algo.",
  },
  "apart": {
    pos: "adverbio",
    translation: "separado, aparte",
    definition: "Indica separación o distancia entre personas o cosas.",
  },
  "decide": {
    pos: "verbo",
    translation: "decidir, resolver",
    definition: "Tomar una determinación sobre algo tras considerar las opciones.",
  },
  "dinner": {
    pos: "sustantivo",
    translation: "cena",
    definition: "Comida principal que se toma por la noche.",
  },
  "eastern": {
    pos: "adjetivo",
    translation: "del este, oriental",
    definition: "Relativo al este o situado en la parte oriental de un lugar.",
  },
  "fifth": {
    pos: "adjetivo",
    translation: "quinto",
    definition: "Que ocupa el lugar número cinco en una serie o jerarquía.",
  },
  "function": {
    pos: "sustantivo",
    translation: "función, cargo",
    definition: "Propósito o tarea que cumple algo o alguien, o cargo que desempeña.",
  },
  "gift": {
    pos: "sustantivo",
    translation: "regalo, obsequio",
    definition: "Cosa que se da a alguien sin esperar nada a cambio, especialmente como muestra de afecto.",
  },
  "helping": {
    pos: "sustantivo",
    translation: "porción de comida",
    definition: "Ración de comida servida en una comida.",
  },
  "herself": {
    pos: "pronombre",
    translation: "ella misma",
    definition: "Pronombre reflexivo que indica que la acción recae sobre la propia mujer que la realiza.",
  },
  "impossible": {
    pos: "adjetivo",
    translation: "imposible",
    definition: "Que no puede ocurrir, existir o realizarse.",
  },
  "influence": {
    pos: "sustantivo",
    translation: "influencia",
    definition: "Efecto o poder que alguien o algo ejerce sobre otra persona o cosa.",
  },
  "marketing": {
    pos: "sustantivo",
    translation: "mercadotecnia",
    definition: "Conjunto de actividades para promocionar y vender productos o servicios.",
  },
  "produce": {
    pos: "verbo",
    translation: "producir, fabricar",
    definition: "Fabricar, elaborar o generar algo, especialmente bienes o alimentos.",
  },
  "progress": {
    pos: "sustantivo",
    translation: "progreso, avance",
    definition: "Acción de avanzar o mejorar hacia un estado más desarrollado.",
  },
  "require": {
    pos: "verbo",
    translation: "requerir, necesitar",
    definition: "Necesitar o exigir algo como necesario o indispensable.",
  },
  "shooting": {
    pos: "sustantivo",
    translation: "tiroteo, disparo",
    definition: "Acción de disparar un arma o el acto de matar a tiros.",
  },
  "shut": {
    pos: "verbo",
    translation: "cerrar, cerrarse",
    definition: "Acción de cerrar algo o ponerse algo en posición cerrada.",
  },
  "wood": {
    pos: "sustantivo",
    translation: "madera",
    definition: "Material sólido y fibroso que forma el tronco y las ramas de los árboles.",
  },
  "background": {
    pos: "sustantivo",
    translation: "fondo, antecedentes",
    definition: "Conjunto de circunstancias, experiencias o información que rodea y explica algo.",
  },
  "birth": {
    pos: "sustantivo",
    translation: "nacimiento, parto",
    definition: "Momento en que un ser vivo viene al mundo o comienza su vida.",
  },
  "bridge": {
    pos: "sustantivo",
    translation: "puente",
    definition: "Estructura que permite cruzar un río, una vía o un obstáculo.",
  },
  "concept": {
    pos: "sustantivo",
    translation: "concepto",
    definition: "Idea o representación mental abstracta de algo.",
  },
  "copy": {
    pos: "sustantivo",
    translation: "copia, ejemplar",
    definition: "Reproducción o ejemplar de un escrito, obra o documento.",
  },
  "dear": {
    pos: "adjetivo",
    translation: "querido, estimado",
    definition: "Que se siente aprecio o cariño hacia alguien o algo.",
  },
  "host": {
    pos: "sustantivo",
    translation: "anfitrión, presentador",
    definition: "Persona que recibe o entretiene a invitados, o que presenta un programa.",
  },
  "housing": {
    pos: "sustantivo",
    translation: "vivienda, alojamiento",
    definition: "Conjunto de edificios o espacios destinados a que las personas vivan en ellos.",
  },
  "journal": {
    pos: "sustantivo",
    translation: "diario, revista especializada",
    definition: "Publicación periódica que contiene noticias o artículos sobre un tema específico.",
  },
  "labor": {
    pos: "sustantivo",
    translation: "trabajo, labor",
    definition: "Actividad física o mental realizada a cambio de una remuneración.",
  },
  "leadership": {
    pos: "sustantivo",
    translation: "liderazgo",
    definition: "Capacidad de una persona para guiar, influir y dirigir a un grupo hacia objetivos comunes.",
  },
  "length": {
    pos: "sustantivo",
    translation: "longitud",
    definition: "Medida de la distancia entre dos puntos o de la extensión de un objeto de un extremo a otro.",
  },
  "lucky": {
    pos: "adjetivo",
    translation: "afortunado, con suerte",
    definition: "Que tiene buena suerte o que se produce por casualidad favorable.",
  },
  "neither": {
    pos: "conjunción",
    translation: "ni, tampoco",
    definition: "Conjunción que niega dos o más opciones o elementos de una frase.",
  },
  "onto": {
    pos: "preposición",
    translation: "sobre, encima de",
    definition: "Indica posición o movimiento hacia una superficie o lugar.",
  },
  "patient": {
    pos: "adjetivo",
    translation: "paciente",
    definition: "Que tiene paciencia o soporta molestias sin alterarse.",
  },
  "prove": {
    pos: "verbo",
    translation: "probar, demostrar",
    definition: "Establecer la verdad de algo mediante razones o pruebas.",
  },
  "rare": {
    pos: "adjetivo",
    translation: "raro, poco común",
    definition: "Que es poco frecuente o no se encuentra habitualmente.",
  },
  "setting": {
    pos: "sustantivo",
    translation: "entorno, escenario, ajuste",
    definition: "Lugar o contexto donde ocurre algo, o configuración de un dispositivo.",
  },
  "software": {
    pos: "sustantivo",
    translation: "programa informático",
    definition: "Conjunto de programas y datos que permiten a un ordenador realizar tareas.",
  },
  "tough": {
    pos: "adjetivo",
    translation: "duro, difícil, resistente",
    definition: "Que es fuerte, resistente o difícil de superar o soportar.",
  },
  "alive": {
    pos: "adjetivo",
    translation: "vivo, con vida",
    definition: "Que tiene vida o está con vida.",
  },
  "apple": {
    pos: "sustantivo",
    translation: "manzana",
    definition: "Fruta comestible de forma redondeada, piel fina y pulpa jugosa, típica del manzano.",
  },
  "balance": {
    pos: "sustantivo",
    translation: "equilibrio, balanza",
    definition: "Estado de estabilidad o igualdad entre fuerzas o cantidades opuestas.",
  },
  "birthday": {
    pos: "sustantivo",
    translation: "cumpleaños",
    definition: "Día en que se cumple un año más de vida.",
  },
  "boss": {
    pos: "sustantivo",
    translation: "jefe, jefa",
    definition: "Persona que dirige o supervisa a un grupo de trabajadores.",
  },
  "bitch": {
    pos: "sustantivo",
    translation: "perra; zorra",
    definition: "Hembra del perro; coloquialmente, mujer considerada desagradable o malintencionada.",
  },
  "changing": {
    pos: "adjetivo",
    translation: "cambiante",
    definition: "Que cambia o está en proceso de cambio.",
  },
  "connection": {
    pos: "sustantivo",
    translation: "conexión",
    definition: "Relación o vínculo entre dos o más cosas, personas o ideas.",
  },
  "fellow": {
    pos: "sustantivo",
    translation: "tipo, compañero",
    definition: "Persona, generalmente hombre, considerada de manera informal o como compañero.",
  },
  "horse": {
    pos: "sustantivo",
    translation: "caballo",
    definition: "Mamífero équido doméstico, de gran tamaño, usado para montar o tirar de cargas.",
  },
  "dress": {
    pos: "sustantivo",
    translation: "vestido",
    definition: "Prenda de vestir femenina que cubre el torso y las piernas.",
  },
  "magic": {
    pos: "sustantivo",
    translation: "magia",
    definition: "Arte o poder de producir efectos sobrenaturales mediante rituales o encantamientos.",
  },
  "request": {
    pos: "sustantivo",
    translation: "solicitud, petición",
    definition: "Acción de pedir algo de manera formal o educada.",
  },
  "stick": {
    pos: "sustantivo",
    translation: "palo, rama",
    definition: "Trozo de madera alargado y delgado, generalmente de una rama.",
  },
  "volume": {
    pos: "sustantivo",
    translation: "volumen",
    definition: "Magnitud que mide la extensión de un cuerpo en tres dimensiones o el espacio que ocupa.",
  },
  "vehicle": {
    pos: "sustantivo",
    translation: "vehículo",
    definition: "Medio de transporte que sirve para trasladar personas o cosas de un lugar a otro.",
  },
  "wake": {
    pos: "sustantivo",
    translation: "estela, despertar",
    definition: "Estela que deja una embarcación al moverse por el agua; también acción de despertar.",
  },
  "beauty": {
    pos: "sustantivo",
    translation: "belleza",
    definition: "Cualidad de lo que produce placer estético o admiración por su armonía y perfección.",
  },
  "billion": {
    pos: "sustantivo",
    translation: "mil millones",
    definition: "Número equivalente a mil millones, es decir, 1.000.000.000.",
  },
  "busy": {
    pos: "adjetivo",
    translation: "ocupado, atareado",
    definition: "Que tiene mucho trabajo o muchas actividades y poco tiempo libre.",
  },
  "buying": {
    pos: "sustantivo",
    translation: "compra, adquisición",
    definition: "Acción de adquirir algo mediante pago.",
  },
  "conversation": {
    pos: "sustantivo",
    translation: "conversación",
    definition: "Intercambio oral de ideas o información entre dos o más personas.",
  },
  "criminal": {
    pos: "adjetivo/sustantivo",
    translation: "criminal, delincuente",
    definition: "Persona que comete un delito o relativo al crimen.",
  },
  "corner": {
    pos: "sustantivo",
    translation: "esquina, rincón",
    definition: "Ángulo o lugar donde se unen dos superficies o lados.",
  },
  "cultural": {
    pos: "adjetivo",
    translation: "cultural",
    definition: "Relativo a la cultura o a las manifestaciones artísticas e intelectuales de una sociedad.",
  },
  "develop": {
    pos: "verbo",
    translation: "desarrollar",
    definition: "Hacer crecer o progresar algo, aumentando su tamaño, complejidad o calidad.",
  },
  "driver": {
    pos: "sustantivo",
    translation: "conductor, chofer",
    definition: "Persona que conduce un vehículo.",
  },
  "farm": {
    pos: "sustantivo",
    translation: "granja, finca",
    definition: "Terreno rural con edificaciones dedicado a la agricultura o ganadería.",
  },
  "file": {
    pos: "sustantivo",
    translation: "archivo, lima",
    definition: "Documento o conjunto de datos almacenado; también herramienta para limar.",
  },
  "frank": {
    pos: "adjetivo",
    translation: "franco, sincero",
    definition: "Que se expresa con sinceridad y sin ocultar sus pensamientos.",
  },
  "guide": {
    pos: "sustantivo",
    translation: "guía",
    definition: "Persona o cosa que orienta o muestra el camino a otros.",
  },
  "investigation": {
    pos: "sustantivo",
    translation: "investigación",
    definition: "Acción de examinar o estudiar algo con detenimiento para descubrir o esclarecer hechos.",
  },
  "raise": {
    pos: "verbo",
    translation: "levantar, subir, criar",
    definition: "Mover algo hacia arriba, aumentar su nivel o criar a un hijo o animal.",
  },
  "responsibility": {
    pos: "sustantivo",
    translation: "responsabilidad",
    definition: "Obligación de responder por los propios actos o por los de otros.",
  },
  "roll": {
    pos: "sustantivo",
    translation: "rollo, panecillo",
    definition: "Pieza de pan pequeña y redondeada, o cilindro de material enrollado.",
  },
  "suggest": {
    pos: "verbo",
    translation: "sugerir, proponer",
    definition: "Indicar o proponer una idea o acción de manera indirecta.",
  },
  "surprise": {
    pos: "sustantivo",
    translation: "sorpresa",
    definition: "Emoción causada por algo inesperado o imprevisto.",
  },
  "treat": {
    pos: "sustantivo",
    translation: "gusto, placer, regalo",
    definition: "Algo especial y agradable que se da o se disfruta, a menudo como recompensa o muestra de cariño.",
  },
  "technical": {
    pos: "adjetivo",
    translation: "técnico, técnica",
    definition: "Relativo a la técnica o a las aplicaciones prácticas de la ciencia.",
  },
  "variety": {
    pos: "sustantivo",
    translation: "variedad",
    definition: "Conjunto de cosas diversas o cualidad de ser diferente.",
  },
  "youth": {
    pos: "sustantivo",
    translation: "juventud",
    definition: "Período de la vida entre la infancia y la edad adulta.",
  },
  "violence": {
    pos: "sustantivo",
    translation: "violencia",
    definition: "Uso de la fuerza física o verbal para causar daño o someter a alguien.",
  },
  "appreciate": {
    pos: "verbo",
    translation: "apreciar, valorar",
    definition: "Reconocer el valor o mérito de algo o alguien.",
  },
  "bigger": {
    pos: "adjetivo",
    translation: "más grande",
    definition: "Forma comparativa de big; que tiene mayor tamaño o importancia que otra cosa.",
  },
  "edge": {
    pos: "sustantivo",
    translation: "borde, filo",
    definition: "Línea o superficie que limita una cosa o el filo cortante de un objeto.",
  },
  "evil": {
    pos: "adjetivo",
    translation: "malvado, malo",
    definition: "Que es malo, perverso o causa daño moral.",
  },
  "excited": {
    pos: "adjetivo",
    translation: "emocionado, entusiasmado",
    definition: "Que siente gran entusiasmo o emoción por algo.",
  },
  "henry": {
    pos: "sustantivo",
    translation: "henrio (unidad de inductancia)",
    definition: "Unidad de inductancia del Sistema Internacional, equivalente a un weber por amperio.",
  },
  "injury": {
    pos: "sustantivo",
    translation: "lesión, herida",
    definition: "Daño o perjuicio causado al cuerpo o a algo material.",
  },
  "forever": {
    pos: "adverbio",
    translation: "para siempre",
    definition: "Indica que algo dura o existirá sin límite de tiempo.",
  },
  "iron": {
    pos: "sustantivo",
    translation: "hierro",
    definition: "Metal ferromagnético, duro y maleable, usado en construcción e industria.",
  },
  "magazine": {
    pos: "sustantivo",
    translation: "revista",
    definition: "Publicación periódica con artículos e imágenes sobre diversos temas.",
  },
  "lovely": {
    pos: "adjetivo",
    translation: "encantador, precioso",
    definition: "Que es agradable, bello o digno de admiración.",
  },
  "martin": {
    pos: "sustantivo",
    translation: "martín pescador",
    definition: "Ave acuática de colores vivos que se alimenta de peces.",
  },
  "parliament": {
    pos: "sustantivo",
    translation: "parlamento",
    definition: "Órgano legislativo que representa al pueblo y elabora las leyes.",
  },
  "reference": {
    pos: "sustantivo",
    translation: "referencia",
    definition: "Indicación o mención que remite a otra cosa o persona.",
  },
  "religion": {
    pos: "sustantivo",
    translation: "religión",
    definition: "Conjunto de creencias y prácticas sobre lo divino y lo sagrado.",
  },
  "somewhere": {
    pos: "adverbio",
    translation: "en algún lugar",
    definition: "Indica un lugar no especificado o desconocido.",
  },
  "strategy": {
    pos: "sustantivo",
    translation: "estrategia",
    definition: "Plan o conjunto de acciones para alcanzar un objetivo.",
  },
  "wine": {
    pos: "sustantivo",
    translation: "vino",
    definition: "Bebida alcohólica obtenida de la fermentación del mosto de uvas.",
  },
  "audience": {
    pos: "sustantivo",
    translation: "público, audiencia",
    definition: "Conjunto de personas que escuchan o presencian un espectáculo, discurso o programa.",
  },
  "blog": {
    pos: "sustantivo",
    translation: "blog, bitácora digital",
    definition: "Sitio web con entradas cronológicas sobre temas personales o profesionales.",
  },
  "core": {
    pos: "sustantivo",
    translation: "núcleo, centro",
    definition: "Parte central o más importante de algo.",
  },
  "closer": {
    pos: "adjetivo",
    translation: "más cercano",
    definition: "Que está a menor distancia o es más próximo que otro.",
  },
  "democratic": {
    pos: "adjetivo",
    translation: "democrático, democrática",
    definition: "Relativo a la democracia o que defiende la soberanía del pueblo.",
  },
  "description": {
    pos: "sustantivo",
    translation: "descripción",
    definition: "Acción de representar o explicar algo con palabras, detallando sus características.",
  },
  "exist": {
    pos: "verbo",
    translation: "existir",
    definition: "Tener realidad o ser algo en el mundo.",
  },
  "excellent": {
    pos: "adjetivo",
    translation: "excelente, muy bueno",
    definition: "Que sobresale por su gran calidad o mérito.",
  },
  "guard": {
    pos: "sustantivo",
    translation: "guarda, guardia",
    definition: "Persona que vigila o protege un lugar o a alguien.",
  },
  "jones": {
    pos: "sustantivo",
    translation: "adicción a la heroína",
    definition: "Dependencia o adicción a la heroína u otras drogas.",
  },
  "honest": {
    pos: "adjetivo",
    translation: "honesto, sincero",
    definition: "Que actúa con rectitud, sinceridad y respeto a la verdad.",
  },
  "medicine": {
    pos: "sustantivo",
    translation: "medicina, medicamento",
    definition: "Sustancia o práctica usada para prevenir, tratar o curar enfermedades.",
  },
  "mention": {
    pos: "verbo",
    translation: "mencionar, hacer referencia",
    definition: "Referirse brevemente a algo o alguien en un discurso o escrito.",
  },
  "mountain": {
    pos: "sustantivo",
    translation: "montaña",
    definition: "Elevación natural del terreno de gran altura y pendiente.",
  },
  "nuclear": {
    pos: "adjetivo",
    translation: "nuclear",
    definition: "Relativo al núcleo atómico o a la energía que se obtiene de él.",
  },
  "port": {
    pos: "sustantivo",
    translation: "puerto",
    definition: "Lugar en la costa donde las embarcaciones pueden atracar y refugiarse.",
  },
  "presence": {
    pos: "sustantivo",
    translation: "presencia",
    definition: "Hecho de estar una persona o cosa en un lugar.",
  },
  "reaction": {
    pos: "sustantivo",
    translation: "reacción",
    definition: "Respuesta o efecto que se produce ante un estímulo o acción.",
  },
  "reduce": {
    pos: "verbo",
    translation: "reducir, disminuir",
    definition: "Hacer menor en cantidad, tamaño o intensidad algo.",
  },
  "solid": {
    pos: "adjetivo",
    translation: "sólido, firme, macizo",
    definition: "Que tiene consistencia firme y mantiene su forma; también, firme o seguro.",
  },
  "shoot": {
    pos: "verbo",
    translation: "disparar, tirar",
    definition: "Lanzar un proyectil con un arma o arrojar algo con fuerza.",
  },
  "spanish": {
    pos: "adjetivo",
    translation: "español, de España",
    definition: "Relativo a España, su lengua, cultura o sus habitantes.",
  },
  "sport": {
    pos: "sustantivo",
    translation: "deporte",
    definition: "Actividad física o juego con reglas, practicada individualmente o en equipo.",
  },
  "stress": {
    pos: "sustantivo",
    translation: "estrés, tensión",
    definition: "Estado de tensión física o emocional causado por demandas o presiones.",
  },
  "taste": {
    pos: "sustantivo",
    translation: "sabor, gusto",
    definition: "Sensación percibida por el paladar al probar un alimento o bebida.",
  },
  "victory": {
    pos: "sustantivo",
    translation: "victoria, triunfo",
    definition: "Éxito o triunfo obtenido en una competición, batalla o conflicto.",
  },
  "afternoon": {
    pos: "sustantivo",
    translation: "tarde",
    definition: "Parte del día que va desde el mediodía hasta el anochecer.",
  },
  "assistant": {
    pos: "sustantivo",
    translation: "asistente, ayudante",
    definition: "Persona que ayuda o asiste a otra en sus tareas o funciones.",
  },
  "classic": {
    pos: "adjetivo",
    translation: "clásico, típico",
    definition: "Que se considera modelo o representativo de su género por su calidad o tradición.",
  },
  "clothes": {
    pos: "sustantivo",
    translation: "ropa, prendas de vestir",
    definition: "Conjunto de prendas que se usan para cubrir el cuerpo.",
  },
  "electric": {
    pos: "adjetivo",
    translation: "eléctrico, relativo a la electricidad",
    definition: "Que funciona con electricidad o está relacionado con ella.",
  },
  "emergency": {
    pos: "sustantivo",
    translation: "emergencia",
    definition: "Situación grave e imprevista que requiere acción inmediata.",
  },
  "failure": {
    pos: "sustantivo",
    translation: "fallo, fracaso",
    definition: "Falta de éxito o incumplimiento de un objetivo o expectativa.",
  },
  "festival": {
    pos: "sustantivo",
    translation: "festival, fiesta",
    definition: "Celebración o evento público, a menudo artístico o cultural, con actuaciones y actividades.",
  },
  "flat": {
    pos: "adjetivo",
    translation: "plano, liso",
    definition: "Que tiene una superficie uniforme, sin relieves ni desniveles.",
  },
  "fuel": {
    pos: "sustantivo",
    translation: "combustible",
    definition: "Sustancia que se quema para producir energía calorífica o motriz.",
  },
  "harry": {
    pos: "verbo",
    translation: "acosar, hostigar",
    definition: "Molestar o acosar a alguien de forma insistente y repetida.",
  },
  "hello": {
    pos: "interjección",
    translation: "hola",
    definition: "Saludo informal usado al encontrarse o al iniciar una conversación.",
  },
  "initial": {
    pos: "adjetivo",
    translation: "inicial, primero",
    definition: "Que corresponde al principio o comienzo de algo.",
  },
  "mail": {
    pos: "sustantivo",
    translation: "correo",
    definition: "Conjunto de cartas y paquetes que se envían o reciben por un servicio postal.",
  },
  "kick": {
    pos: "verbo",
    translation: "patear, dar patada",
    definition: "Golpear algo o a alguien con el pie.",
  },
  "pair": {
    pos: "sustantivo",
    translation: "par, pareja",
    definition: "Conjunto de dos cosas o personas que van juntas o se consideran como una unidad.",
  },
  "massive": {
    pos: "adjetivo",
    translation: "masivo, enorme, colosal",
    definition: "Que es muy grande, voluminoso o de gran magnitud.",
  },
  "plane": {
    pos: "sustantivo",
    translation: "avión, plano",
    definition: "Aeronave con alas y motores; o superficie plana en geometría.",
  },
  "plenty": {
    pos: "pronombre",
    translation: "abundancia, mucho",
    definition: "Cantidad grande o suficiente de algo; gran abundancia.",
  },
  "prince": {
    pos: "sustantivo",
    translation: "príncipe",
    definition: "Hijo del rey o soberano de un principado.",
  },
  "proper": {
    pos: "adjetivo",
    translation: "correcto, adecuado, apropiado",
    definition: "Que es correcto, adecuado o apropiado para un fin o situación.",
  },
  "quarter": {
    pos: "sustantivo",
    translation: "cuarto, trimestre, moneda",
    definition: "Cada una de las cuatro partes iguales de un todo; también periodo de tres meses o moneda de 25 centavos.",
  },
  "session": {
    pos: "sustantivo",
    translation: "sesión",
    definition: "Período de tiempo dedicado a una actividad o reunión.",
  },
  "regional": {
    pos: "adjetivo",
    translation: "regional",
    definition: "Perteneciente o relativo a una región o a las regiones.",
  },
  "shape": {
    pos: "sustantivo",
    translation: "forma, figura",
    definition: "Apariencia exterior o contorno de un objeto o cuerpo.",
  },
  "toward": {
    pos: "preposición",
    translation: "hacia, en dirección a",
    definition: "Indica la dirección o el destino hacia el que se mueve algo o alguien.",
  },
  "transfer": {
    pos: "sustantivo",
    translation: "transferencia, traslado",
    definition: "Acción de pasar algo o a alguien de un lugar o situación a otro.",
  },
  "upper": {
    pos: "adjetivo",
    translation: "superior, de arriba",
    definition: "Que está situado más arriba o es de la parte superior.",
  },
  "teaching": {
    pos: "sustantivo",
    translation: "enseñanza, docencia",
    definition: "Acción o práctica de enseñar, transmitir conocimientos o habilidades a otros.",
  },
  "valley": {
    pos: "sustantivo",
    translation: "valle",
    definition: "Depresión de terreno entre montañas, generalmente recorrida por un río.",
  },
  "useful": {
    pos: "adjetivo",
    translation: "útil, provechoso",
    definition: "Que sirve o resulta provechoso para un fin determinado.",
  },
  "zone": {
    pos: "sustantivo",
    translation: "zona, área",
    definition: "Superficie o espacio delimitado con características particulares.",
  },
  "accident": {
    pos: "sustantivo",
    translation: "accidente",
    definition: "Suceso imprevisto que causa daño o altera el orden normal de las cosas.",
  },
  "alternative": {
    pos: "adjetivo",
    translation: "alternativo, otra opción",
    definition: "Que ofrece o constituye otra posibilidad o opción distinta a la principal.",
  },
  "boat": {
    pos: "sustantivo",
    translation: "barco, bote",
    definition: "Embarcación que navega sobre el agua, impulsada por remos, viento o motor.",
  },
  "anywhere": {
    pos: "adverbio",
    translation: "en cualquier lugar",
    definition: "Indica un lugar indeterminado o no especificado donde ocurre algo.",
  },
  "bear": {
    pos: "sustantivo",
    translation: "oso",
    definition: "Mamífero carnívoro de gran tamaño, pelaje espeso y garras fuertes.",
  },
  "capacity": {
    pos: "sustantivo",
    translation: "capacidad",
    definition: "Aptitud o espacio disponible para contener, realizar o producir algo.",
  },
  "climate": {
    pos: "sustantivo",
    translation: "clima",
    definition: "Conjunto de condiciones atmosféricas habituales de una región.",
  },
  "cheap": {
    pos: "adjetivo",
    translation: "barato, económico",
    definition: "Que tiene un precio bajo o cuesta poco dinero.",
  },
  "discussion": {
    pos: "sustantivo",
    translation: "discusión, debate",
    definition: "Conversación o debate sobre un tema, a menudo con opiniones diferentes.",
  },
  "fantastic": {
    pos: "adjetivo",
    translation: "fantástico, maravilloso",
    definition: "Que es extraordinario, excelente o muy bueno en su género.",
  },
  "duty": {
    pos: "sustantivo",
    translation: "deber, obligación",
    definition: "Obligación moral o legal que una persona tiene que cumplir.",
  },
  "governor": {
    pos: "sustantivo",
    translation: "gobernador, gobernante",
    definition: "Persona que ejerce el gobierno o la autoridad en un territorio o institución.",
  },
  "industrial": {
    pos: "adjetivo",
    translation: "industrial",
    definition: "Relativo a la industria o a la producción en fábricas.",
  },
  "hundred": {
    pos: "sustantivo",
    translation: "cien, centenar",
    definition: "Número cardinal equivalente a diez veces diez.",
  },
  "joint": {
    pos: "sustantivo",
    translation: "articulación, junta",
    definition: "Punto donde se unen dos o más partes, especialmente en el cuerpo o en una estructura.",
  },
  "museum": {
    pos: "sustantivo",
    translation: "museo",
    definition: "Institución que conserva y exhibe colecciones de arte, ciencia o historia.",
  },
  "path": {
    pos: "sustantivo",
    translation: "camino, sendero",
    definition: "Vía o ruta por la que se transita, generalmente estrecha o trazada para un recorrido.",
  },
  "promise": {
    pos: "sustantivo",
    translation: "promesa",
    definition: "Compromiso o palabra dada de hacer o cumplir algo.",
  },
  "purchase": {
    pos: "sustantivo",
    translation: "compra, adquisición",
    definition: "Acción de comprar algo o el objeto adquirido mediante pago.",
  },
  "rain": {
    pos: "sustantivo",
    translation: "lluvia",
    definition: "Agua que cae de las nubes en forma de gotas.",
  },
  "remove": {
    pos: "verbo",
    translation: "quitar, eliminar",
    definition: "Quitar o eliminar algo de un lugar o de un conjunto.",
  },
  "steel": {
    pos: "sustantivo",
    translation: "acero",
    definition: "Aleación de hierro y carbono, dura y resistente, usada en construcción e industria.",
  },
  "steve": {
    pos: "sustantivo",
    translation: "nombre propio masculino",
    definition: "Nombre propio masculino de origen inglés, equivalente a Esteban.",
  },
  "terrible": {
    pos: "adjetivo",
    translation: "terrible, horrible, espantoso",
    definition: "Que causa miedo, horror o es muy desagradable.",
  },
  "turning": {
    pos: "sustantivo",
    translation: "giro, torneado",
    definition: "Acción de girar o el resultado de tornear una pieza.",
  },
  "vice": {
    pos: "sustantivo",
    translation: "vicio, defecto",
    definition: "Costumbre o práctica inmoral o perjudicial; defecto o mala inclinación de una persona.",
  },
  "canadian": {
    pos: "adjetivo",
    translation: "canadiense",
    definition: "Relativo a Canadá o a sus habitantes.",
  },
  "warm": {
    pos: "adjetivo",
    translation: "cálido, templado",
    definition: "Que tiene una temperatura moderadamente alta o que produce sensación de calor agradable.",
  },
  "republican": {
    pos: "adjetivo",
    translation: "republicano",
    definition: "Relativo a la república o partidario de ella.",
  },
  "crew": {
    pos: "sustantivo",
    translation: "tripulación, equipo",
    definition: "Conjunto de personas que trabajan juntas en una nave, aeronave o producción.",
  },
  "command": {
    pos: "sustantivo",
    translation: "orden, mando",
    definition: "Instrucción o autoridad para dirigir o dar órdenes a otros.",
  },
  "beer": {
    pos: "sustantivo",
    translation: "cerveza",
    definition: "Bebida alcohólica fermentada a partir de cereales, generalmente cebada.",
  },
  "border": {
    pos: "sustantivo",
    translation: "borde, frontera",
    definition: "Línea que separa dos territorios o el extremo de una superficie.",
  },
  "dick": {
    pos: "sustantivo",
    translation: "pene; idiota",
    definition: "Órgano sexual masculino, o persona desagradable o estúpida.",
  },
  "enemy": {
    pos: "sustantivo",
    translation: "enemigo, enemiga",
    definition: "Persona o grupo que se opone o es hostil a otro.",
  },
  "environmental": {
    pos: "adjetivo",
    translation: "ambiental",
    definition: "Relativo al medio ambiente o a las condiciones que rodean a los seres vivos.",
  },
  "ensure": {
    pos: "verbo",
    translation: "asegurar, garantizar",
    definition: "Hacer que algo sea seguro o cierto.",
  },
  "forest": {
    pos: "sustantivo",
    translation: "bosque",
    definition: "Terreno extenso cubierto principalmente de árboles y vegetación.",
  },
  "intelligence": {
    pos: "sustantivo",
    translation: "inteligencia",
    definition: "Capacidad de comprender, aprender y resolver problemas.",
  },
  "labour": {
    pos: "sustantivo",
    translation: "trabajo, mano de obra",
    definition: "Trabajo o esfuerzo humano, especialmente el físico o el realizado por trabajadores.",
  },
  "limit": {
    pos: "sustantivo",
    translation: "límite",
    definition: "Punto o cantidad que no se puede exceder o sobrepasar.",
  },
  "ocean": {
    pos: "sustantivo",
    translation: "océano",
    definition: "Gran masa de agua salada que cubre la mayor parte de la superficie terrestre.",
  },
  "moon": {
    pos: "sustantivo",
    translation: "luna",
    definition: "Satélite natural que orbita alrededor de un planeta, especialmente la Tierra.",
  },
  "proof": {
    pos: "sustantivo",
    translation: "prueba, demostración",
    definition: "Evidencia o argumento que demuestra la verdad o validez de algo.",
  },
  "profit": {
    pos: "sustantivo",
    translation: "ganancia, beneficio",
    definition: "Ganancia económica obtenida de una actividad comercial o inversión.",
  },
  "suit": {
    pos: "sustantivo",
    translation: "traje, terno",
    definition: "Conjunto de chaqueta y pantalón o falda del mismo tejido.",
  },
  "asian": {
    pos: "adjetivo",
    translation: "asiático",
    definition: "Relativo a Asia o a sus habitantes, culturas o lenguas.",
  },
  "attorney": {
    pos: "sustantivo",
    translation: "abogado, apoderado",
    definition: "Profesional del derecho que representa o asesora a clientes en asuntos legales.",
  },
  "appearance": {
    pos: "sustantivo",
    translation: "apariencia, aspecto",
    definition: "Aspecto o imagen exterior que presenta una persona o cosa.",
  },
  "behavior": {
    pos: "sustantivo",
    translation: "comportamiento, conducta",
    definition: "Manera en que una persona o cosa actúa o se comporta.",
  },
  "chair": {
    pos: "sustantivo",
    translation: "silla",
    definition: "Mueble con respaldo y patas para que una persona se siente.",
  },
  "debt": {
    pos: "sustantivo",
    translation: "deuda",
    definition: "Obligación de pagar o devolver algo, generalmente dinero, a otra persona.",
  },
  "expensive": {
    pos: "adjetivo",
    translation: "caro, costoso",
    definition: "Que tiene un precio alto o requiere mucho dinero para adquirirse.",
  },
  "domestic": {
    pos: "adjetivo",
    translation: "doméstico, nacional, hogareño",
    definition: "Relativo al hogar, a lo nacional o a los animales criados en casa.",
  },
  "historical": {
    pos: "adjetivo",
    translation: "histórico, histórica",
    definition: "Relativo a la historia o a hechos del pasado documentados.",
  },
  "jump": {
    pos: "verbo",
    translation: "saltar",
    definition: "Impulsarse hacia arriba despegando los pies del suelo.",
  },
  "honor": {
    pos: "sustantivo",
    translation: "honor, honra",
    definition: "Cualidad moral que lleva al cumplimiento del deber y a la rectitud de ánimo.",
  },
  "launch": {
    pos: "verbo",
    translation: "lanzar, iniciar",
    definition: "Hacer que algo empiece o se ponga en marcha, o arrojar algo con fuerza.",
  },
  "minimum": {
    pos: "sustantivo",
    translation: "mínimo",
    definition: "Valor o cantidad más pequeña que puede alcanzarse o permitirse.",
  },
  "native": {
    pos: "adjetivo",
    translation: "nativo, originario",
    definition: "Que pertenece o es originario del lugar donde vive o de donde procede.",
  },
  "survey": {
    pos: "sustantivo",
    translation: "encuesta, estudio",
    definition: "Estudio o sondeo que recopila datos sobre opiniones o características de un grupo.",
  },
  "tech": {
    pos: "sustantivo",
    translation: "tecnología, tecnología informática",
    definition: "Conjunto de conocimientos y técnicas aplicados a la informática y la industria.",
  },
  "supreme": {
    pos: "adjetivo",
    translation: "supremo, máximo",
    definition: "Que es el más alto, importante o poderoso en su ámbito.",
  },
  "update": {
    pos: "sustantivo",
    translation: "actualización",
    definition: "Acción de poner al día o modernizar algo con la información más reciente.",
  },
  "user": {
    pos: "sustantivo",
    translation: "usuario",
    definition: "Persona que utiliza un servicio, sistema o dispositivo.",
  },
  "writer": {
    pos: "sustantivo",
    translation: "escritor, escritora",
    definition: "Persona que se dedica a escribir obras literarias o profesionales.",
  },
  "yellow": {
    pos: "adjetivo",
    translation: "amarillo",
    definition: "Color de la luz solar, situado entre el verde y el naranja en el espectro.",
  },
  "ancient": {
    pos: "adjetivo",
    translation: "antiguo, ancestral",
    definition: "Que pertenece a un tiempo muy remoto o existió hace mucho tiempo.",
  },
  "communication": {
    pos: "sustantivo",
    translation: "comunicación",
    definition: "Proceso de transmitir información entre personas mediante un código común.",
  },
  "download": {
    pos: "sustantivo",
    translation: "descarga",
    definition: "Acción de transferir datos desde un servidor a un dispositivo local.",
  },
  "email": {
    pos: "sustantivo",
    translation: "correo electrónico",
    definition: "Sistema de comunicación que envía mensajes digitales a través de una red.",
  },
  "ending": {
    pos: "sustantivo",
    translation: "final, desenlace, terminación",
    definition: "Parte final o conclusión de algo, como una historia, palabra o proceso.",
  },
  "express": {
    pos: "verbo",
    translation: "expresar, manifestar",
    definition: "Comunicar o manifestar algo mediante palabras, gestos u otros medios.",
  },
  "exercise": {
    pos: "sustantivo",
    translation: "ejercicio",
    definition: "Actividad física o práctica destinada a mejorar la salud o desarrollar una habilidad.",
  },
  "flow": {
    pos: "sustantivo",
    translation: "flujo, corriente",
    definition: "Movimiento continuo de un líquido, gas o energía en una dirección.",
  },
  "girlfriend": {
    pos: "sustantivo",
    translation: "novia, amiga",
    definition: "Persona con la que alguien mantiene una relación amorosa o una amistad íntima.",
  },
  "hero": {
    pos: "sustantivo",
    translation: "héroe",
    definition: "Persona que destaca por su valentía o hazañas extraordinarias.",
  },
  "illegal": {
    pos: "adjetivo",
    translation: "ilegal",
    definition: "Que no está permitido por la ley o que va contra ella.",
  },
  "joke": {
    pos: "sustantivo",
    translation: "broma, chiste",
    definition: "Dicho o historia breve que se cuenta para hacer reír.",
  },
  "loan": {
    pos: "sustantivo",
    translation: "préstamo",
    definition: "Dinero o bien que se entrega a alguien con la obligación de devolverlo.",
  },
  "planet": {
    pos: "sustantivo",
    translation: "planeta",
    definition: "Cuerpo celeste que orbita alrededor de una estrella y no emite luz propia.",
  },
  "restaurant": {
    pos: "sustantivo",
    translation: "restaurante",
    definition: "Establecimiento donde se sirven comidas y bebidas al público.",
  },
  "soft": {
    pos: "adjetivo",
    translation: "suave, blando",
    definition: "Que cede fácilmente a la presión o tiene una textura agradable al tacto.",
  },
  "sugar": {
    pos: "sustantivo",
    translation: "azúcar",
    definition: "Sustancia dulce cristalina que se obtiene de la caña o la remolacha.",
  },
  "transport": {
    pos: "sustantivo",
    translation: "transporte",
    definition: "Medio o sistema para trasladar personas o mercancías de un lugar a otro.",
  },
  "muslim": {
    pos: "adjetivo",
    translation: "musulmán, musulmana",
    definition: "Relativo al islam o persona que profesa la religión islámica.",
  },
  "appropriate": {
    pos: "adjetivo",
    translation: "apropiado, adecuado",
    definition: "Que es conveniente o adecuado para un fin o situación determinada.",
  },
  "appeal": {
    pos: "sustantivo",
    translation: "apelación, atractivo",
    definition: "Solicitud o recurso ante una autoridad, o cualidad que atrae o interesa.",
  },
  "device": {
    pos: "sustantivo",
    translation: "dispositivo, aparato",
    definition: "Objeto o aparato diseñado para realizar una función específica.",
  },
  "entry": {
    pos: "sustantivo",
    translation: "entrada, registro",
    definition: "Acto o cosa que se introduce o se anota en un registro, lista o lugar.",
  },
  "drama": {
    pos: "sustantivo",
    translation: "drama, obra dramática",
    definition: "Obra literaria o representación teatral de tono serio que narra conflictos humanos.",
  },
  "factor": {
    pos: "sustantivo",
    translation: "factor, elemento",
    definition: "Elemento o circunstancia que contribuye a producir un resultado.",
  },
  "feed": {
    pos: "verbo",
    translation: "alimentar, dar de comer",
    definition: "Dar alimento a una persona o animal.",
  },
  "grant": {
    pos: "sustantivo",
    translation: "subvención, beca",
    definition: "Ayuda económica o financiera otorgada para un fin específico, como estudios o proyectos.",
  },
  "golden": {
    pos: "adjetivo",
    translation: "dorado, de oro",
    definition: "Que es de oro o tiene el color o brillo del oro.",
  },
  "lawyer": {
    pos: "sustantivo",
    translation: "abogado, jurista",
    definition: "Profesional del derecho que asesora o representa a clientes en asuntos legales.",
  },
  "mistake": {
    pos: "sustantivo",
    translation: "error, equivocación",
    definition: "Acción o decisión incorrecta que produce un resultado no deseado.",
  },
  "pool": {
    pos: "sustantivo",
    translation: "piscina, estanque",
    definition: "Depósito de agua, natural o artificial, para nadar o recrearse.",
  },
  "platform": {
    pos: "sustantivo",
    translation: "plataforma",
    definition: "Superficie plana elevada o estructura que sirve de base o apoyo.",
  },
  "route": {
    pos: "sustantivo",
    translation: "ruta, camino",
    definition: "Camino o dirección que se sigue para llegar a un destino.",
  },
  "schedule": {
    pos: "sustantivo",
    translation: "horario, programa",
    definition: "Plan o lista que indica las horas y actividades previstas para algo.",
  },
  "scientific": {
    pos: "adjetivo",
    translation: "científico, científica",
    definition: "Relativo a la ciencia o que sigue sus métodos y principios.",
  },
  "smoke": {
    pos: "sustantivo",
    translation: "humo",
    definition: "Producto gaseoso que se desprende de un cuerpo en combustión.",
  },
  "squad": {
    pos: "sustantivo",
    translation: "escuadrón, equipo, pandilla",
    definition: "Grupo pequeño de personas organizado para un fin común, especialmente en contextos deportivos o policiales.",
  },
  "teach": {
    pos: "verbo",
    translation: "enseñar, educar",
    definition: "Transmitir conocimientos o habilidades a alguien mediante instrucción o ejemplo.",
  },
  "testing": {
    pos: "sustantivo",
    translation: "pruebas, evaluación",
    definition: "Proceso de someter algo a pruebas para verificar su funcionamiento o calidad.",
  },
  "italian": {
    pos: "adjetivo",
    translation: "italiano",
    definition: "Relativo a Italia, su lengua, cultura o sus habitantes.",
  },
  "youtube": {
    pos: "sustantivo",
    translation: "YouTube, plataforma de videos",
    definition: "Sitio web para compartir y ver videos en línea.",
  },
  "angry": {
    pos: "adjetivo",
    translation: "enfadado, enojado",
    definition: "Que siente enojo o irritación.",
  },
  "abuse": {
    pos: "sustantivo",
    translation: "abuso, maltrato",
    definition: "Uso indebido, excesivo o injusto de algo o trato cruel a una persona.",
  },
  "candidate": {
    pos: "sustantivo",
    translation: "candidato, aspirante",
    definition: "Persona que aspira a un cargo, puesto o distinción.",
  },
  "comfortable": {
    pos: "adjetivo",
    translation: "cómodo, confortable",
    definition: "Que proporciona comodidad o bienestar, o que se siente a gusto.",
  },
  "discuss": {
    pos: "verbo",
    translation: "discutir, debatir",
    definition: "Hablar sobre un tema para intercambiar opiniones o llegar a un acuerdo.",
  },
  "emotional": {
    pos: "adjetivo",
    translation: "emocional, relativo a emociones",
    definition: "Relativo a las emociones o que las expresa con intensidad.",
  },
  "concern": {
    pos: "sustantivo",
    translation: "preocupación, inquietud",
    definition: "Sentimiento de inquietud o interés por algo o alguien.",
  },
  "water-line": {
    pos: "sustantivo",
    translation: "línea de flotación",
    definition: "Línea que marca el nivel del agua sobre el casco de una embarcación.",
  },
  "country-side": {
    pos: "sustantivo",
    translation: "campo, zona rural",
    definition: "Terreno y paisaje fuera de las ciudades, caracterizado por naturaleza y actividades rurales.",
  },
  "mind-set": {
    pos: "sustantivo",
    translation: "mentalidad, actitud mental",
    definition: "Conjunto de creencias y actitudes que determinan la forma de pensar y actuar de una persona.",
  },
  "top-post": {
    pos: "sustantivo",
    translation: "respuesta al inicio",
    definition: "Publicación que coloca la respuesta antes del mensaje citado.",
  },
  "turn-around": {
    pos: "sustantivo",
    translation: "cambio de rumbo",
    definition: "Acción de invertir la dirección o mejorar radicalmente una situación.",
  },
  "space-time": {
    pos: "sustantivo",
    translation: "espacio-tiempo",
    definition: "Entidad física que combina las tres dimensiones espaciales y el tiempo en un continuo.",
  },
  "stay-at-home": {
    pos: "adjetivo",
    translation: "casero, hogareño",
    definition: "Que permanece en casa habitualmente, especialmente por dedicarse al hogar o evitar salir.",
  },
  "up-date": {
    pos: "sustantivo",
    translation: "actualización, puesta al día",
    definition: "Acción de actualizar o poner al día algo, como datos o información.",
  },
  "break-in": {
    pos: "sustantivo",
    translation: "allanamiento, robo con fuerza",
    definition: "Entrada ilegal en un lugar, generalmente para robar.",
  },
  "cut-back": {
    pos: "sustantivo",
    translation: "recorte, reducción",
    definition: "Disminución o reducción de algo, especialmente de gastos o producción.",
  },
  "t-stop": {
    pos: "sustantivo",
    translation: "parada en T",
    definition: "Técnica de frenado en patinaje que consiste en deslizar un patín perpendicular al otro para detenerse.",
  },
  "water-course": {
    pos: "sustantivo",
    translation: "cauce, curso de agua",
    definition: "Canal natural o artificial por donde corre el agua.",
  },
  "bad-talk": {
    pos: "verbo",
    translation: "hablar mal de",
    definition: "Criticar o hablar negativamente de alguien o algo, a menudo a sus espaldas.",
  },
  "under-report": {
    pos: "verbo",
    translation: "informar de menos",
    definition: "Declarar o registrar una cantidad menor de la real.",
  },
  "mind-read": {
    pos: "verbo",
    translation: "leer la mente",
    definition: "Adivinar o interpretar los pensamientos de otra persona sin que los exprese.",
  },
  "re-think": {
    pos: "verbo",
    translation: "repensar, reconsiderar",
    definition: "Volver a pensar algo para cambiar o mejorar la decisión tomada.",
  },
  "self-right": {
    pos: "sustantivo",
    translation: "derecho propio",
    definition: "Derecho o facultad que alguien tiene por sí mismo, sin depender de otro.",
  },
  "share-out": {
    pos: "sustantivo",
    translation: "reparto, distribución",
    definition: "Acción de dividir y distribuir algo entre varias personas.",
  },
  "time-share": {
    pos: "sustantivo",
    translation: "multipropiedad, tiempo compartido",
    definition: "Sistema por el que varias personas comparten la propiedad y uso de un inmueble por turnos.",
  },
  "break-up": {
    pos: "sustantivo",
    translation: "ruptura, separación",
    definition: "Fin de una relación sentimental o de una asociación entre personas o entidades.",
  },
  "field-work": {
    pos: "sustantivo",
    translation: "trabajo de campo",
    definition: "Actividad de investigación o recogida de datos realizada fuera del laboratorio u oficina.",
  },
  "hold-up": {
    pos: "sustantivo",
    translation: "atraco, retraso",
    definition: "Asalto a mano armada o demora en un proceso o entrega.",
  },
  "cut-off": {
    pos: "sustantivo",
    translation: "punto de corte",
    definition: "Límite o valor que marca el final o la separación de algo.",
  },
  "off-road": {
    pos: "adjetivo",
    translation: "todoterreno",
    definition: "Dícese del vehículo o actividad diseñada para circular fuera de carreteras pavimentadas.",
  },
  "re-work": {
    pos: "sustantivo",
    translation: "retrabajo, reelaboración",
    definition: "Acción de volver a trabajar o reelaborar algo para mejorarlo o corregirlo.",
  },
  "summer-work": {
    pos: "sustantivo",
    translation: "trabajo de verano",
    definition: "Empleo temporal realizado durante la temporada de verano.",
  },
  "work-force": {
    pos: "sustantivo",
    translation: "fuerza laboral",
    definition: "Conjunto de personas que trabajan o están disponibles para trabajar en una empresa o país.",
  },
  "school-child": {
    pos: "sustantivo",
    translation: "escolar, niño escolar",
    definition: "Niño o niña que asiste a la escuela.",
  },
  "data-set": {
    pos: "sustantivo",
    translation: "conjunto de datos",
    definition: "Colección organizada de datos, generalmente en formato tabular, usada para análisis.",
  },
  "cut-down": {
    pos: "adjetivo",
    translation: "reducido, recortado",
    definition: "Que ha sido disminuido o simplificado respecto a su versión original.",
  },
  "face-to-face": {
    pos: "adverbio",
    translation: "cara a cara",
    definition: "De manera directa y en presencia de otra persona.",
  },
  "market-place": {
    pos: "sustantivo",
    translation: "mercado, plaza del mercado",
    definition: "Lugar público donde se realizan transacciones comerciales de bienes y servicios.",
  },
  "self-love": {
    pos: "sustantivo",
    translation: "amor propio",
    definition: "Sentimiento de aprecio y valoración hacia uno mismo.",
  },
  "call-girl": {
    pos: "sustantivo",
    translation: "prostituta de lujo",
    definition: "Mujer que ofrece servicios sexuales por teléfono, generalmente de forma discreta y a domicilio.",
  },
  "house-front": {
    pos: "sustantivo",
    translation: "fachada de la casa",
    definition: "Parte frontal o exterior de una casa que da a la calle.",
  },
  "press-up": {
    pos: "sustantivo",
    translation: "flexión de brazos",
    definition: "Ejercicio físico en el que se baja y sube el cuerpo apoyado en las manos y los pies.",
  },
  "out-guess": {
    pos: "verbo",
    translation: "adivinar mejor que",
    definition: "Superar a alguien anticipando o adivinando sus pensamientos o acciones.",
  },
  "stand-in": {
    pos: "sustantivo",
    translation: "doble, sustituto",
    definition: "Persona que sustituye a otra en un papel o función determinada.",
  },
  "stand-to": {
    pos: "sustantivo",
    translation: "alerta, posición de combate",
    definition: "Estado de alerta en el que las tropas se preparan para el combate.",
  },
  "age-group": {
    pos: "sustantivo",
    translation: "grupo de edad",
    definition: "Conjunto de personas que comparten una misma franja de edad.",
  },
  "drive-in": {
    pos: "sustantivo",
    translation: "autocine",
    definition: "Lugar donde se ven películas desde el coche.",
  },
  "long-term": {
    pos: "adjetivo",
    translation: "a largo plazo",
    definition: "Que se extiende o se refiere a un período de tiempo prolongado.",
  },
  "follow-on": {
    pos: "sustantivo",
    translation: "continuación, efecto posterior",
    definition: "Algo que sigue o resulta de otra cosa, especialmente una acción o evento posterior.",
  },
  "long-running": {
    pos: "adjetivo",
    translation: "de larga duración",
    definition: "Que se extiende o dura mucho tiempo, especialmente un programa o conflicto.",
  },
  "re-use": {
    pos: "verbo",
    translation: "reutilizar, volver a usar",
    definition: "Usar de nuevo algo, especialmente tras darle un uso previo o adaptarlo.",
  },
  "play-act": {
    pos: "verbo",
    translation: "fingir, actuar",
    definition: "Representar un papel o fingir una emoción de forma exagerada.",
  },
  "self-help": {
    pos: "sustantivo",
    translation: "autoayuda",
    definition: "Práctica de mejorar uno mismo sin ayuda profesional externa.",
  },
  "stand-by": {
    pos: "sustantivo",
    translation: "en espera, reserva",
    definition: "Estado de disponibilidad o espera para actuar cuando sea necesario.",
  },
  "rest-home": {
    pos: "sustantivo",
    translation: "residencia de ancianos",
    definition: "Establecimiento donde se cuida y aloja a personas mayores.",
  },
  "follow-up": {
    pos: "sustantivo",
    translation: "seguimiento",
    definition: "Acción de continuar o revisar algo después de un primer contacto o intervención.",
  },
  "out-source": {
    pos: "verbo",
    translation: "externalizar, subcontratar",
    definition: "Encargar a una empresa externa la realización de una actividad o servicio.",
  },
  "re-state": {
    pos: "verbo",
    translation: "volver a declarar",
    definition: "Expresar o declarar algo de nuevo, a menudo con otras palabras.",
  },
  "short-change": {
    pos: "verbo",
    translation: "dar cambio incompleto",
    definition: "Dar a alguien menos cambio del debido al pagar.",
  },
  "stand-up": {
    pos: "sustantivo",
    translation: "monólogo cómico",
    definition: "Actuación cómica en la que una persona cuenta chistes y anécdotas ante el público.",
  },
  "round-up": {
    pos: "sustantivo",
    translation: "redada, recopilación, resumen",
    definition: "Acción de reunir o recopilar personas o cosas dispersas; también operación policial masiva.",
  },
  "trade-in": {
    pos: "sustantivo",
    translation: "permuta, canje",
    definition: "Entrega de un artículo usado como parte del pago de uno nuevo.",
  },
  "check-point": {
    pos: "sustantivo",
    translation: "punto de control",
    definition: "Lugar establecido para controlar o verificar el paso de personas o vehículos.",
  },
  "fall-out": {
    pos: "sustantivo",
    translation: "lluvia radiactiva",
    definition: "Partículas radiactivas que caen a la tierra tras una explosión nuclear.",
  },
  "child-care": {
    pos: "sustantivo",
    translation: "cuidado infantil",
    definition: "Servicio o actividad de atender y cuidar a los niños.",
  },
  "non-group": {
    pos: "sustantivo",
    translation: "no agrupado, fuera de grupo",
    definition: "Que no pertenece o no forma parte de un grupo organizado.",
  },
  "one-step": {
    pos: "adjetivo",
    translation: "de un solo paso",
    definition: "Que se realiza en una sola etapa o paso, sin pasos intermedios.",
  },
  "world-view": {
    pos: "sustantivo",
    translation: "cosmovisión",
    definition: "Conjunto de creencias y valores que conforman la forma de ver el mundo.",
  },
  "break-through": {
    pos: "sustantivo",
    translation: "avance decisivo",
    definition: "Progreso o descubrimiento importante que supera un obstáculo o límite.",
  },
  "check-call": {
    pos: "sustantivo",
    translation: "pagar para ver",
    definition: "Acción de igualar una apuesta en el póker para ver la siguiente carta.",
  },
  "break-down": {
    pos: "sustantivo",
    translation: "desglose, avería, colapso",
    definition: "Análisis detallado o fallo de un sistema, máquina o proceso.",
  },
  "new-model": {
    pos: "verbo",
    translation: "remodelar, renovar",
    definition: "Dar una nueva forma o estructura a algo, reorganizarlo o actualizarlo.",
  },
  "non-person": {
    pos: "sustantivo",
    translation: "no persona",
    definition: "Individuo o entidad a quien no se le reconocen derechos o estatus de persona.",
  },
  "over-value": {
    pos: "verbo",
    translation: "sobrevalorar, valorar en exceso",
    definition: "Atribuir a algo o alguien un valor mayor del que realmente tiene.",
  },
  "man-hour": {
    pos: "sustantivo",
    translation: "hora-hombre",
    definition: "Unidad de trabajo equivalente al trabajo de una persona durante una hora.",
  },
  "non-white": {
    pos: "adjetivo",
    translation: "no blanco",
    definition: "Que no pertenece a la raza blanca o no es de piel clara.",
  },
  "over-rate": {
    pos: "verbo",
    translation: "sobrevalorar, tasar demasiado",
    definition: "Valorar o tasar algo por encima de su valor real.",
  },
  "send-up": {
    pos: "sustantivo",
    translation: "parodia, sátira burlesca",
    definition: "Imitación burlesca que ridiculiza a alguien o algo.",
  },
  "add-on": {
    pos: "sustantivo",
    translation: "complemento, accesorio adicional",
    definition: "Elemento o dispositivo que se añade a otro para ampliar sus funciones.",
  },
  "major-general": {
    pos: "sustantivo",
    translation: "general de división",
    definition: "Oficial militar de alto rango, inferior al teniente general y superior al general de brigada.",
  },
  "self-care": {
    pos: "sustantivo",
    translation: "autocuidado",
    definition: "Conjunto de prácticas que una persona realiza para cuidar su salud física y mental.",
  },
  "over-eat": {
    pos: "verbo",
    translation: "comer en exceso",
    definition: "Ingerir más comida de la necesaria o de forma compulsiva.",
  },
  "short-course": {
    pos: "adjetivo",
    translation: "de curso corto",
    definition: "Que dura poco tiempo o tiene una duración breve, especialmente un curso o tratamiento.",
  },
  "self-government": {
    pos: "sustantivo",
    translation: "autogobierno",
    definition: "Capacidad de una comunidad o territorio para gobernarse por sí mismo.",
  },
  "stand-off": {
    pos: "sustantivo",
    translation: "enfrentamiento, punto muerto",
    definition: "Situación de bloqueo o confrontación en la que ninguna parte cede ni avanza.",
  },
  "built-in": {
    pos: "adjetivo",
    translation: "incorporado, integrado",
    definition: "Que está incluido de forma permanente en algo y no puede separarse fácilmente.",
  },
  "by-election": {
    pos: "sustantivo",
    translation: "elección parcial",
    definition: "Elección convocada para cubrir un escaño vacante entre elecciones generales.",
  },
  "dead-end": {
    pos: "sustantivo",
    translation: "callejón sin salida",
    definition: "Calle o situación que no tiene salida ni continuación posible.",
  },
  "coming-of-age": {
    pos: "sustantivo",
    translation: "mayoría de edad",
    definition: "Proceso o etapa de transición hacia la edad adulta y la madurez personal.",
  },
  "black-market": {
    pos: "sustantivo",
    translation: "mercado negro",
    definition: "Mercado ilegal donde se comercian bienes o servicios fuera de la ley.",
  },
  "day-trade": {
    pos: "verbo",
    translation: "operar intradía",
    definition: "Comprar y vender valores el mismo día para aprovechar fluctuaciones de precio.",
  },
  "re-group": {
    pos: "verbo",
    translation: "reagrupar, volver a agrupar",
    definition: "Volver a reunir o formar un grupo con personas o cosas dispersas.",
  },
  "fall-off": {
    pos: "sustantivo",
    translation: "disminución, caída",
    definition: "Reducción o descenso en la cantidad, calidad o intensidad de algo.",
  },
  "cover-up": {
    pos: "sustantivo",
    translation: "encubrimiento",
    definition: "Acción de ocultar o disimular un delito o una conducta indebida.",
  },
  "follow-through": {
    pos: "sustantivo",
    translation: "seguimiento, continuación",
    definition: "Acción de completar o continuar algo hasta su final, especialmente un gesto o compromiso.",
  },
  "full-term": {
    pos: "adjetivo",
    translation: "a término completo",
    definition: "Que nace o se completa al final del período normal de gestación o plazo.",
  },
  "fact-check": {
    pos: "sustantivo",
    translation: "verificación de datos",
    definition: "Comprobación de la exactitud de la información o afirmaciones publicadas.",
  },
  "night-club": {
    pos: "sustantivo",
    translation: "club nocturno",
    definition: "Local donde se baila y se bebe por la noche.",
  },
  "re-read": {
    pos: "verbo",
    translation: "volver a leer",
    definition: "Leer de nuevo un texto o documento.",
  },
  "pick-up": {
    pos: "sustantivo",
    translation: "camioneta, recogida",
    definition: "Vehículo pequeño con caja abierta o acción de recoger algo o a alguien.",
  },
  "re-start": {
    pos: "verbo",
    translation: "reiniciar, volver a empezar",
    definition: "Comenzar de nuevo una actividad o proceso que se había interrumpido.",
  },
  "short-coming": {
    pos: "sustantivo",
    translation: "defecto, carencia",
    definition: "Falta o imperfección que reduce el valor o la calidad de algo o alguien.",
  },
  "walk-out": {
    pos: "sustantivo",
    translation: "huelga, retirada, abandono",
    definition: "Acción de abandonar un lugar o reunión en señal de protesta, o huelga laboral.",
  },
  "walk-up": {
    pos: "sustantivo",
    translation: "edificio sin ascensor",
    definition: "Edificio de apartamentos sin ascensor, o vivienda ubicada en él.",
  },
  "son-in-law": {
    pos: "sustantivo",
    translation: "yerno",
    definition: "Esposo de la hija de una persona respecto de sus padres.",
  },
  "bed-time": {
    pos: "sustantivo",
    translation: "hora de dormir",
    definition: "Momento del día establecido para irse a la cama a dormir.",
  },
  "trade-off": {
    pos: "sustantivo",
    translation: "compensación, contrapartida",
    definition: "Sacrificio de una cosa para obtener otra; equilibrio entre ventajas y desventajas.",
  },
  "head-rest": {
    pos: "sustantivo",
    translation: "reposacabezas",
    definition: "Almohadilla o soporte para apoyar la cabeza.",
  },
  "hot-house": {
    pos: "sustantivo",
    translation: "invernadero",
    definition: "Lugar cerrado y protegido donde se cultivan plantas que necesitan calor.",
  },
  "body-check": {
    pos: "sustantivo",
    translation: "carga corporal",
    definition: "Choque intencional con el cuerpo para bloquear o desplazar a un oponente.",
  },
  "father-in-law": {
    pos: "sustantivo",
    translation: "suegro",
    definition: "Padre del cónyuge de una persona.",
  },
  "self-service": {
    pos: "sustantivo",
    translation: "autoservicio",
    definition: "Sistema en el que el cliente se sirve a sí mismo sin ayuda del personal.",
  },
  "re-call": {
    pos: "verbo",
    translation: "recordar, llamar de nuevo",
    definition: "Volver a llamar a alguien o traer algo a la memoria.",
  },
  "road-side": {
    pos: "sustantivo",
    translation: "borde de la carretera",
    definition: "Zona o margen situado junto al borde de una carretera.",
  },
  "send-off": {
    pos: "sustantivo",
    translation: "despedida, homenaje de despedida",
    definition: "Reunión o acto para despedir y homenajear a alguien que se va.",
  },
  "by-pass": {
    pos: "sustantivo",
    translation: "derivación, circunvalación",
    definition: "Vía alternativa que rodea un obstáculo o población para evitar el tráfico.",
  },
  "film-making": {
    pos: "sustantivo",
    translation: "realización cinematográfica",
    definition: "Proceso de crear una película, desde la idea hasta el montaje final.",
  },
  "high-step": {
    pos: "verbo",
    translation: "levantar mucho las rodillas",
    definition: "Caminar levantando mucho las rodillas, como en una marcha exagerada.",
  },
  "life-style": {
    pos: "sustantivo",
    translation: "estilo de vida",
    definition: "Conjunto de hábitos y costumbres que caracterizan la forma de vivir de una persona o grupo.",
  },
  "living-room": {
    pos: "sustantivo",
    translation: "sala de estar",
    definition: "Habitación de la casa destinada a recibir visitas y al descanso familiar.",
  },
  "pick-me-up": {
    pos: "sustantivo",
    translation: "estimulante, tónico",
    definition: "Bebida o cosa que reanima y da energía.",
  },
  "in-box": {
    pos: "sustantivo",
    translation: "bandeja de entrada",
    definition: "Carpeta donde se reciben los correos electrónicos nuevos.",
  },
  "re-open": {
    pos: "verbo",
    translation: "volver a abrir",
    definition: "Abrir de nuevo algo que estaba cerrado.",
  },
  "re-order": {
    pos: "verbo",
    translation: "volver a pedir",
    definition: "Solicitar de nuevo algo que ya se había pedido.",
  },
  "second-guess": {
    pos: "verbo",
    translation: "cuestionar, criticar después",
    definition: "Cuestionar o criticar una decisión o acción después de que ya ha ocurrido.",
  },
  "re-run": {
    pos: "sustantivo",
    translation: "repetición, nueva emisión",
    definition: "Acción de volver a emitir o repetir un programa, evento o proceso.",
  },
  "south-west": {
    pos: "sustantivo",
    translation: "suroeste",
    definition: "Punto cardinal situado entre el sur y el oeste.",
  },
  "forget-me-not": {
    pos: "sustantivo",
    translation: "nomeolvides",
    definition: "Planta herbácea de flores pequeñas y azules que simboliza el recuerdo.",
  },
  "die-back": {
    pos: "sustantivo",
    translation: "muerte regresiva",
    definition: "Muerte progresiva de brotes o ramas de una planta desde las puntas hacia el interior.",
  },
  "mark-up": {
    pos: "sustantivo",
    translation: "margen de beneficio",
    definition: "Diferencia entre el precio de venta y el costo de un producto.",
  },
  "mother-in-law": {
    pos: "sustantivo",
    translation: "suegra",
    definition: "Madre del cónyuge de una persona.",
  },
  "role-play": {
    pos: "sustantivo",
    translation: "juego de rol",
    definition: "Actividad en la que los participantes interpretan personajes o situaciones simuladas.",
  },
  "view-point": {
    pos: "sustantivo",
    translation: "punto de vista",
    definition: "Perspectiva o manera particular de considerar o juzgar un asunto.",
  },
  "time-table": {
    pos: "sustantivo",
    translation: "horario",
    definition: "Tabla que indica las horas y actividades programadas para su realización.",
  },
  "voice-over": {
    pos: "sustantivo",
    translation: "voz en off",
    definition: "Narración hablada que no se ve en pantalla, usada en cine, TV o publicidad.",
  },
  "build-up": {
    pos: "sustantivo",
    translation: "acumulación, aumento gradual",
    definition: "Aumento o acumulación progresiva de algo con el tiempo.",
  },
  "high-quality": {
    pos: "adjetivo",
    translation: "de alta calidad",
    definition: "Que posee un nivel superior de excelencia o calidad.",
  },
  "self-control": {
    pos: "sustantivo",
    translation: "autocontrol",
    definition: "Capacidad de controlar las propias emociones, impulsos y comportamientos.",
  },
  "non-human": {
    pos: "adjetivo",
    translation: "no humano",
    definition: "Que no pertenece o no es propio del ser humano.",
  },
  "board-room": {
    pos: "sustantivo",
    translation: "sala de juntas",
    definition: "Sala donde se reúne la junta directiva de una empresa u organización.",
  },
  "half-term": {
    pos: "sustantivo",
    translation: "vacaciones de mitad de trimestre",
    definition: "Período de descanso escolar a mitad de un trimestre académico.",
  },
  "heart-to-heart": {
    pos: "locución",
    translation: "conversación sincera",
    definition: "Charla íntima y franca entre dos personas sobre temas personales.",
  },
  "north-west": {
    pos: "sustantivo",
    translation: "noroeste",
    definition: "Punto cardinal situado entre el norte y el oeste.",
  },
  "page-end": {
    pos: "sustantivo",
    translation: "final de página",
    definition: "Parte inferior o final de una página de un documento o libro.",
  },
  "single-space": {
    pos: "verbo",
    translation: "espaciar simple",
    definition: "Escribir o formatear texto usando un solo espacio entre palabras o líneas.",
  },
  "post-date": {
    pos: "verbo",
    translation: "posfechar, fechar después",
    definition: "Asignar a un documento una fecha posterior a la real o actual.",
  },
  "write-up": {
    pos: "sustantivo",
    translation: "informe escrito, reseña",
    definition: "Documento o artículo escrito que describe o evalúa algo, como un informe o una crítica.",
  },
  "five-star": {
    pos: "adjetivo",
    translation: "de cinco estrellas",
    definition: "Que tiene la máxima categoría o calidad, representada por cinco estrellas.",
  },
  "march-past": {
    pos: "sustantivo",
    translation: "desfile militar",
    definition: "Desfile de tropas que pasan ante una autoridad para ser revisadas.",
  },
  "means-test": {
    pos: "sustantivo",
    translation: "evaluación de recursos",
    definition: "Proceso de evaluar los ingresos de una persona para determinar su elegibilidad para ayudas sociales.",
  },
  "short-list": {
    pos: "sustantivo",
    translation: "lista de preseleccionados",
    definition: "Lista reducida de candidatos preseleccionados para un puesto o premio.",
  },
  "stop-press": {
    pos: "sustantivo",
    translation: "última hora",
    definition: "Noticia o información de última hora añadida a una publicación ya impresa.",
  },
  "after-effect": {
    pos: "sustantivo",
    translation: "efecto residual",
    definition: "Consecuencia o efecto que persiste después de que su causa ha desaparecido.",
  },
  "super-state": {
    pos: "sustantivo",
    translation: "superestado",
    definition: "Estado con poder superior sobre otros estados o entidades políticas.",
  },
  "check-list": {
    pos: "sustantivo",
    translation: "lista de verificación",
    definition: "Lista de elementos que se deben comprobar o completar para verificar algo.",
  },
  "two-piece": {
    pos: "adjetivo",
    translation: "de dos piezas",
    definition: "Que está formado por dos partes separadas, especialmente un traje de baño.",
  },
  "after-eye": {
    pos: "sustantivo",
    translation: "ojo tardío",
    definition: "Órgano visual que se desarrolla o aparece después de lo normal.",
  },
  "double-time": {
    pos: "sustantivo",
    translation: "marcha rápida",
    definition: "Marcha militar a paso acelerado, más rápido que el paso normal.",
  },
  "mark-down": {
    pos: "sustantivo",
    translation: "rebaja de precio",
    definition: "Reducción del precio de venta de un producto o servicio.",
  },
  "t-test": {
    pos: "sustantivo",
    translation: "prueba t",
    definition: "Prueba estadística que compara medias usando una distribución t de Student.",
  },
  "over-write": {
    pos: "verbo",
    translation: "sobrescribir, escribir encima",
    definition: "Escribir sobre un texto ya escrito o reemplazar datos existentes con nuevos.",
  },
  "back-track": {
    pos: "verbo",
    translation: "retroceder, dar marcha atrás",
    definition: "Volver sobre los pasos o deshacer lo hecho para corregir o reconsiderar.",
  },
  "half-hour": {
    pos: "sustantivo",
    translation: "media hora",
    definition: "Período de tiempo equivalente a treinta minutos.",
  },
  "make-weight": {
    pos: "sustantivo",
    translation: "relleno, suplente",
    definition: "Persona o cosa que se añade para completar una cantidad o cubrir una falta.",
  },
  "director-general": {
    pos: "sustantivo",
    translation: "director general",
    definition: "Persona que dirige una organización o institución en el máximo nivel jerárquico.",
  },
  "hand-hold": {
    pos: "sustantivo",
    translation: "asidero, agarradera",
    definition: "Objeto o parte que sirve para agarrarse y mantener el equilibrio.",
  },
  "open-source": {
    pos: "adjetivo",
    translation: "de código abierto",
    definition: "Dícese del software cuyo código fuente es accesible y modificable libremente.",
  },
  "self-deal": {
    pos: "sustantivo",
    translation: "negocio propio",
    definition: "Acción de favorecer los intereses propios en una transacción o decisión.",
  },
  "over-charge": {
    pos: "verbo",
    translation: "cobrar de más",
    definition: "Cobrar a alguien un precio superior al debido o establecido.",
  },
  "self-report": {
    pos: "sustantivo",
    translation: "autoinforme",
    definition: "Informe que una persona hace sobre sí misma o sus propias conductas.",
  },
  "self-development": {
    pos: "sustantivo",
    translation: "desarrollo personal",
    definition: "Proceso de mejora continua de las propias capacidades y habilidades.",
  },
  "speed-up": {
    pos: "sustantivo",
    translation: "aceleración, aumento de velocidad",
    definition: "Acción o efecto de acelerar o aumentar la velocidad de algo.",
  },
  "side-step": {
    pos: "sustantivo",
    translation: "paso lateral, evasión",
    definition: "Acción de esquivar o evitar algo desplazándose lateralmente.",
  },
  "short-cut": {
    pos: "sustantivo",
    translation: "atajo",
    definition: "Camino o método más rápido para llegar a un lugar o lograr algo.",
  },
  "sort-out": {
    pos: "sustantivo",
    translation: "arreglo, solución",
    definition: "Acción de resolver o poner en orden un problema o situación.",
  },
  "write-off": {
    pos: "sustantivo",
    translation: "pérdida total, cancelación",
    definition: "Pérdida o cancelación contable de un activo o deuda que se considera irrecuperable.",
  },
  "cross-over": {
    pos: "sustantivo",
    translation: "cruce, mezcla de géneros",
    definition: "Obra o producto que combina elementos de dos o más géneros o franquicias distintas.",
  },
  "drop-out": {
    pos: "sustantivo",
    translation: "desertor escolar",
    definition: "Persona que abandona sus estudios antes de completarlos.",
  },
  "go-ahead": {
    pos: "sustantivo",
    translation: "luz verde, permiso",
    definition: "Autorización o permiso para proceder con una acción o proyecto.",
  },
  "link-up": {
    pos: "sustantivo",
    translation: "conexión, enlace",
    definition: "Unión o conexión entre dos cosas, personas o sistemas.",
  },
  "non-word": {
    pos: "sustantivo",
    translation: "no palabra",
    definition: "Término o secuencia que no se considera una palabra válida en un idioma.",
  },
  "non-action": {
    pos: "sustantivo",
    translation: "inacción",
    definition: "Falta de acción o ausencia de actividad.",
  },
  "re-check": {
    pos: "verbo",
    translation: "volver a comprobar",
    definition: "Revisar o comprobar algo de nuevo para asegurar su exactitud.",
  },
  "re-form": {
    pos: "verbo",
    translation: "reformar, volver a formar",
    definition: "Volver a formar o constituir algo de nuevo, especialmente un grupo u organización.",
  },
  "re-development": {
    pos: "sustantivo",
    translation: "reurbanización, nuevo desarrollo",
    definition: "Proceso de volver a desarrollar o urbanizar una zona.",
  },
  "co-development": {
    pos: "sustantivo",
    translation: "codesarrollo",
    definition: "Desarrollo conjunto o compartido entre dos o más partes.",
  },
  "decision-making": {
    pos: "sustantivo",
    translation: "toma de decisiones",
    definition: "Proceso de elegir entre varias opciones para alcanzar un objetivo.",
  },
  "non-issue": {
    pos: "sustantivo",
    translation: "asunto irrelevante",
    definition: "Cuestión que no tiene importancia o no merece atención.",
  },
  "double-take": {
    pos: "sustantivo",
    translation: "doble toma",
    definition: "Reacción de sorpresa al mirar algo por segunda vez tras notar algo inesperado.",
  },
  "off-gas": {
    pos: "sustantivo",
    translation: "gas emitido",
    definition: "Gas liberado por un material o proceso, especialmente como emisión residual.",
  },
  "news-stand": {
    pos: "sustantivo",
    translation: "puesto de periódicos",
    definition: "Lugar donde se venden periódicos, revistas y otros artículos de prensa.",
  },
  "self-education": {
    pos: "sustantivo",
    translation: "autoeducación",
    definition: "Proceso de aprender por cuenta propia sin instrucción formal de un maestro.",
  },
  "south-east": {
    pos: "sustantivo",
    translation: "sureste",
    definition: "Punto cardinal situado entre el sur y el este.",
  },
  "sell-out": {
    pos: "sustantivo",
    translation: "vendido, traidor",
    definition: "Persona que traiciona sus principios o causa por interés personal o económico.",
  },
  "non-price": {
    pos: "adjetivo",
    translation: "no relacionado con el precio",
    definition: "Que no está vinculado ni afecta al precio de un bien o servicio.",
  },
  "war-drive": {
    pos: "sustantivo",
    translation: "guerra de conducción",
    definition: "Práctica de buscar redes wifi desde un vehículo en movimiento.",
  },
  "back-drop": {
    pos: "sustantivo",
    translation: "telón de fondo",
    definition: "Telón pintado al fondo del escenario o fondo decorativo de una escena.",
  },
  "brother-in-law": {
    pos: "sustantivo",
    translation: "cuñado",
    definition: "Hermano del cónyuge o cónyuge del hermano.",
  },
  "clean-up": {
    pos: "sustantivo",
    translation: "limpieza, saneamiento",
    definition: "Acción de limpiar o eliminar algo, especialmente residuos o suciedad.",
  },
  "co-fire": {
    pos: "verbo",
    translation: "co-combustionar juntos",
    definition: "Quemar dos o más combustibles simultáneamente en un mismo proceso.",
  },
  "death-rate": {
    pos: "sustantivo",
    translation: "tasa de mortalidad",
    definition: "Número de defunciones en una población durante un período determinado.",
  },
  "well-kept": {
    pos: "adjetivo",
    translation: "bien cuidado",
    definition: "Que se mantiene limpio, ordenado y en buen estado.",
  },
  "re-type": {
    pos: "verbo",
    translation: "volver a escribir",
    definition: "Escribir de nuevo un texto o palabra, generalmente corrigiendo o repitiendo lo ya escrito.",
  },
  "power-walk": {
    pos: "sustantivo",
    translation: "caminata rápida",
    definition: "Ejercicio de caminar a paso rápido y enérgico con fines de acondicionamiento físico.",
  },
  "re-education": {
    pos: "sustantivo",
    translation: "reeducación",
    definition: "Proceso de enseñar nuevas habilidades o ideas para cambiar conductas o creencias previas.",
  },
  "self-study": {
    pos: "sustantivo",
    translation: "autoaprendizaje, estudio autónomo",
    definition: "Aprendizaje que una persona realiza por su cuenta, sin profesor ni institución.",
  },
  "super-power": {
    pos: "sustantivo",
    translation: "superpotencia",
    definition: "País o entidad con poder político y militar dominante a escala global.",
  },
  "by-product": {
    pos: "sustantivo",
    translation: "subproducto, derivado",
    definition: "Producto secundario obtenido en un proceso de fabricación o elaboración.",
  },
  "clear-cut": {
    pos: "adjetivo",
    translation: "claro, definido, inequívoco",
    definition: "Que está claramente definido y no admite duda ni ambigüedad.",
  },
  "fast-food": {
    pos: "sustantivo",
    translation: "comida rápida",
    definition: "Comida preparada y servida rápidamente en establecimientos especializados.",
  },
  "co-education": {
    pos: "sustantivo",
    translation: "educación mixta",
    definition: "Sistema educativo en el que alumnos de ambos sexos estudian juntos en las mismas aulas.",
  },
  "middle-age": {
    pos: "adjetivo",
    translation: "de mediana edad",
    definition: "Relativo a la etapa de la vida entre la juventud y la vejez.",
  },
  "non-player": {
    pos: "adjetivo",
    translation: "no jugador",
    definition: "Que no es jugador o no participa como jugador en una actividad.",
  },
  "money-box": {
    pos: "sustantivo",
    translation: "hucha, alcancía",
    definition: "Recipiente para guardar y ahorrar monedas y dinero.",
  },
  "non-return": {
    pos: "sustantivo",
    translation: "no retorno",
    definition: "Condición o válvula que impide el flujo de retorno de un fluido.",
  },
  "north-east": {
    pos: "sustantivo",
    translation: "noreste",
    definition: "Punto del horizonte situado entre el norte y el este, a 45 grados de ambos.",
  },
  "out-gun": {
    pos: "verbo",
    translation: "superar en armamento",
    definition: "Tener más o mejores armas que un oponente en combate.",
  },
  "paper-making": {
    pos: "sustantivo",
    translation: "fabricación de papel",
    definition: "Proceso de elaborar papel a partir de fibras vegetales.",
  },
  "double-end": {
    pos: "adjetivo",
    translation: "de doble extremo",
    definition: "Que tiene dos extremos o puntas, generalmente de uso o función similar.",
  },
  "half-brother": {
    pos: "sustantivo",
    translation: "medio hermano",
    definition: "Hermano que comparte solo uno de los padres, ya sea el padre o la madre.",
  },
  "hate-fuck": {
    pos: "sustantivo",
    translation: "sexo por odio",
    definition: "Relación sexual intensa y agresiva motivada por odio o resentimiento hacia la otra persona.",
  },
  "non-event": {
    pos: "sustantivo",
    translation: "acontecimiento sin importancia",
    definition: "Suceso que se esperaba importante pero resulta decepcionante o irrelevante.",
  },
  "non-member": {
    pos: "sustantivo",
    translation: "no miembro",
    definition: "Persona que no pertenece a una organización, grupo o asociación.",
  },
  "sea-water": {
    pos: "sustantivo",
    translation: "agua de mar",
    definition: "Agua salada que forma los mares y océanos.",
  },
  "ball-point": {
    pos: "sustantivo",
    translation: "bolígrafo",
    definition: "Instrumento de escritura con tinta que sale por una pequeña bola en la punta.",
  },
  "base-line": {
    pos: "sustantivo",
    translation: "línea base",
    definition: "Línea de referencia usada para comparar o medir cambios en datos o situaciones.",
  },
  "daughter-in-law": {
    pos: "sustantivo",
    translation: "nuera",
    definition: "Esposa del hijo de una persona respecto a sus padres.",
  },
  "green-light": {
    pos: "verbo",
    translation: "dar luz verde",
    definition: "Aprobar o autorizar el inicio de un proyecto o acción.",
  },
  "in-fighting": {
    pos: "sustantivo",
    translation: "lucha interna",
    definition: "Conflicto o rivalidad entre miembros de un mismo grupo u organización.",
  },
  "note-case": {
    pos: "sustantivo",
    translation: "cartera de billetes",
    definition: "Estuche pequeño para guardar billetes y tarjetas.",
  },
  "heart-rate": {
    pos: "sustantivo",
    translation: "frecuencia cardíaca",
    definition: "Número de latidos del corazón por unidad de tiempo, generalmente por minuto.",
  },
  "out-reach": {
    pos: "sustantivo",
    translation: "alcance comunitario",
    definition: "Actividad de una organización para acercarse y ayudar a la comunidad.",
  },
  "re-position": {
    pos: "verbo",
    translation: "reposicionar, cambiar de posición",
    definition: "Volver a colocar algo en una posición o ubicación diferente.",
  },
  "re-record": {
    pos: "verbo",
    translation: "volver a grabar",
    definition: "Grabar de nuevo un audio o una grabación ya existente.",
  },
  "re-site": {
    pos: "verbo",
    translation: "reubicar, cambiar de sitio",
    definition: "Mover algo o a alguien a un nuevo lugar o emplazamiento.",
  },
  "post-code": {
    pos: "sustantivo",
    translation: "código postal",
    definition: "Serie de números y letras que identifica una zona para el reparto de correo.",
  },
  "field-test": {
    pos: "verbo",
    translation: "probar en el campo",
    definition: "Someter algo a prueba en condiciones reales de uso.",
  },
  "goal-post": {
    pos: "sustantivo",
    translation: "poste de la portería",
    definition: "Cada uno de los dos postes verticales que forman los laterales de una portería.",
  },
  "hand-pick": {
    pos: "verbo",
    translation: "escoger cuidadosamente",
    definition: "Seleccionar algo o a alguien con especial cuidado entre un grupo.",
  },
  "hand-writing": {
    pos: "sustantivo",
    translation: "escritura a mano",
    definition: "Escritura hecha con la mano, especialmente con letra manual.",
  },
  "hand-code": {
    pos: "verbo",
    translation: "codificar manualmente",
    definition: "Escribir código de programación a mano en lugar de generarlo automáticamente.",
  },
  "hate-watch": {
    pos: "verbo",
    translation: "ver por morbo",
    definition: "Ver un contenido que se detesta solo para criticarlo o burlarse de él.",
  },
  "peace-making": {
    pos: "sustantivo",
    translation: "pacificación, mediación de paz",
    definition: "Proceso de reconciliar a partes en conflicto para lograr la paz.",
  },
  "re-test": {
    pos: "sustantivo",
    translation: "nueva prueba",
    definition: "Prueba que se realiza de nuevo para verificar o confirmar un resultado.",
  },
  "school-leaving": {
    pos: "adjetivo",
    translation: "de fin de estudios",
    definition: "Relativo a la finalización de la etapa escolar o al momento de dejar la escuela.",
  },
  "self-interest": {
    pos: "sustantivo",
    translation: "interés propio",
    definition: "Inclinación a buscar el beneficio personal por encima del de los demás.",
  },
  "turn-key": {
    pos: "adjetivo",
    translation: "llave en mano",
    definition: "Dícese de un proyecto o servicio entregado completamente terminado y listo para usar.",
  },
  "world-wide": {
    pos: "adjetivo",
    translation: "mundial, de todo el mundo",
    definition: "Que abarca o afecta a todo el mundo o a una gran parte de él.",
  },
  "u-turn": {
    pos: "sustantivo",
    translation: "cambio de sentido",
    definition: "Giro completo de un vehículo para tomar la dirección opuesta.",
  },
  "co-star": {
    pos: "sustantivo",
    translation: "coprotagonista, actor secundario",
    definition: "Actor que comparte el papel principal con otro en una película u obra.",
  },
  "death-bed": {
    pos: "sustantivo",
    translation: "lecho de muerte",
    definition: "Cama donde una persona está a punto de morir o en sus últimos momentos.",
  },
  "focus-group": {
    pos: "sustantivo",
    translation: "grupo de discusión",
    definition: "Grupo reducido de personas reunidas para debatir y evaluar un tema o producto.",
  },
  "name-drop": {
    pos: "verbo",
    translation: "mencionar nombres para presumir",
    definition: "Mencionar a personas famosas o importantes para impresionar o presumir.",
  },
  "pay-bed": {
    pos: "sustantivo",
    translation: "cama de pago",
    definition: "Cama en un hospital o clínica por la que el paciente paga un suplemento.",
  },
  "re-learn": {
    pos: "verbo",
    translation: "volver a aprender",
    definition: "Aprender de nuevo algo que se había olvidado o dejar de saber.",
  },
  "sea-level": {
    pos: "sustantivo",
    translation: "nivel del mar",
    definition: "Altura media de la superficie del mar usada como referencia para medir elevaciones.",
  },
  "re-present": {
    pos: "verbo",
    translation: "volver a presentar",
    definition: "Presentar de nuevo algo, especialmente una propuesta o documento.",
  },
  "re-design": {
    pos: "verbo",
    translation: "rediseñar",
    definition: "Volver a diseñar algo para mejorarlo o cambiar su forma.",
  },
  "self-worth": {
    pos: "sustantivo",
    translation: "autoestima, valía personal",
    definition: "Valoración positiva que una persona tiene de sí misma.",
  },
  "self-giving": {
    pos: "adjetivo",
    translation: "generoso, abnegado",
    definition: "Que se entrega desinteresadamente a los demás.",
  },
  "side-effect": {
    pos: "sustantivo",
    translation: "efecto secundario",
    definition: "Consecuencia no deseada o secundaria de un tratamiento, acción o medida.",
  },
  "side-track": {
    pos: "verbo",
    translation: "desviar, apartar",
    definition: "Desviar algo o a alguien de su curso o asunto principal hacia un tema secundario.",
  },
  "touch-up": {
    pos: "sustantivo",
    translation: "retoque",
    definition: "Pequeña corrección o mejora aplicada a una obra, superficie o trabajo.",
  },
  "sit-in": {
    pos: "sustantivo",
    translation: "sentada, ocupación pacífica",
    definition: "Protesta pacífica en la que los participantes ocupan un lugar y se niegan a abandonarlo.",
  },
  "work-to-rule": {
    pos: "sustantivo",
    translation: "huelga de celo",
    definition: "Forma de protesta laboral en la que se cumplen estrictamente las normas para ralentizar el trabajo.",
  },
  "half-note": {
    pos: "sustantivo",
    translation: "blanca",
    definition: "Figura musical que dura la mitad de una redonda.",
  },
  "in-winter": {
    pos: "verbo",
    translation: "pasar el invierno",
    definition: "Pasar el invierno en un lugar, especialmente el ganado en un establo.",
  },
  "post-box": {
    pos: "sustantivo",
    translation: "buzón de correos",
    definition: "Recipiente público donde se depositan las cartas para su envío.",
  },
  "water-ice": {
    pos: "sustantivo",
    translation: "hielo de agua",
    definition: "Hielo formado a partir de agua, en contraposición a otros tipos de hielo.",
  },
  "waiting-room": {
    pos: "sustantivo",
    translation: "sala de espera",
    definition: "Lugar donde las personas aguardan turno o un servicio.",
  },
  "anti-d": {
    pos: "sustantivo",
    translation: "anti-D (inmunoglobulina)",
    definition: "Inmunoglobulina que previene la enfermedad hemolítica del recién nacido en madres Rh negativas.",
  },
  "co-director": {
    pos: "sustantivo",
    translation: "codirector",
    definition: "Persona que dirige una actividad junto con otro director.",
  },
  "end-product": {
    pos: "sustantivo",
    translation: "producto final",
    definition: "Resultado último de un proceso o actividad.",
  },
  "cross-country": {
    pos: "adjetivo",
    translation: "campo a través",
    definition: "Que se realiza por terrenos abiertos o fuera de caminos, como carreras o viajes.",
  },
  "key-word": {
    pos: "sustantivo",
    translation: "palabra clave",
    definition: "Palabra o término significativo que identifica o resume un contenido.",
  },
  "off-spring": {
    pos: "sustantivo",
    translation: "descendencia, cría, vástago",
    definition: "Persona o animal nacido de un progenitor; descendiente directo.",
  },
  "out-winter": {
    pos: "verbo",
    translation: "pasar el invierno",
    definition: "Mantener animales o plantas durante el invierno en condiciones adecuadas.",
  },
  "pre-school": {
    pos: "sustantivo",
    translation: "preescolar, jardín de infancia",
    definition: "Centro educativo para niños antes de la edad escolar obligatoria.",
  },
  "re-model": {
    pos: "verbo",
    translation: "remodelar, reformar",
    definition: "Cambiar o renovar la estructura o forma de algo, especialmente un espacio o edificio.",
  },
  "re-reading": {
    pos: "sustantivo",
    translation: "relectura",
    definition: "Acción de leer de nuevo un texto o documento.",
  },
  "step-mother": {
    pos: "sustantivo",
    translation: "madrastra",
    definition: "Esposa del padre respecto de los hijos que este tiene de otra relación.",
  },
  "under-secretary": {
    pos: "sustantivo",
    translation: "subsecretario, viceministro",
    definition: "Funcionario de alto rango subordinado a un secretario o ministro.",
  },
  "telling-off": {
    pos: "sustantivo",
    translation: "reprimenda, regaño",
    definition: "Reprensión o amonestación severa que se dirige a alguien por su conducta.",
  },
  "co-management": {
    pos: "sustantivo",
    translation: "cogestión",
    definition: "Gestión compartida de una actividad o recurso entre varias partes.",
  },
  "co-production": {
    pos: "sustantivo",
    translation: "coproducción",
    definition: "Producción realizada conjuntamente por dos o más empresas o países.",
  },
  "day-dream": {
    pos: "sustantivo",
    translation: "ensueño, fantasía",
    definition: "Fantasía o ilusión que se tiene despierto, imaginando situaciones agradables.",
  },
  "double-book": {
    pos: "verbo",
    translation: "reservar por duplicado",
    definition: "Asignar dos reservas al mismo recurso, tiempo o persona por error.",
  },
  "low-risk": {
    pos: "adjetivo",
    translation: "de bajo riesgo",
    definition: "Que implica poco peligro o probabilidad de daño.",
  },
  "post-treatment": {
    pos: "sustantivo",
    translation: "postratamiento, después del tratamiento",
    definition: "Etapa o conjunto de cuidados que se realizan después de un tratamiento médico.",
  },
  "re-send": {
    pos: "verbo",
    translation: "reenviar, volver a enviar",
    definition: "Enviar de nuevo algo, especialmente un mensaje o archivo.",
  },
  "self-hate": {
    pos: "sustantivo",
    translation: "odio a sí mismo",
    definition: "Sentimiento de aversión o rechazo hacia uno mismo.",
  },
  "text-book": {
    pos: "sustantivo",
    translation: "libro de texto",
    definition: "Libro usado como guía para el estudio de una materia.",
  },
  "video-conference": {
    pos: "sustantivo",
    translation: "videoconferencia",
    definition: "Reunión o comunicación a distancia mediante transmisión de audio y vídeo.",
  },
  "carry-over": {
    pos: "sustantivo",
    translation: "traspaso, saldo pendiente",
    definition: "Cantidad o asunto que se traslada de un período o cuenta al siguiente.",
  },
  "coach-and-four": {
    pos: "sustantivo",
    translation: "carruaje de cuatro caballos",
    definition: "Carruaje tirado por cuatro caballos, típico del siglo XIX.",
  },
  "cross-talk": {
    pos: "sustantivo",
    translation: "interferencia, diafonía",
    definition: "Interferencia no deseada entre señales o conversaciones que provoca confusión o ruido.",
  },
  "day-trip": {
    pos: "sustantivo",
    translation: "excursión de un día",
    definition: "Viaje corto que se realiza ida y vuelta en el mismo día.",
  },
  "f-word": {
    pos: "sustantivo",
    translation: "palabrota, taco",
    definition: "Palabra malsonante usada como insulto o para expresar enfado.",
  },
  "pop-up": {
    pos: "adjetivo",
    translation: "emergente, ventana emergente",
    definition: "Que aparece de forma repentina en una pantalla o lugar, generalmente temporal.",
  },
  "pre-set": {
    pos: "adjetivo",
    translation: "preestablecido, preconfigurado",
    definition: "Que ha sido establecido o configurado de antemano.",
  },
  "red-card": {
    pos: "sustantivo",
    translation: "tarjeta roja",
    definition: "Tarjeta que el árbitro muestra para expulsar a un jugador.",
  },
  "sit-down": {
    pos: "sustantivo",
    translation: "sentada, reunión sentados",
    definition: "Reunión o comida en la que los participantes permanecen sentados para dialogar o protestar.",
  },
  "self-kill": {
    pos: "sustantivo",
    translation: "suicidio",
    definition: "Acción de quitarse la propia vida de forma voluntaria.",
  },
  "test-drive": {
    pos: "verbo",
    translation: "probar un vehículo",
    definition: "Conducir un vehículo para evaluar su funcionamiento antes de comprarlo.",
  },
  "also-ran": {
    pos: "sustantivo",
    translation: "perdedor, fracasado",
    definition: "Persona o competidor que no logra éxito ni victoria.",
  },
  "check-box": {
    pos: "sustantivo",
    translation: "casilla de verificación",
    definition: "Recuadro que se marca para seleccionar o activar una opción.",
  },
  "deep-six": {
    pos: "verbo",
    translation: "desechar, tirar por la borda",
    definition: "Deshacerse de algo o alguien, especialmente arrojándolo al agua o abandonándolo.",
  },
  "light-weight": {
    pos: "adjetivo",
    translation: "ligero, de poco peso",
    definition: "Que tiene poco peso o está hecho con materiales ligeros.",
  },
  "non-professional": {
    pos: "adjetivo",
    translation: "no profesional",
    definition: "Que no ejerce una actividad como profesión o carece de formación profesional.",
  },
  "re-cover": {
    pos: "verbo",
    translation: "volver a cubrir",
    definition: "Cubrir de nuevo algo que ya había sido cubierto.",
  },
  "re-election": {
    pos: "sustantivo",
    translation: "reelección",
    definition: "Acción de volver a elegir a alguien para un cargo que ya ocupaba.",
  },
  "re-release": {
    pos: "sustantivo",
    translation: "relanzamiento, nuevo lanzamiento",
    definition: "Acción de volver a lanzar o publicar algo, como una película, disco o producto.",
  },
  "re-sign": {
    pos: "verbo",
    translation: "volver a firmar",
    definition: "Firmar de nuevo un documento o contrato.",
  },
  "short-weight": {
    pos: "sustantivo",
    translation: "peso corto",
    definition: "Peso inferior al declarado en una mercancía o producto.",
  },
  "stop-and-search": {
    pos: "sustantivo",
    translation: "registro e identificación",
    definition: "Práctica policial de detener y registrar a una persona sospechosa en la vía pública.",
  },
  "air-drop": {
    pos: "sustantivo",
    translation: "lanzamiento desde el aire",
    definition: "Acción de lanzar suministros o tropas desde una aeronave.",
  },
  "cross-question": {
    pos: "sustantivo",
    translation: "interrogatorio cruzado",
    definition: "Serie de preguntas detalladas y repetidas para verificar o contradecir un testimonio.",
  },
  "co-sign": {
    pos: "verbo",
    translation: "avalar, firmar conjuntamente",
    definition: "Firmar un documento junto con otra persona para respaldar una obligación.",
  },
  "double-deal": {
    pos: "verbo",
    translation: "actuar con doblez",
    definition: "Engañar a alguien actuando con falsedad o traición en un trato.",
  },
  "house-sit": {
    pos: "verbo",
    translation: "cuidar casa ajena",
    definition: "Ocuparse de una vivienda mientras sus dueños están ausentes.",
  },
  "non-response": {
    pos: "sustantivo",
    translation: "falta de respuesta",
    definition: "Ausencia de respuesta o reacción ante una solicitud, pregunta o estímulo.",
  },
  "p-value": {
    pos: "sustantivo",
    translation: "valor p",
    definition: "Probabilidad de obtener un resultado al menos tan extremo como el observado si la hipótesis nula es cierta.",
  },
  "pre-order": {
    pos: "sustantivo",
    translation: "pedido anticipado",
    definition: "Reserva o compra de un producto antes de su lanzamiento oficial.",
  },
  "rule-making": {
    pos: "sustantivo",
    translation: "elaboración de normas",
    definition: "Proceso de crear o establecer reglas o normas.",
  },
  "red-eye": {
    pos: "sustantivo",
    translation: "vuelo nocturno",
    definition: "Vuelo que sale de noche y llega a su destino a la mañana siguiente.",
  },
  "secretary-general": {
    pos: "sustantivo",
    translation: "secretario general",
    definition: "Persona que dirige una organización o institución como máximo responsable.",
  },
  "double-check": {
    pos: "verbo",
    translation: "verificar de nuevo",
    definition: "Revisar algo por segunda vez para asegurar su exactitud o funcionamiento.",
  },
  "cross-check": {
    pos: "sustantivo",
    translation: "verificación cruzada",
    definition: "Comprobación de datos mediante la comparación de dos o más fuentes independientes.",
  },
  "long-lived": {
    pos: "adjetivo",
    translation: "de larga vida",
    definition: "Que tiene una duración o vida prolongada.",
  },
  "nation-state": {
    pos: "sustantivo",
    translation: "Estado-nación",
    definition: "Estado soberano cuya población comparte identidad nacional, cultura e instituciones.",
  },
  "over-heat": {
    pos: "verbo",
    translation: "sobrecalentar, recalentar",
    definition: "Calentar algo en exceso, más allá de su temperatura normal o segura.",
  },
  "over-ride": {
    pos: "verbo",
    translation: "anular, prevalecer sobre",
    definition: "Anular o pasar por alto una decisión o configuración establecida.",
  },
  "non-student": {
    pos: "sustantivo",
    translation: "no estudiante",
    definition: "Persona que no es estudiante ni está matriculada en un centro educativo.",
  },
  "re-mark": {
    pos: "sustantivo",
    translation: "nueva marca, anotación",
    definition: "Acción de marcar de nuevo o hacer una anotación adicional.",
  },
  "self-respect": {
    pos: "sustantivo",
    translation: "respeto a sí mismo",
    definition: "Valoración positiva que una persona tiene de sí misma y de su dignidad.",
  },
  "sister-in-law": {
    pos: "sustantivo",
    translation: "cuñada",
    definition: "Hermana del cónyuge o esposa del hermano.",
  },
  "throw-in": {
    pos: "sustantivo",
    translation: "saque de banda",
    definition: "Saque que se hace con las manos desde la banda tras salir el balón del campo.",
  },
  "wind-up": {
    pos: "sustantivo",
    translation: "broma, jugarreta",
    definition: "Acción o broma destinada a engañar o molestar a alguien, a menudo como travesura.",
  },
  "back-channel": {
    pos: "sustantivo",
    translation: "canal de comunicación informal",
    definition: "Vía discreta y no oficial para comunicarse o negociar al margen del canal principal.",
  },
  "centre-half": {
    pos: "sustantivo",
    translation: "medio centro",
    definition: "Jugador de fútbol que actúa en la defensa central o en el mediocampo defensivo.",
  },
  "fast-forward": {
    pos: "sustantivo",
    translation: "avance rápido",
    definition: "Acción de adelantar rápidamente una grabación o reproducción.",
  },
  "go-slow": {
    pos: "sustantivo",
    translation: "huelga de celo",
    definition: "Forma de protesta laboral en la que se trabaja lentamente para reducir la producción.",
  },
  "half-sister": {
    pos: "sustantivo",
    translation: "media hermana",
    definition: "Hermana que comparte solo uno de los progenitores con otra persona.",
  },
  "pre-history": {
    pos: "sustantivo",
    translation: "prehistoria",
    definition: "Período anterior a la historia escrita, estudiado mediante restos materiales.",
  },
  "pre-pay": {
    pos: "verbo",
    translation: "pagar por adelantado",
    definition: "Pagar algo antes de recibirlo o antes de la fecha debida.",
  },
  "pull-in": {
    pos: "sustantivo",
    translation: "parada de emergencia",
    definition: "Lugar o acción de detenerse al borde de la vía para emergencias o descanso.",
  },
  "re-growth": {
    pos: "sustantivo",
    translation: "recrecimiento, nuevo crecimiento",
    definition: "Proceso de volver a crecer o desarrollarse algo que había disminuido o cesado.",
  },
  "re-visit": {
    pos: "verbo",
    translation: "volver a visitar",
    definition: "Visitar de nuevo un lugar o persona que ya se había visitado antes.",
  },
  "re-write": {
    pos: "verbo",
    translation: "reescribir, volver a escribir",
    definition: "Escribir de nuevo un texto, generalmente para corregirlo o mejorarlo.",
  },
  "re-build": {
    pos: "verbo",
    translation: "reconstruir, volver a construir",
    definition: "Construir de nuevo algo que se había destruido o deteriorado.",
  },
  "stock-car": {
    pos: "sustantivo",
    translation: "coche de serie modificado",
    definition: "Automóvil de serie adaptado para carreras de velocidad o demolición.",
  },
  "time-keeping": {
    pos: "sustantivo",
    translation: "cronometraje, control del tiempo",
    definition: "Acción o sistema de medir y registrar el tiempo.",
  },
  "co-write": {
    pos: "verbo",
    translation: "escribir conjuntamente",
    definition: "Escribir una obra o texto en colaboración con otra persona.",
  },
  "cross-process": {
    pos: "adjetivo",
    translation: "entre procesos",
    definition: "Que ocurre o se realiza entre distintos procesos o sistemas.",
  },
  "draw-in": {
    pos: "sustantivo",
    translation: "atracción, succión",
    definition: "Acción o efecto de atraer o aspirar algo hacia dentro.",
  },
  "k-line": {
    pos: "sustantivo",
    translation: "línea K",
    definition: "Línea que representa la evolución del precio de un activo en un periodo.",
  },
  "non-contact": {
    pos: "adjetivo",
    translation: "sin contacto",
    definition: "Que no implica contacto físico o directo entre personas o cosas.",
  },
  "power-trip": {
    pos: "sustantivo",
    translation: "abuso de poder",
    definition: "Actitud de quien ejerce su autoridad de forma arrogante y abusiva.",
  },
  "pull-up": {
    pos: "sustantivo",
    translation: "dominada; flexión de brazos",
    definition: "Ejercicio de fuerza en el que se eleva el cuerpo colgado de una barra hasta la barbilla.",
  },
  "pull-out": {
    pos: "sustantivo",
    translation: "retirada, extracción",
    definition: "Acción de retirar o sacar algo de su lugar, como tropas o un objeto.",
  },
  "push-up": {
    pos: "sustantivo",
    translation: "flexión de brazos",
    definition: "Ejercicio físico en el que se eleva el cuerpo con los brazos desde el suelo.",
  },
  "re-create": {
    pos: "verbo",
    translation: "volver a crear",
    definition: "Crear de nuevo algo que había sido destruido o modificado.",
  },
  "self-treatment": {
    pos: "sustantivo",
    translation: "autotratamiento",
    definition: "Tratamiento que una persona se aplica a sí misma sin supervisión médica profesional.",
  },
  "slow-down": {
    pos: "sustantivo",
    translation: "desaceleración, reducción de ritmo",
    definition: "Disminución de la velocidad o del ritmo de una actividad o proceso.",
  },
  "story-telling": {
    pos: "sustantivo",
    translation: "narración de cuentos",
    definition: "Arte o práctica de contar historias o relatos.",
  },
  "time-scale": {
    pos: "sustantivo",
    translation: "escala temporal",
    definition: "Período de tiempo considerado para medir o situar un proceso o fenómeno.",
  },
  "cross-road": {
    pos: "sustantivo",
    translation: "cruce de caminos",
    definition: "Punto donde se cruzan dos o más caminos o carreteras.",
  },
  "de-ice": {
    pos: "verbo",
    translation: "descongelar, quitar el hielo",
    definition: "Eliminar el hielo acumulado de una superficie, especialmente de un avión o una carretera.",
  },
  "door-step": {
    pos: "sustantivo",
    translation: "umbral, escalón de entrada",
    definition: "Escalón o peldaño situado a la entrada de una puerta o vivienda.",
  },
  "double-shot": {
    pos: "sustantivo",
    translation: "doble shot",
    definition: "Bebida de café con dos porciones de espresso en una sola taza.",
  },
  "primary-care": {
    pos: "sustantivo",
    translation: "atención primaria",
    definition: "Nivel de atención sanitaria que ofrece cuidado integral y continuo al paciente.",
  },
  "re-focus": {
    pos: "verbo",
    translation: "volver a enfocar",
    definition: "Volver a centrar la atención o el enfoque en algo.",
  },
  "re-join": {
    pos: "verbo",
    translation: "volver a unir",
    definition: "Unir de nuevo algo que se había separado o dividido.",
  },
  "sex-text": {
    pos: "sustantivo",
    translation: "mensaje de texto sexual",
    definition: "Mensaje de texto con contenido sexual enviado a otra persona.",
  },
  "step-daughter": {
    pos: "sustantivo",
    translation: "hijastra",
    definition: "Hija del cónyuge o pareja, no biológica de la persona.",
  },
  "stock-taking": {
    pos: "sustantivo",
    translation: "inventario, recuento de existencias",
    definition: "Acción de contar y revisar las existencias o mercancías disponibles en un almacén o negocio.",
  },
  "house-keeping": {
    pos: "sustantivo",
    translation: "limpieza del hogar",
    definition: "Conjunto de tareas domésticas para mantener limpia y ordenada una casa.",
  },
  "mid-day": {
    pos: "sustantivo",
    translation: "mediodía",
    definition: "Momento del día en que el sol está en su punto más alto, alrededor de las doce.",
  },
  "non-plus": {
    pos: "sustantivo",
    translation: "desconcierto, perplejidad",
    definition: "Estado de confusión o perplejidad que impide reaccionar o decidir.",
  },
  "over-supply": {
    pos: "sustantivo",
    translation: "exceso de oferta",
    definition: "Cantidad de un bien o servicio que supera la demanda existente en el mercado.",
  },
  "pre-form": {
    pos: "sustantivo",
    translation: "preforma",
    definition: "Forma o molde previo que sirve de base para elaborar algo.",
  },
  "pull-back": {
    pos: "sustantivo",
    translation: "retroceso, repliegue",
    definition: "Acción de retroceder o retirarse, especialmente de una posición avanzada.",
  },
  "pull-off": {
    pos: "sustantivo",
    translation: "área de descanso",
    definition: "Zona junto a la carretera para detenerse o descansar.",
  },
  "question-master": {
    pos: "sustantivo",
    translation: "presentador de concurso",
    definition: "Persona que dirige un concurso y formula las preguntas a los participantes.",
  },
  "re-consider": {
    pos: "verbo",
    translation: "reconsiderar, volver a considerar",
    definition: "Volver a examinar o pensar algo con detenimiento para cambiar o confirmar una decisión.",
  },
  "right-click": {
    pos: "verbo",
    translation: "hacer clic derecho",
    definition: "Pulsar el botón derecho del ratón para abrir un menú contextual.",
  },
  "round-table": {
    pos: "adjetivo",
    translation: "mesa redonda",
    definition: "Relativo a una reunión o discusión informal entre iguales sobre un tema.",
  },
  "sweet-talk": {
    pos: "verbo",
    translation: "engatusar, adular",
    definition: "Convencer a alguien con halagos o palabras dulces para obtener algo.",
  },
  "blue-ball": {
    pos: "sustantivo",
    translation: "bola azul",
    definition: "Bola de color azul, generalmente usada en juegos o deportes.",
  },
  "double-bank": {
    pos: "verbo",
    translation: "doblar el remo",
    definition: "Remar con dos personas por banco en una embarcación.",
  },
  "double-park": {
    pos: "verbo",
    translation: "estacionar en doble fila",
    definition: "Estacionar un vehículo junto a otro ya aparcado, ocupando parte de la calzada.",
  },
  "face-plant": {
    pos: "sustantivo",
    translation: "caída de bruces",
    definition: "Caída de cara al suelo, generalmente accidental y aparatosa.",
  },
  "glad-hand": {
    pos: "verbo",
    translation: "dar la bienvenida efusivamente",
    definition: "Recibir a alguien con entusiasmo exagerado o fingido.",
  },
  "house-owner": {
    pos: "sustantivo",
    translation: "dueño de casa",
    definition: "Persona que posee o es propietaria de una vivienda.",
  },
  "pre-process": {
    pos: "verbo",
    translation: "preprocesar",
    definition: "Procesar datos previamente antes del procesamiento principal.",
  },
  "race-walk": {
    pos: "sustantivo",
    translation: "marcha atlética",
    definition: "Deporte de caminar rápido manteniendo siempre un pie en el suelo.",
  },
  "re-construction": {
    pos: "sustantivo",
    translation: "reconstrucción",
    definition: "Acción y efecto de reconstruir o volver a construir algo.",
  },
  "self-knowledge": {
    pos: "sustantivo",
    translation: "autoconocimiento",
    definition: "Conocimiento que una persona tiene de sí misma, sus características y limitaciones.",
  },
  "side-foot": {
    pos: "sustantivo",
    translation: "golpe con el interior",
    definition: "Golpe a un balón hecho con el lado interior del pie.",
  },
  "sound-track": {
    pos: "sustantivo",
    translation: "banda sonora",
    definition: "Música y sonidos que acompañan una película o grabación.",
  },
  "v-sign": {
    pos: "sustantivo",
    translation: "seña con dos dedos",
    definition: "Gesto ofensivo que se hace mostrando el dorso de la mano con los dedos índice y medio extendidos.",
  },
  "fast-moving": {
    pos: "adjetivo",
    translation: "de rápido movimiento",
    definition: "Que se mueve o desarrolla con gran velocidad.",
  },
  "fire-fighting": {
    pos: "adjetivo",
    translation: "contra incendios",
    definition: "Relativo a la prevención y extinción de incendios.",
  },
  "fast-track": {
    pos: "sustantivo",
    translation: "vía rápida",
    definition: "Procedimiento acelerado para lograr algo con mayor rapidez que lo habitual.",
  },
  "in-patient": {
    pos: "sustantivo",
    translation: "paciente hospitalizado",
    definition: "Persona que recibe tratamiento y permanece ingresada en un hospital.",
  },
  "looking-glass": {
    pos: "sustantivo",
    translation: "espejo",
    definition: "Superficie reflectante que muestra la imagen de lo que se le pone delante.",
  },
  "re-train": {
    pos: "verbo",
    translation: "volver a entrenar",
    definition: "Entrenar de nuevo a alguien o algo para adquirir o recuperar una habilidad.",
  },
  "self-image": {
    pos: "sustantivo",
    translation: "autoimagen",
    definition: "Percepción o concepto que una persona tiene de sí misma.",
  },
  "re-search": {
    pos: "sustantivo",
    translation: "investigación, búsqueda de nuevo",
    definition: "Acción de volver a buscar o investigar algo de forma sistemática.",
  },
  "self-insurance": {
    pos: "sustantivo",
    translation: "autoseguro",
    definition: "Práctica de reservar fondos propios para cubrir pérdidas en lugar de contratar un seguro.",
  },
  "self-rule": {
    pos: "sustantivo",
    translation: "autogobierno",
    definition: "Capacidad de una comunidad o territorio para gobernarse por sí mismo.",
  },
  "she-cat": {
    pos: "sustantivo",
    translation: "gata",
    definition: "Hembra del gato doméstico.",
  },
  "stock-market": {
    pos: "sustantivo",
    translation: "mercado de valores",
    definition: "Mercado donde se compran y venden acciones y otros valores financieros.",
  },
  "tree-top": {
    pos: "sustantivo",
    translation: "copa del árbol",
    definition: "Parte superior de un árbol, formada por las ramas y el follaje más altos.",
  },
  "battle-field": {
    pos: "sustantivo",
    translation: "campo de batalla",
    definition: "Lugar donde se libra un combate o enfrentamiento armado.",
  },
  "cast-off": {
    pos: "adjetivo",
    translation: "desechado, usado",
    definition: "Que ha sido abandonado o descartado por su dueño anterior.",
  },
  "co-author": {
    pos: "sustantivo",
    translation: "coautor, coautora",
    definition: "Persona que escribe una obra junto con otro u otros autores.",
  },
  "co-product": {
    pos: "sustantivo",
    translation: "coproducto",
    definition: "Producto secundario o resultante junto con otro en un proceso.",
  },
  "co-leader": {
    pos: "sustantivo",
    translation: "colíder",
    definition: "Persona que comparte el liderazgo de un grupo u organización con otro.",
  },
  "left-click": {
    pos: "verbo",
    translation: "hacer clic izquierdo",
    definition: "Pulsar el botón izquierdo del ratón sobre un elemento.",
  },
  "out-patient": {
    pos: "sustantivo",
    translation: "paciente ambulatorio",
    definition: "Paciente que recibe tratamiento médico sin necesidad de ser ingresado en el hospital.",
  },
  "pre-date": {
    pos: "verbo",
    translation: "preceder en fecha",
    definition: "Existir o ocurrir antes que algo o alguien en el tiempo.",
  },
  "over-produce": {
    pos: "verbo",
    translation: "producir en exceso",
    definition: "Producir más de lo necesario o de lo que se puede consumir o vender.",
  },
  "re-opening": {
    pos: "sustantivo",
    translation: "reapertura",
    definition: "Acción de volver a abrir un lugar, negocio o actividad que estaba cerrado.",
  },
  "pre-record": {
    pos: "verbo",
    translation: "pregrabar, grabar con antelación",
    definition: "Grabar algo antes de su emisión o uso posterior.",
  },
  "sea-bed": {
    pos: "sustantivo",
    translation: "lecho marino",
    definition: "Fondo o suelo del mar donde se acumulan sedimentos y viven organismos.",
  },
  "self-defense": {
    pos: "sustantivo",
    translation: "defensa propia",
    definition: "Protección de la propia persona frente a una agresión.",
  },
  "self-administration": {
    pos: "sustantivo",
    translation: "autoadministración",
    definition: "Acción de administrarse algo a sí mismo, especialmente medicamentos o recursos.",
  },
  "self-direction": {
    pos: "sustantivo",
    translation: "autodirección",
    definition: "Capacidad de una persona para dirigir su propio comportamiento de forma autónoma.",
  },
  "wrong-foot": {
    pos: "verbo",
    translation: "pillar desprevenido",
    definition: "Desestabilizar o sorprender a alguien haciendo que pierda su posición o ventaja.",
  },
  "bad-mouth": {
    pos: "verbo",
    translation: "hablar mal de",
    definition: "Criticar o hablar mal de alguien a sus espaldas.",
  },
  "blood-pressure": {
    pos: "sustantivo",
    translation: "presión arterial",
    definition: "Fuerza que ejerce la sangre contra las paredes de las arterias.",
  },
  "bus-stop": {
    pos: "sustantivo",
    translation: "parada de autobús",
    definition: "Lugar señalado donde los autobuses se detienen para recoger o dejar pasajeros.",
  },
  "co-administration": {
    pos: "sustantivo",
    translation: "coadministración",
    definition: "Acción de administrar algo de forma conjunta entre dos o más partes.",
  },
  "income-tax": {
    pos: "sustantivo",
    translation: "impuesto sobre la renta",
    definition: "Tributo que grava los ingresos o ganancias de personas y empresas.",
  },
  "man-handle": {
    pos: "verbo",
    translation: "manosear, manipular bruscamente",
    definition: "Manejar o mover algo o a alguien con fuerza y brusquedad.",
  },
  "missed-call": {
    pos: "sustantivo",
    translation: "llamada perdida",
    definition: "Llamada telefónica que no fue contestada por el destinatario.",
  },
  "mid-week": {
    pos: "sustantivo",
    translation: "mitad de semana",
    definition: "Parte central de la semana laboral, generalmente entre martes y jueves.",
  },
  "pre-test": {
    pos: "sustantivo",
    translation: "prueba previa",
    definition: "Evaluación realizada antes de un examen o actividad para medir conocimientos iniciales.",
  },
  "re-direction": {
    pos: "sustantivo",
    translation: "redirección, cambio de dirección",
    definition: "Acción de dirigir algo o a alguien hacia una nueva dirección o destino.",
  },
  "self-analysis": {
    pos: "sustantivo",
    translation: "autoanálisis",
    definition: "Análisis que una persona hace de sí misma, de su conducta o de sus pensamientos.",
  },
  "shut-down": {
    pos: "sustantivo",
    translation: "cierre, apagón",
    definition: "Acción de cerrar o detener una actividad, empresa o sistema.",
  },
  "self-organization": {
    pos: "sustantivo",
    translation: "autoorganización",
    definition: "Proceso por el cual un sistema adopta espontáneamente un orden interno sin control externo.",
  },
  "shut-off": {
    pos: "sustantivo",
    translation: "cierre, corte, desconexión",
    definition: "Acción o dispositivo que interrumpe el paso de algo, como fluido o energía.",
  },
  "sitting-room": {
    pos: "sustantivo",
    translation: "sala de estar",
    definition: "Habitación de la casa destinada a recibir visitas o descansar.",
  },
  "spot-check": {
    pos: "sustantivo",
    translation: "control aleatorio",
    definition: "Inspección rápida y sin aviso previo de una muestra para verificar su calidad o estado.",
  },
  "stick-up": {
    pos: "sustantivo",
    translation: "atraco a mano armada",
    definition: "Robo cometido con violencia o amenaza, generalmente con un arma.",
  },
  "touch-type": {
    pos: "verbo",
    translation: "escribir al tacto",
    definition: "Escribir en un teclado sin mirar las teclas usando todos los dedos.",
  },
  "work-in-progress": {
    pos: "sustantivo",
    translation: "trabajo en curso",
    definition: "Trabajo o proyecto que aún está en desarrollo y no ha sido terminado.",
  },
  "t-square": {
    pos: "sustantivo",
    translation: "escuadra en T",
    definition: "Regla con forma de T usada para trazar líneas paralelas y ángulos rectos.",
  },
  "baby-sit": {
    pos: "verbo",
    translation: "cuidar niños",
    definition: "Cuidar a los niños de otra persona, generalmente por un corto periodo de tiempo.",
  },
  "air-condition": {
    pos: "verbo",
    translation: "climatizar, acondicionar el aire",
    definition: "Regular la temperatura y humedad del aire en un espacio cerrado.",
  },
  "co-operation": {
    pos: "sustantivo",
    translation: "cooperación, colaboración",
    definition: "Acción de trabajar juntos para lograr un objetivo común.",
  },
  "book-keeping": {
    pos: "sustantivo",
    translation: "contabilidad, teneduría de libros",
    definition: "Registro sistemático de las operaciones financieras de una empresa o entidad.",
  },
  "mid-line": {
    pos: "sustantivo",
    translation: "línea media",
    definition: "Línea central que divide algo en dos partes simétricas o equidistantes.",
  },
  "mid-point": {
    pos: "sustantivo",
    translation: "punto medio",
    definition: "Punto que está a igual distancia de los extremos de un segmento o intervalo.",
  },
  "mid-water": {
    pos: "sustantivo",
    translation: "media agua",
    definition: "Zona de la columna de agua situada entre la superficie y el fondo.",
  },
  "notice-board": {
    pos: "sustantivo",
    translation: "tablón de anuncios",
    definition: "Superficie donde se colocan avisos o anuncios para que la gente los vea.",
  },
  "re-address": {
    pos: "verbo",
    translation: "volver a dirigir",
    definition: "Cambiar la dirección o el destinatario de algo, o abordar un asunto de nuevo.",
  },
  "re-analysis": {
    pos: "sustantivo",
    translation: "reanálisis",
    definition: "Acción de analizar de nuevo algo, especialmente un concepto o estructura.",
  },
  "re-direct": {
    pos: "verbo",
    translation: "redirigir, reencaminar",
    definition: "Cambiar la dirección o el destino de algo hacia otro lugar.",
  },
  "self-doubt": {
    pos: "sustantivo",
    translation: "inseguridad en uno mismo",
    definition: "Falta de confianza en las propias capacidades o decisiones.",
  },
  "still-birth": {
    pos: "sustantivo",
    translation: "mortinato, nacido muerto",
    definition: "Nacimiento de un feto sin signos de vida.",
  },
  "weight-loss": {
    pos: "sustantivo",
    translation: "pérdida de peso",
    definition: "Reducción del peso corporal, generalmente mediante dieta o ejercicio.",
  },
  "car-jack": {
    pos: "sustantivo",
    translation: "robo de auto",
    definition: "Robo de un vehículo mediante violencia o intimidación al conductor.",
  },
  "centre-forward": {
    pos: "sustantivo",
    translation: "delantero centro",
    definition: "Jugador de fútbol que ocupa la posición central del ataque y suele ser el principal goleador.",
  },
  "de-gay": {
    pos: "verbo",
    translation: "deshomosexualizar, quitar lo gay",
    definition: "Acción de eliminar o suprimir características homosexuales de algo o alguien.",
  },
  "eight-ball": {
    pos: "sustantivo",
    translation: "bola ocho",
    definition: "Bola negra con el número 8 usada en el billar; también situación difícil o comprometida.",
  },
  "first-aid": {
    pos: "sustantivo",
    translation: "primeros auxilios",
    definition: "Atención inmediata y básica que se presta a una persona herida o enferma antes de la atención médica.",
  },
  "low-fat": {
    pos: "adjetivo",
    translation: "bajo en grasa",
    definition: "Que contiene poca cantidad de grasa o materia grasa.",
  },
  "mid-course": {
    pos: "sustantivo",
    translation: "mitad del curso",
    definition: "Punto intermedio de un curso o trayectoria.",
  },
  "non-executive": {
    pos: "adjetivo",
    translation: "no ejecutivo",
    definition: "Que no tiene funciones ejecutivas ni poder de decisión en una organización.",
  },
  "non-drug": {
    pos: "adjetivo",
    translation: "no farmacológico",
    definition: "Que no implica o utiliza medicamentos o fármacos.",
  },
  "re-explain": {
    pos: "verbo",
    translation: "volver a explicar",
    definition: "Explicar algo de nuevo, generalmente de forma más clara o detallada.",
  },
  "re-gay": {
    pos: "sustantivo",
    translation: "hombre gay otra vez",
    definition: "Persona que vuelve a identificarse como gay.",
  },
  "re-grow": {
    pos: "verbo",
    translation: "volver a crecer",
    definition: "Crecer de nuevo después de haber sido cortado o dañado.",
  },
  "roll-over": {
    pos: "sustantivo",
    translation: "renovación de deuda",
    definition: "Acción de renovar o prorrogar automáticamente un préstamo o inversión al vencer.",
  },
  "stage-manager": {
    pos: "sustantivo",
    translation: "director de escena",
    definition: "Persona que supervisa los aspectos técnicos y organizativos de una producción teatral.",
  },
  "fast-growing": {
    pos: "adjetivo",
    translation: "de rápido crecimiento",
    definition: "Que crece o se desarrolla a gran velocidad.",
  },
  "ice-box": {
    pos: "sustantivo",
    translation: "nevera, refrigerador",
    definition: "Aparato electrodoméstico que mantiene los alimentos fríos mediante refrigeración.",
  },
  "roll-off": {
    pos: "sustantivo",
    translation: "rampa de descarga",
    definition: "Rampa o plataforma inclinada para descargar o trasladar objetos o vehículos.",
  },
  "single-click": {
    pos: "sustantivo",
    translation: "clic simple",
    definition: "Acción de pulsar una vez el botón del ratón.",
  },
  "super-computer": {
    pos: "sustantivo",
    translation: "supercomputadora",
    definition: "Computadora de alto rendimiento capaz de realizar cálculos muy complejos a gran velocidad.",
  },
  "shoot-out": {
    pos: "sustantivo",
    translation: "tiroteo, desempate",
    definition: "Enfrentamiento armado o prueba decisiva para resolver un empate.",
  },
  "he-bear": {
    pos: "sustantivo",
    translation: "oso macho",
    definition: "Oso de sexo masculino, especialmente el adulto.",
  },
  "ice-cold": {
    pos: "adjetivo",
    translation: "helado, muy frío",
    definition: "Que está extremadamente frío, como el hielo.",
  },
  "mid-air": {
    pos: "locución",
    translation: "en el aire",
    definition: "En el aire, dicho de algo que ocurre o se encuentra suspendido durante un vuelo.",
  },
  "over-reaction": {
    pos: "sustantivo",
    translation: "reacción exagerada",
    definition: "Respuesta excesiva o desproporcionada ante una situación o estímulo.",
  },
  "pre-release": {
    pos: "sustantivo",
    translation: "versión preliminar",
    definition: "Versión de un producto, como software o película, distribuida antes de su lanzamiento oficial.",
  },
  "re-application": {
    pos: "sustantivo",
    translation: "nueva solicitud",
    definition: "Acción de volver a presentar una solicitud o petición.",
  },
  "re-location": {
    pos: "sustantivo",
    translation: "reubicación, traslado",
    definition: "Acción de trasladar algo o a alguien a un nuevo lugar o ubicación.",
  },
  "re-interview": {
    pos: "verbo",
    translation: "volver a entrevistar",
    definition: "Entrevistar de nuevo a alguien para obtener más información o aclarar detalles.",
  },
  "stock-in-trade": {
    pos: "sustantivo",
    translation: "herramientas de trabajo",
    definition: "Conjunto de recursos, habilidades o bienes habituales de una persona o negocio.",
  },
  "bar-code": {
    pos: "sustantivo",
    translation: "código de barras",
    definition: "Representación gráfica de datos mediante barras para su lectura automática.",
  },
  "cross-section": {
    pos: "sustantivo",
    translation: "sección transversal",
    definition: "Corte o representación de un objeto por un plano perpendicular a su eje.",
  },
  "double-cross": {
    pos: "sustantivo",
    translation: "traición, doble juego",
    definition: "Acto de engañar o traicionar a alguien, especialmente a un aliado.",
  },
  "hard-copy": {
    pos: "sustantivo",
    translation: "copia impresa",
    definition: "Documento impreso en papel, en contraste con su versión digital.",
  },
  "hot-spot": {
    pos: "sustantivo",
    translation: "punto de acceso",
    definition: "Lugar que ofrece conexión inalámbrica a internet.",
  },
  "knowledge-base": {
    pos: "sustantivo",
    translation: "base de conocimiento",
    definition: "Conjunto organizado de información y datos estructurados para consulta y reutilización.",
  },
  "lady-in-waiting": {
    pos: "sustantivo",
    translation: "dama de compañía",
    definition: "Mujer que sirve y acompaña a una reina o princesa en la corte.",
  },
  "mid-morning": {
    pos: "sustantivo",
    translation: "media mañana",
    definition: "Parte de la mañana entre el comienzo del día y el mediodía.",
  },
  "mix-up": {
    pos: "sustantivo",
    translation: "confusión, lío, malentendido",
    definition: "Situación de confusión o error, especialmente por una mezcla o malentendido.",
  },
  "off-shoot": {
    pos: "sustantivo",
    translation: "ramificación, derivado",
    definition: "Rama o producto secundario que se deriva de algo principal.",
  },
  "one-hundred": {
    pos: "sustantivo",
    translation: "cien",
    definition: "Número cardinal que equivale a diez veces diez.",
  },
  "re-appear": {
    pos: "verbo",
    translation: "volver a aparecer",
    definition: "Aparecer de nuevo después de haber desaparecido o estado ausente.",
  },
  "self-protection": {
    pos: "sustantivo",
    translation: "autoprotección",
    definition: "Protección de uno mismo frente a peligros o daños.",
  },
  "top-dress": {
    pos: "verbo",
    translation: "abonar en superficie",
    definition: "Aplicar fertilizante sobre la superficie del suelo sin incorporarlo.",
  },
  "warm-up": {
    pos: "sustantivo",
    translation: "calentamiento",
    definition: "Ejercicios suaves previos a una actividad física o deportiva para preparar el cuerpo.",
  },
  "cross-sell": {
    pos: "sustantivo",
    translation: "venta cruzada",
    definition: "Técnica de vender productos adicionales o complementarios a un cliente existente.",
  },
  "cross-link": {
    pos: "sustantivo",
    translation: "enlace cruzado",
    definition: "Unión entre dos cadenas de polímero que las conecta formando una red.",
  },
  "double-quick": {
    pos: "adjetivo/adverbio",
    translation: "a paso ligero, rapidísimo",
    definition: "Muy rápido, a marcha acelerada o al instante.",
  },
  "kick-off": {
    pos: "sustantivo",
    translation: "saque inicial, inicio",
    definition: "Momento en que comienza un partido o una actividad.",
  },
  "mid-west": {
    pos: "sustantivo",
    translation: "Medio Oeste",
    definition: "Región central de Estados Unidos, situada entre el Este y el Oeste del país.",
  },
  "non-metal": {
    pos: "sustantivo",
    translation: "no metal",
    definition: "Elemento químico que no tiene propiedades metálicas y es mal conductor del calor y la electricidad.",
  },
  "re-structure": {
    pos: "verbo",
    translation: "reestructurar",
    definition: "Organizar de nuevo la estructura de algo para mejorarlo o adaptarlo.",
  },
  "non-target": {
    pos: "adjetivo",
    translation: "no objetivo",
    definition: "Que no forma parte del objetivo o blanco previsto.",
  },
  "over-capacity": {
    pos: "sustantivo",
    translation: "sobrecapacidad",
    definition: "Exceso de capacidad respecto a la demanda o al límite disponible.",
  },
  "record-keeping": {
    pos: "sustantivo",
    translation: "llevanza de registros",
    definition: "Práctica de mantener registros o archivos de información de forma organizada.",
  },
  "thought-criminal": {
    pos: "sustantivo",
    translation: "criminal de pensamiento",
    definition: "Persona castigada por tener pensamientos prohibidos por el régimen.",
  },
  "time-limit": {
    pos: "sustantivo",
    translation: "límite de tiempo",
    definition: "Plazo máximo establecido para realizar una actividad o tarea.",
  },
  "weight-train": {
    pos: "verbo",
    translation: "entrenar con pesas",
    definition: "Realizar ejercicios de fuerza utilizando pesas para desarrollar los músculos.",
  },
  "cross-train": {
    pos: "verbo",
    translation: "entrenar de forma cruzada",
    definition: "Entrenar en varias disciplinas o actividades para mejorar el rendimiento general.",
  },
  "grand-daughter": {
    pos: "sustantivo",
    translation: "nieta",
    definition: "Hija del hijo o de la hija de una persona.",
  },
  "guide-line": {
    pos: "sustantivo",
    translation: "pauta, directriz",
    definition: "Norma o indicación que orienta cómo actuar o proceder en una situación.",
  },
  "mid-field": {
    pos: "sustantivo",
    translation: "centrocampo",
    definition: "Zona central del campo de juego entre las áreas de ambos equipos.",
  },
  "mid-summer": {
    pos: "sustantivo",
    translation: "pleno verano",
    definition: "Parte central del verano, alrededor del solsticio.",
  },
  "mid-term": {
    pos: "sustantivo",
    translation: "examen de mitad de curso",
    definition: "Prueba o evaluación que se realiza a mitad de un período académico.",
  },
  "off-bear": {
    pos: "verbo",
    translation: "retirar, apartar",
    definition: "Separar o retirar algo del proceso principal, especialmente en fundición.",
  },
  "on-loan": {
    pos: "adjetivo",
    translation: "prestado, en préstamo",
    definition: "Que se cede temporalmente a otra persona o entidad.",
  },
  "place-kick": {
    pos: "sustantivo",
    translation: "patada colocada",
    definition: "Patada de balón desde el suelo tras colocarlo, usada en rugby y fútbol americano.",
  },
  "pre-conference": {
    pos: "adjetivo",
    translation: "previo a la conferencia",
    definition: "Que ocurre o se realiza antes de una conferencia.",
  },
  "pre-treatment": {
    pos: "sustantivo",
    translation: "pretratamiento",
    definition: "Proceso previo de preparación o acondicionamiento aplicado a algo antes de su tratamiento principal.",
  },
  "re-count": {
    pos: "verbo",
    translation: "recontar, volver a contar",
    definition: "Contar de nuevo algo, especialmente votos, para verificar el resultado.",
  },
  "re-generation": {
    pos: "sustantivo",
    translation: "regeneración",
    definition: "Proceso de volver a generar o restaurar algo.",
  },
  "roll-call": {
    pos: "sustantivo",
    translation: "pase de lista",
    definition: "Acción de llamar a los miembros de un grupo para verificar su presencia.",
  },
  "self-understanding": {
    pos: "sustantivo",
    translation: "autocomprensión",
    definition: "Conocimiento o comprensión que una persona tiene de sí misma.",
  },
  "three-quarter": {
    pos: "adjetivo",
    translation: "de tres cuartos",
    definition: "Que representa las tres cuartas partes de algo o tiene esa proporción.",
  },
  "truth-telling": {
    pos: "sustantivo",
    translation: "decir la verdad",
    definition: "Acción o cualidad de expresar la verdad con sinceridad y sin engaños.",
  },
  "wind-break": {
    pos: "sustantivo",
    translation: "rompevientos",
    definition: "Barrera natural o artificial que protege del viento.",
  },
  "wine-making": {
    pos: "sustantivo",
    translation: "elaboración de vino",
    definition: "Proceso de producción de vino a partir de la fermentación de la uva.",
  },
  "winter-kill": {
    pos: "verbo",
    translation: "morir por congelación",
    definition: "Sufrir muerte o daño una planta o animal por efecto del frío invernal.",
  },
  "cross-bar": {
    pos: "sustantivo",
    translation: "barra transversal",
    definition: "Pieza horizontal que cruza entre dos soportes, como en una portería o estructura.",
  },
  "ex-wife": {
    pos: "sustantivo",
    translation: "exesposa",
    definition: "Mujer que fue esposa de alguien y ya no lo es por divorcio o separación.",
  },
  "exchange-rate": {
    pos: "sustantivo",
    translation: "tipo de cambio",
    definition: "Precio de una moneda expresado en otra moneda.",
  },
  "guide-book": {
    pos: "sustantivo",
    translation: "guía turística",
    definition: "Libro que contiene información práctica para viajeros sobre un lugar.",
  },
  "re-apply": {
    pos: "verbo",
    translation: "volver a solicitar",
    definition: "Solicitar de nuevo algo, como un empleo, beca o permiso.",
  },
  "re-enter": {
    pos: "verbo",
    translation: "volver a entrar",
    definition: "Entrar de nuevo en un lugar del que se había salido.",
  },
  "re-gain": {
    pos: "verbo",
    translation: "recuperar, volver a ganar",
    definition: "Volver a obtener o recuperar algo que se había perdido.",
  },
  "re-supply": {
    pos: "sustantivo",
    translation: "reabastecimiento, suministro adicional",
    definition: "Acción de volver a proveer o suministrar algo que se había agotado.",
  },
  "teach-in": {
    pos: "sustantivo",
    translation: "seminario de protesta",
    definition: "Reunión educativa informal para debatir y protestar sobre un tema político o social.",
  },
  "war-criminal": {
    pos: "sustantivo",
    translation: "criminal de guerra",
    definition: "Persona que comete crímenes graves contra el derecho internacional humanitario en un conflicto armado.",
  },
  "wild-type": {
    pos: "sustantivo",
    translation: "tipo silvestre",
    definition: "Variante genética natural de un organismo, sin mutaciones inducidas.",
  },
  "co-option": {
    pos: "sustantivo",
    translation: "cooptación",
    definition: "Acción de incorporar a alguien a un grupo o asimilar una idea ajena.",
  },

};

/**
 * Busca si la palabra o alguna de sus formas base está presente en el léxico
 * núcleo de inglés offline. Devuelve una LexiconEntry completa si existe.
 */
export function getEnglishCoreEntry(word: string): LexiconEntry | null {
  const candidates = generateLookupCandidates(word, "en");

  for (const candidate of candidates) {
    const direct = ENGLISH_CORE_LEXICON[candidate];
    if (direct) {
      const def = direct.translation
        ? `${direct.translation}: ${direct.definition}`
        : direct.definition;

      return {
        entryId: null,
        lemma: candidate,
        pos: direct.pos ?? null,
        freqRank: null,
        zipf: calibrationBankZipf(candidate, "en"),
        senses: [
          {
            definition: def,
            example: null,
            senseOrder: 1,
          },
        ],
      };
    }

    // Comprobar también el banco de calibración en inglés
    const calDef = CALIBRATION_DEFINITIONS_EN[candidate];
    if (calDef) {
      return {
        entryId: null,
        lemma: candidate,
        pos: null,
        freqRank: null,
        zipf: calibrationBankZipf(candidate, "en"),
        senses: [
          {
            definition: calDef,
            example: null,
            senseOrder: 1,
          },
        ],
      };
    }
  }

  return null;
}


export function isCommonEnglishWord(word: string): boolean {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return false;
  if (ENGLISH_CORE_LEXICON[normalized]) return true;
  if (CALIBRATION_DEFINITIONS_EN[normalized]) return true;
  return getEnglishCoreEntry(normalized) !== null;
}
