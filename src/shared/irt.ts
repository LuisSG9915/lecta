/**
 * Funciones matemáticas unificadas de Teoría de Respuesta al Ítem (IRT - 2PL).
 */

/**
 * Probabilidad de respuesta según el modelo logístico 2PL:
 * P(conoce | theta, b_i) = 1 / (1 + exp(-alpha * (theta - b_i)))
 *
 * Devuelve exactamente 0.50 cuando theta === difficulty.
 */
export function itemResponseProbability(
  theta: number,
  difficulty: number,
  discrimination = 1.35,
): number {
  return 1 / (1 + Math.exp(-discrimination * (theta - difficulty)));
}

/**
 * Información de Fisher para un ítem dicotómico 2PL:
 * I_i(theta) = alpha^2 * P * (1 - P)
 *
 * Alcanza su valor máximo en theta === difficulty (donde P = 0.50).
 */
export function itemFisherInformation(
  theta: number,
  difficulty: number,
  discrimination = 1.35,
): number {
  const p = itemResponseProbability(theta, difficulty, discrimination);
  return discrimination * discrimination * p * (1 - p);
}
