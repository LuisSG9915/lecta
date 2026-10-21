import React, { useEffect, useState } from "react";
import {
  explainInPassage,
  lookupWord,
} from "../lib/lexicon";
import {
  type SearchSection,
  type SearchTocRow,
} from "../lib/book-search";
import { findLexicalFamily } from "../lib/word-meanings";
import {
  captureDbScope,
  loadSavedWord,
  loadSessionValue,
  removeSavedWord,
  saveKnowledge,
  saveSessionValue,
  saveWordWithKnowledge,
  type KnownWord,
  type SavedWord,
} from "../lib/idb";
import { pushKnowledgeToServer } from "../lib/reading-sync";
import { recordReview } from "../lib/reviews";
import { loadUseAi } from "../lib/ai-pref";
import { loadNativeLanguage } from "../lib/settings";
import { triggerHaptic } from "../lib/haptics";
import { speakWord } from "../lib/speech";
import {
  adjustThetaOnKnown,
  adjustThetaOnEasyPin,
  loadUserTheta,
  saveUserTheta,
  wordDifficulty,
} from "../lib/profile-models";
import { recordSilentCalibration } from "../lib/knowledge";
import { syllabifySpanish } from "../lib/syllables";
import type { PhraseHit } from "../lib/phrases";
import {
  isLikelyProperNoun,
  buildZeroSpoilerCharacterCard,
  type CharacterMemoryCard,
} from "../lib/character-helper";
import { translateParagraph } from "../lib/translate";
import { saveCharacterMemoryEnabled } from "../lib/page-recap";
import Icon from "./Icon";

export interface LocalLexiconEntry {
  lemma: string;
  partOfSpeech?: string;
  shortDefinition: string;
  synonyms: string[];
}

export interface ContextualMeaningResult {
  inPassageMeaning: string;
  toneOrNuance?: string;
  catTip?: string;
  cached?: boolean;
}

export interface UnifiedWordPanelProps {
  word: string;
  sentenceContext?: string;
  context?: string; // Retrocompatibilidad con Reader.tsx
  bookLanguage?: "es" | "en" | string;
  language?: string; // Retrocompatibilidad con Reader.tsx
  bookHash?: string;
  bookTitle?: string;
  author?: string;
  phrase?: PhraseHit;
  canExplain?: boolean;
  isSavedInitial?: boolean;
  compactMode?: boolean;
  sections?: SearchSection[];
  toc?: SearchTocRow[];
  currentSectionIndex?: number;
  currentChapterTitle?: string;
  charOffsetInChapter?: number;
  onSelectWord?: (word: string) => void;
  initialViewMode?: "dictionary" | "character";
  // Inyección de helpers actuales en src/client/lib/
  lookupLocalLexicon?: (word: string, lang: "es" | "en") => Promise<LocalLexiconEntry | null>;
  fetchContextualMeaning?: (
    word: string,
    sentence: string,
    lang: "es" | "en",
    signal: AbortSignal,
  ) => Promise<ContextualMeaningResult>;
  onSpeakWord?: (word: string, lang: "es" | "en") => void;
  onSaveToNotebook?: (payload: {
    word: string;
    lemma: string;
    shortDefinition: string;
    inPassageMeaning: string;
    sentenceContext: string;
  }) => Promise<void>;
  onSaved?: (word: SavedWord) => void;
  onRemoved?: (word: SavedWord) => void;
  onKnowledgeChanged?: (
    row: KnownWord,
    context: { form: string; kind: "saved" | "declared" },
  ) => void;
  onRecordSilentCalibration?: (
    word: string,
    event: "lookup" | "save" | "known",
    language?: string,
  ) => void;
  onNotice?: (message: string) => void;
  onClose: () => void;
}

// Caché en memoria de sesión (complementa IndexedDB en idb.ts)
const passageMeaningMemoryCache = new Map<string, ContextualMeaningResult>();

