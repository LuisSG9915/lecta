import {
  sanitizePaperBookGuide,
  PAPER_GUIDE_VERSION,
  type PaperBookGuide,
  type PaperGuideChapter,
} from "../../shared/paper-guide";
import {
  sanitizeScreenGuideObject,
  screenChapterId,
  screenChapterLabel,
  type ScreenGuideObject,
  type ScreenWorkRef,
} from "../../shared/screen-guide";
import { CORE_FOREIGN_IDIOMS } from "../../shared/foreign-idioms";

// Cliente de «Series y películas»: búsqueda OMDb, temporadas/
// episodios y la preparación de la guía de vocabulario (SubDL en el
// worker). Todo lo que vuelve del servidor es «solo palabras» — el
// texto del subtítulo jamás llega al dispositivo.
//
// Vive en su propio módulo porque la pantalla que lo usa es lazy;
// App.tsx solo necesita mergeScreenChapter (el resto se sacude del
// chunk inicial por tree-shaking).

export class ScreenApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ScreenApiError";
    this.status = status;
  }
}

// Mensajes de error de /api/screen/* tal como los definió el plan:
// el status 0 es fallo de red, 401 pide sesión y el resto muestra el
// texto del servidor (404 «sin subtítulos», 429 «demasiados», 503
// «no disponible»).
export const screenErrorMessage = (error: unknown): string => {
  if (error instanceof ScreenApiError) {
    if (error.status === 0)
      return "Sin conexión. Revisa tu red e inténtalo de nuevo.";
    if (error.status === 401)
      return "Inicia sesión para preparar vocabulario.";
    return error.message;
  }
  return "No pudimos completar la acción. Intenta más tarde.";
};

export type ScreenSearchItem = {
  imdbId: string;
  type: "movie" | "tv";
  title: string;
  year: string;
  hasPoster: boolean;
};

const isSearchItem = (item: unknown): item is ScreenSearchItem => {
  const it = item as ScreenSearchItem;
  return (
    typeof it?.imdbId === "string" &&
    (it.type === "movie" || it.type === "tv") &&
    typeof it.title === "string"
  );
};

// Null en cualquier fallo (red, 4xx/5xx, forma inesperada): la sección
// decide entre «sin resultados» y error — nunca lanza por buscar.
export async function searchScreen(
  q: string,
  signal?: AbortSignal,
): Promise<ScreenSearchItem[] | null> {
  const query = q.trim();
  if (!query) return [];
  const response = await fetch(
    `/api/screen/search?q=${encodeURIComponent(query)}`,
    { signal },
  ).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as {
    results?: unknown;
  } | null;
  if (!Array.isArray(data?.results)) return null;
  return data.results.filter(isSearchItem).slice(0, 10);
}

export type ScreenTvDetail = {
  title: string;
  seasons: number | null;
};

export async function fetchTvSeasons(
  imdbId: string,
  signal?: AbortSignal,
): Promise<ScreenTvDetail | null> {
  const response = await fetch(`/api/screen/tv/${imdbId}`, { signal }).catch(
    () => null,
  );
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as {
    title?: unknown;
    seasons?: unknown;
  } | null;
  if (typeof data?.title !== "string") return null;
  return {
    title: data.title,
    seasons: typeof data.seasons === "number" ? data.seasons : null,
  };
}

// Solo números de episodio: los títulos de episodio revelan trama y
// el worker ya los filtra — aquí solo se valida la forma.
export async function fetchSeasonEpisodes(
  imdbId: string,
  season: number,
  signal?: AbortSignal,
): Promise<number[] | null> {
  const response = await fetch(
    `/api/screen/tv/${imdbId}/season/${season}`,
    { signal },
  ).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as {
    episodes?: unknown;
  } | null;
  if (!Array.isArray(data?.episodes)) return null;
  return data.episodes.filter(
    (n): n is number => typeof n === "number" && Number.isInteger(n),
  );
}

