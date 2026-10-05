import { batchLookup, type LexiconEntry } from "./lexicon";

// Modelo de conocimiento del lector: qué palabras conoce. Dos piezas
// puras y deterministas:
//   · estimateProfile — el umbral zipf que mejor separa la evidencia
//     «conozco / no conozco» recogida (calibración y actos del lector);
//   · predictSection — qué formas de una sección conviene preparar,
//     combinando cuaderno, evidencia explícita y rareza medida.

// ---------- Perfil léxico ----------

export type KnowledgeEvidence = { zipf: number | null; known: boolean };

export type VocabProfile = {
  threshold: number;
  confidence: "low" | "mid" | "high";
};

// Sin evidencia el perfil arranca en el «Normal» histórico de las
// sugerencias (zipf < 3.0 se consideraba rara para preparar).
const DEFAULT_THRESHOLD = 3.0;

// Candidatos a umbral en pasos de 0.5 (las «bandas» del plan). Al
// empatar en errores gana el más cercano al valor base: un empate no
// es evidencia de que el perfil sea extremo, y el umbral mínimo
// dejaba pasar casi nada con calibraciones ambiguas. Si todavía
// empatan en distancia, el recorrido ascendente favorece al menor.
const CANDIDATES = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0] as const;

// El ajuste manual («mostrar más / menos») puede salirse de las bandas
// pero no del tramo útil de la escala zipf. Se exportan para que la
// tarjeta «Antes de leer» deshabilite sus botones en los topes.
export const MIN_THRESHOLD = 1.0;
export const MAX_THRESHOLD = 5.5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// Estima el umbral a partir del cual conviene predecir midiendo qué
// candidato comete menos errores contra la evidencia real: contar como
// conocida una palabra rara que el lector marcó como desconocida, o al
// revés, son fallos. La evidencia sin medición (zipf null) no aporta
// posición en la escala y se ignora — también para confidence, porque
// no dice nada del nivel del lector. `adjust` desplaza el resultado.
export function estimateProfile(
  evidence: KnowledgeEvidence[],
  adjust = 0,
): VocabProfile {
  const usable = evidence.flatMap((item) =>
    item.zipf == null ? [] : [{ zipf: item.zipf, known: item.known }],
  );
  let best = DEFAULT_THRESHOLD;
  if (usable.length) {
    let bestErrors = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const t of CANDIDATES) {
      let errors = 0;
      for (const item of usable) {
        if (item.known && item.zipf < t) errors += 1;
        if (!item.known && item.zipf >= t) errors += 1;
      }
      const distance = Math.abs(t - DEFAULT_THRESHOLD);
      if (
        errors < bestErrors ||
        (errors === bestErrors && distance < bestDistance)
      ) {
        bestErrors = errors;
        bestDistance = distance;
        best = t;
      }
    }
  }
  return {
    threshold: clamp(best + adjust, MIN_THRESHOLD, MAX_THRESHOLD),
    confidence: usable.length < 15 ? "low" : usable.length < 60 ? "mid" : "high",
  };
}

// ---------- Predicción por sección ----------

// Tope de la lista de predichas por sección.
export const PREDICT_CAP = 40;

// La misma entrada puede responder por varias formas de la sección
// («perenne» y «perennes»): se predice una sola vez, con la primera
// forma que la trajo.
export const dedupeKey = (entry: LexiconEntry) =>
  entry.entryId != null ? `id:${entry.entryId}` : `${entry.lemma}::${entry.pos ?? ""}`;

// Más rara primero; las sin medición al final, y a igual zipf gana el
// orden alfabético de la forma.
export const compareByRarity = (
  a: { form: string; entry: LexiconEntry },
  b: { form: string; entry: LexiconEntry },
) => {
  const za = a.entry.zipf ?? Number.POSITIVE_INFINITY;
  const zb = b.entry.zipf ?? Number.POSITIVE_INFINITY;
  return za - zb || a.form.localeCompare(b.form);
};

export type SectionPrediction = {
  predicted: { form: string; entry: LexiconEntry }[]; // orden: más rara primero
  savedCount: number; // ya en el cuaderno
  knownCount: number; // con ficha, no predichas ni guardadas
  missing: string[]; // sin ficha (candidatas a enriquecer)
  // Con ficha pero sin medición (zipf null en todas las acepciones) y
  // sin evidencia explícita: no sabemos si son raras ni comunes, así
  // que no son predichas ni «conocidas» — van a consulta secundaria.
  uncertain: { form: string; entry: LexiconEntry }[];
  total: number; // formas únicas analizadas
};

