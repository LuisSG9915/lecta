import type { LexiconEntry } from "./lexicon";
import type { MarkLevel } from "./word-level";
import type { PresentedReason } from "./idb";
import { predictSection } from "./knowledge";
import { preparationAnswerKey, type PreparationRow } from "./preparation";

// Utilidades puras del lector predictivo: preparan entradas para
// predictSection (knowledge.ts) y para la tarjeta «Antes de leer».

// Formas que en la sección aparecen SIEMPRE con inicial mayúscula y
// nunca en minúscula: suelen ser nombres propios o extranjerismos.
// predictSection las trata como cualquier otra, pero no gastan el
// lote automático de definiciones con IA. `surfaceForms` son las
// formas únicas tal como salieron del segmentador (con su caja
// original); el resultado va en minúsculas.
export function capitalOnlyForms(surfaceForms: string[]): Set<string> {
  const capitalized = new Set<string>();
  const lowercased = new Set<string>();
  for (const surface of surfaceForms) {
    const first = surface.charAt(0);
    if (!first) continue;
    const lower = surface.toLowerCase();
    // Si el primer carácter no cambia al bajar a minúsculas, la
    // aparición cuenta como «en minúsculas» (incluye dígitos y
    // caracteres sin caja): nunca entra a capitalOnly.
    if (first.toLowerCase() === first) lowercased.add(lower);
    else capitalized.add(lower);
  }
  const result = new Set<string>();
  for (const form of capitalized) if (!lowercased.has(form)) result.add(form);
  return result;
}

// Primera oración del texto que contiene la forma como palabra
// completa (sin distinguir mayúsculas). Sirve de contexto para la
// ficha y el guardado cuando la palabra se toca desde la tarjeta,
// donde no hay un punto del texto que indique la oración.
export function firstSentenceWith(
  text: string,
  form: string,
  language = "es",
): string | undefined {
  const lower = form.toLowerCase();
  const words = new Intl.Segmenter(language, { granularity: "word" });
  for (const sentence of new Intl.Segmenter(language, { granularity: "sentence" }).segment(text)) {
    for (const part of words.segment(sentence.segment)) {
      if (part.isWordLike && part.segment.toLowerCase() === lower)
        return sentence.segment.trim();
    }
  }
  return undefined;
}

// ¿La forma guardada entra al grupo «por aprender» de la preparación?
// Niveles nuevos/aprendiendo, y también una asentada que el lector
// declaró desconocida: la evidencia explícita manda sobre el nivel de
// la tarjeta — entra sin tocar su estabilidad ni su card. Un
// «ya la conozco» la saca del grupo sea cual sea el nivel; una
// dominada (sin nivel) no pasa por aquí — la forma no está en el
// mapa de guardadas y la predice la regla de evidencia de
// predictSection.
export function preparationLearning(
  level: "new" | "learning" | "settled" | null | undefined,
  evidence: { known: boolean } | undefined,
): boolean {
  if (evidence?.known === true) return false;
  if (level === "new" || level === "learning") return true;
  return level === "settled" && evidence?.known === false;
}

// Mapa de evidencia por lema en minúsculas, como lo espera
// predictSection: consulta por lema de la ficha o por la forma misma.
export function toKnowledgeMap(
  rows: readonly { lemma: string; known: boolean }[],
): Map<string, { lemma: string; known: boolean }> {
  const map = new Map<string, { lemma: string; known: boolean }>();
  for (const row of rows) {
    const lemma = row.lemma.toLowerCase();
    map.set(lemma, { lemma, known: row.known });
  }
  return map;
}

// ---------- Filas de la preparación ----------

// Fila de la hoja: la PreparationRow completa vive aparte (por clave)
// para armar evidencia al confirmar; aquí va lo que se muestra y por
// qué se eligió — `reason` alimenta el historial de trayecto.
export type SuggestionRow = {
  key: string;
  form: string;
  lemma?: string | null;
  pos?: string | null;
  meaning?: string;
  context?: string;
  learning?: boolean;
  reason: PresentedReason;
  zipf?: number | null;
};

