// Precarga del índice de locuciones (asset estático) al montar el lector.
// Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { loadPhrases } from "../lib/phrases";
import type { PhraseIndex } from "../lib/phrases";

type Ref<T> = { current: T };

type Deps = {
  phrasesRef: Ref<PhraseIndex | null>;
};

export function useReaderPhrases(deps: Deps): void {
  const { phrasesRef } = deps;

  useEffect(() => {
    let cancelled = false;
    void loadPhrases().then((index) => {
      if (!cancelled) phrasesRef.current = index;
    });
    return () => {
      cancelled = true;
    };
  }, [phrasesRef]);
}