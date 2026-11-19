import { accountFetch } from "./account-fetch";
import {
  getCachedLexicon,
  getCachedLexiconBatch,
  loadSavedWord,
  saveCachedLexicon,
  saveCachedLexiconBatch,
  type DbScope,
  type WordMeaning,
} from "./idb";
import type { LexiconEntry } from "../../shared/lexicon";
import { generateLookupCandidates } from "../../shared/word-form";
export type { LexiconEntry };

export type LookupResult =
  | { ok: true; found: boolean; entries: LexiconEntry[]; offline?: boolean }
  | { ok: false; error: string; offline?: boolean };

type LexiconResponseBody = {
  found?: boolean;
  entries?: LexiconEntry[] | Record<string, LexiconEntry[]>;
  error?: string;
};

// Caché en memoria para resolución instantánea (<50 ms / 0 ms) al hacer tap
const lexiconMemoryCache = new Map<string, LexiconEntry[]>();

export function primeLexiconMemoryCache(
  entriesByForm: Record<string, LexiconEntry[]> | Map<string, LexiconEntry[]>,
): void {
  if (entriesByForm instanceof Map) {
    for (const [form, entries] of entriesByForm.entries()) {
      lexiconMemoryCache.set(form.toLowerCase(), entries);
    }
  } else {
    for (const [form, entries] of Object.entries(entriesByForm)) {
      lexiconMemoryCache.set(form.toLowerCase(), entries);
    }
  }
}

export function clearLexiconMemoryCache(): void {
  lexiconMemoryCache.clear();
}

export function getLexiconMemoryCacheSize(): number {
  return lexiconMemoryCache.size;
}

export function lookupWordInMemory(
  form: string,
  sentenceOrLang = "es",
): (LookupResult & Partial<WordMeaning>) | null {
  const language =
    sentenceOrLang && sentenceOrLang.length <= 5 && !sentenceOrLang.includes(" ")
      ? sentenceOrLang
      : "es";
  const norm = form.trim().toLowerCase();
  const candidates = generateLookupCandidates(norm, language);
  for (const cand of candidates) {
    const memKey = `${language}:${cand}`;
    const memEntries = lexiconMemoryCache.get(memKey) ?? lexiconMemoryCache.get(cand);
    if (memEntries && memEntries.length > 0) {
      return enrichResult({ ok: true, found: true, entries: memEntries, offline: true }, form);
    }
  }
  return null;
}

// Diccionario local descargable (es/en): consulta el paquete solo si
// está instalado — la primera consulta lee la meta y la recuerda.
async function lookupDictionaryPackLayer(form: string, language: string): Promise<LexiconEntry | null> {
  if (language !== "es" && language !== "en") return null;
  const { lookupDictionaryPack } = await import("./dictionaryPack");
  for (const cand of generateLookupCandidates(form, language)) {
    const entry = await lookupDictionaryPack(cand, language);
    if (entry) return entry;
  }
  return null;
}

