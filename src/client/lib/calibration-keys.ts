// Claves de sesión de calibración sin dependencias del modelo IRT ni lexicon.

// Marca «la prueba ya se ofreció» en el almacén de sesión por cuenta;
// sin ella se vuelve a ofrecer antes de entrar al primer libro.
export const CALIBRATION_DONE_KEY = "calibrationDone";
// Borrador de respuestas mientras la prueba está abierta: un cierre
// accidental no las pierde — se restauran en la próxima oferta.
export const CALIBRATION_DRAFT_KEY = "calibrationDraft";

export function calibrationDoneKey(language = "es"): string {
  return language === "es" ? CALIBRATION_DONE_KEY : `${CALIBRATION_DONE_KEY}:${language}`;
}

export function calibrationDraftKey(language = "es"): string {
  return language === "es" ? CALIBRATION_DRAFT_KEY : `${CALIBRATION_DRAFT_KEY}:${language}`;
}
