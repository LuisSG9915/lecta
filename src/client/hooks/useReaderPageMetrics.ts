// Recuento de páginas y resolución del destino pendiente cuando cambian las
// métricas de paginación. Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { totalPages, pageForText, pageForFragment } from "../lib/pagination";
import type { PageLayout } from "../lib/pagination";
import type { SavedBookPosition } from "../lib/idb";
import type { DbScope } from "../lib/idb";
import { saveBookPosition } from "../lib/idb";

type Ref<T> = { current: T };

type PendingPage = {
  snippet?: string;
  fragment?: string;
  anchor?: string;
  at?: "end";
  ratio?: number;
} | null;

type Deps = {
  pageMetrics: PageLayout | null;
  layoutRef: Ref<string>;
  containerRef: Ref<HTMLElement | null>;
  pageCountRef: Ref<number>;
  pendingPageRef: Ref<PendingPage>;
  pageAnchorRef: Ref<string | null>;
  pageRef: Ref<number>;
  setPageCount: (n: number) => void;
  setPageIdx: (next: number, intent?: boolean) => void;
  capturePosition: () => SavedBookPosition | null;
  captureDbScope: () => DbScope;
};

export function useReaderPageMetrics(deps: Deps): void {
  const {
    pageMetrics,
    layoutRef,
    containerRef,
    pageCountRef,
    pendingPageRef,
    pageAnchorRef,
    pageRef,
    setPageCount,
    setPageIdx,
    capturePosition,
    captureDbScope,
  } = deps;

  useEffect(() => {
    const metrics = pageMetrics;
    if (!metrics || layoutRef.current !== "pages") return;
    let live = true;
    const run = () => {
      if (!live || layoutRef.current !== "pages") return;
      const container = containerRef.current;
      if (!container) return;
      const total = totalPages(container.scrollWidth, metrics);
      pageCountRef.current = total;
      setPageCount(total);
      const pending = pendingPageRef.current;
      pendingPageRef.current = null;
      let next = pageRef.current;
      let intent = false;
      if (pending) {
        intent = true;
        if (pending.snippet) next = pageForText(container, pending.snippet, metrics, "snippet") ?? 0;
        else if (pending.fragment) next = pageForFragment(container, pending.fragment, metrics) ?? 0;
        else if (pending.anchor) next = pageForText(container, pending.anchor, metrics, "anchor") ?? 0;
        else if (pending.at === "end") next = total - 1;
        else if (pending.ratio) next = Math.round(pending.ratio * (total - 1));
        else next = 0;
      } else if (pageAnchorRef.current) {
        next = pageForText(container, pageAnchorRef.current, metrics, "anchor", false) ?? pageRef.current;
      }
      setPageIdx(Math.min(next, total - 1), intent);
      if (pending) {
        const pos = capturePosition();
        if (pos) void saveBookPosition(pos, captureDbScope());
      }
    };
    const handle =
      document.hidden ? window.setTimeout(run, 60) : requestAnimationFrame(() => requestAnimationFrame(run));
    return () => {
      live = false;
      if (document.hidden) window.clearTimeout(handle);
      else cancelAnimationFrame(handle);
    };
  }, [pageMetrics, setPageIdx, capturePosition, layoutRef, containerRef, pageCountRef, pendingPageRef, pageAnchorRef, pageRef, setPageCount, captureDbScope]);
}