// El póster se sirve por el propio worker (la CSP solo permite
// img-src 'self'): la URL nunca sale del dominio de Lecta.
// Siguiente episodio a preparar: el mayor «sNNeNN» de los capítulos
// ya instalados +1 en la misma temporada. null si no hay ninguno —
// la hoja de preparación deja la elección al lector.
export function nextEpisodeAfter(
  chapterIds: string[],
): { season: number; episode: number } | null {
  let best: { season: number; episode: number } | null = null;
  for (const id of chapterIds) {
    const match = /^s(\d+)e(\d+)$/.exec(id);
    if (!match) continue;
    const season = Number(match[1]);
    const episode = Number(match[2]);
    if (!Number.isInteger(season) || !Number.isInteger(episode)) continue;
    if (
      !best ||
      season > best.season ||
      (season === best.season && episode > best.episode)
    ) {
      best = { season, episode };
    }
  }
  return best ? { season: best.season, episode: best.episode + 1 } : null;
}

export const screenPosterUrl = (imdbId: string) =>
  `/api/screen/poster?imdbId=${encodeURIComponent(imdbId)}`;

// ------------------------------------------------------------------
// Descubrimiento — rieles de Trakt con respaldo curado en el worker
// ------------------------------------------------------------------

export type ScreenDiscoverRailId = "trending" | "recent" | "popular";

export type ScreenDiscoverRail = {
  id: ScreenDiscoverRailId;
  items: ScreenSearchItem[];
};

export type ScreenDiscoverPayload = {
  source: "trakt" | "curated";
  rails: ScreenDiscoverRail[];
};

const RAIL_IDS = new Set<ScreenDiscoverRailId>([
  "trending",
  "recent",
  "popular",
]);

// Null en cualquier fallo: la sección simplemente no pinta rieles y
// el buscador sigue funcionando igual.
export async function fetchScreenDiscover(
  signal?: AbortSignal,
): Promise<ScreenDiscoverPayload | null> {
  const response = await fetch("/api/screen/discover", { signal }).catch(
    () => null,
  );
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as {
    source?: unknown;
    rails?: unknown;
  } | null;
  if (
    (data?.source !== "trakt" && data?.source !== "curated") ||
    !Array.isArray(data.rails)
  ) {
    return null;
  }
  const rails: ScreenDiscoverRail[] = [];
  const seen = new Set<ScreenDiscoverRailId>();
  for (const rail of data.rails) {
    const r = rail as { id?: unknown; items?: unknown } | null;
    if (
      typeof r?.id !== "string" ||
      !RAIL_IDS.has(r.id as ScreenDiscoverRailId) ||
      seen.has(r.id as ScreenDiscoverRailId) ||
      !Array.isArray(r.items)
    ) {
      continue;
    }
    seen.add(r.id as ScreenDiscoverRailId);
    const items = r.items.filter(isSearchItem).slice(0, 16);
    if (items.length) rails.push({ id: r.id as ScreenDiscoverRailId, items });
  }
  return { source: data.source, rails };
}

// Obras relacionadas con una ya preparada («Porque preparaste X»).
// [] ante cualquier fallo — el riel se oculta solo.
export async function fetchScreenRelated(
  imdbId: string,
  type: "movie" | "tv",
  signal?: AbortSignal,
): Promise<ScreenSearchItem[]> {
  const response = await fetch(
    `/api/screen/related?imdbId=${encodeURIComponent(imdbId)}&type=${type}`,
    { signal },
  ).catch(() => null);
  if (!response?.ok) return [];
  const data = (await response.json().catch(() => null)) as {
    items?: unknown;
  } | null;
  if (!Array.isArray(data?.items)) return [];
  return data.items.filter(isSearchItem).slice(0, 12);
}

const IMDB_ID_RE = /^tt\d{7,9}$/;

export type TasteSeed = { imdbId: string; type: "movie" | "tv"; title: string };

