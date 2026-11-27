import { useEffect, useMemo, useRef, useState } from "react";
import BookCover from "./BookCover";
import { coverPalette } from "../lib/cover";
import {
  fetchScreenDiscover,
  fetchScreenRelated,
  fetchSeasonEpisodes,
  fetchTvSeasons,
  requestScreenGuide,
  searchScreen,
  screenPosterUrl,
  tasteSeeds,
  type ScreenDiscoverPayload,
  type ScreenSearchItem,
} from "../lib/screen";
import type { ScreenGuideObject, ScreenWorkRef } from "../../shared/screen-guide";
import ScreenPrepareSheet from "./ScreenPrepareSheet";
import type { ShelfItem } from "./Shelf";

// «Series y películas»: obras audiovisuales preparadas («Tus
// títulos») y el buscador OMDb → SubDL del worker. El flujo es el
// mismo que el modo papel: preparar el vocabulario de un episodio o
// película y abrir la hoja de palabras — nunca el diálogo.
//
// La búsqueda pinta tarjetas con póster que abren la hoja de
// preparación (ScreenPrepareSheet); «Otro episodio» la abre con el
// idioma fijo de la obra instalada. Toda la red pasa por
// /api/screen/* que exige sesión; los errores del servidor se
// muestran tal cual y el fallo de red ofrece «Reintentar».

type Props = {
  /** Obras ya preparadas en este dispositivo (mediaKind). */
  works: ShelfItem[];
  /** Abrir la guía papel de una obra (índice de episodios/capítulo). */
  onOpenWork: (item: ShelfItem) => void;
  /** Quitar una obra: borrado solo local, sin tocar el servidor. */
  onRemoveWork: (hash: string) => void;
  /**
   * Instala la guía de la obra y la abre. El padre fusiona el
   * capítulo en la PaperBookGuide de la obra completa, guarda en
   * sesión y hace saveBook — devuelve false si algo falló.
   */
  onPrepareWork: (args: {
    ref: ScreenWorkRef;
    guide: ScreenGuideObject;
    title: string;
  }) => Promise<boolean>;
  /** Capítulos preparados de una obra (para marca de listo y «Ver palabras»). */
  loadPreparedChapters?: (hash: string) => Promise<string[]>;
  /** Inyectables para pruebas (la hoja los recibe por ScreenShelf). */
  fetchSearch?: typeof searchScreen;
  fetchSeasons?: typeof fetchTvSeasons;
  fetchEpisodes?: typeof fetchSeasonEpisodes;
  requestGuide?: typeof requestScreenGuide;
  fetchDiscover?: typeof fetchScreenDiscover;
  fetchRelated?: typeof fetchScreenRelated;
};

// Qué obra abre la hoja de preparación: un resultado de búsqueda o
// «Otro episodio» de un título instalado (con idioma fijo).
type SheetTarget = {
  type: "movie" | "tv";
  imdbId: string;
  title: string;
  year?: string;
  fixedLanguage?: "en" | "es";
};

const SEARCH_DEBOUNCE_MS = 350;

