export type KnowledgeEvidence = { zipf: number | null; known: boolean };

export type VocabProfile = {
  threshold: number;
  confidence: "low" | "mid" | "high";
};

// Umbrales base por defecto según el perfil del lector.
export const DEFAULT_THRESHOLD_NATIVE = 2.0;
export const DEFAULT_THRESHOLD_LEARNER = 3.0;
export const DEFAULT_THRESHOLD = DEFAULT_THRESHOLD_LEARNER;

export const CANDIDATES = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0] as const;
export const PROFILE_REGULARIZATION = 2;
export const MIN_THRESHOLD = 1.0;
export const MAX_THRESHOLD = 5.5;
export const PROFILE_ADJUST_KEY = "profileAdjust";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function estimateProfile(
  evidence: KnowledgeEvidence[],
  adjust = 0,
  baseThreshold = DEFAULT_THRESHOLD,
): VocabProfile {
  const usable = evidence.flatMap((item) =>
    item.zipf == null ? [] : [{ zipf: item.zipf, known: item.known }],
  );
  let best = baseThreshold;
  if (usable.length) {
    let bestScore = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const t of CANDIDATES) {
      let errors = 0;
      for (const item of usable) {
        if (item.known && item.zipf < t) errors += 1;
        if (!item.known && item.zipf >= t) errors += 1;
      }
      const distance = Math.abs(t - baseThreshold);
      const score = errors + PROFILE_REGULARIZATION * distance;
      if (score < bestScore || (score === bestScore && distance < bestDistance)) {
        bestScore = score;
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

// ---------- Modelos candidatos del umbral de sugerencias ----------
//
// Todos responden la misma pregunta con la misma evidencia — «¿a
// partir de qué zipf predigo conocida?»— para que la evaluación
// cronológica (profile-eval) compare los mismos dos errores:
//   · falsa alarma: el lector la conoce pero el umbral la sugiere;
//   · omisión: el lector no la conoce pero el umbral la da por sabida.
// Ninguno está activado en producción: la comparación decide cuál
// sustituye a la línea base.

export type SelectorModel = (evidence: KnowledgeEvidence[]) => number;

// Rejilla de umbrales candidatos, la misma que usa estimateProfile.
export const THRESHOLD_CANDIDATES = [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

const measured = (evidence: KnowledgeEvidence[]) =>
  evidence.filter(
    (item): item is KnowledgeEvidence & { zipf: number } =>
      typeof item.zipf === "number" && Number.isFinite(item.zipf),
  );

const errorsAt = (items: { zipf: number; known: boolean }[], t: number) =>
  items.reduce(
    (n, item) => n + (item.zipf! >= t === item.known ? 0 : 1),
    0,
  );

// Línea base previa: minimiza errores sin regularización (a empate
// gana el más cercano al valor base 3.0). Ya no es el selector — se
// conserva solo para la comparación cronológica.
export const legacyModel: SelectorModel = (evidence) => {
  const items = measured(evidence);
  let best = 3.0;
  let bestErrors = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const t of THRESHOLD_CANDIDATES) {
    const errors = errorsAt(items, t);
    const distance = Math.abs(t - 3.0);
    if (errors < bestErrors || (errors === bestErrors && distance < bestDistance)) {
      best = t;
      bestErrors = errors;
      bestDistance = distance;
    }
  }
  return best;
};

// Selector vigente: estimateProfile, ya con la regularización λ=2.
export const currentModel: SelectorModel = (evidence) =>
  estimateProfile(evidence).threshold;

// Regularizado hacia el valor base: el conteo de errores más un
// castigo por alejarse de 3.0. Con λ=2, una muestra corta de «la
// conozco» raras ya no arrastra el umbral al extremo — es la caída a
// 1.5 que vimos en las pruebas reales: ahí 1.5 ganaba por un solo
// error menos y el castigo lo revierte.
export function regularizedModel(
  evidence: KnowledgeEvidence[],
  lambda = 2,
  base = 3.0,
): number {
  const items = measured(evidence);
  let best = base;
  let bestScore = errorsAt(items, base) + lambda * 0;
  for (const t of THRESHOLD_CANDIDATES) {
    const score = errorsAt(items, t) + lambda * Math.abs(t - base);
    if (
      score < bestScore ||
      (score === bestScore && Math.abs(t - base) < Math.abs(best - base))
    ) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

// Estimación por bandas: tasa de «no la conozco» por banda zipf de
// 0.5, suavizada (Laplace) hacia la tasa global. El umbral queda en
// el borde superior de la banda más alta que aún se desconoce con
// probabilidad ≥ 0.5 — por debajo se predice desconocida.
export function bandModel(evidence: KnowledgeEvidence[], alpha = 2): number {
  const items = measured(evidence);
  if (!items.length) return 3.0;
  const edges = [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5];
  const globalUnknown = items.filter((i) => !i.known).length / items.length;
  let threshold = 1.5;
  for (let i = 0; i + 1 < edges.length; i++) {
    const band = items.filter((item) => item.zipf! >= edges[i] && item.zipf! < edges[i + 1]);
    const unknown = band.filter((item) => !item.known).length;
    const rate = (unknown + alpha * globalUnknown) / (band.length + alpha);
    if (rate >= 0.5) threshold = edges[i + 1];
  }
  return threshold;
}

// ---------- Evaluación cronológica ----------
//
// Para cada lote: los modelos se ajustan SOLO con la evidencia
// anterior y se evalúan en ese lote — así nada del futuro «prueba»
// el comportamiento pasado. Filas de entrada: evidencia ya resuelta
// por lema efectivo con su zipf.

export type EvalRow = {
  zipf: number;
  known: boolean;
  source: string;
  batch: number;
};

export type BatchResult = {
  batch: number;
  threshold: number;
  tested: number;
  falseAlarms: number;
  misses: number;
};

export type ModelResult = {
  model: string;
  batches: BatchResult[];
  falseAlarms: number;
  misses: number;
};

export function evaluateChronological(
  rows: readonly EvalRow[],
  models: Record<string, SelectorModel>,
): ModelResult[] {
  const batches = [...new Set(rows.map((row) => row.batch))].sort(
    (a, b) => a - b,
  );
  return Object.entries(models).map(([model, select]) => {
    const results: BatchResult[] = [];
    let falseAlarms = 0;
    let misses = 0;
    for (const batch of batches) {
      const train = rows.filter((row) => row.batch < batch);
      const test = rows.filter((row) => row.batch === batch);
      if (!train.length || !test.length) continue;
      const threshold = select(train);
      let fa = 0;
      let om = 0;
      for (const row of test) {
        const predictedKnown = row.zipf >= threshold;
        if (predictedKnown && !row.known) om++;
        if (!predictedKnown && row.known) fa++;
      }
      falseAlarms += fa;
      misses += om;
      results.push({ batch, threshold, tested: test.length, falseAlarms: fa, misses: om });
    }
    return { model, batches: results, falseAlarms, misses };
  });
}

// ---------- Nivel de usuario (theta) y micro-ajustes en vivo ----------

export const DEFAULT_ETA = 0.04;
export const USER_THETA_KEY = "lecta:user_theta:v1";

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Calcula la dificultad léxica del ítem b_w a partir de su escala zipf.
 * Zipf típico en español: 1.0 (rarísima) a 7.0 (muy común).
 * b_w = 7.0 - zipf, por lo que b_w va de 0.0 (fácil) a 6.0 (difícil).
 */
export function wordDifficulty(zipf: number | null | undefined): number {
  if (zipf == null || !Number.isFinite(zipf)) return 4.0;
  return Math.max(0, 7.0 - zipf);
}

/**
 * Convierte el umbral de perfil en un valor inicial de theta de usuario.
 * Para threshold base 3.0 -> theta = 4.0.
 */
export function thetaFromThreshold(threshold: number): number {
  return Math.max(0, 7.0 - threshold);
}

export function defaultTheta(threshold = 3.0): number {
  return thetaFromThreshold(threshold);
}

/**
 * Probabilidad logística de desconocer la palabra:
 * P(unknown | w, theta) = 1 / (1 + exp(alpha * (theta - b_w)))
 */
export function probUnknown(theta: number, bw: number, alpha = 1.0): number {
  return 1 / (1 + Math.exp(alpha * (theta - bw)));
}

/**
 * Micro-ajuste al marcar "✓ Ya la sé":
 * Si b_w > theta: theta <- theta + eta * sigma(b_w - theta) con eta = 0.04.
 */
export function adjustThetaOnKnown(
  currentTheta: number,
  bw: number,
  eta = DEFAULT_ETA,
): { newTheta: number; adjusted: boolean; delta: number } {
  if (bw > currentTheta) {
    const delta = eta * sigmoid(bw - currentTheta);
    return { newTheta: currentTheta + delta, adjusted: true, delta };
  }
  return { newTheta: currentTheta, adjusted: false, delta: 0 };
}

/**
 * Micro-ajuste inverso al fijar una palabra "fácil" en el cuaderno:
 * Si b_w < theta - 0.5: theta <- theta - eta * sigma((theta - 0.5) - bw) con eta = 0.04.
 */
export function adjustThetaOnEasyPin(
  currentTheta: number,
  bw: number,
  eta = DEFAULT_ETA,
): { newTheta: number; adjusted: boolean; delta: number } {
  if (bw < currentTheta - 0.5) {
    const delta = eta * sigmoid((currentTheta - 0.5) - bw);
    return { newTheta: currentTheta - delta, adjusted: true, delta };
  }
  return { newTheta: currentTheta, adjusted: false, delta: 0 };
}

export type ThetaByLang = { es: number; en: number; [lang: string]: number };

export function userThetaKeyForLang(lang = "es"): string {
  return `lecta:user_theta:${lang.toLowerCase().split(/[-_]/)[0] || "es"}:v1`;
}

/**
 * Carga el theta_user persistido para el idioma especificado o lo inicializa a partir del umbral actual.
 */
export function loadUserTheta(fallbackThreshold = 3.0, language = "es"): number {
  if (typeof window === "undefined" || !window.localStorage) {
    return thetaFromThreshold(fallbackThreshold);
  }
  try {
    const langKey = userThetaKeyForLang(language);
    const raw =
      window.localStorage.getItem(langKey) ??
      (language.toLowerCase().startsWith("es")
        ? window.localStorage.getItem(USER_THETA_KEY)
        : null);
    if (raw) {
      const val = parseFloat(raw);
      if (Number.isFinite(val)) return val;
    }
  } catch {
    // fallback
  }
  return thetaFromThreshold(fallbackThreshold);
}

export function saveUserTheta(theta: number, language = "es"): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const val = theta.toFixed(4);
    const langKey = userThetaKeyForLang(language);
    window.localStorage.setItem(langKey, val);
    if (language.toLowerCase().startsWith("es")) {
      window.localStorage.setItem(USER_THETA_KEY, val);
    }
  } catch {
    // ignorar error de quota
  }
}

export function loadThetaByLang(fallbackThreshold = 3.0): ThetaByLang {
  return {
    es: loadUserTheta(fallbackThreshold, "es"),
    en: loadUserTheta(fallbackThreshold, "en"),
  };
}

export function saveThetaForLang(language: string, theta: number): void {
  saveUserTheta(theta, language);
}

// ---------- Modelo Psicométrico Adaptativo por Idioma (Rasch 1PL & Elo) ----------

export type SupportedBookLang = "es" | "en" | string;

export interface MultilingualThetaProfile {
  /** Nivel theta principal (mantenido por retrocompatibilidad con tests actuales) */
  theta?: number;
  /** Mapa desacoplado de habilidad léxica por código de idioma ISO (ej. { es: 1.4, en: -0.2 }) */
  thetaByLang?: Record<string, number>;
  /** Preferencia adaptativa de cantidad de palabras pre-capítulo (Cowan: 3 a 5) */
  preferredPreviewCount?: number;
  /** Contador de capítulos donde el usuario saltó la tarjeta sin interactuar */
  consecutivePreviewSkips?: number;
}

export const DEFAULT_THETA_L1 = 0.0;
export const DEFAULT_THETA_L2 = -0.6;

/**
 * Obtiene el parámetro de habilidad \theta_{u,L} específico para el idioma del libro.
 * Si el idioma aún no tiene calibración registrada, usa el prior de L1 o L2.
 */
export function getThetaForLanguage(
  profile: Partial<MultilingualThetaProfile> | null | undefined,
  bookLang: SupportedBookLang = "es",
  nativeLang: SupportedBookLang = "es",
): number {
  const normLang = (bookLang || "es").slice(0, 2).toLowerCase();
  const normNative = (nativeLang || "es").slice(0, 2).toLowerCase();

  if (profile?.thetaByLang && typeof profile.thetaByLang[normLang] === "number") {
    return profile.thetaByLang[normLang];
  }

  // Fallback retrocompatible: si el libro está en el idioma nativo, usa profile.theta
  if (normLang === normNative && typeof profile?.theta === "number") {
    return profile.theta;
  }

  return normLang === normNative ? DEFAULT_THETA_L1 : DEFAULT_THETA_L2;
}

/**
 * Probabilidad a priori de que el usuario conozca la palabra según Rasch 1PL:
 * P(conoce_{u,w}) = 1 / (1 + exp(-(theta_{u,L} - beta_w)))
 */
export function raschPriorKnowProbability(thetaUL: number, betaW: number): number {
  const diff = Math.max(-10, Math.min(10, thetaUL - betaW));
  return 1 / (1 + Math.exp(-diff));
}

/**
 * Recuperabilidad FSRS R(t, S) = (1 + (19/81) * (t / S))^(-0.5)
 * donde t son los días transcurridos desde la última exposición y S la estabilidad.
 */
export function fsrsRetrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + (19 / 81) * (t / stability), -0.5);
}

/**
 * Probabilidad combinada P(conoce_{u,w}):
 * Sustituye el prior de Rasch por la Recuperabilidad R(t, S) si la palabra ya existe
 * en el historial del usuario (007_user_knowledge.sql / 004_user_reviews.sql).
 */
export function estimateWordKnowProbability(params: {
  thetaUL: number;
  betaW: number;
  knowledgeStatus?: "known" | "learning" | "seen" | "unknown" | null;
  stability?: number | null;
  lastSeenTimestampMs?: number | null;
  nowMs?: number;
}): number {
  const {
    thetaUL,
    betaW,
    knowledgeStatus,
    stability,
    lastSeenTimestampMs,
    nowMs = Date.now(),
  } = params;

  if (knowledgeStatus === "known") {
    return 0.99;
  }

  if (
    typeof stability === "number" &&
    stability > 0 &&
    typeof lastSeenTimestampMs === "number" &&
    lastSeenTimestampMs > 0
  ) {
    const elapsedDays = Math.max(0, (nowMs - lastSeenTimestampMs) / 86_400_000);
    return fsrsRetrievability(elapsedDays, stability);
  }

  return raschPriorKnowProbability(thetaUL, betaW);
}

/**
 * Actualización dinámica de \theta_{u,L} a través de los 3 canales de competencia:
 * - 'explicit_known': Usuario toca "✓ Ya la sé" en vista pre-capítulo (sube \theta proporcional a \beta_w).
 * - 'lookup_surprise': Usuario consulta la palabra en WordPanel.tsx (baja \theta si se asumía conocida).
 * - 'passive_frontier': Lectura fluida del capítulo sin consultar palabra frontera (\theta \approx \beta_w).
 */
export function updateThetaForLanguageSignal(
  profile: MultilingualThetaProfile,
  lang: SupportedBookLang,
  betaW: number,
  signal: "explicit_known" | "lookup_surprise" | "passive_frontier",
): MultilingualThetaProfile & { thetaByLang: Record<string, number> } {
  const normLang = (lang || "es").slice(0, 2).toLowerCase();
  const currentTheta = getThetaForLanguage(profile, normLang);
  const pKnow = raschPriorKnowProbability(currentTheta, betaW);

  let delta = 0;
  if (signal === "explicit_known") {
    // Mayor ganancia si el usuario ya conoce una palabra difícil (pKnow bajo)
    delta = 0.18 * (1 - pKnow);
  } else if (signal === "lookup_surprise") {
    // Mayor corrección a la baja si el modelo estaba muy seguro de que la conocía (pKnow alto)
    delta = -0.22 * pKnow;
  } else if (signal === "passive_frontier") {
    // Ganancia suave pasiva solo para palabras cercanas a la frontera de dificultad
    const distance = Math.abs(currentTheta - betaW);
    if (distance <= 1.1) {
      delta = 0.035 * (1 - pKnow);
    }
  }

  const nextTheta = Math.max(-3.5, Math.min(3.5, Number((currentTheta + delta).toFixed(4))));
  const nextThetaByLang = {
    ...(profile.thetaByLang || {}),
    [normLang]: nextTheta,
  };

  return {
    ...profile,
    theta: normLang === "es" ? nextTheta : profile.theta,
    thetaByLang: nextThetaByLang,
  };
}

export interface UserLanguageProfile {
  /** Nivel theta principal (sincronizado con thetaByLang['es'] o idioma nativo) */
  theta?: number;
  /** Nivel de competencia léxica theta por idioma (rango típico: -3.0 a +3.5) */
  thetaByLang: Record<string, number>;
  /** Incertidumbre / varianza del estimador por idioma (disminuye conforme el usuario interactúa) */
  uncertaintyByLang: Record<string, number>;
  /** Contador de capítulos completados por idioma */
  chaptersCompletedByLang: Record<string, number>;
  /** Preferencia adaptativa de cantidad de palabras pre-capítulo (Cowan: 3 a 5) */
  preferredPreviewCount?: number;
  /** Contador de capítulos donde el usuario saltó la tarjeta sin interactuar */
  consecutivePreviewSkips?: number;
}

export const DEFAULT_USER_LANGUAGE_PROFILE: UserLanguageProfile = {
  theta: 0.0,
  thetaByLang: { es: 0.0, en: 0.0 },
  uncertaintyByLang: { es: 1.0, en: 1.0 },
  chaptersCompletedByLang: { es: 0, en: 0 },
  preferredPreviewCount: 4,
  consecutivePreviewSkips: 0,
};

export const USER_LANGUAGE_PROFILE_KEY = "lecta:user_language_profile:v1";

export function loadUserLanguageProfile(): UserLanguageProfile {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_USER_LANGUAGE_PROFILE };
  }
  try {
    const raw = window.localStorage.getItem(USER_LANGUAGE_PROFILE_KEY);
    if (!raw) {
      return { ...DEFAULT_USER_LANGUAGE_PROFILE };
    }
    const parsed = JSON.parse(raw) as Partial<UserLanguageProfile>;
    const thetaByLang =
      typeof parsed.thetaByLang === "object" && parsed.thetaByLang !== null
        ? parsed.thetaByLang
        : { es: 0.0, en: 0.0 };
    return {
      theta: typeof parsed.theta === "number" ? parsed.theta : (thetaByLang.es ?? 0.0),
      thetaByLang,
      uncertaintyByLang:
        typeof parsed.uncertaintyByLang === "object" && parsed.uncertaintyByLang !== null
          ? parsed.uncertaintyByLang
          : { es: 1.0, en: 1.0 },
      chaptersCompletedByLang:
        typeof parsed.chaptersCompletedByLang === "object" && parsed.chaptersCompletedByLang !== null
          ? parsed.chaptersCompletedByLang
          : { es: 0, en: 0 },
      preferredPreviewCount: parsed.preferredPreviewCount ?? 4,
      consecutivePreviewSkips: parsed.consecutivePreviewSkips ?? 0,
    };
  } catch {
    return { ...DEFAULT_USER_LANGUAGE_PROFILE };
  }
}

