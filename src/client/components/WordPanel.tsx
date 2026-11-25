import "../styles/reader.css";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { memo } from "react";
import {
  enrichWord,
  explainInPassage,
  lookupWordInMemory,
  lookupWord,
  reportShownSense,
} from "../lib/lexicon";
import {
  type SearchSection,
  type SearchTocRow,
} from "../lib/book-search";
import { findLexicalFamily } from "../lib/word-meanings";
import { lookupDictionaryPack } from "../lib/dictionaryPack";
import { recordBookConsultedWord } from "../lib/book-glossary";
import {
  captureDbScope,
  fillSavedWordMeaning,
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
import { recordLookupLapse, recordReview } from "../lib/reviews";
import { loadUseAi } from "../lib/ai-pref";
import { loadNativeLanguage } from "../lib/settings";
import { setFreeAiRemaining } from "../lib/account-plan";
import { triggerHaptic } from "../lib/haptics";
import { speakWord } from "../lib/speech";
import { betaFromZipf } from "../lib/profile-models";
import { markLevel } from "../lib/word-level";
import {
  applyPreviewKnownSignal,
  calibrationBankZipf,
  recordSilentCalibration,
} from "../lib/knowledge";
import type { PhraseHit } from "../lib/phrases";
import {
  isLikelyProperNoun,
  isPotentialCharacterToken,
  buildZeroSpoilerCharacterCard,
  type CharacterMemoryCard,
} from "../lib/character-helper";
import { translateParagraphResult } from "../lib/translate";
import { saveCharacterMemoryEnabled } from "../lib/page-recap";
import Icon from "./Icon";
import PlanNote from "./PlanNote";

export interface LocalLexiconEntry {
  lemma: string;
  partOfSpeech?: string;
  shortDefinition: string;
  synonyms: string[];
  ipa?: string;
  /** Hasta 3 definiciones (la primera es el significado principal). */
  senses?: string[];
  /** Paralelo a `senses`: ejemplo e ids del servidor (si los hay) de cada acepción. */
  senseDetails?: SenseDetail[];
}

export interface SenseDetail {
  definition: string;
  example: string | null;
  entryId: string | null;
  senseOrder: number | null;
}

export interface ContextualMeaningResult {
  directMeaning?: string;
  inPassageMeaning: string;
  toneOrNuance?: string;
  catTip?: string;
  cached?: boolean;
}

type WordMeaning = { text: string; source: "dictionary" | "ai" };
type MeaningStatus = "loading" | "ready" | "error" | "unavailable";
type PassageStatus = "idle" | "loading" | "ready" | "error";

// Niveles de disclosure progresivo
type DisclosureLevel = 1 | 2 | 3;

const senseDefinitions = (senses: ReadonlyArray<{ definition?: string | null }>): string[] =>
  senses
    .map((x) => x.definition?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 3);

const senseDetailsOf = (
  entryId: string | null | undefined,
  senses: ReadonlyArray<{ definition?: string | null; example?: string | null; senseOrder?: number | null }>,
): SenseDetail[] =>
  senses
    .filter((x) => x.definition?.trim())
    .slice(0, 3)
    .map((x) => ({
      definition: x.definition!.trim(),
      example: x.example?.trim() || null,
      entryId: entryId ? String(entryId) : null,
      senseOrder: x.senseOrder ?? null,
    }));

const NATIVE_LABELS: Record<string, string> = { es: "al español", en: "al inglés" };

const normalizeForCompare = (s: string) =>
  s.toLowerCase().replace(/\s+/g, " ").trim();

export interface UnifiedWordPanelProps {
  word: string;
  sentenceContext?: string;
  context?: string;
  passageActions?: {
    onHighlight?: (tone: "amber" | "salvia" | "dario") => void;
    onQuoteCard: () => void;
    onAsk: () => void;
    onDeepRead: () => void;
  };
  bookLanguage?: "es" | "en" | string;
  language?: string;
  bookHash?: string;
  bookTitle?: string;
  author?: string;
  phrase?: PhraseHit;
  canExplain?: boolean;
  /** Cuenta free: la IA en contexto es de Lecta+ y se muestra PlanNote. */
  planLocked?: boolean;
  /** Usos de IA de cortesía restantes de hoy (solo cuentas free). */
  freeAiRemaining?: number;
  isSavedInitial?: boolean;
  sections?: SearchSection[];
  toc?: SearchTocRow[];
  currentSectionIndex?: number;
  currentChapterTitle?: string;
  charOffsetInChapter?: number;
  onSelectWord?: (word: string) => void;
  initialViewMode?: "dictionary" | "character";
  lookupLocalLexicon?: (word: string, lang: "es" | "en") => Promise<LocalLexiconEntry | null>;
  fetchContextualMeaning?: (
    word: string,
    sentence: string,
    lang: "es" | "en",
    signal: AbortSignal,
  ) => Promise<ContextualMeaningResult>;
  onSpeakWord?: (word: string, lang: "es" | "en", rate?: number) => void;
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
    zipf?: number | null,
  ) => void;
  /** Zipf medido de la palabra en el texto (análisis del capítulo), si lo hay. */
  zipfFor?: (word: string) => number | null;
  onNotice?: (message: string) => void;
  onClose: () => void;
}

