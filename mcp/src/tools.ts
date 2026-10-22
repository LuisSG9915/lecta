import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LectaApi, LectaApiError, LectaAuthError } from "./api.js";
import type { LectaConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Tipos de las respuestas de la API (solo lo que este servidor consume)
// ---------------------------------------------------------------------------

type LexiconSense = {
  definition?: string | null;
  example?: string | null;
  senseOrder?: number | null;
};

type LexiconEntry = {
  entryId?: string | null;
  lemma: string;
  pos?: string | null;
  freqRank?: number | null;
  zipf?: number | null;
  senses?: LexiconSense[];
};

type LookupResponse = { found?: boolean; entries?: LexiconEntry[] };
type BatchResponse = { entries?: Record<string, LexiconEntry[]> };

type CatalogBook = {
  id: string;
  title: string;
  author?: string;
  language?: string;
  issued?: string;
  subjects?: string[];
  wordCount?: number;
  uniqueForms?: number;
  epubBytes?: number;
  epubSha256?: string;
  cover?: boolean;
};

type CatalogIndex = {
  generatedAt?: string;
  bookCount?: number;
  books?: CatalogBook[];
};

type CatalogVocabulary = {
  v?: number;
  wordCount?: number;
  uniqueForms?: number;
  forms?: string[];
  entries?: Array<{ id: string; lemma: string; pos?: string | null; zipf?: number | null }>;
  byForm?: Record<string, number[]>;
  missing?: string[];
};

type RemoteBook = {
  hash: string;
  name?: string;
  title?: string;
  author?: string;
  sections?: number;
  language?: string;
  uploaded?: string;
};

type BooksResponse = { books?: RemoteBook[] };

type FsrsCard = {
  due?: string | number;
  last_review?: string | number;
  state?: number;
  reps?: number;
  lapses?: number;
  stability?: number;
  difficulty?: number;
  scheduled_days?: number;
  elapsed_days?: number;
  learning_steps?: number;
};

type UserWord = {
  form: string;
  language?: string;
  lemma?: string | null;
  pos?: string | null;
  meaning?: string | null;
  context?: string | null;
  bookHash?: string | null;
  senseEntryId?: string | null;
  senseOrder?: number | null;
  card?: FsrsCard | null;
  savedAt?: number;
  updatedAt?: number;
  deleted?: boolean;
};

type VocabResponse = {
  words?: UserWord[];
  availableLanguages?: string[];
  hasMore?: boolean;
};

type ActivityRow = {
  id?: string;
  bookHash: string;
  startedAt: number;
  endedAt: number;
};

type ReviewRow = {
  id?: string;
  language?: string;
  form?: string;
  kind?: string;
  rating?: number;
  hints?: number;
  createdAt: number;
};

type PositionRow = {
  bookHash: string;
  sectionIndex?: number;
  progress?: number | null;
  ratio?: number | null;
  updatedAt: number;
};

type AnnotationRow = {
  bookHash: string;
  id: string;
  kind?: string;
  sectionIndex?: number;
  text?: string | null;
  note?: string | null;
  anchor?: string | null;
  createdAt?: number;
  updatedAt?: number;
  deleted?: boolean;
};

type AnnotationsResponse = { annotations?: AnnotationRow[] };

type KnowledgeRow = {
  language?: string;
  lemma: string;
  known?: boolean;
  source?: string;
  updatedAt?: number;
  deleted?: boolean;
};

type KnowledgeResponse = {
  rows?: KnowledgeRow[];
  availableLanguages?: string[];
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const STATE_LABEL: Record<number, string> = {
  0: "nueva",
  1: "aprendiendo",
  2: "repaso",
  3: "reaprendiendo",
};

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown): CallToolResult {
  let message: string;
  if (error instanceof LectaAuthError) {
    message = `${error.message}\n\nSugerencia: exporta LECTA_COOKIE con la cookie better-auth.session_token de una sesión válida, o LECTA_EMAIL y LECTA_PASSWORD.`;
  } else if (error instanceof LectaApiError) {
    message = error.status
      ? `${error.message} (HTTP ${error.status})`
      : error.message;
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Normaliza para búsquedas: minúsculas y sin acentos. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function includesQuery(fields: Array<string | null | undefined>, query: string) {
  const needle = fold(query.trim());
  if (!needle) return true;
  return fields.some((field) => (field ? fold(field).includes(needle) : false));
}

function limitOf(value: number, fallback: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function localDayKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function isoOrNull(value: number | undefined | null): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

function dateMs(value: string | number | undefined | null): number {
  if (value === null || value === undefined) return Number.NaN;
  const ms = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function firstDefinition(entries: LexiconEntry[] | undefined): string | null {
  return (
    entries
      ?.flatMap((entry) => entry.senses ?? [])
      .map((sense) => sense.definition?.trim())
      .find((definition): definition is string => Boolean(definition)) ?? null
  );
}

function stateLabel(state: number | undefined): string {
  if (state === undefined) return "sin tarjeta";
  return STATE_LABEL[state] ?? `estado ${state}`;
}

// El manifiesto de vocabulario de un libro ronda 1–2 MB y es inmutable:
// se mantiene en memoria con un TTL corto y un tope de tres libros.
const VOCAB_CACHE_TTL_MS = 10 * 60_000;
const VOCAB_CACHE_MAX = 3;
const vocabCache = new Map<string, { at: number; data: CatalogVocabulary }>();

async function getCatalogVocabulary(
  api: LectaApi,
  bookId: string,
): Promise<CatalogVocabulary> {
  const cached = vocabCache.get(bookId);
  if (cached && Date.now() - cached.at < VOCAB_CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await api.getJson<CatalogVocabulary>(
    `/api/catalog/${encodeURIComponent(bookId)}/vocab`,
    { anonymous: true },
  );
  if (vocabCache.size >= VOCAB_CACHE_MAX) {
    const oldest = vocabCache.keys().next().value;
    if (oldest) vocabCache.delete(oldest);
  }
  vocabCache.set(bookId, { at: Date.now(), data });
  return data;
}

type WordView = {
  form: string;
  lemma: string | null;
  pos: string | null;
  meaning: string | null;
  meaningFromCatalog: boolean;
  context: string | null;
  bookHash: string | null;
  savedAt: string | null;
  updatedAt: string | null;
  due: string | null;
  dueInDays: number | null;
  state: string;
  reps: number;
  lapses: number;
  stability: number | null;
};

async function fillMissingMeanings(
  api: LectaApi,
  words: UserWord[],
  language: string,
): Promise<Map<string, string>> {
  const missing = [
    ...new Set(
      words
        .filter((word) => !word.meaning?.trim())
        .map((word) => word.form.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 100);
  const result = new Map<string, string>();
  if (!missing.length) return result;

  try {
    const data = await api.postJson<BatchResponse>(
      "/api/lexicon/batch",
      { forms: missing, language },
      { anonymous: true },
    );
    for (const form of missing) {
      const definition = firstDefinition(data.entries?.[form]);
      if (definition) result.set(form, definition);
    }
  } catch {
    // El cuaderno sigue siendo útil sin la definición: no se rompe la
    // herramienta por un fallo del catálogo.
  }
  return result;
}

function toWordView(
  word: UserWord,
  filledMeaning: string | undefined,
  now: number,
): WordView {
  const dueMs = dateMs(word.card?.due);
  const hasDue = Number.isFinite(dueMs);
  const ownMeaning = word.meaning?.trim() || null;
  return {
    form: word.form,
    lemma: word.lemma ?? null,
    pos: word.pos ?? null,
    meaning: ownMeaning ?? filledMeaning ?? null,
    meaningFromCatalog: !ownMeaning && Boolean(filledMeaning),
    context: word.context ?? null,
    bookHash: word.bookHash ?? null,
    savedAt: isoOrNull(word.savedAt),
    updatedAt: isoOrNull(word.updatedAt),
    due: hasDue ? new Date(dueMs).toISOString() : null,
    dueInDays: hasDue ? round((dueMs - now) / DAY_MS, 1) : null,
    state: stateLabel(word.card?.state),
    reps: word.card?.reps ?? 0,
    lapses: word.card?.lapses ?? 0,
    stability:
      typeof word.card?.stability === "number" ? round(word.card.stability, 2) : null,
  };
}

function bookLabel(book: RemoteBook | undefined, hash: string): string {
  return book?.title?.trim() || book?.name?.trim() || hash.slice(0, 12);
}

type BookInfo = { title: string; author: string | null };

/**
 * Los libros del catálogo se descargan al dispositivo y pueden no existir
 * en `books/<userId>/` de R2, así que sus posiciones y anotaciones solo
 * traen el sha256 del EPUB. El índice público sí publica `epubSha256`:
 * se cruza para dar títulos legibles en estadísticas y anotaciones.
 */
async function loadBookIndex(api: LectaApi): Promise<(hash: string) => BookInfo> {
  const [remote, catalog] = await Promise.all([
    api
      .getJson<BooksResponse>("/api/books")
      .catch(() => ({ books: [] }) as BooksResponse),
    api
      .getJson<CatalogIndex>("/api/catalog", { anonymous: true })
      .catch(() => null),
  ]);
  const byHash = new Map<string, BookInfo>();
  for (const book of remote?.books ?? []) {
    byHash.set(book.hash, {
      title: bookLabel(book, book.hash),
      author: book.author?.trim() || null,
    });
  }
  for (const book of catalog?.books ?? []) {
    const sha = book.epubSha256?.toLowerCase();
    if (sha) byHash.set(sha, { title: book.title, author: book.author ?? null });
  }
  return (hash) => byHash.get(hash) ?? { title: hash.slice(0, 12), author: null };
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

export function registerTools(
  server: McpServer,
  api: LectaApi,
  config: LectaConfig,
): void {
  // ----- Catálogo léxico (público) -----

  server.registerTool(
    "lookup",
    {
      title: "Buscar una palabra en Lecta",
      description:
        "Busca una palabra o forma flexionada en el catálogo léxico compartido de Lecta y devuelve sus lemas, categoría gramatical, frecuencia (zipf) y acepciones con ejemplo. Público: no requiere cuenta.",
      inputSchema: {
        form: z
          .string()
          .min(1)
          .max(100)
          .describe("Palabra o forma flexionada, por ejemplo «casas» o «serendipia»."),
        language: z
          .string()
          .min(2)
          .max(10)
          .default("es")
          .describe("Código de idioma del catálogo: «es» (por defecto) o «en»."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ form, language }) => {
      try {
        const query = new URLSearchParams({ form: form.trim(), lang: language });
        const data = await api.getJson<LookupResponse>(
          `/api/lexicon/lookup?${query.toString()}`,
          { anonymous: true, allowStatus: [404] },
        );
        const entries = data?.entries ?? [];
        return jsonResult({
          form: form.trim().toLowerCase(),
          language,
          found: entries.length > 0,
          entries,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "lookup_many",
    {
      title: "Buscar varias palabras en Lecta",
      description:
        "Consulta hasta 200 formas a la vez en el catálogo léxico de Lecta. Devuelve un objeto por forma con sus fichas y una lista de las formas que no están en el catálogo. Público.",
      inputSchema: {
        forms: z
          .array(z.string().min(1).max(100))
          .min(1)
          .max(200)
          .describe("Formas que se quieren consultar."),
        language: z
          .string()
          .min(2)
          .max(10)
          .default("es")
          .describe("Código de idioma del catálogo: «es» o «en»."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ forms, language }) => {
      try {
        const unique = [
          ...new Set(forms.map((form) => form.trim().toLowerCase()).filter(Boolean)),
        ].slice(0, 200);
        if (!unique.length) {
          return errorResult(new Error("No hay formas válidas que consultar."));
        }
        const data = await api.postJson<BatchResponse>(
          "/api/lexicon/batch",
          { forms: unique, language },
          { anonymous: true },
        );
        const entries = data?.entries ?? {};
        return jsonResult({
          language,
          requested: unique.length,
          found: unique.filter((form) => (entries[form]?.length ?? 0) > 0).length,
          missing: unique.filter((form) => !(entries[form]?.length ?? 0)),
          entries,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ----- Catálogo de libros (público) -----

  server.registerTool(
    "catalog",
    {
      title: "Explorar el catálogo de Lecta",
      description:
        "Lista los libros de dominio público del catálogo de Lecta (clásicos en español) con autor, idioma, temas y enlaces al EPUB y la portada. Permite filtrar por texto y por idioma. Público.",
      inputSchema: {
        query: z
          .string()
          .max(100)
          .optional()
          .describe("Texto a buscar en título, autor, id o temas."),
        language: z
          .string()
          .min(2)
          .max(10)
          .optional()
          .describe("Filtra por idioma, por ejemplo «es»."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(100)
          .describe("Máximo de libros a devolver."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, language, limit }) => {
      try {
        const data = await api.getJson<CatalogIndex>("/api/catalog", {
          anonymous: true,
        });
        let books = data?.books ?? [];
        if (language) {
          books = books.filter(
            (book) => fold(book.language ?? "") === fold(language),
          );
        }
        if (query?.trim()) {
          books = books.filter((book) =>
            includesQuery(
              [book.title, book.author, book.id, ...(book.subjects ?? [])],
              query,
            ),
          );
        }
        const max = limitOf(limit, 100, 200);
        return jsonResult({
          generatedAt: data?.generatedAt ?? null,
          catalogBooks: data?.bookCount ?? (data?.books?.length ?? 0),
          matched: books.length,
          truncated: books.length > max,
          books: books.slice(0, max).map((book) => ({
            ...book,
            epubUrl: `${config.baseUrl}/api/catalog/${book.id}/epub`,
            coverUrl: book.cover
              ? `${config.baseUrl}/api/catalog/${book.id}/cover`
              : null,
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "catalog_vocab",
    {
      title: "Vocabulario de un libro del catálogo",
      description:
        "Consulta el manifiesto de vocabulario precomputado de un libro del catálogo: palabras totales, formas únicas, cobertura del léxico y palabras concretas. Sin «query» devuelve un resumen con las palabras más raras; con «query» busca formas o lemas. Público.",
      inputSchema: {
        bookId: z
          .string()
          .regex(/^[a-z0-9-]{1,64}$/)
          .describe("Id del libro en el catálogo, por ejemplo «quijote»."),
        query: z
          .string()
          .max(100)
          .optional()
          .describe("Forma o lema a buscar dentro del libro."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(30)
          .describe("Máximo de palabras a devolver."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ bookId, query, limit }) => {
      try {
        const vocab = await getCatalogVocabulary(api, bookId);
        const entries = vocab.entries ?? [];
        const byForm = vocab.byForm ?? {};
        const missing = vocab.missing ?? [];
        const uniqueForms = vocab.uniqueForms ?? 0;
        const max = limitOf(limit, 30, 200);

        // Forma representativa de cada entrada (la primera que la usa).
        const formByEntry = new Map<number, string>();
        for (const [form, indexes] of Object.entries(byForm)) {
          if (!Array.isArray(indexes)) continue;
          for (const index of indexes) {
            if (!formByEntry.has(index)) formByEntry.set(index, form);
          }
        }

        const bands = { "zipf<3": 0, "3-4": 0, "4-5": 0, "5-6": 0, ">=6": 0, sin_zipf: 0 };
        for (const entry of entries) {
          const zipf = entry.zipf;
          if (typeof zipf !== "number") bands.sin_zipf += 1;
          else if (zipf < 3) bands["zipf<3"] += 1;
          else if (zipf < 4) bands["3-4"] += 1;
          else if (zipf < 5) bands["4-5"] += 1;
          else if (zipf < 6) bands["5-6"] += 1;
          else bands[">=6"] += 1;
        }

        const base = {
          bookId,
          wordCount: vocab.wordCount ?? null,
          uniqueForms: vocab.uniqueForms ?? null,
          lexiconEntries: entries.length,
          missingForms: missing.length,
          coveragePct:
            uniqueForms > 0
              ? round(((uniqueForms - missing.length) / uniqueForms) * 100, 1)
              : null,
          zipfBands: bands,
        };

        if (query?.trim()) {
          const needle = fold(query.trim());
          const matches: Array<{
            form: string;
            lemma: string;
            pos: string | null;
            zipf: number | null;
          }> = [];
          const seen = new Set<string>();
          for (const [form, indexes] of Object.entries(byForm)) {
            if (!Array.isArray(indexes)) continue;
            for (const index of indexes) {
              const entry = entries[index];
              if (!entry) continue;
              const exact = fold(form) === needle || fold(entry.lemma) === needle;
              const partial =
                fold(form).includes(needle) || fold(entry.lemma).includes(needle);
              if (!exact && !partial) continue;
              const key = `${form}:${index}`;
              if (seen.has(key)) continue;
              seen.add(key);
              matches.push({
                form,
                lemma: entry.lemma,
                pos: entry.pos ?? null,
                zipf: entry.zipf ?? null,
              });
              if (matches.length >= max) break;
            }
            if (matches.length >= max) break;
          }
          return jsonResult({ ...base, query: query.trim(), matched: matches.length, words: matches });
        }

        const rare = entries
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => typeof entry.zipf === "number")
          .sort((a, b) => (a.entry.zipf ?? 99) - (b.entry.zipf ?? 99))
          .slice(0, max)
          .map(({ entry, index }) => ({
            form: formByEntry.get(index) ?? null,
            lemma: entry.lemma,
            pos: entry.pos ?? null,
            zipf: entry.zipf ?? null,
          }));

        return jsonResult({
          ...base,
          rarerWords: rare,
          missingSample: missing.slice(0, max),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ----- Datos de la cuenta (requieren sesión) -----

  server.registerTool(
    "whoami",
    {
      title: "Ver la cuenta conectada a Lecta",
      description:
        "Comprueba si el servidor MCP tiene una sesión válida de Lecta y devuelve el usuario conectado. Útil para diagnosticar LECTA_COOKIE o LECTA_EMAIL/LECTA_PASSWORD.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        if (!api.hasCredentials) {
          return jsonResult({
            configured: false,
            authenticated: false,
            hint: "Define LECTA_COOKIE o LECTA_EMAIL + LECTA_PASSWORD en el entorno del servidor MCP.",
          });
        }
        const session = await api.getSession();
        if (!session?.user) {
          return jsonResult({
            configured: true,
            authenticated: false,
            hint: "Las credenciales existen pero la sesión no es válida o venció.",
          });
        }
        return jsonResult({
          configured: true,
          authenticated: true,
          user: {
            id: session.user.id ?? null,
            name: session.user.name ?? null,
            email: session.user.email ?? null,
            emailVerified: session.user.emailVerified ?? null,
          },
          expiresAt: session.session?.expiresAt ?? null,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "my_books",
    {
      title: "Mis libros en Lecta",
      description:
        "Lista los EPUB que la cuenta tiene sincronizados en la nube de Lecta, con título, autor, idioma y número de secciones. Requiere sesión.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const data = await api.getJson<BooksResponse>("/api/books");
        const books = (data?.books ?? [])
          .slice()
          .sort((a, b) => (b.uploaded ?? "").localeCompare(a.uploaded ?? ""));
        return jsonResult({
          count: books.length,
          books: books.map((book) => ({
            hash: book.hash,
            title: book.title?.trim() || null,
            author: book.author?.trim() || null,
            name: book.name ?? null,
            language: book.language ?? null,
            sections: book.sections ?? null,
            uploaded: book.uploaded ?? null,
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "my_words",
    {
      title: "Mi cuaderno de vocabulario",
      description:
        "Consulta el cuaderno de Lecta: palabras guardadas, significado, contexto, libro de origen y estado de repetición espaciada (FSRS). Permite filtrar por texto y pedir solo las que vencen hoy. Requiere sesión.",
      inputSchema: {
        language: z
          .string()
          .min(2)
          .max(10)
          .default("es")
          .describe("Idioma del cuaderno: «es» (por defecto) o «en»."),
        query: z
          .string()
          .max(100)
          .optional()
          .describe("Texto a buscar en forma, lema, significado o contexto."),
        dueOnly: z
          .boolean()
          .default(false)
          .describe("Si es true, devuelve solo las palabras que ya toca repasar."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Máximo de palabras a devolver."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ language, query, dueOnly, limit }) => {
      try {
        const data = await api.getJson<VocabResponse>(
          `/api/vocab?lang=${encodeURIComponent(language)}`,
        );
        const now = Date.now();
        const all = (data?.words ?? []).filter((word) => !word.deleted);

        const dueMs = (word: UserWord) => dateMs(word.card?.due);
        const isDue = (word: UserWord) => {
          const ms = dueMs(word);
          return !Number.isFinite(ms) || ms <= now;
        };

        const summary = {
          total: all.length,
          due: all.filter(isDue).length,
          new: all.filter((word) => !word.card || word.card.state === 0).length,
          learning: all.filter((word) => word.card?.state === 1).length,
          review: all.filter((word) => word.card?.state === 2).length,
          relearning: all.filter((word) => word.card?.state === 3).length,
        };

        let filtered = all.filter((word) =>
          includesQuery(
            [word.form, word.lemma, word.meaning, word.context],
            query ?? "",
          ),
        );
        if (dueOnly) filtered = filtered.filter(isDue);

        const max = limitOf(limit, 50, 500);
        const selected = filtered
          .slice()
          .sort((a, b) => {
            const dueA = dueMs(a);
            const dueB = dueMs(b);
            const orderA = Number.isFinite(dueA) ? dueA : -Infinity;
            const orderB = Number.isFinite(dueB) ? dueB : -Infinity;
            return orderA - orderB || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
          })
          .slice(0, max);

        const filled = await fillMissingMeanings(api, selected, language);
        return jsonResult({
          language,
          availableLanguages: data?.availableLanguages ?? [language],
          hasMore: data?.hasMore ?? false,
          summary,
          matched: filtered.length,
          returned: selected.length,
          truncated: filtered.length > selected.length,
          words: selected.map((word) =>
            toWordView(word, filled.get(word.form.trim().toLowerCase()), now),
          ),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "reading_stats",
    {
      title: "Estadísticas de lectura",
      description:
        "Resume la actividad de lectura de la cuenta en los últimos días: minutos, sesiones, racha, libros avanzados, repasos FSRS y vocabulario pendiente. Requiere sesión.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(30)
          .describe("Ventana en días, contando hoy (por defecto 30)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ days }) => {
      try {
        const period = limitOf(days, 30, 365);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = new Date(today);
        start.setDate(start.getDate() - (period - 1));
        const since = start.getTime();

        const [activity, reviews, positions, bookInfo, vocabEs, vocabEn] =
          await Promise.all([
            api.getJson<{ intervals?: ActivityRow[]; hasMore?: boolean }>(
              `/api/activity?since=${since}`,
            ),
            api.getJson<{ reviews?: ReviewRow[]; hasMore?: boolean }>(
              `/api/reviews?since=${since}`,
            ),
            api.getJson<{ positions?: PositionRow[] }>("/api/positions"),
            loadBookIndex(api),
            api.getJson<VocabResponse>("/api/vocab?lang=es"),
            api.getJson<VocabResponse>("/api/vocab?lang=en"),
          ]);

        const activityRows = activity?.intervals ?? [];
        const reviewRows = reviews?.reviews ?? [];
        const positionRows = positions?.positions ?? [];

        const daily = new Map<string, { minutes: number; sessions: number; reviews: number }>();
        const dayOf = (key: string) => {
          const entry = daily.get(key) ?? { minutes: 0, sessions: 0, reviews: 0 };
          daily.set(key, entry);
          return entry;
        };

        let totalMinutes = 0;
        let totalSessions = 0;
        const minutesByBook = new Map<string, number>();
        const sessionsByBook = new Map<string, number>();
        const readingDays = new Set<string>();

        for (const row of activityRows) {
          const from = Math.max(row.startedAt, since);
          const to = row.endedAt;
          if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
          const minutes = Math.min(to - from, 6 * HOUR_MS) / 60_000;
          if (minutes <= 0) continue;

          totalMinutes += minutes;
          totalSessions += 1;
          const dayKey = localDayKey(from);
          readingDays.add(dayKey);

          const day = dayOf(dayKey);
          day.minutes += minutes;
          day.sessions += 1;

          minutesByBook.set(
            row.bookHash,
            (minutesByBook.get(row.bookHash) ?? 0) + minutes,
          );
          sessionsByBook.set(
            row.bookHash,
            (sessionsByBook.get(row.bookHash) ?? 0) + 1,
          );
        }

        const ratingCounts: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0 };
        for (const row of reviewRows) {
          dayOf(localDayKey(row.createdAt)).reviews += 1;
          const rating = String(row.rating ?? "");
          if (rating in ratingCounts) ratingCounts[rating] += 1;
        }

        // Racha: días consecutivos con lectura, terminando hoy o ayer.
        let streak = 0;
        const cursor = new Date();
        cursor.setHours(12, 0, 0, 0);
        if (!readingDays.has(localDayKey(cursor.getTime()))) {
          cursor.setDate(cursor.getDate() - 1);
        }
        while (readingDays.has(localDayKey(cursor.getTime()))) {
          streak += 1;
          cursor.setDate(cursor.getDate() - 1);
        }

        const progressOf = (row: PositionRow) => {
          const raw = row.progress ?? row.ratio ?? 0;
          const value = Number(raw);
          if (!Number.isFinite(value)) return 0;
          return Math.min(Math.max(value > 1 ? value / 100 : value, 0), 1);
        };

        const topBooks = [...minutesByBook.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([hash, minutes]) => {
            const info = bookInfo(hash);
            return {
              bookHash: hash,
              title: info.title,
              author: info.author,
              minutes: round(minutes),
              sessions: sessionsByBook.get(hash) ?? 0,
              progressPct: round(
                progressOf(
                  positionRows.find((row) => row.bookHash === hash) ?? {
                    bookHash: hash,
                    updatedAt: 0,
                  },
                ) * 100,
              ),
            };
          });

        const inProgressAll = positionRows
          .map((row) => ({ row, progress: progressOf(row) }))
          .filter(({ progress }) => progress > 0.005 && progress < 0.995)
          .sort((a, b) => b.row.updatedAt - a.row.updatedAt);
        const inProgress = inProgressAll
          .slice(0, 8)
          .map(({ row, progress }) => {
            const info = bookInfo(row.bookHash);
            return {
              bookHash: row.bookHash,
              title: info.title,
              author: info.author,
              progressPct: round(progress * 100),
              lastReadAt: isoOrNull(row.updatedAt),
            };
          });

        const finished = positionRows.filter((row) => progressOf(row) >= 0.995).length;

        const vocabRows = [
          ...(vocabEs?.words ?? []),
          ...(vocabEn?.words ?? []),
        ].filter((word) => !word.deleted);
        const dueWords = vocabRows.filter((word) => {
          const ms = dateMs(word.card?.due);
          return !Number.isFinite(ms) || ms <= Date.now();
        }).length;

        return jsonResult({
          period: {
            days: period,
            from: localDayKey(since),
            to: localDayKey(Date.now()),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          totals: {
            readingMinutes: round(totalMinutes),
            readingHours: round(totalMinutes / 60, 2),
            sessions: totalSessions,
            readingDays: readingDays.size,
            streakDays: streak,
            reviews: reviewRows.length,
            averageSessionMinutes: totalSessions
              ? round(totalMinutes / totalSessions)
              : 0,
            booksInProgress: inProgressAll.length,
            booksFinished: finished,
            wordsSaved: vocabRows.length,
            wordsDue: dueWords,
          },
          reviewsByRating: ratingCounts,
          topBooks,
          inProgress,
          daily: [...daily.entries()]
            .filter(([, value]) => value.minutes > 0 || value.reviews > 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, value]) => ({
              date,
              minutes: round(value.minutes),
              sessions: value.sessions,
              reviews: value.reviews,
            })),
          partial: Boolean(activity?.hasMore || reviews?.hasMore),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_annotations",
    {
      title: "Buscar marcadores y pasajes",
      description:
        "Busca en los marcadores y pasajes subrayados de la cuenta por texto, nota o libro. Devuelve fragmento, nota, posición y libro. Requiere sesión.",
      inputSchema: {
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Texto a buscar en el pasaje o en la nota."),
        bookHash: z
          .string()
          .max(80)
          .optional()
          .describe("Limita a un libro concreto por su hash."),
        kind: z
          .enum(["bookmark", "passage"])
          .optional()
          .describe("Tipo de anotación: marcador o pasaje subrayado."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(300)
          .default(50)
          .describe("Máximo de anotaciones a devolver."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, bookHash, kind, limit }) => {
      try {
        const [data, bookInfo] = await Promise.all([
          api.getJson<AnnotationsResponse>("/api/annotations"),
          loadBookIndex(api),
        ]);
        let rows = (data?.annotations ?? []).filter((row) => !row.deleted);
        if (bookHash) rows = rows.filter((row) => row.bookHash === bookHash);
        if (kind) rows = rows.filter((row) => row.kind === kind);
        if (query?.trim()) {
          rows = rows.filter((row) =>
            includesQuery([row.text, row.note, row.anchor], query),
          );
        }
        const max = limitOf(limit, 50, 300);
        const sorted = rows
          .slice()
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return jsonResult({
          matched: rows.length,
          returned: Math.min(rows.length, max),
          truncated: rows.length > max,
          annotations: sorted.slice(0, max).map((row) => ({
            bookHash: row.bookHash,
            bookTitle: bookInfo(row.bookHash).title,
            id: row.id,
            kind: row.kind ?? null,
            sectionIndex: row.sectionIndex ?? null,
            text: row.text ?? null,
            note: row.note ?? null,
            anchor: row.anchor ?? null,
            createdAt: isoOrNull(row.createdAt),
            updatedAt: isoOrNull(row.updatedAt),
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "my_knowledge",
    {
      title: "Mi evidencia de conocimiento",
      description:
        "Consulta las palabras que la cuenta marcó como conocidas o por aprender durante la lectura y la calibración. Requiere sesión.",
      inputSchema: {
        language: z
          .string()
          .min(2)
          .max(10)
          .optional()
          .describe("Filtra por idioma, por ejemplo «es»."),
        known: z
          .boolean()
          .optional()
          .describe("true = solo conocidas; false = solo por aprender."),
        query: z
          .string()
          .max(100)
          .optional()
          .describe("Texto a buscar en el lema."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .describe("Máximo de lemas a devolver."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ language, known, query, limit }) => {
      try {
        const params = new URLSearchParams();
        if (language) params.set("language", language);
        const data = await api.getJson<KnowledgeResponse>(
          `/api/knowledge${params.size ? `?${params.toString()}` : ""}`,
        );
        const rows = (data?.rows ?? []).filter((row) => !row.deleted);
        const matched = rows.filter(
          (row) =>
            (known === undefined || Boolean(row.known) === known) &&
            includesQuery([row.lemma], query ?? ""),
        );
        const max = limitOf(limit, 100, 500);
        return jsonResult({
          availableLanguages: data?.availableLanguages ?? [],
          summary: {
            total: rows.length,
            known: rows.filter((row) => row.known).length,
            unknown: rows.filter((row) => !row.known).length,
          },
          matched: matched.length,
          returned: Math.min(matched.length, max),
          truncated: matched.length > max,
          rows: matched
            .slice()
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
            .slice(0, max)
            .map((row) => ({
              lemma: row.lemma,
              language: row.language ?? null,
              known: Boolean(row.known),
              source: row.source ?? null,
              updatedAt: isoOrNull(row.updatedAt),
            })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ----- Diagnóstico (público) -----

  server.registerTool(
    "health",
    {
      title: "Estado de la API de Lecta",
      description:
        "Comprueba que la API de Lecta responde y si el servidor MCP tiene credenciales configuradas. No requiere sesión.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const started = performance.now();
      try {
        const data = await api.getJson<{ status?: string }>("/api/health", {
          anonymous: true,
        });
        return jsonResult({
          baseUrl: api.baseUrl,
          reachable: data?.status === "ok",
          status: data?.status ?? "desconocido",
          latencyMs: Math.round(performance.now() - started),
          credentialsConfigured: api.hasCredentials,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

