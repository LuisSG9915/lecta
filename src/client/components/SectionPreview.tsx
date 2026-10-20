import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import { triggerHaptic } from "../lib/haptics";
import type { PreparationAnswer, PreparationAnswers } from "../lib/preparation";
import {
  cleanContextSentence,
  normalizePosCategory,
  type ScoredPrimingWord,
  type SuggestionRow,
} from "../lib/section-words";
import { betaFromZipf } from "../lib/profile-models";
import { speakWord } from "../lib/speech";
import { useCompanionSafe } from "./CompanionProvider";
import { Companion } from "./Companion";
import { ProgressInk } from "./ProgressInk";
import type { ReadingStrategyPreset } from "../lib/settings";

// Una fila de la preparación: la SuggestionRow que construye el
// controlador, con razón y medición opcionales en la vista (las usa
// el trayecto para anotar por qué se presentó cada palabra).
export type SectionPreviewRow = Omit<SuggestionRow, "reason" | "zipf"> & {
  reason?: SuggestionRow["reason"];
  zipf?: SuggestionRow["zipf"];
};

export type SectionPreviewAnalysis = "loading" | "ready" | "error";

export type SectionPreviewProps = {
  // Destino que se prepara («Capítulo 1», «Introducción»…).
  title?: string;
  chapterTitle?: string;
  bookId?: string;
  bookLang?: string;
  userNativeLang?: string;
  analysis?: SectionPreviewAnalysis;
  // Filas en el orden visual fijo: no se reordenan ni desaparecen
  // al responderlas; si llega una definición tardía se actualiza en
  // su lugar (misma `key`).
  rows?: SectionPreviewRow[];
  // Respuestas controladas por el controlador (borrador incluido).
  answers?: PreparationAnswers;
  // Consulta secundaria: formas que el catálogo no sabe medir. Se
  // muestran colapsadas para no saturar la selección principal.
  uncertainRows?: SectionPreviewRow[];
  // Candidatas que no cupieron en la selección principal: consulta
  // aparte, colapsada y paginada — no son «sin información» ni se
  // declaran conocidas por el recorte.
  deferredRows?: SectionPreviewRow[];
  // El controlador anota qué filas quedaron realmente visibles
  // (trayecto): se dispara al abrir y cada vez que crece lo visible.
  onRowsPresented?: (rows: SectionPreviewRow[]) => void;
  saving?: boolean;
  // La definición/contexto se consulta desplegada en la misma
  // preparación; nunca se abre la ficha encima.
  onAnswer?: (key: string, answer: PreparationAnswer) => void;
  // «Guardar y leer»: confirma las respuestas explícitas.
  onConfirm?: () => void;
  // «Leer sin preparar»: salida siempre alcanzable, sin evidencia.
  onSkip?: () => void;
  // Reintenta el análisis tras un error.
  onRetry?: () => void;
  // Cerrar conserva el borrador (lo persiste el controlador).
  onClose?: () => void;
  // Descarte explícito del borrador; el componente lo confirma en la
  // misma hoja, sin apilar otro diálogo.
  onDiscard?: () => void;
  // Tiempo estimado de lectura del capítulo (minutos)
  estimatedMinutes?: number;
  // Estrategia preseleccionada sugerida para el capítulo
  initialStrategy?: ReadingStrategyPreset;
  // Cambio de estrategia desde el pórtico
  onSelectStrategy?: (preset: ReadingStrategyPreset) => void;
  // Notificación al desbloquear una joya léxica
  onUnlockCard?: (row: SectionPreviewRow) => void;
  mode?: "pill" | "modal" | "priming";
  words?: ScoredPrimingWord[] | SectionPreviewRow[] | { length: number };
  onExpand?: () => void;
  // Callbacks de pre-lectura adaptativa (Track 6 / Zero-Friction)
  onMarkKnown?: (lemma: string, beta: number) => void;
  onSaveToPractice?: (lemma: string, beta: number) => void;
  onPronounce?: (word: string, lang: string) => void;
  onStartReading?: () => void;
  onMuteForBook?: (bookId: string) => void;
  onDisableGlobally?: () => void;
};

