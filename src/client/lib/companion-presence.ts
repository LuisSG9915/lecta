// Planificador PURO de la presencia del gato en el lector (fase 5):
// decide cuándo se ve según el modo «readingPresence» de la cuenta.
// Sin React ni reloj propio — el lector envía señales con sello de
// tiempo (`at`) y el planificador decide; así toda la tabla se prueba
// con tiempos falsos y nada depende de timers reales.
//
// Solo cuenta tiempo de actividad ELEGIBLE: los deltas llegan por
// `active(ms)` desde señales reales del lector (scroll, página,
// consulta), nunca por el simple paso del reloj de pestaña. Las
// pausas — hoja/panel/consulta (`overlay`), pestaña oculta
// (`hidden`), inactividad (`idle`) — congelan el acumulado sin dejar
// «deuda» al volver; el foco profundo difiere las visitas sin
// acumular, y al salir la espera continúa desde donde quedó.

import type { CompanionState } from "./companion-state";
import type { ReadingPresence } from "../../shared/companion-data";

export interface PresenceController {
  // ¿Se dibuja el gato ahora mismo?
  readonly visible: boolean;
  // La visita abierta es el saludo de bienvenida (para la pose).
  readonly greeting: boolean;
  // Bienvenida al abrir el libro: asoma un momento sin esperar el
  // acumulado elegible y sin gastar el cooldown de visitas. Una por
  // libro (reset la vuelve a armar); si hay una capa encima queda
  // pendiente y saluda cuando la lectura se libera.
  greet(at?: number): void;
  // El lector hizo algo que amerita respuesta (consulta, meta,
  // fatiga): si el gato está guardado asoma un momento a reaccionar.
  // No pide elegible ni gasta el cooldown; enfriamiento propio. Si
  // una capa la tapa al nacer (la ficha de la propia consulta) queda
  // pendiente y responde al liberarse mientras el momento sea fresco.
  react(at?: number): void;
  // Tiempo elegible ganado: delta entre señales reales, ya acotado
  // por el llamador (un hueco largo no cuenta completo).
  active(ms: number, at?: number): void;
  // Hay una hoja/panel/consulta encima de la lectura.
  overlay(open: boolean, at?: number): void;
  // La pestaña está oculta.
  hidden(isHidden: boolean, at?: number): void;
  // No hay segmento de lectura vivo (entre lectura y reposo).
  idle(isIdle: boolean, at?: number): void;
  // La lectura quedó lista y los controles están disponibles.
  ready(on: boolean, at?: number): void;
  // Estado de la máquina local de lectura (deep_focus difiere visitas).
  machine(state: CompanionState, at?: number): void;
  // Supresión temporal del usuario («Ocultar por esta lectura»):
  // silencia gato y festejos hasta que se cierre el libro; no toca la
  // preferencia de la cuenta y el acceso voluntario sigue.
  suppress(on: boolean, at?: number): void;
  // Cambio del modo de la cuenta: se aplica inmediatamente.
  mode(next: ReadingPresence, at?: number): void;
  // Latido del reloj: cierra la visita cuando su duración se cumple.
  tick(at?: number): void;
  // Reinicia el estado por libro (apertura/cierre del lector).
  reset(at?: number): void;
}

// Tabla cerrada por modo (ms). «always» no usa visitas: está presente
// siempre que la lectura esté lista. «off» nunca muestra nada.
const FIRST_VISIT_AFTER_MS = {
  visits: 60_000,
  playful: 30_000,
} as const;
const VISIT_DURATION_MS = { visits: 15_000, playful: 15_000 } as const;
const VISIT_COOLDOWN_MS = {
  visits: 3 * 60_000,
  playful: 90_000,
} as const;
// El saludo de bienvenida al abrir el libro: visita corta inmediata
// que no depende del acumulado elegible ni descuenta el cooldown.
const GREET_VISIT_MS = 10_000;
// Reacción a un momento del lector (consulta de palabra, meta del día,
// fatiga): visita corta que no pide elegible ni gasta el cooldown de
// visitas; su enfriamiento propio en reloj evita el acoso.
const REACT_VISIT_MS = 10_000;
const REACT_COOLDOWN_MS = 90_000;
// Una consulta abre su ficha en el mismo gesto que la señal: la capa
// corta la reacción recién abierta (o llega ya tapada). En vez de
// perderse queda pendiente y responde al liberarse — con un tope:
// pasado el momento ya no reacciona a algo viejo.
const REACT_CUT_MS = 2_000;
const REACT_STALE_MS = 30_000;

