import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  createTtsController,
  TtsAudioController,
  type TtsController,
} from '../lib/ttsController';
import {
  downloadKittenModel,
  isKittenModelCached,
  kittenTtsEngine,
  unlockAudioContext,
} from '../lib/kittenTtsEngine';
import {
  TTS_IDLE,
  TTS_PLAYER_RATES,
  type TtsEngineMode,
  type TtsRate,
  type TtsSnapshot,
  type TtsStatus,
  type TtsVoiceOption,
} from '../lib/ttsTypes';
import {
  consentTts,
  hasKittenConsent,
  isKittenVoiceURI,
  loadTtsSettings,
  saveTtsSettings,
  setKittenConsent,
} from '../lib/ttsSettings';
import { isFeatureFlagEnabled } from '../lib/settings';
import {
  noteTtsProgrammaticScroll,
  withTtsProgrammaticNav,
} from '../lib/ttsGuards';
import { sentenceIndexForAnchor } from '../lib/ttsSentences';
import { anchorAtViewTop } from '../lib/reading-location';
import { pageOfElement, type PageLayout } from '../lib/pagination';
import type { ChapterCatalog } from '../lib/chapters';
import type { SavedBookPosition } from '../lib/idb';
import type { VisitEventDraft } from '../lib/reading-events';

export type ReaderNavigateFn = (
  intent: "initial" | "chapter" | "resume" | "lookup" | "return",
  target: {
    index: number;
    fragment?: string;
    restore?: {
      ratio?: number;
      anchor?: string;
      snippet?: string;
      fragment?: string;
      at?: "end";
    };
  },
) => Promise<unknown> | void;

export interface UseReaderTtsParams {
  // Modo autónomo (usado en hooks.test.ts)
  sectionDoc?: Document | null;
  onAdvanceSection?: () => void;
  onShowNotice?: (msg: string) => void;

  // Modo integrado Reader.tsx
  bookHash?: string;
  state?: string;
  language?: string;
  sectionIndex?: number;
  sectionIndexRef?: MutableRefObject<number>;
  stateRef?: MutableRefObject<string>;
  containerRef?: MutableRefObject<HTMLDivElement | null>;
  catalogRef?: MutableRefObject<ChapterCatalog | null>;
  metricsRef?: MutableRefObject<PageLayout | null>;
  layoutRef?: MutableRefObject<"scroll" | "pages">;
  latestPositionRef?: MutableRefObject<SavedBookPosition | null>;
  companion?: {
    open: boolean;
    modalOpen: boolean;
    reducedMotion: boolean;
  };
  docHidden?: boolean;
  selection?: unknown;
  sheet?: unknown;
  panelsOpen?: boolean;
  prep?: unknown;
  fatigueNotice?: boolean;
  setPageIdx?: (page: number) => void;
  setCompanionAudioSuppressed?: (suppressed: boolean) => void;
  navigate?: ReaderNavigateFn;
  trackEvent?: (draft: VisitEventDraft) => void;
  noteActivity?: (force?: boolean) => void;
  closeSheet?: () => void;
}