const passageMeaningMemoryCache = new Map<string, ContextualMeaningResult>();

const WordPanelImpl: React.FC<UnifiedWordPanelProps> = ({
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
  planLocked = false,
  freeAiRemaining,
  isSavedInitial = false,
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
  zipfFor,
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
    () => initialViewMode ?? "dictionary",
  );
  const [characterCard, setCharacterCard] = useState<CharacterMemoryCard | null>(null);
  const [isLoadingCharacter, setIsLoadingCharacter] = useState<boolean>(false);
  const [translatedQuotes, setTranslatedQuotes] = useState<{
    firstMention?: string;
    recentMention?: string;
  } | null>(null);
  const [isTranslatingQuotes, setIsTranslatingQuotes] = useState<boolean>(false);
  // 402 al traducir citas: la vista de personaje pinta PlanNote.
  const [quotesPlanShown, setQuotesPlanShown] = useState(false);

  // NUEVO: Nivel de disclosure progresivo (1 = significado + guardar, 2 = matiz + tono, 3 = todo)
  const [disclosureLevel, setDisclosureLevel] = useState<DisclosureLevel>(1);
  const [reportState, setReportState] = useState<"idle" | "sending" | "done">("idle");
  const [reportNote, setReportNote] = useState<string | null>(null);
  const [localEntry, setLocalEntry] = useState<LocalLexiconEntry | null>(() => {
    const mem = lookupWordInMemory(cleanWord, effectiveLang);
    if (mem?.ok && mem.found && mem.entries && mem.entries.length > 0) {
      const primary = mem.entries[0];
      const sense = primary.senses[0];
      // La familia léxica llega validada contra el pack por la ruta async:
      // pintarla sin validar mostraba formas inventadas.
      return {
        lemma: primary.lemma || cleanWord.toLowerCase(),
        partOfSpeech: primary.pos ?? undefined,
        shortDefinition: sense?.definition ?? "",
        synonyms: [],
        ipa: primary.ipa ?? undefined,
        senses: senseDefinitions(primary.senses),
        senseDetails: senseDetailsOf(primary.entryId, primary.senses),
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
  const [passageError, setPassageError] = useState<string | null>(null); // Used in error display
  // 402 de Lecta+ (o cuenta free): la ficha pinta PlanNote en vez de la IA.
  const [planNoteShown, setPlanNoteShown] = useState(false);
  const [isSaved, setIsSaved] = useState<boolean>(isSavedInitial);
  // Brote: solo al guardar aquí, no al abrir una palabra ya guardada.
  const [sprouted, setSprouted] = useState(false);
  const [savedEntry, setSavedEntry] = useState<SavedWord | null>(null);
  const [saving, setSaving] = useState(false);
  const [quickNotice, setQuickNotice] = useState<string | null>(null);
  const [useAi, setUseAi] = useState(true);
  const passageAbortRef = useRef<AbortController | null>(null);
  const saveInFlightRef = useRef<Promise<SavedWord | null> | null>(null);
  const savedRef = useRef<boolean>(isSavedInitial);
  const pressConsumedRef = useRef<boolean>(false);
  const longPressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      passageAbortRef.current?.abort();
      passageAbortRef.current = null;
    };
  }, []);

  const runPassageFetch = useCallback(
    (opts: {
      lemma?: string;
      localDefinition?: string;
      signal: AbortSignal;
      onResult: (res: ContextualMeaningResult) => void;
      onError: (message?: string, code?: string) => void;
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
              opts.onError(res.error, res.code);
            }
          })
          .catch(() => {
            if (!opts.signal.aborted) opts.onError();
          });
      });
    },
    [cleanWord, effectiveContext, effectiveLang, cacheKey, bookTitle, author, fetchContextualMeaning],
  );

  // Sin definición local: /api/ai/enrich (gratis para todos), sin pasaje —
  // enviar el contexto podría envenenar el catálogo compartido.
  const requestAiMeaning = useCallback(() => {
    setMeaningStatus("loading");
    passageAbortRef.current?.abort();
    const ctrl = new AbortController();
    passageAbortRef.current = ctrl;
    void enrichWord(cleanWord, effectiveLang, undefined, captureDbScope(), loadNativeLanguage())
      .then((res) => {
        if (ctrl.signal.aborted) return;
        const def = res.ok ? res.entries[0]?.senses?.[0]?.definition?.trim() : "";
        if (def) {
          setMeaning({ text: def, source: "ai" });
          setMeaningStatus("ready");
        } else {
          setMeaningStatus("error");
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setMeaningStatus("error");
      });
  }, [cleanWord, effectiveLang]);

  // NUEVO: Handler para revelar nivel 2 (matiz contextual)
  const handleRevealPassage = () => {
    triggerHaptic(8);
    if (planLocked && freeAiRemaining === 0) {
      setPlanNoteShown(true);
      return;
    }
    if (passageState === "loading" || passageState === "ready") {
      setDisclosureLevel(2);
      return;
    }
    if (passageResult) {
      setPassageState("ready");
      setDisclosureLevel(2);
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
        if (planLocked) setFreeAiRemaining(null);
        setPassageResult(res);
        setPassageState("ready");
        setDisclosureLevel(2);
      },
      onError: (message, code) => {
        if (code) {
          if (planLocked) setFreeAiRemaining(0);
          setPlanNoteShown(true);
          setPassageState("idle");
          return;
        }
        setPassageError(message ?? null);
        setPassageState("error");
      },
    });
  };

  // NUEVO: Handler para expandir a nivel 3 (todo)
  const handleExpandAll = () => {
    triggerHaptic(6);
    setDisclosureLevel(3);
  };

  // La medición cambia de identidad al llegar el análisis del capítulo:
  // vía ref para no relanzar la consulta (ni la señal) por eso.
  const zipfForRef = useRef(zipfFor);
  useEffect(() => {
    zipfForRef.current = zipfFor;
  }, [zipfFor]);

  useEffect(() => {
    const abortCtrl = new AbortController();
    const scope = captureDbScope();

    onRecordSilentCalibration(cleanWord, "lookup", effectiveLang, zipfForRef.current?.(cleanWord));
    if (bookHash) {
      void recordBookConsultedWord(bookHash, cleanWord, scope);
    }

    void loadSavedWord(effectiveLang, cleanWord, scope)
      .then(async (stored) => {
        if (abortCtrl.signal.aborted || !stored) return;
        savedRef.current = true;
        setSavedEntry(stored);
        setIsSaved(true);
        // Consultar en el libro una palabra ya repasada = no la recordó.
        if (bookHash) {
          const lapsed = await recordLookupLapse(stored, scope).catch(() => null);
          if (lapsed && !abortCtrl.signal.aborted) setSavedEntry(lapsed);
        }
      })
      .catch(() => {});

    const dictPromise: Promise<LocalLexiconEntry | null> = lookupLocalLexicon
      ? Promise.resolve()
          .then(() => lookupLocalLexicon(cleanWord, effectiveLang))
          .catch(() => null)
      : lookupWord(cleanWord, effectiveLang, scope)
          .then(async (result) => {
            const family = findLexicalFamily(cleanWord, effectiveLang);
            // Valida cada candidato contra el paquete de diccionario
            // instalado: solo se pintan lemas reales, no formas inventadas.
            const validated = await Promise.all(
              family.map(async (syn) => {
                try {
                  const e = await lookupDictionaryPack(
                    syn,
                    effectiveLang === "en" ? "en" : "es",
                  );
                  return e ? syn : null;
                } catch {
                  return null;
                }
              }),
            );
            const validFamily = validated.filter(Boolean) as string[];
            if (result.ok && result.found && result.entries.length > 0) {
              const primary = result.entries[0];
              const sense = primary.senses[0];
              return {
                lemma: primary.lemma || cleanWord.toLowerCase(),
                partOfSpeech: primary.pos ?? undefined,
                shortDefinition: sense?.definition ?? "",
                synonyms: validFamily.slice(0, 4),
                ipa: primary.ipa ?? undefined,
                senses: senseDefinitions(primary.senses),
        senseDetails: senseDetailsOf(primary.entryId, primary.senses),
              };
            }
            return {
              lemma: cleanWord.toLowerCase(),
              shortDefinition: "",
              synonyms: validFamily.slice(0, 4),
            };
          })
          .catch(() => null);

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
        requestAiMeaning();
      } else {
        setMeaningStatus("unavailable");
      }
    });

    return () => abortCtrl.abort();
  }, [cleanWord, effectiveLang, lookupLocalLexicon, onRecordSilentCalibration, bookHash, canExplain, requestAiMeaning]);

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
        // Por defecto se abre en el diccionario; la tarjeta de personaje
        // queda disponible mediante el selector manual (no se fuerza).
      }
      setIsLoadingCharacter(false);
    });

    return () => {
      cancelled = true;
    };
  }, [cleanWord, sections, toc, currentSectionIndex, currentChapterTitle, effectiveContext, isCandidateProperNoun, canBeCharacter, initialViewMode, charOffsetInChapter, bookLanguage, language]);

  // Carrera ★ vs IA: si se guardó antes de que llegara el significado, la
  // fila quedó con meaning vacío; se completa con CAS por sello (nunca pisa
  // un repaso ni un significado ya escrito).
  const readyMeaningText = meaningStatus === "ready" ? meaning?.text?.trim() ?? "" : "";
  useEffect(() => {
    if (!readyMeaningText || !savedEntry || savedEntry.meaning?.trim()) return;
    let cancelled = false;
    void (async () => {
      try {
        const inFlight = saveInFlightRef.current;
        if (inFlight) await inFlight.catch(() => null);
        if (cancelled) return;
        const filled = await fillSavedWordMeaning(
          savedEntry.key,
          savedEntry.updatedAt,
          {
            meaning: readyMeaningText,
            lemma: localEntry?.lemma ?? cleanWord.toLowerCase(),
            pos: localEntry?.partOfSpeech ?? undefined,
          },
          captureDbScope(),
        );
        if (!filled || cancelled) return;
        setSavedEntry(filled);
        scheduleReadingSyncPush("words");
      } catch {
        /* el significado queda para el backfill del Cuaderno */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readyMeaningText, savedEntry, localEntry?.lemma, localEntry?.partOfSpeech, cleanWord]);

  const handleTranslateQuotes = async () => {
    if (!characterCard || isTranslatingQuotes) return;
    setIsTranslatingQuotes(true);
    triggerHaptic(8);
    try {
      const scope = captureDbScope();
      const [firstTrans, recentTrans] = await Promise.all([
        characterCard.firstMention
          ? translateParagraphResult(characterCard.firstMention.sentence, effectiveLang, userNativeLang, scope)
          : undefined,
        characterCard.recentMention
          ? translateParagraphResult(characterCard.recentMention.sentence, effectiveLang, userNativeLang, scope)
          : undefined,
      ]);
      const results = [firstTrans, recentTrans];
      if (results.some((r) => r && !r.ok && r.reason === "plan")) {
        setQuotesPlanShown(true);
      } else if (results.some((r) => r && !r.ok && r.reason === "auth")) {
        onNotice?.("Inicia sesión para traducir las citas.");
      }

      setTranslatedQuotes({
        firstMention: firstTrans?.ok ? firstTrans.translation : undefined,
        recentMention: recentTrans?.ok ? recentTrans.translation : undefined,
      });
    } finally {
      setIsTranslatingQuotes(false);
    }
  };

  const handleSpeak = () => {
    if (pressConsumedRef.current) {
      pressConsumedRef.current = false;
      return;
    }
    triggerHaptic(6);
    if (onSpeakWord) {
      onSpeakWord(cleanWord, effectiveLang);
    } else {
      speakWord(cleanWord, effectiveLang);
    }
  };

  const handleAudioPointerDown = () => {
    pressConsumedRef.current = false;
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      pressConsumedRef.current = true;
      triggerHaptic(12);
      if (onSpeakWord) {
        onSpeakWord(cleanWord, effectiveLang, 0.6);
      } else {
        speakWord(cleanWord, effectiveLang, 0.6);
      }
    }, 450);
  };

  const handleAudioPointerUp = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleSave = async () => {
    if (savedRef.current) return;
    setSaving(true);
    savedRef.current = true;
    setIsSaved(true);
    setSprouted(true);
    triggerHaptic(12);

    onRecordSilentCalibration(cleanWord, "save", effectiveLang, zipfFor?.(cleanWord));

    const lemma = localEntry?.lemma ?? cleanWord.toLowerCase();
    const shortDef = meaning?.text || localEntry?.shortDefinition?.trim() || "";
    const inPassage = meaning?.text || localEntry?.shortDefinition?.trim() || "";

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
            pos: localEntry?.partOfSpeech ?? undefined,
            language: effectiveLang,
            context: effectiveContext || undefined,
            bookHash,
            bookTitle: bookTitle || undefined,
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

        const msg = "Fijada con prioridad en tu cuaderno.";
        onNotice?.(msg);
        setQuickNotice(msg);
        setTimeout(() => setQuickNotice(null), 2500);
        return saved;
      } catch {
        savedRef.current = false;
        setIsSaved(false);
        setSprouted(false);
        return null;
      } finally {
        saveInFlightRef.current = null;
        setSaving(false);
      }
    })();

    saveInFlightRef.current = work;
    await work;
  };

  const handleQuickKnown = async () => {
    // Una palabra del Cuaderno no se declara «conocida» encima de su
    // tarjeta: eso lo decide el repaso.
    if (saving || savedRef.current) return;
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

  const savedStage =
    savedEntry?.card && (savedEntry.card.reps ?? 0) > 0
      ? markLevel(savedEntry.card) === "learning"
        ? "En práctica"
        : markLevel(savedEntry.card) === "settled"
          ? "Asentada"
          : "Dominada"
      : null;

  const handleRemove = async () => {
    savedRef.current = false;
    setIsSaved(false);
    triggerHaptic(8);
    const msg = "Eliminada del cuaderno";
    onNotice?.(msg);
    setQuickNotice(msg);
    setTimeout(() => setQuickNotice(null), 2000);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      // Atajos de una tecla: nunca con modificadores (Cmd+S, Ctrl+P…) ni
      // escribiendo en un campo editable.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
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

  const aiAllowed = canExplain && useAi;

  const toneLabel =
    passageResult?.toneOrNuance?.trim() &&
    !/^literario$/i.test(passageResult.toneOrNuance.trim())
      ? passageResult.toneOrNuance.trim()
      : null;
  const passageRepeatsMeaning = Boolean(
    meaning &&
      passageResult &&
      normalizeForCompare(passageResult.inPassageMeaning) ===
        normalizeForCompare(meaning.text),
  );

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

  const extraSenses =
    meaning?.source === "dictionary"
      ? (localEntry?.senses ?? []).slice(1).filter((def) => def !== meaning.text)
      : [];

  const senseDetailList = localEntry?.senseDetails ?? [];
  const shownDetail =
    meaning?.source === "dictionary"
      ? senseDetailList.find(
          (d) => normalizeForCompare(d.definition) === normalizeForCompare(meaning.text),
        )
      : undefined;
  const exampleIsBookSentence = (ex: string | null) =>
    !ex || normalizeForCompare(ex) === normalizeForCompare(effectiveContext);
  const shownExample = exampleIsBookSentence(shownDetail?.example ?? null)
    ? null
    : (shownDetail?.example ?? null);

  const handleReportSense = async () => {
    if (!shownDetail || reportState !== "idle") return;
    setReportState("sending");
    const res = await reportShownSense(
      {
        form: cleanWord,
        lang: effectiveLang,
        lemma: localEntry?.lemma,
        entryId: shownDetail.entryId,
        senseOrder: shownDetail.senseOrder,
      },
      shownDetail.definition,
      captureDbScope(),
    ).catch(() => ({ ok: false as const, error: "" }));
    if (res.ok) {
      setReportState("done");
      setReportNote("Gracias, la revisaremos.");
    } else {
      setReportState("idle");
      setReportNote("No pudimos reportarla ahora.");
    }
  };

  // Determinar si mostrar botón "Más" (nivel 3)
  const showMoreButton = 
    (isCandidateProperNoun && characterCard) ||
    (isForeignBook && characterCard);

  return (
    <aside
      className="word-unified-card sheet"
      role="dialog"
      aria-label={`Significado de ${cleanWord}`}
    >
      <header className="word-panel__header word-card-header">
        <div className="word-panel__top-row">
          <div className="word-panel__title-group word-card-title-group">
            <h3 className="word-panel__word word-card-term">{cleanWord}</h3>
            {localEntry?.partOfSpeech && (
              <span className="word-panel__pos-badge word-card-pos">{localEntry.partOfSpeech}</span>
            )}
            {localEntry?.ipa && (
              <span className="word-panel__ipa">/{localEntry.ipa}/</span>
            )}
            <button
              type="button"
              className="word-panel__audio-btn word-card-audio-btn btn--pronounce"
              onClick={handleSpeak}
              onPointerDown={handleAudioPointerDown}
              onPointerUp={handleAudioPointerUp}
              onPointerLeave={handleAudioPointerUp}
              onPointerCancel={handleAudioPointerUp}
              aria-label="Pronunciar palabra (mantener pulsado para lento)"
              title="Escuchar pronunciación (mantener pulsado para lento)"
            >
              <Icon name="speaker" size={16} />
            </button>
          </div>

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

        {localEntry?.lemma && localEntry.lemma.toLowerCase() !== cleanWord.toLowerCase() && (
          <p className="word-panel__lemma-note">
            forma de{" "}
            <button
              type="button"
              className="word-panel__lemma-link"
              onClick={() => onSelectWord?.(localEntry.lemma)}
              title={`Explorar ${localEntry.lemma}`}
            >
              «{localEntry.lemma}»
            </button>
          </p>
        )}

        <div className="word-panel__status-row word-card-actions">
          {isSaved ? (
            <div className="word-panel__saved-bar">
              <span
                className="word-panel__saved-pill word-panel-saved-badge"
                data-sprout={sprouted || undefined}
              >
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
                className="btn--quick-known word-panel__known-btn"
                onClick={handleQuickKnown}
                title="Marcar como ya conocida para ajustar tu nivel sin exámenes"
              >
                ✓ Ya la sé
              </button>
            </>
          )}
        </div>
      </header>

      {(isCandidateProperNoun || Boolean(characterCard && characterCard.totalMentionsUpToCursor > 0)) && (
        <nav
          className="word-panel-mode-switcher"
          aria-label="Vista del panel"
        >
          <button
            type="button"
            aria-pressed={viewMode === "character"}
            className={`btn--mode-toggle ${viewMode === "character" ? "is-active" : ""}`}
            onClick={() => setViewMode("character")}
          >
            Personaje
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "dictionary"}
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
              <div className="character-mention-block character-first-mention">
                <div className="character-mention-title">
                  Primera vez que apareció {characterCard.firstMention ? `(${characterCard.firstMention.chapterTitle})` : ""}:
                </div>
                {characterCard.firstMention ? (
                  <>
                    <blockquote className="character-quote-text">
                      «{characterCard.firstMention.sentence}»
                    </blockquote>
                    {translatedQuotes?.firstMention && (
                      <p className="character-quote-translation">{translatedQuotes.firstMention}</p>
                    )}
                  </>
                ) : (
                  <p className="character-quote-empty">
                    No se registran apariciones previas.
                  </p>
                )}
              </div>

              <div className="character-mention-block character-recent-mention">
                <div className="character-mention-title">
                  Última vez visto antes de aquí {characterCard.recentMention ? `(${characterCard.recentMention.chapterTitle})` : ""}:
                </div>
                {characterCard.recentMention ? (
                  <>
                    <blockquote className="character-quote-text">
                      «{characterCard.recentMention.sentence}»
                    </blockquote>
                    {translatedQuotes?.recentMention && (
                      <p className="character-quote-translation">{translatedQuotes.recentMention}</p>
                    )}
                  </>
                ) : (
                  <p className="character-quote-empty">
                    {characterCard.firstMention
                      ? "Es su primera escena o intervención en el libro."
                      : "Sin menciones previas en la lectura."}
                  </p>
                )}
              </div>

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

              {quotesPlanShown && (
                <PlanNote
                  title="Traducir las citas es de Lecta+."
                  detail="Las citas originales siguen disponibles."
                />
              )}

              {isForeignBook && !quotesPlanShown && (characterCard.firstMention || characterCard.recentMention) && (
                <div className="character-translate-action">
                  <button
                    type="button"
                    className="btn--translate-character-quotes"
                    onClick={handleTranslateQuotes}
                    disabled={isTranslatingQuotes}
                  >
                    {isTranslatingQuotes ? "Traduciendo citas..." : `Traducir citas ${NATIVE_LABELS[userNativeLang] ?? "a tu idioma"}`}
                  </button>
                </div>
              )}

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
                {shownExample ? (
                  <p className="word-card-sense-example">{shownExample}</p>
                ) : null}
                {canExplain && shownDetail && disclosureLevel >= 2 ? (
                  <div className="word-card-report">
                    <button
                      type="button"
                      className="word-card-report-btn"
                      onClick={() => void handleReportSense()}
                      disabled={reportState !== "idle"}
                    >
                      Esta acepción no corresponde
                    </button>
                    {reportNote ? (
                      <span className="word-card-report-note" role="status">
                        {reportNote}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {extraSenses.length > 0 && (
                  <details className="word-card-more-senses">
                    <summary>Otras acepciones ({extraSenses.length})</summary>
                    <ol className="word-card-more-senses-list">
                      {extraSenses.map((def) => {
                        const ex = senseDetailList.find((d) => d.definition === def)?.example ?? null;
                        return (
                          <li key={def}>
                            {def}
                            {!exampleIsBookSentence(ex) &&
                            normalizeForCompare(ex!) !== normalizeForCompare(shownExample ?? "") ? (
                              <span className="word-card-sense-example">{ex}</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                )}
              </>
            ) : !canExplain ? (
              <p className="word-card-context-fallback">
                Esta palabra no está en el diccionario. Inicia sesión para que la
                IA la explique.{" "}
                <a
                  className="word-card-retry-link"
                  href={`https://es.wiktionary.org/wiki/${encodeURIComponent(cleanWord)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Buscar en Wiktionary
                </a>
              </p>
            ) : meaningStatus === "error" ? (
              <p className="word-card-context-fallback">
                No pudimos consultar esta palabra.{" "}
                <button
                  type="button"
                  className="word-card-retry-link"
                  onClick={() => requestAiMeaning()}
                >
                  Reintentar
                </button>
                {" · "}
                <a
                  className="word-card-retry-link"
                  href={`https://es.wiktionary.org/wiki/${encodeURIComponent(cleanWord)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Wiktionary
                </a>
              </p>
            ) : (
              <p className="word-card-context-fallback">
                Esta palabra no está en el diccionario.{" "}
                <button
                  type="button"
                  className="word-card-retry-link"
                  onClick={() => requestAiMeaning()}
                >
                  Definir con IA
                </button>
                {" · "}
                <a
                  className="word-card-retry-link"
                  href={`https://es.wiktionary.org/wiki/${encodeURIComponent(cleanWord)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Wiktionary
                </a>
              </p>
            )}

            {localEntry && localEntry.synonyms.length > 0 && (
              <div className="word-card-synonyms">
                {localEntry.synonyms.slice(0, 4).map((syn) => (
                  <button
                    key={syn}
                    type="button"
                    className="word-synonym-pill"
                    onClick={() => onSelectWord?.(syn)}
                    title={`Explorar ${syn}`}
                  >
                    {syn}
                  </button>
                ))}
              </div>
            )}
          </section>

          {effectiveContext ? (
            <section className="word-card-context-box">
              <h4 className="word-card-section-title">En esta frase</h4>
              <blockquote className="word-card-context-quote">
                {renderContextQuote()}
              </blockquote>

              {planNoteShown || (planLocked && freeAiRemaining === 0) ? (
                <PlanNote
                  title="Se acabaron tus usos de IA de cortesía de hoy. Mañana tienes 3 más."
                  detail="El significado de arriba siempre es tuyo; la explicación en contexto es de Lecta+."
                />
              ) : !aiAllowed ? (
                !canExplain ? (
                  <p className="word-card-context-fallback">
                    Inicia sesión para explicar frases con IA.
                  </p>
                ) : null
              ) : disclosureLevel === 1 ? (
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
                  {planLocked && typeof freeAiRemaining === "number" && freeAiRemaining > 0 ? (
                    <p className="word-card-context-fallback">
                      Te quedan {freeAiRemaining} {freeAiRemaining === 1 ? "uso" : "usos"} de IA de cortesía hoy.
                    </p>
                  ) : null}
                </div>
              ) : disclosureLevel === 2 ? (
                <div className="word-card-passage-meaning" aria-live="polite">
                  {(!passageRepeatsMeaning || !toneLabel) && passageResult && (
                    <p className="word-card-context-text passage-meaning-text">
                      {passageResult.inPassageMeaning}
                    </p>
                  )}
                  {toneLabel ? (
                    <p className="word-card-tone">Tono: {toneLabel}</p>
                  ) : null}
                  {showMoreButton && (
                    <button
                      type="button"
                      className="btn--expand-all"
                      onClick={handleExpandAll}
                    >
                      Ver más ›
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {passageResult && (
                    <div className="word-card-passage-meaning" aria-live="polite">
                      {(!passageRepeatsMeaning || !toneLabel) && (
                        <p className="word-card-context-text passage-meaning-text">
                          {passageResult.inPassageMeaning}
                        </p>
                      )}
                      {toneLabel ? (
                        <p className="word-card-tone">Tono: {toneLabel}</p>
                      ) : null}
                    </div>
                  )}

                  {passageState === "error" && passageError && disclosureLevel >= 2 && (
                    <p className="word-card-context-fallback" style={{marginTop: "var(--s-2)"}}>
                      {passageError}
                    </p>
                  )}

                  {isCandidateProperNoun && disclosureLevel === 3 && (
                    <button
                      type="button"
                      className="btn--switch-to-character"
                      onClick={() => setViewMode("character")}
                    >
                      <Icon name="you" size={14} />
                      <span>Ver como personaje</span>
                    </button>
                  )}
                </>
              )}

              {/* Acciones de pasaje siempre a la vista (decisión 2026-11-11):
                  subrayar la frase no depende de la IA ni de «Ver más». */}
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
            </section>
          ) : null}
        </>
      )}

      {quickNotice && (
        <div className="word-panel-notice-toast" role="status" aria-live="polite">
          {quickNotice}
        </div>
      )}
    </aside>
  );
};

export const WordPanel = memo(WordPanelImpl);
export default WordPanel;