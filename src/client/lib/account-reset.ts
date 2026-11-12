import { deleteAccountDb, isDbScopeActive, setDbUser, type DbScope } from "./idb";
import { clearSyncCursors } from "./sync-cursors";
import { pauseSync, resumeSync } from "./sync-state";
import {
  clearAccountLocalKeys,
  readLocalResetMarker,
  writeLocalResetMarker,
} from "./account-cleanup";
import { clearPendingPositions } from "./positions-sync";
import { clearReadingSyncQueues } from "./reading-sync";
import { resetGameCache } from "./game";
import { registerAccountResetHandler, accountFetch } from "./account-fetch";
import { savePlan } from "./account-plan";

// ---------- Vaciar la copia local porque el servidor ya no la tiene ----------
//
// Cuando otro dispositivo corre «borrar los datos de mi cuenta», el
// servidor guarda un sello (reset_at) en lecta_account_state — sobrevive
// al DELETE justamente para esto. Cualquier dispositivo cuya marca local
// sea más vieja tiene una copia obsoleta: si la empujara, resucitaría
// lo que la persona acababa de borrar. `applyRemoteReset` es la mitad
// local del protocolo: vaciar todo ANTES de que salga otra escritura.
// Devuelve false cuando IndexedDB no se pudo borrar (otra pestaña la
// retiene): la marca no se escribe y el próximo ciclo reintenta — las
// escrituras mientras tanto rebotan en el servidor con 409.

export async function applyRemoteReset(
  userId: string,
  resetAt: number,
): Promise<boolean> {
  pauseSync();
  try {
    // Colas en memoria primero: llevan datos ya muertos que un flush
    // tardío (pagehide, debounce) empujaría con la marca ya nueva.
    clearPendingPositions();
    clearReadingSyncQueues();

    // Destruye la base de la cuenta (cierra la conexión y sube la
    // generación del DbScope: los syncs en vuelo abortan solos).
    const removed = await deleteAccountDb(userId);
    if (!removed) return false;

    clearSyncCursors(userId);
    clearAccountLocalKeys(userId);
    // La foto del juego en memoria pertenece a la copia muerta.
    resetGameCache();

    // Marca reconocida ANTES de reactivar la base: cualquier fetch
    // posterior ya declara el sello nuevo y el servidor lo acepta.
    writeLocalResetMarker(userId, resetAt);
    lastResetCheckAt = Date.now();

    // deleteAccountDb dejó activa la base anónima: reactivar la cuenta
    // vacía para que lo que sigue (sync, escrituras) aterrice donde debe.
    await setDbUser(userId);
    return true;
  } finally {
    resumeSync();
  }
}

// ---------- Chequeo proactivo del sello ----------
//
// Cubre el caso del dispositivo que solo baja datos: sin empujar nada,
// el 409 nunca le llega y vería su copia muerta indefinidamente. Se
// consulta al entrar sesión, al arrancar un ciclo completo y en el ciclo
// del compañero — amortiguado a una consulta por minuto.
const RESET_CHECK_MIN_MS = 60_000;
let lastResetCheckAt = 0;
let resetCheckInflight: Promise<boolean> | null = null;

export async function checkRemoteReset(
  scope: DbScope,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  const userId = scope?.userId;
  if (!userId || !isDbScopeActive(scope)) return false;
  if (!opts.force && Date.now() - lastResetCheckAt < RESET_CHECK_MIN_MS) {
    return false;
  }
  if (resetCheckInflight) return resetCheckInflight;

  resetCheckInflight = (async () => {
    try {
      const response = await accountFetch("/api/account/state", undefined, scope);
      if (!response.ok || !isDbScopeActive(scope)) return false;
      const data = (await response.json().catch(() => null)) as {
        resetAt?: unknown;
      } | null;
      // El mismo cuerpo trae el plan (027): se publica sin pedirlo dos veces.
      await savePlan(userId, data, scope);
      const remote = Number(data?.resetAt);
      if (!Number.isFinite(remote) || remote <= readLocalResetMarker(userId)) {
        lastResetCheckAt = Date.now();
        return false;
      }
      return await applyRemoteReset(userId, remote);
    } catch {
      return false;
    } finally {
      resetCheckInflight = null;
    }
  })();
  return resetCheckInflight;
}

// ---------- «Empezar de cero» pedido por la propia persona ----------

export async function startFromScratch(userId: string, authToken?: string): Promise<void> {
  // 1. Pausar el motor de sincronización para evitar subidas fantasma desde el outbox
  pauseSync?.();
  // Las colas en memoria también llevan datos pre-reset: un flush tardío
  // (debounce, pagehide) los empujaría con la marca nueva y resucitaría
  // lo que la persona acaba de borrar — incluso en este mismo dispositivo.
  clearPendingPositions();
  clearReadingSyncQueues();
  resetGameCache();

  try {
    // 2. Solicitar al backend el borrado de BD remota y purgeR2Prefix
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-lecta-user-id": userId,
    };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const response = await fetch("/api/account/reset", {
      method: "POST",
      headers,
      credentials: "include",
    });

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      resetAt?: string;
      resetAtMs?: number;
    };
    if (!response.ok) {
      throw new Error(body.error || `Error del servidor (${response.status})`);
    }

    // El sello que el servidor acaba de escribir: esta copia local va a
    // quedar vacía, así que ya está al día con ese reinicio — y las
    // escrituras futuras lo declaran en x-lecta-reset. Se guarda solo si
    // el borrado local funcionó: si IndexedDB quedó retenida por otra
    // pestaña, la copia vieja sigue ahí y declarar la marca nueva la
    // dejaría resucitar lo borrado; sin ella, el siguiente push rebota
    // con 409 y el vaciado corre por esa vía.
    const serverResetAt =
      Number(body.resetAtMs) || Date.parse(body.resetAt ?? "") || 0;

    // 3. Reutilizar deleteAccountDb para destruir IndexedDB local (libros, palabras, outbox)
    const removed = await deleteAccountDb(userId);
    if (removed && serverResetAt > 0) writeLocalResetMarker(userId, serverResetAt);

    // 4. Reutilizar clearSyncCursors para reiniciar los cursores incrementales
    clearSyncCursors(userId);

    // 5. Limpiar claves locales de sesión de lectura/caché sin borrar las credenciales de auth
    clearAccountLocalKeys(userId);
  } finally {
    // 6. Reactivar sync (o recargar la aplicación limpia)
    resumeSync?.();
  }
}

// La respuesta 409 del guardia del servidor dispara el mismo vaciado:
// cubre un push que se cuela entre el reset remoto y el próximo chequeo.
registerAccountResetHandler(applyRemoteReset);
