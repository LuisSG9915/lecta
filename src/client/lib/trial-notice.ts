// Avisos del fin de la prueba inversa (docs/designs/2026-11-25-monetizacion-lecta-plus.md, F5/F6).
// Lógica pura: sin React; el almacenamiento tolera su ausencia.
import { accountFetch } from "./account-fetch";
import { captureDbScope, getActiveUserId } from "./idb";

const DAY_MS = 86_400_000;
// Las marcas van por cuenta: en un navegador compartido el descarte de una no
// apaga el aviso de otra.
const owner = () => getActiveUserId() ?? "anon";
const seenKey = () => `lecta:trial-end-seen:${owner()}`;
const dismissKey = (day: number) => `lecta:trial-warning:${owner()}:${day}`;

/** Texto común del aviso, la hoja y el Carné: lo que queda en Gratis. */
export const FREE_AFTER_TRIAL = "3 explicaciones con IA al día, sin nube ni Kindle. Tus palabras y tu gato se quedan.";

export type TrialSummary = {
  aiUses: number;
  wordsSaved: number;
  cloudBooks: number;
  kindleLinked: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Una línea por cifra distinta de 0; lo que vale 0 se omite. */
export function trialFigures(summary: TrialSummary | null): string[] {
  if (!summary) return [];
  const lines: string[] = [];
  if (summary.aiUses > 0) lines.push(`Usaste la IA ${plural(summary.aiUses, "vez", "veces")}.`);
  if (summary.wordsSaved > 0) lines.push(`Guardaste ${plural(summary.wordsSaved, "palabra", "palabras")}.`);
  if (summary.cloudBooks > 0) {
    lines.push(
      summary.cloudBooks === 1 ? "1 libro vive en la nube." : `${summary.cloudBooks} libros viven en la nube.`,
    );
  }
  if (summary.kindleLinked) lines.push("Vinculaste tu Kindle.");
  return lines;
}

/** Cifras reales del uso; null si la red o el servidor fallan (nunca lanza). */
export async function fetchTrialSummary(): Promise<TrialSummary | null> {
  try {
    const res = await accountFetch("/api/account/trial-summary", undefined, captureDbScope());
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as Partial<TrialSummary> | null;
    if (!data) return null;
    return {
      aiUses: Number(data.aiUses) || 0,
      wordsSaved: Number(data.wordsSaved) || 0,
      cloudBooks: Number(data.cloudBooks) || 0,
      kindleLinked: data.kindleLinked === true,
    };
  } catch {
    return null;
  }
}

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
export const isTrialEndSeen = () => read(seenKey());
export const markTrialEndSeen = () => write(seenKey());

/** La hoja del día 15: solo con prueba vencida, sin marca de vista, sin libro ni enlace directo. */
export function shouldShowTrialEnd(opts: {
  trialEndedAt: number | null | undefined;
  bookOpen: boolean;
  deepLinkPending: boolean;
}): boolean {
  return Boolean(opts.trialEndedAt) && !opts.bookOpen && !opts.deepLinkPending && !isTrialEndSeen();
}
