// Marcador de la última cuenta confirmada en este dispositivo. Sirve
// para dos cosas sin tocar la red: abrir la estantería al instante y
// mostrar la base local correcta cuando no hay conexión (la sesión
// remota sigue mandando en cuanto responde; si dice otra cuenta o
// «sin sesión», la app cambia de base con las protecciones de scope).
//
// Vive en localStorage y no en la base por cuenta: es justo la pieza
// que decide QUÉ base abrir, así que no puede guardarse dentro. No es
// dato de respaldo ni migra entre cuentas — solo un apuntador local.
// Nunca autoriza nada: toda petición sigue llevando la cookie real.

const LAST_USER_KEY = "lecta:last-user";

export function loadLastUserId(): string | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function saveLastUserId(userId: string) {
  try {
    localStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    /* sin almacenamiento no hay marcador; la app sigue funcionando */
  }
}

export function clearLastUserId() {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    /* igual: el fallo no debe notarse */
  }
}
