import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import { coverPalette } from "../lib/cover";
import {
  fetchSeasonEpisodes,
  fetchTvSeasons,
  nextEpisodeAfter,
  requestScreenGuide,
  screenErrorMessage,
  screenPosterUrl,
  type ScreenTvDetail,
} from "../lib/screen";
import {
  screenChapterId,
  screenWorkHash,
  type ScreenGuideObject,
  type ScreenWorkRef,
} from "../../shared/screen-guide";
import type { ShelfItem } from "./Shelf";

// Hoja de preparación de «Series y películas»: se abre desde una
// tarjeta de búsqueda o desde «Otro episodio» de un título instalado.
// Eliges idioma del audio (salvo que venga fijado por la obra), la
// temporada y el episodio — solo números, nunca títulos de episodio —
// y «Preparar vocabulario» pide la guía al worker y la instala el
// padre. Si ese capítulo ya está preparado el botón pasa a «Ver
// palabras»: la guía sale de R2 al instante por el mismo flujo.

type Props = {
  type: "movie" | "tv";
  imdbId: string;
  title: string;
  year?: string;
  // «Otro episodio»: el idioma del audio queda fijo al de la obra —
  // una serie preparada en inglés no cambia de voz por accidente.
  fixedLanguage?: "en" | "es";
  // Obras instaladas: con su hash se sabe si este imdbId+idioma ya
  // tiene capítulos preparados (✓ y «Ver palabras»).
  works: ShelfItem[];
  loadPreparedChapters?: (hash: string) => Promise<string[]>;
  onClose: () => void;
  onPrepare: (args: {
    ref: ScreenWorkRef;
    guide: ScreenGuideObject;
    title: string;
  }) => Promise<boolean>;
  /** Inyectables para pruebas. */
  fetchSeasons?: typeof fetchTvSeasons;
  fetchEpisodes?: typeof fetchSeasonEpisodes;
  requestGuide?: typeof requestScreenGuide;
};

