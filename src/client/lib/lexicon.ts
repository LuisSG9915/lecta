import { accountFetch } from "./account-fetch";
import {
  getCachedLexicon,
  getCachedLexiconBatch,
  loadSavedWord,
  saveCachedLexicon,
  saveCachedLexiconBatch,
  type DbScope,
} from "./idb";
import {
  calibrationFallbackDefinition,
  calibrationBankZipf,
} from "../../shared/calibration-bank";

export type LexiconEntry = {
  // int8 de unique_rowid() (~1.2e18 > 2^53): viaja como string por
  // JSON — un number lo truncaría y la acepción dejaría de resolver.
  entryId: string | null;
  lemma: string;
  pos: string | null;
  freqRank: number | null;
  // Frecuencia medida (wordfreq ~0–8); null cuando la ficha no tiene
  // medición. Es el criterio de rareza: freqRank es solo estimación IA.
  zipf: number | null;
  senses: { definition: string; example: string | null; senseOrder: number | null }[];
};

export type LookupResult =
  | { ok: true; found: boolean; entries: LexiconEntry[]; offline?: boolean }
  | { ok: false; error: string; offline?: boolean };

type LexiconResponseBody = {
  found?: boolean;
  entries?: LexiconEntry[] | Record<string, LexiconEntry[]>;
  error?: string;
};

function getCalibrationBankFallbackEntry(form: string, language: string): LexiconEntry | null {
  const normalized = form.trim().toLowerCase();
  const def = calibrationFallbackDefinition(normalized, language);
  if (!def) return null;
  return {
    entryId: null,
    lemma: normalized,
    pos: null,
    freqRank: null,
    zipf: calibrationBankZipf(normalized, language),
    senses: [
      {
        definition: def,
        example: null,
        senseOrder: 1,
      },
    ],
  };
}

export async function lookupWord(
  form: string,
  language = "es",
  scope?: DbScope,
): Promise<LookupResult> {
  // Si el navegador avisa que no hay red, consultar memoria local de inmediato
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const cached = await getCachedLexicon(language, form, scope).catch(() => null);
    if (cached && cached.length > 0) {
      return { ok: true, found: true, entries: cached, offline: true };
    }
    const saved = await loadSavedWord(language, form, scope).catch(() => null);
    if (saved?.meaning?.trim()) {
      const fallbackEntry: LexiconEntry = {
        entryId: saved.senseEntryId ?? null,
        lemma: saved.lemma ?? saved.form,
        pos: saved.pos ?? null,
        freqRank: null,
        zipf: null,
        senses: [
          {
            definition: saved.meaning,
            example: saved.context ?? null,
            senseOrder: saved.senseOrder ?? 1,
          },
        ],
      };
      return { ok: true, found: true, entries: [fallbackEntry], offline: true };
    }
    const bankFallback = getCalibrationBankFallbackEntry(form, language);
    if (bankFallback) {
      return { ok: true, found: true, entries: [bankFallback], offline: true };
    }
    return {
      ok: false,
      error: "Sin conexión con el catálogo. Esta palabra aún no está en la memoria local.",
      offline: true,
    };
  }

  const params = new URLSearchParams({ form, lang: language });
  try {
    const response = await accountFetch(`/api/lexicon/lookup?${params}`, undefined, scope);
    if (response.status === 404) {
      const bankFallback = getCalibrationBankFallbackEntry(form, language);
      if (bankFallback) {
        return { ok: true, found: true, entries: [bankFallback], offline: true };
      }
      return { ok: true, found: false, entries: [] };
    }
    const data = (await response.json()) as LexiconResponseBody;
    if (!response.ok) {
      const cached = await getCachedLexicon(language, form, scope).catch(() => null);
      if (cached && cached.length > 0) {
        return { ok: true, found: true, entries: cached, offline: true };
      }
      const bankFallback = getCalibrationBankFallbackEntry(form, language);
      if (bankFallback) {
        return { ok: true, found: true, entries: [bankFallback], offline: true };
      }
      return { ok: false, error: data.error ?? "No se pudo consultar el catálogo." };
    }
    const found = Boolean(data.found);
    const entries = (data.entries as LexiconEntry[]) ?? [];
    if (found && entries.length > 0) {
      void saveCachedLexicon(language, form, entries, scope).catch(() => undefined);
      return { ok: true, found, entries };
    }
    const bankFallback = getCalibrationBankFallbackEntry(form, language);
    if (bankFallback) {
      return { ok: true, found: true, entries: [bankFallback], offline: true };
    }
    return { ok: true, found, entries };
  } catch {
    // Sin conexión: consultar memoria local de fichas cacheadas
    const cached = await getCachedLexicon(language, form, scope).catch(() => null);
    if (cached && cached.length > 0) {
      return { ok: true, found: true, entries: cached, offline: true };
    }
    // Segundo respaldo: palabras guardadas en el Cuaderno
    const saved = await loadSavedWord(language, form, scope).catch(() => null);
    if (saved?.meaning?.trim()) {
      const fallbackEntry: LexiconEntry = {
        entryId: saved.senseEntryId ?? null,
        lemma: saved.lemma ?? saved.form,
        pos: saved.pos ?? null,
        freqRank: null,
        zipf: null,
        senses: [
          {
            definition: saved.meaning,
            example: saved.context ?? null,
            senseOrder: saved.senseOrder ?? 1,
          },
        ],
      };
      return { ok: true, found: true, entries: [fallbackEntry], offline: true };
    }
    const bankFallback = getCalibrationBankFallbackEntry(form, language);
    if (bankFallback) {
      return { ok: true, found: true, entries: [bankFallback], offline: true };
    }
    return {
      ok: false,
      error: "Sin conexión con el catálogo. Esta palabra aún no está en la memoria local.",
      offline: true,
    };
  }
}

