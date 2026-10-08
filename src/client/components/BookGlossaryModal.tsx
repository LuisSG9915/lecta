import { useEffect, useMemo, useState } from "react";
import Dialog from "./Dialog";
import {
  extractGlossaryTerms,
  filterAndSortGlossary,
  formatZipfLabel,
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

const PAGE_SIZE = 50;

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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const [definitions, setDefinitions] = useState<Record<string, DefinitionState>>({});
  const [savingTerm, setSavingTerm] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

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

  // Filtrado y ordenación
  const filtered = useMemo(
    () => filterAndSortGlossary(terms, query, filter, sort),
    [terms, query, filter, sort],
  );

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
              error: "Sin definición registrada en el catálogo.",
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
      const entry = defData?.entries?.[0];
      const sense = entry?.senses?.[0];

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

  const displayedTerms = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  return (
    <Dialog label="Glosario de la obra" onClose={onClose}>
      <div className="glossary-modal">
        <header className="sheet-head glossary-head">
          <div className="glossary-head-titles">
            <strong className="sheet-title">Glosario de la obra</strong>
            {bookTitle ? (
              <span className="glossary-book-subtitle meta">{bookTitle}</span>
            ) : null}
          </div>
          <button
            type="button"
            className="btn--quiet"
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
              Identificando cultismos literarios, rarezas léxicas y términos singulares.
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
            {/* Buscador */}
            <div className="glossary-search-wrap">
              <input
                type="search"
                className="glossary-search-input"
                placeholder="Buscar término o lema..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                aria-label="Buscar palabra en el glosario"
              />
              {query ? (
                <button
                  type="button"
                  className="btn--quiet glossary-search-clear"
                  onClick={() => {
                    setQuery("");
                    setVisibleCount(PAGE_SIZE);
                  }}
                  aria-label="Limpiar búsqueda"
                >
                  ✕
                </button>
              ) : null}
            </div>

            {/* Filtros y orden */}
            <div className="glossary-toolbar">
              <div
                className="glossary-tabs"
                role="tablist"
                aria-label="Filtrar vocabulario"
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
                    setVisibleCount(PAGE_SIZE);
                  }}
                >
                  Cultismos ({cultismsCount})
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
                    setVisibleCount(PAGE_SIZE);
                  }}
                >
                  Todos ({terms.length})
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
                    setVisibleCount(PAGE_SIZE);
                  }}
                >
                  Guardados ({savedCount})
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
                    setVisibleCount(PAGE_SIZE);
                  }}
                >
                  Por aprender ({learningCount})
                </button>
              </div>

              <button
                type="button"
                className="btn--quiet glossary-sort-btn"
                onClick={() => {
                  triggerHaptic("selection");
                  setSort((s) => (s === "rarity" ? "alpha" : "rarity"));
                  setVisibleCount(PAGE_SIZE);
                }}
                title={
                  sort === "rarity"
                    ? "Ordenar alfabéticamente (A–Z)"
                    : "Ordenar por rareza (Zipf menor primero)"
                }
              >
                {sort === "rarity" ? "⚡ Mayor rareza" : "🔤 A–Z"}
              </button>
            </div>

            {/* Resumen estadístico */}
            <div className="glossary-meta-bar meta">
              <span>
                {filtered.length} término{filtered.length === 1 ? "" : "s"}{" "}
                {filter === "cultisms" ? "literarios " : ""}
                encontrado{filtered.length === 1 ? "" : "s"}
              </span>
              {totalForms > 0 ? (
                <span>
                  {" "}· {totalForms.toLocaleString("es")} formas totales (
                  {totalWordCount.toLocaleString("es")} palabras)
                </span>
              ) : null}
            </div>

            {/* Lista de términos */}
            {filtered.length === 0 ? (
              <div className="glossary-empty">
                <p>No se encontraron términos con este filtro o búsqueda.</p>
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
                            {formatZipfLabel(term.zipf)}
                          </span>
                          {term.isSaved ? (
                            <span className="glossary-status-pill glossary-status-pill--saved">
                              En cuaderno
                            </span>
                          ) : term.isKnown ? (
                            <span className="glossary-status-pill glossary-status-pill--known">
                              Dominada
                            </span>
                          ) : null}
                        </div>
                      </button>

                      {isExpanded ? (
                        <div className="glossary-card-body">
                          {def?.loading ? (
                            <p className="meta glossary-loading-def">
                              Consultando significado...
                            </p>
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
                                        <strong className="meta">
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
                                className="btn--secondary glossary-save-btn"
                                onClick={() => void handleQuickSave(term)}
                                disabled={savingTerm === term.form}
                              >
                                {savingTerm === term.form
                                  ? "Guardando..."
                                  : "+ Guardar en Cuaderno"}
                              </button>
                            ) : null}

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

                {hasMore ? (
                  <button
                    type="button"
                    className="btn--quiet glossary-more-btn"
                    onClick={() => {
                      triggerHaptic("selection");
                      setVisibleCount((prev) => prev + PAGE_SIZE);
                    }}
                  >
                    Mostrar {Math.min(PAGE_SIZE, filtered.length - visibleCount)}{" "}
                    términos más ({filtered.length - visibleCount} restantes)
                  </button>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