const PAGE_SIZE = 8;

const groupOf = (row: SectionPreviewRow) =>
  row.meaning == null ? "noDef" : row.learning ? "learning" : "new";

const GROUPS: { id: ReturnType<typeof groupOf>; label: string }[] = [
  { id: "new", label: "Palabras nuevas" },
  { id: "learning", label: "Que estás aprendiendo" },
  { id: "noDef", label: "Sin definición todavía" },
];

function Row({
  row,
  answer,
  expanded,
  saving,
  onAnswer,
  onToggleExpand,
}: {
  row: SectionPreviewRow;
  answer: PreparationAnswer | undefined;
  expanded: boolean;
  saving: boolean;
  onAnswer: (key: string, answer: PreparationAnswer) => void;
  onToggleExpand: (key: string) => void;
}) {
  return (
    <li className="section-preview-item">
      <button
        type="button"
        className="section-preview-open"
        aria-expanded={expanded}
        onClick={() => onToggleExpand(row.key)}
      >
        <strong>{row.form}</strong>
        {row.lemma && row.lemma !== row.form.toLowerCase() ? (
          <span className="section-preview-def"> · forma de «{row.lemma}»</span>
        ) : row.pos ? (
          <span className="section-preview-def"> · {row.pos}</span>
        ) : null}
      </button>
      <span
        className="cal-choices"
        role="group"
        aria-label={`Respuesta para ${row.form}`}
      >
        <button
          type="button"
          className={`cal-choice${answer === "known" ? " is-selected" : ""}`}
          aria-pressed={answer === "known"}
          disabled={saving}
          onClick={() => {
            triggerHaptic(10);
            onAnswer(row.key, "known");
          }}
        >
          La conozco
        </button>
        <button
          type="button"
          className={`cal-choice${answer === "unknown" ? " is-selected" : ""}`}
          aria-pressed={answer === "unknown"}
          disabled={saving}
          onClick={() => {
            triggerHaptic(10);
            onAnswer(row.key, "unknown");
          }}
        >
          No la conozco
        </button>
      </span>
      {expanded ? (
        <p className="section-preview-def">
          {row.meaning ?? "Sin definición todavía"}
          {row.context ? ` — “${row.context}”` : ""}
        </p>
      ) : null}
    </li>
  );
}