export function saveUserLanguageProfile(profile: UserLanguageProfile): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(USER_LANGUAGE_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignorar fallo de almacenamiento
  }
}

/**
 * Retorna el parámetro theta de habilidad léxica del usuario para el idioma especificado.
 */
export function getLanguageTheta(bookLang = "es", nativeLang = "es"): number {
  const profile = loadUserLanguageProfile();
  return getThetaForLanguage(profile, bookLang, nativeLang);
}

/**
 * Probabilidad Rasch (IRT 1PL) de que el usuario conozca una palabra de dificultad `beta`
 */
export function predictWordMasteryProbability(theta: number, beta: number): number {
  return raschPriorKnowProbability(theta, beta);
}

/**
 * Convierte valor de escala Zipf (1.0 - 7.0) a dificultad intrinsic beta (-3.0 a +3.5).
 */
export function betaFromZipf(zipf: number | null | undefined): number {
  if (zipf == null || !Number.isFinite(zipf)) return 0.5;
  return Number(Math.max(-3.0, Math.min(3.5, 4.0 - zipf)).toFixed(2));
}

/**
 * Actualiza el parámetro theta del usuario en un idioma específico.
 * - outcome = 1: El usuario demostró conocer la palabra ("Ya la sé" o lectura fluida pasiva).
 * - outcome = 0: El usuario desconoce la palabra (la tocó en el capítulo o pidió aprenderla).
 */
