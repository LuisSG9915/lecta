import { useEffect, useMemo, useRef, useState } from "react";
import Dialog from "./Dialog";
import {
  extractGlossaryTerms,
  filterAndSortGlossary,
  formatZipfLabel,
  getAvailableLetters,
  type GlossaryFilter,
  type GlossarySort,
  type GlossaryTerm,
} from "../lib/glossary";
import { analyzeStoredBook, loadBookVocab } from "../lib/book-vocab";
import {
  captureDbScope,
  listAllKnowledge,
  listSavedWords,
  saveWordWithKnowledge,
  type SavedWord,
} from "../lib/idb";
import { lookupWord, type LexiconEntry } from "../lib/lexicon";
import { award, localDayKey } from "../lib/game";
import { triggerHaptic } from "../lib/haptics";

const PAGE_SIZE_OPTIONS = [50, 100, 200];
const SPANISH_ALPHABET = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
  "K", "L", "M", "N", "Ñ", "O", "P", "Q", "R", "S",
  "T", "U", "V", "W", "X", "Y", "Z",
];

export type BookGlossaryModalProps = {
  bookHash: string;
  bookTitle?: string;
  language?: string;
  onClose: () => void;
  onSelectTerm?: (word: string) => void;
  onWordSaved?: (word: SavedWord) => void;
};

type DefinitionState = {
  loading: boolean;
  entries?: LexiconEntry[];
  error?: string;
};

/**
 * Genera la ventana de páginas visibles para una paginación clara.
 */
function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "...")[] = [];
  pages.push(1);
  if (current > 3) {
    pages.push("...");
  }
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let p = start; p <= end; p++) {
    pages.push(p);
  }
  if (current < total - 2) {
    pages.push("...");
  }
  pages.push(total);
  return pages;
}