async function getCalibrationBankFallbackEntry(form: string, language: string): Promise<LexiconEntry | null> {
  const { calibrationFallbackDefinition, calibrationBankZipf } = await import("../../shared/calibration-bank");
  for (const cand of generateLookupCandidates(form, language)) {
    const normalized = cand.trim().toLowerCase();
    const def = calibrationFallbackDefinition(normalized, language);
    if (!def) continue;
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
  return null;
}

async function resolveEnglishCoreEntry(form: string): Promise<LexiconEntry | null> {
  const { getEnglishCoreEntry } = await import("../../shared/english-core-lexicon");
  for (const cand of generateLookupCandidates(form, "en")) {
    const entry = getEnglishCoreEntry(cand);
    if (entry) return entry;
  }
  return null;
}

async function normalizeLookupForm(form: string): Promise<string> {
  return form
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
}

async function lookupWordRaw(
  form: string,
  language = "es",
  scope?: DbScope,
): Promise<LookupResult> {
  const normalized = await normalizeLookupForm(form);
  if (!normalized) {
    return { ok: true, found: false, entries: [] };
  }

  const memKey = `${language}:${normalized}`;

  // 1. Resolución ultra-rápida (0 ms) en caché de memoria
  const memCached = lexiconMemoryCache.get(memKey) ?? lexiconMemoryCache.get(normalized);
  if (memCached && memCached.length > 0) {
    return { ok: true, found: true, entries: memCached, offline: true };
  }

  // 2. Resolución local inmediata (<50 ms) en IndexedDB (lexicon cache y cuaderno)
  const cached = await getCachedLexicon(language, form, scope).catch(() => null);
  if (cached && cached.length > 0) {
    lexiconMemoryCache.set(memKey, cached);
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
    lexiconMemoryCache.set(memKey, [fallbackEntry]);
    return { ok: true, found: true, entries: [fallbackEntry], offline: true };
  }

  const packEntry = await lookupDictionaryPackLayer(normalized, language);
  if (packEntry) {
    lexiconMemoryCache.set(memKey, [packEntry]);
    return { ok: true, found: true, entries: [packEntry], offline: true };
  }

  const bankFallback = await getCalibrationBankFallbackEntry(form, language);
  if (bankFallback) {
    lexiconMemoryCache.set(memKey, [bankFallback]);
    return { ok: true, found: true, entries: [bankFallback], offline: true };
  }

  const englishCore = await resolveEnglishCoreEntry(normalized);
  if (englishCore) {
    lexiconMemoryCache.set(memKey, [englishCore]);
    return { ok: true, found: true, entries: [englishCore], offline: true };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      ok: false,
      error: "Sin conexión con el catálogo. Esta palabra aún no está en la memoria local.",
      offline: true,
    };
  }

  const params = new URLSearchParams({ form: normalized, lang: language });
  try {
    const response = await accountFetch(`/api/lexicon/lookup?${params}`, undefined, scope);
    if (response.status === 404) {
      for (const cand of generateLookupCandidates(normalized, language).slice(1, 6)) {
        try {
          const candResponse = await accountFetch(
            `/api/lexicon/lookup?${new URLSearchParams({ form: cand, lang: language })}`,
            undefined,
            scope,
          );
          if (candResponse.status === 404) continue;
          const candData = (await candResponse.json()) as LexiconResponseBody;
          const candEntries = (candData.entries as LexiconEntry[]) ?? [];
          if (candResponse.ok && candData.found && candEntries.length > 0) {
            lexiconMemoryCache.set(memKey, candEntries);
            void saveCachedLexicon(language, form, candEntries, scope).catch(() => undefined);
            return { ok: true, found: true, entries: candEntries };
          }
        } catch {
          // continuar
        }
      }
      const bankFallback = await getCalibrationBankFallbackEntry(normalized, language);
      if (bankFallback) {
        return { ok: true, found: true, entries: [bankFallback], offline: true };
      }
      const englishCore = await resolveEnglishCoreEntry(normalized);
      if (englishCore) {
        return { ok: true, found: true, entries: [englishCore], offline: true };
      }
      return { ok: true, found: false, entries: [] };
    }
    const data = (await response.json()) as LexiconResponseBody;
    if (!response.ok) {
      const cached = await getCachedLexicon(language, form, scope).catch(() => null);
      if (cached && cached.length > 0) {
        return { ok: true, found: true, entries: cached, offline: true };
      }
      const bankFallback = await getCalibrationBankFallbackEntry(normalized, language);
      if (bankFallback) {
        return { ok: true, found: true, entries: [bankFallback], offline: true };
      }
      const englishCore = await resolveEnglishCoreEntry(normalized);
      if (englishCore) {
        return { ok: true, found: true, entries: [englishCore], offline: true };
      }
      return { ok: false, error: data.error ?? "No se pudo consultar el catálogo." };
    }
    const found = Boolean(data.found);
    const entries = (data.entries as LexiconEntry[]) ?? [];
    if (found && entries.length > 0) {
      lexiconMemoryCache.set(memKey, entries);
      void saveCachedLexicon(language, form, entries, scope).catch(() => undefined);
      return { ok: true, found, entries };
    }
    // La forma exacta no está en el catálogo: probar candidatos (flexiones)
    // para cubrir plurales, gerundios, participios, etc., especialmente en
    // inglés, donde la tabla de formas puede no incluir todas las variantes.
    for (const cand of generateLookupCandidates(normalized, language).slice(1, 6)) {
      try {
        const candResponse = await accountFetch(
          `/api/lexicon/lookup?${new URLSearchParams({ form: cand, lang: language })}`,
          undefined,
          scope,
        );
        if (candResponse.status === 404) continue;
        const candData = (await candResponse.json()) as LexiconResponseBody;
        const candEntries = (candData.entries as LexiconEntry[]) ?? [];
        if (candResponse.ok && candData.found && candEntries.length > 0) {
          lexiconMemoryCache.set(memKey, candEntries);
          void saveCachedLexicon(language, form, candEntries, scope).catch(() => undefined);
          return { ok: true, found: true, entries: candEntries };
        }
      } catch {
        // continuar con el siguiente candidato
      }
    }
    const bankFallback = await getCalibrationBankFallbackEntry(form, language);
    if (bankFallback) {
      return { ok: true, found: true, entries: [bankFallback], offline: true };
    }
    const englishCore = await resolveEnglishCoreEntry(normalized);
    if (englishCore) {
      return { ok: true, found: true, entries: [englishCore], offline: true };
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
    const bankFallback = await getCalibrationBankFallbackEntry(form, language);
    if (bankFallback) {
      return { ok: true, found: true, entries: [bankFallback], offline: true };
    }
    const englishCore = await resolveEnglishCoreEntry(normalized);
    if (englishCore) {
      return { ok: true, found: true, entries: [englishCore], offline: true };
    }
    return {
      ok: false,
      error: "Sin conexión con el catálogo. Esta palabra aún no está en la memoria local.",
      offline: true,
    };
  }
}

function enrichResult(res: LookupResult, form: string): LookupResult & WordMeaning {
  const firstEntry = res.ok && res.entries.length ? res.entries[0] : undefined;
  const lemma = firstEntry?.lemma ?? form;
  const partOfSpeech = firstEntry?.pos ?? undefined;
  const defs = firstEntry?.senses?.map((s) => s.definition) ?? [];
  const examples = (firstEntry?.senses?.map((s) => s.example).filter(Boolean) as string[]) ?? [];
  const contextual = defs[0] || "";

  return {
    ...res,
    word: form,
    lemma,
    partOfSpeech,
    ContextualMeaning: contextual,
    definitions: defs,
    examples,
    source: 'offline' in res && res.offline ? "offline" : "catalog",
  };
}

export async function lookupWord(
  form: string,
  sentenceOrLang = "es",
  scope?: DbScope,
): Promise<LookupResult & Partial<WordMeaning>> {
  const language =
    sentenceOrLang && sentenceOrLang.length <= 5 && !sentenceOrLang.includes(" ")
      ? sentenceOrLang
      : "es";
  const raw = await lookupWordRaw(form, language, scope);
  return enrichResult(raw, form);
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
    let response = await accountFetch(
      "/api/ai/enrich",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ form, language, context, nativeLanguage }),
      },
      scope,
    );
    if (response.status === 404) {
      response = await accountFetch(
        "/api/lexicon/enrich",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ form, language, context, nativeLanguage }),
        },
        scope,
      );
    }
    const data = (await response.json()) as LexiconResponseBody;
    if (!response.ok) {
      const core = await resolveEnglishCoreEntry(form);
      if (core) {
        return { ok: true, found: true, entries: [core], offline: true };
      }
      return { ok: false, error: data.error ?? "La IA no pudo definir la palabra." };
    }
    const entries = (data.entries as LexiconEntry[]) ?? [];
    if (entries.length > 0) {
      void saveCachedLexicon(language, form, entries, scope).catch(() => undefined);
      return { ok: true, found: true, entries };
    }
    const core = await resolveEnglishCoreEntry(form);
    if (core) {
      return { ok: true, found: true, entries: [core], offline: true };
    }
    return { ok: true, found: true, entries };
  } catch {
    const core = await resolveEnglishCoreEntry(form);
    if (core) {
      return { ok: true, found: true, entries: [core], offline: true };
    }
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
  sentence?: string;
  passage?: string;
  lemma?: string;
  localDefinition?: string;
  bookTitle?: string;
  bookId?: string;
  author?: string;
  language?: string;
  nativeLanguage?: string;
}

