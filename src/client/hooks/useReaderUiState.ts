// Hook extraído de Reader.tsx (R3i, subconjunto bajo riesgo): estado
// UI simple (avisos, hojas, cápsulas, recap). La lógica y los efectos
// siguen en Reader.tsx y operan sobre los setters expuestos.
import { useState } from "react";

export type UseReaderUiStateResult = {
  calNotice: boolean;
  setCalNotice: (v: boolean) => void;
  helpNotice: boolean;
  setHelpNotice: (v: boolean) => void;
  helpIsCalibrated: boolean;
  setHelpIsCalibrated: (v: boolean) => void;
  showLongPressHint: boolean;
  setShowLongPressHint: (v: boolean | ((prev: boolean) => boolean)) => void;
  recordToast: string | null;
  setRecordToast: (v: string | null) => void;
  ttsCapturedToast: string | null;
  setTtsCapturedToast: (v: string | null) => void;
  glossaryOpen: boolean;
  setGlossaryOpen: (v: boolean) => void;
  settingsTab: "appearance" | "book" | "strategy";
  setSettingsTab: (v: "appearance" | "book" | "strategy") => void;
  activeBilingualParagraph: { originalText: string; translatedText?: string } | null;
  setActiveBilingualParagraph: (v: { originalText: string; translatedText?: string } | null) => void;
};

export function useReaderUiState(): UseReaderUiStateResult {
  const [calNotice, setCalNotice] = useState(false);
  const [helpNotice, setHelpNotice] = useState(false);
  const [helpIsCalibrated, setHelpIsCalibrated] = useState(false);
  const [showLongPressHint, setShowLongPressHint] = useState(false);
  const [recordToast, setRecordToast] = useState<string | null>(null);
  const [ttsCapturedToast, setTtsCapturedToast] = useState<string | null>(null);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"appearance" | "book" | "strategy">("appearance");
  const [activeBilingualParagraph, setActiveBilingualParagraph] = useState<{
    originalText: string;
    translatedText?: string;
  } | null>(null);

  return {
    calNotice,
    setCalNotice,
    helpNotice,
    setHelpNotice,
    helpIsCalibrated,
    setHelpIsCalibrated,
    showLongPressHint,
    setShowLongPressHint,
    recordToast,
    setRecordToast,
    ttsCapturedToast,
    setTtsCapturedToast,
    glossaryOpen,
    setGlossaryOpen,
    settingsTab,
    setSettingsTab,
    activeBilingualParagraph,
    setActiveBilingualParagraph,
  };
}