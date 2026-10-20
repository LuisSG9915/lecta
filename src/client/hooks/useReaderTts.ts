import { useCallback, useEffect, useRef, useState } from 'react';
import { TtsAudioController } from '../lib/ttsController';
import type { TtsRate, TtsStatus, TtsVoiceOption } from '../lib/ttsTypes';
import {
  hasKittenConsent,
  isKittenVoiceURI,
  loadTtsSettings,
  saveTtsSettings,
  setKittenConsent,
} from '../lib/ttsSettings';

interface UseReaderTtsParams {
  sectionDoc: Document | null;
  onAdvanceSection?: () => void;
  onShowNotice: (msg: string) => void;
}

export function useReaderTts({
  sectionDoc,
  onAdvanceSection,
  onShowNotice,
}: UseReaderTtsParams) {
  const controllerRef = useRef<TtsAudioController | null>(null);
  const [status, setStatus] = useState<TtsStatus>('idle');
  const [rate, setRate] = useState<number>(() => loadTtsSettings().rate);
  const [voiceURI, setVoiceURI] = useState<string | null>(() => loadTtsSettings().voiceURI ?? null);
  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [currentSentence, setCurrentSentence] = useState<string>('');
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [sentenceCount, setSentenceCount] = useState(0);
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [pendingVoiceURI, setPendingVoiceURI] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new TtsAudioController({
      onStateChange: (snap: {
        status: TtsStatus;
        currentSentenceText: string;
        currentIndex: number;
        totalSentences: number;
      }) => {
        setStatus(snap.status);
        setCurrentSentence(snap.currentSentenceText);
        setSentenceIndex(snap.currentIndex);
        setSentenceCount(snap.totalSentences);
      },
      onVoicesChange: (available: TtsVoiceOption[]) => {
        setVoices(available);
      },
      onSectionEnd: () => {
        onAdvanceSection?.();
      },
      onDownloadProgress: (pct: number) => {
        setDownloadProgress(pct >= 100 ? null : pct);
      },
      onError: (msg: string) => {
        onShowNotice(msg);
      },
    });

    controllerRef.current = ctrl;
    return () => {
      ctrl.stop();
      ctrl.dispose();
      controllerRef.current = null;
    };
  }, [onAdvanceSection, onShowNotice]);

  // Sincronizar documento del capítulo actual con el controlador TTS
  useEffect(() => {
    if (!controllerRef.current || !sectionDoc) return;
    controllerRef.current.attachDocument(sectionDoc);
  }, [sectionDoc]);

  const startOrToggleTts = useCallback(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    if (status === 'playing') {
      ctrl.pause();
      return;
    }
    if (status === 'paused') {
      ctrl.resume();
      return;
    }

    // Verificar si la voz seleccionada es neuronal (KittenTTS) y requiere consentimiento
    if (voiceURI && isKittenVoiceURI(voiceURI) && !hasKittenConsent()) {
      setPendingVoiceURI(voiceURI);
      setShowConsentDialog(true);
      return;
    }

    ctrl.play();
  }, [status, voiceURI]);

  const handleConfirmConsent = useCallback(() => {
    setKittenConsent(true);
    setShowConsentDialog(false);
    if (pendingVoiceURI && controllerRef.current) {
      controllerRef.current.setVoice(pendingVoiceURI);
      setVoiceURI(pendingVoiceURI);
      saveTtsSettings({ rate: rate as TtsRate, voiceURI: pendingVoiceURI });
    }
    setPendingVoiceURI(null);
    controllerRef.current?.play();
  }, [pendingVoiceURI, rate]);

  const handleCancelConsent = useCallback(() => {
    setShowConsentDialog(false);
    setPendingVoiceURI(null);
  }, []);

  const handleChangeRate = useCallback(
    (nextRate: number) => {
      setRate(nextRate);
      controllerRef.current?.setRate(nextRate);
      saveTtsSettings({ rate: nextRate as TtsRate, voiceURI });
    },
    [voiceURI],
  );

  const handleChangeVoice = useCallback(
    (nextVoiceURI: string | null) => {
      if (nextVoiceURI && isKittenVoiceURI(nextVoiceURI) && !hasKittenConsent()) {
        setPendingVoiceURI(nextVoiceURI);
        setShowConsentDialog(true);
        return;
      }
      setVoiceURI(nextVoiceURI);
      controllerRef.current?.setVoice(nextVoiceURI);
      saveTtsSettings({ rate: rate as TtsRate, voiceURI: nextVoiceURI });
    },
    [rate],
  );

  const stopTts = useCallback(() => {
    controllerRef.current?.stop();
  }, []);

  const stepSentence = useCallback((delta: -1 | 1) => {
    if (delta < 0) controllerRef.current?.prev();
    else controllerRef.current?.next();
  }, []);

  return {
    ttsStatus: status,
    ttsRate: rate,
    ttsVoiceURI: voiceURI,
    ttsVoices: voices,
    ttsCurrentSentence: currentSentence,
    ttsSentenceIndex: sentenceIndex,
    ttsSentenceCount: sentenceCount,
    showTtsConsent: showConsentDialog,
    ttsDownloadProgress: downloadProgress,
    startOrToggleTts,
    stopTts,
    stepSentence,
    handleChangeRate,
    handleChangeVoice,
    handleConfirmConsent,
    handleCancelConsent,
  };
}
