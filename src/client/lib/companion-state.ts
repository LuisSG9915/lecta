// Estados del gato acompañante DURANTE la lectura — distinto del
// «humor» de largo plazo de gamification.ts (catMood mide días sin
// actividad para el gato del Cuaderno). Es una máquina pura: el
// lector le envía señales con sello de tiempo y ella decide el
// estado visible, así las transiciones se prueban sin montar
// componentes ni depender de relojes.
//
//   sleep ──book_opened──▶ reading ──10 min seguidos──▶ deep_focus
//     ▲                      │  ▲                        │
//     │                      ▼  │ consulta               │ consulta
//     │                    curious ──────────────────────┘
//     │                      │
//     │      fatigue_detected → yawn ──────┐
//     │      goal_completed → celebrating ─┤ caducan → reading
//     └──── 5 min sin señales o book_closed ┘

export type CompanionState =
  | "sleep"
  | "reading"
  | "deep_focus"
  | "curious"
  | "yawn"
  | "celebrating";

export type CompanionSignal =
  | { kind: "book_opened"; at: number }
  | { kind: "book_closed"; at: number }
  // Actividad de lectura real: vuelta de página o tramo de scroll.
  | { kind: "reading_activity"; at: number }
  | { kind: "word_consulted"; at: number }
  | { kind: "fatigue_detected"; at: number }
  | { kind: "goal_completed"; at: number }
  // Latido periódico sin actividad: caduca transitorios y duerme.
  | { kind: "tick"; at: number };

export type CompanionMachine = {
  state: CompanionState;
  // Instante en que entró al estado actual; mide los transitorios.
  enteredAt: number;
  // Última señal de actividad lectora; el latido no la refresca.
  lastActiveAt: number;
  // Inicio del tramo de lectura continua: toda consulta o pausa lo
  // reinicia — deep_focus siempre es «racha sin distracción».
  readingSince: number;
};

// Minutos de lectura continua que coronan en concentración profunda.
export const DEEP_FOCUS_AFTER_MS = 10 * 60_000;
// Duración de los estados transitorios antes de volver a «reading».
export const CURIOUS_MS = 8_000;
export const YAWN_MS = 12_000;
export const CELEBRATE_MS = 10_000;
// Sin señales por este rato (o al cerrar el libro) el gato duerme.
// Es más lento que el corte de actividad de lectura (IDLE_MS = 90 s):
// una pausa corta para pensar no lo acuesta.
export const SLEEP_AFTER_IDLE_MS = 5 * 60_000;

const enter = (
  state: CompanionState,
  at: number,
  lastActiveAt: number,
  readingSince: number,
): CompanionMachine => ({ state, enteredAt: at, lastActiveAt, readingSince });

export function initialCompanion(now: number): CompanionMachine {
  return { state: "sleep", enteredAt: now, lastActiveAt: now, readingSince: now };
}

export function reduceCompanion(
  m: CompanionMachine,
  sig: CompanionSignal,
): CompanionMachine {
  if (sig.kind === "book_closed")
    return enter("sleep", sig.at, m.lastActiveAt, m.readingSince);
  if (sig.kind === "book_opened") return enter("reading", sig.at, sig.at, sig.at);

  // Solo el latido acuesta al gato: una señal de actividad real que
  // llega después de un rato largo lo despierta, no lo duerme.
  if (
    sig.kind === "tick" &&
    m.state !== "sleep" &&
    sig.at - m.lastActiveAt >= SLEEP_AFTER_IDLE_MS
  )
    return enter("sleep", sig.at, m.lastActiveAt, m.readingSince);

  // Toda señal que no es latido cuenta como actividad del lector.
  const lastActiveAt = sig.kind === "tick" ? m.lastActiveAt : sig.at;

  // Los transitorios caducan y vuelven a lectura; el tramo continuo
  // empieza de nuevo porque la consulta o el bostezo rompieron la
  // racha.
  const dwell =
    m.state === "curious"
      ? CURIOUS_MS
      : m.state === "yawn"
        ? YAWN_MS
        : m.state === "celebrating"
          ? CELEBRATE_MS
          : undefined;
  const cur =
    dwell !== undefined && sig.at - m.enteredAt >= dwell
      ? enter("reading", sig.at, lastActiveAt, sig.at)
      : { ...m, lastActiveAt };

  switch (sig.kind) {
    case "reading_activity":
      if (cur.state === "sleep")
        return enter("reading", sig.at, lastActiveAt, sig.at);
      break;
    case "word_consulted":
      // Otra consulta alarga la curiosidad sin cambiar de estado.
      if (cur.state === "curious") return { ...cur, enteredAt: sig.at };
      if (cur.state !== "yawn" && cur.state !== "celebrating")
        return { ...cur, state: "curious", enteredAt: sig.at };
      break;
    case "fatigue_detected":
      if (
        cur.state === "reading" ||
        cur.state === "deep_focus" ||
        cur.state === "curious"
      )
        return { ...cur, state: "yawn", enteredAt: sig.at };
      break;
    case "goal_completed":
      // La meta cumplida celebra desde cualquier estado de lectura.
      return { ...cur, state: "celebrating", enteredAt: sig.at };
  }

  // La racha continua corona en concentración profunda; aplica igual
  // justo después de resolver un transitorio caducado.
  if (
    cur.state === "reading" &&
    sig.at - cur.readingSince >= DEEP_FOCUS_AFTER_MS
  )
    return { ...cur, state: "deep_focus", enteredAt: sig.at };
  return cur;
}