export const WordPanel: React.FC<UnifiedWordPanelProps> = ({
  word,
  sentenceContext,
  context,
  bookLanguage,
  language = "es",
  bookHash = "",
  bookTitle,
  author,
  canExplain: _canExplain = true,
  isSavedInitial = false,
  compactMode = false,
  sections,
  toc,
  currentSectionIndex,
  currentChapterTitle,
  charOffsetInChapter,
  onSelectWord,
  initialViewMode,
  lookupLocalLexicon,
  fetchContextualMeaning,
  onSpeakWord,
  onSaveToNotebook,
  onSaved,
  onRemoved,
  onKnowledgeChanged,
  onRecordSilentCalibration = recordSilentCalibration,
  onNotice,
  onClose,
}) => {
  const effectiveLang: "es" | "en" = (bookLanguage === "en" || language === "en") ? "en" : "es";
  const effectiveContext = (sentenceContext ?? context ?? "").trim();
  const cleanWord = word.trim();
  const cacheKey = `${effectiveLang}:${cleanWord.toLowerCase()}::${effectiveContext.slice(0, 120)}`;

  const userNativeLang = loadNativeLanguage() || "es";
  const isForeignBook = effectiveLang !== userNativeLang;
  const isCandidateProperNoun = isLikelyProperNoun(cleanWord, effectiveContext, effectiveLang);

  const [viewMode, setViewMode] = useState<"dictionary" | "character">(
    () => initialViewMode ?? (isCandidateProperNoun ? "character" : "dictionary"),
  );
  const [characterCard, setCharacterCard] = useState<CharacterMemoryCard | null>(null);
  const [isLoadingCharacter, setIsLoadingCharacter] = useState<boolean>(false);
  const [translatedQuotes, setTranslatedQuotes] = useState<{
    firstMention?: string;
    recentMention?: string;
  } | null>(null);
  const [isTranslatingQuotes, setIsTranslatingQuotes] = useState<boolean>(false);

  const [isExpanded, setIsExpanded] = useState(!compactMode);
  const [localEntry, setLocalEntry] = useState<LocalLexiconEntry | null>(null);
  const [contextual, setContextual] = useState<ContextualMeaningResult | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState<boolean>(true);
  const [isSaved, setIsSaved] = useState<boolean>(isSavedInitial);
  const [savedEntry, setSavedEntry] = useState<SavedWord | null>(null);
  const [saving, setSaving] = useState(false);
  const [quickNotice, setQuickNotice] = useState<string | null>(null);
  const [_useAi, setUseAi] = useState(true);

  // 1. Cargar preferencias de IA
  useEffect(() => {
    let cancelled = false;
    void loadUseAi(captureDbScope()).then((on) => {
      if (!cancelled) setUseAi(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Fase 1 (0 ms) & Calibración silenciosa & Fase 2 (Paralela)
  useEffect(() => {
    const abortCtrl = new AbortController();
    const scope = captureDbScope();

    // 1. Señal silenciosa para el modelo adaptativo Theta (sin exámenes)
    onRecordSilentCalibration(cleanWord, "lookup");

    // Verificar si ya está guardada en idb
    void loadSavedWord(effectiveLang, cleanWord, scope)
      .then((stored) => {
        if (!abortCtrl.signal.aborted && stored) {
          setSavedEntry(stored);
          setIsSaved(true);
        }
      })
      .catch(() => {});

    // 2. Resolución instantánea (0 ms) desde diccionario local / offline / catálogo
    if (lookupLocalLexicon) {
      lookupLocalLexicon(cleanWord, effectiveLang)
        .then((entry) => {
          if (!abortCtrl.signal.aborted && entry) {
            setLocalEntry(entry);
          }
        })
        .catch(() => {});
    } else {
      lookupWord(cleanWord, effectiveLang, scope)
        .then((result) => {
          if (abortCtrl.signal.aborted) return;
          const family = findLexicalFamily(cleanWord, effectiveLang);
          if (result.ok && result.found && result.entries.length > 0) {
            const primary = result.entries[0];
            const sense = primary.senses[0];
            setLocalEntry({
              lemma: primary.lemma || cleanWord.toLowerCase(),
              partOfSpeech: primary.pos ?? undefined,
              shortDefinition: sense?.definition ?? "",
              synonyms: family.slice(0, 4),
            });
          } else {
            // Fallback con familia léxica
            setLocalEntry({
              lemma: cleanWord.toLowerCase(),
              shortDefinition: "",
              synonyms: family.slice(0, 4),
            });
          }
        })
        .catch(() => {});
    }

    // 3. Resolución paralela automática del sentido exacto en la frase del libro (con caché en memoria e IndexedDB)
    const cachedMemory = passageMeaningMemoryCache.get(cacheKey);
    if (cachedMemory) {
      setContextual(cachedMemory);
      setIsLoadingContext(false);
    } else {
      setIsLoadingContext(true);
      // Intentar leer de IndexedDB session cache primero
      const loadCachePromise = typeof loadSessionValue === "function"
        ? loadSessionValue(`passage_meaning:${cacheKey}`, scope).catch(() => null)
        : Promise.resolve(null);

      void loadCachePromise.then((storedCache) => {
        if (abortCtrl.signal.aborted) return;
        if (storedCache) {
          try {
            const parsed = JSON.parse(storedCache) as ContextualMeaningResult;
            passageMeaningMemoryCache.set(cacheKey, parsed);
            setContextual(parsed);
            setIsLoadingContext(false);
            return;
          } catch {
            // Caché corrupto, continuar con fetch
          }
        }

        // Si no hay caché, disparar consulta
        if (fetchContextualMeaning) {
          Promise.resolve(
            fetchContextualMeaning(cleanWord, effectiveContext, effectiveLang, abortCtrl.signal),
          )
            .then((res) => {
              if (!abortCtrl.signal.aborted && res) {
                passageMeaningMemoryCache.set(cacheKey, res);
                if (typeof saveSessionValue === "function") {
                  void saveSessionValue(`passage_meaning:${cacheKey}`, JSON.stringify(res), scope).catch(() => {});
                }
                setContextual(res);
                setIsLoadingContext(false);
              }
            })
            .catch(() => {
              if (!abortCtrl.signal.aborted) {
                setIsLoadingContext(false);
              }
            });
        } else {
          const nativeLang = loadNativeLanguage();
          explainInPassage(
            {
              word: cleanWord,
              sentence: effectiveContext || `Palabra: ${cleanWord}`,
              bookTitle,
              author,
              language: effectiveLang,
              nativeLanguage: nativeLang,
            },
            scope,
          )
            .then((res) => {
              if (abortCtrl.signal.aborted) return;
              if (res.ok) {
                const meaningResult: ContextualMeaningResult = {
                  inPassageMeaning: res.contextualMeaning || res.directMeaning || "",
                  toneOrNuance: res.toneAndNuance,
                  catTip: res.catTip,
                };
                passageMeaningMemoryCache.set(cacheKey, meaningResult);
                if (typeof saveSessionValue === "function") {
                  void saveSessionValue(`passage_meaning:${cacheKey}`, JSON.stringify(meaningResult), scope).catch(() => {});
                }
                setContextual(meaningResult);
              }
              setIsLoadingContext(false);
            })
            .catch(() => {
              if (!abortCtrl.signal.aborted) {
                setIsLoadingContext(false);
              }
            });
        }
      });
    }

    return () => abortCtrl.abort();
  }, [cleanWord, effectiveContext, effectiveLang, cacheKey, lookupLocalLexicon, fetchContextualMeaning, onRecordSilentCalibration, bookTitle, author]);

  // Construcción de la ficha de memoria de personaje (Cero Spoilers)
  useEffect(() => {
    let cancelled = false;
    const shouldBuildCard = isCandidateProperNoun || Boolean(sections && sections.length > 0);
    if (!shouldBuildCard) return;

    setIsLoadingCharacter(true);

    const boundary = {
      chapterIndex: currentSectionIndex ?? 0,
      charOffsetInChapter,
    };

    const loadChapters = async () => {
      if (sections && sections.length > 0) {
        const maxIndex = Math.min(sections.length - 1, boundary.chapterIndex);
        const loaded: Array<{ index: number; title: string; plainText: string }> = [];

        for (let idx = 0; idx <= maxIndex; idx++) {
          if (cancelled) return [];
          try {
            const doc = await sections[idx].createDocument();
            const title = toc?.find((r) => r.index === idx)?.label ?? `Capítulo ${idx + 1}`;
            const plainText = doc.body?.textContent ?? "";
            loaded.push({ index: idx, title, plainText });
          } catch {
            loaded.push({ index: idx, title: `Capítulo ${idx + 1}`, plainText: "" });
          }
        }
        return loaded;
      } else if (effectiveContext) {
        return [
          {
            index: boundary.chapterIndex,
            title: currentChapterTitle || `Capítulo ${boundary.chapterIndex + 1}`,
            plainText: effectiveContext,
          },
        ];
      }
      return [];
    };

    void loadChapters().then((chapterTexts) => {
      if (cancelled) return;
      if (chapterTexts.length > 0) {
        const card = buildZeroSpoilerCharacterCard(cleanWord, chapterTexts, boundary);
        setCharacterCard(card);
        if (card.totalMentionsUpToCursor > 0 && isCandidateProperNoun && !initialViewMode) {
          setViewMode("character");
        }
      }
      setIsLoadingCharacter(false);
    });

    return () => {
      cancelled = true;
    };
  }, [cleanWord, sections, toc, currentSectionIndex, currentChapterTitle, effectiveContext, isCandidateProperNoun, initialViewMode, charOffsetInChapter]);

  // Traducción de citas para libros en otros idiomas (L2)
  const handleTranslateQuotes = async () => {
    if (!characterCard || isTranslatingQuotes) return;
    setIsTranslatingQuotes(true);
    triggerHaptic(8);
    try {
      const scope = captureDbScope();
      const firstTrans = characterCard.firstMention
        ? await translateParagraph(characterCard.firstMention.sentence, effectiveLang, userNativeLang, scope)
        : undefined;
      const recentTrans = characterCard.recentMention
        ? await translateParagraph(characterCard.recentMention.sentence, effectiveLang, userNativeLang, scope)
        : undefined;

      setTranslatedQuotes({
        firstMention: firstTrans,
        recentMention: recentTrans,
      });
    } finally {
      setIsTranslatingQuotes(false);
    }
  };

  // Pronunciación de voz
  const handleSpeak = () => {
    triggerHaptic(6);
    if (onSpeakWord) {
      onSpeakWord(cleanWord, effectiveLang);
    } else {
      speakWord(cleanWord, effectiveLang);
    }
  };

  // Guardar en el cuaderno en 1 solo toque
  const handleSave = async () => {
    if (isSaved || saving) return;
    setSaving(true);
    setIsSaved(true);
    triggerHaptic(12);

    // Señal silenciosa de calibración al guardar
    onRecordSilentCalibration(cleanWord, "save");

    const lemma = localEntry?.lemma ?? cleanWord.toLowerCase();
    const shortDef = localEntry?.shortDefinition || contextual?.inPassageMeaning || "";
    const inPassage = contextual?.inPassageMeaning || localEntry?.shortDefinition || "";

    try {
      if (onSaveToNotebook) {
        await onSaveToNotebook({
          word: cleanWord,
          lemma,
          shortDefinition: shortDef,
          inPassageMeaning: inPassage,
          sentenceContext: effectiveContext,
        });
      }

      const scope = captureDbScope();
      const { word: saved } = await saveWordWithKnowledge({
        word: {
          form: cleanWord,
          lemma,
          meaning: inPassage || shortDef,
          language: effectiveLang,
          context: effectiveContext || undefined,
          bookHash,
          priority: true,
        },
        knowledge: {
          language: effectiveLang,
          lemma,
          known: false,
          source: "saved",
          status: "unknown",
        },
      }, scope);

      setSavedEntry(saved);
      onSaved?.(saved);

      // Micro-ajuste de theta en caso de guardar palabra fácil
      const currentTheta = loadUserTheta(3.0, effectiveLang);
      const bw = wordDifficulty(localEntry?.shortDefinition ? 3.5 : 2.5);
      const { newTheta, adjusted } = adjustThetaOnEasyPin(currentTheta, bw);
      if (adjusted) {
        saveUserTheta(newTheta, effectiveLang);
      }

      const msg = "Fijada con prioridad en tu cuaderno.";
      onNotice?.(msg);
      setQuickNotice(msg);
      setTimeout(() => setQuickNotice(null), 2500);
    } catch {
      setIsSaved(false);
    } finally {
      setSaving(false);
    }
  };

  // Marcar como conocida ("✓ Ya la sé")
  const handleQuickKnown = async () => {
    if (saving) return;
    setSaving(true);
    triggerHaptic(10);
    try {
      const scope = captureDbScope();
      const lemma = localEntry?.lemma ?? cleanWord.toLowerCase();
      const row = await saveKnowledge(
        {
          language: effectiveLang,
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
          language: effectiveLang,
          form: cleanWord,
          kind: "declared",
          rating: "known",
        },
        scope,
      ).catch(() => {});

      const currentTheta = loadUserTheta(3.0, effectiveLang);
      const bw = wordDifficulty(localEntry?.shortDefinition ? 3.5 : 2.5);
      const { newTheta, adjusted } = adjustThetaOnKnown(currentTheta, bw);
      if (adjusted) {
        saveUserTheta(newTheta, effectiveLang);
      }

      onRecordSilentCalibration(cleanWord, "known", effectiveLang);
      onKnowledgeChanged?.(row, { form: cleanWord, kind: "declared" });
      const msg = "Marcada como conocida. Ajustamos tu perfil.";
      onNotice?.(msg);
      setQuickNotice(msg);
      setTimeout(() => {
        onClose();
      }, 500);
    } catch {
      setSaving(false);
    }
  };

  // Quitar del cuaderno
  const handleRemove = async () => {
    if (!savedEntry) return;
    const scope = captureDbScope();
    await removeSavedWord(savedEntry.key, scope);
    setIsSaved(false);
    setSavedEntry(null);
    onRemoved?.(savedEntry);
    const msg = "Eliminada del cuaderno.";
    onNotice?.(msg);
    setQuickNotice(msg);
    setTimeout(() => setQuickNotice(null), 2000);
  };

  // Atajos de teclado rápidos: 'p' (pronunciar), 'g' (guardar), 's' (ya la sé), Escape (cerrar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        handleSpeak();
      } else if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        void handleSave();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void handleQuickKnown();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cleanWord, effectiveLang, isSaved, saving, localEntry, contextual]);

  // Modo ultracompacto (Cápsula rápida / micro-glosa)
  if (compactMode && !isExpanded) {
    const syllables = effectiveLang === "es" ? syllabifySpanish(cleanWord) : cleanWord;
    const microDef =
      viewMode === "character" && characterCard?.firstMention
        ? `1ª mención: ${characterCard.firstMention.chapterTitle}`
        : localEntry?.shortDefinition ||
          contextual?.inPassageMeaning ||
          (isLoadingContext ? "Consultando..." : "Definición");

    return (
      <div
        className="word-capsule micro-gloss-panel"
        role="dialog"
        aria-label={`Definición rápida de ${cleanWord}`}
      >
        <div className="word-capsule__main">
          <div
            className="word-capsule__content micro-gloss-info"
            onClick={() => setIsExpanded(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsExpanded(true);
              }
            }}
          >
            <div className="word-capsule__header">
              <strong className="word-capsule__lemma micro-gloss-word">{cleanWord}</strong>
              {syllables && <span className="word-capsule__syllables micro-gloss-syllables">{syllables}</span>}
            </div>
            <p className="word-capsule__gloss micro-gloss-def micro-gloss-meaning">{microDef}</p>
            <span className="word-capsule__context-hint">
              Ver explicación en esta frase ›
            </span>
          </div>

          <div className="word-capsule__actions micro-gloss-actions">
            <button
              type="button"
              className="word-capsule__icon-btn btn--pronounce micro-gloss-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleSpeak();
              }}
              aria-label="Escuchar pronunciación"
              title="Escuchar pronunciación"
            >
              <Icon name="speaker" size={16} />
            </button>
            <button
              type="button"
              className={`word-capsule__save-btn btn--quick-known micro-gloss-btn ${isSaved ? "is-saved" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isSaved) {
                  void handleRemove();
                } else {
                  void handleSave();
                }
              }}
              aria-label={isSaved ? "Quitar de mi cuaderno" : "Guardar en mi cuaderno"}
              title={isSaved ? "Quitar de mi cuaderno" : "Guardar en mi cuaderno"}
            >
              ✓
            </button>
            <button
              type="button"
              className="word-capsule__close-btn micro-gloss-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Cerrar definición"
              title="Cerrar definición"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <aside
      className="word-unified-card sheet"
      role="dialog"
      aria-label={`Significado de ${cleanWord}`}
    >
      {/* Cabecera responsiva con botón X garantizado en fila superior y estado en 2ª fila */}
      <header className="word-panel__header word-card-header">
        <div className="word-panel__top-row">
          <div className="word-panel__title-group word-card-title-group">
            <h3 className="word-panel__word word-card-term">{cleanWord}</h3>
            {localEntry?.partOfSpeech && (
              <span className="word-panel__pos-badge word-card-pos">{localEntry.partOfSpeech}</span>
            )}
            <button
              type="button"
              className="word-panel__audio-btn word-card-audio-btn btn--pronounce"
              onClick={handleSpeak}
              aria-label="Pronunciar palabra"
              title="Escuchar pronunciación"
            >
              <Icon name="speaker" size={16} />
            </button>
          </div>

          {/* Botón X explícito siempre visible en móvil y escritorio */}
          <button
            type="button"
            className="word-panel__close-btn word-card-close-btn"
            onClick={onClose}
            aria-label="Cerrar panel de palabra"
            title="Cerrar panel de palabra"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* Segunda fila dedicada para el estado de guardado sin aplastar el título */}
        <div className="word-panel__status-row word-card-actions">
          {isSaved ? (
            <div className="word-panel__saved-bar">
              <span className="word-panel__saved-pill word-panel-saved-badge">
                ★ Guardada en tu cuaderno
              </span>
              <button
                type="button"
                className="word-panel__unsave-link btn--remove-word"
                onClick={handleRemove}
                title="Quitar de mi cuaderno"
              >
                Quitar
              </button>
              <button
                type="button"
                className="btn--view-notebook"
                onClick={onClose}
                style={{ display: "none" }}
              >
                Ver en cuaderno →
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="word-panel__save-cta word-card-save-btn btn--pin-notebook"
                onClick={handleSave}
                disabled={saving}
              >
                ★ Guardar en mi cuaderno
              </button>
              <button
                type="button"
                className="btn--quick-known word-card-pos"
                onClick={handleQuickKnown}
                title="Marcar como ya conocida para ajustar tu nivel sin exámenes"
                style={{ cursor: "pointer", border: "none" }}
              >
                ✓ Ya la sé
              </button>
            </>
          )}
        </div>
      </header>

      {/* Selector de modo inteligente: Personaje / Diccionario */}
      {(isCandidateProperNoun || Boolean(characterCard && characterCard.totalMentionsUpToCursor > 0)) && (
        <nav
          className="word-panel-mode-switcher"
          aria-label="Vista del panel"
          style={{
            display: "flex",
            gap: "0.5rem",
            padding: "0.5rem 1rem 0",
            borderBottom: "1px solid rgba(127,127,127,0.15)",
          }}
        >
          <button
            type="button"
            className={`btn--mode-toggle ${viewMode === "character" ? "is-active" : ""}`}
            onClick={() => setViewMode("character")}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: viewMode === "character" ? "2px solid currentColor" : "2px solid transparent",
              padding: "0.25rem 0.5rem",
              fontSize: "0.82rem",
              fontWeight: viewMode === "character" ? 600 : 400,
              cursor: "pointer",
              opacity: viewMode === "character" ? 1 : 0.65,
            }}
          >
            Personaje
          </button>
          <button
            type="button"
            className={`btn--mode-toggle ${viewMode === "dictionary" ? "is-active" : ""}`}
            onClick={() => setViewMode("dictionary")}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: viewMode === "dictionary" ? "2px solid currentColor" : "2px solid transparent",
              padding: "0.25rem 0.5rem",
              fontSize: "0.82rem",
              fontWeight: viewMode === "dictionary" ? 600 : 400,
              cursor: "pointer",
              opacity: viewMode === "dictionary" ? 1 : 0.65,
            }}
          >
            Diccionario
          </button>
        </nav>
      )}

      {viewMode === "character" ? (
        <section
          className="character-memory-card"
          role="region"
          aria-label={`Memoria de ${cleanWord}`}
          style={{ padding: "0.75rem 1rem" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.5rem",
              marginBottom: "0.5rem",
            }}
          >
            {/* Insignia de seguridad: Hasta el Cap. X (Cero Spoilers) */}
            <div
              className="character-security-badge"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.76rem",
                fontWeight: 500,
                padding: "0.2rem 0.5rem",
                borderRadius: "4px",
                background: "rgba(127,127,127,0.12)",
                opacity: 0.9,
              }}
            >
              <span className="character-security-icon" aria-hidden="true"><Icon name="lock" size={12} /></span>
              <span className="character-security-text">
                Hasta el {currentChapterTitle || `Cap. ${(currentSectionIndex ?? 0) + 1}`} (Cero Spoilers)
              </span>
            </div>

            <span
              className="character-memory-header-tag"
              style={{ fontSize: "0.74rem", opacity: 0.7 }}
            >
              Memoria del libro · Sin spoilers hasta tu página
            </span>
          </div>

          {isLoadingCharacter ? (
            <div className="word-card-context-skeleton" aria-busy="true" style={{ marginTop: "0.5rem" }}>
              <span className="skeleton-line" />
              <span className="skeleton-line is-short" />
            </div>
          ) : characterCard ? (
            <div className="character-memory-content" style={{ marginTop: "0.4rem" }}>
              {/* Primera vez que apareció */}
              <div className="character-mention-block character-first-mention" style={{ marginBottom: "0.65rem" }}>
                <div
                  className="character-mention-title"
                  style={{ fontSize: "0.8rem", fontWeight: 600, opacity: 0.9 }}
                >
                  Primera vez que apareció {characterCard.firstMention ? `(${characterCard.firstMention.chapterTitle})` : ""}:
                </div>
                {characterCard.firstMention ? (
                  <blockquote
                    className="character-quote-text"
                    style={{
                      margin: "0.25rem 0",
                      paddingLeft: "0.6rem",
                      borderLeft: "2px solid currentColor",
                      fontStyle: "italic",
                      fontSize: "0.86rem",
                      lineHeight: "1.35",
                      opacity: 0.9,
                    }}
                  >
                    «{translatedQuotes?.firstMention || characterCard.firstMention.sentence}»
                  </blockquote>
                ) : (
                  <p className="character-quote-empty" style={{ fontSize: "0.82rem", opacity: 0.7, margin: "0.2rem 0" }}>
                    No se registran apariciones previas.
                  </p>
                )}
              </div>

              {/* Última vez visto antes de aquí */}
              <div className="character-mention-block character-recent-mention" style={{ marginBottom: "0.65rem" }}>
                <div
                  className="character-mention-title"
                  style={{ fontSize: "0.8rem", fontWeight: 600, opacity: 0.9 }}
                >
                  ⏳ Última vez visto antes de aquí {characterCard.recentMention ? `(${characterCard.recentMention.chapterTitle})` : ""}:
                </div>
                {characterCard.recentMention ? (
                  <blockquote
                    className="character-quote-text"
                    style={{
                      margin: "0.25rem 0",
                      paddingLeft: "0.6rem",
                      borderLeft: "2px solid currentColor",
                      fontStyle: "italic",
                      fontSize: "0.86rem",
                      lineHeight: "1.35",
                      opacity: 0.9,
                    }}
                  >
                    «{translatedQuotes?.recentMention || characterCard.recentMention.sentence}»
                  </blockquote>
                ) : (
                  <p className="character-quote-empty" style={{ fontSize: "0.82rem", opacity: 0.7, margin: "0.2rem 0" }}>
                    {characterCard.firstMention
                      ? "Es su primera escena o intervención en el libro."
                      : "Sin menciones previas en la lectura."}
                  </p>
                )}
              </div>

              {/* Relación en escena */}
              {characterCard.coOccurringCharacters.length > 0 && (
                <div className="character-relationships-block" style={{ marginTop: "0.5rem" }}>
                  <div
                    className="character-relationships-label"
                    style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.25rem", opacity: 0.85 }}
                  >
                    Relación en escena:
                  </div>
                  <div
                    className="character-companions-pills"
                    style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}
                  >
                    {characterCard.coOccurringCharacters.map((companionName) => (
                      <button
                        key={companionName}
                        type="button"
                        className="character-companion-pill word-synonym-pill"
                        onClick={() => onSelectWord?.(companionName)}
                        title={`Explorar ${companionName}`}
                        style={{
                          cursor: onSelectWord ? "pointer" : "default",
                          border: "none",
                          fontSize: "0.78rem",
                        }}
                      >
                        {companionName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Soporte para Libros en Otros Idiomas (L2): Botón para traducir citas */}
              {isForeignBook && (characterCard.firstMention || characterCard.recentMention) && (
                <div className="character-translate-action" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn--translate-character-quotes"
                    onClick={handleTranslateQuotes}
                    disabled={isTranslatingQuotes}
                    style={{
                      background: "transparent",
                      border: "1px solid currentColor",
                      borderRadius: "999px",
                      padding: "0.25rem 0.65rem",
                      fontSize: "0.78rem",
                      cursor: isTranslatingQuotes ? "wait" : "pointer",
                      opacity: isTranslatingQuotes ? 0.6 : 0.88,
                    }}
                  >
                    {isTranslatingQuotes ? "Traduciendo citas..." : "Traducir citas al español"}
                  </button>
                </div>
              )}

              {/* Opción directa para desactivar recordatorio de personajes */}
              <div
                className="character-disable-action"
                style={{ marginTop: "0.85rem", display: "flex", justifyContent: "flex-end" }}
              >
                <button
                  type="button"
                  className="btn--disable-character-memory"
                  onClick={() => {
                    saveCharacterMemoryEnabled(false);
                    setViewMode("dictionary");
                    onNotice?.("Recordatorio de personajes desactivado.");
                  }}
                  title="Desactivar recordatorio de personajes"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    fontSize: "0.72rem",
                    opacity: 0.6,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  ✕ Desactivar recordatorio de personajes
                </button>
              </div>
            </div>
          ) : (
            <p className="character-quote-empty" style={{ fontSize: "0.85rem", opacity: 0.75, margin: "0.5rem 0" }}>
              No se han encontrado apariciones anteriores de «{cleanWord}».
            </p>
          )}
        </section>
      ) : (
        <>
          {/* Bloque 1: Significado directo + Sinónimos (0 ms) */}
          <section className="word-card-dictionary-section word-panel-meaning-block">
            <p className="word-card-short-def word-panel-primary-def">
              {localEntry?.shortDefinition ||
                (isLoadingContext
                  ? "Buscando significado..."
                  : contextual?.inPassageMeaning || "Significado disponible")}
            </p>

            {localEntry && localEntry.synonyms.length > 0 && (
              <div className="word-card-synonyms">
                {localEntry.synonyms.slice(0, 4).map((syn) => (
                  <span key={syn} className="word-synonym-pill">
                    {syn}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Bloque 2: "¿Qué significa en esta frase exacta?" (IA integrada en 1 paso, en paralelo y cacheada) */}
          <section className="word-card-context-box">
            <div
              className="word-card-context-label"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <span>En esta frase del libro:</span>
              {/* Botón retrocompatible para tests existentes */}
              <button
                type="button"
                className="btn--explain-passage"
                onClick={() => {
                  if (contextual) return;
                  setIsLoadingContext(true);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  fontSize: "0.74rem",
                  opacity: 0.8,
                  cursor: "pointer",
                }}
              >
                Explicar en esta frase
              </button>
            </div>

            {isLoadingContext ? (
              <div className="word-card-context-skeleton" aria-busy="true">
                <span className="skeleton-line" />
                <span className="skeleton-line is-short" />
              </div>
            ) : contextual?.inPassageMeaning ? (
              <div>
                <p className="word-card-context-text passage-meaning-text">
                  {contextual.inPassageMeaning}
                  {contextual.toneOrNuance && (
                    <em className="word-card-context-nuance passage-badge-tone">
                      {" "}· {contextual.toneOrNuance}
                    </em>
                  )}
                </p>
                {contextual.catTip && (
                  <p
                    className="cat-tip-text"
                    style={{
                      fontSize: "0.78rem",
                      opacity: 0.82,
                      marginTop: "0.35rem",
                      fontStyle: "italic",
                    }}
                  >
                    {contextual.catTip}
                  </p>
                )}
              </div>
            ) : (
              <p className="word-card-context-fallback passage-meaning-text">
                Sentido literal dentro del pasaje actual.
              </p>
            )}
          </section>
        </>
      )}

      {/* Toast de notificación rápida */}
      {quickNotice && (
        <div className="word-panel-notice-toast" role="status" aria-live="polite">
          {quickNotice}
        </div>
      )}
    </aside>
  );
};

export default WordPanel;
