import { useEffect, useMemo, useRef, useState } from "react";
import type { LexiconEntry } from "../lib/lexicon";
import {
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
  phrase?: PhraseHit;
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
  const [isExpanded, setIsExpanded] = useState(!compactMode);
  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [savedEntry, setSavedEntry] = useState<SavedWord | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [syncNote, setSyncNote] = useState(false);
  const [quickNotice, setQuickNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState({ entryIndex: 0, senseIndex: 0 });
  const [report, setReport] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [reread, setReread] = useState<"idle" | "busy" | "done">("idle");
  const [personalNote, setPersonalNote] = useState("");

  const [passageExplanation, setPassageExplanation] = useState<{
    state: "busy" | "done" | "error";
    directMeaning?: string;
    contextualMeaning?: string;
    toneAndNuance?: string;
    catTip?: string;
    error?: string;
  } | null>(null);

  const [useAi, setUseAi] = useState(true);
  const autoTriggeredRef = useRef(false);

  // Entidades / Atlas sin spoilers
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
    void loadUseAi(captureDbScope()).then((on) => {
      if (!cancelled) setUseAi(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    autoTriggeredRef.current = false;
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
      if (!result.ok) setLookup({ kind: "error", message: result.error, offline: result.offline });
      else if (!result.found || result.entries.length === 0) setLookup({ kind: "notFound" });
      else setLookup({ kind: "found", entries: result.entries, offline: result.offline });
    })();
    return () => {
      cancelled = true;
    };
  }, [word, language]);

  // Desambiguador sintáctico
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
  const chosenEntry = entries[selected.entryIndex] ?? entries[0];
  const chosenSense = chosenEntry?.senses[selected.senseIndex] ?? chosenEntry?.senses[0];

  const hasLocalDefinition = Boolean(
    lookup.kind === "found" &&
      chosenSense?.definition &&
      chosenSense.definition.trim().length > 0,
  );

  const totalSenses = entries.reduce((count, entry) => count + entry.senses.length, 0);
  const multiSense = totalSenses > 1;

  // Acepciones secundarias (a partir de la segunda)
  const secondarySenses = useMemo(() => {
    const list: { entryIndex: number; senseIndex: number; definition: string }[] = [];
    entries.forEach((entry, entryIndex) => {
      entry.senses.forEach((sense, senseIndex) => {
        if (entryIndex === 0 && senseIndex === 0) return;
        list.push({ entryIndex, senseIndex, definition: sense.definition });
      });
    });
    return list;
  }, [entries]);

  const lexicalFamily = useMemo(() => findLexicalFamily(word, language), [word, language]);

  // Sinónimos rápidos (hasta 3 términos relacionados)
  const synonyms = useMemo(() => {
    return lexicalFamily.slice(0, 3);
  }, [lexicalFamily]);

  // OBJ-03: Carga automática de IA cuando la palabra no está en catálogo o no tiene definición
  useEffect(() => {
    if (
      lookup.kind === "loading" ||
      lookup.kind === "enriching" ||
      autoTriggeredRef.current
    ) {
      return;
    }

    const needsAiLookup =
      lookup.kind === "notFound" || (lookup.kind === "found" && !hasLocalDefinition);

    if (needsAiLookup && canExplain && useAi) {
      autoTriggeredRef.current = true;
      queueMicrotask(() => {
        setPassageExplanation({ state: "busy" });
      });

      const nativeLang = loadNativeLanguage();
      void explainInPassage(
        {
          word,
          sentence: context || `Palabra: ${word}`,
          bookTitle,
          author,
          language,
          nativeLanguage: nativeLang,
        },
        captureDbScope(),
      ).then((res) => {
        if (res.ok) {
          setPassageExplanation({
            state: "done",
            directMeaning: res.directMeaning,
            contextualMeaning: res.contextualMeaning,
            toneAndNuance: res.toneAndNuance,
            catTip: res.catTip,
          });
        } else {
          setPassageExplanation({
            state: "error",
            error: res.error,
          });
        }
      }).catch(() => {
        setPassageExplanation({
          state: "error",
          error: "Sin conexión con el servicio de IA.",
        });
      });
    }
  }, [lookup, hasLocalDefinition, canExplain, useAi, word, context, bookTitle, author, language]);

  // Búsqueda de menciones sin spoilers para personajes / lugares
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

  const explainPassageAction = async () => {
    if (passageExplanation?.state === "busy") return;
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
        sentence: context || `Palabra: ${word}`,
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
        directMeaning: result.directMeaning,
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

  // Guardar en cuaderno (persist)
  const persist = async (isPriority = false) => {
    const scope = captureDbScope();
    const effectiveMeaning =
      passageExplanation?.directMeaning ||
      passageExplanation?.contextualMeaning ||
      chosenSense?.definition ||
      undefined;

    const savedContext = personalNote.trim()
      ? `${context ?? ""} [Nota: ${personalNote.trim()}]`.trim()
      : context;

    const { word: entry, knowledge } = await saveWordWithKnowledge({
      word: {
        form: word,
        lemma: chosenEntry?.lemma,
        pos: chosenEntry?.pos,
        meaning: effectiveMeaning,
        senseEntryId: chosenEntry?.entryId,
        senseOrder: chosenSense?.senseOrder,
        language,
        context: savedContext,
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

  const reportSelected = async () => {
    if (chosenEntry?.entryId == null || chosenSense?.senseOrder == null) return;
    if (report === "sending") return;
    setReport("sending");
    const res = await reportSense(
      chosenEntry.entryId,
      chosenSense.senseOrder,
      captureDbScope(),
    );
    setReport(res.ok ? "done" : "error");
  };

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
      ).catch(() => {});
      setReread("done");
    } catch {
      setSaveError("No se pudo anotar el repaso. Intenta de nuevo.");
      setReread("idle");
    }
  };

  const actionsRef = useRef({
    handlePinNotebook,
    handleQuickKnown,
    save,
    word,
    language,
    savedEntry,
    saving,
    compactMode,
  });
  useEffect(() => {
    actionsRef.current = {
      handlePinNotebook,
      handleQuickKnown,
      save,
      word,
      language,
      savedEntry,
      saving,
      compactMode,
    };
  });

  // Atajos de teclado: 'p' (pronunciar), 'g' (guardar), 's' (ya la sé)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const act = actionsRef.current;
      const key = e.key.toLowerCase();
      if (key === "g") {
        e.preventDefault();
        if (!act.saving) {
          if (act.savedEntry) return;
          void act.handlePinNotebook();
        }
      } else if (key === "s") {
        e.preventDefault();
        if (!act.saving) {
          void act.handleQuickKnown();
        }
      } else if (key === "p") {
        e.preventDefault();
        void speakWord(act.word, act.language);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Micro-glosa para compactMode cuando no está expandida
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

  const primaryPos = chosenEntry?.pos || primary?.pos;
  const isConjugation =
    chosenEntry?.lemma && chosenEntry.lemma.toLowerCase() !== word.toLowerCase();

  return (
    <Sheet label={`Palabra ${word}`} onClose={onClose} side="right" variant="peek">
      {/* ===================================================================
          BLOQUE 1 — Cabecera de Identidad
          =================================================================== */}
      <div className="sheet-head word-panel-header">
        <div className="word-panel-identity">
          <h2 className="word-panel-lemma">
            {chosenEntry?.lemma || word}
          </h2>
          <button
            type="button"
            className="btn--pronounce"
            aria-label={`Pronunciar ${word}`}
            title="Escuchar pronunciación"
            onClick={() => void speakWord(word, language)}
          >
            <Icon name="speaker" size={18} />
          </button>
          {primaryPos ? (
            <span className="card-pos word-panel-pos-pill">{primaryPos}</span>
          ) : null}
          {isConjugation ? (
            <span className="word-panel-conjugation-note">de «{chosenEntry.lemma}»</span>
          ) : null}
        </div>
        <button
          type="button"
          className="btn--quiet word-panel-close-btn"
          onClick={onClose}
          aria-label="Cerrar ficha"
          data-autofocus
        >
          ✕
        </button>
      </div>

      {quickNotice ? (
        <div className="word-panel-notice-toast" role="status" aria-live="polite">
          {quickNotice}
        </div>
      ) : null}

      {/* ===================================================================
          BLOQUE 2 — El Significado Práctico (Siempre visible de inmediato)
          =================================================================== */}
      <div className="word-panel-body word-panel-level-1">
        {context ? <ContextQuote context={context} word={word} /> : null}

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

        {/* Estado de carga inicial */}
        {lookup.kind === "loading" ? (
          <p className="meta" style={{ paddingBlock: "1rem", textAlign: "center" }}>
            Buscando en el catálogo…
          </p>
        ) : null}

        {lookup.kind === "error" ? (
          <div className="word-panel-error-block">
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
                  else if (!result.found || result.entries.length === 0) setLookup({ kind: "notFound" });
                  else setLookup({ kind: "found", entries: result.entries, offline: result.offline });
                });
              }}
            >
              Intentar de nuevo
            </button>
          </div>
        ) : null}

        {/* OBJ-03: Carga automática de IA cuando no está en diccionario local */}
        {(lookup.kind === "notFound" || (lookup.kind === "found" && !hasLocalDefinition)) ? (
          <div className="word-panel-auto-ai-section">
            {passageExplanation?.state === "busy" ? (
              <div className="word-panel-auto-loading" role="status" aria-live="polite">
                <span className="cat-spinner" aria-hidden="true">🐱</span>
                <p className="meta" style={{ margin: 0, fontWeight: 500 }}>
                  🐱 Buscando el significado exacto en tu lectura...
                </p>
              </div>
            ) : passageExplanation?.state === "done" ? (
              <div className="word-panel-ai-practical-block">
                <div className="word-panel-practical-meaning">
                  <span className="eyebrow">Significado directo</span>
                  <p className="word-panel-best-sense-def">
                    {passageExplanation.directMeaning || passageExplanation.contextualMeaning}
                  </p>
                </div>

                {passageExplanation.contextualMeaning &&
                passageExplanation.directMeaning &&
                passageExplanation.contextualMeaning !== passageExplanation.directMeaning ? (
                  <div className="passage-explanation-card">
                    <div className="passage-explanation-meaning">
                      <span className="passage-badge-tone">{passageExplanation.toneAndNuance}</span>
                      <p className="passage-meaning-text">
                        <strong>En este pasaje:</strong> {passageExplanation.contextualMeaning}
                      </p>
                    </div>
                    {passageExplanation.catTip ? (
                      <div className="cat-literary-tip">
                        <span className="cat-tip-icon" aria-hidden="true">🐾</span>
                        <p className="cat-tip-text"><em>Michi:</em> «{passageExplanation.catTip}»</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : passageExplanation?.state === "error" ? (
              <div className="word-panel-ai-error">
                <p role="alert" className="status">{passageExplanation.error}</p>
                <button
                  type="button"
                  className="btn btn--explain-passage"
                  onClick={() => void explainPassageAction()}
                >
                  Reintentar con IA
                </button>
              </div>
            ) : (
              <p className="meta">Aún no tenemos esta palabra en el catálogo.</p>
            )}
          </div>
        ) : null}

        {/* 2.A: Si la palabra sí tenía definición local o vino del léxico base */}
        {lookup.kind === "found" && hasLocalDefinition ? (
          <div className="word-panel-practical-block word-panel-meaning-block">
            <div className="word-panel-main-meaning">
              <span className="eyebrow">Qué significa</span>
              <p className="word-panel-best-sense-def word-panel-primary-def">
                {chosenSense?.definition}
              </p>

              {synonyms.length > 0 ? (
                <div className="word-panel-synonyms-row">
                  <span className="meta" style={{ fontSize: "var(--fs-xs)" }}>💡 Sinónimos:</span>
                  <div className="lexical-family-chips">
                    {synonyms.map((syn) => (
                      <button
                        key={syn}
                        type="button"
                        className="lexical-chip"
                        onClick={() => onSelectWord?.(syn)}
                        title={`Explorar «${syn}»`}
                      >
                        {syn}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* 2.B: Explicación en tu frase (1 clic o ya resuelta) */}
            <div className="word-panel-ai-phrase-section">
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
              ) : characterRecap.state === "done" && characterRecap.summary ? (
                <div className="character-recap-result">
                  {characterRecap.role ? (
                    <span className="character-recap-role">{characterRecap.role}</span>
                  ) : null}
                  <p className="character-recap-summary">{characterRecap.summary}</p>
                </div>
              ) : (
                <button
                  type="button"
                  className={`btn ${isProperNoun ? "btn--character-recap" : "btn--explain-passage"}`}
                  disabled={passageExplanation?.state === "busy" || characterRecap.state === "busy"}
                  onClick={() => {
                    if (isProperNoun) void handleCharacterRecap();
                    else void explainPassageAction();
                  }}
                >
                  {passageExplanation?.state === "busy" || characterRecap.state === "busy"
                    ? "Consultando al gato…"
                    : isProperNoun
                      ? "🧭 ¿Quién es o qué es en el libro?"
                      : "✨ Explicar en esta frase"}
                </button>
              )}
            </div>

            {/* 2.C: Acordeón opcional "Más detalles y nota personal ▾" */}
            <details className="word-panel-details-accordion">
              <summary className="word-panel-accordion-summary">
                <span>Más detalles y nota personal ▾</span>
              </summary>
              <div className="word-panel-accordion-content">
                {multiSense ? (
                  <div className="word-panel-secondary-senses">
                    <span className="eyebrow">Acepciones secundarias</span>
                    <ol className="senses" start={2}>
                      {secondarySenses.map((s, idx) => (
                        <li key={idx}>
                          <button
                            type="button"
                            className={`sense-option${selected.senseIndex === s.senseIndex ? " is-selected" : ""}`}
                            onClick={() => setSelected({ entryIndex: s.entryIndex, senseIndex: s.senseIndex })}
                          >
                            {s.definition}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

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

                {/* Campo opcional para nota personal (SIN botón duplicado de guardar) */}
                <div className="word-panel-note-field">
                  <label htmlFor="word-personal-note" className="eyebrow">
                    Nota personal
                  </label>
                  <textarea
                    id="word-personal-note"
                    className="word-panel-note-textarea"
                    rows={2}
                    placeholder="Añade un apunte personal o mnemotécnica..."
                    value={personalNote}
                    onChange={(e) => setPersonalNote(e.target.value)}
                  />
                </div>

                {characterSummary && isProperNoun ? (
                  <div className="spoiler-free-card" role="region" aria-label="Atlas del libro sin spoilers">
                    <div className="spoiler-free-header">
                      <span className="spoiler-free-badge">🧭 Atlas sin Spoilers</span>
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
                  </div>
                ) : null}

                {chosenEntry?.entryId != null && chosenSense?.senseOrder != null ? (
                  <div className="word-panel-report-row">
                    {report === "done" ? (
                      <span className="meta">Gracias, lo anotamos.</span>
                    ) : (
                      <button
                        type="button"
                        className="btn--quiet btn--report-sense"
                        disabled={report === "sending"}
                        onClick={() => void reportSelected()}
                      >
                        {report === "sending" ? "Enviando…" : "Esta explicación no corresponde"}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </details>
          </div>
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
      </div>

      {/* ===================================================================
          BLOQUE 3 — Barra Única de Acción al Pie (Sticky Footer)
          =================================================================== */}
      <div className="word-panel-sticky-footer">
        {savedEntry ? (
          <div className="word-panel-footer-saved">
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
          </div>
        ) : (
          <button
            type="button"
            className="btn--quick-action btn--pin-notebook btn btn--primary"
            aria-label="★ Guardar en cuaderno"
            title="Guardar en cuaderno"
            disabled={saving}
            onClick={() => void handlePinNotebook()}
          >
            ★ Guardar en mi cuaderno
          </button>
        )}
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
      </div>
    </Sheet>
  );
}
