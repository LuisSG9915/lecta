// Espejo de document.hidden en estado (para ahorro térmico). Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";

type Deps = {
  setDocHidden: (v: boolean) => void;
};

export function useReaderVisibility(deps: Deps): void {
  const { setDocHidden } = deps;

  useEffect(() => {
    const onVisibility = () => setDocHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [setDocHidden]);
}