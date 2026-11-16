import { useRef, useState, type FormEvent } from "react";
import BookCover from "./BookCover";
import { coverToJpegBlob } from "../lib/cover";
import {
  isValidSubtitleRef,
  subtitleErrorMessage,
  subtitleFileToGuide,
  type SubtitleWorkLanguage,
  type SubtitleWorkRef,
  type SubtitleWorkType,
} from "../lib/subtitle-works";
import type { ShelfItem } from "./Shelf";

// «Series y películas» con subtítulos propios: el usuario elige un
// archivo (.srt, .vtt o .ass) y el navegador arma la guía de
// vocabulario. El archivo no sale del dispositivo y el servidor no
// participa: no hay búsqueda, pósters ni descargas de terceros. Lo que
// queda guardado es una lista de palabras por episodio, nunca el
// diálogo.

export type SubtitleGuide = {
  forms: string[];
  capitalOnly: string[];
  phrases: string[];
};

type Props = {
  /** Obras ya preparadas en este dispositivo (mediaKind). */
  works: ShelfItem[];
  /** Abrir la guía papel de una obra (índice de episodios/capítulo). */
  onOpenWork: (item: ShelfItem) => void;
  /** Quitar una obra: borrado solo local. */
  onRemoveWork: (hash: string) => void;
  /**
   * Instala la guía del episodio/película y abre la obra. Devuelve
   * false si algo falló al guardar.
   */
  onPrepareWork: (args: {
    ref: SubtitleWorkRef;
    guide: SubtitleGuide;
    /** Imagen que eligió el usuario como portada (JPEG ya reducido). */
    cover?: Blob;
  }) => Promise<boolean>;
};

// Imagen de portada: la elige el usuario, queda solo en su dispositivo.
// Se acepta cualquier imagen razonable y se reduce a un JPEG chico.
const COVER_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const COVER_MAX_OUTPUT_BYTES = 400_000;

const parseIntField = (value: string): number | undefined => {
  if (!/^\d{1,3}$/.test(value.trim())) return undefined;
  return Number(value);
};

