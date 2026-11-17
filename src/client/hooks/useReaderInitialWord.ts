// Abre la ficha de la palabra inicial al montar el lector (cuando el libro
// se abre con ?palabra=...). Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import type { WordHit } from "../lib/words";

type Deps = {
  readerInitialWord: string | undefined;
  state: string;
  setSelection: (v: WordHit | null) => void;
};

export function useReaderInitialWord(deps: Deps): void {
  const { readerInitialWord, state, setSelection } = deps;

  useEffect(() => {
    if (readerInitialWord && state === "ready") {
      queueMicrotask(() => {
        setSelection({ word: readerInitialWord });
      });
    }
  }, [readerInitialWord, state, setSelection]);
}