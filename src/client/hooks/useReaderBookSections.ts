// Registra las secciones del libro en book-search (búsquedas sin spoilers).
// Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { registerBookSections, unregisterBookSections } from "../lib/book-search";
import type { SearchSection, SearchTocRow } from "../lib/book-search";

type Ref<T> = { current: T };

type Deps = {
  bookHash: string;
  state: string;
  bookRef: Ref<{ sections?: SearchSection[] } | null>;
  tocRowsRef: Ref<SearchTocRow[]>;
};

export function useReaderBookSections(deps: Deps): void {
  const { bookHash, state, bookRef, tocRowsRef } = deps;

  useEffect(() => {
    if (bookHash && bookRef.current?.sections) {
      registerBookSections(bookHash, bookRef.current.sections, tocRowsRef.current);
    }
    return () => {
      if (bookHash) unregisterBookSections(bookHash);
    };
  }, [bookHash, state, bookRef, tocRowsRef]);
}