export type SuggestionRows = {
  // Selección principal: predichas (raras o explícitas) y «por
  // aprender». Son las que piden respuesta al entrar.
  rows: SuggestionRow[];
  // Consulta secundaria: el catálogo no tiene ficha o medición para
  // decidir — se ofrecen colapsadas, sin declararlas raras ni comunes.
  uncertain: SuggestionRow[];
  // Candidatas que no cupieron en la selección principal: la hoja las
  // ofrece en una consulta aparte — no se descartan ni se declaran
  // conocidas por el recorte.
  deferred: SuggestionRow[];
};

// Tope de filas de la consulta secundaria (la lista puede ser larga
// en capítulos con muchas formas fuera del catálogo).
export const UNCERTAIN_ROWS_CAP = 40;

// Tope global de la selección principal: incluye predichas, formas
// sin ficha declaradas y palabras ya guardadas. Lo que no cabe va a
// `deferred` — jamás «40 predichas más las aprendiendo ilimitadas».
export const PREPARATION_ROWS_CAP = 40;

// Construye las filas de la hoja desde un análisis listo: predichas
// con ficha, las que ya están en el Cuaderno («aprendiendo») y, en la
// bandeja secundaria, lo que el catálogo no sabe medir. Las formas
// solo capitalizadas sin ficha (nombres propios, extranjerismos como
// «Billy») quedan fuera — siguen consultables en el texto, pero no
// son vocabulario que se prepare. La evidencia explícita
// «no la conozco» manda sobre todo lo demás: entra a la selección
// principal aunque la forma no tenga ficha.
export function buildSuggestionRows(input: {
  language: string;
  forms: string[];
  entries: Record<string, LexiconEntry[]>;
  capitalOnly: ReadonlySet<string>;
  text: string;
  saved: ReadonlyMap<string, MarkLevel>;
  knowledge: ReadonlyMap<string, { lemma: string; known: boolean }>;
  threshold: number;
  // Datos léxicos completos por clave: los necesita el confirmar para
  // armar evidencia y palabras sin volver a buscarlos.
  lex?: Map<string, PreparationRow>;
}): SuggestionRows {
  const { language, forms, entries, capitalOnly, text, saved, knowledge, threshold, lex } = input;
  const prediction = predictSection(
    forms,
    entries,
    new Set(saved.keys()),
    knowledge,
    threshold,
  );
  // La selección principal se arma por prioridad: evidencia
  // desconocida primero, «por aprender» después y rareza al final.
  // Dentro de cada grupo se conserva el orden de llegada (las
  // candidatas ya vienen ordenadas por rareza).
  const explicit: SuggestionRow[] = [];
  const learning: SuggestionRow[] = [];
  const rarity: SuggestionRow[] = [];
  const uncertain: SuggestionRow[] = [];
  // Una sola candidata por clave de respuesta (lema): dos formas del
  // mismo lema serían dos filas con la misma evidencia.
  const seenKeys = new Set<string>();
  const pushRow = (
    row: PreparationRow,
    extras: { learning?: boolean; reason: PresentedReason; zipf?: number | null },
  ) => {
    const key = preparationAnswerKey(language, row);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const target =
      extras.reason === "explicit_unknown"
        ? explicit
        : extras.reason === "learning"
          ? learning
          : extras.reason === "rarity"
            ? rarity
            : uncertain;
    target.push({
      key,
      form: row.form,
      lemma: row.lemma,
      pos: row.pos,
      meaning: row.meaning,
      context: row.context,
      learning: extras.learning,
      reason: extras.reason,
      zipf: extras.zipf,
    });
    if (lex && !lex.has(key)) lex.set(key, row);
  };

  // Las claves de evidencia son lemas en minúsculas; la forma puede
  // venir capitalizada («Billy» se guarda como «billy»).
  const evidenceFor = (form: string, lemma?: string | null) =>
    knowledge.get(lemma ?? form) ??
    knowledge.get(form) ??
    knowledge.get(form.toLowerCase());
  const knownExplicitly = (form: string, lemma?: string | null) =>
    evidenceFor(form, lemma)?.known === true;
  const unknownExplicitly = (form: string, lemma?: string | null) =>
    evidenceFor(form, lemma)?.known === false;

  // Candidatas con ficha: las predichas y las que el tope interno
  // dejó diferidas compiten aquí por los lugares principales — una
  // explícita de poca rareza jamás pierde su lugar contra una rara
  // sin evidencia solo por el orden de la lista.
  for (const item of [...prediction.predicted, ...prediction.deferred]) {
    const entry = item.entry;
    const sense = entry.senses[0];
    pushRow(
      {
        form: item.form,
        lemma: entry.lemma,
        pos: entry.pos,
        meaning: sense?.definition,
        context: firstSentenceWith(text, item.form, language),
        senseEntryId: entry.entryId,
        senseOrder: sense?.senseOrder,
      },
      {
        reason: unknownExplicitly(item.form, entry.lemma)
          ? "explicit_unknown"
          : "rarity",
        zipf: entry.zipf,
      },
    );
  }
  // Palabras del capítulo ya en el Cuaderno: nuevas/aprendiendo, y
  // también asentadas declaradas desconocidas — la evidencia manda
  // sin tocar su tarjeta. Conocidas y dominadas se excluyen; un
  // «no la conozco» sobre una dominada no pasa por aquí — la predice
  // la regla de evidencia. Con respuesta explícita cuentan en el
  // grupo de evidencia, no en el de repaso.
  for (const form of forms) {
    const level = saved.get(form);
    if (level == null) continue;
    const entry = entries[form]?.[0];
    const evidence = knowledge.get(entry?.lemma ?? form) ?? knowledge.get(form);
    if (!preparationLearning(level, evidence)) continue;
    const sense = entry?.senses[0];
    pushRow(
      {
        form,
        lemma: entry?.lemma,
        pos: entry?.pos,
        meaning: sense?.definition,
        context: firstSentenceWith(text, form, language),
        senseEntryId: entry?.entryId,
        senseOrder: sense?.senseOrder,
      },
      {
        learning: true,
        reason:
          evidence?.known === false ? "explicit_unknown" : "learning",
        zipf: entry?.zipf,
      },
    );
  }
  // Catálogo sin información suficiente: fichas sin medición y formas
  // sin ficha. Con evidencia explícita van a la selección principal;
  // declaradas conocidas se omiten; el resto ofrece consulta
  // secundaria. Los nombres solo capitalizados se descartan.
  const pushUncertain = (form: string, entry?: LexiconEntry) => {
    const explicit = unknownExplicitly(form, entry?.lemma);
    // Un «no la conozco» manda sobre el filtro de nombres: si el
    // lector la declara, la forma entra aunque parezca nombre propio.
    if (capitalOnly.has(form) && !explicit) return;
    if (knownExplicitly(form, entry?.lemma)) return;
    if (!explicit && uncertain.length >= UNCERTAIN_ROWS_CAP) return;
    const sense = entry?.senses[0];
    pushRow(
      {
        form,
        lemma: entry?.lemma,
        pos: entry?.pos,
        meaning: sense?.definition,
        context: firstSentenceWith(text, form, language),
        senseEntryId: entry?.entryId,
        senseOrder: sense?.senseOrder,
      },
      {
        reason: explicit ? "explicit_unknown" : "catalog_uncertain",
        zipf: entry?.zipf ?? null,
      },
    );
  };
  for (const item of prediction.uncertain) pushUncertain(item.form, item.entry);
  for (const form of prediction.missing) pushUncertain(form);
  // Corte global: 40 lugares por prioridad (evidencia, aprendiendo,
  // rareza); el resto queda consultable en la lista diferida.
  const all = [...explicit, ...learning, ...rarity];
  return {
    rows: all.slice(0, PREPARATION_ROWS_CAP),
    uncertain,
    deferred: all.slice(PREPARATION_ROWS_CAP),
  };
}
