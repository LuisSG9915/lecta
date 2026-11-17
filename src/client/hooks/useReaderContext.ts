import { useEffect } from "react";
import { pageOfElement } from "../lib/pagination";
import type { PageLayout } from "../lib/pagination";
import type {
  CompanionReaderContext,
  CompanionContextValue,
} from "../components/CompanionProvider";

type ContainerRef = { current: HTMLElement | null };
type BookRef = { current: { sections?: CompanionReaderContext["sections"] } | null };
type TocRowsRef = { current: CompanionReaderContext["toc"] };

type Deps = {
  companion: CompanionContextValue | null | undefined;
  containerRef: ContainerRef;
  settingsLayout: string;
  pageMetrics: PageLayout | null;
  page: number;
  sectionIndex: number;
  bookHash: string;
  language: string | null | undefined;
  bookRef: BookRef;
  tocRowsRef: TocRowsRef;
  state: string;
};

export function useReaderContext(deps: Deps): void {
  const {
    companion,
    containerRef,
    settingsLayout,
    pageMetrics,
    page,
    sectionIndex,
    bookHash,
    language,
    bookRef,
    tocRowsRef,
    state,
  } = deps;

  useEffect(() => {
    if (!companion?.setReaderContext) return;
    const container = containerRef.current;
    let pageText = "";
    if (container) {
      if (settingsLayout === "pages" && pageMetrics) {
        const paras = Array.from(
          container.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, blockquote, li"),
        );
        const pageParas = paras.filter((p) => pageOfElement(p, pageMetrics) === page);
        if (pageParas.length > 0) {
          pageText = pageParas.map((p) => p.textContent ?? "").join("\n\n");
        }
      }
      if (!pageText) {
        const paras = Array.from(
          container.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, blockquote, li"),
        );
        const viewH = window.innerHeight;
        const visible = paras.filter((p) => {
          const rect = p.getBoundingClientRect();
          return rect.bottom >= 0 && rect.top <= viewH;
        });
        if (visible.length > 0) {
          pageText = visible.map((p) => p.textContent ?? "").join("\n\n");
        }
      }
    }

    const ctx: CompanionReaderContext = {
      pageText,
      currentChapterIndex: sectionIndex,
      bookId: bookHash,
      sections: bookRef.current?.sections,
      toc: tocRowsRef.current,
      language: language ?? "es",
    };
    companion.setReaderContext(ctx);
    void state;
  }, [
    companion,
    page,
    sectionIndex,
    bookHash,
    settingsLayout,
    pageMetrics,
    state,
    language,
    containerRef,
    bookRef,
    tocRowsRef,
  ]);
}