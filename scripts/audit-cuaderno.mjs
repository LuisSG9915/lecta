#!/usr/bin/env node
// Auditoría del Cuaderno y de la «Sesión Fluida» de Lecta.
//
// Pregunta que responde: ¿el Cuaderno enseña antes de examinar? El usuario
// reportó que al pulsar «Iniciar Sesión Fluida» no recuerda ninguna palabra.
// Este arnés comprueba, con anclajes al código real, que la CTA primaria del
// héroe abre una PRUEBA y que la fase de ESTUDIO (primera exposición guiada)
// existe pero vive debajo, sin puente. No opina: cita archivo:línea.
//
// También emite el encargo por FASES (F0…F6) que consume la sesión que
// implementa, y las preguntas de investigación con su cita a verificar.
//
//   node scripts/audit-cuaderno.mjs                 # sin red
//   node scripts/audit-cuaderno.mjs --online        # además resuelve las citas en Crossref
//   node scripts/audit-cuaderno.mjs --claim C2      # solo las afirmaciones que empiezan por C2
//   node scripts/audit-cuaderno.mjs --brief         # imprime el encargo listo para pegar
//   node scripts/audit-cuaderno.mjs --json          # vuelca el reporte a stdout
//   node scripts/audit-cuaderno.mjs --out /tmp/x    # dir de salida (default docs/auditoria/cuaderno)
//
// Códigos de salida: 0 = el registro coincide con el código (defecto donde
// decimos y correcciones que siguen en su sitio), 1 = el código se movió, el
// defecto ya no está o una corrección desapareció (hay que revisar el registro,
// no silenciarlo), 2 = error de uso.
//
// tipo "corregido": la afirmación describe el arreglo, no el defecto. Sus
// comprobaciones deben coincidir; si dejan de coincidir se reporta REGRESION.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL = "audit-cuaderno";
export const VERSION = 1;
export const DEFAULT_OUT = "docs/auditoria/cuaderno";

const ROOT = process.cwd();
const USER_QUOTE =
  "no recuerdo para nada las palabras al dar iniciar sesión fluida… primero tengo que aprenderme las palabras, de ahí sí puedo practicar";

/* ==========================================================================
   1. Registro de afirmaciones
   Cada afirmación es falsable: o el anclaje coincide con el código o no.
   tipo:
     - "defecto"   : algo del flujo que produce la queja del usuario.
     - "contexto"  : hecho de diseño que condiciona el arreglo (no es el bug).
     - "corregido" : el arreglo que debe seguir en pie (si falta, REGRESION).
   comprobaciones:
     - "presente" : el patrón existe en el archivo y se reporta dónde. Es la que
                    usan las afirmaciones: no se rompe al mover código.
     - "ausente"  : el patrón no aparece en un rango.
     - "anchor"   : el patrón está a ±window de una línea exacta. Solo para
                    probar el mecanismo; no usar en afirmaciones.
     - "orden"    : dos anclajes en orden.
   ========================================================================== */

