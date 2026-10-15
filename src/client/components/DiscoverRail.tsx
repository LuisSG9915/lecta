import { useEffect, useMemo, useRef, useState } from "react";
import { coverPalette } from "../lib/cover";
import {
  catalogCoverUrl,
  catalogVocab,
  entriesByFormOf,
  getBookMoodTags,
  listCatalog,
  manifestBookForms,
  type CatalogBook,
} from "../lib/catalog";
import {
  coverageLabel,
  coverageOfBook,
  inputsForCoverage,
  type BookCoverage,
  type CoverageInputs,
} from "../lib/coverage";
import { captureDbScope, type DbScope } from "../lib/idb";
import type { ShelfItem } from "./Shelf";

// «Descubre»: el riel del catálogo público bajo la estantería. Nunca
// bloquea — sin índice (ni red ni caché) la sección entera no se
// pinta. Las coberturas se calculan en local con el manifiesto de cada
// libro, traídos de uno en uno para no competir con la lectura; con
// saveData no se piden y las tarjetas se muestran sin insignia.

type DiscoverRailProps = {
  // La estantería visible: `epubSha256` del ítem del catálogo casa con
  // el hash del libro guardado → la tarjeta ofrece «Abrir» en vez de
  // «Obtener», sin descargar para comprobarlo.
  library: ShelfItem[];
  onOpen: (book: ShelfItem) => void;
  // «Obtener»: el padre baja el EPUB y lo pasa al flujo normal de
  // añadir libro (misma validación, dedup y sincronización).
  onGet: (item: CatalogBook) => Promise<void> | void;
  // Inyectables para pruebas. loadInputs puede devolver null: sin
  // perfil medible (o sin red) el riel queda sin insignias.
  fetchIndex?: typeof listCatalog;
  fetchVocab?: typeof catalogVocab;
  loadInputs?: (
    language: string,
    scope?: DbScope,
  ) => Promise<CoverageInputs | null>;
};

// Cuántos manifiestos traer por montaje: alcanza para poblar las
// insignias visibles sin descargar el catálogo completo cada vez.
const VOCAB_PREFETCH_LIMIT = 24;

export const DISCOVER_MOOD_FILTERS = [
  "Todos",
  "Ideal para sesiones de 10 min",
  "Poesía y Modernismo",
  "Vocabulario Elevado",
];

