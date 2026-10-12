const DAY_MS = 86_400_000;

const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// Días naturales completos desde un instante (0 = hoy, 1 = ayer).
// El marcador de retomar lo usa como umbral y como dato del evento.
export function daysAgo(ts: number, now = Date.now()): number {
  return Math.max(
    0,
    Math.floor((startOfDay(now) - startOfDay(ts)) / DAY_MS),
  );
}

// «hoy», «ayer», «hace 3 días», «hace 2 semanas», «hace 1 mes».
export function relativeDay(ts: number, now = Date.now()): string {
  const days = Math.floor((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  const rtf = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });
  if (days < 30) return rtf.format(-Math.floor(days / 7), "week");
  if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}

// «hoy», «mañana», «pasado mañana», «dentro de 3 días», «dentro de 2 semanas»...
export function futureRelativeDay(ts: number, now = Date.now()): string {
  const days = Math.floor((startOfDay(ts) - startOfDay(now)) / DAY_MS);
  if (days <= 0) return "hoy";
  if (days === 1) return "mañana";
  if (days === 2) return "pasado mañana";
  const rtf = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });
  if (days < 7) return rtf.format(days, "day");
  if (days < 30) return rtf.format(Math.floor(days / 7), "week");
  if (days < 365) return rtf.format(Math.floor(days / 30), "month");
  return rtf.format(Math.floor(days / 365), "year");
}

// «hace un momento», «hace 3 min», «hace 2 h», y para más de un día
// cae a relativeDay. Pensado para «Sincronizado hace…» en Cuenta.
export function timeAgo(ts: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - ts) / 60_000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (startOfDay(ts) === startOfDay(now)) return `hace ${hours} h`;
  return relativeDay(ts, now);
}

// Intervalo corto para las calificaciones del repaso: «10 min»,
// «6 h», «4 d», «2 meses».
export function formatInterval(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "mes" : "meses"}`;
}
