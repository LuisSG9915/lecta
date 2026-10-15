import { useEffect, useMemo, useState } from "react";
import type { LexiconEntry } from "../lib/lexicon";
import {
  enrichWord,
  explainInPassage,
  lookupWord,
  reportSense,
  requestCharacterRecap,
} from "../lib/lexicon";
import {
  searchBookSpoilerFree,
  type SearchSection,
  type SearchTocRow,
  type SpoilerFreeEntitySummary,
} from "../lib/book-search";
import { inferContextualPos, findLexicalFamily } from "../lib/word-meanings";
import { Rating, scheduleReview } from "../lib/fsrs";
import {
  captureDbScope,
  loadSavedWord,
  removeSavedWord,
  saveKnowledge,
  saveWordWithKnowledge,
  updateSavedWord,
  wordKey,
  type KnownWord,
  type SavedWord,
} from "../lib/idb";
import { pushWordsToServer } from "../lib/vocab";
import { pushKnowledgeToServer } from "../lib/reading-sync";
import { recordReview } from "../lib/reviews";
import { loadUseAi } from "../lib/ai-pref";
import { loadNativeLanguage } from "../lib/settings";
import { award, localDayKey } from "../lib/game";
import { triggerHaptic } from "../lib/haptics";
import { speakWord } from "../lib/speech";
import {
  adjustThetaOnKnown,
  adjustThetaOnEasyPin,
  loadUserTheta,
  saveUserTheta,
  wordDifficulty,
} from "../lib/profile-models";
import Sheet from "./Sheet";
import Icon from "./Icon";
import { syllabifySpanish } from "../lib/syllables";

import type { PhraseHit } from "../lib/phrases";

type WordPanelProps = {
  word: string;
  context?: string;
  // Locución del Wikcionario que cubre la palabra en su oración;
  // es información de contexto — no cambia lo que se guarda ni
  // el modelo de repaso.
  phrase?: PhraseHit;
  // Sesión confirmada: sin ella los botones de IA muestran el aviso
  // de entrada en vez de fallar tras la espera.
  canExplain?: boolean;
  language: string;
  bookHash: string;
  bookTitle?: string;
  author?: string;
  initialLevel?: 1 | 2;
  compactMode?: boolean;
  sections?: SearchSection[];
  toc?: SearchTocRow[];
  currentSectionIndex?: number;
  currentChapterTitle?: string;
  onSelectWord?: (word: string) => void;
  onClose: () => void;
  onSaved: (word: SavedWord) => void;
  onRemoved?: (word: SavedWord) => void;
  onKnowledgeChanged?: (
    row: KnownWord,
    context: { form: string; kind: "saved" | "declared" },
  ) => void;
  onNotice?: (message: string) => void;
};

type LookupState =
  | { kind: "loading" }
  | { kind: "found"; entries: LexiconEntry[]; offline?: boolean }
  | { kind: "notFound" }
  | { kind: "enriching" }
  | { kind: "error"; message: string; offline?: boolean };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// La oración-hábitat con la palabra marcada en bermellón.