// Clasifica las formas únicas de una sección contra lo que se sabe del
// lector. `knowledge` va por lema en minúsculas (como lo guarda idb).
// Reglas en orden por forma:
//   a) ya guardada en el cuaderno → cuenta aparte;
//   b) sin ficha en el catálogo → `missing`;
//   c) hay evidencia — por lema de la ficha, o por la forma misma si la
//      registró como lema: un «no la conozco» la predice con la primera
//      ficha libre; si solo hay «ya la conozco» se da por conocida;
//   d) sin evidencia: si alguna ficha de la forma es frecuente
//      (zipf ≥ threshold) la forma se asume conocida — lo raro sería
//      la acepción homógrafa, no la palabra; solo cuando TODAS las
//      fichas son raras se predice, mostrando la de mayor zipf (la
//      lectura más probable entre las raras). Si ninguna ficha trae
//      medición no hay base para decidir: la forma va a `uncertain`.
export function predictSection(
  forms: string[],
  entriesByForm: Record<string, LexiconEntry[]>,
  saved: ReadonlySet<string>,
  knowledge: ReadonlyMap<string, { lemma: string; known: boolean }>,
  threshold: number,
): SectionPrediction {
  const predictedKeys = new Set<string>();
  const candidates: { form: string; entry: LexiconEntry }[] = [];
  const missing: string[] = [];
  const uncertain: { form: string; entry: LexiconEntry }[] = [];
  let savedCount = 0;
  let knownCount = 0;

  for (const form of forms) {
    if (saved.has(form)) {
      savedCount += 1;
      continue;
    }
    const entries = entriesByForm[form] ?? [];
    if (!entries.length) {
      missing.push(form);
      continue;
    }

    const evidenceOf = (entry: LexiconEntry) =>
      knowledge.get(entry.lemma) ?? knowledge.get(form);

    const hasEvidence = entries.some((entry) => evidenceOf(entry) !== undefined);
    const pick = hasEvidence
      ? // c) con evidencia manda lo explícito: la predice la primera
        // ficha marcada como desconocida que aún no esté predicha; las
        // demás combinaciones cuentan como conocidas (incluido el caso
        // en que la predicción de otra forma ya cubrió esta entrada).
        entries.find(
          (entry) =>
            evidenceOf(entry)?.known === false && !predictedKeys.has(dedupeKey(entry)),
        )
      : // d) sin evidencia: una forma con una lectura frecuente
        // («antigua» → antiguo, aunque también exista el lema raro
        // «antiguar») se asume conocida — lo raro es la acepción, no
        // la palabra que el lector tiene delante. Solo si TODAS las
        // fichas medidas son raras se predice, y se muestra la de
        // mayor zipf (la lectura más probable entre las raras). Las
        // fichas sin medición no bastan para declararla rara: quedan
        // para la rama «uncertain».
        entries.some((entry) => entry.zipf != null && entry.zipf >= threshold)
          ? undefined
          : entries
              .filter(
                (entry) =>
                  entry.zipf != null && !predictedKeys.has(dedupeKey(entry)),
              )
              .sort(
                (a, b) => (b.zipf ?? -1) - (a.zipf ?? -1),
              )[0];

    if (pick) {
      predictedKeys.add(dedupeKey(pick));
      candidates.push({ form, entry: pick });
    } else if (!hasEvidence && entries.every((entry) => entry.zipf == null)) {
      // Sin evidencia y sin medición no se afirma conocida ni rara:
      // va a la consulta secundaria de la preparación.
      uncertain.push({ form, entry: entries[0] });
    } else {
      knownCount += 1;
    }
  }

  candidates.sort(compareByRarity);
  const predicted = candidates.slice(0, PREDICT_CAP);
  // Lo que el tope dejó fuera cuenta como «con ficha, no predicha».
  knownCount += candidates.length - predicted.length;

  return { predicted, savedCount, knownCount, missing, uncertain, total: forms.length };
}

// ¿La evidencia cuenta para el perfil y la predicción? Las filas
// «inferidas como desconocidas» sin una palabra guardada que las
// respalde son débiles: vienen de consultas anteriores a cuando abrir
// una ficha dejaba de marcar «no la sé» — abrir por curiosidad no es
// declararse desconocido. El registro se conserva, pero no alimenta
// ni el umbral ni las predicciones.
export function isCredibleKnowledge(
  row: { lemma: string; known: boolean; source: string },
  savedLemmas: ReadonlySet<string>,
): boolean {
  return !(
    row.source === "inferred" &&
    !row.known &&
    !savedLemmas.has(row.lemma)
  );
}

// Convierte filas de conocimiento + resultado del catálogo en el mapa
// de evidencia del perfil: una entrada por lema, con su zipf medido
// (primera acepción — el mismo criterio que Cuenta) y su respuesta en
// cualquiera de las dos direcciones. Es el punto común del lector y de
// Cuenta para que ambos estimen con la misma evidencia.
export function knowledgeEvidence(
  rows: { lemma: string; known: boolean }[],
  entries: Record<string, LexiconEntry[]>,
): Map<string, KnowledgeEvidence> {
  const evidence = new Map<string, KnowledgeEvidence>();
  for (const row of rows)
    evidence.set(row.lemma, {
      zipf: entries[row.lemma]?.[0]?.zipf ?? null,
      known: row.known,
    });
  return evidence;
}

// ---------- Perfil desde la evidencia guardada ----------

// Estima el perfil a partir de filas de conocimiento guardadas: el
// zipf medido de cada lema sale del catálogo (los lemas se resuelven
// como formas en el batch). Devuelve null si el catálogo no respondió
// — sin mediciones el umbral sería inventado. Quien necesite siempre
// un número (p. ej. el lector sin conexión) puede caer al default con
// estimateProfile([], adjust).
export async function estimateStoredProfile(
  rows: { lemma: string; known: boolean }[],
  language = "es",
  adjust = 0,
): Promise<VocabProfile | null> {
  if (!rows.length) return estimateProfile([], adjust);
  const result = await batchLookup(
    rows.map((row) => row.lemma),
    language,
  ).catch(() => null);
  if (!result?.ok) return null;
  const evidence: KnowledgeEvidence[] = rows.map((row) => ({
    zipf: result.entries[row.lemma]?.[0]?.zipf ?? null,
    known: row.known,
  }));
  return estimateProfile(evidence, adjust);
}

// Etiqueta humana del umbral para mostrar en Cuenta: neutra y sin
// juicio — un umbral bajo significa que casi nada se predice porque
// el vocabulario ya cubre hasta lo raro; uno alto, que conviene
// anticipar bastante.
export function vocabLevelLabel(threshold: number): string {
  if (threshold < 2.5) return "amplio";
  if (threshold < 3.5) return "medio";
  return "en desarrollo";
}