export const CLAIMS = [
  {
    id: "C1-cta-primaria-abre-una-prueba",
    tipo: "corregido",
    titulo:
      "El héroe ofrece «Repasar» como principal cuando hay vencidas y «Aprender» siempre disponible (principal si no hay vencidas)",
    porque: `«${USER_QUOTE}» — la sesión de repaso ya nunca examina lo no presentado (C2), así que el botón principal puede repasar sin riesgo; «Aprender» queda como segundo botón (decisión de Luis, 2026-11-10: repasar primero) y vuelve a ser el principal sin vencidas.`,
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "\\) : reviewWordCount > 0 \\? \\(",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "\\) : learnableCount > 0 \\? \\(",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "onClick=\\{\\(\\) => startLearn\\(\\)\\}",
      },
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: "Iniciar Sesi[oó]n Fluida",
      },
    ],
  },
  {
    id: "C2-cola-sale-de-las-vencidas",
    tipo: "corregido",
    titulo:
      "La sesión sale de reviewQueue: vencidas, ya presentadas y sin rama de respaldo",
    porque:
      "Se fue la rama scopedWords.slice(0,5), que servía palabras no vencidas, «Ya la conozco» y adelantaba repasos.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "\\(\\) => reviewQueue\\(scopedWords, knownKeys, exposure\\),",
      },
      {
        tipo: "presente",
        file: "src/client/lib/learn.ts",
        expect: "!isLearnPending\\(word, knownKeys, exposure\\) &&",
      },
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: "scopedWords\\.slice\\(0, 5\\)",
      },
    ],
  },
  {
    id: "C3-tarjeta-nueva-vence-al-crearse",
    tipo: "contexto",
    titulo:
      "La tarjeta nace vencida al GUARDAR la palabra en el lector; por eso la cola filtra por exposición",
    porque:
      "scheduleCapturedReview crea newCard() (reps 0, due=ahora) al guardar. La cola no puede decidir solo por vencimiento: exige exposición o reps > 0.",
    checks: [
      {
        tipo: "presente",
        file: "src/client/lib/reviews.ts",
        expect: "const card = existing\\.card \\?\\? newCard\\(\\);",
      },
      {
        tipo: "presente",
        file: "src/client/lib/fsrs.ts",
        expect: "return createEmptyCard\\(now\\);",
      },
      {
        tipo: "presente",
        file: "src/client/lib/fsrs.ts",
        expect: "return !card \\|\\| new Date\\(card\\.due\\)\\.getTime\\(\\) <= now\\.getTime\\(\\);",
      },
    ],
  },
  {
    id: "C4-primer-reto-es-elegir-entre-cuatro",
    tipo: "corregido",
    titulo: "El reto elige un modo que la palabra puede cumplir y corrige con el significado",
    porque:
      "Una palabra sin oración ya no cae en choose (adivinar al 25 %): pasa al modo significado. Tras responder se muestra forma y significado.",
    checks: [
      {
        tipo: "presente",
        file: "src/client/lib/practice.ts",
        expect: "if \\(isNew \\|\\| stability < 2\\.5\\) \\{",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "if \\(!isEligible\\(ch\\.word, mode\\)\\) \\{",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "Toca la palabra que falta\\.",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: 'className="nb-answer-foot" role="status"',
      },
    ],
  },
  {
    id: "C5-estudio-existe-pero-abajo",
    tipo: "corregido",
    titulo: "La ficha de presentación es la entrada del héroe; ya no hay bloque enterrado",
    porque:
      "Se quitó la sección «Por aprender · N» que vivía debajo del héroe: el botón primario hace ese trabajo.",
    checks: [
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: 'aria-label="Palabras por aprender"',
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "onClick=\\{\\(\\) => startLearn\\(\\)\\}",
      },
    ],
  },
  {
    id: "C6-sesion-puede-ensayar-borradas",
    tipo: "contexto",
    titulo:
      "Las lápidas no llegan a la sesión: listSavedWords las filtra antes de que exista dueWords",
    porque:
      "Buscar «deleted» dentro de dueWords era una ausencia usada como prueba. El filtro real está en la carga y al borrar se quita la fila del estado.",
    checks: [
      {
        tipo: "presente",
        file: "src/client/lib/idb.ts",
        expect: "return all\\.filter\\(\\(word\\) => !word\\.deleted\\);",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "listSavedWords\\(",
      },
    ],
  },
  {
    id: "C7-copia-no-dice-cuantas-faltan",
    tipo: "corregido",
    titulo:
      "El botón dice qué hace y con cuántas palabras (la tanda real y de cuántas hay); no promete minutos",
    porque:
      "«~2 min» y «1 min» describían la misma sesión, y «Aprender 43 palabras nuevas» abría una tanda de 5. Ahora el botón lleva la cifra de la tanda (`Aprender 5 de 43`) y desaparece la promesa de duración.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "Aprender \\$\\{learnBatch\\} de \\$\\{learnable\\.length\\}",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "Repasar \\{Math\\.min\\(REVIEW_SESSION_SIZE, reviewWordCount\\)\\}",
      },
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: "~2 min|1 min",
      },
    ],
  },
  {
    id: "C8-indice-del-heroe-solo-cuenta-hoy",
    tipo: "corregido",
    titulo: "El encabezado separa «por aprender» de «para repasar»",
    porque:
      "Dos trabajos distintos ya no comparten una sola cifra: la de aprender solo cuenta palabras que pueden entrar a la ficha.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "por aprender",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "para repasar",
      },
    ],
  },
  {
    id: "C9-el-rescate-llega-despues-de-fallar",
    tipo: "contexto",
    titulo:
      "La red anti-frustración sigue siendo post-fallo y solo para Nivel 2-3; la corrección nueva está en el modo choose",
    porque:
      "rescueChallenge solo actúa si el fallo fue en Nivel 2 o 3. Para la palabra nueva (Nivel 1), la corrección es ver forma y significado.",
    checks: [
      {
        tipo: "presente",
        file: "src/client/lib/practice.ts",
        expect: "export function rescueChallenge\\(",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "challenge\\.level <= 1",
      },
    ],
  },
  {
    id: "C10-dos-puertas-a-la-misma-sesion",
    tipo: "contexto",
    titulo: "Queda una sola puerta a la sesión: el héroe; la de GamePanel sigue muerta",
    porque:
      "Se quitó «Repaso rápido», que caía a startAdaptiveFlow con otro texto. El CTA adaptive_flow de GamePanel nunca se pinta: el único montaje usa dashboard o ai_workshop.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: 'mode=\\{workshopOpen \\? "ai_workshop" : "dashboard"\\}',
      },
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: "notebook-quick-review-cta",
      },
    ],
  },
  {
    id: "X1-la-exposicion-ya-se-persiste",
    tipo: "contexto",
    titulo:
      "La primera exposición vive por cuenta (learnExposure:v1) y viaja con la palabra (presentedAt)",
    porque:
      "isLearnPending + withExposure arbitran estudio vs repaso y migran de anónimo a cuenta. Además `presentedAt` se guarda en la fila y se sincroniza con `lecta_user_words.presented_at`, así que en otro dispositivo la ficha no se repite antes del primer repaso.",
    checks: [
      {
        tipo: "presente",
        file: "src/client/lib/learn.ts",
        expect: 'LEARN_EXPOSURE_KEY = "learnExposure:v1"',
      },
      {
        tipo: "presente",
        file: "src/client/lib/learn.ts",
        expect: "export function isLearnPending\\(",
      },
      {
        tipo: "presente",
        file: "src/client/lib/learn.ts",
        expect: "exposure\\.seen\\[word\\.key\\] \\|\\| \\(word\\.presentedAt \\?\\? 0\\) > 0",
      },
    ],
  },
  {
    id: "X2-los-modos-ya-estan-gateados-por-datos",
    tipo: "contexto",
    titulo: "Los modos declaran qué datos necesitan (isEligible) y la sesión lo respeta",
    porque:
      "isEligible define qué pide cada modo; startAdaptiveFlow ahora lo consulta antes de armar el ítem.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const isEligible = \\(word: SavedWord, mode: PracticeMode\\) => \\{",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "if \\(!isEligible\\(ch\\.word, mode\\)\\) \\{",
      },
    ],
  },
  {
    id: "X3-el-primer-paso-del-lector-ya-es-una-ficha",
    tipo: "contexto",
    titulo:
      "La ficha de primera exposición ya tiene UI y voz (learnKeep/learnKnown/learnEnrich) y puente a repaso",
    porque:
      "El puente estudio→prueba reutiliza esa ficha, sin duplicar un componente nuevo.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const startLearn = \\(first\\?: SavedWord\\) => \\{",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const learnKeep = async \\(\\) => \\{",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "Repasar esta palabra",
      },
    ],
  },
  {
    id: "C11-cualquier-respuesta-cancela-la-ficha",
    tipo: "corregido",
    titulo:
      "Una palabra con reps 0 solo sale de «Por aprender» con una decisión explícita: la cola la excluye",
    porque:
      "isLearnPending sigue excluyendo reps > 0, pero ahora reviewQueue exige exposición o reps > 0: una respuesta al azar ya no puede ser la primera exposición de una palabra.",
    checks: [
      {
        tipo: "presente",
        file: "src/client/lib/learn.ts",
        expect: "export function reviewQueue\\(",
      },
      {
        tipo: "presente",
        file: "src/client/lib/learn.ts",
        expect: "if \\(\\(word\\.card\\?\\.reps \\?\\? 0\\) > 0\\) return false;",
      },
    ],
  },
  {
    id: "C12-modos-libres-tampoco-examinan",
    tipo: "corregido",
    titulo:
      "Los modos libres (Hueco, Sílabas, Telar) también salen de reviewWords y avisan cuando no hay nada",
    porque:
      "startPractice usaba dueWords y podía preguntar por palabras nunca presentadas, además de adelantar repasos. Ahora comparte la regla de la sesión y explica por qué los botones están apagados.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "reviewWords",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "disabled=.*eligibleCount\\.cloze === 0",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "Los modos libres usan palabras que ya viste",
      },
    ],
  },
  // --- Fase 1 del plan v2 (2026-11-10): comportamiento ---
  {
    id: "C16-pista-respeta-ia-y-se-registra",
    tipo: "corregido",
    titulo:
      "La pista del gato respeta «Usar IA», se descarta si la tarjeta cambió y el repaso registra cuántas se pidieron",
    porque:
      "askCatHint solo pedía sesión, el historial siempre guardaba hints: 0 y una respuesta tardía se pintaba sobre la tarjeta siguiente.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const canHint = hasSession && useAi;",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "hints: hintsUsedRef\\.current,",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const stillHere = \\(\\) => hintForRef\\.current === forKey;",
      },
    ],
  },
  {
    id: "C17-rescate-exige-datos-del-modo",
    tipo: "corregido",
    titulo:
      "El rescate tras fallar solo baja a «elegir palabra» si hay oración; si no, al significado",
    porque:
      "El rescate mandaba siempre a choose: sin oración era adivinar entre cuatro, lo que la regla del Cuaderno prohíbe.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const tryRescue = \\(item: QueueItem, speech: string\\): boolean =>",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: 'const rescueMode: PracticeMode \\| null = isEligible\\(item\\.word, "choose"\\)',
      },
    ],
  },
  {
    id: "C18-calificar-sobre-la-version-vigente",
    tipo: "corregido",
    titulo:
      "Calificar guarda sobre la palabra vigente del estado, no sobre la copia de la cola, y el relleno de significados no pisa filas más nuevas",
    porque:
      "grade escribía {...copiaDeLaCola, card}: un significado rellenado después (o un repaso del taller) se perdía.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "wordsRef\\.current\\?\\.find\\(\\(w\\) => w\\.key === queued\\.key",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "return m && \\(m\\.updatedAt \\?\\? 0\\) >= \\(w\\.updatedAt \\?\\? 0\\) \\? m : w;",
      },
    ],
  },
  {
    id: "C19-sin-tarjetas-en-blanco-ni-parejas-de-una",
    tipo: "corregido",
    titulo:
      "Partida rápida y chequeo de 30 días no arman tarjetas sin nada que mostrar; Parejas pide al menos dos palabras y no deja una tanda de una",
    porque:
      "El modo «Palabra» de reserva pintaba una tarjeta en blanco sin significado, y una tanda de una sola pareja se resolvía sola como acierto.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "Esta palabra necesita un significado o una oración para repasarse\\.",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "Parejas necesita al menos dos palabras con significado\\.",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "items\\.length % MATCH_TANDA === 1",
      },
    ],
  },
  {
    id: "C20-pasar-no-vuelve-al-frente",
    tipo: "corregido",
    titulo:
      "Las fichas sin significado y las pasadas con «Pasar por ahora» van al final de la siguiente tanda",
    porque:
      "«Pasar por ahora» no escribe exposición, así que la palabra volvía al frente de cada tanda y tapaba a las demás.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "learnPassedRef\\.current\\.has\\(word\\.key\\) \\? 2 : word\\.meaning \\? 0 : 1",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "onClick=\\{passLearn\\}",
      },
    ],
  },
  // --- Fase 2 del plan v2 (2026-11-10): superficie ---
  // Nacieron como defectos (Fase 0) y pasaron a «corregido» al cerrar la Fase 2:
  // las comprobaciones describen ahora el arreglo.
  {
    id: "C13-modos-libres-a-la-vista",
    tipo: "corregido",
    titulo:
      "Los modos libres viven en un solo <details> «Más formas de practicar», cerrado por defecto",
    porque:
      "El plan v1 (Fase 1) pedía colapsarlos y el 2026-11-09 se añadió «Más ejercicios» a la vista. Decisión de Luis (2026-11-10): un solo plegable; los 5 modos, el taller y los 8 extra comparten rejilla.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: '<details className="nb-free-modes">',
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "Más formas de practicar</summary>",
      },
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: "moreModesOpen|nb-free-mode-more",
      },
    ],
  },
  {
    id: "C14-gamificacion-en-el-heroe",
    tipo: "corregido",
    titulo:
      "El héroe ya no muestra «Energía Léxica», Combo ni puntos; el cierre ya no pinta «XP / Nivel»",
    porque:
      "El plan v1 (Fase 2) pedía sacar XP y Combo del flujo principal. La racha vive solo en el cierre de sesión.",
    checks: [
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: "nb-hero-energy|Energía Léxica",
      },
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: "⭐|levelProgress",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "Racha de \\$\\{streakDays\\} días\\.",
      },
    ],
  },
  {
    id: "C15-no-hay-cierre-unico-de-sesion",
    tipo: "corregido",
    titulo:
      "Cierre único «Terminado por hoy.» con próxima fecha y racha; «Terminar por hoy» pasa por él",
    porque:
      "El plan v1 (Fase 3) describía un cierre único. Vaciar la cola y salir a mitad (si ya se repasó algo) llegan a la misma pantalla; sin repasos, sale al cuaderno sin cierre.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: 'Terminado por hoy\\.</p>',
      },
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: "Repaso terminado\\.</p>",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "\\(\\) => void review\\.exitSession\\(\\)",
      },
    ],
  },
  // --- Fase 3 del plan v2 (2026-11-10): cifras, texto y accesibilidad ---
  {
    id: "C21-una-sola-cuenta-del-ciclo-de-vida",
    tipo: "corregido",
    titulo:
      "«Nuevas» (píldora, filtro y fila) es exactamente «por aprender»; una declarada conocida cuenta como dominada",
    porque:
      "wordStage contaba como «nueva» también a las ya repasadas con S < 2 días y a las conocidas, así que la píldora no cuadraba con el encabezado. Ahora hay un solo WordLifecycle (pending/known) para píldoras, filtros, filas y orden.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: "type WordLifecycle = \\{ pending: boolean; known: boolean \\};",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const lifecycle = useCallback\\(",
      },
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: "isUnexposedWord",
      },
    ],
  },
  {
    id: "C22-deshacer-unico-y-citas-reversibles",
    tipo: "corregido",
    titulo:
      "Un solo aviso de deshacer por palabra; borrar una cita se puede deshacer y un fallo de guardado se muestra",
    porque:
      "El aviso de «se quitó del cuaderno» se pintaba dos veces, y removeQuote tragaba el error y no ofrecía recuperar la cita.",
    checks: [
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: 'className="nb-undo"',
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const restoreQuote = async \\(\\) =>",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "No se pudo quitar la cita\\. Intenta de nuevo\\.",
      },
    ],
  },
  {
    id: "C23-chips-gato-y-glifos-accesibles",
    tipo: "corregido",
    titulo:
      "Chips recientes como lista de botones sin glifos de texto; el chip limpia lo que esconde la palabra; el gato solo con compañero activo y con el mismo manejador en clic y teclado",
    porque:
      "Los chips eran botones con role=listitem, tocarlos no hacía nada visible bajo un filtro, el gato se pintaba con el compañero apagado y su teclado no hacía lo mismo que el clic.",
    checks: [
      {
        tipo: "presente",
        file: "@notebook",
        expect: '<ul className="nb-recent-track">',
      },
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: 'role="listitem"|aria-hidden="true">★|"▸ "|"▾ "',
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: 'setFilter\\("all"\\);',
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const heroCompanion = companion\\?\\.enabled && companion\\.state \\? companion : null;",
      },
    ],
  },
  // --- Fase 4 del plan v2 (2026-11-10): limpieza y rendimiento ---
  {
    id: "C24-sin-codigo-muerto-y-calculos-memoizados",
    tipo: "corregido",
    titulo:
      "Sin UnifiedNotebookView, pestaña «today» ni MODES.needs; cola, conteos y filtrado memoizados (búsqueda diferida con índice)",
    porque:
      "UnifiedNotebookView no se usaba (App nunca pasa words) y cada render recalculaba reviewQueue, ~14 filtros con regex y la lista filtrada, también en cada tecla del buscador. Medido con 400 palabras en jsdom: mediana por tecla 21 ms → 15 ms.",
    checks: [
      {
        tipo: "ausente",
        file: "@notebook",
        from: 1,
        to: 99999,
        pattern: "UnifiedNotebookView|tab === \"today\"|needs: \"",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "\\(\\) => reviewQueue\\(scopedWords, knownKeys, exposure\\),",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const deferredQuery = useDeferredValue\\(query\\);",
      },
      {
        tipo: "presente",
        file: "@notebook",
        expect: "const eligibleCount = useMemo\\(",
      },
    ],
  },
];

