// Aviso único por libro en inglés: el doble toque traduce el párrafo. Sólo para
// cuentas con Lecta+ (a las demás el gesto les respondería 402).
import { useEffect } from "react";
import { hasLectaPlus } from "../../shared/plan";
import { planStore } from "../lib/account-plan";
import { captureDbScope, loadSessionValue, saveSessionValue } from "../lib/idb";

type Deps = {
  state: string;
  language: string;
  bookHash: string;
  setToastMessage: (msg: string) => void;
};

export function useReaderTranslateHint(deps: Deps): void {
  const { state, language, bookHash, setToastMessage } = deps;

  useEffect(() => {
    if (state !== "ready" || language !== "en") return;
    if (!hasLectaPlus(planStore.get()?.plan)) return;

    const coarse =
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);
    const key = `hint:dblTranslate:v1:${bookHash}`;
    const scope = captureDbScope();
    let cancelled = false;
    void loadSessionValue(key, scope).then((seen) => {
      if (seen || cancelled) return;
      setToastMessage(
        coarse ? "Toca dos veces un párrafo para traducirlo." : "Doble clic en un párrafo para traducirlo.",
      );
      void saveSessionValue(key, "1", scope).catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [state, language, bookHash, setToastMessage]);
}
