import "../styles/reader.css";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  explainInPassage,
  lookupWordInMemory,
  lookupWord,
} from "../lib/lexicon";
import {
  type SearchSection,
  type SearchTocRow,
} from "../lib/book-search";
import { findLexicalFamily } from "../lib/word-meanings";
import { recordBookConsultedWord } from "../lib/book-glossary";
import {
  captureDbScope,
  loadSavedWord,
  loadSessionValue,
  removeSavedWord,
  saveKnowledge,
  saveSessionValue,
  saveWordWithKnowledge,
  wordKey,
  type KnownWord,
  type SavedWord,
} from "../lib/idb";
import { pushKnowledgeToServer, scheduleReadingSyncPush } from "../lib/reading-sync";
import { incrementCollectionPendingCount } from "../lib/sync-state";
import { recordReview } from "../lib/reviews";
import { loadUseAi } from "../lib/ai-pref";
import { loadNativeLanguage } from "../lib/settings";
import { triggerHaptic } from "../lib/haptics";
import { speakWord } from "../lib/speech";
import { betaFromZipf } from "../lib/profile-models";
import { markLevel } from "../lib/word-level";
import {
  applyPreviewKnownSignal,
  calibrationBankZipf,
  recordSilentCalibration,
} from "../lib/knowledge";
import { syllabifySpanish } from "../lib/syllables";
import type { PhraseHit } from "../lib/phrases";
import {
  isLikelyProperNoun,
  isPotentialCharacterToken,
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
  directMeaning?: string;
  inPassageMeaning: string;
  toneOrNuance?: string;
  catTip?: string;
  cached?: boolean;
}

// El significado mostrado arriba del panel: del diccionario o, cuando el
// diccionario no tiene la palabra, del significado directo de la IA.
type WordMeaning = { text: string; source: "dictionary" | "ai" };
type MeaningStatus = "loading" | "ready" | "error" | "unavailable";
// La explicación de la frase sólo sale del reposo cuando el lector la pide.
type PassageStatus = "idle" | "loading" | "ready" | "error";

const normalizeForCompare = (s: string) =>
  s.toLowerCase().replace(/\s+/g, " ").trim();