/* ==========================================================================
   2. Preguntas de investigación
   Sin DOI inventados: se cita autoría + año + título y `buscar` es la
   consulta bibliográfica que `--online` resuelve en Crossref. La existencia
   la comprueba el arnés; la idoneidad la juzga la IA auditora.
   ========================================================================== */

export const RESEARCH = [
  {
    id: "R1-recuperacion-antes-que-exposicion",
    cuestion:
      "¿Una palabra desconocida se aprende mejor si se le pide recuperarla antes de presentarla, o al revés?",
    cita: {
      autor: "Roediger & Karpicke",
      anio: 2006,
      titulo:
        "Test-enhanced learning: Taking memory tests improves long-term retention",
      revista: "Psychological Science",
      doi: "10.1111/j.1467-9280.2006.01693.x",
    },
    buscar: "Test-enhanced learning taking memory tests improves long-term retention",
    porQue:
      "Es la evidencia que sostiene la Sesión Fluida actual (testear). Su condición: el material YA fue estudiado.",
    queAtacar:
      "Comprobar si el estudio midió retención sobre material nunca presentado; si no, no aplica a palabras nuevas.",
  },
  {
    id: "R2-pretesting",
    cuestion:
      "¿Fallar un intento de recuperación antes de estudiar ayuda después? ¿Cuánto y en qué material?",
    cita: {
      autor: "Richland, Kornell & Kao",
      anio: 2009,
      titulo:
        "The pretesting effect: Do unsuccessful retrieval attempts enhance learning?",
      revista: "Journal of Experimental Psychology: Applied",
      doi: "10.1037/a0016496",
    },
    buscar: "The pretesting effect do unsuccessful retrieval attempts enhance learning",
    porQue:
      "Es el mejor argumento CONTRA el arreglo propuesto (presentar primero). Hay que citarlo, no esquivarlo.",
    queAtacar:
      "El efecto pretesting se mide en material con pistas ricas (prosa, preguntas). ¿Se replica con pares forma-significado aislados y sin retroalimentación inmediata?",
  },
  {
    id: "R3-fallo-con-retroalimentacion",
    cuestion:
      "¿La recuperación fallida mejora el aprendizaje solo si hay retroalimentación correctiva inmediata?",
    cita: {
      autor: "Kornell, Hays & Bjork",
      anio: 2009,
      titulo: "Unsuccessful retrieval attempts enhance subsequent learning",
      revista: "Journal of Experimental Psychology: Learning, Memory, and Cognition",
      doi: "10.1037/a0015729",
    },
    buscar: "Unsuccessful retrieval attempts enhance subsequent learning",
    porQue:
      "Si la mejora depende de la corrección inmediata, la sesión actual (fallar → rescate con pista) no capitaliza el fallo: lo tapa.",
    queAtacar:
      "¿El rescate de practice.ts:407 muestra la respuesta correcta o solo una pista parcial (prefijo de 2 letras)?",
  },
  {
    id: "R4-dificultades-deseables",
    cuestion:
      "¿Cuándo una dificultad es «deseable» y cuándo es solo fricción que hace abandonar?",
    cita: {
      autor: "Bjork & Bjork",
      anio: 2011,
      titulo:
        "Making things hard on yourself, but in a good way: Creating desirable difficulties to enhance learning",
      revista: "Psychology and the real world (capítulo)",
      // Capítulo de libro sin DOI: no se resuelve en Crossref. Buscarlo por
      // título devuelve otra obra (verificado el 2026-10-28).
      sinDoi: true,
    },
    buscar: "Making things hard on yourself but in a good way creating desirable difficulties",
    porQue:
      "Da el marco para decidir si «que no recuerde nada» es dificultad deseable o fracaso de diseño.",
    queAtacar:
      "La condición de dificultad deseable es éxito alcanzable y alto; con acierto ~azar (4 opciones) no se cumple.",
  },
  {
    id: "R5-repeticiones-para-vocabulario-l2",
    cuestion:
      "¿Cuántos encuentros con una palabra hacen falta antes de exigir recuperación productiva?",
    cita: {
      autor: "Webb",
      anio: 2007,
      titulo: "The effects of repetition on vocabulary knowledge",
      revista: "Applied Linguistics",
      doi: "10.1093/applin/aml048",
    },
    buscar: "The effects of repetition on vocabulary knowledge Webb",
    porQue:
      "Da el orden de magnitud para el umbral de la primera pasada (1 encuentro no basta para reconocimiento con distractores).",
    queAtacar:
      "No es un estudio de caso: 121 estudiantes japoneses, pseudopalabras en contexto y aprendizaje INCIDENTAL (1, 3, 7 y 10 encuentros; ganancias sustanciales a los 10, conocimiento completo pide más). El «8–12» no aplica a estudio intencional con definición.",
  },
  {
    id: "R6-modelo-de-agenda-fsrs",
    cuestion:
      "¿Qué predice FSRS exactamente, y qué NO predice?",
    cita: {
      autor: "Ye, Su & Cao",
      anio: 2022,
      titulo:
        "A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling",
      revista: "KDD",
      doi: "10.1145/3534678.3539081",
    },
    buscar:
      "A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling",
    porQue:
      "FSRS predice recuerdo a partir de logs de repaso. Una tarjeta con reps 0 no tiene log: no hay nada que predecir.",
    queAtacar:
      "Verificar que el producto no use la estabilidad predicha como si midiera aprendizaje probado.",
  },
  {
    id: "R7-carga-cognitiva-y-ejemplos",
    cuestion:
      "¿Conviene resolver un problema sin instrucción previa cuando el material es arbitrario (forma-significado)?",
    cita: {
      autor: "Sweller",
      anio: 1988,
      titulo: "Cognitive load during problem solving: Effects on learning",
      revista: "Cognitive Science",
      doi: "10.1207/s15516709cog1202_4",
    },
    buscar: "Cognitive load during problem solving effects on learning Sweller",
    porQue:
      "Para material arbitrario, buscar en el vacío impone carga que no deja traza: apoya presentar antes de exigir.",
    queAtacar:
      "El contraejemplo es «productive failure» (Kapur, 2008), que funciona con conceptos, no con pares léxicos.",
  },
  {
    id: "R8-reconocer-antes-que-recordar",
    cuestion:
      "¿Una interfaz debe pedir reconocimiento o recuerdo según lo que el usuario ya sabe?",
    cita: {
      autor: "Nielsen",
      anio: 1994,
      titulo: "10 usability heuristics for user interface design (heurística 6)",
      revista: "Nielsen Norman Group",
      // Guía de usabilidad, no artículo académico: no se resuelve en Crossref.
      tipo: "guia",
    },
    buscar: "10 usability heuristics for user interface design recognition rather than recall",
    porQue:
      "Es la heurística que el héroe del Cuaderno incumple: pide reconocer algo que nunca se mostró.",
    queAtacar:
      "La heurística es guía, no medición: no sustituye la evidencia experimental (R1–R3).",
  },
  {
    id: "R9-generar-error-con-correccion",
    cuestion:
      "¿Generar un intento libre y recibir la respuesta correcta de inmediato supera a solo leer, incluso con vocabulario nuevo?",
    cita: {
      autor: "Potts & Shanks",
      anio: 2014,
      titulo: "The benefit of generating errors during learning",
      revista: "Journal of Experimental Psychology: General",
      doi: "10.1037/a0033194",
    },
    buscar: "The benefit of generating errors during learning",
    porQue:
      "Es el contraargumento más fuerte a «presentar primero»: generar y fallar con corrección inmediata gana a leer. También es la evidencia que respalda la ficha actual (ver la palabra y el contexto, pensar, «Mostrar significado»).",
    queAtacar:
      "En el mismo trabajo, ELEGIR entre opciones y fallar no supera a leer. La mecánica de Lecta (4 formas, sin significado y sin corrección del significado) no capitaliza este efecto; la ficha sí puede.",
  },
  {
    id: "R10-pretesting-con-y-sin-demora",
    cuestion:
      "¿El beneficio de intentar recuperar antes de estudiar depende de que el par tenga relación semántica o de que el estudio venga enseguida?",
    cita: {
      autor: "Grimaldi & Karpicke",
      anio: 2012,
      titulo: "When and why do retrieval attempts enhance subsequent encoding?",
      revista: "Memory & Cognition",
      doi: "10.3758/s13421-011-0174-0",
    },
    buscar: "When and why do retrieval attempts enhance subsequent encoding",
    porQue:
      "Delimita el pretesting: ayuda con pares relacionados, no con pares sin relación, y el beneficio desaparece si hay una demora breve entre el intento y el estudio.",
    queAtacar:
      "Lecta trabaja con pares forma-significado de relación arbitraria y la presentación puede llegar mucho después de la captura: no es la condición donde el pretesting funciona.",
  },
  {
    id: "R11-errores-relacionados",
    cuestion:
      "¿El error ayuda solo cuando se acerca a la respuesta correcta?",
    cita: {
      autor: "Huelser & Metcalfe",
      anio: 2012,
      titulo: "Making related errors facilitates learning, but learners do not know it",
      revista: "Memory & Cognition",
      doi: "10.3758/s13421-011-0167-z",
    },
    buscar: "Making related errors facilitates learning but learners do not know it",
    porQue:
      "Con pares sin relación semántica no hubo beneficio de generar el error. Es la condición típica de una palabra desconocida en otro idioma.",
    queAtacar:
      "Que el efecto sea nulo en pares aislados no autoriza a examinar sin presentar: solo quita el argumento a favor del pretest y deja la carga de la prueba en quien lo defiende.",
  },
  {
    id: "R12-pretesting-y-reconocimiento",
    cuestion:
      "¿El pretesting mejora reconocer la respuesta aunque no mejore recordarla con pista?",
    cita: {
      autor: "Seabrooke, Mitchell, Wills, Waters & Hollins",
      anio: 2021,
      titulo:
        "Pretesting boosts recognition, but not cued recall, of targets from unrelated word pairs",
      revista: "Psychonomic Bulletin & Review",
      doi: "10.3758/s13423-020-01810-y",
    },
    buscar: "Pretesting boosts recognition but not cued recall of targets from unrelated word pairs",
    porQue:
      "Separa dos tipos de memoria: elegir entre 4 mide reconocimiento, no recuerdo. Un beneficio en reconocimiento no justifica presentar el repaso como si midiera saber la palabra.",
    queAtacar:
      "La sesión actual mide reconocimiento de FORMA en una oración, no significado. Aun con beneficio de reconocimiento, no es lo que el usuario cree que está practicando.",
  },
];