export function updateLanguageTheta(
  profileOrLang: UserLanguageProfile | string,
  langOrBeta: string | number,
  wordBetaOrOutcome?: number,
  outcomeOrSignalWeight?: number,
  signalWeight = 1.0,
): UserLanguageProfile {
  let profile: UserLanguageProfile;
  let lang: string;
  let wordBeta: number;
  let outcome: 0 | 1;
  let weight: number;
  let shouldPersist = false;

  if (typeof profileOrLang === "string") {
    shouldPersist = true;
    profile = loadUserLanguageProfile();
    lang = profileOrLang;
    wordBeta = typeof langOrBeta === "number" ? langOrBeta : 0.0;
    outcome = wordBetaOrOutcome === 1 ? 1 : 0;
    weight = typeof outcomeOrSignalWeight === "number" ? outcomeOrSignalWeight : 1.0;
  } else {
    profile = profileOrLang;
    lang = typeof langOrBeta === "string" ? langOrBeta : "es";
    wordBeta = typeof wordBetaOrOutcome === "number" ? wordBetaOrOutcome : 0.0;
    outcome = outcomeOrSignalWeight === 1 ? 1 : 0;
    weight = signalWeight;
  }

  const normalizedLang = lang.slice(0, 2).toLowerCase() || "es";
  const currentTheta = profile.thetaByLang[normalizedLang] ?? 0.0;
  const currentUncertainty = profile.uncertaintyByLang[normalizedLang] ?? 1.0;

  // Probabilidad esperada antes de observar la acción del usuario
  const expected = predictWordMasteryProbability(currentTheta, wordBeta);

  // Tasa de aprendizaje adaptativa (mayor cuando hay poca certeza sobre el usuario)
  const baseK = 0.18 * Math.max(0.35, currentUncertainty) * weight;
  const delta = baseK * (outcome - expected);

  const nextTheta = Math.max(-3.5, Math.min(4.0, currentTheta + delta));
  const nextUncertainty = Math.max(0.25, currentUncertainty * 0.97);

  const updated: UserLanguageProfile = {
    ...profile,
    thetaByLang: {
      ...profile.thetaByLang,
      [normalizedLang]: Number(nextTheta.toFixed(4)),
    },
    uncertaintyByLang: {
      ...profile.uncertaintyByLang,
      [normalizedLang]: Number(nextUncertainty.toFixed(4)),
    },
  };

  if (shouldPersist) {
    saveUserLanguageProfile(updated);
  }

  return updated;
}

