// Funciones puras para el rincón del compañero: cálculo de coordenadas
// en el escenario, clasificación de gestos (toque/frotar vs levantar),
// generación de destinos de paseo y predicado de disponibilidad.

import type { CatMood } from "./gamification";
import type { CareKind } from "./companion-interactions";

export function clampX(x: number): number {
  if (Number.isNaN(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

export function xFromPointer(
  clientX: number,
  rect: { left: number; width: number },
): number {
  if (rect.width <= 0) return 0.5;
  return clampX((clientX - rect.left) / rect.width);
}

export type GestureClass = "pending" | "rub" | "lift";

export interface GestureParams {
  elapsedMs: number;
  movedPx: number;
  liftThresholdMs?: number;
  moveThresholdPx?: number;
}

export function classifyGesture({
  elapsedMs,
  movedPx,
  liftThresholdMs = 220,
  moveThresholdPx = 6,
}: GestureParams): GestureClass {
  if (movedPx > moveThresholdPx && elapsedMs < liftThresholdMs) {
    return "rub";
  }
  if (elapsedMs >= liftThresholdMs) {
    return "lift";
  }
  return "pending";
}

export function nextWanderTarget(rand: number, currentX: number): number {
  const clamped = clampX(currentX);
  const minTarget = 0.08;
  const maxTarget = 0.92;
  const minDistance = 0.2;

  // Si está muy a la derecha, debe volver a la izquierda
  if (clamped > 0.65) {
    const maxLeft = Math.max(minTarget, clamped - minDistance);
    return clampX(minTarget + rand * (maxLeft - minTarget));
  }
  // Si está muy a la izquierda, debe ir a la derecha
  if (clamped < 0.35) {
    const minRight = Math.min(maxTarget, clamped + minDistance);
    return clampX(minRight + rand * (maxTarget - minRight));
  }
  // En el centro: rand < 0.5 va a la izquierda; >= 0.5 va a la derecha
  if (rand < 0.5) {
    const sub = rand * 2;
    const maxLeft = Math.max(minTarget, clamped - minDistance);
    return clampX(minTarget + sub * (maxLeft - minTarget));
  } else {
    const sub = (rand - 0.5) * 2;
    const minRight = Math.min(maxTarget, clamped + minDistance);
    return clampX(minRight + sub * (maxTarget - minRight));
  }
}

export function walkDuration(dx: number): number {
  const dist = Math.abs(dx);
  return Math.round(700 + Math.min(1, dist) * 1500);
}

export interface CanWanderParams {
  mood: CatMood;
  activeCare: CareKind | null;
  reducedMotion: boolean;
  dragging: boolean;
  hidden: boolean;
  idleMs: number;
  inCloset?: boolean;
  tryOn?: boolean;
}

export function canWander(params: CanWanderParams): boolean {
  if (params.mood === "asleep") return false;
  if (params.activeCare !== null) return false;
  if (params.reducedMotion) return false;
  if (params.dragging) return false;
  if (params.hidden) return false;
  if (params.idleMs < 5000) return false;
  if (params.inCloset || params.tryOn) return false;
  return true;
}