export default function BookGlossaryModal({
  bookHash,
  bookTitle,
  language = "es",
  onClose,
  onSelectTerm,
  onWordSaved,
}: BookGlossaryModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [totalForms, setTotalForms] = useState(0);
  const [totalWordCount, setTotalWordCount] = useState(0);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GlossaryFilter>("cultisms");
  const [sort, setSort] = useState<GlossarySort>("rarity");
  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const [posFilter, setPosFilter] = useState<string>("all");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const [definitions, setDefinitions] = useState<Record<string, DefinitionState>>({});
  const [savingTerm, setSavingTerm] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const listContainerRef = useRef<HTMLDivElement>(null);

  // Carga y análisis del vocabulario de la obra
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const scope = captureDbScope();
      try {
        let manifest = await loadBookVocab(bookHash, scope);
        if (!manifest) {
          manifest = await analyzeStoredBook(bookHash, scope);
        }

        if (cancelled) return;
        if (!manifest) {
          setError(
            "No se pudo cargar el análisis léxico de esta obra. Verifica tu conexión o vuelve a intentar.",
          );
          setLoading(false);
          return;
        }

        const [savedList, knowledgeList] = await Promise.all([
          listSavedWords(language, scope).catch(() => []),
          listAllKnowledge(language, scope).catch(() => []),
        ]);

        if (cancelled) return;

        const savedForms = new Set(savedList.map((w) => w.form.toLowerCase()));
        const knownLemmas = new Set(
          knowledgeList
            .filter((k) => !k.deleted && k.status === "known")
            .map((k) => k.lemma.toLowerCase()),
        );

        const extracted = extractGlossaryTerms(manifest, savedForms, knownLemmas);
        setTerms(extracted);
        setTotalForms(manifest.uniqueForms || manifest.forms.length);
        setTotalWordCount(manifest.wordCount || 0);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Error al analizar el vocabulario de la obra.",
        );
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookHash, language, reloadTick]);

  // Contadores para las pestañas de filtro
  const cultismsCount = useMemo(
    () => terms.filter((t) => t.isCultism).length,
    [terms],
  );
  const savedCount = useMemo(
    () => terms.filter((t) => t.isSaved).length,
    [terms],
  );
  const learningCount = useMemo(
    () => terms.filter((t) => !t.isKnown && !t.isSaved).length,
    [terms],
  );

  // Letras disponibles para la categoría, búsqueda y POS actuales
  const availableLetters = useMemo(() => {
    const subset = filterAndSortGlossary(terms, query, filter, "alpha", null, posFilter);
    return getAvailableLetters(subset);
  }, [terms, query, filter, posFilter]);

  // Lista filtrada completa
  const filtered = useMemo(
    () => filterAndSortGlossary(terms, query, filter, sort, letterFilter, posFilter),
    [terms, query, filter, sort, letterFilter, posFilter],
  );

  // Cálculos de paginación
  const totalResults = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const displayedTerms = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const pageWindow = useMemo(
    () => getPageWindow(safePage, totalPages),
    [safePage, totalPages],
  );

  // Cambiar de página con scroll suave hacia arriba
  const handlePageChange = (newPage: number) => {
    if (newPage === safePage || newPage < 1 || newPage > totalPages) return;
    triggerHaptic("selection");
    setPage(newPage);
    if (typeof listContainerRef.current?.scrollTo === "function") {
      listContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    } else if (listContainerRef.current) {
      listContainerRef.current.scrollTop = 0;
    }
  };

  // Expandir un término y consultar su definición
  const toggleExpand = (term: GlossaryTerm) => {
    triggerHaptic("selection");
    if (expandedTerm === term.form) {
      setExpandedTerm(null);
      return;
    }
    setExpandedTerm(term.form);

    if (!definitions[term.form]) {
      setDefinitions((prev) => ({
        ...prev,
        [term.form]: { loading: true },
      }));

      void (async () => {
        const scope = captureDbScope();
        const res = await lookupWord(term.form, language, scope);
        if (res.ok && res.found) {
          setDefinitions((prev) => ({
            ...prev,
            [term.form]: { loading: false, entries: res.entries },
          }));
        } else if (res.ok && !res.found) {
          setDefinitions((prev) => ({
            ...prev,
            [term.form]: {
              loading: false,
              error: "Sin definición registrada en el catálogo general.",
            },
          }));
        } else {
          setDefinitions((prev) => ({
            ...prev,
            [term.form]: {
              loading: false,
              error: !res.ok ? res.error : "No disponible.",
            },
          }));
        }
      })();
    }
  };

  // Guardar palabra directamente al Cuaderno
  const handleQuickSave = async (term: GlossaryTerm) => {
    if (term.isSaved || savingTerm === term.form) return;
    setSavingTerm(term.form);
    triggerHaptic("success");

    try {
      const scope = captureDbScope();
      const defData = definitions[term.form];
      let entry = defData?.entries?.[0];
      let sense = entry?.senses?.[0];

      if (!entry) {
        const res = await lookupWord(term.form, language, scope).catch(() => null);
        if (res?.ok && res.found) {
          entry = res.entries?.[0];
          sense = entry?.senses?.[0];
        }
      }

      const { word: savedWord } = await saveWordWithKnowledge(
        {
          word: {
            form: term.form,
            lemma: entry?.lemma || term.lemma,
            pos: entry?.pos || term.pos,
            meaning: sense?.definition,
            senseEntryId: entry?.entryId,
            senseOrder: sense?.senseOrder,
            language,
            bookHash,
          },
          knowledge: {
            language,
            lemma: (entry?.lemma || term.lemma || term.form).toLowerCase(),
            known: false,
            source: "saved",
          },
        },
        scope,
      );

      // Otorgar gamificación
      const awardedAt = Date.now();
      void award(
        { kind: "saved", zipf: term.zipf ?? null },
        scope,
        {
          id: `saved:${savedWord.key}:${savedWord.updatedAt ?? savedWord.savedAt}`,
          at: awardedAt,
          dayKey: localDayKey(awardedAt),
        },
      );

      // Actualizar estado local
      setTerms((prev) =>
        prev.map((t) => (t.form === term.form ? { ...t, isSaved: true } : t)),
      );
      onWordSaved?.(savedWord);
    } catch {
      // Si falla, permitir reintentar
    } finally {
      setSavingTerm(null);
    }
  };

  const handleOpenStudy = (form: string) => {
    triggerHaptic("selection");
    if (onSelectTerm) {
      onSelectTerm(form);
      onClose();
    }
  };

  return (
    <Dialog label="Glosario de la obra" className="dialog--glossary" onClose={onClose}>
      <div className="glossary-modal">
        {/* Cabecera del diálogo */}
        <header className="glossary-head">
          <div className="glossary-head-titles">
            <h2 className="glossary-title">Glosario de la obra</h2>
            {bookTitle ? (
              <span className="glossary-book-subtitle meta">«{bookTitle}»</span>
            ) : null}
          </div>
          <button
            type="button"
            className="btn--quiet glossary-close-btn"
            onClick={onClose}
            aria-label="Cerrar glosario"
            data-autofocus
          >
            Cerrar
          </button>
        </header>

        {loading ? (
          <div className="glossary-loading">
            <span className="glossary-spinner" aria-hidden="true" />
            <p className="glossary-loading-text">
              Analizando el universo léxico del libro...
            </p>
            <p className="meta">
              Identificando cultismos literarios, singularidades léxicas y frecuencias.
            </p>
          </div>
        ) : error ? (
          <div className="glossary-error">
            <p>{error}</p>
            <button
              type="button"
              className="btn--quiet glossary-retry-btn"
              onClick={() => {
                setLoading(true);
                setError(null);
                setReloadTick((t) => t + 1);
              }}
            >
              Reintentar análisis
            </button>
          </div>
        ) : (
          <>
            {/* Resumen estadístico de la obra */}
            {totalForms > 0 ? (
              <div className="glossary-stats-bar" aria-label="Estadísticas léxicas">
                <div className="glossary-stat-chip">
                  <span className="glossary-stat-icon" aria-hidden="true">📖</span>
                  <span className="glossary-stat-value">{totalForms.toLocaleString("es")}</span>
                  <span className="glossary-stat-label">formas</span>
                </div>
                <div className="glossary-stat-chip">
                  <span className="glossary-stat-icon" aria-hidden="true">📑</span>
                  <span className="glossary-stat-value">{totalWordCount.toLocaleString("es")}</span>
                  <span className="glossary-stat-label">palabras</span>
                </div>
                <div className="glossary-stat-chip glossary-stat-chip--cultisms">
                  <span className="glossary-stat-icon" aria-hidden="true">✦</span>
                  <span className="glossary-stat-value">{cultismsCount.toLocaleString("es")}</span>
                  <span className="glossary-stat-label">cultismos</span>
                </div>
                <div className="glossary-stat-chip glossary-stat-chip--saved">
                  <span className="glossary-stat-icon" aria-hidden="true">🔖</span>
                  <span className="glossary-stat-value">{savedCount.toLocaleString("es")}</span>
                  <span className="glossary-stat-label">en cuaderno</span>
                </div>
              </div>
            ) : null}

            {/* Buscador */}
            <div className="glossary-search-wrap">
              <span className="glossary-search-icon" aria-hidden="true">🔍</span>
              <input
                type="search"
                className="glossary-search-input"
                placeholder="Buscar término o lema (ej. inmarcesible, diáfano)..."
                value={query}
                onInput={(e) => {
                  setQuery((e.target as HTMLInputElement).value);
                  setPage(1);
                }}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                aria-label="Buscar palabra en el glosario"
              />
              {query ? (
                <button
                  type="button"
                  className="btn--quiet glossary-search-clear"
                  onClick={() => {
                    setQuery("");
                    setPage(1);
                  }}
                  aria-label="Limpiar búsqueda"
                >
                  ✕
                </button>
              ) : null}
            </div>

            {/* Pestañas principales de categoría */}
            <div className="glossary-tabs-bar">
              <div
                className="glossary-tabs"
                role="tablist"
                aria-label="Filtrar vocabulario por categoría"
              >
                <button
                  type="button"
                  role="tab"
                  className="glossary-tab"
                  aria-selected={filter === "cultisms"}
                  data-active={filter === "cultisms" || undefined}
                  onClick={() => {
                    triggerHaptic("selection");
                    setFilter("cultisms");
                    setPage(1);
                  }}
                >
                  ✦ Cultismos ({cultismsCount.toLocaleString("es")})
                </button>
                <button
                  type="button"
                  role="tab"
                  className="glossary-tab"
                  aria-selected={filter === "all"}
                  data-active={filter === "all" || undefined}
                  onClick={() => {
                    triggerHaptic("selection");
                    setFilter("all");
                    setPage(1);
                  }}
                >
                  Todo el léxico ({terms.length.toLocaleString("es")})
                </button>
                <button
                  type="button"
                  role="tab"
                  className="glossary-tab"
                  aria-selected={filter === "saved"}
                  data-active={filter === "saved" || undefined}
                  onClick={() => {
                    triggerHaptic("selection");
                    setFilter("saved");
                    setPage(1);
                  }}
                >
                  En Cuaderno ({savedCount.toLocaleString("es")})
                </button>
                <button
                  type="button"
                  role="tab"
                  className="glossary-tab"
                  aria-selected={filter === "learning"}
                  data-active={filter === "learning" || undefined}
                  onClick={() => {
                    triggerHaptic("selection");
                    setFilter("learning");
                    setPage(1);
                  }}
                >
                  Por aprender ({learningCount.toLocaleString("es")})
                </button>
              </div>
            </div>

            {/* Barra de navegación alfabética A–Z */}
            <div className="glossary-az-bar" aria-label="Navegación alfabética">
              <button
                type="button"
                className="glossary-az-btn glossary-az-btn--all"
                data-active={letterFilter === null || undefined}
                onClick={() => {
                  triggerHaptic("selection");
                  setLetterFilter(null);
                  setPage(1);
                }}
              >
                Todas
              </button>
              {SPANISH_ALPHABET.map((letra) => {
                const hasTerms = availableLetters.has(letra);
                const isSelected = letterFilter === letra;
                return (
                  <button
                    key={letra}
                    type="button"
                    className="glossary-az-btn"
                    disabled={!hasTerms}
                    data-active={isSelected || undefined}
                    onClick={() => {
                      triggerHaptic("selection");
                      setLetterFilter(isSelected ? null : letra);
                      setPage(1);
                    }}
                    title={
                      hasTerms
                        ? `Filtrar por letra ${letra}`
                        : `Sin términos con la letra ${letra}`
                    }
                  >
                    {letra}
                  </button>
                );
              })}
            </div>

            {/* Barra de herramientas secundarias: orden, categoría gramatical y tamaño de página */}
            <div className="glossary-toolbar-secondary">
              <div className="glossary-filters-group">
                <label className="glossary-control-label">
                  <span className="meta">Orden:</span>
                  <select
                    className="glossary-select"
                    value={sort}
                    onChange={(e) => {
                      triggerHaptic("selection");
                      setSort(e.target.value as GlossarySort);
                      setPage(1);
                    }}
                    aria-label="Criterio de ordenación"
                  >
                    <option value="rarity">⚡ Mayor rareza (Zipf)</option>
                    <option value="alpha">🔤 Alfabético (A–Z)</option>
                    <option value="alpha-desc">🔤 Inverso (Z–A)</option>
                    <option value="frequency">📊 Más frecuentes</option>
                  </select>
                </label>

                <label className="glossary-control-label">
                  <span className="meta">Categoría:</span>
                  <select
                    className="glossary-select"
                    value={posFilter}
                    onChange={(e) => {
                      triggerHaptic("selection");
                      setPosFilter(e.target.value);
                      setPage(1);
                    }}
                    aria-label="Filtrar por categoría gramatical"
                  >
                    <option value="all">Todas</option>
                    <option value="sustantivo">Sustantivos</option>
                    <option value="adjetivo">Adjetivos</option>
                    <option value="verbo">Verbos</option>
                    <option value="adverbio">Adverbios</option>
                    <option value="propio">Personajes / Propios</option>
                  </select>
                </label>

                <label className="glossary-control-label">
                  <span className="meta">Mostrar:</span>
                  <select
                    className="glossary-select"
                    value={pageSize}
                    onChange={(e) => {
                      triggerHaptic("selection");
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    aria-label="Términos por página"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size} / pág.
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="glossary-results-info meta">
                {totalResults === 0
                  ? "Sin resultados"
                  : `${totalResults.toLocaleString("es")} término${
                      totalResults === 1 ? "" : "s"
                    }${letterFilter ? ` con «${letterFilter}»` : ""}`}
              </div>
            </div>

            {/* Contenedor scrolleable de términos */}
            <div
              ref={listContainerRef}
              className="glossary-list-container"
              tabIndex={0}
              aria-label="Lista de términos del glosario"
            >
              {totalResults === 0 ? (
                <div className="glossary-empty">
                  <p className="glossary-empty-title">
                    No se encontraron términos con estos filtros.
                  </p>
                  <p className="meta">
                    Prueba a limpiar la búsqueda o seleccionar otra letra o categoría.
                  </p>
                  {(query || letterFilter || posFilter !== "all" || filter !== "cultisms") && (
                    <button
                      type="button"
                      className="btn--quiet glossary-reset-btn"
                      onClick={() => {
                        setQuery("");
                        setLetterFilter(null);
                        setPosFilter("all");
                        setFilter("cultisms");
                        setPage(1);
                      }}
                    >
                      Restablecer filtros
                    </button>
                  )}
                </div>
              ) : (
                <div className="glossary-list" role="list">
                  {displayedTerms.map((term) => {
                    const isExpanded = expandedTerm === term.form;
                    const def = definitions[term.form];

                    return (
                      <article
                        key={term.form}
                        className="glossary-card"
                        data-expanded={isExpanded || undefined}
                        data-cultism={term.isCultism || undefined}
                        role="listitem"
                      >
                        <button
                          type="button"
                          className="glossary-card-summary"
                          onClick={() => toggleExpand(term)}
                          aria-expanded={isExpanded}
                        >
                          <div className="glossary-card-left">
                            <strong className="glossary-term-form">
                              {term.form}
                            </strong>
                            {term.lemma && term.lemma !== term.form ? (
                              <span className="glossary-term-lemma meta">
                                ← {term.lemma}
                              </span>
                            ) : null}
                          </div>

                          <div className="glossary-card-badges">
                            {term.pos ? (
                              <span className="card-pos glossary-pos-pill">
                                {term.pos}
                              </span>
                            ) : null}
                            <span
                              className={`glossary-zipf-pill ${
                                term.isCultism ? "glossary-zipf-pill--rare" : ""
                              }`}
                              title={
                                term.zipf != null
                                  ? `Frecuencia Zipf: ${term.zipf.toFixed(1)}`
                                  : "Sin frecuencia en el catálogo general"
                              }
                            >
                              {term.isCultism ? "✦ " : ""}
                              {formatZipfLabel(term.zipf)}
                            </span>
                            {term.isSaved ? (
                              <span className="glossary-status-pill glossary-status-pill--saved">
                                ✓ En cuaderno
                              </span>
                            ) : term.isKnown ? (
                              <span className="glossary-status-pill glossary-status-pill--known">
                                Dominada
                              </span>
                            ) : null}
                            <span className="glossary-card-chevron" aria-hidden="true">
                              {isExpanded ? "▲" : "▼"}
                            </span>
                          </div>
                        </button>

                        {isExpanded ? (
                          <div className="glossary-card-body">
                            {def?.loading ? (
                              <div className="glossary-def-loading">
                                <span className="glossary-spinner glossary-spinner--sm" aria-hidden="true" />
                                <span className="meta">Consultando significado en el catálogo...</span>
                              </div>
                            ) : def?.entries && def.entries.length > 0 ? (
                              <div className="glossary-definitions">
                                {def.entries.map((entry, eIdx) => (
                                  <div key={eIdx} className="glossary-entry-defs">
                                    {entry.senses.map((sense, sIdx) => (
                                      <div
                                        key={sIdx}
                                        className="glossary-sense-item"
                                      >
                                        <p className="glossary-def-text">
                                          <strong className="glossary-sense-num">
                                            {sIdx + 1}.{" "}
                                          </strong>
                                          {sense.definition}
                                        </p>
                                        {sense.example ? (
                                          <p className="glossary-example-text meta">
                                            «{sense.example}»
                                          </p>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            ) : def?.error ? (
                              <p className="meta glossary-error-def">
                                {def.error}
                              </p>
                            ) : null}

                            <div className="glossary-card-actions">
                              {!term.isSaved ? (
                                <button
                                  type="button"
                                  className="btn btn--secondary glossary-save-btn"
                                  onClick={() => void handleQuickSave(term)}
                                  disabled={savingTerm === term.form}
                                >
                                  {savingTerm === term.form
                                    ? "Guardando..."
                                    : "+ Guardar en Cuaderno"}
                                </button>
                              ) : (
                                <span className="meta glossary-saved-notice">
                                  ✓ Guardada en tu Cuaderno
                                </span>
                              )}

                              {onSelectTerm ? (
                                <button
                                  type="button"
                                  className="btn--quiet glossary-study-btn"
                                  onClick={() => handleOpenStudy(term.form)}
                                >
                                  Abrir ficha de estudio →
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Barra de paginación fija al pie */}
            {totalPages > 1 ? (
              <footer className="glossary-pagination-bar" aria-label="Navegación de páginas">
                <div className="glossary-page-info meta">
                  Pág. {safePage} de {totalPages} · Mostrando {(safePage - 1) * pageSize + 1}–
                  {Math.min(safePage * pageSize, totalResults)} de{" "}
                  {totalResults.toLocaleString("es")}
                </div>

                <div className="glossary-page-controls">
                  <button
                    type="button"
                    className="btn--quiet glossary-page-nav-btn"
                    disabled={safePage <= 1}
                    onClick={() => handlePageChange(1)}
                    title="Primera página"
                    aria-label="Primera página"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    className="btn--quiet glossary-page-nav-btn"
                    disabled={safePage <= 1}
                    onClick={() => handlePageChange(safePage - 1)}
                    title="Página anterior"
                    aria-label="Página anterior"
                  >
                    ‹
                  </button>

                  <div className="glossary-page-numbers">
                    {pageWindow.map((item, idx) =>
                      item === "..." ? (
                        <span key={`dots-${idx}`} className="glossary-page-dots meta">
                          …
                        </span>
                      ) : (
                        <button
                          key={item}
                          type="button"
                          className="glossary-page-num"
                          data-active={item === safePage || undefined}
                          onClick={() => handlePageChange(item)}
                          aria-label={`Ir a la página ${item}`}
                          aria-current={item === safePage ? "page" : undefined}
                        >
                          {item}
                        </button>
                      ),
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn--quiet glossary-page-nav-btn"
                    disabled={safePage >= totalPages}
                    onClick={() => handlePageChange(safePage + 1)}
                    title="Página siguiente"
                    aria-label="Página siguiente"
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    className="btn--quiet glossary-page-nav-btn"
                    disabled={safePage >= totalPages}
                    onClick={() => handlePageChange(totalPages)}
                    title="Última página"
                    aria-label="Última página"
                  >
                    »
                  </button>
                </div>
              </footer>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
