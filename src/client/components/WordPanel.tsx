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
  onSelectWord?: (word: string) => void;
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
  onRecordSilentCalibration?: (word: string, event: "lookup" | "save") => void;
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
    void loadSavedWord(effectiveLang, cleanWord, scope).then((stored) => {
      if (!abortCtrl.signal.aborted && stored) {
        setSavedEntry(stored);
        setIsSaved(true);
      }
    });

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

  // Modo ultracompacto (micro-glosa)
  if (compactMode && !isExpanded) {
    const syllables = effectiveLang === "es" ? syllabifySpanish(cleanWord) : cleanWord;
    const microDef =
      localEntry?.shortDefinition ||
      contextual?.inPassageMeaning ||
      (isLoadingContext ? "Consultando..." : "Definición");

    return (
      <div
        className="micro-gloss-panel"
        role="region"
        aria-label={`Micro-glosa de ${cleanWord}`}
      >
        <div
          className="micro-gloss-info"
          onClick={() => setIsExpanded(true)}
          style={{ cursor: "pointer" }}
        >
          <strong className="micro-gloss-word">{cleanWord}</strong>
          <span className="micro-gloss-syllables">{syllables}</span>
          <span className="micro-gloss-def">{microDef}</span>
        </div>
        <div className="micro-gloss-actions">
          <button
            type="button"
            className="btn--pronounce"
            onClick={handleSpeak}
            aria-label="Escuchar pronunciación"
          >
            🔊
          </button>
          <button
            type="button"
            className="btn--quick-known"
            onClick={handleQuickKnown}
            aria-label="Marcar como conocida"
          >
            ✓
          </button>
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
      {/* Cabecera: Palabra + Pronunciación + Acciones Rápidas en 1 toque */}
      <header className="word-card-header">
        <div className="word-card-title-group">
          <h3 className="word-card-term">{cleanWord}</h3>
          {localEntry?.partOfSpeech && (
            <span className="word-card-pos">{localEntry.partOfSpeech}</span>
          )}
          <button
            type="button"
            className="word-card-audio-btn btn--pronounce"
            onClick={handleSpeak}
            aria-label="Escuchar pronunciación"
            title="Escuchar pronunciación"
          >
            🔊
          </button>
        </div>

        <div className="word-card-actions">
          {!isSaved && (
            <button
              type="button"
              className="btn--quick-known word-card-pos"
              onClick={handleQuickKnown}
              title="Marcar como ya conocida para ajustar tu nivel sin exámenes"
              style={{ cursor: "pointer", border: "none" }}
            >
              ✓ Ya la sé
            </button>
          )}

          <button
            type="button"
            className={`word-card-save-btn btn--pin-notebook ${isSaved ? "is-saved" : ""}`}
            onClick={handleSave}
            disabled={isSaved || saving}
          >
            {isSaved ? "★ Guardada en tu cuaderno" : "★ Guardar en mi cuaderno"}
          </button>

          {isSaved && (
            <>
              <span className="word-panel-saved-badge" style={{ display: "none" }}>
                ★ Guardada en tu cuaderno
              </span>
              <button
                type="button"
                className="btn--remove-word"
                onClick={handleRemove}
                title="Quitar de mi cuaderno"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  fontSize: "0.78rem",
                  cursor: "pointer",
                  opacity: 0.7,
                }}
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
            </>
          )}

          <button
            type="button"
            className="word-card-close-btn"
            onClick={onClose}
            aria-label="Cerrar tarjeta"
          >
            ✕
          </button>
        </div>
      </header>

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
          <span>🐱 En esta frase del libro:</span>
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
            ✨ Explicar en esta frase
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
