// Aviso de ayuda de vocabulario al abrir un libro por primera vez.
// Extraído de Reader.tsx (B7).
import { useEffect, useRef } from "react";
import { captureDbScope, loadBookPosition, loadSessionValue } from "../lib/idb";
import type { DbScope } from "../lib/idb";
import { bookHelpKey, resolveBookHelpOpening, saveBookMicroHighlightsEnabled } from "../lib/attention-budget";
import { languageCalibrationStatus } from "../lib/calibration";

type Deps = {
  state: string;
  sectionIndex: number;
  language: string | null | undefined;
  bookHash: string;
  setHelpIsCalibrated: (v: boolean) => void;
  setHelpNotice: (v: boolean) => void;
};

export function useReaderHelpNotice(deps: Deps): void {
  const { state, sectionIndex, language, bookHash, setHelpIsCalibrated, setHelpNotice } = deps;
  const helpAskedRef = useRef<string | null>(null);

  useEffect(() => {
    if (state !== "ready" || sectionIndex !== 0) return;
    if (language !== "es" && language !== "en") return;
    if (helpAskedRef.current === bookHash) return;
    let cancelled = false;
    void (async () => {
      const scope: DbScope = captureDbScope();
      const [decision, saved] = await Promise.all([
        loadSessionValue(bookHelpKey(bookHash), scope).catch(() => null),
        loadBookPosition(bookHash, scope).catch(() => null),
      ]);
      if (cancelled || helpAskedRef.current === bookHash) return;
      const isNewBook =
        !saved || (saved.sectionIndex === 0 && (saved.ratio ?? 0) < 0.02);
      const outcome = resolveBookHelpOpening(decision, isNewBook);
      if (outcome === "none") return;
      helpAskedRef.current = bookHash;
      if (outcome !== "ask") {
        saveBookMicroHighlightsEnabled(bookHash, outcome === "apply-on");
        return;
      }
      setHelpIsCalibrated(languageCalibrationStatus(language as string) === "calibrated");
      setHelpNotice(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [state, sectionIndex, language, bookHash, setHelpIsCalibrated, setHelpNotice]);
}