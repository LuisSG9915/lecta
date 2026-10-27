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

// θ vive en una sola escala: la Rasch que ya usan el CAT y el lector
// (betaFromZipf = 4 − zipf, neutra en 0.0). La llave vieja
// `lecta:user_theta:*` guardaba 7 − zipf (neutra en 4.0): se migra una
// sola vez restando 3 y nunca se vuelve a escribir.
export const USER_THETA_KEY = "lecta:user_theta:v1";
export const THETA_MIGRATION_KEY = "lecta:theta_migrated:v2";

// En la escala vieja (7 − zipf), cualquier umbral válido (1.5..4.5)
// daba un θ ≥ 2.5. Valores menores ya estaban en escala Rasch/CAT
// (saltar la calibración escribía 0.0): restarles 3 hundiría el nivel.
export const LEGACY_THETA_MIN_RAW = 2.5;

export type ThetaByLang = { es: number; en: number; [lang: string]: number };

/** Llave heredada, solo para migrar: ya no se escribe. */
export function userThetaKeyForLang(lang = "es"): string {
  return `lecta:user_theta:${lang.toLowerCase().split(/[-_]/)[0] || "es"}:v1`;
}

export function clampTheta(theta: number): number {
  return Number(Math.max(-3.5, Math.min(3.5, theta)).toFixed(4));
}

/**
 * Migración de una sola vez desde la escala vieja (7 − zipf, neutra en 4.0)
 * a la viva (4 − zipf, neutra en 0.0): θ_B = θ_A − 3. La llave heredada se
 * conserva como respaldo un release; el perfil manda desde aquí.
 */
export function migrateLegacyTheta(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (window.localStorage.getItem(THETA_MIGRATION_KEY) === "1") return;
    const profile = loadUserLanguageProfile();
    const thetaByLang = { ...(profile.thetaByLang || {}) };
    const langs = new Set([...Object.keys(thetaByLang), "es", "en"]);
    let changed = false;
    for (const lang of langs) {
      const already = thetaByLang[lang];
      // Un θ ya calibrado en la escala nueva manda: no se pisa.
      if (typeof already === "number" && Number.isFinite(already) && already !== 0) continue;
      const raw =
        window.localStorage.getItem(userThetaKeyForLang(lang)) ??
        (lang.startsWith("es") ? window.localStorage.getItem(USER_THETA_KEY) : null);
      if (raw == null) continue;
      const legacy = parseFloat(raw);
      if (!Number.isFinite(legacy)) continue;
      thetaByLang[lang] =
        legacy >= LEGACY_THETA_MIN_RAW ? clampTheta(legacy - 3) : clampTheta(legacy);
      changed = true;
    }
    if (changed) {
      saveUserLanguageProfile({
        ...profile,
        theta: thetaByLang.es ?? profile.theta,
        thetaByLang,
      });
    }
    window.localStorage.setItem(THETA_MIGRATION_KEY, "1");
  } catch {
    // sin almacenamiento no hay nada que migrar
  }
}

/**
 * θ del lector en la escala viva (4 − zipf). `loadUserTheta` se conserva con
 * el nombre histórico; el segundo argumento viejo (umbral) ya no aplica.
 */
export function loadUserTheta(language = "es"): number {
  migrateLegacyTheta();
  return getLanguageTheta(language);
}

/** Escribe θ en el perfil por idioma (escala 4 − zipf). Única llave viva. */
export function saveUserTheta(theta: number, language = "es"): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const norm = (language || "es").slice(0, 2).toLowerCase() || "es";
  const profile = loadUserLanguageProfile();
  const value = clampTheta(theta);
  saveUserLanguageProfile({
    ...profile,
    theta: norm === "es" ? value : (profile.theta ?? value),
    thetaByLang: { ...(profile.thetaByLang || {}), [norm]: value },
  });
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
