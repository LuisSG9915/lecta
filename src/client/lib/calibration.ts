import {
  captureDbScope,
  isDbScopeActive,
  listKnowledge,
  saveCalibrationBatch,
  type DbScope,
  type KnownWord,
} from "./idb";
import { pushKnowledgeToServer } from "./reading-sync";
import { pushWordsToServer } from "./vocab";
import {
  getCalibrationBankByLang,
  type CalibrationBankItem,
  type CalibrationLanguage,
  type CalibrationProfile,
} from "../../shared/calibration-bank";
import {
  loadUserLanguageProfile,
  saveUserLanguageProfile,
  saveUserTheta,
  type UserLanguageProfile,
} from "./profile-models";
import {
  itemFisherInformation,
  itemResponseProbability,
} from "../../shared/irt";

export { itemFisherInformation, itemResponseProbability };

// Calibración inicial del vocabulario: una muestra del catálogo
// (lemas repartidos en bandas de frecuencia, servida por
// GET /api/lexicon/sample) que el lector marca explícitamente como
// «la conozco / me suena dudosa / no la conozco». Solo lo respondido queda como
// evidencia `calibration` del modelo de conocimiento (knowledge.ts);
// lo no tocado no es conocido ni desconocido: es pendiente.

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

export type CalibrationAnswerValue = "known" | "unknown" | "unsure";
export type CalibrationAnswers = Record<string, CalibrationAnswerValue>;

export function calibrationAnswerScore(answer: CalibrationAnswerValue): number {
  switch (answer) {
    case "known":
      return 1.0;
    case "unsure":
      return 0.35;
    case "unknown":
      return 0.0;
  }
}

// `definition` puede ser null: el catálogo ofrece lemas aunque no
// tengan acepción cargada; al marcarlos no hay revelado.
export type CalibrationWord = {
  lemma: string;
  definition: string | null;
  sampleContext?: string | null;
  pos?: string;
  zipf?: number | null;
};

export type CalibrationSample =
  | { ok: true; words: CalibrationWord[]; version?: string }
  | { ok: false };

export const CALIBRATION_ADAPTIVE_COUNT = 10;