/* ==========================================================================
   3. Encargo por fases
   Cada fase es implementable sin leer este archivo: objetivo, archivos,
   criterio de aceptación y puerta. La sesión que implementa trabaja F0→F5.
   Orden aprobado por Luis el 2026-10-28.
   ========================================================================== */

export const PHASES = [
  {
    id: "F0",
    titulo: "Corregir el registro del arnés",
    objetivo:
      "Que el arnés no confirme afirmaciones falsas ni dé por buenas citas resueltas a otra obra. No toca el producto.",
    archivos: [
      "scripts/audit-cuaderno.mjs (CLAIMS, RESEARCH, PHASES, resolveQuote)",
      "scripts/audit-cuaderno.test.mjs",
    ],
    aceptacion: [
      "C6 pasa a contexto y ancla la exclusión en idb.ts:1706",
      "C10 ancla «Repaso rápido» (Vocabulary.tsx:2028) y la puerta muerta (Vocabulary.tsx:2170)",
      "resolveQuote consulta el DOI cuando existe y marca DUDOSA si el título no se parece o el año no coincide (±1)",
      "node scripts/audit-cuaderno.mjs --out /tmp/audit-cuaderno sale 0 sin red",
    ],
    riesgo:
      "Ninguno de producto. Un arnés mal calibrado hace que F5 declare corregido lo que no lo está.",
    puerta:
      "pnpm test scripts/audit-cuaderno.test.mjs && node scripts/audit-cuaderno.mjs --out /tmp/audit-cuaderno",
  },
  {
    id: "F1",
    titulo: "Regla: solo se repasa lo que ya se presentó",
    objetivo:
      "Que la sesión sirva únicamente palabras vencidas que pasaron por la ficha o por un repaso real, ordenadas por vencimiento, sin rama de respaldo y con un modo que la palabra puede cumplir.",
    archivos: [
      "src/client/lib/learn.ts (reviewQueue, isWordKnownBy)",
      "src/client/components/Vocabulary.tsx (startAdaptiveFlow, reviewWords)",
    ],
    aceptacion: [
      "reviewQueue excluye lápidas, conocidas, exposición known, reps 0 sin exposición y no vencidas",
      "reviewQueue ordena por priority y luego por vencimiento ascendente",
      "una palabra sin context y con significado entra en modo meaning, no en choose",
      "no queda ninguna rama que llene la cola con palabras no vencidas",
    ],
    riesgo:
      "Quien abría el Cuaderno y siempre encontraba algo para practicar ahora puede ver «Estás al día». Es el comportamiento buscado.",
    puerta:
      "pnpm test src/client/lib/learn.test.ts src/client/components/Vocabulary.test.ts && pnpm typecheck && pnpm lint",
  },
  {
    id: "F2",
    titulo: "Héroe con un solo botón principal y cifras separadas",
    objetivo:
      "Que el botón principal diga qué hace y con cuántas palabras (Aprender / Repasar / Seguir leyendo) y que desaparezcan «Repaso rápido» y el bloque «Por aprender».",
    archivos: [
      "src/client/components/Vocabulary.tsx (nb-hero-cta, título del héroe, notebook-count)",
      "src/client/components/Vocabulary.test.ts",
    ],
    aceptacion: [
      "una prueba por rama: aprender, repasar, al día, sin palabras",
      "en cada rama hay exactamente un .btn--primary dentro de .nb-hero-cta",
      "el encabezado separa «por aprender» de «para repasar»",
      "no queda la promesa «~2 min» ni el botón «Repaso rápido» del héroe",
    ],
    riesgo:
      "Cambia el punto de entrada más usado. Hay que conservar el acceso a la práctica con un solo botón y sin duplicarlo.",
    puerta: "pnpm test src/client/components/Vocabulary.test.ts && pnpm typecheck && pnpm lint",
  },
  {
    id: "F3",
    titulo: "Puente aprender → repasar y salida de la ficha sin significado",
    objetivo:
      "Que al terminar la ficha se ofrezca repasar las palabras que el usuario quiso aprender, y que una ficha sin significado se pueda pasar.",
    archivos: ["src/client/components/Vocabulary.tsx (learn.kept, pantalla de fin, «Pasar por ahora»)"],
    aceptacion: [
      "guardar 2 palabras abre una cola de 2 con «Repasar estas 2 palabras»",
      "con 0 guardadas no aparece el puente",
      "«Pasar por ahora» avanza sin escribir exposición ni tarjeta",
    ],
    riesgo:
      "La pantalla de fin gana un segundo botón; «Ver el cuaderno» debe quedar como acción secundaria.",
    puerta: "pnpm test src/client/components/Vocabulary.test.ts && pnpm typecheck && pnpm lint",
  },
  {
    id: "F4",
    titulo: "Corrección con significado en «Elegir palabra»",
    objetivo:
      "Que tras responder se vea la forma correcta y su significado, y que los distractores sean del mismo idioma que la palabra.",
    archivos: ["src/client/components/Vocabulary.tsx (choiceOptions, rama choose)"],
    aceptacion: [
      "antes de responder el significado no está en pantalla; después sí",
      "con palabras de dos idiomas, las 4 opciones son del idioma de la palabra",
    ],
    riesgo:
      "Aparece texto en el modo choose de todos los flujos (sesión, modo libre y juego por fila). Es intencional.",
    puerta: "pnpm test src/client/components/Vocabulary.test.ts && pnpm typecheck && pnpm lint",
  },
  {
    id: "F5",
    titulo: "Cierre verificado",
    objetivo:
      "Que el arnés registre los defectos como corregidos y que la puerta completa quede en verde con un recorrido real.",
    archivos: [
      "scripts/audit-cuaderno.mjs (afirmaciones tipo corregido)",
      "docs/auditoria/cuaderno/evidencia.md",
      "docs/auditoria/cuaderno/evidencia.json",
    ],
    aceptacion: [
      "pnpm gate en verde con 0 warnings y check:size bajo 215 kB",
      "el arnés sale 0 y las afirmaciones de defecto quedan como CORREGIDO",
      "recorrido en navegador anotado: toques y segundos antes y después",
    ],
    riesgo: "Ninguno: es la puerta de salida. Si algo falla, no se declara cerrado.",
    puerta: "pnpm gate && node scripts/audit-cuaderno.mjs",
  },
];

