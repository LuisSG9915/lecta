// Espejo de zipfForLemma en un ref estable. Extraído de Reader.tsx (B7).
import { useEffect } from "react";

type Ref<T> = { current: T };

type Deps = {
  zipfForLemma: (lemma: string) => number | null;
  zipfForLemmaRef: Ref<((lemma: string) => number | null) | null>;
};

export function useReaderZipfForLemmaRef(deps: Deps): void {
  const { zipfForLemma, zipfForLemmaRef } = deps;

  useEffect(() => {
    zipfForLemmaRef.current = zipfForLemma;
  }, [zipfForLemma, zipfForLemmaRef]);
}