export type ExplainInPassageResult =
  | {
      ok: true;
      directMeaning?: string;
      contextualMeaning: string;
      contextualNuance?: string;
      toneAndNuance: string;
      catTip: string;
      dictionary?: {
        word: string | null;
        lemma: string | null;
        definition: string | null;
      } | null;
      dictionaryEntry?: {
        word: string | null;
        lemma: string | null;
        definition: string | null;
      } | null;
      degraded?: boolean;
    }
  | { ok: false; error: string; code?: typeof LECTA_PLUS_REQUIRED };

/** Código del 402 de las rutas de Lecta+ (docs/designs/2026-11-12-planes-y-landing.md). */
export const LECTA_PLUS_REQUIRED = "LECTA_PLUS_REQUIRED" as const;

const planCode = (status: number, data: { code?: unknown } | null) =>
  status === 402 && data?.code === LECTA_PLUS_REQUIRED ? { code: LECTA_PLUS_REQUIRED } : {};

export async function explainInPassage(
  input: ExplainInPassageInput,
  scope?: DbScope,
): Promise<ExplainInPassageResult> {
  const sentence = input.sentence || input.passage || "";
  const payload = {
    ...input,
    sentence,
    passage: sentence,
  };
  try {
    const response = await accountFetch(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      scope,
    );
    const data = (await response.json()) as {
      directMeaning?: string;
      contextualMeaning?: string;
      toneAndNuance?: string;
      catTip?: string;
      error?: string;
      code?: string;
    };
    if (!response.ok) {
      return {
        ok: false,
        error: data.error ?? "No se pudo obtener la explicación.",
        ...planCode(response.status, data),
      };
    }
    if (!data.contextualMeaning && !data.directMeaning) {
      return { ok: false, error: "La IA no devolvió una explicación válida." };
    }
    return {
      ok: true,
      directMeaning: data.directMeaning,
      contextualMeaning: data.contextualMeaning || data.directMeaning || "",
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

export type ShownSenseRef = {
  form: string;
  lang: string;
  lemma?: string | null;
  entryId?: string | null;
  senseOrder?: number | null;
};

const normalizeSenseText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Reporta la acepción que el panel muestra. Con ids del servidor los usa
// tal cual; el pack local no los trae, así que consulta el catálogo por red
// y empata por definición normalizada. Sin empate: aviso amable, no técnico.
export async function reportShownSense(
  ref: ShownSenseRef,
  shownDefinition: string,
  scope?: DbScope,
): Promise<ReportResult> {
  const notNow: ReportResult = { ok: false, error: "No pudimos reportarla ahora." };
  if (ref.entryId && ref.senseOrder != null) {
    const res = await reportSense(ref.entryId, ref.senseOrder, scope);
    return res.ok ? res : notNow;
  }
  const target = normalizeSenseText(shownDefinition);
  const forms = [...new Set([ref.form, ref.lemma].filter((x): x is string => Boolean(x)))];
  for (const form of forms) {
    try {
      const response = await accountFetch(
        `/api/lexicon/lookup?${new URLSearchParams({ form, lang: ref.lang })}`,
        undefined,
        scope,
      );
      if (!response.ok) continue;
      const data = (await response.json()) as LexiconResponseBody;
      const entries = Array.isArray(data.entries) ? data.entries : [];
      for (const entry of entries) {
        if (!entry.entryId) continue;
        const hit = entry.senses.find(
          (sn) => sn.definition && normalizeSenseText(sn.definition) === target,
        );
        if (hit) {
          const res = await reportSense(String(entry.entryId), hit.senseOrder ?? 1, scope);
          return res.ok ? res : notNow;
        }
      }
    } catch {
      return notNow;
    }
  }
  return notNow;
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
  | { ok: false; error: string; code?: typeof LECTA_PLUS_REQUIRED };

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
    const data = (await response.json()) as { items?: LexiconItem[]; error?: string; code?: string };
    if (!response.ok)
      return {
        ok: false,
        error: data.error ?? "No se pudieron cargar los ejercicios.",
        ...planCode(response.status, data),
      };
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
  | { ok: false; error: string; planRequired?: boolean };

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
    const data = (await response.json().catch(() => ({}))) as {
      correct?: boolean;
      feedback?: string;
      error?: string;
      code?: string;
    };
    if (response.status === 402 && data.code === "LECTA_PLUS_REQUIRED")
      return { ok: false, error: "Requiere Lecta+.", planRequired: true };
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
