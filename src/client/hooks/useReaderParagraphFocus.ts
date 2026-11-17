// Reenfoque del párrafo en modo foco al cambiar de sección o página.
// Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { updateParagraphFocus } from "../lib/paragraph-focus";

type Ref<T> = { current: T };

type Deps = {
  state: string;
  strategyPaused: boolean;
  paragraphFocus: boolean;
  focusMode: string;
  page: number;
  sectionIndex: number;
  containerRef: Ref<HTMLElement | null>;
};

export function useReaderParagraphFocus(deps: Deps): void {
  const { state, strategyPaused, paragraphFocus, focusMode, page, sectionIndex, containerRef } = deps;

  useEffect(() => {
    if (state !== "ready" || strategyPaused || (!paragraphFocus && focusMode !== "paragraph")) return;
    const container = containerRef.current;
    if (!container) return;
    const raf = requestAnimationFrame(() => {
      updateParagraphFocus(container);
    });
    return () => cancelAnimationFrame(raf);
  }, [focusMode, paragraphFocus, strategyPaused, state, page, sectionIndex, containerRef]);
}