export default function ScreenShelf({
  works,
  onOpenWork,
  onRemoveWork,
  onPrepareWork,
  loadPreparedChapters,
  fetchSearch = searchScreen,
  fetchSeasons,
  fetchEpisodes,
  requestGuide,
  fetchDiscover = fetchScreenDiscover,
  fetchRelated = fetchScreenRelated,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScreenSearchItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);
  // «Quitar» en dos pasos: el hash en confirmación o null.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // Pósters cuya imagen falló: quedan el bloque de color de la paleta.
  const [posterBroken, setPosterBroken] = useState<Set<string>>(new Set());
  const searchSeq = useRef(0);
  // Rieles de descubrimiento: Trakt o respaldo curado (el worker
  // decide). null = aún no responde o falló — no se pinta nada.
  const [discover, setDiscover] = useState<ScreenDiscoverPayload | null>(
    null,
  );
  const [discoverLoading, setDiscoverLoading] = useState(true);
  // «Porque preparaste X»: relacionados por semilla, clave
  // "movie:tt…"/"tv:tt…".
  const [relatedBySeed, setRelatedBySeed] = useState<
    Record<string, ScreenSearchItem[]>
  >({});
  const seeds = useMemo(() => tasteSeeds(works), [works]);
  const lastSeedsKey = useRef("");

  // La búsqueda espera 350 ms (mismo patrón que «Más clásicos»). Los
  // estados de carga/vacío se ajustan en el handler del input; el
  // efecto solo programa el fetch y el setState cae en callbacks.
  useEffect(() => {
    const seq = ++searchSeq.current;
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(() => {
      void fetchSearch(q)
        .then((items) => {
          if (searchSeq.current !== seq) return;
          setResults(items);
          setSearchError(items === null ? "No pudimos buscar. Reintenta." : "");
        })
        .catch(() => {
          if (searchSeq.current === seq) {
            setResults(null);
            setSearchError("No pudimos buscar. Reintenta.");
          }
        })
        .finally(() => {
          if (searchSeq.current === seq) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, fetchSearch]);

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults(null);
      setSearching(false);
      setSearchError("");
    } else {
      setSearching(true);
    }
  };

  // Rieles de descubrimiento: una sola carga al montar; el worker
  // responde Trakt o la lista curada. Si falla no se pinta nada.
  useEffect(() => {
    let cancelled = false;
    void fetchDiscover()
      .then((payload) => {
        if (cancelled) return;
        setDiscover(payload);
        setDiscoverLoading(false);
      })
      .catch(() => {
        if (!cancelled) setDiscoverLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchDiscover]);

  // «Porque preparaste X»: un /api/screen/related por semilla. Solo
  // se repite si cambia el conjunto de semillas (no en cada render).
  useEffect(() => {
    const key = seeds.map((s) => `${s.type}:${s.imdbId}`).join("|");
    if (key === lastSeedsKey.current) return;
    lastSeedsKey.current = key;
    if (!seeds.length) return;
    let cancelled = false;
    void Promise.all(
      seeds.map((seed) =>
        fetchRelated(seed.imdbId, seed.type).then(
          (items) => [`${seed.type}:${seed.imdbId}`, items] as const,
        ),
      ),
    ).then((entries) => {
      if (!cancelled) setRelatedBySeed(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [seeds, fetchRelated]);

  const openSheet = (target: SheetTarget) => setSheetTarget(target);

  // La tarjeta es la misma en resultados y en rieles: póster (o
  // portada tipográfica) + título + tipo/año; tocar abre la hoja de
  // preparación.
  const renderItem = (item: ScreenSearchItem) => {
    const palette = coverPalette(item.imdbId);
    const showPoster = item.hasPoster && !posterBroken.has(item.imdbId);
    const open = () =>
      openSheet({
        type: item.type,
        imdbId: item.imdbId,
        title: item.title,
        year: item.year || undefined,
      });
    return (
      <li key={item.imdbId} className="discover-book">
        <button
          type="button"
          className="discover-cover discover-cover--action"
          onClick={open}
          aria-label={`Preparar ${item.title}`}
        >
          {showPoster ? (
            <img
              className="cover"
              src={screenPosterUrl(item.imdbId)}
              alt=""
              loading="lazy"
              onError={() =>
                setPosterBroken((prev) => new Set(prev).add(item.imdbId))
              }
            />
          ) : (
            <span
              className="cover screen-poster-fallback"
              style={{ background: palette.paper }}
              aria-hidden="true"
            />
          )}
        </button>
        <div className="discover-meta">
          <button
            type="button"
            className="discover-title discover-title--action"
            title={item.title}
            onClick={open}
          >
            {item.title}
          </button>
          <p className="meta">
            {item.type === "tv" ? "Serie" : "Película"}
            {item.year ? ` · ${item.year}` : ""}
          </p>
        </div>
      </li>
    );
  };

  // Lo ya instalado no se ofrece de nuevo en ningún riel.
  const installedIds = useMemo(
    () =>
      new Set(
        works
          .map((w) => w.imdbId)
          .filter((id): id is string => typeof id === "string"),
      ),
    [works],
  );

  const searchingNow = query.trim().length > 0;

  return (
    <div className="screen-shelf">
      <section aria-label="Buscar serie o película">
        <label className="screen-search-label" htmlFor="screen-search">
          Busca una serie o película
        </label>
        <input
          id="screen-search"
          type="search"
          className="screen-search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Título o palabra clave"
          autoComplete="off"
        />
        {searching ? (
          <p className="meta" role="status">
            Buscando…
          </p>
        ) : null}
        {searchError ? (
          <p className="meta" role="alert">
            {searchError}{" "}
            <button
              type="button"
              className="btn--quiet"
              onClick={() => onQueryChange(query)}
            >
              Reintentar
            </button>
          </p>
        ) : null}
        {results && !searching ? (
          results.length ? (
            <ul className="discover-rail discover-rail--grid">
              {results.map(renderItem)}
            </ul>
          ) : (
            <p className="meta">Sin resultados. Prueba con otro título.</p>
          )
        ) : null}
      </section>

      {works.length ? (
        <section aria-label="Tus títulos">
          <h3 className="eyebrow">Tus títulos</h3>
          <ul className="screen-works">
            {works.map((work) => (
              <li key={work.hash} className="screen-work">
                <button
                  type="button"
                  className="screen-work-open"
                  onClick={() => onOpenWork(work)}
                >
                  <BookCover
                    book={{
                      hash: work.hash,
                      name: work.name,
                      title: work.title,
                      author: work.author,
                      cover: work.cover,
                    }}
                  />
                  <span className="screen-work-meta">
                    <strong>{work.title || work.name}</strong>
                    <span className="meta">
                      {work.mediaKind === "tv" ? "Serie" : "Película"}
                      {work.language ? ` · ${work.language.toUpperCase()}` : ""}
                    </span>
                  </span>
                </button>
                <span className="screen-work-actions">
                  {work.mediaKind === "tv" && work.imdbId ? (
                    <button
                      type="button"
                      className="btn--quiet"
                      onClick={() =>
                        openSheet({
                          type: "tv",
                          imdbId: work.imdbId as string,
                          title: work.title || work.name,
                          fixedLanguage:
                            work.language === "es" ? "es" : "en",
                        })
                      }
                    >
                      Otro episodio
                    </button>
                  ) : null}
                  {confirmRemove === work.hash ? (
                    <span className="screen-confirm">
                      <span className="meta">
                        ¿Quitar de este dispositivo?
                      </span>
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={() => onRemoveWork(work.hash)}
                      >
                        Sí, quitar
                      </button>
                      <button
                        type="button"
                        className="btn--quiet"
                        autoFocus
                        onClick={() => setConfirmRemove(null)}
                      >
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn--quiet screen-work-remove"
                      aria-label={`Quitar ${work.title || work.name}`}
                      onClick={() => setConfirmRemove(work.hash)}
                    >
                      Quitar
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="meta shelf-explore-hint">
          Prepara el vocabulario antes de ver una serie o película.
        </p>
      )}

      {/* Rieles de descubrimiento: solo sin texto en el buscador.
          «Porque preparaste X» sale de /api/screen/related por cada
          semilla; el resto llega en /api/screen/discover (Trakt o
          respaldo curado — el origen no cambia la presentación). */}
      {!searchingNow ? (
        <div className="screen-discover">
          {discoverLoading ? (
            <p className="meta" role="status">
              Cargando recomendaciones…
            </p>
          ) : null}
          {seeds.map((seed) => {
            const seedKey = `${seed.type}:${seed.imdbId}`;
            const seedTitle = seed.title || "este título";
            const items = (relatedBySeed[seedKey] ?? []).filter(
              (item) => !installedIds.has(item.imdbId),
            );
            if (!items.length) return null;
            return (
              <section
                key={seedKey}
                aria-label={`Porque preparaste ${seedTitle}`}
                className="screen-discover-rail"
              >
                <h3 className="eyebrow">Porque preparaste «{seedTitle}»</h3>
                <ul className="discover-rail">{items.map(renderItem)}</ul>
              </section>
            );
          })}
          {discover?.rails.map((rail) => {
            const items = rail.items.filter(
              (item) => !installedIds.has(item.imdbId),
            );
            if (!items.length) return null;
            const label =
              rail.id === "trending"
                ? "En tendencia"
                : rail.id === "recent"
                  ? "Estrenos recientes"
                  : "Populares";
            return (
              <section
                key={rail.id}
                aria-label={label}
                className="screen-discover-rail"
              >
                <h3 className="eyebrow">{label}</h3>
                <ul className="discover-rail">{items.map(renderItem)}</ul>
              </section>
            );
          })}
        </div>
      ) : null}

      {sheetTarget ? (
        <ScreenPrepareSheet
          type={sheetTarget.type}
          imdbId={sheetTarget.imdbId}
          title={sheetTarget.title}
          year={sheetTarget.year}
          fixedLanguage={sheetTarget.fixedLanguage}
          works={works}
          loadPreparedChapters={loadPreparedChapters}
          onClose={() => setSheetTarget(null)}
          onPrepare={onPrepareWork}
          fetchSeasons={fetchSeasons}
          fetchEpisodes={fetchEpisodes}
          requestGuide={requestGuide}
        />
      ) : null}

      <p className="meta screen-privacy">
        Solo guardamos una lista de palabras; nunca el diálogo.
      </p>
    </div>
  );
}
