// Qué cuenta como palabra candidata a vocabulario. Compartido entre
// el segmentador (worker), el análisis de capítulo y la hoja de
// preparación para que ningún token espurio —dígitos, puntuación
// residual, siglas cortas— llegue a sugerirse.

// Solo letras del español (con tildes, ñ y ü) y al menos tres
// caracteres: «1», «10», «3,5», «sí», «él» o «a1b» no son
// vocabulario que se aprende.
const WORD_TOKEN = /^[a-záéíóúüñ]{3,}$/i;

export function isWordToken(form: string): boolean {
  return WORD_TOKEN.test(form.trim());
}

// Raíces candidatas de un adverbio en «-mente»: la base sin el
// sufijo («perfectamente» → «perfecta») y, si termina en -a, la forma
// masculina del lema («perfecta» → «perfecto») por si la tabla de
// formas no enlaza el femenino. Bases de menos de tres letras se
// descartan («mente» misma queda en «», «demente» en «de») — no hay
// adjetivo tan corto que derive adverbios.
export function menteBaseForms(form: string): string[] {
  if (!form.endsWith("mente")) return [];
  const root = form.slice(0, -"mente".length);
  if (root.length < 3) return [];
  return root.endsWith("a") ? [root, `${root.slice(0, -1)}o`] : [root];
}
