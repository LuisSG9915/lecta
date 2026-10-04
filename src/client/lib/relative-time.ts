const DAY_MS = 86_400_000;

const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

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
