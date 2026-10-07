// Tip de lectura con IA: contrato compartido entre el worker
// (/api/lexicon/tip) y el cliente (lib/tips.ts). Viajan solo
// agregados numéricos y ajustes — jamás texto del libro, título ni
// historial crudo. Base del diseño: docs/concentracion-y-lectura.md §4.

// Acciones que la tarjeta puede ejecutar de verdad; «none» es un tip
// solo informativo. Enum cerrado: el servidor lo valida y el cliente
// lo traduce a botones — nunca se confía en una etiqueta libre del
// modelo.
export const TIP_ACTIONS = ["none", "focus_ruler", "syntactic"] as const;
export type TipAction = (typeof TIP_ACTIONS)[number];

// Un día de lectura agregado (DayFocus del cliente, reducido a lo que
// el consejo necesita ver).
export type TipDayStats = {
  // Día local «AAAA-MM-DD» del lector.
  dayKey: string;
  // Minutos con la sección en pantalla (dwell), redondeados.
  minutes: number;
  // Retrocesos de página o sección.
  regressions: number;
  // Palabras consultadas.
  consults: number;
  // Avisos de fatiga emitidos ese día.
  fatigue: number;
  // Ritmo estimado en palabras por minuto; 0 = muestra insuficiente.
  wpm: number;
};

// Contexto que el cliente envía: agregados de los últimos ≤14 días.
export type TipContext = {
  // Día local en que se pide; también sirve de clave de cadencia y
  // de caché en el servidor.
  dayKey: string;
  // Hora local 0-23.
  localHour: number;
  // Días naturales desde el último día con lectura (≥60 s).
  daysSinceLastRead: number;
  // Más reciente primero.
  days: TipDayStats[];
  focusMode: string;
  weeklyGoalDays: number | null;
};

// Lo que la ruta devuelve. tip null = la IA eligió silencio, que es
// un resultado válido y preferible a un consejo genérico.
export type TipResponse = {
  tip: string | null;
  action: TipAction;
  version: string;
};
