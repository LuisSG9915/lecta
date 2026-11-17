// Escucha de prefers-reduced-motion para ahorro térmico. Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";

type Deps = {
  setSystemReducedMotion: (v: boolean) => void;
};

export function useReaderReducedMotion(deps: Deps): void {
  const { setSystemReducedMotion } = deps;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setSystemReducedMotion(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [setSystemReducedMotion]);
}