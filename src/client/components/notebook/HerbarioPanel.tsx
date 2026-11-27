// Pestaña «Mi Herbario de Palabras» (Fase 5, V2): chequeo de 30 días, filtros,
// orden, exportar y la lista de palabras (plana o agrupada por libro).
import {
  type RetentionHorizon,
} from "../../lib/fsrs";
import {
  type SavedWord,
  type StoredBook,
} from "../../lib/idb";
import {
  FILTERS,
  ORDERS,
  GROUP_PAGE,
  stateOf,
} from "../../lib/notebook-model";


import {
  downloadBookMarkdown,
} from "../../lib/export";
import { triggerHaptic } from "../../lib/haptics";
import { languageName } from "../../lib/epub";
import { speakWord } from "../../lib/speech";
import Icon from "../Icon";
import { WordRow } from "./WordRow";
import type { QuoteCardRequest } from "./QuotesPanel";

import type { UseHerbarioViewResult } from "../../hooks/useHerbarioView";

type HerbarioPanelProps = {
  view: UseHerbarioViewResult;
  /** Todas las palabras (conteos por idioma). */
  all: SavedWord[];
  /** true cuando ya cargó y no hay ninguna palabra guardada. */
  wordsEmpty: boolean;
  books: Pick<
    StoredBook,
    "hash" | "name" | "title" | "author" | "language" | "mediaKind"
  >[];
  /** Palabras ya consolidadas candidatas al chequeo de 30 días. */
  retentionCheckCandidates: SavedWord[];
  retentionHorizon: RetentionHorizon;
  changeRetentionHorizon: (next: RetentionHorizon) => void;
  startRetentionCheck30d: () => void;
  /** Palabras que pueden entrar a «Partida rápida». */
  reviewKeys: ReadonlySet<string>;
  handleQuickGame: (word: SavedWord) => void;
  startLearn: (first?: SavedWord) => void;
  remove: (word: SavedWord) => Promise<void>;
  setGlossaryBookHash: (hash: string | null) => void;
  onQuoteCard?: (request: QuoteCardRequest) => void;
  bookAuthor?: (hash: string | undefined) => string | undefined;
  exportCsv: () => void;
  exportAnkiCloze: () => void;
  exportMarkdownNotebook: () => void;
};