export type BatchLookupResult =
  | { ok: true; entries: Record<string, LexiconEntry[]> }
  | { ok: false; error: string; entries: Record<string, never> };

// El catálogo acepta hasta 2,000 formas por petición: listas más
// largas se reparten en lotes secuenciales y sus respuestas se
// fusionan. Un lote fallido invalida el análisis completo — las
// formas ya servidas no se clasifican a medias.
export const BATCH_LOOKUP_LIMIT = 2000;

export async function batchLookup(
  forms: string[],
  language = "es",
  scope?: DbScope,
): Promise<BatchLookupResult> {
  const unique = [...new Set(forms.filter(Boolean))];
  if (!unique.length) return { ok: true, entries: {} };

  // Si no hay conexión evidente en el navegador, resolver con memoria local
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const cached = await getCachedLexiconBatch(language, unique, scope).catch(() => ({}));
    return { ok: true, entries: cached };
  }

  const entries: Record<string, LexiconEntry[]> = {};
  for (let i = 0; i < unique.length; i += BATCH_LOOKUP_LIMIT) {
    const chunk = unique.slice(i, i + BATCH_LOOKUP_LIMIT);
    try {
      const response = await accountFetch(
        "/api/lexicon/batch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ forms: chunk, language }),
        },
        scope,
      );
      const data = (await response.json()) as LexiconResponseBody;
      if (!response.ok) {
        const cached = await getCachedLexiconBatch(language, chunk, scope).catch(() => ({}));
        if (Object.keys(cached).length > 0) {
          Object.assign(entries, cached);
          continue;
        }
        return { ok: false, error: data.error ?? "No se pudo consultar el catálogo.", entries: {} };
      }
      const chunkEntries = (data.entries as Record<string, LexiconEntry[]>) ?? {};
      Object.assign(entries, chunkEntries);
      void saveCachedLexiconBatch(language, chunkEntries, scope).catch(() => undefined);
    } catch {
      const cached = await getCachedLexiconBatch(language, chunk, scope).catch(() => ({}));
      if (Object.keys(cached).length > 0) {
        Object.assign(entries, cached);
        continue;
      }
      return { ok: false, error: "Sin conexión con el catálogo.", entries: {} };
    }
  }
  return { ok: true, entries };
}

export type EnrichBatchResult =
  | { ok: true; instanceId?: string; count: number; error?: undefined }
  | { ok: false; error: string };

export async function enrichBatch(
  forms: string[],
  language = "es",
  scope?: DbScope,
): Promise<EnrichBatchResult> {
  try {
    const response = await accountFetch(
      "/api/lexicon/enrich-batch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ forms, language }),
      },
      scope,
    );
    const data = (await response.json()) as {
      instanceId?: string;
      count?: number;
      error?: string;
    };
    if (!response.ok) {
      return { ok: false, error: data.error ?? "No se pudo programar el lote." };
    }
    return { ok: true, instanceId: data.instanceId, count: data.count ?? 0 };
  } catch {
    return { ok: false, error: "Sin conexión con el catálogo." };
  }
}

