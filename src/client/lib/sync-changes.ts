// Sonda de cambios (docs/designs/2026-11-24-sonda-de-cambios-sync.md).
// runFullSync pide /api/sync/changes una vez por ciclo; cada pull consulta
// canSkipPull antes de descargar. Saltar es seguro solo si el último
// synced_at del servidor no pasa el cursor de pull de esa clave: el cursor
// no se mueve al saltar, así que una escritura posterior a la sonda se
// descarga en el ciclo siguiente. El push de lo local nunca se salta.
import { accountFetch } from "./account-fetch";
import type { DbScope } from "./idb";

/** Una sonda vale para el ciclo que la pidió, no para los siguientes. */
export const SYNC_CHANGES_TTL_MS = 30_000;

let snapshot: { userId: string; stamps: Record<string, number>; at: number } | null = null;

/** Pide la sonda y la publica; ante cualquier fallo la borra (todo se descarga). */
export async function primeSyncChanges(userId: string, scope?: DbScope): Promise<void> {
  snapshot = null;
  try {
    const response = await accountFetch("/api/sync/changes", undefined, scope);
    if (!response.ok) return;
    const data = (await response.json().catch(() => null)) as { stamps?: unknown } | null;
    if (!data?.stamps || typeof data.stamps !== "object") return;
    const stamps: Record<string, number> = {};
    for (const [key, value] of Object.entries(data.stamps as Record<string, unknown>)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) stamps[key] = n;
    }
    snapshot = { userId, stamps, at: Date.now() };
  } catch {
    snapshot = null;
  }
}

/** Claves que cubre la sonda: una ausente significa «sin filas» solo en estas. */
const PROBED_KEYS = new Set(["annotations", "activity", "reviews", "positions", "knowledge"]);
const isProbed = (key: string) => PROBED_KEYS.has(key) || /^vocab:[^:]+$/.test(key);

const fresh = (userId: string, now: number) =>
  snapshot !== null && snapshot.userId === userId && now - snapshot.at <= SYNC_CHANGES_TTL_MS;

/**
 * true = el servidor no tiene nada nuevo para `key` desde `since`. Sin sonda
 * fresca, sin cursor (primer pull) o con un sello mayor, hay que descargar.
 */
export function canSkipPull(userId: string, key: string, since: number, now = Date.now()): boolean {
  if (!fresh(userId, now) || !(since > 0) || !isProbed(key)) return false;
  return (snapshot!.stamps[key] ?? 0) <= since;
}

/** Idiomas con palabras en el servidor según la sonda (para no perder uno nuevo). */
export function syncChangeLanguages(userId: string, now = Date.now()): string[] {
  if (!fresh(userId, now)) return [];
  return Object.keys(snapshot!.stamps)
    .filter((key) => key.startsWith("vocab:"))
    .map((key) => key.slice("vocab:".length))
    .filter(Boolean);
}

export function clearSyncChanges(): void {
  snapshot = null;
}