export function useReaderTts(params: UseReaderTtsParams = {}) {
  const {
    sectionDoc,
    onAdvanceSection,
    onShowNotice = () => undefined,
    bookHash = "",
    state = "idle",
    language = "es",
    sectionIndex = 0,
    sectionIndexRef,
    stateRef,
    containerRef,
    catalogRef,
    metricsRef,
    layoutRef,
    latestPositionRef,
    companion,
    docHidden = false,
    selection = null,
    sheet = null,
    panelsOpen = false,
    prep = null,
    fatigueNotice = false,
    setPageIdx,
    setCompanionAudioSuppressed,
    navigate = () => undefined,
    trackEvent = () => undefined,
    noteActivity = () => undefined,
    closeSheet = () => undefined,
  } = params;

  // Controlador Reader (integración completa de lectura)
  const ttsRef = useRef<TtsController | null>(null);
  const [ttsSnap, setTtsSnap] = useState<TtsSnapshot>(TTS_IDLE);
  const [ttsConsentOpen, setTtsConsentOpen] = useState(false);
  const [ttsDownloadProgress, setTtsDownloadProgress] = useState<number | null>(null);
  const [isKittenModelDownloaded, setIsKittenModelDownloaded] = useState(false);
  const [sleepTimerActive, setSleepTimerActive] = useState(false);

  // Controlador simplificado de audio
  const audioControllerRef = useRef<TtsAudioController | null>(null);
  const [audioStatus, setAudioStatus] = useState<TtsStatus>('idle');
  const [rate, setRate] = useState<number>(() => loadTtsSettings().rate);
  const [voiceURI, setVoiceURI] = useState<string | null>(() => loadTtsSettings().voiceURI ?? null);
  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [currentSentence, setCurrentSentence] = useState<string>('');
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [sentenceCount, setSentenceCount] = useState(0);
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [pendingVoiceURI, setPendingVoiceURI] = useState<string | null>(null);

  // Verificar si el modelo KittenTTS está descargado al abrir diálogo de consentimiento
  useEffect(() => {
    if (ttsConsentOpen) {
      void kittenTtsEngine.isModelDownloaded().then((downloaded) => {
        setIsKittenModelDownloaded(downloaded);
      });
    }
  }, [ttsConsentOpen]);

  const handleDeleteTtsModel = useCallback(async () => {
    await kittenTtsEngine.removeDownloadedModel();
    setIsKittenModelDownloaded(false);
    setTtsDownloadProgress(null);
  }, []);

  // Espejos de funciones para el controlador Reader
  const ttsFns = useRef({
    navigate,
    trackEvent,
    noteActivity,
    onStatus: onShowNotice,
    reducedMotion: companion?.reducedMotion ?? false,
    language,
    closeSheet,
  });

  useEffect(() => {
    ttsFns.current = {
      navigate,
      trackEvent,
      noteActivity,
      onStatus: onShowNotice,
      reducedMotion: companion?.reducedMotion ?? false,
      language,
      closeSheet,
    };
  });

  // Inicialización del controlador completo de lectura en voz alta cuando se dispone de containerRef
  useEffect(() => {
    if (!containerRef) return;
    const ctl = createTtsController({
      language: () => ttsFns.current.language,
      root: () => containerRef.current,
      sectionIndex: () => sectionIndexRef?.current ?? 0,
      sectionReady: () => (stateRef ? stateRef.current === "ready" : state === "ready"),
      navigateSection: (index) => {
        withTtsProgrammaticNav(() => {
          void ttsFns.current.navigate("resume", { index });
        });
      },
      reveal: (el) => {
        noteTtsProgrammaticScroll();
        const metrics = metricsRef?.current;
        if (layoutRef?.current === "pages" && metrics && setPageIdx) {
          setPageIdx(pageOfElement(el, metrics));
          return;
        }
        el.scrollIntoView({
          block: "center",
          behavior: ttsFns.current.reducedMotion ? "auto" : "smooth",
        });
      },
      emit: (draft) => ttsFns.current.trackEvent(draft as unknown as VisitEventDraft),
      noteActivity: () => ttsFns.current.noteActivity(true),
      onSnapshot: (snap) => {
        setTtsSnap(snap);
        if (snap.status === "idle" || snap.status === "stopping") {
          setSleepTimerActive(false);
        }
      },
      onSessionEnd: (reason) => {
        setSleepTimerActive(false);
        if (reason === "error") ttsFns.current.onStatus("No se pudo leer en voz alta.");
      },
      resolveStartIndex: (items) => {
        const saved = latestPositionRef?.current;
        const currentIdx = sectionIndexRef?.current ?? 0;
        const anchor =
          saved?.sectionIndex === currentIdx && saved.anchor
            ? saved.anchor
            : containerRef.current
              ? anchorAtViewTop(containerRef.current)
              : null;
        return sentenceIndexForAnchor(items, anchor);
      },
    });

    ttsRef.current = ctl;
    return () => {
      ctl.destroy();
      ttsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  // Inicialización del controlador standalone si se provee sectionDoc sin containerRef
  useEffect(() => {
    if (containerRef) return;
    const initialSettings = loadTtsSettings();
    const ctrl = new TtsAudioController({
      onStateChange: (snap: {
        status: TtsStatus;
        currentSentenceText: string;
        currentIndex: number;
        totalSentences: number;
      }) => {
        setAudioStatus(snap.status);
        setCurrentSentence(snap.currentSentenceText);
        setSentenceIndex(snap.currentIndex);
        setSentenceCount(snap.totalSentences);
      },
      onVoicesChange: (available: TtsVoiceOption[]) => {
        const allowNeural = isFeatureFlagEnabled('neuralTts');
        const filtered = allowNeural
          ? available
          : available.filter((v) => !v.isNeural && !isKittenVoiceURI(v.id));
        setVoices(filtered);
      },
      onSectionEnd: () => {
        onAdvanceSection?.();
      },
      onDownloadProgress: (pct: number) => {
        setTtsDownloadProgress(pct >= 100 ? null : pct);
      },
      onError: (msg: string) => {
        onShowNotice(msg);
      },
    });

    ctrl.setRate(initialSettings.rate);
    ctrl.setVoice(initialSettings.voiceURI ?? null);
    audioControllerRef.current = ctrl;

    return () => {
      ctrl.stop();
      ctrl.dispose();
      audioControllerRef.current = null;
    };
  }, [containerRef, onAdvanceSection, onShowNotice]);

  useEffect(() => {
    if (!audioControllerRef.current || !sectionDoc) return;
    audioControllerRef.current.attachDocument(sectionDoc);
  }, [sectionDoc]);

  // Pausas automáticas de la sesión (visibilidad, panel abierto, fatiga, consulta léxica)
  useEffect(() => {
    const ctl = ttsRef.current;
    if (!ctl) return;
    if (ttsSnap.status !== "speaking" && ttsSnap.status !== "preparing") return;
    if (docHidden && !sleepTimerActive) ctl.pause("visibility");
    else if (selection) ctl.pause("word_lookup");
    else if (sheet || panelsOpen || prep || companion?.open || companion?.modalOpen) ctl.pause("panel_opened");
    else if (fatigueNotice) ctl.pause("fatigue");
  }, [
    ttsSnap.status,
    docHidden,
    sleepTimerActive,
    selection,
    sheet,
    panelsOpen,
    prep,
    companion?.open,
    companion?.modalOpen,
    fatigueNotice,
  ]);

  // Sección terminada de pintar
  useEffect(() => {
    if (state === "ready") ttsRef.current?.onSectionRendered();
  }, [state, sectionIndex]);

  // Supresión de audio del compañero mientras TTS habla
  useEffect(() => {
    if (setCompanionAudioSuppressed) {
      setCompanionAudioSuppressed(ttsSnap.status === "speaking");
      return () => setCompanionAudioSuppressed(false);
    }
  }, [ttsSnap.status, setCompanionAudioSuppressed]);

  const startTts = useCallback(() => {
    const ctl = ttsRef.current;
    if (!ctl || state !== "ready") return;
    closeSheet();
    const index = sectionIndexRef?.current ?? 0;
    const range = (catalogRef?.current?.ranges ?? []).find(
      (r) => r.startSection <= index && index < r.endSection,
    );
    ctl.start(
      {
        bookHash,
        targetId: range?.target.id ?? `s${index}`,
        startSection: range?.startSection ?? index,
        endSection: range?.endSection ?? index + 1,
        sectionIndex: index,
      },
      0,
    );
  }, [state, closeSheet, sectionIndexRef, catalogRef, bookHash]);

  const onTtsRequest = useCallback(() => {
    const ctl = ttsRef.current;
    if (!ctl) return;
    if (ttsSnap.status !== "idle") {
      ctl.stop("user");
      return;
    }
    if (loadTtsSettings().consentedAt === null) {
      setTtsConsentOpen(true);
      return;
    }
    startTts();
  }, [ttsSnap.status, startTts]);

  const onTtsConsentAccept = useCallback(
    (engineMode?: TtsEngineMode) => {
      consentTts(undefined, engineMode ? { engine: engineMode } : undefined);
      setTtsConsentOpen(false);
      trackEvent({
        kind: "tts_setting_changed",
        enabled: true,
        source: "reader_tools",
      } as unknown as VisitEventDraft);
      startTts();
    },
    [trackEvent, startTts],
  );

  const togglePlayPause = useCallback(() => {
    const ctl = ttsRef.current;
    if (!ctl) return;
    if (ttsSnap.status === "speaking") ctl.pause("user");
    else if (ttsSnap.status === "paused") ctl.resume();
  }, [ttsSnap.status]);

  const prevSentence = useCallback(() => {
    ttsRef.current?.prevSentence();
  }, []);

  const nextSentence = useCallback(() => {
    ttsRef.current?.nextSentence();
  }, []);

  const cycleSpeed = useCallback(() => {
    void ttsRef.current?.cycleRate(TTS_PLAYER_RATES);
  }, []);

  const stopTts = useCallback((reason: "user" | "navigation" | "visibility" = "user") => {
    setSleepTimerActive(false);
    ttsRef.current?.stop(reason);
    audioControllerRef.current?.stop();
  }, []);

  const onDomMutated = useCallback(() => {
    ttsRef.current?.onDomMutated();
  }, []);

  const noteSavedWord = useCallback(() => {
    ttsRef.current?.noteSavedWord();
  }, []);

  // Métodos standalone para hooks.test.ts
  const ensureModelAndPlay = useCallback(
    async (targetVoiceURI: string | null) => {
      const ctrl = audioControllerRef.current;
      if (!ctrl) return;
      const allowNeural = isFeatureFlagEnabled('neuralTts');
      let effectiveVoice = targetVoiceURI;
      if (!allowNeural && targetVoiceURI && isKittenVoiceURI(targetVoiceURI)) {
        effectiveVoice = null;
        ctrl.setVoice(null);
      }
      if (effectiveVoice && isKittenVoiceURI(effectiveVoice) && allowNeural) {
        try {
          const cached = await isKittenModelCached();
          if (!cached) {
            setTtsDownloadProgress(0);
            await downloadKittenModel((p) => {
              setTtsDownloadProgress(p.percent >= 100 ? null : p.percent);
            });
          }
        } catch {
          setTtsDownloadProgress(null);
          onShowNotice('No se pudo descargar la voz HD; usando voz del sistema.');
        } finally {
          setTtsDownloadProgress(null);
        }
      }
      ctrl.play();
    },
    [onShowNotice],
  );

  const startOrToggleTts = useCallback(() => {
    unlockAudioContext();
    const ctrl = audioControllerRef.current;
    if (!ctrl) return;
    if (audioStatus === 'playing') {
      ctrl.pause();
      return;
    }
    if (audioStatus === 'paused') {
      ctrl.resume();
      return;
    }
    const allowNeural = isFeatureFlagEnabled('neuralTts');
    if (voiceURI && isKittenVoiceURI(voiceURI)) {
      if (!allowNeural) {
        void ensureModelAndPlay(null);
        return;
      }
      if (!hasKittenConsent()) {
        setPendingVoiceURI(voiceURI);
        setShowConsentDialog(true);
        return;
      }
    }
    void ensureModelAndPlay(voiceURI);
  }, [audioStatus, voiceURI, ensureModelAndPlay]);

  const handleConfirmConsent = useCallback(() => {
    unlockAudioContext();
    setKittenConsent(true);
    setShowConsentDialog(false);
    const chosenVoice = pendingVoiceURI ?? voiceURI;
    if (chosenVoice && audioControllerRef.current) {
      audioControllerRef.current.setVoice(chosenVoice);
      setVoiceURI(chosenVoice);
      saveTtsSettings({ rate: rate as TtsRate, voiceURI: chosenVoice });
    }
    setPendingVoiceURI(null);
    void ensureModelAndPlay(chosenVoice);
  }, [pendingVoiceURI, voiceURI, rate, ensureModelAndPlay]);

  const handleCancelConsent = useCallback(() => {
    setShowConsentDialog(false);
    setPendingVoiceURI(null);
  }, []);

  const handleChangeRate = useCallback(
    (nextRate: number) => {
      unlockAudioContext();
      setRate(nextRate);
      audioControllerRef.current?.setRate(nextRate);
      saveTtsSettings({ rate: nextRate as TtsRate, voiceURI });
    },
    [voiceURI],
  );

  const handleChangeVoice = useCallback(
    (nextVoiceURI: string | null) => {
      unlockAudioContext();
      const allowNeural = isFeatureFlagEnabled('neuralTts');
      if (nextVoiceURI && isKittenVoiceURI(nextVoiceURI)) {
        if (!allowNeural) {
          onShowNotice('La voz neural está desactivada en este dispositivo.');
          return;
        }
        if (!hasKittenConsent()) {
          setPendingVoiceURI(nextVoiceURI);
          setShowConsentDialog(true);
          return;
        }
      }
      setVoiceURI(nextVoiceURI);
      audioControllerRef.current?.setVoice(nextVoiceURI);
      saveTtsSettings({ rate: rate as TtsRate, voiceURI: nextVoiceURI });
    },
    [rate, onShowNotice],
  );

  const stepSentence = useCallback((delta: -1 | 1) => {
    unlockAudioContext();
    if (delta < 0) audioControllerRef.current?.prev();
    else audioControllerRef.current?.next();
  }, []);



  const start5MinuteListening = useCallback(() => {
    const ctl = ttsRef.current;
    if (!ctl || state !== "ready") return;

    if (loadTtsSettings().consentedAt === null) {
      consentTts();
    }

    closeSheet();
    setSleepTimerActive(true);

    if (ttsSnap.status !== "idle") {
      ctl.setSleepTimer?.(5 * 60_000);
      return;
    }

    const index = sectionIndexRef?.current ?? 0;
    const range = (catalogRef?.current?.ranges ?? []).find(
      (r) => r.startSection <= index && index < r.endSection,
    );
    ctl.start(
      {
        bookHash,
        targetId: range?.target.id ?? `s${index}`,
        startSection: range?.startSection ?? index,
        endSection: range?.endSection ?? index + 1,
        sectionIndex: index,
      },
      0,
      { sleepTimerMs: 5 * 60_000 },
    );
  }, [state, closeSheet, sectionIndexRef, catalogRef, bookHash, ttsSnap.status]);

return {
    // Reader.tsx integration
    ttsRef,
    ttsSnap,
    ttsConsentOpen,
    setTtsConsentOpen,
    ttsDownloadProgress,
    isKittenModelDownloaded,
    handleDeleteTtsModel,
    startTts,
    onTtsRequest,
    onTtsConsentAccept,
    togglePlayPause,
    prevSentence,
    nextSentence,
    cycleSpeed,
    stopTts,
    onDomMutated,
    noteSavedWord,
    start5MinuteListening,
    sleepTimerActive,

    // Standalone hooks.test.ts integration
    ttsStatus: audioStatus,
    ttsRate: rate,
    ttsVoiceURI: voiceURI,
    ttsVoices: voices,
    ttsCurrentSentence: currentSentence,
    ttsSentenceIndex: sentenceIndex,
    ttsSentenceCount: sentenceCount,
    showTtsConsent: showConsentDialog,
    startOrToggleTts,
    stepSentence,
    handleChangeRate,
    handleChangeVoice,
    handleConfirmConsent,
    handleCancelConsent,
  };
}
