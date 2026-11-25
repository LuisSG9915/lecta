// Presupuestos por hora y por alcance: cada función IA gasta de su
// propia bolsa (columna scope de lecta_rate_log), así una tanda de
// ítems o de correcciones no consume la cuota de enriquecimiento.
export const ITEM_UNITS_PER_HOUR = 24;
export const VERIFY_UNITS_PER_HOUR = 30;
export const EXPLAIN_UNITS_PER_HOUR = 30;
export const EVALUATE_UNITS_PER_HOUR = 40;
export const STORY_UNITS_PER_HOUR = 20;
export const PAGE_RECAP_UNITS_PER_HOUR = 40;
export const TRANSLATE_UNITS_PER_HOUR = 60;
export const COMPANION_NOTE_UNITS_PER_HOUR = 12;

// Scopes de lecta_ai_quota que dispara la persona (1 unidad = 1 uso). Fuera
// quedan `free-courtesy` y el enriquecimiento de fondo, que no pidió.
export const USER_AI_SCOPES = [
  "explain",
  "page-recap",
  "translate",
  "evaluate",
  "story",
  "companion-note",
] as const;