// Pide la muestra al catálogo con tope de espera: sin conexión, con
// respuesta rara o demasiado lenta devuelve { ok: false } y quien
// llama abre el libro igual — la calibración nunca bloquea la lectura.
export async function fetchCalibrationSample(
  language = "es",
  profile: CalibrationProfile = "native",
): Promise<CalibrationSample> {
  try {
    const response = await fetch(
      `/api/lexicon/sample?language=${encodeURIComponent(language)}&profile=${encodeURIComponent(profile)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = (await response.json()) as {
      words?: unknown;
      version?: unknown;
    };
    if (!response.ok || !Array.isArray(data.words)) return { ok: false };
    const rawWords = data.words.filter(
      (item): item is CalibrationWord =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CalibrationWord).lemma === "string" &&
        ((item as CalibrationWord).definition === null ||
          typeof (item as CalibrationWord).definition === "string"),
    );

    let fallbackDef: ((lemma: string, lang: string) => string | null) | null = null;
    let fallbackCtx: ((lemma: string, lang: string) => string | null) | null = null;

    if (rawWords.some((w) => w.definition == null || w.sampleContext == null)) {
      const bank = await import("../../shared/calibration-bank");
      fallbackDef = bank.calibrationFallbackDefinition;
      fallbackCtx = bank.calibrationSampleContext;
    }

    const words = rawWords.map((item) => ({
      ...item,
      definition:
        item.definition ?? fallbackDef?.(item.lemma, language) ?? null,
      sampleContext:
        item.sampleContext ?? fallbackCtx?.(item.lemma, language) ?? null,
    }));
    const version =
      typeof data.version === "string" ? data.version : undefined;
    return { ok: true, words, version };
  } catch {
    return { ok: false };
  }
}

// ¿Ya existe evidencia de calibración (local o bajada por sync de
// otro dispositivo)? Evita volver a ofrecer la prueba aunque la marca
// local falte — sin esperar a la red: es una lectura del almacén.
export async function hasCalibrationEvidence(language?: string, scope?: DbScope) {
  try {
    const rows = await listKnowledge(language, scope);
    return rows.some((row) => row.source === "calibration");
  } catch {
    return false;
  }
}

// Versión del borrador en sesión. v2 lleva la muestra completa y el
// paso donde quedó el lector: reabrir la hoja muestra las mismas
// palabras en el mismo lugar — la nueva consulta al catálogo podría
// traer una selección distinta. Un borrador v1 (solo `answers`,
// formato anterior) restaura las respuestas cuyo lema siga en la
// muestra actual.
export const CALIBRATION_DRAFT_VERSION = 2;

export type CalibrationDraft = {
  answers: CalibrationAnswers;
  step: number;
  stage?: number;
  // La muestra guardada con el borrador; si existe, sustituye a la
  // recién descargada para conservar la misma selección.
  words?: CalibrationWord[];
};

// Serializa el borrador v2: respuestas, paso y muestra completa.
export function serializeCalibrationDraft(draft: {
  answers: CalibrationAnswers;
  step: number;
  stage?: number;
  words: CalibrationWord[];
}): string {
  return JSON.stringify({
    v: CALIBRATION_DRAFT_VERSION,
    answers: draft.answers,
    step: draft.step,
    ...(draft.stage !== undefined ? { stage: draft.stage } : {}),
    words: draft.words,
  });
}

const cleanAnswers = (
  source: unknown,
  words: CalibrationWord[],
): CalibrationAnswers => {
  if (typeof source !== "object" || source === null || Array.isArray(source))
    return {};
  const valid = new Set(words.map((word) => word.lemma));
  const answers: CalibrationAnswers = {};
  for (const [lemma, value] of Object.entries(source))
    if (
      valid.has(lemma) &&
      (value === "known" || value === "unknown" || value === "unsure")
    )
      answers[lemma] = value;
  return answers;
};

const cleanDraftWords = (source: unknown): CalibrationWord[] | undefined => {
  if (!Array.isArray(source) || !source.length) return undefined;
  const words = source.filter(
    (item): item is CalibrationWord =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as CalibrationWord).lemma === "string" &&
      ((item as CalibrationWord).definition === null ||
        typeof (item as CalibrationWord).definition === "string"),
  );
  return words.length === source.length ? words : undefined;
};

// Palabras por paso de la hoja (18 lemas en tres pasos de seis).
export const STEP_SIZE = 6;

// Restaura el borrador: respuestas válidas para la muestra, paso
// acotado y la muestra misma si el borrador la guardó. `fallback`
// es la muestra recién descargada — acota las respuestas a lemas que
// el borrador o la muestra reconozcan.
export function parseCalibrationDraft(
  raw: string | null | undefined,
  fallback: CalibrationWord[],
): CalibrationDraft {
  const empty: CalibrationDraft = { answers: {}, step: 0 };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as {
      v?: unknown;
      answers?: unknown;
      step?: unknown;
      stage?: unknown;
      words?: unknown;
    };
    // Una versión distinta a las conocidas no se interpreta: un v3
    // futuro no es un v1 sin campo — mejor no restaurar que leer mal.
    if (parsed?.v != null && parsed.v !== CALIBRATION_DRAFT_VERSION)
      return empty;
    if (parsed?.v !== CALIBRATION_DRAFT_VERSION) {
      // v1: solo respuestas, sin paso ni muestra guardada.
      const answers = cleanAnswers(parsed?.answers, fallback);
      return { answers, step: 0 };
    }
    const words = cleanDraftWords(parsed.words) ?? fallback;
    const lastStep = Math.max(0, Math.ceil(words.length / STEP_SIZE) - 1);
    const step =
      typeof parsed.step === "number" && Number.isInteger(parsed.step)
        ? Math.min(Math.max(parsed.step, 0), lastStep)
        : 0;
    const stage =
      typeof parsed.stage === "number" && [1, 2, 3].includes(parsed.stage)
        ? parsed.stage
        : undefined;
    return {
      answers: cleanAnswers(parsed.answers, words),
      step,
      ...(stage ? { stage } : {}),
      words,
    };
  } catch {
    return empty;
  }
}

// Traduce la prueba a filas del modelo: solo los lemas con respuesta
// explícita generan evidencia — el resto no se toca. Pura y separada
// del guardado para poder probarla sin IndexedDB.
export function calibrationRows(
  words: CalibrationWord[],
  answers: CalibrationAnswers,
  language = "es",
): Omit<KnownWord, "key" | "updatedAt">[] {
  return words.flatMap(({ lemma }) => {
    const answer = answers[lemma];
    if (!answer) return [];
    return [
      {
        language,
        lemma: lemma.toLowerCase(),
        known: answer === "known",
        source: "calibration",
      },
    ];
  });
}

// Guarda las respuestas explícitas en el dispositivo y empuja al
// servidor si hay sesión — mismo criterio «local primero» que
// recordReview: un envío fallido no deshace nada. Las desconocidas
// además entran al Cuaderno con la regla segura de la preparación
// (palabra activa intacta, lápida restaurada conservando lo útil).
// Evidencia y palabras escriben en UNA transacción: un fallo a mitad
// no deja media ronda (ni filas huérfanas por sincronizar).
export async function recordCalibration(
  words: CalibrationWord[],
  answers: CalibrationAnswers,
  language = "es",
  scope?: DbScope,
) {
  const bound = scope ?? captureDbScope();
  const { knowledge, words: saved } = await saveCalibrationBatch(
    {
      knowledge: calibrationRows(words, answers, language),
      words: words
        .filter((word) => answers[word.lemma] === "unknown")
        .map((word) => ({
          form: word.lemma,
          lemma: word.lemma,
          language,
          meaning: word.definition ?? undefined,
        })),
    },
    bound,
  );

  // La cuenta cambió mientras se guardaba: no empujar con la sesión
  // nueva respuestas escritas bajo la anterior.
  if (isDbScopeActive(bound)) {
    void pushKnowledgeToServer(knowledge, bound);
    void pushWordsToServer(saved, bound);
  }
  return { knowledge, words: saved };
}

export { recordSilentCalibration } from "./knowledge";

// ============================================================================
// Motor CAT (Computerized Adaptive Testing) de 15 Segundos (P ≈ 0.50)
// ============================================================================

export const CAT_MIN_STEPS = 6;
export const CAT_MAX_STEPS = 8;
export const CAT_SE_CONVERGENCE_THRESHOLD = 0.42;
export const CAT_PRIOR_PRECISION = 3.0; // I_0 = 1 / sigma_0^2 (sigma_0 ~ 0.577)

export interface CatResponseRecord {
  itemId: string;
  word: string;
  difficulty: number;
  known: boolean;
  thetaBefore: number;
  thetaAfter: number;
  probabilityAtPresentation: number;
}

export interface CatSessionState {
  lang: CalibrationLanguage;
  step: number;               // 0..8
  maxSteps: number;           // 8 (con parada temprana en 6-7 si converge)
  theta: number;              // Estimación actual \hat{\theta}_{u,L}
  standardError: number;      // SE(\hat{\theta})
  answeredIds: string[];
  history: CatResponseRecord[];
  currentItem: CalibrationBankItem | null;
  isComplete: boolean;
  wasSkipped: boolean;
}

// Almacén en memoria por idioma (aislamiento por sesión / entorno de pruebas)
const inMemoryCalibrationStatus = new Map<string, "done" | "skipped">();

/**
 * Restablece el estado de calibración en memoria y localStorage (para pruebas).
 */
export function resetCalibrationStatusForTesting(): void {
  inMemoryCalibrationStatus.clear();
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem(calibrationDoneKey("es"));
      window.localStorage.removeItem(calibrationDoneKey("en"));
      window.localStorage.removeItem("lecta:cat_calibrated:es");
      window.localStorage.removeItem("lecta:cat_calibrated:en");
      window.localStorage.removeItem("lecta:cat_skipped:es");
      window.localStorage.removeItem("lecta:cat_skipped:en");
    } catch {
      // ignorar error de entorno
    }
  }
}

/**
 * Selecciona el siguiente ítem del banco que maximiza la información de Fisher,
 * es decir, minimiza |P(conoce | theta, b_i) - 0.50| entre los ítems no respondidos.
 */
export function selectNextCatItem(
  state: Pick<CatSessionState, "lang" | "theta" | "answeredIds">,
  bank?: CalibrationBankItem[],
): CalibrationBankItem | null {
  const candidatesBank = bank ?? getCalibrationBankByLang(state.lang);
  const answeredSet = new Set(state.answeredIds);
  const candidates = candidatesBank.filter((item) => !answeredSet.has(item.id));
  if (candidates.length === 0) return null;

  let bestItem = candidates[0];
  let bestDiffToHalf = Infinity;
  let bestDistanceToTheta = Infinity;

  for (const item of candidates) {
    const alpha = item.discrimination ?? 1.35;
    const p = itemResponseProbability(state.theta, item.difficulty, alpha);
    const diffToHalf = Math.abs(p - 0.5);
    const distToTheta = Math.abs(item.difficulty - state.theta);

    if (
      diffToHalf < bestDiffToHalf - 1e-9 ||
      (Math.abs(diffToHalf - bestDiffToHalf) <= 1e-9 && distToTheta < bestDistanceToTheta)
    ) {
      bestDiffToHalf = diffToHalf;
      bestDistanceToTheta = distToTheta;
      bestItem = item;
    }
  }

  return bestItem;
}

/**
 * Inicializa una nueva sesión de examen adaptativo computarizado (CAT).
 */
export function initCatSession(
  lang: CalibrationLanguage | string = "es",
  initialTheta?: number,
  bank?: CalibrationBankItem[],
): CatSessionState {
  const norm: CalibrationLanguage = (lang || "es").toLowerCase().startsWith("en") ? "en" : "es";
  const startTheta = typeof initialTheta === "number" ? initialTheta : 0.0;
  const initialItem = selectNextCatItem({
    lang: norm,
    theta: startTheta,
    answeredIds: [],
  }, bank);

  return {
    lang: norm,
    step: 0,
    maxSteps: CAT_MAX_STEPS,
    theta: startTheta,
    standardError: Number((1 / Math.sqrt(CAT_PRIOR_PRECISION)).toFixed(4)),
    answeredIds: [],
    history: [],
    currentItem: initialItem,
    isComplete: false,
    wasSkipped: false,
  };
}

/**
 * Procesa la respuesta del lector a la palabra actual ('known: boolean'),
 * actualiza el estimador bayesiano EAP amortiguado, evalúa criterios de parada (6 a 8 clics)
 * y selecciona el próximo ítem con P ≈ 0.50.
 */
export function submitCatAnswer(
  state: CatSessionState,
  known: boolean,
  bank?: CalibrationBankItem[],
): CatSessionState {
  if (state.isComplete || !state.currentItem) {
    return state;
  }

  const item = state.currentItem;
  const alpha = item.discrimination ?? 1.35;
  const y = known ? 1 : 0;
  const p = itemResponseProbability(state.theta, item.difficulty, alpha);
  const itemInfo = itemFisherInformation(state.theta, item.difficulty, alpha);

  // Información Fisher acumulada incluyendo el prior
  const historyInfo = state.history.reduce((acc, record) => {
    const a = 1.35;
    const prob = record.probabilityAtPresentation;
    return acc + a * a * prob * (1 - prob);
  }, 0);
  const iTotal = CAT_PRIOR_PRECISION + historyInfo + itemInfo;
  const nextSe = Number((1 / Math.sqrt(iTotal)).toFixed(4));

  // Actualización bayesiana con paso ágil en las primeras interacciones
  const agileFactor = state.step < 2 ? 1.35 : 1.0;
  const damping = Math.max(1.1, (iTotal - 1.5) * 0.65);
  const delta = (agileFactor * alpha * (y - p)) / damping;
  const nextTheta = Math.max(-2.5, Math.min(2.5, Number((state.theta + delta).toFixed(4))));

  const record: CatResponseRecord = {
    itemId: item.id,
    word: item.word,
    difficulty: item.difficulty,
    known,
    thetaBefore: state.theta,
    thetaAfter: nextTheta,
    probabilityAtPresentation: Number(p.toFixed(4)),
  };

  const nextStep = state.step + 1;
  const stepDelta = Math.abs(nextTheta - state.theta);
  const nextAnsweredIds = [...state.answeredIds, item.id];
  const nextHistory = [...state.history, record];

  // Criterio de parada adaptativo: 6 a 8 clics
  const reachedConvergence =
    nextStep >= CAT_MIN_STEPS &&
    (nextSe <= CAT_SE_CONVERGENCE_THRESHOLD || stepDelta < 0.12);
  const reachedMax = nextStep >= state.maxSteps;

  const candidateNextItem =
    reachedConvergence || reachedMax
      ? null
      : selectNextCatItem({
          lang: state.lang,
          theta: nextTheta,
          answeredIds: nextAnsweredIds,
        }, bank);

  const isComplete = reachedMax || reachedConvergence || candidateNextItem === null;

  if (isComplete) {
    persistCatCompletion(state.lang, nextTheta);
  }

  return {
    ...state,
    step: nextStep,
    theta: nextTheta,
    standardError: nextSe,
    answeredIds: nextAnsweredIds,
    history: nextHistory,
    currentItem: isComplete ? null : candidateNextItem,
    isComplete,
    wasSkipped: false,
  };
}

/**
 * Salta la calibración en curso preservando la regla Zero-Friction.
 */
export function skipCatSession(state: CatSessionState): CatSessionState {
  skipLanguageCalibration(state.lang);
  return {
    ...state,
    isComplete: true,
    wasSkipped: true,
    currentItem: null,
  };
}

/**
 * Persiste el resultado del examen adaptativo en profile-models.ts y registra el idioma como completado.
 */
export function persistCatCompletion(lang: CalibrationLanguage, finalTheta: number): void {
  const norm: CalibrationLanguage = (lang || "es").toLowerCase().startsWith("en") ? "en" : "es";
  const profile = loadUserLanguageProfile();
  const updatedProfile: UserLanguageProfile = {
    ...profile,
    theta: norm === "es" ? finalTheta : (profile.theta ?? finalTheta),
    thetaByLang: {
      ...profile.thetaByLang,
      [norm]: finalTheta,
    },
    uncertaintyByLang: {
      ...profile.uncertaintyByLang,
      [norm]: 0.35,
    },
  };
  saveUserLanguageProfile(updatedProfile);
  saveUserTheta(finalTheta, norm);
  markLanguageCalibrated(norm);
}

/**
 * Marca internamente y en almacenamiento que el idioma ha completado la calibración.
 */
export function markLanguageCalibrated(lang: string): void {
  const norm = (lang || "es").toLowerCase().startsWith("en") ? "en" : "es";
  inMemoryCalibrationStatus.set(norm, "done");
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(calibrationDoneKey(norm), "1");
      window.localStorage.setItem(`lecta:cat_calibrated:${norm}`, "1");
    } catch {
      // ignorar quota error
    }
  }
}

/**
 * Marca que el usuario decidió omitir la calibración para este idioma.
 */
export function markLanguageSkipped(lang: string): void {
  const norm = (lang || "es").toLowerCase().startsWith("en") ? "en" : "es";
  inMemoryCalibrationStatus.set(norm, "skipped");
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(calibrationDoneKey(norm), "1");
      window.localStorage.setItem(`lecta:cat_skipped:${norm}`, "1");
    } catch {
      // ignorar quota error
    }
  }
}

/**
 * Omite la calibración para el idioma dado por decisión del usuario (Zero-Friction),
 * inicializa theta_u,L = 0.0 si no tenía valor previo, y asegura que la lectura nunca sea bloqueada.
 */
export function skipLanguageCalibration(lang: CalibrationLanguage | string): void {
  const norm: CalibrationLanguage = (lang || "es").toLowerCase().startsWith("en") ? "en" : "es";
  const profile = loadUserLanguageProfile();
  const currentTheta = profile.thetaByLang?.[norm];

  // Si no tenía valor previo, inicializa theta neutro 0.0
  if (typeof currentTheta !== "number" || !Number.isFinite(currentTheta)) {
    const updatedProfile: UserLanguageProfile = {
      ...profile,
      theta: norm === "es" ? 0.0 : (profile.theta ?? 0.0),
      thetaByLang: {
        ...profile.thetaByLang,
        [norm]: 0.0,
      },
    };
    saveUserLanguageProfile(updatedProfile);
    saveUserTheta(0.0, norm);
  }

  markLanguageSkipped(norm);
}

/**
 * Devuelve true únicamente si el usuario no ha completado ni saltado la calibración en ese idioma específico.
 */
export function needsLanguageCalibration(lang: string): boolean {
  const lower = (lang || "es").toLowerCase().trim();
  const norm: CalibrationLanguage | null = lower.startsWith("en") ? "en" : lower.startsWith("es") ? "es" : null;
  if (!norm) return false;

  const mem = inMemoryCalibrationStatus.get(norm);
  if (mem === "done" || mem === "skipped") return false;

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      if (
        window.localStorage.getItem(calibrationDoneKey(norm)) === "1" ||
        window.localStorage.getItem(`lecta:cat_calibrated:${norm}`) === "1" ||
        window.localStorage.getItem(`lecta:cat_skipped:${norm}`) === "1"
      ) {
        return false;
      }
    } catch {
      // ignorar error de acceso a storage
    }
  }

  return true;
}

