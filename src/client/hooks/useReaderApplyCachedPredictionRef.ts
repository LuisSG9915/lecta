// Espejo de applyCachedPrediction en un ref estable. Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";
import type { SectionPrediction } from "../lib/knowledge";

type Ref<T> = { current: T };

type Deps = {
  applyCachedPrediction: (index: number, lang: string) => SectionPrediction | null;
  applyCachedPredictionRef: Ref<((index: number, lang: string) => SectionPrediction | null) | null>;
};

export function useReaderApplyCachedPredictionRef(deps: Deps): void {
  const { applyCachedPrediction, applyCachedPredictionRef } = deps;

  useEffect(() => {
    applyCachedPredictionRef.current = applyCachedPrediction;
  }, [applyCachedPrediction, applyCachedPredictionRef]);
}