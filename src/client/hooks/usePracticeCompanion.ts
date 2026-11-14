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
  /** Vuelve a `to` («idle» por defecto) pasados `ms`; reemplaza el temporizador anterior. */
  settleCatAfter: (ms: number, to?: CompanionPose) => void;
  /** Pose de resultado del reto actual: a ella vuelve el gato tras una caricia. */
  resultPose: CompanionPose;
  setResultPose: (pose: CompanionPose) => void;
  /** Cambio de reto: cancela el temporizador y deja pose y resultado en «idle». */
  resetCat: () => void;
};

export function usePracticeCompanion(): UsePracticeCompanionResult {
  const [companionMode, setCompanionMode] = useState<PracticeCompanionMode>(() =>
    loadPracticeCompanionMode(),
  );
  const [catPose, setCatPose] = useState<CompanionPose>("idle");
  const [catSpeech, setCatSpeech] = useState<string>("");
  const [combo, setCombo] = useState(0);
  const [resultPose, setResultPose] = useState<CompanionPose>("idle");
  const catPoseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCatTimer = useCallback(() => {
    if (catPoseTimer.current !== null) {
      clearTimeout(catPoseTimer.current);
      catPoseTimer.current = null;
    }
  }, []);
  useEffect(() => clearCatTimer, [clearCatTimer]);

  const settleCatAfter = useCallback(
    (ms: number, to: CompanionPose = "idle") => {
      clearCatTimer();
      catPoseTimer.current = setTimeout(() => {
        setCatPose(to);
        catPoseTimer.current = null;
      }, ms);
    },
    [clearCatTimer],
  );

  const resetCat = useCallback(() => {
    clearCatTimer();
    setResultPose("idle");
    setCatPose("idle");
  }, [clearCatTimer]);

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
    resultPose,
    setResultPose,
    resetCat,
  };
}
