// Hook extraído de Vocabulary.tsx (Fase 5, V1): el estado del gato en la
// ficha de Aprender y en el repaso — modo (animado / tranquilo / oculto),
// pose, frase y racha — y el temporizador que lo devuelve a «idle».
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionPose } from "../components/Companion";
import {
  loadPracticeCompanionMode,
  savePracticeCompanionMode,
  type PracticeCompanionMode,
} from "../lib/settings";

export type UsePracticeCompanionResult = {
  companionMode: PracticeCompanionMode;
  updateCompanionMode: (mode: PracticeCompanionMode) => void;
  catPose: CompanionPose;
  setCatPose: (pose: CompanionPose | ((prev: CompanionPose) => CompanionPose)) => void;
  catSpeech: string;
  setCatSpeech: (speech: string) => void;
  combo: number;
  setCombo: (value: number | ((prev: number) => number)) => void;
  /** Vuelve a «idle» pasados `ms`; reemplaza el temporizador anterior. */
  settleCatAfter: (ms: number) => void;
};

export function usePracticeCompanion(): UsePracticeCompanionResult {
  const [companionMode, setCompanionMode] = useState<PracticeCompanionMode>(() =>
    loadPracticeCompanionMode(),
  );
  const [catPose, setCatPose] = useState<CompanionPose>("idle");
  const [catSpeech, setCatSpeech] = useState<string>("");
  const [combo, setCombo] = useState(0);
  const catPoseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCatTimer = useCallback(() => {
    if (catPoseTimer.current !== null) {
      clearTimeout(catPoseTimer.current);
      catPoseTimer.current = null;
    }
  }, []);
  useEffect(() => clearCatTimer, [clearCatTimer]);

  const settleCatAfter = useCallback(
    (ms: number) => {
      clearCatTimer();
      catPoseTimer.current = setTimeout(() => {
        setCatPose("idle");
        catPoseTimer.current = null;
      }, ms);
    },
    [clearCatTimer],
  );

  const updateCompanionMode = useCallback((mode: PracticeCompanionMode) => {
    setCompanionMode(mode);
    savePracticeCompanionMode(mode);
  }, []);

  return {
    companionMode,
    updateCompanionMode,
    catPose,
    setCatPose,
    catSpeech,
    setCatSpeech,
    combo,
    setCombo,
    settleCatAfter,
  };
}