export default function ScreenPrepareSheet({
  type,
  imdbId,
  title,
  year,
  fixedLanguage,
  works,
  loadPreparedChapters,
  onClose,
  onPrepare,
  fetchSeasons = fetchTvSeasons,
  fetchEpisodes = fetchSeasonEpisodes,
  requestGuide = requestScreenGuide,
}: Props) {
  const [language, setLanguage] = useState<"en" | "es">(
    fixedLanguage ?? "en",
  );
  const [detail, setDetail] = useState<ScreenTvDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [season, setSeason] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<number[] | null>(null);
  const [episodesError, setEpisodesError] = useState("");
  const [episode, setEpisode] = useState<number | null>(null);
  // Capítulos ya preparados de esta obra+idioma (ids «sNN eNN»/«movie»).
  const [preparedIds, setPreparedIds] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  const [posterBroken, setPosterBroken] = useState(false);
  // El lector tocó una temporada a mano: la auto-preselección del
  // siguiente episodio no le pisa la elección.
  const seasonTouched = useRef(false);
  // Siguiente episodio sugerido por los capítulos preparados; se
  // consume cuando llegan los episodios de su temporada.
  const autoNext = useRef<{ season: number; episode: number } | null>(null);

  // Temporadas de la serie (detalle OMDb): solo el conteo, nunca
  // títulos de episodio.
  useEffect(() => {
    if (type !== "tv") return;
    let cancelled = false;
    void fetchSeasons(imdbId)
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
  }, [type, imdbId, fetchSeasons]);

  // Capítulos preparados de ESTA obra en ESTE idioma: el hash de la
  // obra lleva el idioma, así que cambiar de audio recarga la lista y
  // vuelve a sugerir el siguiente episodio.
  useEffect(() => {
    let cancelled = false;
    seasonTouched.current = false;
    void (async () => {
      const hash = await screenWorkHash(type, imdbId, language);
      if (cancelled || !hash) return;
      const installed = works.some((work) => work.hash === hash);
      const ids =
        installed && loadPreparedChapters
          ? await loadPreparedChapters(hash).catch(() => [] as string[])
          : [];
      if (cancelled) return;
      setPreparedIds(ids);
      const next = nextEpisodeAfter(ids);
      autoNext.current = next;
      if (!seasonTouched.current) {
        setSeason(next?.season ?? null);
        setEpisode(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type, imdbId, language, works, loadPreparedChapters]);

  // Episodios de la temporada elegida (solo números).
  useEffect(() => {
    if (type !== "tv" || season == null) return;
    let cancelled = false;
    void fetchEpisodes(imdbId, season)
      .then((list) => {
        if (cancelled) return;
        if (list) {
          setEpisodes(list);
          // Si el siguiente sugerido es de esta temporada y existe,
          // queda preseleccionado; si no, solo la temporada.
          const hint = autoNext.current;
          if (hint && hint.season === season) {
            autoNext.current = null;
            if (list.includes(hint.episode)) setEpisode(hint.episode);
          }
        } else {
          setEpisodesError("No encontramos episodios en esta temporada.");
        }
      })
      .catch(() => {
        if (!cancelled) setEpisodesError("No pudimos cargar los episodios.");
      });
    return () => {
      cancelled = true;
    };
  }, [type, imdbId, season, fetchEpisodes]);

  const pickSeason = (n: number) => {
    seasonTouched.current = true;
    autoNext.current = null;
    setSeason(n);
    setEpisodes(null);
    setEpisode(null);
    setEpisodesError("");
  };

  const currentRef: ScreenWorkRef | null =
    type === "movie"
      ? { type: "movie", imdbId, language }
      : season != null && episode != null
        ? { type: "tv", imdbId, language, season, episode }
        : null;
  const currentChapterId = currentRef ? screenChapterId(currentRef) : null;
  const alreadyPrepared =
    currentChapterId != null && preparedIds.includes(currentChapterId);

  const canPrepare = currentRef != null && !preparing;

  const prepare = async () => {
    if (!currentRef || !canPrepare) return;
    setPreparing(true);
    setPrepareError("");
    try {
      const { guide } = await requestGuide(currentRef);
      const ok = await onPrepare({
        ref: currentRef,
        guide,
        title,
      });
      if (ok) {
        // El padre ya abrió la obra: la hoja cumplió su función.
        onClose();
      } else {
        setPrepareError("No pudimos guardar la guía. Intenta más tarde.");
      }
    } catch (error) {
      setPrepareError(screenErrorMessage(error));
    } finally {
      setPreparing(false);
    }
  };

  const seasonCount = Math.max(detail?.seasons ?? 0, 1);
  const palette = coverPalette(imdbId);

  return (
    <Sheet label={`Preparar ${title}`} onClose={onClose}>
      <div className="screen-sheet">
        <div className="screen-sheet-head">
          {posterBroken ? (
            <span
              className="screen-sheet-poster screen-sheet-poster--fallback"
              style={{ background: palette.paper }}
              aria-hidden="true"
            />
          ) : (
            <img
              className="screen-sheet-poster"
              src={screenPosterUrl(imdbId)}
              alt=""
              onError={() => setPosterBroken(true)}
            />
          )}
          <div className="screen-sheet-title">
            <h3>{title}</h3>
            <p className="meta">
              {type === "tv" ? "Serie" : "Película"}
              {year ? ` · ${year}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="btn--quiet"
            data-sheet-close
          >
            Cerrar
          </button>
        </div>

        <div className="screen-sheet-body">
          {fixedLanguage ? (
            <p className="meta">
              Audio: {fixedLanguage === "es" ? "Español" : "Inglés"}
            </p>
          ) : (
            <div
              className="discover-filters"
              role="group"
              aria-label="Idioma del audio"
            >
              {(["en", "es"] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  className={`discover-filter-pill${language === lang ? " discover-filter-pill--active" : ""}`}
                  aria-pressed={language === lang}
                  onClick={() => setLanguage(lang)}
                >
                  {lang === "en" ? "Inglés" : "Español"}
                </button>
              ))}
            </div>
          )}

          {type === "tv" ? (
            <>
              {detail ? (
                <div
                  className="discover-filters"
                  role="group"
                  aria-label="Temporada"
                >
                  {Array.from({ length: seasonCount }, (_, i) => i + 1).map(
                    (n) => (
                      <button
                        key={n}
                        type="button"
                        className={`discover-filter-pill${season === n ? " discover-filter-pill--active" : ""}`}
                        aria-pressed={season === n}
                        onClick={() => pickSeason(n)}
                      >
                        {n}
                      </button>
                    ),
                  )}
                </div>
              ) : detailError ? (
                <p className="meta" role="alert">
                  {detailError}
                </p>
              ) : (
                <p className="meta" role="status">
                  Cargando temporadas…
                </p>
              )}

              {season != null ? (
                episodesError ? (
                  <p className="meta" role="alert">
                    {episodesError}
                  </p>
                ) : episodes ? (
                  <div
                    className="screen-ep-grid"
                    role="group"
                    aria-label="Episodio"
                  >
                    {episodes.map((n) => {
                      const epChapterId = screenChapterId({
                        type: "tv",
                        imdbId,
                        language,
                        season,
                        episode: n,
                      });
                      const prepared =
                        epChapterId != null &&
                        preparedIds.includes(epChapterId);
                      const active = episode === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          className={`screen-ep${active ? " screen-ep--active" : ""}`}
                          aria-pressed={active}
                          aria-label={
                            prepared
                              ? `Episodio ${n}, ya preparado`
                              : `Episodio ${n}`
                          }
                          onClick={() =>
                            setEpisode((current) =>
                              current === n ? null : n,
                            )
                          }
                        >
                          {prepared ? "✓ " : ""}
                          {n}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="meta" role="status">
                    Cargando episodios…
                  </p>
                )
              ) : null}
            </>
          ) : null}

          <button
            type="button"
            className="btn"
            disabled={!canPrepare}
            onClick={() => void prepare()}
          >
            {preparing
              ? "Preparando…"
              : alreadyPrepared
                ? "Ver palabras"
                : "Preparar vocabulario"}
          </button>
          {preparing ? (
            <p className="meta" role="status">
              Buscando subtítulos y armando tu lista… puede tardar unos
              segundos.
            </p>
          ) : null}
          {prepareError ? (
            <p className="meta" role="alert">
              {prepareError}
            </p>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