export function createPresence(options: {
  mode: ReadingPresence;
  // Se llama solo cuando `visible` o `greeting` cambian de verdad.
  onChange?: (visible: boolean, greeting: boolean) => void;
  // Reloj inyectable para pruebas; por defecto el de la app.
  now?: () => number;
}): PresenceController {
  const now = options.now ?? (() => Date.now());
  let mode = options.mode;
  let suppressed = false;
  let overlay = false;
  let hidden = false;
  let idle = true;
  let ready = false;
  let machine: CompanionState = "sleep";
  // Tiempo elegible acumulado y elegible donde cerró la última visita
  // (el cooldown se mide en tiempo elegible, no en reloj de pared).
  let eligible = 0;
  let lastEndEligible: number | null = null;
  // Fin de la visita abierta, en reloj de pared — y lo que le quedaba
  // cuando una pausa la interrumpió (capa, oculto, inactividad): la
  // capa pausa la presencia, no la mata; al liberarse retoma lo suyo.
  let visitEndsAt: number | null = null;
  let visitRemain: number | null = null;
  // Fin del saludo de bienvenida: visita aparte que no toca el
  // cooldown elegible, un solo saludo por libro, pendiente para
  // cuando la lectura se libere y remanente si lo pausó una capa.
  let greetEndsAt: number | null = null;
  let greetRemain: number | null = null;
  let greeted = false;
  let greetPending = false;
  // Visita de reacción, su sello de apertura (para detectar el corte
  // al nacer), remanente si una capa la pausó a la mitad, la
  // pendiente esperando a que la capa se libere y su enfriamiento —
  // todo en reloj de pared.
  let reactEndsAt: number | null = null;
  let reactOpenedAt = 0;
  let reactRemain: number | null = null;
  let reactPending: number | null = null;
  let lastReactAt = -Infinity;
  let visible = false;
  let greeting = false;

  // Lo que tapa la lectura apaga la presencia. Se distingue lo
  // deliberado — «Ocultar por esta lectura» y modo «off» terminan lo
  // abierto para siempre — de lo transitorio — capas, pestaña oculta
  // y lectura no lista solo lo PAUSAN y lo retoman al liberarse.
  const killedBy = () => suppressed || mode === "off";
  const pausedBy = () => overlay || hidden || !ready;
  const blocked = () => killedBy() || pausedBy();
  // Una visita abierta además se interrumpe si el lector queda
  // inactivo; el foco profundo no la corta, solo impide iniciar otra.
  const visitInterrupted = () => blocked() || idle;
  const canStartVisit = () =>
    !visitInterrupted() && machine !== "deep_focus";

  const setPresence = (nextVisible: boolean, nextGreeting: boolean) => {
    if (nextVisible === visible && nextGreeting === greeting) return;
    visible = nextVisible;
    greeting = nextGreeting;
    options.onChange?.(visible, greeting);
  };

  const endVisit = () => {
    if (visitEndsAt === null) return;
    visitEndsAt = null;
    // La separación hasta la próxima corre en tiempo elegible desde
    // este cierre.
    lastEndEligible = eligible;
  };

  const evaluate = (at: number) => {
    // Un saludo pedido bajo una capa no se pierde: queda pendiente y
    // abre apenas la lectura se libera.
    if (greetPending && !blocked()) {
      greetPending = false;
      greetEndsAt = at + GREET_VISIT_MS;
    }
    // Caducan por reloj; lo deliberado las termina; una capa solo las
    // PAUSA guardando lo que quedaba (sin descontar cooldown elegible).
    // La inactividad no pausa saludo ni reacción: son respuestas a un
    // gesto reciente.
    if (greetEndsAt !== null && at >= greetEndsAt) greetEndsAt = null;
    else if (greetEndsAt !== null && killedBy()) {
      greetEndsAt = null;
      greetRemain = null;
    } else if (greetEndsAt !== null && pausedBy()) {
      greetRemain = greetEndsAt - at;
      greetEndsAt = null;
    }
    if (reactEndsAt !== null && at >= reactEndsAt) reactEndsAt = null;
    else if (reactEndsAt !== null && killedBy()) {
      reactEndsAt = null;
      reactRemain = null;
    } else if (reactEndsAt !== null && pausedBy()) {
      reactRemain = reactEndsAt - at;
      // Cortada al nacer por la ficha de la propia consulta: merece
      // ventana completa al volver, no un resto de milisegundos.
      if (at - reactOpenedAt < REACT_CUT_MS) {
        reactPending = reactOpenedAt;
        reactRemain = null;
      }
      reactEndsAt = null;
    }
    // La visita vence por su duración; lo deliberado la cierra con el
    // cooldown desde ya; una pausa (capa, oculto, inactividad) guarda
    // lo que le quedaba y el cooldown corre desde el cierre real.
    if (visitEndsAt !== null && at >= visitEndsAt) endVisit();
    else if (visitEndsAt !== null && killedBy()) endVisit();
    else if (visitEndsAt !== null && visitInterrupted()) {
      visitRemain = visitEndsAt - at;
      visitEndsAt = null;
    }
    // Lo pausado retoma al liberarse, antes de abrir visitas nuevas:
    // primero se termina lo empezado.
    if (!blocked()) {
      if (greetEndsAt === null && greetRemain !== null) {
        greetEndsAt = at + greetRemain;
        greetRemain = null;
      }
      if (reactEndsAt === null && reactRemain !== null) {
        reactEndsAt = at + reactRemain;
        reactRemain = null;
      }
    }
    if (
      !visitInterrupted() &&
      visitEndsAt === null &&
      visitRemain !== null
    ) {
      visitEndsAt = at + visitRemain;
      visitRemain = null;
    }
    if (
      (mode === "visits" || mode === "playful") &&
      visitEndsAt === null &&
      canStartVisit()
    ) {
      const due =
        eligible >=
        (lastEndEligible === null
          ? FIRST_VISIT_AFTER_MS[mode]
          : lastEndEligible + VISIT_COOLDOWN_MS[mode]);
      if (due) visitEndsAt = at + VISIT_DURATION_MS[mode];
    }
    // La reacción pendiente responde cuando la lectura queda libre y
    // sin otra visita encima — va tras el bloque de visitas para ver
    // ya cerrada la que venza en este mismo latido —, mientras el
    // momento siga fresco; pasado el tope se descarta.
    if (reactPending !== null) {
      if (at - reactPending > REACT_STALE_MS) {
        reactPending = null;
      } else if (
        !blocked() &&
        visitEndsAt === null &&
        greetEndsAt === null &&
        reactEndsAt === null
      ) {
        reactPending = null;
        reactOpenedAt = at;
        reactEndsAt = at + REACT_VISIT_MS;
      }
    }
    const show =
      !blocked() &&
      (mode === "always" ||
        visitEndsAt !== null ||
        greetEndsAt !== null ||
        reactEndsAt !== null);
    setPresence(show, show && greetEndsAt !== null);
  };

  return {
    get visible() {
      return visible;
    },
    get greeting() {
      return greeting;
    },
    greet(at = now()) {
      // Una bienvenida por libro: el guard es aquí para que llamarlo
      // de nuevo (re-render, sección nueva) no reinicie el saludo. Si
      // hay una capa encima queda pendiente hasta que la libere.
      if (greeted) return;
      greeted = true;
      greetPending = true;
      evaluate(at);
    },
    react(at = now()) {
      // El enfriamiento es el único descarte seco: todo lo demás
      // (capa encima, visita o saludo abiertos) deja el momento
      // pendiente para responder cuando quede libre y fresco.
      if (at - lastReactAt < REACT_COOLDOWN_MS) return;
      lastReactAt = at;
      if (
        blocked() ||
        visitEndsAt !== null ||
        greetEndsAt !== null ||
        greetPending
      ) {
        reactPending = at;
        return;
      }
      reactOpenedAt = at;
      reactEndsAt = at + REACT_VISIT_MS;
      evaluate(at);
    },
    active(ms, at = now()) {
      // Solo el tiempo elegible cuenta: ni pausado ni en foco
      // profundo; así no hay «deuda» al volver.
      if (ms > 0 && !blocked() && !idle && machine !== "deep_focus")
        eligible += ms;
      evaluate(at);
    },
    overlay(open, at = now()) {
      overlay = open;
      evaluate(at);
    },
    hidden(isHidden, at = now()) {
      hidden = isHidden;
      evaluate(at);
    },
    idle(isIdle, at = now()) {
      idle = isIdle;
      evaluate(at);
    },
    ready(on, at = now()) {
      ready = on;
      evaluate(at);
    },
    machine(state, at = now()) {
      machine = state;
      evaluate(at);
    },
    suppress(on, at = now()) {
      suppressed = on;
      evaluate(at);
    },
    mode(next, at = now()) {
      mode = next;
      evaluate(at);
    },
    tick(at = now()) {
      evaluate(at);
    },
    reset(at = now()) {
      // Todo por libro: el acumulado, la visita, el saludo, las
      // reacciones y la supresión.
      eligible = 0;
      lastEndEligible = null;
      visitEndsAt = null;
      visitRemain = null;
      greetEndsAt = null;
      greetRemain = null;
      greeted = false;
      greetPending = false;
      reactEndsAt = null;
      reactRemain = null;
      reactPending = null;
      lastReactAt = -Infinity;
      suppressed = false;
      idle = true;
      evaluate(at);
    },
  };
}