export function recordChapterCompleted(lang = "es"): UserLanguageProfile {
  const profile = loadUserLanguageProfile();
  const normalizedLang = lang.slice(0, 2).toLowerCase() || "es";
  const currentCount = profile.chaptersCompletedByLang[normalizedLang] ?? 0;
  const updated: UserLanguageProfile = {
    ...profile,
    chaptersCompletedByLang: {
      ...profile.chaptersCompletedByLang,
      [normalizedLang]: currentCount + 1,
    },
  };
  saveUserLanguageProfile(updated);
  return updated;
}


// ---------- Motor Adaptativo IRT (Calibración 2.0) ----------

export const CALIBRATION_DISCRIMINATION = 1.4;
export const CALIBRATION_PRIOR_THETA = 4.0;
export const CALIBRATION_PRIOR_SIGMA = 1.2;

/**
 * Probabilidad de conocimiento bajo el modelo logístico 2PL:
 * P(y_i = 1 | theta) = 1 / (1 + exp(-a_i * (theta - b_i)))
 */
export function probKnown2PL(
  theta: number,
  b_i: number,
  a_i = CALIBRATION_DISCRIMINATION,
): number {
  return 1 / (1 + Math.exp(-a_i * (theta - b_i)));
}

/**
 * Información de Fisher del ítem i a nivel theta:
 * I_i(theta) = a_i^2 * P_i(theta) * (1 - P_i(theta))
 */
