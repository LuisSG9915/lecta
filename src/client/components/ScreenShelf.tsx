import { useEffect, useRef, useState } from "react";
import BookCover from "./BookCover";
import { coverPalette } from "../lib/cover";
import {
  fetchSeasonEpisodes,
  fetchTvSeasons,
  requestScreenGuide,
  ScreenApiError,
  screenPosterUrl,
  searchScreen,
  type ScreenSearchItem,
  type ScreenTvDetail,
} from "../lib/screen";
import type { ScreenGuideObject, ScreenWorkRef } from "../../shared/screen-guide";
import type { ShelfItem } from "./Shelf";

// «Series y películas»: obras audiovisuales preparadas («Tus
// títulos») y el buscador OMDb → SubDL del worker. El flujo es el
// mismo que el modo papel: preparar el vocabulario de un episodio o
// película y abrir la hoja de palabras — nunca el diálogo.
//
// Toda la red pasa por /api/screen/* que exige sesión; los errores
// del servidor (401/404/429/503) se muestran tal cual y el fallo de
// red ofrece «Reintentar».

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
  /** Inyectables para pruebas. */
  fetchSearch?: typeof searchScreen;
  fetchSeasons?: typeof fetchTvSeasons;
  fetchEpisodes?: typeof fetchSeasonEpisodes;
  requestGuide?: typeof requestScreenGuide;
};

const SEARCH_DEBOUNCE_MS = 350;

const errorMessage = (error: unknown): string => {
  if (error instanceof ScreenApiError) {
    if (error.status === 0)
      return "Sin conexión. Revisa tu red e inténtalo de nuevo.";
    if (error.status === 401)
      return "Inicia sesión para preparar vocabulario.";
    return error.message;
  }
  return "No pudimos completar la acción. Intenta más tarde.";
};