export default function DiscoverRail({
  library,
  onOpen,
  onGet,
  fetchIndex = listCatalog,
  fetchVocab = catalogVocab,
  loadInputs = inputsForCoverage,
}: DiscoverRailProps) {
  const [books, setBooks] = useState<CatalogBook[] | null>(null);
  const [coverages, setCoverages] = useState<Map<string, BookCoverage>>(
    new Map(),
  );
  const [confidence, setConfidence] = useState<CoverageInputs["confidence"]>(
    "low",
  );
  const [getting, setGetting] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [coverBroken, setCoverBroken] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<string>("Todos");
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void fetchIndex(scope).then((index) => {
      if (cancelled || !index?.books.length) return;
      setBooks(index.books);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchIndex]);

  // Coberturas: una sola lectura del perfil, luego un manifiesto a la
  // vez. Con saveData no se pide nada — el riel funciona sin insignias.
  useEffect(() => {
    if (!books?.length) return;
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;

    let cancelled = false;
    const scope: DbScope | undefined = captureDbScope();
    void (async () => {
      const inputs = await loadInputs("es", scope).catch(() => null);
      if (!inputs || cancelled) return;
      if (!cancelledRef.current) setConfidence(inputs.confidence);
      for (const book of books.slice(0, VOCAB_PREFETCH_LIMIT)) {
        if (cancelled) return;
        const manifest = await fetchVocab(book.id, scope).catch(() => null);
        // Un manifiesto que no baja no apaga el resto del riel.
        if (!manifest || cancelled) continue;
        const coverage = coverageOfBook(
          manifestBookForms(manifest),
          entriesByFormOf(manifest),
          inputs,
        );
        if (cancelled) return;
        setCoverages((prev) => {
          const next = new Map(prev);
          next.set(book.id, coverage);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // El índice llega una vez; el perfil se relee en el próximo
    // montaje (volver a la estantería tras leer).
  }, [books, fetchVocab, loadInputs]);

  const ownedByHash = useMemo(
    () => new Map(library.map((book) => [book.hash, book])),
    [library],
  );

  // Orden: con insignia medida primero, de más cobertura a menos; los
  // demás conservan el orden curado del índice.
  const ordered = useMemo(() => {
    if (!books) return [];
    const measured: CatalogBook[] = [];
    const rest: CatalogBook[] = [];
    for (const book of books) {
      (coverages.has(book.id) ? measured : rest).push(book);
    }
    measured.sort(
      (a, b) => (coverages.get(b.id)?.percent ?? 0) - (coverages.get(a.id)?.percent ?? 0),
    );
    return [...measured, ...rest];
  }, [books, coverages]);

  // Filtrado por tag / estado de ánimo
  const filtered = useMemo(() => {
    if (!activeFilter || activeFilter === "Todos") return ordered;
    return ordered.filter((b) => getBookMoodTags(b).includes(activeFilter));
  }, [ordered, activeFilter]);

  if (!books) return null;

  const get = async (book: CatalogBook) => {
    if (getting) return;
    setGetting(book.id);
    setErrorId(null);
    try {
      await onGet(book);
    } catch {
      if (!cancelledRef.current) setErrorId(book.id);
    } finally {
      if (!cancelledRef.current) setGetting(null);
    }
  };

  return (
    <section aria-label="Descubre" className="discover">
      <div className="discover-head">
        <h2 className="eyebrow shelf-eyebrow">Descubre</h2>
        <div className="discover-filters" role="tablist" aria-label="Filtros de catálogo">
          {DISCOVER_MOOD_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`discover-filter-pill${activeFilter === filter ? " discover-filter-pill--active" : ""}`}
              onClick={() => setActiveFilter(filter)}
              role="tab"
              aria-selected={activeFilter === filter}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      <ul className="discover-rail">
        {filtered.map((book) => {
          const coverage = coverages.get(book.id);
          const owned = book.epubSha256
            ? ownedByHash.get(book.epubSha256)
            : undefined;
          const label = coverage
            ? coverageLabel(coverage.percent, confidence)
            : null;
          const palette = coverPalette(book.id);
          const showCover = book.cover && !coverBroken.has(book.id);
          const tags = getBookMoodTags(book);
          return (
            <li key={book.id} className="discover-book">
              <div className="discover-cover">
                {showCover ? (
                  <img
                    className="cover"
                    src={catalogCoverUrl(book.id)}
                    alt={`Portada de ${book.title}`}
                    loading="lazy"
                    onError={() =>
                      setCoverBroken((prev) => new Set(prev).add(book.id))
                    }
                  />
                ) : (
                  <div
                    className="cover cover--generated"
                    role="img"
                    aria-label={`Portada de ${book.title}`}
                    style={
                      {
                        "--cover-paper": palette.paper,
                        "--cover-ink": palette.ink,
                        "--cover-accent": palette.accent,
                      } as React.CSSProperties
                    }
                  >
                    <span className="cover-frame">
                      <span className="cover-title">{book.title}</span>
                      <span className="cover-ornament" aria-hidden="true" />
                      <span className="cover-author">{book.author}</span>
                    </span>
                  </div>
                )}
                {coverage ? (
                  <span
                    className="discover-badge"
                    title={`Conoces aproximadamente el ${coverage.percent}% del vocabulario de este libro`}
                  >
                    ~{coverage.percent}%
                  </span>
                ) : null}
              </div>
              <div className="discover-meta">
                <div className="discover-tags" aria-label="Etiquetas">
                  {tags.slice(0, 2).map((t) => (
                    <span key={t} className="discover-tag-pill">{t}</span>
                  ))}
                </div>
                <p className="discover-title" title={book.title}>
                  {book.title}
                </p>
                <p className="meta">{book.author}</p>
                {label ? <p className="meta discover-label">{label}</p> : null}
                {coverage?.newWordsCount != null && coverage.newWordsCount > 0 ? (
                  <p className="meta discover-new-words">
                    +{coverage.newWordsCount} palabras útiles
                  </p>
                ) : null}
              </div>
              {owned ? (
                <button
                  type="button"
                  className="btn discover-action"
                  onClick={() => onOpen(owned)}
                >
                  Abrir
                </button>
              ) : (
                <button
                  type="button"
                  className="btn discover-action"
                  onClick={() => void get(book)}
                  disabled={getting !== null}
                >
                  {getting === book.id ? "Descargando…" : "Obtener"}
                </button>
              )}
              {errorId === book.id ? (
                <p className="meta" role="alert">
                  No se pudo descargar. Inténtalo de nuevo.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