function PrimingCardView({
  bookId,
  chapterTitle,
  bookLang,
  userNativeLang,
  words,
  onMarkKnown,
  onSaveToPractice,
  onPronounce,
  onStartReading,
  onMuteForBook,
  onDisableGlobally,
}: {
  bookId: string;
  chapterTitle: string;
  bookLang: string;
  userNativeLang: string;
  words: ScoredPrimingWord[];
  onMarkKnown: (lemma: string, beta: number) => void;
  onSaveToPractice: (lemma: string, beta: number) => void;
  onPronounce?: (word: string, lang: string) => void;
  onStartReading: () => void;
  onMuteForBook: (bookId: string) => void;
  onDisableGlobally: () => void;
}) {
  const [dismissedLemmas, setDismissedLemmas] = useState<Set<string>>(new Set());
  const [savedLemmas, setSavedLemmas] = useState<Set<string>>(new Set());
  const [showDisableMenu, setShowDisableMenu] = useState(false);

  const isForeignLang =
    bookLang.slice(0, 2).toLowerCase() !== userNativeLang.slice(0, 2).toLowerCase();

  const visibleWords = words.filter((w) => !dismissedLemmas.has(w.lemma));

  // Si el usuario ya conoce todas las palabras sugeridas o no hay candidatas, pasa directo
  if (visibleWords.length === 0) {
    return null;
  }

  const handleKnown = (word: ScoredPrimingWord) => {
    triggerHaptic(10);
    setDismissedLemmas((prev) => new Set(prev).add(word.lemma));
    onMarkKnown(word.lemma, word.beta);
  };

  const handleSave = (word: ScoredPrimingWord) => {
    triggerHaptic(12);
    setSavedLemmas((prev) => new Set(prev).add(word.lemma));
    onSaveToPractice(word.lemma, word.beta);
  };

  const handlePronounce = (form: string) => {
    triggerHaptic(8);
    if (onPronounce) {
      onPronounce(form, bookLang);
    } else {
      void speakWord(form, bookLang);
    }
  };

  const estimatedSeconds = Math.max(10, visibleWords.length * 5);

  return (
    <section
      className="lecta-chapter-priming"
      aria-label="Preparación de vocabulario del capítulo"
    >
      <header className="lecta-chapter-priming__header">
        <div className="lecta-chapter-priming__meta">
          <span className="lecta-chapter-priming__badge">
            ✨ Lectura sin tropiezos · 20 seg
          </span>
          {isForeignLang ? (
            <span className="lecta-chapter-priming__badge">
              Lectura en {bookLang.toUpperCase()}
            </span>
          ) : (
            <span className="lecta-chapter-priming__badge">
              Antes de leer
            </span>
          )}
          <span className="lecta-chapter-priming__time">
            {visibleWords.length} {visibleWords.length === 1 ? "palabra clave" : "palabras clave"} · ~{estimatedSeconds} s
          </span>
        </div>

        <div className="lecta-chapter-priming__controls">
          <button
            type="button"
            className="lecta-chapter-priming__options-btn"
            onClick={() => setShowDisableMenu((v) => !v)}
            aria-expanded={showDisableMenu}
            title="Opciones de visibilidad"
          >
            Opciones ▾
          </button>

          {showDisableMenu && (
            <div className="lecta-chapter-priming__dropdown" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowDisableMenu(false);
                  onMuteForBook(bookId);
                }}
              >
                Ocultar en este libro
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowDisableMenu(false);
                  onDisableGlobally();
                }}
              >
                Desactivar pre-lectura siempre
              </button>
            </div>
          )}
        </div>
      </header>

      {chapterTitle ? (
        <p className="meta" style={{ margin: "0 0 0.25rem 0", fontWeight: 600 }}>
          {chapterTitle}
        </p>
      ) : null}
      <h2 className="lecta-chapter-priming__title">
        Palabras clave antes de entrar al capítulo
      </h2>
      <p className="lecta-chapter-priming__subtitle">
        Dales un vistazo rápido; así cuando aparezcan en la historia las leerás de corrido sin perder la magia.
      </p>

      <ul className="lecta-chapter-priming__list">
        {visibleWords.map((item) => {
          const isSaved = savedLemmas.has(item.lemma);
          return (
            <li key={item.lemma} className="lecta-priming-card">
              <div className="lecta-priming-card__top">
                <div className="lecta-priming-card__word-group">
                  <strong className="lecta-priming-card__lemma">{item.surfaceForm}</strong>
                  {item.partOfSpeech && (
                    <span className="lecta-priming-card__pos">{item.partOfSpeech}</span>
                  )}
                  <button
                    type="button"
                    className="lecta-priming-card__audio"
                    onClick={() => handlePronounce(item.surfaceForm)}
                    aria-label={`Escuchar pronunciación de ${item.surfaceForm}`}
                  >
                    🔊
                  </button>
                </div>

                <div className="lecta-priming-card__actions">
                  <button
                    type="button"
                    className="lecta-priming-card__btn-known"
                    onClick={() => handleKnown(item)}
                    title="El modelo aprenderá que ya dominas esta palabra"
                  >
                    ✓ Ya la conozco
                  </button>
                  <button
                    type="button"
                    className={`lecta-priming-card__btn-save ${isSaved ? "is-saved" : ""}`}
                    onClick={() => handleSave(item)}
                    disabled={isSaved}
                  >
                    {isSaved ? "Guardada" : "+ Repasar"}
                  </button>
                </div>
              </div>

              {item.shortGloss && (
                <p className="lecta-priming-card__gloss">{item.shortGloss}</p>
              )}

              {item.contextSentence && (
                <blockquote className="lecta-priming-card__context">
                  «{item.contextSentence}»
                </blockquote>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="lecta-chapter-priming__footer">
        <button
          type="button"
          className="lecta-chapter-priming__start-btn"
          onClick={onStartReading}
        >
          Entrar al capítulo →
        </button>
      </footer>
    </section>
  );
}

// Preparación «Antes de leer»: hoja controlada que lista el
// vocabulario del destino y pide una respuesta explícita por palabra.
// No escribe ni consulta nada: el controlador decide qué se guarda.
export default function SectionPreview(props: SectionPreviewProps) {
  const {
    bookId = "",
    chapterTitle,
    bookLang = "es",
    userNativeLang = "es",
    onMarkKnown,
    onSaveToPractice,
    onPronounce,
    onStartReading,
    onMuteForBook,
    onDisableGlobally,
    title = "",
    analysis = "ready",
    rows = [],
    answers = {},
    uncertainRows,
    deferredRows,
    onRowsPresented,
    saving = false,
    onAnswer = () => {},
    onConfirm = () => {},
    onSkip = () => {},
    onRetry = () => {},
    onClose = () => {},
    onDiscard = () => {},
    estimatedMinutes,
    initialStrategy,
    onSelectStrategy,
    onUnlockCard,
    mode = "modal",
    words = rows,
    onExpand,
  } = props;

  if (mode === "pill") {
    const count =
      typeof words === "object" && words !== null && "length" in words
        ? words.length
        : rows.length;
    return (
      <button
        type="button"
        className="reader-section-preview-pill"
        onClick={onExpand}
      >
        ✨ {count} {count === 1 ? "palabra clave" : "palabras clave"} en este capítulo · Ver
      </button>
    );
  }

  const isPrimingMode =
    mode === "priming" ||
    (Array.isArray(props.words) &&
      props.words.length > 0 &&
      typeof props.words[0] === "object" &&
      props.words[0] !== null &&
      "beta" in props.words[0]);

  if (isPrimingMode) {
    const primingWords: ScoredPrimingWord[] =
      Array.isArray(words) && words.length > 0 && "beta" in words[0]
        ? (words as ScoredPrimingWord[])
        : rows.map((r) => ({
            lemma: r.lemma ?? r.form.toLowerCase(),
            surfaceForm: r.form,
            lang: bookLang,
            beta: r.zipf != null ? betaFromZipf(r.zipf) : 0.5,
            chapterFrequency: 1,
            partOfSpeech: normalizePosCategory(r.pos),
            shortGloss: r.meaning ?? "",
            contextSentence: cleanContextSentence(r.context, 140),
            utilityScore: 1.0,
            unknownProbability: 0.5,
          }));

    return (
      <PrimingCardView
        bookId={bookId}
        chapterTitle={chapterTitle || title || "Preparación del capítulo"}
        bookLang={bookLang}
        userNativeLang={userNativeLang}
        words={primingWords}
        onMarkKnown={onMarkKnown ?? ((_lemma, _beta) => {})}
        onSaveToPractice={onSaveToPractice ?? ((_lemma, _beta) => {})}
        onPronounce={onPronounce}
        onStartReading={() => {
          onStartReading?.();
          onConfirm();
        }}
        onMuteForBook={onMuteForBook ?? ((_id) => {})}
        onDisableGlobally={onDisableGlobally ?? (() => {})}
      />
    );
  }

  const companion = useCompanionSafe();
  const [showAll, setShowAll] = useState(false);
  const [showUncertain, setShowUncertain] = useState(false);
  const [showDeferred, setShowDeferred] = useState(false);
  const [deferredShown, setDeferredShown] = useState(PAGE_SIZE);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Estado del pórtico: 3 cartas de desbloqueo, tinta extra y selección de estrategia
  const [flippedKeys, setFlippedKeys] = useState<Set<string>>(() => new Set());
  const [unlockedKeys, setUnlockedKeys] = useState<Set<string>>(() => new Set());
  const [bonusInk, setBonusInk] = useState(0);
  const [selectedStrategy, setSelectedStrategy] = useState<ReadingStrategyPreset>(
    initialStrategy ?? "focus",
  );

  const answered = Object.keys(answers).length;
  const unknownCount = Object.values(answers).filter(
    (answer) => answer === "unknown",
  ).length;

  const toggleExpand = (key: string) =>
    setExpandedKey((current) => (current === key ? null : key));

  const groups = GROUPS.map((group) => ({
    ...group,
    rows: rows.filter((row) => groupOf(row) === group.id),
  })).filter((group) => group.rows.length);

  let shown = 0;
  const visibleGroups = showAll
    ? groups
    : groups
        .map((group) => {
          const take = Math.max(0, PAGE_SIZE - shown);
          shown += Math.min(take, group.rows.length);
          return { ...group, rows: group.rows.slice(0, take) };
        })
        .filter((group) => group.rows.length);
  const hiddenCount = rows.length - shown;

  // Lo visible en pantalla (grupos principales + consultas abiertas):
  // el controlador deduplica por clave, así basta avisar el conjunto.
  const visibleRows = [
    ...visibleGroups.flatMap((group) => group.rows),
    ...(showUncertain ? (uncertainRows ?? []) : []),
    ...(showDeferred ? (deferredRows ?? []).slice(0, deferredShown) : []),
  ];
  const presentedSigRef = useRef("");
  useEffect(() => {
    const sig = visibleRows.map((row) => row.key).join("|");
    if (sig === presentedSigRef.current) return;
    presentedSigRef.current = sig;
    onRowsPresented?.(visibleRows);
  });

  const estMin =
    estimatedMinutes ??
    Math.max(2, Math.min(30, Math.round((rows.length || 1) * 1.5)));
  const gemsCount = Math.min(3, rows.length);

  const catMessage =
    analysis === "loading"
      ? "Estoy preparando el pórtico y encontrando las joyas léxicas del capítulo..."
      : analysis === "error"
        ? "No pude analizar las palabras, pero las puertas del capítulo están abiertas para ti."
        : gemsCount > 0
          ? `Este capítulo se lee en ~${estMin} min. Encontré ${gemsCount} ${gemsCount === 1 ? "joya léxica que te hará" : "joyas léxicas que te harán"} disfrutar más la lectura.`
          : `Este capítulo se lee en ~${estMin} min. ¡Todo despejado para disfrutar la lectura sin tropiezos!`;

  const handleFlipCard = (row: SectionPreviewRow) => {
    triggerHaptic(12);
    setFlippedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
    if (!unlockedKeys.has(row.key)) {
      setUnlockedKeys((prev) => new Set(prev).add(row.key));
      setBonusInk((prev) => prev + 5);
      onUnlockCard?.(row);
      window.dispatchEvent(new CustomEvent("lecta:focus-block-completed"));
    }
  };

  const STRATEGY_CHIPS: { id: ReadingStrategyPreset; label: string }[] = [
    { id: "focus", label: "Enfoque de Párrafo" },
    { id: "lexical", label: "Explorador Léxico" },
    { id: "immersive", label: "Lectura Inmersiva" },
    { id: "audio", label: "Audio-Lectura" },
  ];

  const handleSelectStrategy = (strat: ReadingStrategyPreset) => {
    setSelectedStrategy(strat);
    onSelectStrategy?.(strat);
    triggerHaptic(10);
  };

  return (
    <Sheet label={`Antes de leer — ${title}`} onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">Antes de leer — {title}</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar preparación"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {/* Cabecera del Pórtico con el Gato */}
      <div className="portico-cat-section">
        <div className="portico-cat-avatar">
          {companion ? (
            <Companion
              stage={companion.stage}
              mood="awake"
              accessories={companion.accessories}
              pose={analysis === "loading" ? "idle" : "greet"}
            />
          ) : (
            <div className="portico-cat-fallback" aria-hidden="true">🐱</div>
          )}
        </div>
        <div className="portico-speech-bubble" role="status">
          <p>{catMessage}</p>
        </div>
      </div>

      {analysis === "loading" ? (
        <p className="meta">Preparando vocabulario del capítulo…</p>
      ) : null}

      {analysis === "error" ? (
        <>
          <p role="alert" className="status">
            No se pudo analizar el vocabulario de esta parte.
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={onRetry}>
              Reintentar
            </button>
            <button type="button" className="btn btn--primary" onClick={onSkip}>
              Leer sin preparar
            </button>
          </div>
        </>
      ) : null}

      {analysis === "ready" && !rows.length ? (
        <>
          <p className="meta">
            Nada que preparar en esta parte: puedes leer tranquilo.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={onSkip}
            >
              Leer
            </button>
          </div>
        </>
      ) : null}

      {analysis === "ready" && rows.length ? (
        <>
          {/* 3 Cartas Rápidas de Desbloqueo (Flash-Preview) */}
          <section className="portico-flash-container" aria-label="Desbloqueo rápido de joyas léxicas">
            <div className="portico-flash-header">
              <h3 className="portico-subtitle">Desbloqueo rápido de joyas léxicas</h3>
              <span className="portico-ink-badge" title="Gotas de tinta obtenidas">
                +{bonusInk} gotas de tinta 💧
              </span>
            </div>
            <div className="portico-flash-grid">
              {rows.slice(0, 3).map((row) => {
                const isFlipped = flippedKeys.has(row.key);
                return (
                  <div
                    key={row.key}
                    className={`portico-card-3d section-preview__flash-card${isFlipped ? " is-flipped section-preview__flash-card--expanded section-preview__flash-card--flipped" : ""}`}
                    onClick={() => handleFlipCard(row)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Carta de joya léxica ${row.form}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleFlipCard(row);
                      }
                    }}
                  >
                    <div className="portico-card-inner section-preview__flash-inner">
                      <div className="portico-card-front section-preview__flash-face section-preview__flash-face--front">
                        <span className="portico-card-sparkle">✦</span>
                        <strong className="portico-card-form">{row.form}</strong>
                        <span className="portico-card-hint">Toca para descubrir</span>
                      </div>
                      <div className="portico-card-back section-preview__flash-face section-preview__flash-face--back">
                        <div className="section-preview__flash-back-header">
                          <strong className="section-preview__flash-word--back">{row.lemma || row.form}</strong>
                          <span className="section-preview__flash-flip-hint" aria-hidden="true" title="Volver a girar">↺</span>
                        </div>
                        <p className="portico-card-meaning">
                          {row.meaning ?? "Término clave de esta lectura"}
                        </p>
                        {row.context ? (
                          <p className="portico-card-context">“{row.context}”</p>
                        ) : null}
                        <span className="portico-card-reward">+5 gotas de tinta</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {bonusInk > 0 ? (
              <div className="portico-ink-progress" style={{ marginBlockStart: "var(--s-2)" }}>
                <ProgressInk
                  value={bonusInk}
                  max={15}
                  floor={0}
                  variant="vermilion"
                  label="Tinta ganada en el pórtico"
                />
              </div>
            ) : null}
          </section>

          {/* Selector de Estrategia con 1 Clic */}
          <div className="portico-strategy-selector">
            <span className="eyebrow">Estrategia para este capítulo</span>
            <div className="portico-strategy-chips" role="radiogroup" aria-label="Estrategia sugerida">
              {STRATEGY_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedStrategy === chip.id}
                  data-active={selectedStrategy === chip.id || undefined}
                  className="portico-chip"
                  onClick={() => handleSelectStrategy(chip.id)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Botón Hero: Entrar al capítulo → */}
          <div className="portico-actions-hero section-preview__actions">
            <button
              type="button"
              className="btn btn--primary portico-enter-btn"
              disabled={saving}
              onClick={() => {
                onSelectStrategy?.(selectedStrategy);
                onConfirm();
              }}
            >
              {saving ? "Guardando…" : "Entrar al capítulo →"}
            </button>
          </div>

          <p className="meta">
            Marca cada palabra: lo que no conozcas se agrega a tu Cuaderno
            al guardar. Puedes dejar algunas sin responder.
          </p>
          {visibleGroups.map((group) => (
            <section key={group.id} className="section-preview-group">
              <h3 className="section-preview-group-title">{group.label}</h3>
              <ul className="section-preview-list">
                {group.rows.map((row) => (
                  <Row
                    key={row.key}
                    row={row}
                    answer={answers[row.key]}
                    expanded={expandedKey === row.key}
                    saving={saving}
                    onAnswer={onAnswer}
                    onToggleExpand={toggleExpand}
                  />
                ))}
              </ul>
            </section>
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="btn--quiet"
              onClick={() => setShowAll(true)}
            >
              Ver {hiddenCount} más
            </button>
          ) : null}
          {uncertainRows?.length ? (
            <section className="section-preview-group">
              <h3 className="section-preview-group-title">
                <button
                  type="button"
                  className="btn--quiet"
                  aria-expanded={showUncertain}
                  onClick={() => setShowUncertain((v) => !v)}
                >
                  {showUncertain ? "Ocultar" : "Ver"} otras palabras sin información ({uncertainRows.length})
                </button>
              </h3>
              {showUncertain ? (
                <>
                  <p className="meta">
                    El catálogo no sabe si estas palabras son raras o comunes.
                    Marcadas como desconocidas también irán a tu Cuaderno.
                  </p>
                  <ul className="section-preview-list">
                    {uncertainRows.map((row) => (
                      <Row
                        key={row.key}
                        row={row}
                        answer={answers[row.key]}
                        expanded={expandedKey === row.key}
                        saving={saving}
                        onAnswer={onAnswer}
                        onToggleExpand={toggleExpand}
                      />
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}
          {deferredRows?.length ? (
            <section className="section-preview-group">
              <h3 className="section-preview-group-title">
                <button
                  type="button"
                  className="btn--quiet"
                  aria-expanded={showDeferred}
                  onClick={() => setShowDeferred((v) => !v)}
                >
                  {showDeferred ? "Ocultar" : "Ver"} más palabras de esta parte ({deferredRows.length})
                </button>
              </h3>
              {showDeferred ? (
                <>
                  <p className="meta">
                    No cupieron en la selección principal de esta ronda.
                    Marcadas como desconocidas también irán a tu Cuaderno.
                  </p>
                  <ul className="section-preview-list">
                    {deferredRows.slice(0, deferredShown).map((row) => (
                      <Row
                        key={row.key}
                        row={row}
                        answer={answers[row.key]}
                        expanded={expandedKey === row.key}
                        saving={saving}
                        onAnswer={onAnswer}
                        onToggleExpand={toggleExpand}
                      />
                    ))}
                  </ul>
                  {deferredRows.length > deferredShown ? (
                    <button
                      type="button"
                      className="btn--quiet"
                      onClick={() =>
                        setDeferredShown((n) => n + PAGE_SIZE)
                      }
                    >
                      Ver {deferredRows.length - deferredShown} más
                    </button>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}
          <p className="meta">
            {answered
              ? `${answered} respondida(s)${unknownCount ? ` · ${unknownCount} irán a tu Cuaderno` : ""}`
              : "Responde las que quieras; el resto queda pendiente."}
          </p>
          {confirmDiscard ? (
            <p className="meta" role="alert">
              ¿Descartar las respuestas marcadas?
              <button
                type="button"
                className="btn--quiet"
                onClick={() => {
                  setConfirmDiscard(false);
                  onDiscard();
                }}
              >
                Sí, descartar
              </button>
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setConfirmDiscard(false)}
              >
                Conservar
              </button>
            </p>
          ) : answered ? (
            <p className="meta">
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setConfirmDiscard(true)}
              >
                Descartar respuestas
              </button>
            </p>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={saving}
              onClick={onConfirm}
            >
              {saving ? "Guardando…" : "Guardar y leer"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={onSkip}
            >
              Leer sin preparar
            </button>
          </div>
        </>
      ) : null}

      {analysis === "loading" ? (
        <div className="actions">
          <button type="button" className="btn" onClick={onSkip}>
            Leer sin preparar
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}

export { SectionPreview };

