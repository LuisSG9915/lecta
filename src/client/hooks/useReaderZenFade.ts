// Escucha de actividad de puntero/toques para despertar la barra Zen.
// Extraído de Reader.tsx (B7).
import { useEffect } from "react";

type Ref<T> = { current: T };

type Deps = {
  isZenFaded: boolean;
  resetZenFadeTimer: () => void;
  lastActivityAtRef: Ref<number>;
  lastPointerCheckRef: Ref<number>;
  zenFadeTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
};

export function useReaderZenFade(deps: Deps): void {
  const { isZenFaded, resetZenFadeTimer, lastActivityAtRef, lastPointerCheckRef, zenFadeTimerRef } = deps;

  useEffect(() => {
    const onPointerActivity = (e: Event) => {
      lastActivityAtRef.current = Date.now();
      const now = performance.now();
      if (now - lastPointerCheckRef.current < 200) return;
      lastPointerCheckRef.current = now;
      let clientY = 0;
      if ("clientY" in e && typeof (e as { clientY: unknown }).clientY === "number") {
        clientY = (e as { clientY: number }).clientY;
      } else if ("touches" in e && (e as TouchEvent).touches.length > 0) {
        clientY = (e as TouchEvent).touches[0].clientY;
      }
      if (isZenFaded) {
        if ("clientY" in e || clientY < window.innerHeight / 3) {
          resetZenFadeTimer();
        }
      } else {
        resetZenFadeTimer();
      }
    };

    window.addEventListener("pointermove", onPointerActivity, { passive: true });
    window.addEventListener("touchstart", onPointerActivity, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerActivity);
      window.removeEventListener("touchstart", onPointerActivity);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (zenFadeTimerRef.current) clearTimeout(zenFadeTimerRef.current);
    };
  }, [isZenFaded, resetZenFadeTimer, lastActivityAtRef, lastPointerCheckRef, zenFadeTimerRef]);
}