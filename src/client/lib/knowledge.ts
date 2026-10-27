import { batchLookup, type LexiconEntry } from "./lexicon";
import { listKnowledge, saveKnowledge, type DbScope } from "./idb";
import { isLearnablePos, measuredZipf } from "../../shared/lexicon";
import { menteBaseForms, cliticBaseForms, dedupeKey } from "../../shared/word-form";
export { cliticBaseForms, dedupeKey };
import { knowledgeArbWins } from "../../shared/reading-data";
import { calibrationBankZipf } from "../../shared/calibration-bank";
export { calibrationBankZipf };
import {
  betaFromZipf,
  loadUserLanguageProfile,
  saveUserLanguageProfile,
  updateThetaForLanguageSignal,
  type SupportedBookLang,
  type UserLanguageProfile,
} from "./profile-models";

// Modelo de conocimiento del lector: qué palabras conoce. Dos piezas
// puras y deterministas:
//   · estimateProfile — el umbral zipf que mejor separa la evidencia
//     «conozco / no conozco» recogida (calibración y actos del lector);
//   · predictSection — qué formas de una sección conviene preparar,
//     combinando cuaderno, evidencia explícita y rareza medida.

import {
  estimateProfile,
  DEFAULT_THRESHOLD_NATIVE,
  DEFAULT_THRESHOLD_LEARNER,
  DEFAULT_THRESHOLD,
  CANDIDATES,
  PROFILE_REGULARIZATION,
  MIN_THRESHOLD,
  MAX_THRESHOLD,
  PROFILE_ADJUST_KEY,
  type KnowledgeEvidence,
  type VocabProfile,
} from "./profile-models";

export {
  estimateProfile,
  DEFAULT_THRESHOLD_NATIVE,
  DEFAULT_THRESHOLD_LEARNER,
  DEFAULT_THRESHOLD,
  CANDIDATES,
  PROFILE_REGULARIZATION,
  MIN_THRESHOLD,
  MAX_THRESHOLD,
  PROFILE_ADJUST_KEY,
  type KnowledgeEvidence,
  type VocabProfile,
};

// Inferencia implícita por exposición pasiva.
export const GAMMA_PASSIVE = 0.82;
export const FAMILIAR_PASSIVE_THRESHOLD = 3;

export function updatePassiveExposureState(current: {
  passiveSeenCount?: number;
  estimatedKnownProb?: number;
  status?: "unknown" | "familiar" | "known";
  known?: boolean;
}): {
  passiveSeenCount: number;
  estimatedKnownProb: number;
  status: "unknown" | "familiar" | "known";
} {
  const count = (current.passiveSeenCount ?? 0) + 1;
  const currentProb = current.estimatedKnownProb ?? 0;
  const estimatedKnownProb = 1 - (1 - currentProb) * GAMMA_PASSIVE;
  const status: "unknown" | "familiar" | "known" =
    current.known
      ? "known"
      : count >= FAMILIAR_PASSIVE_THRESHOLD
        ? "familiar"
        : (current.status ?? "unknown");
  return {
    passiveSeenCount: count,
    estimatedKnownProb,
    status,
  };
}

// ---------- Predicción por sección ----------

// Tope de la lista de predichas por sección.
export const PREDICT_CAP = 40;

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
  // Candidatas reales que el tope dejó fuera: la hoja las ofrece
  // diferidas, no las declara conocidas por no caber.
  deferred: { form: string; entry: LexiconEntry }[];
  total: number; // formas únicas analizadas
  coveragePct?: number; // porcentaje de vocabulario conocido/cubierto (0-100)
};