export interface UnifiedWordPanelProps {
  word: string;
  sentenceContext?: string;
  context?: string; // Retrocompatibilidad con Reader.tsx
  /** Acciones de pasaje que la ficha ofrece en su fila secundaria
      (una palabra conserva Tinta, Reflexión, Postal y Preguntar). */
  passageActions?: {
    /** Presente solo cuando hay un tramo DOM que resaltar (toque real). */
    onHighlight?: (tone: "amber" | "salvia" | "dario") => void;
    onQuoteCard: () => void;
    onAsk: () => void;
    onDeepRead: () => void;
  };
  bookLanguage?: "es" | "en" | string;
  language?: string; // Retrocompatibilidad con Reader.tsx
  bookHash?: string;
  bookTitle?: string;
  author?: string;
  phrase?: PhraseHit;
  canExplain?: boolean;
  isSavedInitial?: boolean;
  compactMode?: boolean;
  /** Nodo de la franja flotante donde montar la cápsula (evita el fixed). */
  capsuleHost?: HTMLElement | null;
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
  passageActions,
  word,
  sentenceContext,
  context,
  bookLanguage,
  language = "es",
  bookHash = "",
  bookTitle,
  author,
  canExplain = true,
  isSavedInitial = false,
  compactMode = false,
  capsuleHost = null,
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
  const canBeCharacter =
    isCandidateProperNoun || isPotentialCharacterToken(cleanWord, effectiveLang);

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
  const [localEntry, setLocalEntry] = useState<LocalLexiconEntry | null>(() => {
    const mem = lookupWordInMemory(cleanWord, effectiveLang);
    if (mem?.ok && mem.found && mem.entries && mem.entries.length > 0) {
      const primary = mem.entries[0];
      const sense = primary.senses[0];
      const family = findLexicalFamily(cleanWord, effectiveLang);
      return {
        lemma: primary.lemma || cleanWord.toLowerCase(),
        partOfSpeech: primary.pos ?? undefined,
        shortDefinition: sense?.definition ?? "",
        synonyms: family.slice(0, 4),
      };
    }
    return null;
  });
  const [meaning, setMeaning] = useState<WordMeaning | null>(() => {
    const def = localEntry?.shortDefinition?.trim();
    return def ? { text: def, source: "dictionary" } : null;
  });
  const [meaningStatus, setMeaningStatus] = useState<MeaningStatus>(
    localEntry?.shortDefinition?.trim() ? "ready" : "loading",
  );
  const [passageState, setPassageState] = useState<PassageStatus>("idle");
  const [passageResult, setPassageResult] = useState<ContextualMeaningResult | null>(null);
  const [passageError, setPassageError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState<boolean>(isSavedInitial);
  const [savedEntry, setSavedEntry] = useState<SavedWord | null>(null);
  const [saving, setSaving] = useState(false);
  const [quickNotice, setQuickNotice] = useState<string | null>(null);
  const [useAi, setUseAi] = useState(true);
  // Aborta la consulta IA en vuelo (significado o frase) al cerrar el panel.
  const passageAbortRef = useRef<AbortController | null>(null);
  // Promesa del guardado en vuelo: quitarla antes de que resuelva ya no
  // cae en el vacío (era el toque perdido de guardar→quitar).
  const saveInFlightRef = useRef<Promise<SavedWord | null> | null>(null);
  // Guardado vigente en RAM para el toggle: la cápsula decide con esto,
  // no con el estado de React, que va un frame por detrás del dedo.
  const savedRef = useRef<boolean>(isSavedInitial);

  // Al cerrar el panel aborta la consulta IA en vuelo (significado o frase).
  useEffect(() => {
    return () => {
      passageAbortRef.current?.abort();
      passageAbortRef.current = null;
    };
  }, []);

  // Consulta IA compartida: el significado (cuando el diccionario no
  // tiene la palabra) y la explicación de la frase usan la misma ruta.
  // `localDefinition` decide la variante en el servidor: con ella el
  // prompt compacto devuelve sólo el matiz; sin ella, el prompt completo
  // devuelve también el significado directo.
  const runPassageFetch = useCallback(
    (opts: {
      lemma?: string;
      localDefinition?: string;
      signal: AbortSignal;
      onResult: (res: ContextualMeaningResult) => void;
      onError: (message?: string) => void;
    }) => {
      const variant = opts.localDefinition ? "compact" : "full";
      const pKey = `passage_meaning:v2:${variant}:${cacheKey}`;
      const scope = captureDbScope();

      const applyResult = (res: ContextualMeaningResult) => {
        passageMeaningMemoryCache.set(pKey, res);
        if (typeof saveSessionValue === "function") {
          void saveSessionValue(pKey, JSON.stringify(res), scope).catch(() => {});
        }
        if (!opts.signal.aborted) opts.onResult(res);
      };

      const cachedMemory = passageMeaningMemoryCache.get(pKey);
      if (cachedMemory) {
        applyResult(cachedMemory);
        return;
      }

      const storedPromise = typeof loadSessionValue === "function"
        ? loadSessionValue(pKey, scope).catch(() => null)
        : Promise.resolve(null);

      void storedPromise.then((stored) => {
        if (opts.signal.aborted) return;
        if (stored) {
          try {
            applyResult(JSON.parse(stored) as ContextualMeaningResult);
            return;
          } catch {
            // Caché corrupto, continuar con fetch
          }
        }

        if (fetchContextualMeaning) {
          Promise.resolve(
            fetchContextualMeaning(cleanWord, effectiveContext, effectiveLang, opts.signal),
          )
            .then((res) => {
              if (res) applyResult(res);
              else opts.onError();
            })
            .catch(() => {
              if (!opts.signal.aborted) opts.onError();
            });
          return;
        }

        const nativeLang = loadNativeLanguage();
        explainInPassage(
          {
            word: cleanWord,
            lemma: opts.lemma,
            localDefinition: opts.localDefinition,
            sentence: effectiveContext || `Palabra: ${cleanWord}`,
            bookTitle,
            author,
            language: effectiveLang,
            nativeLanguage: nativeLang,
          },
          scope,
        )
          .then((res) => {
            if (opts.signal.aborted) return;
            if (res.ok) {
              applyResult({
                directMeaning: res.directMeaning,
                inPassageMeaning: res.contextualMeaning || res.directMeaning || "",
                toneOrNuance: res.toneAndNuance,
                catTip: res.catTip,
              });
            } else {
              opts.onError(res.error);
            }
          })
          .catch(() => {
            if (!opts.signal.aborted) opts.onError();
          });
      });
    },
    [cleanWord, effectiveContext, effectiveLang, cacheKey, bookTitle, author, fetchContextualMeaning],
  );

  // Significado por IA cuando el diccionario no tiene la palabra: la
  // respuesta completa queda guardada para «En esta frase» (no hay una
  // segunda consulta al tocarla).
  const requestAiMeaning = useCallback(
    (lemma?: string) => {
      setMeaningStatus("loading");
      passageAbortRef.current?.abort();
      const ctrl = new AbortController();
      passageAbortRef.current = ctrl;
      runPassageFetch({
        lemma,
        signal: ctrl.signal,
        onResult: (res) => {
          setMeaning({ text: res.directMeaning || res.inPassageMeaning, source: "ai" });
          setMeaningStatus("ready");
          setPassageResult(res);
        },
        onError: () => setMeaningStatus("error"),
      });
    },
    [runPassageFetch],
  );

  // Al tocar «¿Qué significa aquí?»: reutiliza la respuesta si ya llegó
  // (la consulta del significado la trajo) o pide el matiz con el prompt
  // compacto cuando hay definición de diccionario.
  const handleRevealPassage = () => {
    if (passageState === "loading" || passageState === "ready") return;
    if (passageResult) {
      setPassageState("ready");
      return;
    }
    setPassageError(null);
    setPassageState("loading");
    passageAbortRef.current?.abort();
    const ctrl = new AbortController();
    passageAbortRef.current = ctrl;
    const localDef = localEntry?.shortDefinition?.trim() || undefined;
    runPassageFetch({
      lemma: localEntry?.lemma,
      localDefinition: localDef,
      signal: ctrl.signal,
      onResult: (res) => {
        setPassageResult(res);
        setPassageState("ready");
      },
      onError: (message) => {
        setPassageError(message ?? null);
        setPassageState("error");
      },
    });
  };

  // 2. Fase 1 (0 ms) & Calibración silenciosa & Fase 2: diccionario; si
  // la palabra falta, la IA aporta el significado (variante completa).
  useEffect(() => {
    const abortCtrl = new AbortController();
    const scope = captureDbScope();

    // 1. Señal silenciosa para el modelo adaptativo Theta (sin exámenes)
    onRecordSilentCalibration(cleanWord, "lookup");
    if (bookHash) {
      void recordBookConsultedWord(bookHash, cleanWord, scope);
    }

    // Verificar si ya está guardada en idb
    void loadSavedWord(effectiveLang, cleanWord, scope)
      .then((stored) => {
        if (!abortCtrl.signal.aborted && stored) {
          savedRef.current = true;
          setSavedEntry(stored);
          setIsSaved(true);
        }
      })
      .catch(() => {});

    // 2. Resolución instantánea (0 ms) desde diccionario local / offline / catálogo
    const dictPromise: Promise<LocalLexiconEntry | null> = lookupLocalLexicon
      ? Promise.resolve()
          .then(() => lookupLocalLexicon(cleanWord, effectiveLang))
          .catch(() => null)
      : lookupWord(cleanWord, effectiveLang, scope)
          .then((result) => {
            const family = findLexicalFamily(cleanWord, effectiveLang);
            if (result.ok && result.found && result.entries.length > 0) {
              const primary = result.entries[0];
              const sense = primary.senses[0];
              return {
                lemma: primary.lemma || cleanWord.toLowerCase(),
                partOfSpeech: primary.pos ?? undefined,
                shortDefinition: sense?.definition ?? "",
                synonyms: family.slice(0, 4),
              };
            }
            return {
              lemma: cleanWord.toLowerCase(),
              shortDefinition: "",
              synonyms: family.slice(0, 4),
            };
          })
          .catch(() => null);

    // 3. Si el diccionario no trajo definición y hay IA disponible, la
    // misma consulta de «En esta frase» aporta el significado directo.
    void dictPromise.then(async (entry) => {
      if (abortCtrl.signal.aborted) return;
      if (entry) setLocalEntry(entry);
      const aiOn = await loadUseAi(scope).catch(() => true);
      if (abortCtrl.signal.aborted) return;
      setUseAi(aiOn);
      if (entry?.shortDefinition?.trim()) {
        setMeaning({ text: entry.shortDefinition, source: "dictionary" });
        setMeaningStatus("ready");
      } else if (canExplain && aiOn) {
        requestAiMeaning(entry?.lemma);
      } else {
        setMeaningStatus("unavailable");
      }
    });

    return () => abortCtrl.abort();
  }, [cleanWord, effectiveLang, lookupLocalLexicon, onRecordSilentCalibration, bookHash, canExplain, requestAiMeaning]);

  // Construcción de la ficha de memoria de personaje (Cero Spoilers)
  useEffect(() => {
    let cancelled = false;
    const shouldBuildCard = canBeCharacter || initialViewMode === "character";
    if (!shouldBuildCard) return;

    queueMicrotask(() => {
      if (!cancelled) {
        setIsLoadingCharacter(true);
      }
    });

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
        const card = buildZeroSpoilerCharacterCard(cleanWord, chapterTexts, boundary, bookLanguage || language || "es");
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
  }, [cleanWord, sections, toc, currentSectionIndex, currentChapterTitle, effectiveContext, isCandidateProperNoun, canBeCharacter, initialViewMode, charOffsetInChapter, bookLanguage, language]);

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
    if (savedRef.current) return;
    setSaving(true);
    savedRef.current = true;
    setIsSaved(true);
    triggerHaptic(12);

    // Señal silenciosa de calibración al guardar
    onRecordSilentCalibration(cleanWord, "save");

    const lemma = localEntry?.lemma ?? cleanWord.toLowerCase();
    // El cuaderno guarda el significado mostrado (diccionario o IA),
    // nunca el matiz de la frase.
    const shortDef = meaning?.text || "";
    const inPassage = meaning?.text || "";

    const work = (async (): Promise<SavedWord | null> => {
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

        incrementCollectionPendingCount("words");
        scheduleReadingSyncPush("words");


        // En la cápsula el mismo botón quita: el aviso lo dice. En la
        // ficha, el botón guarda y el aviso explica la prioridad.
        const msg = compactMode
          ? "★ Guardada · toca de nuevo para quitar"
          : "Fijada con prioridad en tu cuaderno.";
        onNotice?.(msg);
        setQuickNotice(msg);
        setTimeout(() => setQuickNotice(null), 2500);
        return saved;
      } catch {
        savedRef.current = false;
        setIsSaved(false);
        return null;
      } finally {
        saveInFlightRef.current = null;
        setSaving(false);
      }
    })();

