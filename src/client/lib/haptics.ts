// Háptica sutil para dispositivos móviles y pantallas táctiles (PWA).
// Basado en el principio de microinteracciones sensoriales de Dan Saffer.
// Inocuo y silencioso si el navegador o dispositivo no lo soporta.

export type HapticStyle = "light" | "selection" | "success" | "gesture";

const HAPTIC_DURATIONS: Record<HapticStyle, number> = {
  light: 8,
  selection: 14,
  gesture: 20,
  success: 28,
};

export function triggerHaptic(
  durationOrStyle: number | number[] | HapticStyle = 12,
) {
  const ms =
    typeof durationOrStyle === "number" || Array.isArray(durationOrStyle)
      ? durationOrStyle
      : (HAPTIC_DURATIONS[durationOrStyle] ?? 12);
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(ms);
    } catch {
      // Ignorar cualquier excepción si el entorno prohíbe vibración
    }
  }
}

export function triggerPurrHaptic() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate([15, 60, 15, 60, 20]);
    } catch {
      // Ignorar cualquier excepción si el entorno prohíbe vibración
    }
  }
}

export function hapticLight(): void {
  triggerHaptic("light");
}

export function hapticSuccess(): void {
  triggerHaptic("success");
}