/* ==========================================================================
   4. Comprobaciones
   ========================================================================== */

function readLines(root, rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  return fs.readFileSync(abs, "utf8").split("\n");
}

function anchorHit(lines, line, expect, window = 3) {
  const re = new RegExp(expect);
  const from = Math.max(1, line - window);
  const to = Math.min(lines.length, line + window);
  for (let n = from; n <= to; n += 1) {
    if (re.test(lines[n - 1])) {
      return { ok: true, line: n, text: lines[n - 1].trim().slice(0, 180) };
    }
  }
  return {
    ok: false,
    excerpt: lines
      .slice(from - 1, to)
      .map((text, i) => `${from + i}: ${text}`)
      .join("\n"),
  };
}

// El Cuaderno ya no vive en un solo archivo (Fase 5 del plan v2): «@notebook»
// expande a Vocabulary.tsx, los componentes de components/notebook/, los hooks
// useNotebook*/useLearn*/useReview*/useHerbario*/usePractice* y el modelo puro.
// «presente» busca en todos y reporta dónde; «ausente» exige que no esté en ninguno.
export function notebookFiles(root) {
  const list = ["src/client/components/Vocabulary.tsx", "src/client/lib/notebook-model.ts"];
  const dir = (rel, test) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs).sort()) {
      if (test(name)) list.push(path.posix.join(rel, name));
    }
  };
  dir("src/client/components/notebook", (n) => /\.tsx$/.test(n) && !/\.test\./.test(n));
  dir("src/client/hooks", (n) =>
    /^use(Notebook|Learn|Review|Herbario|Practice)[A-Za-z]*\.ts$/.test(n) && !/\.test\./.test(n),
  );
  return list;
}

