import { type RefObject, useEffect, useRef } from "react";
import { triggerHaptic } from "./haptics";
import {
  claimSwipe,
  rubberBand,
  settleDuration,
  swipeOutcome,
} from "./page-gesture";

export interface UsePageGestureOptions {
  viewportRef: RefObject<HTMLElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  layout: "pages" | "scroll";
  page: number;
  pageCount: number;
  pageAdvance: number;
  isFirstPageInBook: boolean;
  isLastPageInBook: boolean;
  reducedMotion: boolean;
  onTurnPage: (delta: number) => Promise<unknown> | void;
}

interface PointerDragState {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastT: number;
  dx: number;
  velocity: number;
  swiping: boolean;
  rubberBanding: boolean;
}

export function usePageGesture({
  viewportRef,
  containerRef,
  layout,
  page,
  pageCount,
  pageAdvance,
  isFirstPageInBook,
  isLastPageInBook,
  reducedMotion,
  onTurnPage,
}: UsePageGestureOptions) {
  const dragRef = useRef<PointerDragState | null>(null);
  const shouldSuppressClick = useRef(false);
  const prevPageRef = useRef(page);
  const hapticTriggeredRef = useRef(false);

  // Inercia de rueda / trackpad
  const wheelAccumRef = useRef(0);
  const wheelLockedRef = useRef(false);
  const wheelResetTimerRef = useRef<number | undefined>(undefined);

  // Sincronización visual: cuando React actualiza `page` tras un pase confirmado,
  // el nuevo `--page-x` asume la posición. En ese instante restablecemos `--drag-x` a 0px
  // de forma instantánea para evitar saltos o acumulación residual.
  useEffect(() => {
    if (page !== prevPageRef.current) {
      prevPageRef.current = page;
      const container = containerRef.current;
      if (container) {
        container.style.transition = "none";
        container.style.setProperty("--drag-x", "0px");
        // Forzar reflujo y restaurar la transición definida en CSS
        void container.offsetWidth;
        container.style.transition = "";
      }
    }
  }, [page, containerRef]);

  // Gestión de eventos táctiles, puntero y trackpad
  useEffect(() => {
    const viewport = viewportRef.current;
    const container = containerRef.current;
    if (!viewport || !container || layout !== "pages") return;

    // Adaptar touch-action según el zoom del viewport:
    // Con visualViewport.scale > 1 se libera a 'auto' para permitir paneo del usuario.
    const updateTouchAction = () => {
      if (window.visualViewport && window.visualViewport.scale > 1.01) {
        viewport.style.touchAction = "auto";
      } else {
        viewport.style.touchAction = "pan-y pinch-zoom";
      }
    };
    updateTouchAction();
    window.visualViewport?.addEventListener("resize", updateTouchAction);

    // touchmove no pasivo para detener el desplazamiento nativo si el gesto horizontal fue reclamado
    const onTouchMove = (e: TouchEvent) => {
      if (dragRef.current?.swiping) {
        e.preventDefault();
      }
    };
    viewport.addEventListener("touchmove", onTouchMove, { passive: false });

    // Suprimir el evento click que el navegador despacha tras soltar un arrastre
    const onClickCapture = (e: MouseEvent) => {
      if (shouldSuppressClick.current) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        shouldSuppressClick.current = false;
      }
    };
    viewport.addEventListener("click", onClickCapture, { capture: true });

    // Rueda / trackpad de dos dedos con bloqueo por inercia
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

      // Movimiento horizontal en trackpad: prevenir historial 'atrás/adelante' del navegador
      e.preventDefault();

      if (wheelLockedRef.current) {
        window.clearTimeout(wheelResetTimerRef.current);
        wheelResetTimerRef.current = window.setTimeout(() => {
          wheelLockedRef.current = false;
          wheelAccumRef.current = 0;
        }, 250);
        return;
      }

      wheelAccumRef.current += e.deltaX;
      window.clearTimeout(wheelResetTimerRef.current);
      wheelResetTimerRef.current = window.setTimeout(() => {
        wheelAccumRef.current = 0;
      }, 200);

      if (Math.abs(wheelAccumRef.current) >= 60) {
        const delta = wheelAccumRef.current > 0 ? 1 : -1;
        wheelLockedRef.current = true;
        wheelAccumRef.current = 0;
        void onTurnPage(delta);
        wheelResetTimerRef.current = window.setTimeout(() => {
          wheelLockedRef.current = false;
        }, 250);
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });

    // Pointer events
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      if (window.visualViewport && window.visualViewport.scale > 1.01) return;
      if (dragRef.current) return;

      // No iniciar si hay múltiples toques (pellizco de zoom)
      if (!e.isPrimary) return;

      hapticTriggeredRef.current = false;
      dragRef.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastT: e.timeStamp,
        dx: 0,
        velocity: 0,
        swiping: false,
        rubberBanding: false,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.id) return;

      const rawDx = e.clientX - drag.startX;
      const rawDy = e.clientY - drag.startY;

      // Si aún no hemos reclamado el gesto:
      if (!drag.swiping) {
        // Si hay una selección de texto activa (ej. pulsación larga), no secuestrar
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          dragRef.current = null;
          return;
        }

        const claim = claimSwipe(rawDx, rawDy);
        if (claim === "cancel") {
          dragRef.current = null;
          return;
        }
        if (claim === "pending") {
          return;
        }

        // Reclamo confirmado
        drag.swiping = true;
        shouldSuppressClick.current = true;
        container.setAttribute("data-dragging", "true");
        viewport.setPointerCapture?.(e.pointerId);
      }

      // Calcular velocidad suavizada
      const dt = e.timeStamp - drag.lastT;
      if (dt > 0) {
        const instantVel = (e.clientX - drag.lastX) / dt;
        drag.velocity = drag.velocity * 0.7 + instantVel * 0.3;
        drag.lastX = e.clientX;
        drag.lastT = e.timeStamp;
      }

      // Resistencia elástica (rubber band) en los bordes del libro
      let effectiveDx = rawDx;
      const atStartBoundary = isFirstPageInBook && page === 0 && rawDx > 0;
      const atEndBoundary = isLastPageInBook && page === pageCount - 1 && rawDx < 0;

      if (atStartBoundary || atEndBoundary) {
        effectiveDx = rubberBand(rawDx);
        drag.rubberBanding = true;
        if (!hapticTriggeredRef.current && Math.abs(rawDx) > 25) {
          triggerHaptic("selection");
          hapticTriggeredRef.current = true;
        }
      } else {
        drag.rubberBanding = false;
      }

      drag.dx = effectiveDx;
      container.style.setProperty("--drag-x", `${effectiveDx}px`);
    };

    const finishDrag = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.id) return;
      dragRef.current = null;

      if (!drag.swiping) return;

      try {
        viewport.releasePointerCapture?.(e.pointerId);
      } catch {
        // Ignorar si el puntero ya no estaba capturado
      }
      container.removeAttribute("data-dragging");

      const width = viewport.offsetWidth || 300;
      let outcome = drag.rubberBanding
        ? (0 as const)
        : swipeOutcome({
            dx: drag.dx,
            velocity: drag.velocity,
            width,
          });

      // No permitir avanzar más allá del final ni retroceder antes del inicio
      if (outcome === -1 && isFirstPageInBook && page === 0) outcome = 0;
      if (outcome === 1 && isLastPageInBook && page === pageCount - 1) outcome = 0;

      if (reducedMotion) {
        container.style.setProperty("--drag-x", "0px");
        if (outcome !== 0) {
          void onTurnPage(outcome);
        }
        return;
      }

      if (outcome === 0) {
        // Volver a la página actual con animación de asentamiento
        const dur = settleDuration(drag.dx, drag.velocity);
        container.style.transition = `transform ${dur}ms var(--ease-settle, cubic-bezier(0.16, 1, 0.3, 1))`;
        container.style.setProperty("--drag-x", "0px");
        const onSettled = () => {
          container.style.transition = "";
          container.removeEventListener("transitionend", onSettled);
        };
        container.addEventListener("transitionend", onSettled, { once: true });
        window.setTimeout(onSettled, dur + 40);
      } else {
        // Pase confirmado: animar hacia la siguiente/anterior columna antes del render
        const targetDragX = outcome === 1 ? -pageAdvance : pageAdvance;
        const remaining = Math.abs(targetDragX - drag.dx);
        const dur = settleDuration(remaining, drag.velocity);

        container.style.transition = `transform ${dur}ms var(--ease-page, cubic-bezier(0.2, 0.8, 0.2, 1))`;
        container.style.setProperty("--drag-x", `${targetDragX}px`);

        const turnPromise = onTurnPage(outcome);

        // Si es un salto de capítulo o navegación asíncrona, esperar la carga
        if (turnPromise && typeof (turnPromise as Promise<unknown>).then === "function") {
          void (turnPromise as Promise<unknown>).finally(() => {
            container.style.transition = "none";
            container.style.setProperty("--drag-x", "0px");
            void container.offsetWidth;
            container.style.transition = "";
          });
        }
      }
    };

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", finishDrag);
    viewport.addEventListener("pointercancel", finishDrag);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateTouchAction);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("click", onClickCapture, { capture: true });
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", finishDrag);
      viewport.removeEventListener("pointercancel", finishDrag);
      window.clearTimeout(wheelResetTimerRef.current);
    };
  }, [
    viewportRef,
    containerRef,
    layout,
    page,
    pageCount,
    pageAdvance,
    isFirstPageInBook,
    isLastPageInBook,
    reducedMotion,
    onTurnPage,
  ]);
}
