import {
  loadSessionValue,
  saveSessionValue,
  StaleScopeError,
  type DbScope,
} from "./idb";
import type { LexiconEntry } from "./lexicon";
import { getLanguageTheta } from "./profile-models";
import { COVERAGE_FLUID_MIN, COVERAGE_IDEAL_MIN } from "./coverage";

// Catálogo público de Lecta: clásicos de dominio público servidos por
// el worker desde R2 (`/api/catalog*` en src/worker/catalog.ts). Las
// respuestas se respaldan en la cuenta local (session keys) para que la
// estantería con Descubre siga dibujando sin conexión; el manifiesto de
// vocabulario de cada libro se cachea aparte — se usa para la insignia
// de cobertura y no se vuelve a pedir.

export type CatalogBook = {
  id: string;
  gutenbergId: number;
  title: string;
  author: string;
  language?: string;
  issued?: string | null;
  subjects?: string[];
  wordCount?: number;
  uniqueForms?: number;
  epubBytes?: number | null;
  // SHA-256 del EPUB publicado: coincide con el hash que saveBook
  // asigna al guardarlo — la insignia «Ya lo tienes» y el botón
  // «Abrir» salen de esta comparación sin descargar nada.
  epubSha256?: string;
  cover: boolean;
  moodTags?: string[];
  difficulty?: number | string;
};

export type CatalogIndex = {
  generatedAt?: string;
  bookCount: number;
  books: CatalogBook[];
};

// Manifiesto resuelto que emite catalog-seed.mjs (--seed): entradas del
// léxico deduplicadas y, por forma, los índices que la reconocen. Las
// bases clíticas/«-mente» también vienen como llaves para que
// predictSection resuelva igual que con un análisis en vivo.
export type BookVocabManifest = {
  v: number;
  wordCount: number;
  uniqueForms: number;
  // Formas propias del libro analizadas (sin stopwords). `byForm` lleva
  // además las bases clíticas/«-mente» como llaves de respaldo — no son
  // formas del libro y por eso no van en `forms`.
  forms: string[];
  entries: { id: string | null; lemma: string; pos: string | null; zipf: number | null }[];
  byForm: Record<string, number[]>;
  missing: string[];
  occurrences?: Record<string, number>;
};

const INDEX_KEY = "catalogIndex:v1";
const vocabKey = (id: string) => `catalogVocab:v1:${id}`;

const fetchJson = async (path: string) => {
  const response = await fetch(path);
  if (!response.ok) return null;
  return response.json();
};

export function isCatalogIndex(data: unknown): data is CatalogIndex {
  if (typeof data !== "object" || data === null) return false;
  const books = (data as CatalogIndex).books;
  return (
    Array.isArray(books) &&
    books.every(
      (b) =>
        typeof b?.id === "string" &&
        typeof b?.title === "string" &&
        typeof b?.author === "string",
    )
  );
}

