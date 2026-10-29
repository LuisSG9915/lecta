import { deleteAccountDb } from "./idb";
import { clearSyncCursors } from "./sync-cursors";
import { pauseSync, resumeSync } from "./sync-state";

export async function startFromScratch(userId: string, authToken?: string): Promise<void> {
  // 1. Pausar el motor de sincronización para evitar subidas fantasma desde el outbox
  pauseSync?.();

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

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `Error del servidor (${response.status})`);
    }

    // 3. Reutilizar deleteAccountDb para destruir IndexedDB local (libros, palabras, outbox)
    await deleteAccountDb(userId);

    // 4. Reutilizar clearSyncCursors para reiniciar los cursores incrementales
    clearSyncCursors(userId);

    // 5. Limpiar claves locales de sesión de lectura/caché sin borrar las credenciales de auth
    if (typeof localStorage !== "undefined") {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith(`lecta:last-book:${userId}`) ||
            key.startsWith(`lecta:companion:${userId}`) ||
            key.startsWith(`lecta:onboarding:${userId}`) ||
            key.startsWith("lecta:location:") ||
            key.startsWith("lecta:tts-landing:") ||
            key.startsWith("lecta:reader:") ||
            key.startsWith("lecta:reading-goal") ||
            key.startsWith("lecta:cat_calibrated:") ||
            key.startsWith("lecta:cat_skipped:") ||
            key.startsWith("lecta:calibration-done:") ||
            key.startsWith("lecta:calibration-banner-dismissed") ||
            key.startsWith("lecta_onboarding_dismissed") ||
            key.startsWith("lecta:user_theta:"))
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    }
  } finally {
    // 6. Reactivar sync (o recargar la aplicación limpia)
    resumeSync?.();
  }
}