export function HerbarioPanel({
  view,
  all,
  wordsEmpty,
  books,
  retentionCheckCandidates,
  retentionHorizon,
  changeRetentionHorizon,
  startRetentionCheck30d,
  reviewKeys,
  handleQuickGame,
  startLearn,
  remove,
  setGlossaryBookHash,
  onQuoteCard,
  bookAuthor,
  exportCsv,
  exportAnkiCloze,
  exportMarkdownNotebook,
}: HerbarioPanelProps) {
  const {
    activeExtraFiltersCount,
    availableBooks,
    availableLanguages,
    bookFilter,
    bookTitle,
    collapsed,
    countForFilter,
    expanded,
    filter,
    filtered,
    flatWords,
    groupEntries,
    hasScreenWorks,
    languageFilter,
    lifecycle,
    openWords,
    order,
    originFilter,
    query,
    setBookFilter,
    setCollapsed,
    setExpanded,
    setFilter,
    setLanguageFilter,
    setListLimit,
    setOrder,
    setOriginFilter,
    setQuery,
    shownWords,
    toggle,
    toggleWordOpen,
    wordBookTitle,
  } = view;

  return (
    <section aria-label="Palabras guardadas">
      {retentionCheckCandidates.length > 0 ? (
        <section
          className="nb-review nb-retention-check"
          aria-label="Chequeo de retención a 30 días"
        >
          <p className="eyebrow">
            Memoria a largo plazo · {retentionCheckCandidates.length}
          </p>
          <p className="meta">
            Comprueba en un minuto las palabras que ya llevas semanas
            consolidando.
          </p>
          <div className="practice-modes" role="group" aria-label="Chequeo de memoria">
            <button
              type="button"
              className="btn"
              onClick={() => startRetentionCheck30d()}
            >
              Chequeo 30 días
            </button>
          </div>
        </section>
      ) : null}

      {languageFilter !== "all" || bookFilter !== "all" ? (
        <div className="nb-scope-notice">
          <span>
            {bookFilter !== "all"
              ? `Solo palabras de «${bookTitle(bookFilter)}»`
              : `Solo palabras en ${languageName(languageFilter)}`}
          </span>
          <button
            type="button"
            className="btn--quiet"
            onClick={() => {
              setLanguageFilter("all");
              setBookFilter("all");
              setListLimit(GROUP_PAGE);
            }}
          >
            Ver todas
          </button>
        </div>
      ) : null}
      {wordsEmpty ? (
        <p className="nb-empty">
          Aún no has apuntado palabras.
          <br />
          Toca cualquier palabra mientras lees y aparecerá aquí, con su oración.
        </p>
      ) : (
        <>
          <div className="nb-tools">
            <label className="nb-search">
              <span className="visually-hidden">Buscar en el cuaderno</span>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setListLimit(GROUP_PAGE);
                }}
                placeholder="Buscar palabra, significado u oración…"
                autoComplete="off"
              />
            </label>

            <div className="nb-tools-row">
              <div className="nb-filters" role="group" aria-label="Filtrar palabras">
                {FILTERS.map(({ id, label }) => {
                  const count = countForFilter(id);
                  if (id === "due" && count === 0 && filter !== "due") return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="theme-option"
                      data-active={filter === id || undefined}
                      aria-pressed={filter === id}
                      onClick={() => {
                        setFilter(id);
                        setListLimit(GROUP_PAGE);
                      }}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>

              <details className="nb-more-filters">
                <summary className="meta">
                  <Icon name="sliders" size={14} />
                  Más filtros
                  {activeExtraFiltersCount > 0
                    ? ` · ${activeExtraFiltersCount} activo${activeExtraFiltersCount === 1 ? "" : "s"}`
                    : ""}
                </summary>
                <div className="nb-more-filters-content">
                  <div className="nb-filters" role="group" aria-label="Ritmo de repaso">
                    <span className="meta">Ritmo de repaso</span>
                    {(
                      [
                        { id: "relaxed", label: "Fluido 85%", hint: "Repasa menos seguido: aceptas olvidar un poco más" },
                        { id: "standard", label: "Equilibrado 90%", hint: "Equilibrio entre esfuerzo y memoria" },
                        { id: "intensive", label: "Firme 93%", hint: "Repasa más seguido para olvidar menos" },
                      ] as const
                    ).map(({ id, label, hint }) => (
                      <button
                        key={id}
                        type="button"
                        className="theme-option"
                        title={hint}
                        data-active={retentionHorizon === id || undefined}
                        aria-pressed={retentionHorizon === id}
                        onClick={() => changeRetentionHorizon(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                {availableLanguages.length > 1 ? (
                  <div
                    className="nb-filters nb-filters--lang"
                    role="group"
                    aria-label="Filtrar por idioma"
                  >
                    <button
                      type="button"
                      className="theme-option"
                      data-active={languageFilter === "all" || undefined}
                      aria-pressed={languageFilter === "all"}
                      onClick={() => {
                        setLanguageFilter("all");
                        setBookFilter("all");
                        setListLimit(GROUP_PAGE);
                      }}
                    >
                      Todos ({all.length})
                    </button>
                    {availableLanguages.map((lang) => {
                      const count = all.filter((w) => (w.language || "es") === lang).length;
                      return (
                        <button
                          key={lang}
                          type="button"
                          className="theme-option"
                          data-active={languageFilter === lang || undefined}
                          aria-pressed={languageFilter === lang}
                          onClick={() => {
                            setLanguageFilter(lang);
                            setBookFilter("all");
                            setListLimit(GROUP_PAGE);
                          }}
                        >
                          {languageName(lang)} ({count})
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {books.length > 0 ? (
                  <div className="nb-book-filter">
                    <label htmlFor="nb-book-select" className="visually-hidden">
                      Filtrar por libro
                    </label>
                    <select
                      id="nb-book-select"
                      className="nb-select"
                      value={bookFilter}
                      onChange={(event) => {
                        setBookFilter(event.target.value);
                        setListLimit(GROUP_PAGE);
                      }}
                    >
                      <option value="all">
                        {languageFilter === "all"
                          ? "Todos los libros"
                          : `Todos los libros en ${languageName(languageFilter)}`}
                      </option>
                      {availableBooks.map((b) => (
                        <option key={b.hash} value={b.hash}>
                          {b.title ?? b.name} {b.language ? `(${b.language.toUpperCase()})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {hasScreenWorks ? (
                  <div
                    className="nb-filters"
                    role="group"
                    aria-label="Origen de las palabras"
                  >
                    {(
                      [
                        ["all", "Todos"],
                        ["books", "Libros"],
                        ["series", "Series"],
                        ["movies", "Películas"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className="theme-option"
                        data-active={originFilter === id || undefined}
                        aria-pressed={originFilter === id}
                        onClick={() => {
                          setOriginFilter(id);
                          setListLimit(GROUP_PAGE);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="nb-filters" role="group" aria-label="Ordenar palabras">
                  {ORDERS.map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      className="theme-option"
                      data-active={order === id || undefined}
                      aria-pressed={order === id}
                      onClick={() => {
                        setOrder(id);
                        setListLimit(GROUP_PAGE);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </details>

              <details className="nb-export">
                <summary className="meta">
                  <Icon name="download" size={14} />
                  Exportar
                </summary>
                <div className="nb-export-menu">
                  <button type="button" className="btn--quiet" onClick={exportCsv}>
                    CSV
                  </button>
                  <button
                    type="button"
                    className="btn--quiet"
                    onClick={exportAnkiCloze}
                    title="Exportar para Anki con supresión de partes (Cloze) en la oración del libro"
                  >
                    Para Anki
                  </button>
                  <button
                    type="button"
                    className="btn--quiet"
                    onClick={exportMarkdownNotebook}
                    title="Exportar cuaderno completo en Markdown para Obsidian, Notion o PKM"
                  >
                    Cuaderno (.md)
                  </button>
                </div>
              </details>
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="meta">
              {query ? `Nada coincide con «${query}».` : "Nada en este filtro por ahora."}
            </p>
          ) : order === "libro" ? (
            groupEntries.map(([hash, group]) => {
              const isCollapsed = collapsed.has(hash);
              const shown = expanded.has(hash) ? group : group.slice(0, GROUP_PAGE);
              return (
                <section key={hash || "sin-libro"} className="nb-group">
                  <h2 className="nb-group-title">
                    <button
                      type="button"
                      className="nb-group-toggle"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggle(collapsed, hash, setCollapsed)}
                    >
                      <span className="nb-group-chevron" aria-hidden="true">
                        <Icon name="chevron-right" size={14} />
                      </span>
                      {bookTitle(hash || undefined)}
                    </button>
                    <span className="meta"> · {group.length}</span>
                    {hash ? (
                      <>
                        <button
                          type="button"
                          className="btn--quiet nb-group-export"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerHaptic("selection");
                            setGlossaryBookHash(hash);
                          }}
                          title={`Explorar glosario de ${bookTitle(hash)}`}
                          aria-label={`Explorar glosario de ${bookTitle(hash)}`}
                        >
                          Glosario
                        </button>
                        <button
                          type="button"
                          className="btn--quiet nb-group-export"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerHaptic("selection");
                            void downloadBookMarkdown(hash, bookTitle(hash));
                          }}
                          title={`Exportar ficha en Markdown de ${bookTitle(hash)}`}
                          aria-label={`Exportar ficha en Markdown de ${bookTitle(hash)}`}
                        >
                          Ficha (.md)
                        </button>
                      </>
                    ) : null}
                  </h2>
                  {isCollapsed ? null : (
                    <ul className="nb-words">
                      {shown.map((word) => (
                        <WordRow
                          key={word.key}
                          word={word}
                          state={stateOf(word, lifecycle(word))}
                          isOpen={openWords.has(word.key)}
                          onToggle={() => toggleWordOpen(word.key)}
                          canLearn={lifecycle(word).pending}
                          onLearn={() => startLearn(word)}
                          onRemove={() => void remove(word)}
                          onSpeak={() => void speakWord(word.form, word.language)}
                          bookTitle={wordBookTitle(word) ?? bookTitle(word.bookHash)}
                          onQuickGame={
                            reviewKeys.has(word.key)
                              ? () => handleQuickGame(word)
                              : undefined
                          }
                          onShareCard={
                            onQuoteCard && word.context
                              ? () => {
                                  triggerHaptic("selection");
                                  onQuoteCard({
                                    text: word.context!,
                                    highlightWord: word.form || word.lemma,
                                    gloss: word.meaning || undefined,
                                    bookTitle: wordBookTitle(word) ?? bookTitle(word.bookHash),
                                    author: bookAuthor?.(word.bookHash),
                                  });
                                }
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  )}
                  {!isCollapsed && group.length > shown.length ? (
                    <button
                      type="button"
                      className="btn--quiet nb-more"
                      onClick={() => toggle(expanded, hash, setExpanded)}
                    >
                      Mostrar {group.length - shown.length} más
                    </button>
                  ) : null}
                </section>
              );
            })
          ) : (
            <>
              <ul className="nb-words">
                {shownWords.map((word) => (
                  <WordRow
                    key={word.key}
                    word={word}
                    state={stateOf(word, lifecycle(word))}
                    isOpen={openWords.has(word.key)}
                    onToggle={() => toggleWordOpen(word.key)}
                    canLearn={lifecycle(word).pending}
                    onLearn={() => startLearn(word)}
                    onRemove={() => void remove(word)}
                    onSpeak={() => void speakWord(word.form, word.language)}
                    bookTitle={wordBookTitle(word) ?? bookTitle(word.bookHash)}
                    onQuickGame={
                      reviewKeys.has(word.key)
                        ? () => handleQuickGame(word)
                        : undefined
                    }
                    onShareCard={
                      onQuoteCard && word.context
                        ? () => {
                            triggerHaptic("selection");
                            onQuoteCard({
                              text: word.context!,
                              highlightWord: word.form || word.lemma,
                              gloss: word.meaning || undefined,
                              bookTitle: wordBookTitle(word) ?? bookTitle(word.bookHash),
                              author: bookAuthor?.(word.bookHash),
                            });
                          }
                        : undefined
                    }
                  />
                ))}
              </ul>
              {flatWords.length > shownWords.length ? (
                <button
                  type="button"
                  className="btn--quiet nb-more"
                  onClick={() => setListLimit((curr) => curr + GROUP_PAGE)}
                >
                  Mostrar {Math.min(GROUP_PAGE, flatWords.length - shownWords.length)} más
                </button>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