export async function enrichWord(
  form: string,
  language = "es",
  context?: string,
  scope?: DbScope,
  nativeLanguage?: string,
): Promise<LookupResult> {
  try {
    const response = await accountFetch(
      "/api/lexicon/enrich",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ form, language, context, nativeLanguage }),
      },
      scope,
    );
    const data = (await response.json()) as LexiconResponseBody;
    if (!response.ok) return { ok: false, error: data.error ?? "La IA no pudo definir la palabra." };
    const entries = (data.entries as LexiconEntry[]) ?? [];
    if (entries.length > 0) {
      void saveCachedLexicon(language, form, entries, scope).catch(() => undefined);
    }
    return { ok: true, found: true, entries };
  } catch {
    return { ok: false, error: "Sin conexión con el catálogo." };
  }
}

export type ExplainResult =
  // degraded: la IA no respondió y el servidor sirvió la acepción del
  // catálogo — no es una explicación contextual, se marca al lector.
  | { ok: true; explanation: string; degraded?: boolean }
  | { ok: false; error: string };

// «Explicar en esta oración»: la acepción del catálogo define la
// palabra en general; esto dice qué sentido aplica en la oración
// concreta. Es una llamada IA explícita (cuota propia), efímera y
// sin escritura al catálogo — el significado de diccionario sigue
// siendo la respuesta que no gasta tokens.
export async function explainInContext(
  form: string,
  language = "es",
  context?: string,
  scope?: DbScope,
  nativeLanguage?: string,
): Promise<ExplainResult> {
  try {
    const response = await accountFetch(
      "/api/lexicon/explain",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ form, language, context, nativeLanguage }),
      },
      scope,
    );
    const data = (await response.json()) as {
      explanation?: string;
      degraded?: boolean;
      error?: string;
    };
    if (!response.ok)
      return { ok: false, error: data.error ?? "La IA no pudo explicar la palabra." };
    if (!data.explanation)
      return { ok: false, error: "La IA no devolvió una explicación válida." };
    return { ok: true, explanation: data.explanation, degraded: data.degraded === true };
  } catch {
    return { ok: false, error: "Sin conexión con el catálogo." };
  }
}

export interface ExplainInPassageInput {
  word?: string;
  sentence: string;
  bookTitle?: string;
  author?: string;
  language?: string;
  nativeLanguage?: string;
}

export type ExplainInPassageResult =
  | {
      ok: true;
      contextualMeaning: string;
      toneAndNuance: string;
      catTip: string;
      degraded?: boolean;
    }
  | { ok: false; error: string };

export async function explainInPassage(
  input: ExplainInPassageInput,
  scope?: DbScope,
): Promise<ExplainInPassageResult> {
  try {
    const response = await accountFetch(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      scope,
    );
    const data = (await response.json()) as {
      contextualMeaning?: string;
      toneAndNuance?: string;
      catTip?: string;
      error?: string;
    };
    if (!response.ok) {
      return { ok: false, error: data.error ?? "No se pudo obtener la explicación." };
    }
    if (!data.contextualMeaning) {
      return { ok: false, error: "La IA no devolvió una explicación válida." };
    }
    return {
      ok: true,
      contextualMeaning: data.contextualMeaning,
      toneAndNuance: data.toneAndNuance || "Literario",
      catTip: data.catTip || "Una resonancia sutil en el texto.",
    };
  } catch {
    return { ok: false, error: "Sin conexión con el servicio de IA." };
  }
}

export interface CharacterRecapInput {
  entityName: string;
  bookTitle?: string;
  currentChapterTitle?: string;
  excerptsSoFar: string[];
}

export type CharacterRecapResult =
  | { ok: true; summary: string; role?: string; fallback?: boolean }
  | { ok: false; error: string };