export function runCheck(root, check) {
  if (check.file === "@notebook" && (check.tipo === "presente" || check.tipo === "ausente")) {
    const results = notebookFiles(root).map((file) => runCheck(root, { ...check, file }));
    if (check.tipo === "presente") {
      const hit = results.find((r) => r.estado === "COINCIDE");
      return (
        hit ?? {
          tipo: "presente",
          estado: "NO_COINCIDE",
          detalle: `ningún archivo del Cuaderno contiene /${check.expect}/`,
          evidencia: {},
        }
      );
    }
    const miss = results.find((r) => r.estado === "NO_COINCIDE");
    return (
      miss ?? {
        tipo: "ausente",
        estado: "COINCIDE",
        detalle: `ningún archivo del Cuaderno contiene /${check.pattern}/`,
        evidencia: {},
      }
    );
  }
  const lines = readLines(root, check.file);
  if (check.tipo === "anchor") {
    const hit = anchorHit(lines, check.line, check.expect, check.window ?? 3);
    return hit.ok
      ? {
          tipo: "anchor",
          estado: "COINCIDE",
          detalle: `${check.file}:${hit.line} ~ /${check.expect}/`,
          evidencia: { file: check.file, line: hit.line, text: hit.text },
        }
      : {
          tipo: "anchor",
          estado: "NO_COINCIDE",
          detalle: `${check.file}:${check.line} ±${check.window ?? 3} no contiene /${check.expect}/`,
          evidencia: { excerpt: hit.excerpt },
        };
  }

  // `presente` busca el patrón en todo el archivo y reporta la línea donde
  // está. Es lo que usan las afirmaciones: una línea absoluta se rompe con
  // cualquier edición (pasó tres veces el 2026-10-28) sin que el arreglo haya
  // cambiado. `anchor` sigue existiendo para pruebas de la ventana.
  if (check.tipo === "presente") {
    const re = new RegExp(check.expect);
    for (let n = 1; n <= lines.length; n += 1) {
      if (re.test(lines[n - 1]))
        return {
          tipo: "presente",
          estado: "COINCIDE",
          detalle: `${check.file}:${n} ~ /${check.expect}/`,
          evidencia: { file: check.file, line: n, text: lines[n - 1].trim().slice(0, 180) },
        };
    }
    return {
      tipo: "presente",
      estado: "NO_COINCIDE",
      detalle: `${check.file} no contiene /${check.expect}/`,
      evidencia: {},
    };
  }

  if (check.tipo === "ausente") {
    const re = new RegExp(check.pattern);
    const hits = [];
    for (let n = check.from; n <= Math.min(check.to, lines.length); n += 1) {
      if (re.test(lines[n - 1])) hits.push({ line: n, text: lines[n - 1].trim().slice(0, 160) });
    }
    return hits.length === 0
      ? {
          tipo: "ausente",
          estado: "COINCIDE",
          detalle: `${check.file}:${check.from}-${check.to} no contiene /${check.pattern}/`,
          evidencia: {},
        }
      : {
          tipo: "ausente",
          estado: "NO_COINCIDE",
          detalle: `${check.file}:${check.from}-${check.to} sí contiene /${check.pattern}/`,
          evidencia: { hits },
        };
  }

  if (check.tipo === "orden") {
    const a = anchorHit(lines, check.antes.line, check.antes.expect);
    const b = anchorHit(lines, check.despues.line, check.despues.expect);
    const ok = a.ok && b.ok && a.line < b.line;
    return {
      tipo: "orden",
      estado: ok ? "COINCIDE" : "NO_COINCIDE",
      detalle: ok
        ? `${check.file}:${a.line} (${check.antes.expect}) va antes de :${b.line} (${check.despues.expect})`
        : `${check.file}: orden no verificable o invertido`,
      evidencia: { antes: a, despues: b },
    };
  }

  return {
    tipo: check.tipo,
    estado: "NO_COINCIDE",
    detalle: `tipo de comprobación desconocido: ${check.tipo}`,
    evidencia: {},
  };
}

// Una afirmación «corregido» describe el arreglo: si sus comprobaciones
// coinciden, la corrección sigue en pie; si no, hay una regresión.
const ESTADO_CORREGIDO = {
  CONFIRMADO: "CORREGIDO",
  PARCIAL: "PARCIAL",
  MOVIDO: "REGRESION",
};