// Clasifica las formas únicas de una sección contra lo que se sabe del
// lector. `knowledge` va por lema en minúsculas (como lo guarda idb).
// Reglas en orden por forma:
//   a) ya guardada en el cuaderno → cuenta aparte;
//   b) adverbio en «-mente» con raíz adjetiva común → conocida: la
//      derivación es transparente («perfectamente» → «perfecto»);
//   c) solo fichas funcionales (numeral, pronombre, preposición…) →
//      conocida: no es vocabulario que se aprende;
//   d) sin ficha propia: se intenta la base clítica verificada en el
//      catálogo («tomándose» → «tomando») y se clasifica con la ficha
//      del lema real; sin ninguna ficha → `missing`;
//   e) hay evidencia — por lema de la ficha, o por la forma misma si la
//      registró como lema: un «no la conozco» la predice con la primera
//      ficha libre; si solo hay «ya la conozco» se da por conocida;
//   f) sin evidencia: si alguna ficha de la forma es frecuente
//      (zipf ≥ threshold) la forma se asume conocida — lo raro sería
//      la acepción homógrafa, no la palabra; solo cuando TODAS las
//      fichas son raras se predice, mostrando la de mayor zipf (la
//      lectura más probable entre las raras). Si ninguna ficha trae
//      medición no hay base para decidir: la forma va a `uncertain`.
export function predictSection(
  forms: string[],
  entriesByForm: Record<string, LexiconEntry[]>,
  saved: ReadonlySet<string>,
  knowledge: ReadonlyMap<
    string,
    {
      lemma: string;
      known: boolean;
      status?: "unknown" | "familiar" | "known";
      passiveSeenCount?: number;
      estimatedKnownProb?: number;
    }
  >,
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
    const rawEntries = entriesByForm[form] ?? [];
    // Las fichas funcionales (numeral, pronombre, preposición…) no son
    // vocabulario aunque el catálogo las conozca y estén medidas.
    let entries = rawEntries.filter((entry) => isLearnablePos(entry.pos));
    // La forma flexionada cuenta como guardada si el lector ya tiene su
    // lema en el Cuaderno («corrieron» → «correr»): es un reencuentro,
    // no vocabulario nuevo que preparar.
    if (entries.some((entry) => saved.has(entry.lemma.toLowerCase()))) {
      savedCount += 1;
      continue;
    }
    const evidenceOf = (entry: LexiconEntry) =>
      knowledge.get(entry.lemma) ?? knowledge.get(form);

    const isFamiliarOrKnown = (entry: LexiconEntry) => {
      const ev = evidenceOf(entry);
      if (!ev) return false;
      if (ev.known === true) return true;
      if (
        ev.status === "familiar" ||
        (ev.passiveSeenCount ?? 0) >= FAMILIAR_PASSIVE_THRESHOLD
      )
        return true;
      return false;
    };

    // «-mente»: la raíz sin sufijo es el adjetivo («perfectamente» →
    // «perfecta»/«perfecto»). Si esa raíz es un adjetivo común para
    // este lector el adverbio es transparente y no se sugiere — salvo
    // declaración explícita, que manda como en el resto de reglas.
    // Con raíz rara o sin ficha propia, la frecuencia se evalúa sobre
    // la raíz.
    const roots = menteBaseForms(form);
    if (roots.length) {
      const rootEntries = roots.flatMap((root) =>
        (entriesByForm[root] ?? []).filter((entry) =>
          isLearnablePos(entry.pos),
        ),
      );
      if (
        rootEntries.some(
          (entry) =>
            entry.pos === "adjetivo" &&
            entry.zipf != null &&
            entry.zipf >= threshold,
        ) &&
        ![...entries, ...rootEntries].some(
          (entry) => evidenceOf(entry)?.known === false && !isFamiliarOrKnown(entry),
        )
      ) {
        knownCount += 1;
        continue;
      }
      if (!entries.length) entries = rootEntries;
    }

    if (!entries.length) {
      if (rawEntries.length) {
        // Solo tenía fichas funcionales: no es vocabulario, así que
        // cuenta como conocida sin gastar candidata.
        knownCount += 1;
        continue;
      }
      // Sin ficha propia puede ser un verbo con enclíticos
      // («tomándose» → «tomando»): la frecuencia se evalúa con la
      // primera base verificada en el catálogo.
      const base = cliticBaseForms(form).find((candidate) =>
        (entriesByForm[candidate] ?? []).some((entry) =>
          isLearnablePos(entry.pos),
        ),
      );
      if (!base) {
        missing.push(form);
        continue;
      }
      entries = (entriesByForm[base] ?? []).filter((entry) =>
        isLearnablePos(entry.pos),
      );
    }

    const hasEvidence = entries.some((entry) => evidenceOf(entry) !== undefined);
    const pick = hasEvidence
      ? // e) con evidencia manda lo explícito: la predice la primera
        // ficha marcada como desconocida que aún no esté predicha; las
        // demás combinaciones cuentan como conocidas (incluido el caso
        // en que la predicción de otra forma ya cubrió esta entrada o
        // la palabra fue asimilada a 'familiar' por exposición pasiva).
        entries.find(
          (entry) =>
            evidenceOf(entry)?.known === false &&
            !isFamiliarOrKnown(entry) &&
            !predictedKeys.has(dedupeKey(entry)),
        )
      : // f) sin evidencia: una forma con una lectura frecuente
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
  // Lo que el tope dejó fuera no es «conocida»: son candidatas que
  // no cupieron y la hoja ofrece aparte.
  const deferred = candidates.slice(PREDICT_CAP);
  const total = forms.length;
  const coveragePct =
    total > 0
      ? Math.max(0, Math.min(100, Math.round(((knownCount + savedCount) / total) * 100)))
      : 100;

  return {
    predicted,
    savedCount,
    knownCount,
    missing,
    uncertain,
    deferred,
    total,
    coveragePct,
  };
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

// ---------- Resolución de evidencia contra el catálogo ----------

// Fila de evidencia de entrada: `source` y `updatedAt` arbitran
// conflictos al proyectar alias (mismo orden que mergeKnowledgeWrite
// y el sync: knowledgeArbWins de reading-data).
export type EvidenceInput = {
  lemma: string;
  known: boolean;
  source?: string;
  updatedAt?: number;
};

// Evidencia resuelta por lema efectivo: puede ser el propio lema de
// la fila o el lema base verificado de un clítico («abrirlo» declara
// sobre «abrir»). La fila original nunca se toca — la proyección es
// solo para uso del modelo.
export type ResolvedEvidence = { lemma: string; known: boolean; zipf: number | null };

// Traduce filas de conocimiento a evidencia por lema con su zipf:
//   · con ficha, la medición sale de measuredZipf (mismo lema primero,
//     luego la primera lectura medida — «decirle» aprovecha la ficha
//     medida de «decir» en lugar de quedarse con la propia sin zipf);
//   · sin ficha, se intenta una base clítica verificada en el
//     catálogo («abrirlo» → «abrir»); sin ella el zipf queda null.
// Dos filas pueden resolver al mismo lema (una proyectada y otra
// directa): el mismo orden convergente del merge —knowledgeArbWins—,
// así la proyección arbitra como la persistencia.
export function resolveEvidence(
  rows: readonly EvidenceInput[],
  entries: Record<string, LexiconEntry[]>,
  baseEntries: Record<string, LexiconEntry[]> = {},
  language = "es",
): Map<string, ResolvedEvidence> {
  const out = new Map<string, ResolvedEvidence>();
  const owners = new Map<string, EvidenceInput>();
  const put = (lemma: string, row: EvidenceInput, zipf: number | null) => {
    const prev = owners.get(lemma);
    if (
      prev &&
      !knowledgeArbWins(
        { source: row.source ?? "", updatedAt: row.updatedAt ?? 0, known: row.known },
        { source: prev.source ?? "", updatedAt: prev.updatedAt ?? 0, known: prev.known },
      )
    )
      return;
    owners.set(lemma, row);
    out.set(lemma, { lemma, known: row.known, zipf });
  };
  for (const row of rows) {
    const key = row.lemma.toLowerCase();
    const direct = entries[key] ?? [];
    if (direct.length) {
      put(key, row, measuredZipf(direct, key) ?? calibrationBankZipf(key, language));
      continue;
    }
    const base = cliticBaseForms(key).find(
      (candidate) => (baseEntries[candidate] ?? []).length > 0,
    );
    if (!base) {
      put(key, row, calibrationBankZipf(key, language));
      continue;
    }
    const baseList = baseEntries[base];
    const resolved = baseList[0]?.lemma ?? key;
    put(
      resolved,
      row,
      measuredZipf(baseList, resolved) ?? calibrationBankZipf(resolved, language),
    );
  }
  return out;
}

// Formas sin ficha cuyas bases clíticas vale la pena consultar: la
// segunda ronda de lookup que alimenta `baseEntries` de
// resolveEvidence. Devuelve las bases únicas en orden de aparición.
export function cliticBasesFor(
  rows: readonly { lemma: string }[],
  entries: Record<string, LexiconEntry[]>,
): string[] {
  const bases: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if ((entries[row.lemma] ?? []).length) continue;
    for (const base of cliticBaseForms(row.lemma)) {
      if (seen.has(base)) continue;
      seen.add(base);
      bases.push(base);
    }
  }
  return bases;
}