export default function ScreenShelf({
  works,
  onOpenWork,
  onRemoveWork,
  onPrepareWork,
  fetchSearch = searchScreen,
  fetchSeasons = fetchTvSeasons,
  fetchEpisodes = fetchSeasonEpisodes,
  requestGuide = requestScreenGuide,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScreenSearchItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<ScreenSearchItem | null>(null);
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [detail, setDetail] = useState<ScreenTvDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [season, setSeason] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<number[] | null>(null);
  const [episodesError, setEpisodesError] = useState("");
  const [episode, setEpisode] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  const searchSeq = useRef(0);

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

  // Elegir (o quitar) un resultado reinicia toda la selección: el
  // detalle de series y los episodios se vuelven a pedir abajo.
  const chooseResult = (item: ScreenSearchItem | null) => {
    setSelected(item);
    setDetail(null);
    setDetailError("");
    setSeason(null);
    setEpisodes(null);
    setEpisode(null);
    setPrepareError("");
  };

  // Al elegir una serie se piden sus temporadas (detalle OMDb).
  useEffect(() => {
    if (selected?.type !== "tv") return;
    let cancelled = false;
    void fetchSeasons(selected.imdbId)
      .then((d) => {
        if (cancelled) return;
        if (d) setDetail(d);
        else setDetailError("No encontramos las temporadas de esta serie.");
      })
      .catch(() => {
        if (!cancelled) setDetailError("No pudimos cargar las temporadas.");
      });
    return () => {
      cancelled = true;
    };
  }, [selected, fetchSeasons]);

  const onSeasonChange = (value: string) => {
    setSeason(value === "" ? null : Number(value));
    setEpisodes(null);
    setEpisode(null);
    setEpisodesError("");
  };

  // Al elegir temporada se piden sus episodios (solo números).
  useEffect(() => {
    if (selected?.type !== "tv" || season == null) return;
    let cancelled = false;
    void fetchEpisodes(selected.imdbId, season)
      .then((list) => {
        if (cancelled) return;
        if (list) setEpisodes(list);
        else setEpisodesError("No encontramos episodios en esta temporada.");
      })
      .catch(() => {
        if (!cancelled) setEpisodesError("No pudimos cargar los episodios.");
      });
    return () => {
      cancelled = true;
    };
  }, [selected, season, fetchEpisodes]);

  const canPrepare =
    selected != null &&
    !preparing &&
    (selected.type === "movie" || (season != null && episode != null));

  const prepare = async () => {
    if (!selected || !canPrepare) return;
    setPreparing(true);
    setPrepareError("");
    try {
      const ref: ScreenWorkRef =
        selected.type === "tv"
          ? {
              type: "tv",
              imdbId: selected.imdbId,
              language,
              season: season as number,
              episode: episode as number,
            }
          : { type: "movie", imdbId: selected.imdbId, language };
      const { guide } = await requestGuide(ref);
      const ok = await onPrepareWork({
        ref,
        guide,
        title: selected.title,
      });
      if (!ok) setPrepareError("No pudimos guardar la guía. Intenta más tarde.");
    } catch (error) {
      setPrepareError(errorMessage(error));
    } finally {
      setPreparing(false);
    }
  };

  const resetSelection = () => {
    chooseResult(null);
  };

  return (
    <div className="screen-shelf">
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
                <button
                  type="button"
                  className="btn--quiet screen-work-remove"
                  aria-label={`Quitar ${work.title || work.name}`}
                  onClick={() => onRemoveWork(work.hash)}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="meta shelf-explore-hint">
          Prepara el vocabulario antes de ver una serie o película.
        </p>
      )}

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
            {searchError}
          </p>
        ) : null}
        {results && !searching ? (
          results.length ? (
            <ul className="screen-results">
              {results.map((item) => (
                <li key={item.imdbId}>
                  <button
                    type="button"
                    className="screen-result"
                    aria-pressed={selected?.imdbId === item.imdbId}
                    onClick={() =>
                      chooseResult(
                        selected?.imdbId === item.imdbId ? null : item,
                      )
                    }
                  >
                    {item.hasPoster ? (
                      <img
                        className="screen-result-poster"
                        src={screenPosterUrl(item.imdbId)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span
                        className="screen-result-poster screen-result-poster--fallback"
                        style={{
                          background: coverPalette(item.imdbId).paper,
                        }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="screen-result-meta">
                      <strong>{item.title}</strong>
                      <span className="meta">
                        {item.type === "tv" ? "Serie" : "Película"}
                        {item.year ? ` · ${item.year}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="meta">Sin resultados. Prueba con otro título.</p>
          )
        ) : null}
      </section>

      {selected ? (
        <section aria-label={`Preparar ${selected.title}`}>
          <h3 className="eyebrow">{selected.title}</h3>
          <div className="screen-prepare">
            <label htmlFor="screen-lang">Idioma del audio</label>
            <select
              id="screen-lang"
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value === "es" ? "es" : "en")
              }
            >
              <option value="en">Inglés</option>
              <option value="es">Español</option>
            </select>

            {selected.type === "tv" ? (
              <>
                <label htmlFor="screen-season">Temporada</label>
                <select
                  id="screen-season"
                  value={season ?? ""}
                  onChange={(event) => onSeasonChange(event.target.value)}
                  disabled={!detail}
                >
                  <option value="">Elige…</option>
                  {detail
                    ? Array.from(
                        { length: Math.max(detail.seasons ?? 0, 1) },
                        (_, i) => i + 1,
                      ).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))
                    : null}
                </select>
                {detailError ? (
                  <p className="meta" role="alert">
                    {detailError}
                  </p>
                ) : null}

                <label htmlFor="screen-episode">Episodio</label>
                <select
                  id="screen-episode"
                  value={episode ?? ""}
                  onChange={(event) =>
                    setEpisode(
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                    )
                  }
                  disabled={!episodes}
                >
                  <option value="">Elige…</option>
                  {episodes?.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                {episodesError ? (
                  <p className="meta" role="alert">
                    {episodesError}
                  </p>
                ) : null}
              </>
            ) : null}

            <button
              type="button"
              className="btn"
              disabled={!canPrepare}
              onClick={() => void prepare()}
            >
              {preparing ? "Preparando…" : "Preparar vocabulario"}
            </button>
            {prepareError ? (
              <p className="meta" role="alert">
                {prepareError}
              </p>
            ) : null}
            <button
              type="button"
              className="btn--quiet"
              onClick={resetSelection}
            >
              Elegir otro
            </button>
          </div>
        </section>
      ) : null}

      <p className="meta screen-privacy">
        Solo guardamos una lista de palabras; nunca el diálogo.
      </p>
    </div>
  );
}
