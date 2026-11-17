// Aviso único de descubrimiento para la pulsación larga (táctil). Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";
import { captureDbScope, loadSessionValue, saveSessionValue } from "../lib/idb";

type Deps = {
  state: string;
  setShowLongPressHint: (v: boolean) => void;
};

export function useReaderLongPressHint(deps: Deps): void {
  const { state, setShowLongPressHint } = deps;

  useEffect(() => {
    if (state !== "ready") return;
    const isTouchDevice =
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);
    if (!isTouchDevice) return;

    const key = "hint:longPress:v1";
    const scope = captureDbScope();
    let timer: number | undefined;
    void loadSessionValue(key, scope).then((seen) => {
      if (!seen) {
        setShowLongPressHint(true);
        timer = window.setTimeout(() => {
          setShowLongPressHint(false);
          void saveSessionValue(key, "1", scope).catch(() => undefined);
        }, 9000);
      }
    });
    return () => window.clearTimeout(timer);
  }, [state, setShowLongPressHint]);
}