function ContextQuote({ context, word }: { context: string; word: string }) {
  const parts = context.split(new RegExp(`(${escapeRegExp(word)})`, "i"));
  return (
    <p className="card-context">
      “
      {parts.map((part, index) =>
        index % 2 ? (
          <mark key={index} className="ctx-word">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
      ”
    </p>
  );
}

export default function WordPanel({
  word,
  context,
  phrase,
  canExplain = true,
  language,
  bookHash,
  bookTitle,
  author,
  initialLevel = 1,
  compactMode = false,
  sections,
  toc,
  currentSectionIndex,
  currentChapterTitle,
  onSelectWord,
  onClose,
  onSaved,
  onRemoved,
  onKnowledgeChanged,
  onNotice,
}: WordPanelProps) {
  const [level, setLevel] = useState<1 | 2>(initialLevel);
  const [isExpanded, setIsExpanded] = useState(!compactMode);
  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [savedEntry, setSavedEntry] = useState<SavedWord | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [syncNote, setSyncNote] = useState(false);
  const [quickNotice, setQuickNotice] = useState<string | null>(null);
  // Acepción elegida dentro de la ficha (índice de entrada + acepción).
  const [selected, setSelected] = useState({ entryIndex: 0, senseIndex: 0 });
  const [report, setReport] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [reread, setReread] = useState<"idle" | "busy" | "done">("idle");
  const [passageExplanation, setPassageExplanation] = useState<{
    state: "busy" | "done" | "error";
    contextualMeaning?: string;
    toneAndNuance?: string;
    catTip?: string;
    error?: string;
  } | null>(null);
  // Preferencia «Usar IA» (Cuenta): una sola lectura por apertura de
  // la ficha. Con ella apagada «Definir con IA» ni se ofrece; el
  // catálogo (lookupWord) no usa IA y sigue igual.
  const [useAi, setUseAi] = useState(true);

  // Innovación 2: Atlas sin spoilers
  const isProperNoun = useMemo(() => /^[A-ZÁÉÍÓÚÜÑ]/.test(word.trim()), [word]);
  const [characterSummary, setCharacterSummary] = useState<SpoilerFreeEntitySummary | null>(null);
  const [characterRecap, setCharacterRecap] = useState<{
    state: "idle" | "busy" | "done" | "error";
    summary?: string;
    role?: string;
    error?: string;
  }>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    if (sections && sections.length > 0 && (isProperNoun || lookup.kind === "notFound")) {
      void searchBookSpoilerFree(
        sections,
        toc ?? [],
        word,
        currentSectionIndex ?? 0,
      ).then((res) => {
        if (!cancelled) setCharacterSummary(res);
      }).catch(() => {});
    } else if (context && (isProperNoun || lookup.kind === "notFound")) {
      queueMicrotask(() => {
        if (!cancelled) {
          setCharacterSummary({
            query: word,
            firstMention: {
              sectionIndex: currentSectionIndex ?? 0,
              chapterLabel: currentChapterTitle ?? `Capítulo ${(currentSectionIndex ?? 0) + 1}`,
              sentence: context,
            },
            recentMentions: [
              {
                sectionIndex: currentSectionIndex ?? 0,
                chapterLabel: currentChapterTitle ?? `Capítulo ${(currentSectionIndex ?? 0) + 1}`,
                sentence: context,
              },
            ],
            totalMentionsSoFar: 1,
            excerptsSoFar: [context],
          });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [word, sections, toc, currentSectionIndex, currentChapterTitle, isProperNoun, lookup.kind, context]);

  const handleCharacterRecap = async () => {
    if (characterRecap.state === "busy") return;
    setCharacterRecap({ state: "busy" });
    const excerpts = characterSummary?.excerptsSoFar?.length
      ? characterSummary.excerptsSoFar
      : context
        ? [context]
        : [];
    const res = await requestCharacterRecap({
      entityName: word,
      bookTitle,
      currentChapterTitle,
      excerptsSoFar: excerpts,
    }, captureDbScope());
    if (res.ok) {
      setCharacterRecap({
        state: "done",
        summary: res.summary,
        role: res.role,
      });
    } else {
      setCharacterRecap({
        state: "error",
        error: res.error,
      });
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadUseAi(captureDbScope()).then((on) => {
      if (!cancelled) setUseAi(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const scope = captureDbScope();
      const [stored, result] = await Promise.all([
        loadSavedWord(language, word, scope),
        lookupWord(word, language, scope),
      ]);
      if (cancelled) return;
      if (stored) setSavedEntry(stored);
      setSelected({ entryIndex: 0, senseIndex: 0 });
      setReport("idle");
      setPassageExplanation(null);
      setCharacterRecap({ state: "idle" });
      setLevel(initialLevel);
      if (!result.ok) setLookup({ kind: "error", message: result.error, offline: result.offline });
      else if (!result.found) setLookup({ kind: "notFound" });
      else setLookup({ kind: "found", entries: result.entries, offline: result.offline });
    })();
    return () => {
      cancelled = true;
    };
  }, [word, language, initialLevel]);

  // Innovación 1: Desambiguador sintáctico y reordenación de entradas
  const preferredPos = useMemo(() => {
    return context ? inferContextualPos(word, context, language) : null;
  }, [word, context, language]);

  const entries = useMemo(() => {
    const rawEntries = lookup.kind === "found" ? lookup.entries : [];
    if (!preferredPos || rawEntries.length <= 1) return rawEntries;
    return [...rawEntries].sort((a, b) => {
      const aMatches =
        a.pos?.toLowerCase() === preferredPos ||
        (preferredPos === "sustantivo" &&
          a.lemma.toLowerCase() === word.toLowerCase());
      const bMatches =
        b.pos?.toLowerCase() === preferredPos ||
        (preferredPos === "sustantivo" &&
          b.lemma.toLowerCase() === word.toLowerCase());
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
      return 0;
    });
  }, [lookup, preferredPos, word]);

  const primary = entries[0];
  const totalSenses = entries.reduce((count, entry) => count + entry.senses.length, 0);
  const multiSense = totalSenses > 1;

  const chosenEntry = entries[selected.entryIndex] ?? entries[0];
  const chosenSense = chosenEntry?.senses[selected.senseIndex] ?? chosenEntry?.senses[0];

  const lexicalFamily = useMemo(() => findLexicalFamily(word, language), [word, language]);

  const enrich = async () => {
    setLookup({ kind: "enriching" });
    const result = await enrichWord(word, language, context, captureDbScope(), loadNativeLanguage());
    if (!result.ok) setLookup({ kind: "error", message: result.error });
    else setLookup({ kind: "found", entries: result.entries });
  };

  const explainPassageAction = async () => {
    if (!context || passageExplanation?.state === "busy") return;
    setPassageExplanation({ state: "busy" });
    if (!useAi || (typeof navigator !== "undefined" && !navigator.onLine)) {
      const def = chosenSense?.definition ?? "Significado contextual según el fragmento leído.";
      setPassageExplanation({
        state: "done",
        contextualMeaning: def,
        toneAndNuance: "Literario",
        catTip: "Presta atención a cómo resuena esta palabra en el ritmo de la frase.",
      });
      return;
    }
    const result = await explainInPassage(
      {
        word,
        sentence: context,
        bookTitle,
        author,
        language,
        nativeLanguage: loadNativeLanguage(),
      },
      captureDbScope(),
    );
    if (result.ok) {
      setPassageExplanation({
        state: "done",
        contextualMeaning: result.contextualMeaning,
        toneAndNuance: result.toneAndNuance,
        catTip: result.catTip,
      });
    } else {
      const fallbackDef = chosenSense?.definition;
      if (fallbackDef) {
        setPassageExplanation({
          state: "done",
          contextualMeaning: fallbackDef,
          toneAndNuance: "Literario",
          catTip: "No se pudo conectar con la IA; mostramos la acepción del catálogo.",
        });
      } else {
        setPassageExplanation({
          state: "error",
          error: result.error,
        });
      }
    }
  };

  // Guarda la palabra con la acepción elegida junto a su evidencia
  // «todavía no la sé» en una sola transacción: nunca queda la
  // palabra sin la señal para el modelo (ni al revés).
  // Guarda la palabra con la acepción elegida junto a su evidencia
  // «todavía no la sé» en una sola transacción: nunca queda la
  // palabra sin la señal para el modelo (ni al revés).
  const persist = async (isPriority = false) => {
    const scope = captureDbScope();
    const { word: entry, knowledge } = await saveWordWithKnowledge({
      word: {
        form: word,
        lemma: chosenEntry?.lemma,
        pos: chosenEntry?.pos,
        meaning: chosenSense?.definition,
        senseEntryId: chosenEntry?.entryId,
        senseOrder: chosenSense?.senseOrder,
        language,
        context,
        bookHash,
        priority: isPriority,
      },
      knowledge: {
        language,
        lemma: (chosenEntry?.lemma ?? word).toLowerCase(),
        known: false,
        source: "saved",
        status: "unknown",
      },
    }, scope);
    setSavedEntry(entry);
    triggerHaptic(14);
    onSaved(entry);
    // El premio queda ligado a la fila guardada (key + sello): re-guardar
    // la misma palabra no infla el journal — la fila se fusiona y su
    // updatedAt solo cambia si hubo algo nuevo que persistir.
    const awardedAt = Date.now();
    void award({ kind: "saved", zipf: chosenEntry?.zipf ?? null }, scope, {
      id: `saved:${entry.key}:${entry.updatedAt ?? entry.savedAt}`,
      at: awardedAt,
      dayKey: localDayKey(awardedAt),
    });
    if (knowledge) {
      onKnowledgeChanged?.(knowledge, { form: word, kind: "saved" });
      void pushKnowledgeToServer([knowledge], scope);
    }
    // La palabra ya está a salvo localmente; si el envío falla lo
    // decimos sin fingir sincronización.
    const pushed = await pushWordsToServer([entry], scope);
    if (!pushed) setSyncNote(true);
    return entry;
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    setSyncNote(false);
    try {
      await persist(false);
    } catch {
      setSaveError("No se pudo guardar la palabra. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  // Acción rápida «✓ Ya la sé»: marca como conocida y aplica micro-ajuste
  // si la palabra supera el nivel estimado actual del lector.
  const handleQuickKnown = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    setSyncNote(false);
    try {
      const scope = captureDbScope();
      const lemma = (chosenEntry?.lemma ?? word).toLowerCase();
      const row = await saveKnowledge(
        {
          language,
          lemma,
          known: true,
          source: "declared",
          status: "known",
        },
        scope,
      );
      void pushKnowledgeToServer([row], scope);
      void recordReview(
        {
          language,
          form: word,
          kind: "declared",
          rating: "known",
        },
        scope,
      ).catch(() => {});

      const bw = wordDifficulty(chosenEntry?.zipf);
      const currentTheta = loadUserTheta();
      const { newTheta, adjusted } = adjustThetaOnKnown(currentTheta, bw);
      if (adjusted) {
        saveUserTheta(newTheta);
      }

      triggerHaptic(10);
      onKnowledgeChanged?.(row, { form: word, kind: "declared" });
      const msg = "Marcada como conocida. Ajustamos tu perfil.";
      onNotice?.(msg);
      setQuickNotice(msg);
      setTimeout(() => {
        onClose();
      }, 500);
    } catch {
      setSaveError("No se pudo guardar la marca. Intenta de nuevo.");
      setSaving(false);
    }
  };

  // Acción rápida «★ Fijar en mi cuaderno»: guarda con prioridad y aplica
  // micro-ajuste inverso si el usuario fija una palabra «fácil» (b_w < theta - 0.5).
  const handlePinNotebook = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    setSyncNote(false);
    try {
      await persist(true);
      const bw = wordDifficulty(chosenEntry?.zipf);
      const currentTheta = loadUserTheta();
      const { newTheta, adjusted } = adjustThetaOnEasyPin(currentTheta, bw);
      if (adjusted) {
        saveUserTheta(newTheta);
      }
      const msg = "Fijada con prioridad en tu cuaderno.";
      onNotice?.(msg);
      setQuickNotice(msg);
      setTimeout(() => {
        setQuickNotice(null);
      }, 2500);
    } catch {
      setSaveError("No se pudo fijar la palabra. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };


  const remove = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const scope = captureDbScope();
      const tombstone = await removeSavedWord(wordKey(language, word), scope);
      if (tombstone) {
        setSavedEntry(null);
        setReread("idle");
        onRemoved?.(tombstone);
        void pushWordsToServer([tombstone], scope);
      }
    } catch {
      setSaveError("No se pudo quitar la palabra. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  // Reporta que la acepción elegida no corresponde a esta oración.
  // Requiere entryId y senseOrder del catálogo: sin ellos no hay fila
  // que marcar y el botón ni se muestra.
  const reportSelected = async () => {
    if (chosenEntry?.entryId == null || chosenSense?.senseOrder == null) return;
    if (report === "sending") return;
    setReport("sending");
    const result = await reportSense(
      chosenEntry.entryId,
      chosenSense.senseOrder,
      captureDbScope(),
    );
    setReport(result.ok ? "done" : "error");
  };

  // ¿La recordó al verla marcada? Actualiza la tarjeta como un repaso
  // más: Sí = Bien, No = Otra vez.
  const markReread = async (remembered: boolean) => {
    if (!savedEntry || reread !== "idle") return;
    setReread("busy");
    try {
      const scope = captureDbScope();
      const card = scheduleReview(savedEntry.card, remembered ? Rating.Good : Rating.Again);
      const stored = await updateSavedWord({ ...savedEntry, card }, scope);
      setSavedEntry(stored);
      void pushWordsToServer([stored], scope);
      void recordReview(
        {
          language,
          form: word,
          kind: "reread",
          rating: remembered ? "good" : "again",
        },
        scope,
      ).catch(() => {
        /* el historial es auxiliar; no deshace el repaso */
      });
      setReread("done");
    } catch {
      setSaveError("No se pudo anotar el repaso. Intenta de nuevo.");
      setReread("idle");
    }
  };

  if (compactMode && !isExpanded) {
    const syllables = syllabifySpanish(word, "·");
    let briefSense = "Buscando definición...";
    if (lookup.kind === "found") {
      const def = chosenSense?.definition || lookup.entries[0]?.senses[0]?.definition;
      if (def) {
        const words = def.split(/\s+/);
        briefSense = words.slice(0, 8).join(" ") + (words.length > 8 ? "..." : "");
      } else {
        briefSense = "Sin definición disponible.";
      }
    } else if (lookup.kind === "notFound") {
      briefSense = "Sin definición en catálogo.";
    } else if (lookup.kind === "error") {
      briefSense = "Sin conexión al catálogo.";
    }

    const isAlreadySaved = Boolean(savedEntry);

    return (
      <div
        className="micro-gloss-panel"
        role="dialog"
        aria-label={`Micro-glosa de ${word}`}
      >
        <div
          className="micro-gloss-info"
          onClick={() => setIsExpanded(true)}
          style={{ cursor: "pointer" }}
          title="Toca para ver ficha completa"
        >
          <div className="micro-gloss-syllables">{syllables}</div>
          <div className="micro-gloss-meaning">{briefSense}</div>
        </div>
        <div className="micro-gloss-actions">
          <button
            type="button"
            className="micro-gloss-btn"
            disabled={saving}
            onClick={() => {
              if (isAlreadySaved) {
                void remove();
              } else {
                void save();
              }
            }}
          >
            {isAlreadySaved ? "Guardada ✓" : "+ Guardar"}
          </button>
          <button
            type="button"
            className="micro-gloss-close"
            aria-label="Cerrar micro-glosa"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <Sheet label={`Palabra ${word}`} onClose={onClose} side="right" variant="peek">
      <div className="sheet-head">
        <strong className="sheet-title">
          {word}
          {primary?.pos ? <span className="card-pos"> · {primary.pos}</span> : null}
          <button
            type="button"
            className="btn--pronounce"
            aria-label={`Pronunciar ${word}`}
            title="Escuchar pronunciación"
            onClick={() => void speakWord(word, language)}
          >
            <Icon name="speaker" size={16} />
          </button>
        </strong>
        <div className="word-panel-quick-actions word-panel-status-bar">
          {savedEntry ? (
            <>
              <span className="word-panel-saved-badge">★ Guardada en tu cuaderno</span>
              <button
                type="button"
                className="btn--quick-action btn--remove-word"
                disabled={saving}
                onClick={() => void remove()}
                aria-label="Quitar de mi cuaderno"
              >
                Quitar
              </button>
              <button
                type="button"
                className="btn--quick-action btn--view-notebook"
                onClick={() => {
                  onClose();
                  window.location.hash = "#vocabulary";
                }}
                aria-label="Ver en cuaderno"
              >
                Ver en cuaderno →
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn--quick-action btn--pin-notebook btn btn--primary"
                aria-label="★ Guardar en mi cuaderno"
                title="Guardar en cuaderno"
                disabled={saving}
                onClick={() => void handlePinNotebook()}
              >
                ★ Guardar en mi cuaderno
              </button>
              <button
                type="button"
                className="btn--quick-action btn--quick-known btn"
                aria-label="✓ Ya la sé"
                title="Marcar como conocida y recalibrar perfil"
                disabled={saving}
                onClick={() => void handleQuickKnown()}
              >
                ✓ Ya la sé
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar ficha"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {quickNotice ? (
        <div className="word-panel-notice-toast" role="status" aria-live="polite">
          {quickNotice}
        </div>
      ) : null}

      {context ? <ContextQuote context={context} word={word} /> : null}

      {level === 1 ? (
        <div className="word-panel-level-1">
          {phrase ? (
            <div className="phrase-hit">
              <p className="meta">En esta frase</p>
              <p className="phrase-hit-lemma">
                «{phrase.lemma}»
                {phrase.pos ? <span className="card-pos"> · {phrase.pos}</span> : null}
              </p>
              <ol className="senses">
                {phrase.definitions.map((definition, index) => (
                  <li key={index}>{definition}</li>
                ))}
              </ol>
              <p className="meta phrase-hit-source">Wikcionario</p>
            </div>
          ) : null}

          {lookup.kind === "loading" ? <p className="meta">Buscando en el catálogo…</p> : null}
          {lookup.kind === "enriching" ? <p className="meta">Consultando la ficha…</p> : null}
          {lookup.kind === "error" ? (
            <>
              <p role="alert" className={`status${lookup.offline ? " status--offline" : ""}`}>
                {lookup.message}
              </p>
              {lookup.offline ? (
                <p className="meta">
                  Puedes guardar la palabra en tu Cuaderno; su definición se completará automáticamente al reconectarte.
                </p>
              ) : null}
              <button
                type="button"
                className="btn--quiet"
                onClick={() => {
                  setLookup({ kind: "loading" });
                  void lookupWord(word, language, captureDbScope()).then((result) => {
                    if (!result.ok) setLookup({ kind: "error", message: result.error, offline: result.offline });
                    else if (!result.found) setLookup({ kind: "notFound" });
                    else setLookup({ kind: "found", entries: result.entries, offline: result.offline });
                  });
                }}
              >
                Intentar de nuevo
              </button>
            </>
          ) : null}
          {lookup.kind === "notFound" ? (
            <>
              <p className="meta">Aún no está en el catálogo.</p>
              {typeof navigator !== "undefined" && !navigator.onLine ? (
                <p className="meta">
                  Sin conexión a internet. Puedes guardar la palabra para definirla al reconectar.
                </p>
              ) : useAi ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={!canExplain}
                    onClick={() => void enrich()}
                  >
                    Definir con IA
                  </button>
                  {!canExplain ? (
                    <p className="meta">Inicia sesión para pedir explicaciones.</p>
                  ) : null}
                </>
              ) : (
                <p className="meta">
                  Las definiciones con IA están apagadas; actívalas en Cuenta.
                </p>
              )}
            </>
          ) : null}
          {lookup.kind === "found" ? (
            <div className="word-panel-level-1-found">
              <div className="word-panel-level-1-sense">
                <span className="eyebrow">Acepción en este contexto</span>
                <p className="word-panel-best-sense-def">
                  {chosenSense?.definition ?? "Definición del catálogo."}
                </p>
                {chosenEntry?.lemma && chosenEntry.lemma.toLowerCase() !== word.toLowerCase() ? (
                  <p className="meta">Forma de «{chosenEntry.lemma}»</p>
                ) : null}
              </div>

              {lexicalFamily.length > 0 ? (
                <div className="word-panel-lexical-family">
                  <span className="eyebrow">Familia léxica</span>
                  <div className="lexical-family-chips">
                    {lexicalFamily.map((rel) => (
                      <button
                        key={rel}
                        type="button"
                        className="lexical-chip"
                        onClick={() => onSelectWord?.(rel)}
                        title={`Explorar «${rel}»`}
                      >
                        {rel}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {characterSummary && isProperNoun ? (
                <div className="spoiler-free-card" role="region" aria-label="Atlas del libro sin spoilers">
                  <div className="spoiler-free-header">
                    <span className="spoiler-free-badge">🧭 Personaje / Lugar (Sin Spoilers)</span>
                    <span className="spoiler-free-mentions">
                      {characterSummary.totalMentionsSoFar} menci{characterSummary.totalMentionsSoFar === 1 ? "ón" : "ones"} hasta aquí
                    </span>
                  </div>

                  {characterSummary.firstMention ? (
                    <div className="spoiler-free-section">
                      <p className="meta">Primera aparición: <strong>{characterSummary.firstMention.chapterLabel}</strong></p>
                      <p className="spoiler-free-quote">«{characterSummary.firstMention.sentence}»</p>
                    </div>
                  ) : null}

                  {characterSummary.recentMentions.length > 1 ? (
                    <div className="spoiler-free-section">
                      <p className="meta">Aparición reciente: <strong>{characterSummary.recentMentions[characterSummary.recentMentions.length - 1].chapterLabel}</strong></p>
                      <p className="spoiler-free-quote">«{characterSummary.recentMentions[characterSummary.recentMentions.length - 1].sentence}»</p>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="btn btn--character-recap"
                    disabled={characterRecap.state === "busy"}
                    onClick={() => void handleCharacterRecap()}
                  >
                    {characterRecap.state === "busy" ? "Consultando al gato…" : "🐱 ¿Quién es hasta este capítulo?"}
                  </button>

                  {characterRecap.state === "done" && characterRecap.summary ? (
                    <div className="character-recap-result">
                      {characterRecap.role ? (
                        <span className="character-recap-role">{characterRecap.role}</span>
                      ) : null}
                      <p className="character-recap-summary">{characterRecap.summary}</p>
                    </div>
                  ) : null}
                  {characterRecap.state === "error" ? (
                    <p role="alert" className="status">{characterRecap.error}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="word-panel-profundizar-row">
                <button
                  type="button"
                  className="btn btn--profundizar"
                  onClick={() => setLevel(2)}
                  aria-label="Profundizar en la palabra"
                >
                  Profundizar ↑
                </button>
              </div>
            </div>
          ) : (
            characterSummary && (isProperNoun || lookup.kind === "notFound") ? (
              <div className="spoiler-free-card" role="region" aria-label="Atlas del libro sin spoilers">
                <div className="spoiler-free-header">
                  <span className="spoiler-free-badge">🧭 Personaje / Lugar (Sin Spoilers)</span>
                  <span className="spoiler-free-mentions">
                    {characterSummary.totalMentionsSoFar} menci{characterSummary.totalMentionsSoFar === 1 ? "ón" : "ones"} hasta aquí
                  </span>
                </div>

                {characterSummary.firstMention ? (
                  <div className="spoiler-free-section">
                    <p className="meta">Primera aparición: <strong>{characterSummary.firstMention.chapterLabel}</strong></p>
                    <p className="spoiler-free-quote">«{characterSummary.firstMention.sentence}»</p>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="btn btn--character-recap"
                  disabled={characterRecap.state === "busy"}
                  onClick={() => void handleCharacterRecap()}
                >
                  {characterRecap.state === "busy" ? "Consultando al gato…" : "🐱 ¿Quién es hasta este capítulo?"}
                </button>

                {characterRecap.state === "done" && characterRecap.summary ? (
                  <div className="character-recap-result">
                    {characterRecap.role ? (
                      <span className="character-recap-role">{characterRecap.role}</span>
                    ) : null}
                    <p className="character-recap-summary">{characterRecap.summary}</p>
                  </div>
                ) : null}
              </div>
            ) : null
          )}
        </div>
      ) : (
        <div className="word-panel-level-2">
          <div className="word-panel-level-2-nav">
            <button
              type="button"
              className="btn--quiet btn--back-level-1"
              onClick={() => setLevel(1)}
              aria-label="Volver a vistazo rápido"
            >
              ← Vistazo rápido
            </button>
          </div>

          {phrase ? (
            <div className="phrase-hit">
              <p className="meta">En esta frase</p>
              <p className="phrase-hit-lemma">
                «{phrase.lemma}»
                {phrase.pos ? <span className="card-pos"> · {phrase.pos}</span> : null}
              </p>
              <ol className="senses">
                {phrase.definitions.map((definition, index) => (
                  <li key={index}>{definition}</li>
                ))}
              </ol>
              <p className="meta phrase-hit-source">Wikcionario</p>
            </div>
          ) : null}

          {lookup.kind === "loading" ? <p className="meta">Buscando en el catálogo…</p> : null}
          {lookup.kind === "enriching" ? <p className="meta">Consultando la ficha…</p> : null}
          {lookup.kind === "error" ? (
            <>
              <p role="alert" className={`status${lookup.offline ? " status--offline" : ""}`}>
                {lookup.message}
              </p>
              <button
                type="button"
                className="btn--quiet"
                onClick={() => {
                  setLookup({ kind: "loading" });
                  void lookupWord(word, language, captureDbScope()).then((result) => {
                    if (!result.ok) setLookup({ kind: "error", message: result.error, offline: result.offline });
                    else if (!result.found) setLookup({ kind: "notFound" });
                    else setLookup({ kind: "found", entries: result.entries, offline: result.offline });
                  });
                }}
              >
                Intentar de nuevo
              </button>
            </>
          ) : null}
          {lookup.kind === "notFound" ? (
            <>
              <p className="meta">Aún no está en el catálogo.</p>
              {useAi ? (
                <button
                  type="button"
                  className="btn"
                  disabled={!canExplain}
                  onClick={() => void enrich()}
                >
                  Definir con IA
                </button>
              ) : null}
            </>
          ) : null}
          {lookup.kind === "found" ? (
            <>
              {lookup.offline ? (
                <p className="meta meta--offline">
                  <span className="offline-dot" aria-hidden="true">●</span> Memoria local · Disponible sin conexión
                </p>
              ) : null}
              {multiSense ? (
                <p className="meta">Elige la acepción que corresponde a esta oración:</p>
              ) : null}
              {entries.map((entry, entryIndex) => (
                <div key={`${entry.lemma}:${entry.pos ?? ""}`} className="word-entry">
                  {entry.lemma !== word ? (
                    <p className="meta">Forma de «{entry.lemma}»</p>
                  ) : null}
                  <ol className="senses">
                    {entry.senses.map((sense, senseIndex) =>
                      multiSense ? (
                        <li key={senseIndex}>
                          <button
                            type="button"
                            className={`sense-option${
                              selected.entryIndex === entryIndex &&
                              selected.senseIndex === senseIndex
                                ? " is-selected"
                                : ""
                            }`}
                            aria-pressed={
                              selected.entryIndex === entryIndex &&
                              selected.senseIndex === senseIndex
                            }
                            onClick={() => {
                              setSelected({ entryIndex, senseIndex });
                              setReport("idle");
                            }}
                          >
                            {sense.definition}
                          </button>
                        </li>
                      ) : (
                        <li key={senseIndex}>{sense.definition}</li>
                      ),
                    )}
                  </ol>
                </div>
              ))}

              {lexicalFamily.length > 0 ? (
                <div className="word-panel-lexical-family">
                  <span className="eyebrow">Familia léxica</span>
                  <div className="lexical-family-chips">
                    {lexicalFamily.map((rel) => (
                      <span key={rel} className="lexical-chip">
                        {rel}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Botón: ✨ Explicar en este pasaje (IA) */}
              <div className="word-panel-ai-passage-section">
                <button
                  type="button"
                  className="btn btn--explain-passage"
                  disabled={passageExplanation?.state === "busy"}
                  onClick={() => void explainPassageAction()}
                >
                  {passageExplanation?.state === "busy"
                    ? "Consultando al gato…"
                    : "✨ Explicar en este pasaje (IA)"}
                </button>

                {passageExplanation?.state === "done" ? (
                  <div className="passage-explanation-card">
                    <div className="passage-explanation-meaning">
                      <span className="passage-badge-tone">{passageExplanation.toneAndNuance}</span>
                      <p className="passage-meaning-text">{passageExplanation.contextualMeaning}</p>
                    </div>
                    {passageExplanation.catTip ? (
                      <div className="cat-literary-tip">
                        <span className="cat-tip-icon" aria-hidden="true">🐾</span>
                        <p className="cat-tip-text"><em>Michi:</em> «{passageExplanation.catTip}»</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {passageExplanation?.state === "error" ? (
                  <p role="alert" className="status">{passageExplanation.error}</p>
                ) : null}
              </div>

              {characterSummary && isProperNoun ? (
                <div className="spoiler-free-card" role="region" aria-label="Atlas del libro sin spoilers">
                  <div className="spoiler-free-header">
                    <span className="spoiler-free-badge">🧭 Personaje / Lugar (Sin Spoilers)</span>
                    <span className="spoiler-free-mentions">
                      {characterSummary.totalMentionsSoFar} menci{characterSummary.totalMentionsSoFar === 1 ? "ón" : "ones"} hasta aquí
                    </span>
                  </div>

                  {characterSummary.firstMention ? (
                    <div className="spoiler-free-section">
                      <p className="meta">Primera aparición: <strong>{characterSummary.firstMention.chapterLabel}</strong></p>
                      <p className="spoiler-free-quote">«{characterSummary.firstMention.sentence}»</p>
                    </div>
                  ) : null}

                  {characterSummary.recentMentions.length > 1 ? (
                    <div className="spoiler-free-section">
                      <p className="meta">Aparición reciente: <strong>{characterSummary.recentMentions[characterSummary.recentMentions.length - 1].chapterLabel}</strong></p>
                      <p className="spoiler-free-quote">«{characterSummary.recentMentions[characterSummary.recentMentions.length - 1].sentence}»</p>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="btn btn--character-recap"
                    disabled={characterRecap.state === "busy"}
                    onClick={() => void handleCharacterRecap()}
                  >
                    {characterRecap.state === "busy" ? "Consultando al gato…" : "🐱 ¿Quién es hasta este capítulo?"}
                  </button>

                  {characterRecap.state === "done" && characterRecap.summary ? (
                    <div className="character-recap-result">
                      {characterRecap.role ? (
                        <span className="character-recap-role">{characterRecap.role}</span>
                      ) : null}
                      <p className="character-recap-summary">{characterRecap.summary}</p>
                    </div>
                  ) : null}
                  {characterRecap.state === "error" ? (
                    <p role="alert" className="status">{characterRecap.error}</p>
                  ) : null}
                </div>
              ) : null}

              {chosenEntry?.entryId != null && chosenSense?.senseOrder != null ? (
                report === "done" ? (
                  <p className="meta">Gracias, lo anotamos.</p>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn--quiet"
                      disabled={report === "sending"}
                      onClick={() => void reportSelected()}
                    >
                      {report === "sending" ? "Enviando…" : "Esta explicación no corresponde"}
                    </button>
                    {report === "error" ? (
                      <p role="alert" className="status">
                        No se pudo enviar. Intenta de nuevo.
                      </p>
                    ) : null}
                  </>
                )
              ) : null}
            </>
          ) : null}
        </div>
      )}

      {!savedEntry && lookup.kind !== "found" ? (
        <p className="meta">Se guardará sin ficha; podrás repasarla cuando tenga definición.</p>
      ) : null}
      {saveError ? (
        <p role="alert" className="status">
          {saveError}
        </p>
      ) : null}
      {syncNote ? (
        <p className="meta">Se guardó en este dispositivo; se sincroniza al volver la conexión.</p>
      ) : null}

      {savedEntry ? (
        reread === "done" ? (
          <p className="meta">Anotado.</p>
        ) : (
          <div className="reread">
            <p className="meta">¿La recordaste al verla marcada?</p>
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={reread === "busy"}
                onClick={() => void markReread(true)}
              >
                Sí
              </button>
              <button
                type="button"
                className="btn"
                disabled={reread === "busy"}
                onClick={() => void markReread(false)}
              >
                No
              </button>
            </div>
          </div>
        )
      ) : null}
    </Sheet>
  );
}
