// Contrato de la «guía de pantalla» para «Series y películas»: el
// mismo modelo «solo palabras» de la guía de papel
// (paper-guide.ts), aplicado a subtítulos en vez de EPUB.
//
// Lo que vive en R2 por episodio/película:
//   screen-guides/v1/<movie|tv>-<imdbId>[-sNN eNN]-<lang>.json
// con forms/capitalOnly en minúsculas, sin stopwords, orden A–Z y
// `phrases` como CLAVES del banco CORE_FOREIGN_IDIOMS — nunca texto
// del guion. El .srt existe solo en memoria durante la petición del
// worker: no se guarda ni se devuelve.
//
// `sanitizeScreenGuideObject` reconstruye el objeto campo a campo:
// cualquier propiedad extra se descarta, así que un JSON manipulado
// no puede colar diálogo aunque el servidor lo sirviera.

import { asFormList, PAPER_GUIDE_MAX_FORMS_PER_CHAPTER } from "./paper-guide";
import { capitalOnlyForms, isWordToken } from "./word-form";
import { isStopword } from "./stopwords";
import { CORE_FOREIGN_IDIOMS } from "./foreign-idioms";

export const SCREEN_GUIDE_VERSION = 1;

export type ScreenWorkType = "movie" | "tv";
export type ScreenWorkLanguage = "es" | "en";

// Referencia de obra de pantalla: película o un episodio de serie en
// un idioma. La obra completa (todos los episodios de una serie en
// un idioma) comparte el hash de screenWorkHash; cada episodio tiene
// su propia guía en R2 que el cliente funde en un solo libro.
export type ScreenWorkRef = {
  type: ScreenWorkType;
  imdbId: string; // /^tt\d{7,9}$/
  language: ScreenWorkLanguage;
  season?: number; // tv: 0–99, obligatorios ambos o ninguno en movie
  episode?: number; // tv: 1–999
};

export type ScreenGuideObject = {
  v: typeof SCREEN_GUIDE_VERSION;
  type: ScreenWorkType;
  imdbId: string;
  season?: number;
  episode?: number;
  language: ScreenWorkLanguage;
  forms: string[];
  capitalOnly: string[];
  phrases: string[]; // normalizedId de CORE_FOREIGN_IDIOMS
  createdAt: number;
};

const IMDB_ID_RE = /^tt\d{7,9}$/;
const SEASON_MAX = 99;
const EPISODE_MAX = 999;

const pad2 = (n: number) => String(n).padStart(2, "0");

const intInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

// Normaliza una referencia arbitraria (el cuerpo JSON del worker no
// es de fiar). Devuelve la forma canónica o null si algo no cuadra:
// type movie|tv, imdbId tt+7-9 dígitos, language es|en; tv exige
// season 0–99 y episode 1–999 enteros; movie los prohíbe.
const normalizeRef = (input: unknown): ScreenWorkRef | null => {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const { type, imdbId, language } = raw;
  if (type !== "movie" && type !== "tv") return null;
  if (typeof imdbId !== "string" || !IMDB_ID_RE.test(imdbId)) return null;
  if (language !== "es" && language !== "en") return null;
  if (type === "movie") {
    if (raw.season !== undefined || raw.episode !== undefined) return null;
    return { type, imdbId, language };
  }
  if (
    !intInRange(raw.season, 0, SEASON_MAX) ||
    !intInRange(raw.episode, 1, EPISODE_MAX)
  )
    return null;
  return { type, imdbId, language, season: raw.season, episode: raw.episode };
};

// Clave R2 de la guía de UN episodio/película. El capítulo dentro de
// la obra usa el mismo identificador sNN eNN (ver screenChapterId).
export function screenGuideKey(ref: ScreenWorkRef): string | null {
  const r = normalizeRef(ref);
  if (!r) return null;
  const ep =
    r.type === "tv" ? `-s${pad2(r.season!)}e${pad2(r.episode!)}` : "";
  return `screen-guides/v1/${r.type}-${r.imdbId}${ep}-${r.language}.json`;
}

