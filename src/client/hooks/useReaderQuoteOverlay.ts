// Cableado del overlay de cita (quoteCard) mediante pushOverlay. Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";
import { pushOverlay, type OverlayHandle } from "../lib/history";

type Ref<T> = { current: T };

type Deps<Q> = {
  quoteCard: Q | null;
  setQuoteCard: (v: Q | null) => void;
  quoteReleaseRef: Ref<OverlayHandle | null>;
};

export function useReaderQuoteOverlay<Q>(deps: Deps<Q>): void {
  const { quoteCard, setQuoteCard, quoteReleaseRef } = deps;

  useEffect(() => {
    if (quoteCard) {
      if (!quoteReleaseRef.current) {
        quoteReleaseRef.current = pushOverlay(() => setQuoteCard(null));
      }
    } else {
      if (quoteReleaseRef.current) {
        const handle = quoteReleaseRef.current;
        quoteReleaseRef.current = null;
        handle.release();
      }
    }
  }, [quoteCard, setQuoteCard, quoteReleaseRef]);
}