type TasteSeedInput = {
  imdbId?: string;
  mediaKind?: string;
  addedAt?: number;
  title?: string;
  name?: string;
};

// Semillas de gusto: hasta 2 obras instaladas con imdbId, las más
// recientes por addedAt. El tipo sale de mediaKind (movie/tv) y el
// título alimenta la etiqueta «Porque preparaste «X»».
export function tasteSeeds(works: readonly TasteSeedInput[]): TasteSeed[] {
  const eligible = works.filter(
    (w) =>
      typeof w.imdbId === "string" &&
      IMDB_ID_RE.test(w.imdbId) &&
      (w.mediaKind === "movie" || w.mediaKind === "tv"),
  );
  eligible.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  return eligible.slice(0, 2).map((w) => ({
    imdbId: w.imdbId as string,
    type: w.mediaKind as "movie" | "tv",
    title: w.title || w.name || "",
  }));
}

// Pide (o recoge de R2) la guía de UN episodio/película. Lanza
// ScreenApiError con el status del servidor (401/404/429/503) o 0
// para fallo de red — el componente muestra el mensaje del servidor.
export async function requestScreenGuide(
  ref: ScreenWorkRef,
  signal?: AbortSignal,
): Promise<{ guide: ScreenGuideObject; cached: boolean }> {
  let response: Response;
  try {
    response = await fetch("/api/screen/guide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ref),
      signal,
    });
  } catch {
    throw new ScreenApiError(0, "Sin conexión. Revisa tu red e inténtalo de nuevo.");
  }
  const data = (await response.json().catch(() => null)) as {
    guide?: unknown;
    cached?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok) {
    const message =
      typeof data?.error === "string" && data.error
        ? data.error
        : "No pudimos preparar este título. Intenta más tarde.";
    throw new ScreenApiError(response.status, message);
  }
  const guide = sanitizeScreenGuideObject(data?.guide, ref);
  if (!guide) {
    throw new ScreenApiError(0, "Respuesta incompleta del servidor.");
  }
  return { guide, cached: data?.cached === true };
}

// ------------------------------------------------------------------
// mergeScreenChapter — la guía de la obra entera a partir de las
// guías por episodio que devuelve el worker
// ------------------------------------------------------------------

export type ScreenChapterMeta = {
  bookHash: string;
  title: string;
  author?: string;
};

// Orden de capítulos: los ids son «movie» o «sNN eNN» con padding —
// el orden numérico por temporada/episodio no siempre coincide con
// el lexicográfico («s01e100» < «s01e99» como texto). «movie» y
// cualquier id fuera del patrón van al final.
const chapterOrder = (id: string): readonly [number, number, string] => {
  const match = /^s(\d+)e(\d+)$/.exec(id);
  if (!match) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, id];
  return [Number(match[1]), Number(match[2]), id];
};

const compareChapters = (a: PaperGuideChapter, b: PaperGuideChapter) => {
  const [sa, ea, ia] = chapterOrder(a.id);
  const [sb, eb, ib] = chapterOrder(b.id);
  return sa - sb || ea - eb || ia.localeCompare(ib);
};