export function fisherInformation(
  theta: number,
  b_i: number,
  a_i = CALIBRATION_DISCRIMINATION,
): number {
  const p = probKnown2PL(theta, b_i, a_i);
  return a_i * a_i * p * (1 - p);
}

/**
 * Selecciona el siguiente ítem adaptativo del banco que maximiza la
 * información de Fisher para el theta actual del usuario.
 */
export function selectNextAdaptiveItem<
  T extends { lemma: string; difficulty?: number; zipf?: number | null },
>(
  pool: readonly T[],
  answeredLemmas: ReadonlySet<string>,
  currentTheta: number,
  a_i = CALIBRATION_DISCRIMINATION,
): T | null {
  const candidates = pool.filter((item) => !answeredLemmas.has(item.lemma));
  if (candidates.length === 0) return null;

  let bestItem: T = candidates[0];
  let bestInfo = -Infinity;

  for (const candidate of candidates) {
    const b_i =
      candidate.difficulty ?? wordDifficulty(candidate.zipf);
    const info = fisherInformation(currentTheta, b_i, a_i);
    if (info > bestInfo) {
      bestInfo = info;
      bestItem = candidate;
    }
  }
  return bestItem;
}

export interface CalibrationResponseItem {
  b_i: number;
  /** Ponderación: 1.0 (conocida), 0.35 (dudosa), 0.0 (desconocida) */
  score: number;
}

