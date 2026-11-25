// Avisos del fin de la prueba inversa (docs/designs/2026-11-25-monetizacion-lecta-plus.md, F5/F6).
// Lógica pura: sin React; el almacenamiento tolera su ausencia.
const DAY_MS = 86_400_000;
const SEEN_KEY = "lecta:trial-end-seen";
const dismissKey = (day: number) => `lecta:trial-warning:${day}`;

/** 3, 2 o 1 según el tiempo que queda (techo en días); fuera de ese rango, null. */
export function trialNoticeDay(trialEndsAt: number | null | undefined, now: number): 1 | 2 | 3 | null {
  if (trialEndsAt == null || !Number.isFinite(trialEndsAt)) return null;
  const left = trialEndsAt - now;
  if (left <= 0) return null;
  const days = Math.ceil(left / DAY_MS);
  return days === 1 || days === 2 || days === 3 ? days : null;
}

export function formatTrialDate(ms: number): string {
  return new Date(ms).toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function write(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* sin almacenamiento: el aviso vuelve en la próxima visita */
  }
}

export const isTrialNoticeDismissed = (day: number) => read(dismissKey(day));
export const dismissTrialNotice = (day: number) => write(dismissKey(day));
export const isTrialEndSeen = () => read(SEEN_KEY);
export const markTrialEndSeen = () => write(SEEN_KEY);

/** La hoja del día 15: solo con prueba vencida, sin marca de vista, sin libro ni enlace directo. */
export function shouldShowTrialEnd(opts: {
  trialEndedAt: number | null | undefined;
  bookOpen: boolean;
  deepLinkPending: boolean;
}): boolean {
  return Boolean(opts.trialEndedAt) && !opts.bookOpen && !opts.deepLinkPending && !isTrialEndSeen();
}