// Añade (o reemplaza) el capítulo de una ScreenGuideObject dentro de
// la PaperBookGuide de la obra — una película es un solo capítulo;
// una serie junta un capítulo por episodio preparado, ordenados por
// temporada y episodio. La salida pasa por sanitizePaperBookGuide:
// el contrato «solo palabras» se verifica otra vez en el cliente.
export function mergeScreenChapter(
  guide: PaperBookGuide | null,
  object: ScreenGuideObject,
  meta: ScreenChapterMeta,
): PaperBookGuide | null {
  const ref: ScreenWorkRef =
    object.type === "tv"
      ? {
          type: "tv",
          imdbId: object.imdbId,
          language: object.language,
          season: object.season as number,
          episode: object.episode as number,
        }
      : { type: "movie", imdbId: object.imdbId, language: object.language };
  const id = screenChapterId(ref);
  const label = screenChapterLabel(ref);
  if (!id || !label) return null;

  const base =
    guide && guide.bookHash === meta.bookHash ? guide.chapters : [];
  const chapter: PaperGuideChapter = {
    id,
    label,
    depth: 0,
    kind: "chapter",
    forms: [...object.forms],
    capitalOnly: [...object.capitalOnly],
  };
  const chapters = [...base.filter((ch) => ch.id !== id), chapter].sort(
    compareChapters,
  );

  return sanitizePaperBookGuide(
    {
      version: PAPER_GUIDE_VERSION,
      bookHash: meta.bookHash,
      title: meta.title,
      author: meta.author ?? "",
      language: object.language,
      updatedAt: Date.now(),
      chapters,
    },
    meta.bookHash,
  );
}

// ------------------------------------------------------------------
// Frases de la obra — `screenPhrases:v1:<hash>` en sesión
// ------------------------------------------------------------------
//
// El worker guarda en cada ScreenGuideObject solo CLAVES del banco
// CORE_FOREIGN_IDIOMS (nunca texto del guion). Aquí se acumulan por
// capítulo dentro de la obra: { "s01e02": ["at stake", …] }.

export const screenPhrasesKey = (bookHash: string) =>
  `screenPhrases:v1:${bookHash}`;

export type ScreenPhrasesRecord = Record<string, string[]>;

// Fusiona las claves de un episodio en el registro de la obra:
// reemplaza la entrada del capítulo y descarta las vacías. Las claves
// que no pertenecen al banco se filtran otra vez por si el JSON de
// sesión fue manipulado.
const IDIOM_KEY_SET = new Set(CORE_FOREIGN_IDIOMS.map((i) => i.pattern));

export function mergeScreenChapterPhrases(
  record: ScreenPhrasesRecord | null,
  chapterId: string,
  phrases: string[],
): ScreenPhrasesRecord {
  const next: ScreenPhrasesRecord = { ...(record ?? {}) };
  const clean = [
    ...new Set(phrases.filter((p) => typeof p === "string" && IDIOM_KEY_SET.has(p))),
  ];
  if (clean.length) next[chapterId] = clean;
  else delete next[chapterId];
  return next;
}

export function parseScreenPhrasesRecord(raw: string | null): ScreenPhrasesRecord {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: ScreenPhrasesRecord = {};
    for (const [chapterId, list] of Object.entries(data)) {
      if (!Array.isArray(list)) continue;
      const clean = [
        ...new Set(
          list.filter((p): p is string => typeof p === "string" && IDIOM_KEY_SET.has(p)),
        ),
      ];
      if (clean.length) out[chapterId] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

export type ScreenPhraseItem = {
  key: string;
  text: string;
  meaning: string;
};

const SCREEN_PHRASES_MAX = 8;

// Resuelve las claves de un capítulo contra el banco: la «frase» es
// el patrón del banco (es el mismo texto que el detector reconoce —
// nunca una cita del guion) y el significado sale en la lengua
// materna del lector (español → glossEs; otra → glossEn). Orden de
// mayor a menor dificultad (beta) y tope de 8, como pide el plan.
export function screenPhraseItems(
  patterns: readonly string[] | undefined,
  nativeLang: string,
): ScreenPhraseItem[] {
  if (!patterns?.length) return [];
  const wanted = new Set(patterns);
  const useEs = nativeLang.toLowerCase().startsWith("es");
  return CORE_FOREIGN_IDIOMS.filter((item) => wanted.has(item.pattern))
    .sort((a, b) => b.beta - a.beta)
    .slice(0, SCREEN_PHRASES_MAX)
    .map((item) => ({
      key: item.pattern,
      text: item.pattern,
      meaning: useEs ? item.glossEs : item.glossEn,
    }));
}