// Identidad local de la obra en el dispositivo: una película o una
// serie completa en un idioma. SHA-256 hex de
// «lecta-screen:v1:<type>:<imdbId>:<language>» — cumple
// SHA256_HEX_RE, así que Cuaderno, anotaciones y respaldo funcionan
// sin cambios.
export async function screenWorkHash(
  type: ScreenWorkType,
  imdbId: string,
  language: ScreenWorkLanguage,
): Promise<string | null> {
  // La obra no lleva season/episode: una serie entera en un idioma
  // es UN StoredBook; los episodios son capítulos de su guía.
  if (
    (type !== "movie" && type !== "tv") ||
    typeof imdbId !== "string" ||
    !IMDB_ID_RE.test(imdbId) ||
    (language !== "es" && language !== "en")
  )
    return null;
  const data = new TextEncoder().encode(
    `lecta-screen:v1:${type}:${imdbId}:${language}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

// Capítulo de la guía dentro de la obra: la película es un solo
// capítulo «movie»; cada episodio es «sNN eNN» sin título (los
// títulos de episodio revelan trama — antispoiler por diseño).
export function screenChapterId(ref: ScreenWorkRef): string | null {
  const r = normalizeRef(ref);
  if (!r) return null;
  if (r.type === "movie") return "movie";
  return `s${pad2(r.season!)}e${pad2(r.episode!)}`;
}

export function screenChapterLabel(ref: ScreenWorkRef): string | null {
  const r = normalizeRef(ref);
  if (!r) return null;
  if (r.type === "movie") return "Película";
  return `T${r.season} · E${r.episode}`;
}

// ------------------------------------------------------------------
// subtitleToForms — del .srt en memoria al índice «solo palabras»
// ------------------------------------------------------------------

// Línea de créditos/timing residual: nunca vocabulario. La lista es
// la del plan; se compara en minúsculas para atrapar «Subtitles by».
const CREDIT_MARKERS = [
  "http",
  "www.",
  "subdl",
  "opensubtitles",
  "subtitles by",
  "subtítulos por",
  "synced",
  "sync by",
];

const isCreditLine = (line: string) => {
  const lower = line.toLowerCase();
  return CREDIT_MARKERS.some((marker) => lower.includes(marker));
};

// Limpia una línea de diálogo: etiquetas <…>, acotaciones {…}, notas
// ♪…♪, acotaciones […] y (…) de escena, y el rótulo de hablante en
// mayúsculas («MARIA:»). El orden importa: las acotaciones se quitan
// antes del rótulo para que un «(V.O.) MARIA:» no deje basura.
const cleanSubtitleLine = (line: string): string =>
  line
    .replace(/<[^>]*>/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/♪[^♪]*♪/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^[A-ZÁÉÍÓÚÑ .'-]{2,25}:/, "");

const SUBTITLE_TOKEN = /[\p{L}][\p{L}'’-]*/gu;

// Del .srt a { forms, capitalOnly }: solo formas sueltas ordenadas
// A–Z, sin stopwords y sin texto del guion — la misma garantía que
// la guía de papel. El .srt vive solo en memoria durante la llamada.
export function subtitleToForms(
  srt: string,
  language: ScreenWorkLanguage,
): { forms: string[]; capitalOnly: string[] } {
  const surfaces: string[] = [];
  for (const rawLine of srt.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\d+$/.test(line)) continue; // número de bloque
    if (line.includes("-->")) continue; // línea de tiempo
    if (isCreditLine(line)) continue; // créditos del subtítulo
    const cleaned = cleanSubtitleLine(line);
    for (const match of cleaned.matchAll(SUBTITLE_TOKEN)) {
      const surface = match[0];
      const form = surface.toLowerCase();
      if (!isWordToken(form) || isStopword(form, language)) continue;
      surfaces.push(surface);
    }
  }
  const forms = [
    ...new Set(surfaces.map((surface) => surface.toLowerCase())),
  ]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, PAPER_GUIDE_MAX_FORMS_PER_CHAPTER);
  const formsSet = new Set(forms);
  const capitalOnly = [...capitalOnlyForms(surfaces)]
    .filter((form) => formsSet.has(form))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, PAPER_GUIDE_MAX_FORMS_PER_CHAPTER);
  return { forms, capitalOnly };
}

// ------------------------------------------------------------------
// sanitizeScreenGuideObject — reconstrucción campo a campo
// ------------------------------------------------------------------

// Claves válidas del banco de frases: una `phrases` que no sea una
// de estas claves se descarta — es la barrera que impide que texto
// del guion viaje disfrazado de «frase».
const IDIOM_KEYS = new Set(CORE_FOREIGN_IDIOMS.map((item) => item.pattern));

// Reconstruye la guía desde datos arbitrarios (lo que haya en R2 o
// lo que mande el cliente). Devuelve null si la versión no es la
// actual o la identidad no coincide exactamente con `ref`; si no,
// produce SIEMPRE el objeto canónico: campos y nada más.
export function sanitizeScreenGuideObject(
  input: unknown,
  ref: ScreenWorkRef,
): ScreenGuideObject | null {
  const r = normalizeRef(ref);
  if (!r || !input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (raw.v !== SCREEN_GUIDE_VERSION) return null;
  if (
    raw.type !== r.type ||
    raw.imdbId !== r.imdbId ||
    raw.language !== r.language
  )
    return null;
  if (r.type === "tv") {
    if (raw.season !== r.season || raw.episode !== r.episode) return null;
  } else if (raw.season !== undefined || raw.episode !== undefined) {
    return null;
  }
  const phrases = Array.isArray(raw.phrases)
    ? [
        ...new Set(
          raw.phrases.filter(
            (p): p is string => typeof p === "string" && IDIOM_KEYS.has(p),
          ),
        ),
      ]
    : [];
  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : Date.now();
  return {
    v: SCREEN_GUIDE_VERSION,
    type: r.type,
    imdbId: r.imdbId,
    ...(r.type === "tv"
      ? { season: r.season, episode: r.episode }
      : {}),
    language: r.language,
    forms: asFormList(raw.forms, r.language),
    capitalOnly: asFormList(raw.capitalOnly, r.language),
    phrases,
    createdAt,
  };
}