    saveInFlightRef.current = work;
    await work;
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
        { award: false },
      ).catch(() => {});

      // Un solo ajuste por acto: θ sube con la dificultad real de la palabra
      // (4 − zipf), no con un 3,5/2,5 inventado según haya definición corta.
      applyPreviewKnownSignal(
        effectiveLang,
        betaFromZipf(calibrationBankZipf(lemma, effectiveLang)),
      );
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

  // Etapa real de la palabra guardada: el lector la ve al reencontrarla
  // en el texto, no solo dentro del Cuaderno.
  const savedStage =
    savedEntry?.card && (savedEntry.card.reps ?? 0) > 0
      ? markLevel(savedEntry.card) === "learning"
        ? "En práctica"
        : markLevel(savedEntry.card) === "settled"
          ? "Asentada"
          : "Dominada"
      : null;

  // Quitar del cuaderno
  const handleRemove = async () => {
    // Respuesta en el primer frame: el dedo ya vio el cambio antes de
    // que IndexedDB responda.
    savedRef.current = false;
    setIsSaved(false);
    triggerHaptic(8);
    const msg = "Eliminada del cuaderno";
    onNotice?.(msg);
    setQuickNotice(msg);
    setTimeout(() => setQuickNotice(null), 2000);

    // Un guardado en vuelo deja la fila en la base: sin esperarlo, el
    // borrado se adelantaba y la palabra volvía a la cápsula guardada.
    const inFlight = saveInFlightRef.current;
    const pending = inFlight ? await inFlight.catch(() => null) : null;

    const scope = captureDbScope();
    let entry: SavedWord | null = pending ?? savedEntry;
    if (!entry) {
      entry = (await loadSavedWord(effectiveLang, cleanWord, scope).catch(() => undefined)) ?? null;
    }
    const key = entry?.key ?? wordKey(effectiveLang, cleanWord.toLowerCase());
    await removeSavedWord(key, scope).catch(() => undefined);
    setSavedEntry(null);
    if (entry) onRemoved?.(entry);
  };

  const keyboardHandlersRef = useRef({
    handleSpeak,
    handleSave,
    handleQuickKnown,
    onClose,
  });
  useEffect(() => {
    keyboardHandlersRef.current = {
      handleSpeak,
      handleSave,
      handleQuickKnown,
      onClose,
    };
  });

  // Atajos de teclado rápidos: 'p' (pronunciar), 'g' (guardar), 's' (ya la sé), Escape (cerrar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        keyboardHandlersRef.current.handleSpeak();
      } else if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        void keyboardHandlersRef.current.handleSave();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void keyboardHandlersRef.current.handleQuickKnown();
      } else if (e.key === "Escape") {
        e.preventDefault();
        keyboardHandlersRef.current.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Modo ultracompacto (Cápsula rápida / micro-glosa)
  if (compactMode && !isExpanded) {
    const syllables = effectiveLang === "es" ? syllabifySpanish(cleanWord) : cleanWord;
    const microDef =
      viewMode === "character" && characterCard?.firstMention
        ? `1ª mención: ${characterCard.firstMention.chapterTitle}`
        : meaning?.text ||
          (meaningStatus === "loading" ? "Consultando..." : "Definición");

    const capsule = (
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
            {quickNotice ? (
              <span className="word-capsule__notice" role="status">
                {quickNotice}
              </span>
            ) : (
              <span className="word-capsule__context-hint">
                Ver explicación en esta frase ›
              </span>
            )}
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
              aria-pressed={isSaved}
              aria-label={
                isSaved ? "Guardada en tu cuaderno (toca para quitar)" : "Guardar en cuaderno"
              }
              title={isSaved ? "Guardada en tu cuaderno (toca para quitar)" : "Guardar en cuaderno"}
            >
              <span aria-hidden="true">{isSaved ? "★" : "☆"}</span>
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
    return capsuleHost ? createPortal(capsule, capsuleHost) : capsule;
  }

  const aiAllowed = canExplain && useAi;
  const toneLabel =
    passageResult?.toneOrNuance?.trim() &&
    !/^literario$/i.test(passageResult.toneOrNuance.trim())
      ? passageResult.toneOrNuance.trim()
      : null;
  // Regla anti-duplicados: si la explicación de la frase repite el
  // significado ya mostrado, sólo se pinta el tono.
  const passageRepeatsMeaning = Boolean(
    meaning &&
      passageResult &&
      normalizeForCompare(passageResult.inPassageMeaning) ===
        normalizeForCompare(meaning.text),
  );

  // La palabra resaltada dentro de la cita (forma exacta o lema).
  const renderContextQuote = () => {
    const lower = effectiveContext.toLowerCase();
    let idx = lower.indexOf(cleanWord.toLowerCase());
    let len = cleanWord.length;
    if (idx < 0 && localEntry?.lemma) {
      idx = lower.indexOf(localEntry.lemma.toLowerCase());
      len = localEntry.lemma.length;
    }
    if (idx < 0) return <>«{effectiveContext}»</>;
    return (
      <>
        «{effectiveContext.slice(0, idx)}
        <mark>{effectiveContext.slice(idx, idx + len)}</mark>
        {effectiveContext.slice(idx + len)}»
      </>
    );
  };

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
                ★ Guardada en tu cuaderno{savedStage ? ` · ${savedStage}` : ""}
              </span>
              <button
                type="button"
                className="word-panel__unsave-link btn--remove-word"
                onClick={handleRemove}
                title="Quitar de mi cuaderno"
              >
                Quitar
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
        >
          <button
            type="button"
            className={`btn--mode-toggle ${viewMode === "character" ? "is-active" : ""}`}
            onClick={() => setViewMode("character")}
          >
            Personaje
          </button>
          <button
            type="button"
            className={`btn--mode-toggle ${viewMode === "dictionary" ? "is-active" : ""}`}
            onClick={() => setViewMode("dictionary")}
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
        >
          <div className="character-memory-header">
            {/* Insignia de seguridad: Hasta el Cap. X (Cero Spoilers) */}
            <div className="character-security-badge">
              <span className="character-security-icon" aria-hidden="true"><Icon name="lock" size={12} /></span>
              <span className="character-security-text">
                Hasta el {currentChapterTitle || `Cap. ${(currentSectionIndex ?? 0) + 1}`} (Cero Spoilers)
              </span>
            </div>

            <span className="character-memory-header-tag">
              Memoria del libro · Sin spoilers hasta tu página
            </span>
          </div>

          {isLoadingCharacter ? (
            <div className="word-card-context-skeleton" aria-busy="true">
              <span className="skeleton-line" />
              <span className="skeleton-line is-short" />
            </div>
          ) : characterCard ? (
            <div className="character-memory-content">
              {/* Primera vez que apareció */}
              <div className="character-mention-block character-first-mention">
                <div className="character-mention-title">
                  Primera vez que apareció {characterCard.firstMention ? `(${characterCard.firstMention.chapterTitle})` : ""}:
                </div>
                {characterCard.firstMention ? (
                  <blockquote className="character-quote-text">
                    «{translatedQuotes?.firstMention || characterCard.firstMention.sentence}»
                  </blockquote>
                ) : (
                  <p className="character-quote-empty">
                    No se registran apariciones previas.
                  </p>
                )}
              </div>

              {/* Última vez visto antes de aquí */}
              <div className="character-mention-block character-recent-mention">
                <div className="character-mention-title">
                  Última vez visto antes de aquí {characterCard.recentMention ? `(${characterCard.recentMention.chapterTitle})` : ""}:
                </div>
                {characterCard.recentMention ? (
                  <blockquote className="character-quote-text">
                    «{translatedQuotes?.recentMention || characterCard.recentMention.sentence}»
                  </blockquote>
                ) : (
                  <p className="character-quote-empty">
                    {characterCard.firstMention
                      ? "Es su primera escena o intervención en el libro."
                      : "Sin menciones previas en la lectura."}
                  </p>
                )}
              </div>

              {/* Relación en escena */}
              {characterCard.coOccurringCharacters.length > 0 && (
                <div className="character-relationships-block">
                  <div className="character-relationships-label">
                    Relación en escena:
                  </div>
                  <div className="character-companions-pills">
                    {characterCard.coOccurringCharacters.map((companionName) => (
                      <button
                        key={companionName}
                        type="button"
                        className="character-companion-pill word-synonym-pill"
                        onClick={() => onSelectWord?.(companionName)}
                        title={`Explorar ${companionName}`}
                      >
                        {companionName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Soporte para Libros en Otros Idiomas (L2): Botón para traducir citas */}
              {isForeignBook && (characterCard.firstMention || characterCard.recentMention) && (
                <div className="character-translate-action">
                  <button
                    type="button"
                    className="btn--translate-character-quotes"
                    onClick={handleTranslateQuotes}
                    disabled={isTranslatingQuotes}
                  >
                    {isTranslatingQuotes ? "Traduciendo citas..." : "Traducir citas al español"}
                  </button>
                </div>
              )}

              {/* Opción directa para desactivar recordatorio de personajes */}
              <div className="character-disable-action">
                <button
                  type="button"
                  className="btn--disable-character-memory"
                  onClick={() => {
                    saveCharacterMemoryEnabled(false);
                    setViewMode("dictionary");
                    onNotice?.("Recordatorio de personajes desactivado.");
                  }}
                  title="Desactivar recordatorio de personajes"
                >
                  ✕ Desactivar recordatorio de personajes
                </button>
              </div>
            </div>
          ) : (
            <p className="character-quote-empty">
              No se han encontrado apariciones anteriores de «{cleanWord}».
            </p>
          )}
        </section>
      ) : (
        <>
          {/* Bloque 1: qué significa la palabra (diccionario → IA si falta) */}
          <section className="word-card-dictionary-section word-panel-meaning-block">
            <h4 className="word-card-section-title">Significado</h4>
            {meaningStatus === "loading" ? (
              <div className="word-card-context-skeleton" aria-busy="true">
                <span className="skeleton-line" />
                <span className="skeleton-line is-short" />
              </div>
            ) : meaning ? (
              <>
                <p className="word-card-short-def word-panel-primary-def">
                  {meaning.text}
                </p>
                {meaning.source === "ai" ? (
                  <p className="word-card-ai-source">Significado sugerido por IA</p>
                ) : null}
              </>
            ) : !canExplain ? (
              <p className="word-card-context-fallback">
                Esta palabra no está en el diccionario. Inicia sesión para que la
                IA la explique.
              </p>
            ) : meaningStatus === "error" ? (
              <p className="word-card-context-fallback">
                No pudimos consultar esta palabra.{" "}
                <button
                  type="button"
                  className="word-card-retry-link"
                  onClick={() => requestAiMeaning(localEntry?.lemma)}
                >
                  Reintentar
                </button>
              </p>
            ) : (
              <p className="word-card-context-fallback">
                Esta palabra no está en el diccionario.
              </p>
            )}

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

          {/* Bloque 2: la frase del libro; su explicación llega sólo al
              tocarla (la cuota de IA se gasta a petición del lector). */}
          {effectiveContext ? (
            <section className="word-card-context-box">
              <h4 className="word-card-section-title">En esta frase</h4>
              <blockquote className="word-card-context-quote">
                {renderContextQuote()}
              </blockquote>

              {!aiAllowed ? (
                !canExplain ? (
                  <p className="word-card-context-fallback">
                    Inicia sesión para explicar frases con IA.
                  </p>
                ) : null
              ) : passageState === "ready" && passageResult ? (
                <div aria-live="polite">
                  {(!passageRepeatsMeaning || !toneLabel) && (
                    <p className="word-card-context-text passage-meaning-text">
                      {passageResult.inPassageMeaning}
                    </p>
                  )}
                  {toneLabel ? (
                    <p className="word-card-tone">Tono: {toneLabel}</p>
                  ) : null}
                </div>
              ) : (
                <div className="word-card-context-actions">
                  {passageState === "error" ? (
                    <p className="word-card-context-fallback">
                      {passageError ?? "No pudimos explicar esta frase."}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="btn--explain-passage btn--nuance-context"
                    onClick={handleRevealPassage}
                    disabled={passageState === "loading"}
                  >
                    {passageState === "loading"
                      ? "Leyendo la frase…"
                      : passageState === "error"
                        ? "Reintentar"
                        : "¿Qué significa aquí?"}
                  </button>
                </div>
              )}
            </section>
          ) : null}
        </>
      )}

      {/* Fila secundaria: las acciones de pasaje no se pierden con una
          sola palabra — Tinta, Reflexión, Postal y Preguntar entran en
          la ficha. Cada acción cierra la ficha (la hace el lector en
          Reader.tsx al cablear los callbacks). */}
      {passageActions ? (
        <div
          className="word-card-passage-actions"
          role="group"
          aria-label="Acciones de pasaje"
        >
          {passageActions.onHighlight ? (
            <div
              className="selection-highlight-group"
              role="group"
              aria-label="Resaltar con tinta"
            >
              <button
                type="button"
                className="selection-menu-btn selection-save"
                aria-label="Resaltar con tinta"
                onClick={() => passageActions.onHighlight?.("amber")}
              >
                <Icon name="highlight" size={14} />
                <span>Tinta</span>
              </button>
              <div
                className="selection-tones-picker"
                aria-label="Elegir tono de tinta"
              >
                <button
                  type="button"
                  className="tone-dot tone-dot--amber"
                  aria-label="Tinta Ámbar"
                  onClick={() => passageActions.onHighlight?.("amber")}
                />
                <button
                  type="button"
                  className="tone-dot tone-dot--salvia"
                  aria-label="Tinta Salvia"
                  onClick={() => passageActions.onHighlight?.("salvia")}
                />
                <button
                  type="button"
                  className="tone-dot tone-dot--dario"
                  aria-label="Tinta Azul Darío"
                  onClick={() => passageActions.onHighlight?.("dario")}
                />
              </div>
            </div>
          ) : null}
          <button
            type="button"
            className="selection-menu-btn"
            onClick={passageActions.onDeepRead}
          >
            <Icon name="retreat" size={14} />
            <span>Reflexión</span>
          </button>
          <button
            type="button"
            className="selection-menu-btn"
            onClick={passageActions.onQuoteCard}
          >
            <Icon name="quote" size={14} />
            <span>Postal</span>
          </button>
          <button
            type="button"
            className="selection-menu-btn selection-ask-cat"
            onClick={passageActions.onAsk}
          >
            <Icon name="sparkles" size={14} />
            <span>Preguntar</span>
          </button>
        </div>
      ) : null}

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
