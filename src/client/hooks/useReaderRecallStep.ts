// Espejo del paso de sección para el recall a mitad de capítulo.
// Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { isForwardStepIntoSection } from "../lib/mid-chapter-recall";

type Ref<T> = { current: T };

type Deps = {
  sectionIndex: number;
  previousRecallSectionRef: Ref<number>;
  pendingRecallSectionRef: Ref<number | null>;
};

export function useReaderRecallStep(deps: Deps): void {
  const { sectionIndex, previousRecallSectionRef, pendingRecallSectionRef } = deps;

  useEffect(() => {
    const previous = previousRecallSectionRef.current;
    previousRecallSectionRef.current = sectionIndex;
    pendingRecallSectionRef.current = isForwardStepIntoSection(previous, sectionIndex) ? sectionIndex : null;
  }, [sectionIndex, previousRecallSectionRef, pendingRecallSectionRef]);
}