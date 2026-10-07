// Háptica sutil para dispositivos móviles y pantallas táctiles (PWA).
// Basado en el principio de microinteracciones sensoriales de Dan Saffer.
// Inocuo y silencioso si el navegador o dispositivo no lo soporta.

export function triggerHaptic(durationMs = 12) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(durationMs);
    } catch {
      // Ignorar cualquier excepción si el entorno prohíbe vibración
    }
  }
}
