// Traduce el θ del ajuste rápido a una etiqueta entendible para la
// pantalla de resultado y Cuenta. No es un diagnóstico psicométrico:
// solo orienta qué tanto vocabulario reconoció la persona en la
// prueba de 15 segundos.

export type VocabLevel = "broad" | "medium" | "developing";

// θ de Rasch en [-2.5, 2.5]: 0.8 separa «reconoce casi todo» de un
// nivel medio, y -0.8 marca la frontera «aún en desarrollo».
export function vocabLevelOf(theta: number): VocabLevel {
  if (theta >= 0.8) return "broad";
  if (theta >= -0.8) return "medium";
  return "developing";
}

export const VOCAB_LEVEL_LABEL: Record<VocabLevel, string> = {
  broad: "amplio",
  medium: "medio",
  developing: "en desarrollo",
};

// «amplio» | «medio» | «en desarrollo» a partir del θ del CAT.
// Ojo: knowledge.ts tiene un vocabLevelLabel() homónimo para el
// umbral Zipf — son escalas distintas a propósito.
export function catLevelLabel(theta: number): string {
  return VOCAB_LEVEL_LABEL[vocabLevelOf(theta)];
}
