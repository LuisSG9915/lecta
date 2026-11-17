// Crédito por libro terminado (progreso ≥ 0.995). Extraído de Reader.tsx (B7).
import { useEffect, useRef } from "react";
import type { CompanionSignal } from "../lib/companion-state";
import { award, localDayKey } from "../lib/game";
import { captureDbScope } from "../lib/idb";

type Deps = {
  progress: number;
  bookHash: string;
  signalCompanion: (signal: Omit<CompanionSignal, "at"> & { at?: number }) => void;
};

export function useReaderBookAward(deps: Deps): void {
  const { progress, bookHash, signalCompanion } = deps;
  const bookCheeredRef = useRef<string | null>(null);
  const bookAwardRef = useRef<{ hash: string; meta: { id: string; at: number; dayKey: string } } | null>(null);

  useEffect(() => {
    if (progress >= 0.995) {
      if (bookAwardRef.current?.hash !== bookHash) {
        const at = Date.now();
        bookAwardRef.current = {
          hash: bookHash,
          meta: {
            id: `book:${bookHash}:${crypto.randomUUID()}`,
            at,
            dayKey: localDayKey(at),
          },
        };
      }
      void award(
        { kind: "book_finished", bookHash },
        captureDbScope(),
        bookAwardRef.current.meta,
      );
      if (bookCheeredRef.current !== bookHash) {
        bookCheeredRef.current = bookHash;
        signalCompanion({ kind: "goal_completed" });
      }
    }
  }, [progress, bookHash, signalCompanion]);
}