/**
 * Estimación Bayesiana MAP (Maximum A Posteriori) de theta con prior normal:
 * ln P(theta | y) = sum_i [ y_i * ln(P_i) + (1 - y_i) * ln(1 - P_i) ] - (theta - mu)^2 / (2 * sigma^2)
 */
export function estimateThetaMAP(
  responses: readonly CalibrationResponseItem[],
  priorMean = CALIBRATION_PRIOR_THETA,
  priorSigma = CALIBRATION_PRIOR_SIGMA,
  a_i = CALIBRATION_DISCRIMINATION,
): number {
  if (responses.length === 0) return priorMean;

  let bestTheta = priorMean;
  let bestLogPost = -Infinity;

  const minTheta = 1.0;
  const maxTheta = 6.0;
  const step = 0.05;

  for (let t = minTheta; t <= maxTheta + 1e-6; t += step) {
    const logPrior =
      -Math.pow(t - priorMean, 2) / (2 * priorSigma * priorSigma);

    let logLikelihood = 0;
    for (const r of responses) {
      const p = probKnown2PL(t, r.b_i, a_i);
      const pSafe = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
      logLikelihood +=
        r.score * Math.log(pSafe) + (1 - r.score) * Math.log(1 - pSafe);
    }

    const logPost = logLikelihood + logPrior;
    if (logPost > bestLogPost) {
      bestLogPost = logPost;
      bestTheta = t;
    }
  }

  return Number(bestTheta.toFixed(2));
}

/**
 * Corrección de sobreconfianza basada en las verificaciones de precisión:
 * theta_final = theta_MAP - 0.35 * (k / max(1, m))
 */
export function applyOverconfidenceCorrection(
  thetaMap: number,
  failedVerifications: number,
  totalVerifications: number,
  penaltyFactor = 0.35,
): number {
  if (totalVerifications <= 0 || failedVerifications <= 0) {
    return thetaMap;
  }
  const penalty =
    penaltyFactor * (failedVerifications / Math.max(1, totalVerifications));
  return Number(Math.max(1.0, thetaMap - penalty).toFixed(2));
}