export default function SubtitleShelf({
  works,
  onOpenWork,
  onRemoveWork,
  onPrepareWork,
}: Props) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<SubtitleWorkType>("tv");
  const [language, setLanguage] = useState<SubtitleWorkLanguage>("en");
  const [season, setSeason] = useState("1");
  const [episode, setEpisode] = useState("1");
  const [fileName, setFileName] = useState("");
  const [imageName, setImageName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // «Quitar» en dos pasos: el hash en confirmación o null.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // «Otro episodio»: repite título, tipo e idioma de la obra y propone
  // el episodio siguiente; solo falta elegir el archivo.
  const prepareAnother = (work: ShelfItem) => {
    setTitle(work.title || work.name);
    setType(work.mediaKind === "movie" ? "movie" : "tv");
    setLanguage(work.language === "es" ? "es" : "en");
    setEpisode((prev) => String((parseIntField(prev) ?? 0) + 1));
    setError("");
    formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    fileRef.current?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Elige el archivo de subtítulos.");
      return;
    }
    const ref: SubtitleWorkRef = {
      type,
      title: title.trim(),
      language,
      ...(type === "tv"
        ? { season: parseIntField(season), episode: parseIntField(episode) }
        : {}),
    };
    if (!isValidSubtitleRef(ref)) {
      setError(
        type === "tv"
          ? "Escribe el título y una temporada y un episodio válidos."
          : "Escribe el título.",
      );
      return;
    }
    const image = imageRef.current?.files?.[0];
    if (
      image &&
      (!image.type.startsWith("image/") || image.size > COVER_MAX_INPUT_BYTES)
    ) {
      setError("Esa imagen no sirve: elige una foto o un póster de menos de 10 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let cover: Blob | undefined;
      if (image) {
        const jpeg = await coverToJpegBlob(image);
        // Si no se pudo decodificar, coverToJpegBlob devuelve el original:
        // una imagen que sigue grande no se guarda.
        if (jpeg.size > COVER_MAX_OUTPUT_BYTES) {
          setError("No pudimos usar esa imagen. Prueba con otra.");
          return;
        }
        cover = jpeg;
      }
      const result = await subtitleFileToGuide(file, language);
      if (!result.ok) {
        setError(subtitleErrorMessage(result.reason));
        return;
      }
      const saved = await onPrepareWork({
        ref,
        guide: {
          forms: result.forms,
          capitalOnly: result.capitalOnly,
          phrases: result.phrases,
        },
        ...(cover ? { cover } : {}),
      });
      if (!saved) {
        setError("No pudimos guardar la guía en este dispositivo.");
        return;
      }
      if (fileRef.current) fileRef.current.value = "";
      if (imageRef.current) imageRef.current.value = "";
      setFileName("");
      setImageName("");
      // Siguiente episodio listo para la próxima vez.
      if (type === "tv") setEpisode(String((ref.episode ?? 0) + 1));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-shelf">
      <form
        ref={formRef}
        className="subs-form"
        onSubmit={(event) => void submit(event)}
        aria-label="Preparar vocabulario con tus subtítulos"
      >
        <p className="meta">
          Trae el archivo de subtítulos de lo que vas a ver (.srt, .vtt o
          .ass) y preparamos su vocabulario. El archivo se queda en tu
          dispositivo: no se sube a ningún servidor. Usa solo subtítulos que
          tengas derecho a usar.
        </p>
        <label className="screen-search-label" htmlFor="subs-title">
          Título
        </label>
        <input
          id="subs-title"
          className="screen-search-input"
          type="text"
          value={title}
          maxLength={120}
          autoComplete="off"
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="subs-row">
          <label className="subs-field">
            <span className="meta">Es una</span>
            <select
              value={type}
              onChange={(event) =>
                setType(event.target.value === "movie" ? "movie" : "tv")
              }
            >
              <option value="tv">Serie</option>
              <option value="movie">Película</option>
            </select>
          </label>
          <label className="subs-field">
            <span className="meta">Idioma de los subtítulos</span>
            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value === "es" ? "es" : "en")
              }
            >
              <option value="en">Inglés</option>
              <option value="es">Español</option>
            </select>
          </label>
          {type === "tv" ? (
            <>
              <label className="subs-field">
                <span className="meta">Temporada</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={season}
                  maxLength={2}
                  onChange={(event) => setSeason(event.target.value)}
                />
              </label>
              <label className="subs-field">
                <span className="meta">Episodio</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={episode}
                  maxLength={3}
                  onChange={(event) => setEpisode(event.target.value)}
                />
              </label>
            </>
          ) : null}
        </div>
        <label className="subs-field">
          <span className="meta">Archivo de subtítulos</span>
          <input
            ref={fileRef}
            type="file"
            accept=".srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip"
            onChange={(event) =>
              setFileName(event.target.files?.[0]?.name ?? "")
            }
          />
        </label>
        <label className="subs-field">
          <span className="meta">Imagen (opcional)</span>
          <input
            ref={imageRef}
            type="file"
            accept="image/*"
            onChange={(event) =>
              setImageName(event.target.files?.[0]?.name ?? "")
            }
          />
          <span className="meta">
            Un póster o foto tuya: se queda en tu dispositivo. Sin imagen
            usamos una portada con el título.
          </span>
        </label>
        {error ? (
          <p className="meta subs-error" role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Preparando…" : "Preparar vocabulario"}
          </button>
          {fileName ? <span className="meta"> {fileName}</span> : null}
          {imageName ? <span className="meta"> · {imageName}</span> : null}
        </div>
      </form>

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
                  {work.mediaKind === "tv" ? (
                    <button
                      type="button"
                      className="btn--quiet"
                      onClick={() => prepareAnother(work)}
                    >
                      Otro episodio
                    </button>
                  ) : null}
                  {confirmRemove === work.hash ? (
                    <span className="screen-confirm">
                      <span className="meta">¿Quitar de este dispositivo?</span>
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={() => {
                          setConfirmRemove(null);
                          onRemoveWork(work.hash);
                        }}
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
      ) : null}

      <p className="meta screen-privacy">
        Solo guardamos una lista de palabras; nunca el diálogo.
      </p>
    </div>
  );
}
