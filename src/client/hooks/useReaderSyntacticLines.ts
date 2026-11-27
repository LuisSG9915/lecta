// «Líneas sintácticas»: envuelve el texto montado y reubica la lectura al
// mismo ancla tras el reflujo. Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { applySyntacticLines, clearSyntacticLines } from "../lib/syntactic-lines";
import { updateParagraphFocus, clearParagraphFocus } from "../lib/paragraph-focus";
import { scrollToAnchor } from "../lib/reading-location";
import type { SavedBookPosition } from "../lib/idb";

type Ref<T> = { current: T };

type TtsRef = Ref<{ onDomMutated: () => void } | null>;

type Deps = {
  state: string;
  language: string;
  strategyPaused: boolean;
  focusMode: string;
  syntacticLines: boolean;
  chromaticGuide: boolean;
  chromaticPalette: string;
  bionicAnchors: boolean;
  paragraphFocus: boolean;
  visualPacer: boolean;
  layoutRef: Ref<string>;
  containerRef: Ref<HTMLElement | null>;
  latestPositionRef: Ref<SavedBookPosition | null>;
  ttsRef: TtsRef;
  remeasure: () => void;
};

export function useReaderSyntacticLines(deps: Deps): void {
  const {
    state,
    language,
    strategyPaused,
    focusMode,
    syntacticLines,
    chromaticGuide,
    chromaticPalette,
    bionicAnchors,
    paragraphFocus,
    visualPacer,
    layoutRef,
    containerRef,
    latestPositionRef,
    ttsRef,
    remeasure,
  } = deps;

  useEffect(() => {
    if (state !== "ready") return;
    const container = containerRef.current;
    if (!container) return;
    const raf = requestAnimationFrame(() => {
      const isChroma = Boolean(chromaticGuide || focusMode === "chromatic");
      const needsLines =
        !strategyPaused &&
        (syntacticLines || focusMode === "syntactic" || isChroma || bionicAnchors || visualPacer);
      if (needsLines) {
        applySyntacticLines(container, {
          syntacticLines,
          chromaticGuide: isChroma,
          bionicAnchors,
          ensureChunks: Boolean(visualPacer),
          lang: language,
        });
      } else {
        clearSyntacticLines(container);
      }

      container.dataset.chromaPalette = chromaticPalette || "editorial";
      container.dataset.chromaticGuide = isChroma && !strategyPaused ? "true" : "false";
      container.dataset.bionicAnchors = bionicAnchors && !strategyPaused ? "true" : "false";

      if (!strategyPaused && (paragraphFocus || focusMode === "paragraph")) updateParagraphFocus(container);
      else clearParagraphFocus(container);

      ttsRef.current?.onDomMutated();
      if (layoutRef.current === "pages") {
        remeasure();
      } else {
        const saved = latestPositionRef.current;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (!saved?.anchor || !scrollToAnchor(container, saved.anchor, { offset: saved.anchorOffset })) {
          window.scrollTo(0, (saved?.ratio ?? 0) * Math.max(0, max));
        }
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    language,
    focusMode,
    syntacticLines,
    chromaticGuide,
    chromaticPalette,
    bionicAnchors,
    paragraphFocus,
    visualPacer,
    strategyPaused,
    state,
    remeasure,
    latestPositionRef,
    ttsRef,
  ]);
}