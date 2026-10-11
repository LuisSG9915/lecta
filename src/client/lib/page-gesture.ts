export type TapZone = "prev" | "center" | "next";

export type SwipeClaim = "pending" | "swipe" | "cancel";

export interface SwipeOutcomeParams {
  dx: number;
  velocity: number;
  width: number;
}

/**
 * Determina la zona de toque según la posición horizontal dentro del visor.
 * 25% por lado para navegación (prev/next), 50% central para alternar barras.
 */
export function tapZone(x: number, rect: { left: number; width: number }): TapZone {
  if (rect.width <= 0) return "center";
  const ratio = (x - rect.left) / rect.width;
  if (ratio < 0.25) return "prev";
  if (ratio > 0.75) return "next";
  return "center";
}

/**
 * Evalúa si el movimiento califica como gesto horizontal de cambio de página.
 * Reclama cuando |dx| > 10px y |dx| > 1.3·|dy|.
 * Cancela si el gesto se orienta predominantemente vertical o no cumple el ángulo.
 * Permanece "pending" mientras el desplazamiento acumulado no alcance el umbral mínimo.
 */
export function claimSwipe(
  dx: number,
  dy: number,
  minDistance = 10,
  angleRatio = 1.3,
): SwipeClaim {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < minDistance && absY < minDistance) {
    return "pending";
  }
  if (absX >= minDistance && absX > absY * angleRatio) {
    return "swipe";
  }
  return "cancel";
}

/**
 * Resistencia elástica en los extremos del libro (primera página hacia atrás
 * o última página hacia adelante). Aplica factor ×0.35.
 */
export function rubberBand(dx: number, factor = 0.35): number {
  return Math.round(dx * factor);
}

/**
 * Decide si el deslizamiento confirma el paso de página (-1, 0, 1) para goPage.
 * Retorna:
 *  1: avanzar página (arrastre hacia la izquierda, dx < 0)
 * -1: retroceder página (arrastre hacia la derecha, dx > 0)
 *  0: cancelar y volver a la página actual
 *
 * Confirma si supera el 25% del ancho del visor o si la velocidad > 0.4 px/ms con |dx| > 30px.
 */
export function swipeOutcome({ dx, velocity, width }: SwipeOutcomeParams): -1 | 0 | 1 {
  const absX = Math.abs(dx);
  const speed = Math.abs(velocity);
  const distanceThreshold = width > 0 ? width * 0.25 : 80;
  const isDistanceConfirmed = absX > distanceThreshold;
  const isVelocityConfirmed = speed > 0.4 && absX > 30;

  if (isDistanceConfirmed || isVelocityConfirmed) {
    return dx < 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Calcula la duración de la animación de asentamiento (160–320 ms),
 * ajustando según la distancia remanente y la velocidad previa.
 */
export function settleDuration(remainingDistance: number, velocity: number): number {
  const dist = Math.abs(remainingDistance);
  const speed = Math.abs(velocity);
  if (speed > 0) {
    const calculated = dist / speed;
    return Math.round(Math.min(320, Math.max(160, calculated)));
  }
  // Si no venía con velocidad (arrastre estático que se soltó),
  // escala linealmente con la distancia remanente entre 180ms y 260ms.
  const ratio = Math.min(1, dist / 300);
  return Math.round(180 + ratio * 80);
}