export async function requestCharacterRecap(
  input: CharacterRecapInput,
  scope?: DbScope,
): Promise<CharacterRecapResult> {
  try {
    const response = await accountFetch(
      "/api/ai/character-recap",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      scope,
    );
    const data = (await response.json()) as {
      summary?: string;
      role?: string;
      fallback?: boolean;
      error?: string;
    };
    if (!response.ok) {
      return { ok: false, error: data.error ?? "No se pudo obtener el resumen del personaje." };
    }
    if (!data.summary) {
      return { ok: false, error: "La IA no devolvió un resumen válido." };
    }
    return {
      ok: true,
      summary: data.summary,
      role: data.role,
      fallback: data.fallback,
    };
  } catch {
    const first = input.excerptsSoFar[0]?.trim();
    let summary = `${input.entityName.trim()} ha aparecido en la lectura previa hasta este capítulo.`;
    if (first) {
      summary += ` Primera aparición registrada: «${first.length > 140 ? first.slice(0, 137) + "…" : first}».`;
    }
    return {
      ok: true,
      summary,
      role: "Personaje / Lugar de la obra",
      fallback: true,
    };
  }
}

export type ReportResult = { ok: true } | { ok: false; error: string };

// Marca una acepción del catálogo como «no corresponde» (botón de
// reporte del panel de palabra). Requiere sesión; el servidor sube el
// contador editorial de esa fila de lexicon_senses.
export async function reportSense(
  entryId: string,
  senseOrder: number,
  scope?: DbScope,
): Promise<ReportResult> {
  try {
    const response = await accountFetch(
      "/api/lexicon/report",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId, senseOrder }),
      },
      scope,
    );
    const data = (await response.json()) as { error?: string };
    if (!response.ok)
      return { ok: false, error: data.error ?? "No se pudo enviar el reporte." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Sin conexión con el catálogo." };
  }
}

// ---------- Ítems de ejercicio (Nivel B) ----------

// `options` ya trae mezclada la definición correcta con los
// distractores (orden estable por id, decidido en el servidor);
// `answerIndex` marca cuál es la buena.
export type LexiconItem = {
  id: string;
  entryId: string | null;
  senseOrder: number;
  sentence: string;
  options: string[];
  answerIndex: number;
  attempts: number;
  correct: number;
};

export type ItemsResult =
  | { ok: true; items: LexiconItem[] }
  | { ok: false; error: string };

// Pide ítems para una lista de acepciones (entryId + senseOrder). El
// entryId es int8 > 2^53 y viaja como string: quien tenga una fila
// vieja en number lo convierte con String() al armar el ref.
// El servidor sirve los que ya existen y genera con IA los que falten
// (tope por llamada); los que no se puedan generar simplemente no
// llegan en `items`.
export async function fetchItems(
  refs: { entryId: string; senseOrder: number }[],
  scope?: DbScope,
): Promise<ItemsResult> {
  try {
    const response = await accountFetch(
      "/api/lexicon/items",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refs }),
      },
      scope,
    );
    const data = (await response.json()) as { items?: LexiconItem[]; error?: string };
    if (!response.ok)
      return { ok: false, error: data.error ?? "No se pudieron cargar los ejercicios." };
    return { ok: true, items: data.items ?? [] };
  } catch {
    return { ok: false, error: "Sin conexión con el catálogo." };
  }
}

// Registra el resultado de un intento de ejercicio (sube attempts y,
// si acertó, correct). Devuelve false si no se pudo registrar — el
// contador es estadística editorial, no bloquea la práctica.
export async function answerItem(
  id: string,
  correct: boolean,
  scope?: DbScope,
): Promise<boolean> {
  try {
    const response = await accountFetch(
      "/api/lexicon/items/answer",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, correct }),
      },
      scope,
    );
    return response.ok;
  } catch {
    return false;
  }
}

export type VerifyResult =
  | { ok: true; correct: boolean; feedback: string }
  | { ok: false; error: string };

// Corrección IA de la oración que escribe el usuario (ejercicio
// «write»). Solo viajan la forma, el sentido esperado y el texto —
// nunca el contexto del libro.
export async function verifySentence(
  form: string,
  meaning: string,
  sentence: string,
  scope?: DbScope,
  language = "es",
  nativeLanguage = "es",
): Promise<VerifyResult> {
  try {
    const response = await accountFetch(
      "/api/lexicon/verify-sentence",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ form, meaning, sentence, language, nativeLanguage }),
      },
      scope,
    );
    const data = (await response.json()) as {
      correct?: boolean;
      feedback?: string;
      error?: string;
    };
    if (!response.ok)
      return { ok: false, error: data.error ?? "No se pudo revisar la oración." };
    return {
      ok: true,
      correct: data.correct === true,
      feedback: data.feedback ?? "",
    };
  } catch {
    return { ok: false, error: "Sin conexión con el catálogo." };
  }
}
