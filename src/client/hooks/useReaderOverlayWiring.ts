// Cableado de overlays (glosario, resumen) mediante pushOverlay. Extraído de
// Reader.tsx (B7). Los refs se mantienen en Reader (summaryReleaseRef se
// usa también en el swap de cita, línea ~4015).
import { useEffect } from "react";
import { pushOverlay, type OverlayHandle } from "../lib/history";

type Ref<T> = { current: T };

type Deps<D> = {
  glossaryOpen: boolean;
  setGlossaryOpen: (v: boolean) => void;
  deepSummary: D | null;
  setDeepSummary: (v: D | null) => void;
  glossaryReleaseRef: Ref<OverlayHandle | null>;
  summaryReleaseRef: Ref<OverlayHandle | null>;
};

export function useReaderOverlayWiring<D>(deps: Deps<D>): void {
  const { glossaryOpen, setGlossaryOpen, deepSummary, setDeepSummary, glossaryReleaseRef, summaryReleaseRef } = deps;

  useEffect(() => {
    if (glossaryOpen) {
      if (!glossaryReleaseRef.current) {
        glossaryReleaseRef.current = pushOverlay(() => setGlossaryOpen(false));
      }
    } else {
      if (glossaryReleaseRef.current) {
        const handle = glossaryReleaseRef.current;
        glossaryReleaseRef.current = null;
        handle.release();
      }
    }
  }, [glossaryOpen, setGlossaryOpen, glossaryReleaseRef]);

  useEffect(() => {
    if (deepSummary) {
      if (!summaryReleaseRef.current) {
        summaryReleaseRef.current = pushOverlay(() => setDeepSummary(null));
      }
    } else {
      if (summaryReleaseRef.current) {
        const handle = summaryReleaseRef.current;
        summaryReleaseRef.current = null;
        handle.release();
      }
    }
  }, [deepSummary, setDeepSummary, summaryReleaseRef]);
}