// Hook extraído de Reader.tsx (R3d, parcial): ResizeObserver + document.fonts.ready
// que disparan remeasure en modo páginas. Preserva el guard y las deps originales.
import { useEffect } from "react";

export type UseReaderResizeRemeasureParams = {
  settings: { layout: string };
  state: string;
  sectionIndex: number;
  viewportRef: { current: HTMLElement | null };
  remeasure: () => void;
};

export function useReaderResizeRemeasure({
  settings,
  state,
  sectionIndex,
  viewportRef,
  remeasure,
}: UseReaderResizeRemeasureParams): void {
  useEffect(() => {
    if (settings.layout !== "pages" || state !== "ready") return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    let timer: number | undefined;
    let cancelled = false;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(remeasure, 120);
    });
    observer.observe(viewport);
    void document.fonts?.ready?.then?.(() => {
      if (!cancelled) remeasure();
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [settings.layout, state, sectionIndex, remeasure, viewportRef]);
}