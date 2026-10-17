import type { LexiconEntry } from "../client/lib/lexicon";
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
 * Diccionario base offline de supervivencia inglés-español con ~250 palabras
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
