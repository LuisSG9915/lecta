export interface HabitTime {
  hour: number;
  minute: number;
  formattedTime: string; // "21:30"
  hasRealData: boolean;
  sampleCount: number;
}

export type SessionInput =
  | number
  | { startedAt: number }
  | { timestamp: number };

const DEFAULT_HOUR = 21;
const DEFAULT_MINUTE = 0;
const MAX_SESSIONS = 14;

/**
 * Extrae la marca de tiempo en milisegundos de un objeto de sesión o número.
 */
function extractTimestamp(session: SessionInput): number | null {
  if (typeof session === "number" && !isNaN(session) && session > 0) {
    return session;
  }
  if (typeof session === "object" && session !== null) {
    if ("startedAt" in session && typeof session.startedAt === "number" && session.startedAt > 0) {
      return session.startedAt;
    }
    if ("timestamp" in session && typeof session.timestamp === "number" && session.timestamp > 0) {
      return session.timestamp;
    }
  }
  return null;
}

/**
 * Obtiene el minuto del día (0 - 1439) en la zona horaria dada.
 */
function getMinuteOfDay(ts: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(new Date(ts));

    let hour = 0;
    let minute = 0;
    for (const part of parts) {
      if (part.type === "hour") hour = parseInt(part.value, 10) % 24;
      if (part.type === "minute") minute = parseInt(part.value, 10);
    }
    return hour * 60 + minute;
  } catch {
    const d = new Date(ts);
    return d.getHours() * 60 + d.getMinutes();
  }
}

/**
 * Calcula la mediana horaria de lectura de las últimas 14 sesiones.
 * Utiliza estadística circular para promediar y mediar correctamente horas que cruzan la medianoche
 * (ej. 23:45 y 00:15 convergen en 00:00, no en 12:00 del mediodía).
 * 
 * Regla: NUNCA usa una hora hardcodeada si existen datos reales del usuario.
 */
export function calculateHabitWindow(
  sessions: SessionInput[],
  timeZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
): HabitTime {
  const validTimestamps = sessions
    .map(extractTimestamp)
    .filter((ts): ts is number => ts !== null && ts > 0)
    .sort((a, b) => a - b);

  if (validTimestamps.length === 0) {
    return {
      hour: DEFAULT_HOUR,
      minute: DEFAULT_MINUTE,
      formattedTime: `${String(DEFAULT_HOUR).padStart(2, "0")}:${String(DEFAULT_MINUTE).padStart(2, "0")}`,
      hasRealData: false,
      sampleCount: 0,
    };
  }

  // Tomar hasta las últimas 14 sesiones de lectura
  const recentSessions = validTimestamps.slice(-MAX_SESSIONS);
  const minutesOfDay = recentSessions.map((ts) => getMinuteOfDay(ts, timeZone));

  // Cálculo angular circular
  let sumSin = 0;
  let sumCos = 0;
  for (const min of minutesOfDay) {
    const theta = (min / 1440) * 2 * Math.PI;
    sumSin += Math.sin(theta);
    sumCos += Math.cos(theta);
  }

  let meanAngle = Math.atan2(sumSin, sumCos);
  if (meanAngle < 0) meanAngle += 2 * Math.PI;
  const circularMeanMinutes = (meanAngle / (2 * Math.PI)) * 1440;

  // Distancia circular relativa al centro para encontrar la mediana exacta
  const relativeMinutes = minutesOfDay.map((min) => {
    let diff = min - circularMeanMinutes;
    while (diff < -720) diff += 1440;
    while (diff > 720) diff -= 1440;
    return { original: min, relative: diff };
  });

  relativeMinutes.sort((a, b) => a.relative - b.relative);

  const mid = Math.floor(relativeMinutes.length / 2);
  let medianMinutes: number;

  if (relativeMinutes.length % 2 === 1) {
    medianMinutes = Math.round(circularMeanMinutes + relativeMinutes[mid].relative);
  } else {
    const avgRel = (relativeMinutes[mid - 1].relative + relativeMinutes[mid].relative) / 2;
    medianMinutes = Math.round(circularMeanMinutes + avgRel);
  }

  // Normalizar a 0 - 1439
  while (medianMinutes < 0) medianMinutes += 1440;
  medianMinutes = medianMinutes % 1440;

  const hour = Math.floor(medianMinutes / 60) % 24;
  const minute = medianMinutes % 60;

  return {
    hour,
    minute,
    formattedTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    hasRealData: true,
    sampleCount: recentSessions.length,
  };
}
