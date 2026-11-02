import { clearSyncCursors } from "./sync-cursors";
export { clearSyncCursors };

// Clave del marcador local que recuerda que se pidió borrar la cuenta.
export const PENDING_DELETE_KEY = "lecta:pending-delete";

export type PendingDeleteDecision = {
  cleanupUserId?: string;
  clearMarker: boolean;
};

// Decide qué hacer con el marcador de borrado pendiente. La base local
// solo se limpia cuando el correo de confirmación redirigió aquí con
// «cuenta=eliminada»; cerrar sesión, que la sesión siga cargando o un
// enlace vencido no bastan para tocar los datos.
export function decidePendingDelete(input: {
  confirmed: boolean;
  urlError?: string;
  pendingUserId: string | null;
  sessionUserId?: string;
}): PendingDeleteDecision {
  if (!input.pendingUserId) return { clearMarker: false };
  if (input.confirmed && !input.sessionUserId) {
    return { cleanupUserId: input.pendingUserId, clearMarker: true };
  }
  if (input.urlError) return { clearMarker: true };
  return { clearMarker: false };
}

// ---------- Sello del reinicio remoto ----------
//
// `lecta:account-reset:<userId>` guarda el `reset_at` más nuevo que este
// dispositivo ya reconoció (epoch ms). Viaja en la cabecera
// `x-lecta-reset` de cada escritura: si el servidor la supera, la copia
// local quedó vieja y hay que vaciarla — así otro dispositivo no
// resucita lo que la persona acabó de borrar.

const RESET_MARKER_PREFIX = "lecta:account-reset:";

export function readLocalResetMarker(userId: string | null | undefined): number {
  if (!userId || typeof localStorage === "undefined") return 0;
  const stamp = Number(localStorage.getItem(`${RESET_MARKER_PREFIX}${userId}`));
  return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
}

export function writeLocalResetMarker(
  userId: string | null | undefined,
  stamp: number,
): void {
  if (!userId || typeof localStorage === "undefined") return;
  const value = Number(stamp);
  if (!Number.isFinite(value) || value <= 0) return;
  // El sello solo avanza: una respuesta vieja jamás lo hace retroceder.
  if (value <= readLocalResetMarker(userId)) return;
  try {
    localStorage.setItem(`${RESET_MARKER_PREFIX}${userId}`, String(value));
  } catch {
    // Modo privado o cuota llena: el próximo ciclo lo reintenta.
  }
}

// Prefijos de localStorage ligados a la cuenta que un borrado completo
// —sea local (`startFromScratch`) o aprendido del servidor— debe
// descartar. Las credenciales de auth y el sello de reinicio quedan
// fuera a propósito: el sello es justo lo que recuerda que el borrado
// ya se aplicó aquí.
const ACCOUNT_LOCAL_PREFIXES: ReadonlyArray<(userId: string) => string> = [
  (u) => `lecta:last-book:${u}`,
  (u) => `lecta:companion:${u}`,
  (u) => `lecta:onboarding:${u}`,
  () => "lecta:location:",
  () => "lecta:tts-landing:",
  () => "lecta:reader:",
  () => "lecta:reading-goal",
  () => "lecta:cat_calibrated:",
  () => "lecta:cat_skipped:",
  () => "lecta:calibration-done:",
  () => "lecta:calibration-banner-dismissed",
  () => "lecta_onboarding_dismissed",
  () => "lecta:user_theta:",
];

export function clearAccountLocalKeys(userId: string): void {
  if (typeof localStorage === "undefined") return;
  const prefixes = ACCOUNT_LOCAL_PREFIXES.map((make) => make(userId));
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}