// Índice del catálogo: red primero, caché de sesión como respaldo
// offline. Null cuando no hay ni red ni caché — la sección Descubre se
// omite entera en ese caso (descubrimiento nunca bloquea la estantería).
export async function listCatalog(scope?: DbScope): Promise<CatalogIndex | null> {
  const fresh = await fetchJson("/api/catalog").catch(() => null);
  if (isCatalogIndex(fresh)) {
    void saveSessionValue(INDEX_KEY, JSON.stringify(fresh), scope).catch(
      (error) => {
        if (error instanceof StaleScopeError) return;
      },
    );
    return fresh;
  }
  const cached = await loadSessionValue(INDEX_KEY, scope).catch(() => null);
  if (cached == null) return null;
  try {
    const parsed = JSON.parse(cached);
    return isCatalogIndex(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isVocabManifest(data: unknown): data is BookVocabManifest {
  const m = data as BookVocabManifest;
  return (
    typeof m === "object" &&
    m !== null &&
    m.v === 1 &&
    Array.isArray(m.forms) &&
    Array.isArray(m.entries) &&
    typeof m.byForm === "object" &&
    m.byForm !== null &&
    Array.isArray(m.missing)
  );
}

// Reconstruye la vista que predictSection consume: a cada forma sus
// entradas ya deduplicadas. Los campos que la cobertura no usa
// (freqRank, senses) quedan vacíos — no viajaron en el manifiesto.
export function entriesByFormOf(
  manifest: BookVocabManifest,
): Record<string, LexiconEntry[]> {
  const out: Record<string, LexiconEntry[]> = {};
  for (const [form, idxs] of Object.entries(manifest.byForm)) {
    const entries: LexiconEntry[] = [];
    for (const idx of idxs) {
      const slim = manifest.entries[idx];
      if (!slim) continue;
      entries.push({
        entryId: slim.id,
        lemma: slim.lemma,
        pos: slim.pos,
        freqRank: null,
        zipf: slim.zipf,
        senses: [],
      });
    }
    if (entries.length) out[form] = entries;
  }
  return out;
}

// Formas del libro para la cobertura: la lista explícita del manifiesto
// (sin stopwords). Las llaves extra de `byForm` son solo bases de
// respaldo para predictSection — no son formas propias del libro.
export function manifestBookForms(manifest: BookVocabManifest): string[] {
  return manifest.forms;
}

// El manifiesto es inmutable para un id (el libro no cambia): caché
// primero, red solo si falta. Un fetch por montaje por cada libro del
// riel saldría carísimo.
export async function catalogVocab(
  id: string,
  scope?: DbScope,
): Promise<BookVocabManifest | null> {
  const cached = await loadSessionValue(vocabKey(id), scope).catch(() => null);
  if (cached != null) {
    try {
      const parsed = JSON.parse(cached);
      if (isVocabManifest(parsed)) return parsed;
    } catch {
      // Caché corrupto: se re-descarga.
    }
  }
  const fresh = await fetchJson(`/api/catalog/${id}/vocab`).catch(() => null);
  if (!isVocabManifest(fresh)) return null;
  void saveSessionValue(vocabKey(id), JSON.stringify(fresh), scope).catch(
    (error) => {
      if (error instanceof StaleScopeError) return;
    },
  );
  return fresh;
}

export const catalogCoverUrl = (id: string) => `/api/catalog/${id}/cover`;

export const CURATED_MOOD_TAGS: Record<string, string[]> = {
  quijote: ["Vocabulario Elevado", "Clásico Universal"],
  celestina: ["Teatro y Drama", "Vocabulario Elevado"],
  lazarillo: ["Ideal para sesiones de 10 min", "Picaresca"],
  regenta: ["Narrativa Profunda", "Vocabulario Elevado"],
  "fortunata-jacinta": ["Novela de Época", "Vocabulario Elevado"],
  marianela: ["Ideal para sesiones de 10 min", "Realismo"],
  "cuentos-amor": ["Ideal para sesiones de 10 min", "Cuentos de Amor"],
  "poemas-dario": ["Poesía y Modernismo", "Ideal para sesiones de 10 min"],
  "obras-becquer": ["Poesía y Modernismo", "Ideal para sesiones de 10 min"],
  "fuente-ovejuna": ["Ideal para sesiones de 10 min", "Teatro Clásico"],
  "si-de-las-ninas": ["Ideal para sesiones de 10 min", "Comedia"],
  buscon: ["Picaresca", "Vocabulario Elevado"],
  "amistad-funesta": ["Ideal para sesiones de 10 min", "Romántica"],
  ariel: ["Vocabulario Elevado", "Ensayo Filosófico"],
  "navidad-montanas": ["Ideal para sesiones de 10 min", "Costumbrismo"],
  "cuentos-mi-tiempo": ["Ideal para sesiones de 10 min", "Cuentos"],
  "cuentos-ingenuos": ["Ideal para sesiones de 10 min", "Narrativa Breve"],
};

export function getBookMoodTags(book: CatalogBook): string[] {
  if (book.moodTags && book.moodTags.length > 0) return book.moodTags;
  if (CURATED_MOOD_TAGS[book.id]) return CURATED_MOOD_TAGS[book.id];
  const tags: string[] = [];
  if (book.wordCount && book.wordCount < 25_000) {
    tags.push("Ideal para sesiones de 10 min");
  } else if (book.wordCount && book.wordCount > 90_000) {
    tags.push("Vocabulario Elevado");
  }
  if (book.subjects?.some((s) => /poes[ií]a|modernism/i.test(s))) {
    tags.push("Poesía y Modernismo");
  }
  if (tags.length === 0) {
    tags.push("Clásico Literario");
  }
  return tags;
}

// Descarga el EPUB del catálogo y lo devuelve como File listo para el
// flujo normal de «Añadir libro» (misma validación y dedup por hash que
// cualquier EPUB local).
export async function downloadCatalogEpub(
  book: CatalogBook,
): Promise<File | null> {
  const response = await fetch(`/api/catalog/${book.id}/epub`).catch(
    () => null,
  );
  if (!response?.ok) return null;
  const data = await response.blob();
  const name = `${book.title} — ${book.author}.epub`;
  return new File([data], name, { type: "application/epub+zip" });
}

export interface BookAffinityBadge {
  tone: "ideal" | "relaxed" | "supported";
  label: string;       // Ej: 'Ideal para tu ritmo' | 'Lectura relajada' | 'Con apoyo bilingüe'
  description: string; // Explicación breve de 1 línea
}

/**
 * Calcula una etiqueta cálida y empática de afinidad lectora comparando el nivel
 * léxico del usuario (theta) con la dificultad estimada del libro.
 */
export function getBookAffinityBadge(
  bookLang = "es",
  bookDifficultyOrLevel?: string | number,
  userTheta?: number,
): BookAffinityBadge {
  const normLang = (bookLang || "es").slice(0, 2).toLowerCase();
  const theta =
    typeof userTheta === "number" && Number.isFinite(userTheta)
      ? userTheta
      : getLanguageTheta(normLang);
  const isL2 = normLang !== "es";

  // Atajos si se especifica el tono de forma directa
  if (bookDifficultyOrLevel === "ideal") {
    return {
      tone: "ideal",
      label: "Ideal para tu ritmo",
      description: "Fluidez natural con nuevas palabras a tu medida",
    };
  }
  if (bookDifficultyOrLevel === "relaxed") {
    return {
      tone: "relaxed",
      label: "Lectura relajada",
      description: "Para disfrutar de corrido y sin esfuerzo",
    };
  }
  if (bookDifficultyOrLevel === "supported") {
    return {
      tone: "supported",
      label: isL2 ? "Con apoyo bilingüe" : "Con apoyo inteligente",
      description: "Lecta activará pistas previas para que no pierdas el hilo",
    };
  }

  // Si se pasa un porcentaje de cobertura de vocabulario (0 a 100)
  if (typeof bookDifficultyOrLevel === "number" && bookDifficultyOrLevel > 10) {
    if (bookDifficultyOrLevel >= COVERAGE_FLUID_MIN) {
      return {
        tone: "relaxed",
        label: "Lectura relajada",
        description: "Para disfrutar de corrido y sin esfuerzo",
      };
    }
    if (bookDifficultyOrLevel >= COVERAGE_IDEAL_MIN) {
      return {
        tone: "ideal",
        label: "Ideal para tu ritmo",
        description: "Fluidez natural con nuevas palabras a tu medida",
      };
    }
    return {
      tone: "supported",
      label: isL2 ? "Con apoyo bilingüe" : "Con apoyo inteligente",
      description: "Lecta activará pistas previas para que no pierdas el hilo",
    };
  }

  // Dificultad estimada intrínseca (escala beta de Rasch / nivel MCER)
  let diffValue = 0.0;
  if (typeof bookDifficultyOrLevel === "number") {
    diffValue = bookDifficultyOrLevel;
  } else if (typeof bookDifficultyOrLevel === "string") {
    const upper = bookDifficultyOrLevel.toUpperCase().trim();
    if (upper === "A1") diffValue = -1.5;
    else if (upper === "A2") diffValue = -0.8;
    else if (upper === "B1") diffValue = 0.0;
    else if (upper === "B2") diffValue = 0.8;
    else if (upper === "C1") diffValue = 1.6;
    else if (upper === "C2") diffValue = 2.4;
    else {
      const parsed = parseFloat(bookDifficultyOrLevel);
      if (Number.isFinite(parsed)) {
        diffValue = parsed;
      } else if (/f[aá]cil|easy|principiante|b[aá]sico/i.test(bookDifficultyOrLevel)) {
        diffValue = -1.0;
      } else if (/dif[ií]cil|hard|avanzado|elevado/i.test(bookDifficultyOrLevel)) {
        diffValue = 1.2;
      } else {
        diffValue = 0.0;
      }
    }
  }

  const delta = diffValue - theta;

  if (delta > 0.4 || (isL2 && theta < 0.2 && delta >= -0.2)) {
    return {
      tone: "supported",
      label: isL2 ? "Con apoyo bilingüe" : "Con apoyo inteligente",
      description: "Lecta activará pistas previas para que no pierdas el hilo",
    };
  }
  if (delta < -0.4) {
    return {
      tone: "relaxed",
      label: "Lectura relajada",
      description: "Para disfrutar de corrido y sin esfuerzo",
    };
  }
  return {
    tone: "ideal",
    label: "Ideal para tu ritmo",
    description: "Fluidez natural con nuevas palabras a tu medida",
  };
}