// Convierte filas de conocimiento + resultado del catálogo en el mapa
// de evidencia del perfil: una entrada por lema, con su zipf medido
// (measuredZipf — el mismo criterio que Cuenta) y su respuesta en
// cualquiera de las dos direcciones. Es el punto común del lector y de
// Cuenta para que ambos estimen con la misma evidencia.
export function knowledgeEvidence(
  rows: { lemma: string; known: boolean }[],
  entries: Record<string, LexiconEntry[]>,
  language = "es",
): Map<string, KnowledgeEvidence> {
  const evidence = new Map<string, KnowledgeEvidence>();
  for (const row of rows)
    evidence.set(row.lemma, {
      zipf:
        measuredZipf(entries[row.lemma], row.lemma) ??
        calibrationBankZipf(row.lemma, language),
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
  rows: { lemma: string; known: boolean; source?: string; updatedAt?: number }[],
  language = "es",
  adjust = 0,
  baseThreshold = DEFAULT_THRESHOLD,
): Promise<VocabProfile | null> {
  if (!rows.length) return estimateProfile([], adjust, baseThreshold);
  const result = await batchLookup(
    rows.map((row) => row.lemma),
    language,
  ).catch(() => null);
  if (!result?.ok) {
    const fallbackEvidence: KnowledgeEvidence[] = rows.map((r) => ({
      zipf: calibrationBankZipf(r.lemma, language),
      known: r.known,
    }));
    if (fallbackEvidence.some((e) => e.zipf != null)) {
      return estimateProfile(fallbackEvidence, adjust, baseThreshold);
    }
    return null;
  }
  // Segunda consulta solo para formas sin ficha con base clítica
  // verificable — una sola ronda extra por estimación.
  const bases = cliticBasesFor(rows, result.entries);
  const baseResult = bases.length
    ? await batchLookup(bases, language).catch(() => null)
    : null;
  const resolved = resolveEvidence(
    rows,
    result.entries,
    baseResult?.ok ? baseResult.entries : {},
    language,
  );
  const evidence: KnowledgeEvidence[] = [...resolved.values()].map((item) => ({
    zipf: item.zipf,
    known: item.known,
  }));
  return estimateProfile(evidence, adjust, baseThreshold);
}

// Etiqueta humana del umbral para mostrar en Cuenta: neutra y sin
// juicio — un umbral bajo significa que casi nada se predice porque
// el vocabulario ya cubre hasta lo raro; uno alto, que conviene
// anticipar bastante.
export function vocabLevelLabel(
  threshold: number,
  profile: "native" | "learner" = "learner",
): string {
  if (profile === "native") {
    if (threshold < 1.8) return "amplio";
    if (threshold < 2.4) return "medio";
    return "en desarrollo";
  }
  if (threshold < 2.5) return "amplio";
  if (threshold < 3.5) return "medio";
  return "en desarrollo";
}

export interface ChapterCandidateFeedbackItem {
  lemma: string;
  beta: number;
  wasConsultedInWordPanel?: boolean;
}

export interface ChapterCompletionPassiveLoopOptions {
  profile?: UserLanguageProfile;
  lang?: string;
  candidates: ChapterCandidateFeedbackItem[];
  isFluidReadingPace?: boolean;
}

/**
 * Canal A: Al marcar una palabra como conocida ("✓ Ya la sé" en pre-lectura o WordPanel),
 * dispara la señal 'explicit_known' para actualizar thetaByLang[lang].
 */
export function applyPreviewKnownSignal(
  profileOrLang: UserLanguageProfile | string,
  langOrBeta: string | number,
  maybeBeta?: number,
): UserLanguageProfile {
  let profile: UserLanguageProfile;
  let lang: string;
  let betaW: number;
  let shouldPersist = false;

  if (typeof profileOrLang === "string") {
    shouldPersist = true;
    profile = loadUserLanguageProfile();
    lang = profileOrLang;
    betaW = typeof langOrBeta === "number" ? langOrBeta : 0;
  } else {
    profile = profileOrLang;
    lang = typeof langOrBeta === "string" ? langOrBeta : "es";
    betaW = typeof maybeBeta === "number" ? maybeBeta : 0;
  }

  const normLang = (lang || "es").slice(0, 2).toLowerCase() as SupportedBookLang;
  const updated = updateThetaForLanguageSignal(profile, normLang, betaW, "explicit_known");
  const result: UserLanguageProfile = {
    ...profile,
    ...updated,
    theta: updated.theta,
    thetaByLang: updated.thetaByLang ?? profile.thetaByLang,
  };

  if (shouldPersist) {
    saveUserLanguageProfile(result);
  }
  return result;
}

/**
 * Canal B: Al consultar una palabra en WordPanel, si el sistema asumía que el usuario la conocía
 * o si se busca explícitamente, aplica la señal 'lookup_surprise' para corregir thetaByLang[lang] a la baja.
 */
export function applyWordPanelLookupSignal(
  profileOrLang: UserLanguageProfile | string,
  langOrBeta: string | number,
  maybeBeta?: number,
): UserLanguageProfile {
  let profile: UserLanguageProfile;
  let lang: string;
  let betaW: number;
  let shouldPersist = false;

  if (typeof profileOrLang === "string") {
    shouldPersist = true;
    profile = loadUserLanguageProfile();
    lang = profileOrLang;
    betaW = typeof langOrBeta === "number" ? langOrBeta : 0;
  } else {
    profile = profileOrLang;
    lang = typeof langOrBeta === "string" ? langOrBeta : "es";
    betaW = typeof maybeBeta === "number" ? maybeBeta : 0;
  }

  const normLang = (lang || "es").slice(0, 2).toLowerCase() as SupportedBookLang;
  const updated = updateThetaForLanguageSignal(profile, normLang, betaW, "lookup_surprise");
  const result: UserLanguageProfile = {
    ...profile,
    ...updated,
    theta: updated.theta,
    thetaByLang: updated.thetaByLang ?? profile.thetaByLang,
  };

  if (shouldPersist) {
    saveUserLanguageProfile(result);
  }
  return result;
}

/**
 * Canal C: Al completar un capítulo, las palabras candidatas en la frontera (|theta - beta| <= 1.1)
 * no consultadas en WordPanel reciben la señal 'passive_frontier' si la velocidad de lectura fue fluida.
 */
export function applyChapterCompletionPassiveLoop(
  profileOrOptions: UserLanguageProfile | ChapterCompletionPassiveLoopOptions,
  langArg?: string,
  candidatesArg?: ChapterCandidateFeedbackItem[],
  isFluidReadingPaceArg = true,
): UserLanguageProfile {
  let profile: UserLanguageProfile;
  let lang: string;
  let candidates: ChapterCandidateFeedbackItem[];
  let isFluidReadingPace: boolean;
  let shouldPersist = false;

  if ("candidates" in profileOrOptions) {
    shouldPersist = profileOrOptions.profile === undefined;
    profile = profileOrOptions.profile ?? loadUserLanguageProfile();
    lang = profileOrOptions.lang ?? "es";
    candidates = profileOrOptions.candidates;
    isFluidReadingPace = profileOrOptions.isFluidReadingPace ?? true;
  } else {
    profile = profileOrOptions;
    lang = langArg ?? "es";
    candidates = candidatesArg ?? [];
    isFluidReadingPace = isFluidReadingPaceArg;
  }

  const normLang = (lang || "es").slice(0, 2).toLowerCase() as SupportedBookLang;
  let currentProfile: UserLanguageProfile = { ...profile };

  if (isFluidReadingPace) {
    for (const candidate of candidates) {
      if (candidate.wasConsultedInWordPanel) continue;
      const updated = updateThetaForLanguageSignal(
        currentProfile,
        normLang,
        candidate.beta,
        "passive_frontier",
      );
      currentProfile = {
        ...currentProfile,
        ...updated,
        theta: updated.theta,
        thetaByLang: updated.thetaByLang ?? currentProfile.thetaByLang,
      };
    }
  }

  const currentCount = currentProfile.chaptersCompletedByLang[normLang] ?? 0;
  const result: UserLanguageProfile = {
    ...currentProfile,
    chaptersCompletedByLang: {
      ...currentProfile.chaptersCompletedByLang,
      [normLang]: currentCount + 1,
    },
  };

  if (shouldPersist) {
    saveUserLanguageProfile(result);
  }
  return result;
}

/**
 * Canal D: Adaptación de fricción. Si el usuario omite la tarjeta de pre-lectura
 * durante 3 capítulos consecutivos, reduce la cantidad preferida de palabras de 5 (o 4) a 3.
 */
export function updatePreviewFrictionPreference(
  profileOrInteracted: UserLanguageProfile | boolean,
  maybeInteracted?: boolean,
): UserLanguageProfile {
  let profile: UserLanguageProfile;
  let interacted: boolean;
  let shouldPersist = false;

  if (typeof profileOrInteracted === "boolean") {
    shouldPersist = true;
    profile = loadUserLanguageProfile();
    interacted = profileOrInteracted;
  } else {
    profile = profileOrInteracted;
    interacted = Boolean(maybeInteracted);
  }

  const skips = interacted ? 0 : (profile.consecutivePreviewSkips ?? 0) + 1;
  const currentCount = profile.preferredPreviewCount ?? 4;
  const nextCount = skips >= 3 ? 3 : currentCount;

  const result: UserLanguageProfile = {
    ...profile,
    consecutivePreviewSkips: skips,
    preferredPreviewCount: nextCount,
  };

  if (shouldPersist) {
    saveUserLanguageProfile(result);
  }
  return result;
}

/**
 * Calibración Silenciosa (Track 4):
 * Ajusta automáticamente el nivel theta del lector sin exámenes ni bloqueos
 * cuando consulta ('lookup'), guarda ('save') o marca como conocida ('known') una palabra.
 */
export function recordSilentCalibration(
  word: string,
  event: "lookup" | "save",
  language = "es",
): void {
  // Una sola señal por acto y en una sola escala: consultar o guardar dice
  // «no la conocía», que es exactamente la sorpresa del modelo.
  if (event !== "lookup" && event !== "save") return;
  try {
    const beta = betaFromZipf(calibrationBankZipf(word.trim().toLowerCase(), language));
    applyWordPanelLookupSignal(language, beta);
  } catch {
    // Silencioso
  }
}

// ---------- Umbral de Lectura Pasiva Proporcional ----------
export const MIN_PAGE_DWELL_MS = 3000;
export const MIN_MS_PER_WORD = 160; // ~375 palabras por minuto (lectura ágil real, no escaneo)
export const MAX_REQUIRED_DWELL_MS = 12000;

export function computeRequiredDwellMs(wordCount: number): number {
  if (wordCount <= 0) return MIN_PAGE_DWELL_MS;
  return Math.min(
    MAX_REQUIRED_DWELL_MS,
    Math.max(MIN_PAGE_DWELL_MS, Math.round(wordCount * MIN_MS_PER_WORD)),
  );
}

export type KnowledgeStatus = "seen" | "learning" | "known";
export type KnowledgeMap = Map<string, KnowledgeStatus>;

export async function getWordKnowledge(
  lemma: string,
  lang = "es",
  scope?: DbScope,
): Promise<{ status: KnowledgeStatus } | null> {
  const words = await listKnowledge(lang, scope);
  const entry = words.find((w) => w.lemma.toLowerCase() === lemma.toLowerCase());
  if (!entry) return null;
  const status: KnowledgeStatus = entry.known ? "known" : (entry.status === "familiar" ? "seen" : "learning");
  return { status };
}

export async function markWordStatus(
  lemma: string,
  status: KnowledgeStatus,
  lang = "es",
  scope?: DbScope,
): Promise<void> {
  const known = status === "known";
  await saveKnowledge(
    {
      language: lang,
      lemma: lemma.toLowerCase(),
      known,
      source: "reader",
      status: status === "seen" ? "familiar" : (known ? "known" : "unknown"),
    },
    scope,
  );
}

export async function getAllKnowledgeMap(
  lang = "es",
  scope?: DbScope,
): Promise<KnowledgeMap> {
  const words = await listKnowledge(lang, scope);
  const map: KnowledgeMap = new Map();
  for (const w of words) {
    if (w.deleted) continue;
    const status: KnowledgeStatus = w.known ? "known" : (w.status === "familiar" ? "seen" : "learning");
    map.set(w.lemma.toLowerCase(), status);
  }
  return map;
}