export function runClaim(root, claim) {
  const checks = claim.checks.map((check) => runCheck(root, check));
  const ok = checks.filter((c) => c.estado === "COINCIDE").length;
  const base = ok === checks.length ? "CONFIRMADO" : ok === 0 ? "MOVIDO" : "PARCIAL";
  const estado = claim.tipo === "corregido" ? ESTADO_CORREGIDO[base] : base;
  return { ...claim, checks, estado, coincidencias: `${ok}/${checks.length}` };
}

/* ==========================================================================
   5. Citas (solo con --online)
   ========================================================================== */

// Parecido de títulos por palabras compartidas sobre el más corto. No es una
// distancia editorial: sirve para no aceptar como «resuelta» la primera obra
// que devuelve Crossref cuando el título es otro (pasó con R4, R5 y R8).
export function titleSimilarity(a, b) {
  const norm = (text) =>
    String(text ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const wordsA = new Set(norm(a).split(" ").filter(Boolean));
  const wordsB = new Set(norm(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared += 1;
  return shared / Math.min(wordsA.size, wordsB.size);
}

const TITLE_MATCH_MIN = 0.6;
// El año del «issued» de Crossref puede ser el de publicación en línea y no el
// del volumen impreso: se tolera un año de diferencia, pero se reporta exacto.
const YEAR_TOLERANCE = 1;

const CROSSREF_HEADERS = {
  "user-agent": `lecta-${TOOL}/${VERSION} (auditoria; mailto:lecta.audit@example.invalid)`,
};

function crossrefVerdict(top, cita) {
  const anio = top.issued?.["date-parts"]?.[0]?.[0] ?? null;
  const coincideAnio = anio === cita.anio;
  const similitud = titleSimilarity(top.title?.[0], cita.titulo);
  const anioAprox = anio != null && Math.abs(anio - cita.anio) <= YEAR_TOLERANCE;
  const ok = anioAprox && similitud >= TITLE_MATCH_MIN;
  return {
    estado: ok ? "RESUELTA" : "DUDOSA",
    doi: top.DOI ?? null,
    titulo: top.title?.[0] ?? null,
    anio,
    coincideAnio,
    similitud: Number(similitud.toFixed(2)),
    detalle: ok ? undefined : `año ${anio} (cita ${cita.anio}) · título ${similitud.toFixed(2)}`,
    tipo: top.type ?? null,
  };
}

export async function resolveQuote(item) {
  if (typeof fetch !== "function") return { estado: "SIN_FETCH" };
  if (item.cita.sinDoi || item.cita.tipo === "guia") {
    return {
      estado: "SIN_DOI",
      detalle:
        item.cita.tipo === "guia"
          ? "guía de usabilidad, no artículo académico"
          : "capítulo de libro sin DOI",
    };
  }
  try {
    if (item.cita.doi) {
      const res = await fetch(
        `https://api.crossref.org/works/${encodeURIComponent(item.cita.doi)}`,
        { headers: CROSSREF_HEADERS, signal: AbortSignal.timeout(15_000) },
      );
      if (res.status === 404) return { estado: "DOI_NO_ENCONTRADO", detalle: item.cita.doi };
      if (!res.ok) return { estado: "HTTP_ERROR", detalle: `HTTP ${res.status}` };
      const top = (await res.json())?.message;
      if (!top) return { estado: "SIN_RESULTADOS" };
      return crossrefVerdict(top, item.cita);
    }
    const url =
      "https://api.crossref.org/works?rows=3&select=DOI,title,issued,type,author" +
      `&query.bibliographic=${encodeURIComponent(item.buscar)}`;
    const res = await fetch(url, { headers: CROSSREF_HEADERS, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { estado: "HTTP_ERROR", detalle: `HTTP ${res.status}` };
    const body = await res.json();
    const top = body?.message?.items?.[0];
    if (!top) return { estado: "SIN_RESULTADOS" };
    return crossrefVerdict(top, item.cita);
  } catch (error) {
    return { estado: "SIN_RED", detalle: String(error?.message ?? error) };
  }
}

/* ==========================================================================
   6. Render
   ========================================================================== */

const ICON = {
  CONFIRMADO: "✔",
  PARCIAL: "◐",
  MOVIDO: "✘",
  CORREGIDO: "✔",
  REGRESION: "✘",
};

export function renderMarkdown(report) {
  const out = [];
  out.push("# Auditoría del Cuaderno — estudio antes que prueba", "");
  out.push(
    `Generado por \`scripts/${TOOL}.mjs\` v${VERSION} el ${report.generado}. Commit: \`${report.commit ?? "sin git"}\`.`,
    "",
  );
  out.push("## La queja, en palabras del usuario", "");
  out.push(`> ${USER_QUOTE}`, "");
  out.push("## Veredicto", "");
  out.push(
    `- Afirmaciones confirmadas: **${report.resumen.confirmadas}/${report.resumen.total}**` +
      ` · parciales: **${report.resumen.parciales}** · movidas: **${report.resumen.movidas}**` +
      ` · correcciones en pie: **${report.resumen.corregidas ?? 0}**` +
      ` · regresiones: **${report.resumen.regresiones ?? 0}**`,
  );
  const falla =
    report.resumen.movidas > 0 ||
    report.resumen.parciales > 0 ||
    (report.resumen.regresiones ?? 0) > 0;
  out.push(
    `- Código de salida esperado: \`${falla ? 1 : 0}\` (${
      falla
        ? "el código se movió, el defecto ya no está o una corrección desapareció: revisar, no silenciar"
        : "defecto donde decimos y correcciones en su sitio"
    })`,
    "",
  );
  out.push("## Afirmaciones", "");
  out.push("| id | estado | tipo | qué comprueba |");
  out.push("|---|---|---|---|");
  for (const claim of report.claims) {
    out.push(
      `| \`${claim.id}\` | ${ICON[claim.estado] ?? "?"} ${claim.estado} | ${claim.tipo} | ${claim.titulo} |`,
    );
  }
  out.push("");
  for (const claim of report.claims) {
    out.push(`### ${ICON[claim.estado] ?? "?"} \`${claim.id}\``, "");
    out.push(`**${claim.titulo}**`, "");
    out.push(`_Por qué:_ ${claim.porque}`, "");
    for (const check of claim.checks) {
      out.push(`- ${check.estado === "COINCIDE" ? "✔" : "✘"} ${check.detalle}`);
      if (check.evidencia?.text) out.push(`  - \`${check.evidencia.text}\``);
    }
    out.push("");
  }
  out.push("## Preguntas de investigación", "");
  out.push(
    "Verificar en Crossref con `--online`; la existencia no valida la interpretación.",
    "",
  );
  for (const item of report.research) {
    out.push(`### ${item.id}`, "");
    out.push(`**Pregunta:** ${item.cuestion}`, "");
    out.push(
      `**Cita:** ${item.cita.autor} (${item.cita.anio}). *${item.cita.titulo}*. ${item.cita.revista}.`,
      "",
    );
    out.push(`**Por qué importa:** ${item.porQue}`, "");
    out.push(`**Qué atacar:** ${item.queAtacar}`, "");
    if (item.resolucion) {
      const r = item.resolucion;
      out.push(
        r.estado === "RESUELTA"
          ? `**Crossref:** \`${r.doi}\` · ${r.titulo} (${r.anio}) · año ${
              r.coincideAnio ? "coincide" : "coincide ±1"
            } · título ${r.similitud ?? "?"}`
          : `**Crossref:** ${r.estado} ${r.detalle ?? ""}${
              r.titulo ? ` · devolvió: ${r.titulo} (${r.anio})` : ""
            }`,
        "",
      );
    }
  }
  out.push("## Encargo por fases", "");
  for (const phase of report.phases) {
    out.push(`### ${phase.id} — ${phase.titulo}`, "");
    out.push(`**Objetivo:** ${phase.objetivo}`, "");
    out.push("**Archivos:**", "");
    for (const file of phase.archivos) out.push(`- \`${file}\``);
    out.push("", "**Criterio de aceptación:**", "");
    for (const item of phase.aceptacion) out.push(`- ${item}`);
    out.push("", `**Riesgo:** ${phase.riesgo}`, "", `**Puerta:** \`${phase.puerta}\``, "");
  }
  return out.join("\n");
}

export function renderBrief(report) {
  const lineas = [];
  lineas.push("ENCARGO — Auditoría e implementación del Cuaderno de Lecta");
  lineas.push("");
  lineas.push(`Queja textual del usuario: «${USER_QUOTE}»`);
  lineas.push("");
  lineas.push(
    `Estado del arnés: ${report.resumen.confirmadas}/${report.resumen.total} afirmaciones confirmadas, ${report.resumen.movidas} movidas, ${report.resumen.corregidas ?? 0} correcciones en pie, ${report.resumen.regresiones ?? 0} regresiones.`,
  );
  lineas.push(`Reporte completo: ${path.posix.join(DEFAULT_OUT, "evidencia.md")}`);
  lineas.push("");
  lineas.push("Defectos confirmados:");
  for (const claim of report.claims.filter((c) => c.tipo === "defecto")) {
    const first = claim.checks.find((c) => c.evidencia?.file);
    const ref = first ? ` (${first.evidencia.file}:${first.evidencia.line})` : "";
    lineas.push(`- ${claim.id}: ${claim.titulo}${ref}`);
  }
  lineas.push("");
  const corregidas = report.claims.filter((c) => c.tipo === "corregido");
  if (corregidas.length > 0) {
    lineas.push("Correcciones que deben seguir en pie:");
    for (const claim of corregidas) {
      const first = claim.checks.find((c) => c.evidencia?.file);
      const ref = first ? ` (${first.evidencia.file}:${first.evidencia.line})` : "";
      lineas.push(`- ${claim.id}: ${claim.titulo}${ref} → ${claim.estado}`);
    }
    lineas.push("");
  }
  lineas.push("Fases, en orden:");
  for (const phase of report.phases) {
    lineas.push(`- ${phase.id} ${phase.titulo} → puerta: ${phase.puerta}`);
  }
  lineas.push("");
  lineas.push(
    "Regla de oro: ninguna palabra con reps === 0 o sin exposure entra a un reto de recuperación; primero se presenta.",
  );
  return lineas.join("\n");
}

/* ==========================================================================
   7. CLI
   ========================================================================== */

function resolveCommit(root) {
  try {
    const head = fs.readFileSync(path.join(root, ".git/HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head.slice(0, 12);
    const ref = head.slice(5);
    const loose = path.join(root, ".git", ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim().slice(0, 12);
    const packed = fs.readFileSync(path.join(root, ".git/packed-refs"), "utf8");
    const row = packed.split("\n").find((entry) => entry.endsWith(` ${ref}`));
    return row ? row.split(" ")[0].slice(0, 12) : head;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { online: false, json: false, brief: false, quiet: false, out: DEFAULT_OUT, claim: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--online") args.online = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--brief") args.brief = true;
    else if (arg === "--quiet") args.quiet = true;
    else if (arg === "--out") args.out = argv[++i] ?? DEFAULT_OUT;
    else if (arg === "--claim") args.claim = argv[++i] ?? null;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else {
      console.error(`Argumento desconocido: ${arg}`);
      return { error: true };
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) process.exit(2);
  if (args.help) {
    console.log(
      [
        `uso: node scripts/${TOOL}.mjs [--online] [--claim ID] [--json] [--brief] [--out DIR]`,
        "",
        "  --online   resuelve las citas en Crossref (api.crossref.org)",
        "  --claim    filtra por prefijo de id (p. ej. C1)",
        "  --json     vuelca el reporte a stdout",
        "  --brief    imprime el encargo listo para pegar en otra sesión",
        "  --out      directorio de salida (default docs/auditoria/cuaderno)",
      ].join("\n"),
    );
    return;
  }

  const filtro = args.claim;
  const claims = (filtro ? CLAIMS.filter((c) => c.id.startsWith(filtro)) : CLAIMS).map((claim) =>
    runClaim(ROOT, claim),
  );
  if (claims.length === 0) {
    console.error(`Ninguna afirmación coincide con «${filtro}»`);
    process.exit(2);
  }

  const research = RESEARCH.map((item) => ({ ...item }));
  if (args.online) {
    for (const item of research) {
      item.resolucion = await resolveQuote(item);
    }
  }

  const resumen = {
    total: claims.length,
    confirmadas: claims.filter((c) => c.estado === "CONFIRMADO").length,
    parciales: claims.filter((c) => c.estado === "PARCIAL").length,
    movidas: claims.filter((c) => c.estado === "MOVIDO").length,
    corregidas: claims.filter((c) => c.estado === "CORREGIDO").length,
    regresiones: claims.filter((c) => c.estado === "REGRESION").length,
  };

  const report = {
    tool: TOOL,
    version: VERSION,
    generado: new Date().toISOString(),
    commit: resolveCommit(ROOT),
    queja: USER_QUOTE,
    resumen,
    claims,
    research,
    phases: PHASES,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!args.json || args.brief) {
    if (!args.quiet) {
      const markdown = renderMarkdown(report);
      const dir = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "evidencia.md"), `${markdown}\n`);
      fs.writeFileSync(path.join(dir, "evidencia.json"), `${JSON.stringify(report, null, 2)}\n`);

      console.log(
        `audit-cuaderno v${VERSION} · ${resumen.confirmadas}/${resumen.total} confirmadas` +
          ` · ${resumen.parciales} parciales · ${resumen.movidas} movidas` +
          ` · ${resumen.corregidas} correcciones en pie · ${resumen.regresiones} regresiones`,
      );
      for (const claim of claims) {
        console.log(`  ${ICON[claim.estado] ?? "?"} ${claim.estado.padEnd(10)} ${claim.id}`);
      }
      if (args.online) {
        const porEstado = (estado) =>
          research.filter((r) => r.resolucion?.estado === estado).length;
        console.log(
          `  citas resueltas en Crossref: ${porEstado("RESUELTA")}/${research.length}` +
            ` · dudosas: ${porEstado("DUDOSA")} · sin DOI: ${porEstado("SIN_DOI")}`,
        );
      }
      console.log(`  reporte: ${path.posix.join(args.out, "evidencia.md")}`);
    }
    if (args.brief) {
      console.log("\n" + renderBrief(report));
    }
  }

  // Parcial, movida o regresión significa registro desactualizado: hay que
  // revisarlo, no silenciarlo (misma política que audit-investigacion).
  process.exit(
    resumen.movidas > 0 || resumen.parciales > 0 || resumen.regresiones > 0 ? 1 : 0,
  );
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  await main();
}
