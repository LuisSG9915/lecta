// Archivo: src/client/components/FocusRuler.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from './Icon';
import type { RulerSize } from '../lib/settings';

export const RULER_PARAGRAPH_LINES = 6;

export function rulerBandPx(size: RulerSize, linePx: number): number {
  const lines = size === 'paragraph' ? RULER_PARAGRAPH_LINES : size;
  return Math.max(1, Math.round(lines * linePx));
}

export interface FocusRulerProps {
  enabled?: boolean;
  heightPx?: number;
  bandPx?: number;
  initialY?: number;
  onPinnedChange?: (pinned: boolean, y: number) => void;
  anchor?: React.ReactNode;
  lineHeightPx?: number;
  onClose?: () => void;
}

const MIN_Y_PX = 64;
const BOTTOM_MARGIN_PX = 96;

export function clampRulerY(
  clientY: number,
  viewportHeight: number = typeof window !== 'undefined' ? window.innerHeight : 800,
): number {
  const maxY = Math.max(MIN_Y_PX, viewportHeight - BOTTOM_MARGIN_PX);
  return Math.max(MIN_Y_PX, Math.min(maxY, clientY));
}

function rulerTransformFor(nextY: number, bandHeight: number): string {
  const topPx = Math.max(48, nextY - bandHeight / 2);
  return `translate3d(0, ${topPx}px, 0)`;
}

export function FocusRuler({
  enabled = true,
  heightPx = 56,
  bandPx,
  initialY = 220,
  onPinnedChange,
}: FocusRulerProps) {
  const effectiveHeight = heightPx ?? bandPx ?? 56;
  const [y, setY] = useState<number>(initialY);
  const [pinned, setPinned] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);

  const rulerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const yRef = useRef<number>(initialY);
  const draggingRef = useRef<boolean>(false);
  const dragOffsetRef = useRef<number>(0);
  const dragStartYRef = useRef<number>(0);
  const movedDuringDragRef = useRef<boolean>(false);
  const suppressNextClickRef = useRef<boolean>(false);
  const rafIdRef = useRef<number | null>(null);

  const applyTransform = useCallback(
    (nextY: number) => {
      if (rulerRef.current) {
        rulerRef.current.style.transform = rulerTransformFor(nextY, effectiveHeight);
      }
    },
    [effectiveHeight],
  );

  // En escritorio, seguir suavemente el puntero de ratón si NO está fijada ni arrastrándose
  useEffect(() => {
    if (!enabled || pinned || dragging) return;
    const handlePointerFollow = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const nextY = clampRulerY(e.clientY);
      yRef.current = nextY;
      setY(nextY);
    };
    window.addEventListener('pointermove', handlePointerFollow, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerFollow);
  }, [enabled, pinned, dragging]);

  // En táctil, bloquear scroll nativo mientras se arrastra el tirador (React registra touchmove pasivo)
  useEffect(() => {
    const el = handleRef.current;
    if (!enabled || !el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (draggingRef.current) {
        e.preventDefault();
      }
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [enabled]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const togglePin = useCallback(
    (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      const currentY = yRef.current;
      setPinned((prev) => {
        const next = !prev;
        onPinnedChange?.(next, currentY);
        return next;
      });
    },
    [onPinnedChange],
  );

  const moveToClientY = useCallback(
    (clientY: number) => {
      if (!draggingRef.current) return;
      if (Math.abs(clientY - dragStartYRef.current) > 4) {
        movedDuringDragRef.current = true;
      }
      const nextY = clampRulerY(clientY + dragOffsetRef.current);
      yRef.current = nextY;
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          applyTransform(yRef.current);
        });
      }
    },
    [applyTransform],
  );

  const finishDrag = useCallback(
    (e?: { currentTarget?: HTMLButtonElement; pointerId?: number }) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const finalY = yRef.current;
      applyTransform(finalY);
      const target = e?.currentTarget ?? handleRef.current;
      if (target && typeof e?.pointerId === 'number') {
        try {
          if (target.hasPointerCapture?.(e.pointerId)) {
            target.releasePointerCapture?.(e.pointerId);
          }
        } catch {
          // Ignorar fallo de pointer capture en entornos sin soporte
        }
      }
      setDragging(false);
      setY(finalY);
      // Solo un arrastre fija aquí. Un toque sin movimiento lo resuelve el
      // click que llega después (togglePin): fijar también aquí hacía que ese
      // click la soltara al instante.
      if (movedDuringDragRef.current) {
        suppressNextClickRef.current = true;
        setPinned(true);
        onPinnedChange?.(true, finalY);
      }
    },
    [applyTransform, onPinnedChange],
  );

  const cancelDrag = useCallback(
    (e?: { currentTarget?: HTMLButtonElement; pointerId?: number }) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const finalY = yRef.current;
      applyTransform(finalY);
      const target = e?.currentTarget ?? handleRef.current;
      if (target && typeof e?.pointerId === 'number') {
        try {
          if (target.hasPointerCapture?.(e.pointerId)) {
            target.releasePointerCapture?.(e.pointerId);
          }
        } catch {
          // Ignorar fallo de pointer capture en entornos sin soporte
        }
      }
      setDragging(false);
      setY(finalY);
    },
    [applyTransform],
  );

  // Continuar arrastre en window si el pulgar sale horizontalmente del tirador
  useEffect(() => {
    if (!dragging) return;
    const onWindowMove = (e: PointerEvent) => {
      moveToClientY(e.clientY);
    };
    const onWindowUp = (e: PointerEvent) => {
      finishDrag({ pointerId: e.pointerId });
    };
    const onWindowCancel = (e: PointerEvent) => {
      cancelDrag({ pointerId: e.pointerId });
    };
    window.addEventListener('pointermove', onWindowMove, { passive: true });
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowCancel);
    return () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowCancel);
    };
  }, [dragging, moveToClientY, finishDrag, cancelDrag]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    draggingRef.current = true;
    movedDuringDragRef.current = false;
    suppressNextClickRef.current = false;
    dragStartYRef.current = e.clientY;
    dragOffsetRef.current = yRef.current - e.clientY;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignorar fallo de pointer capture en entornos sin soporte (p.ej. jsdom)
    }
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      e.stopPropagation();
      moveToClientY(e.clientY);
    },
    [moveToClientY],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      e.stopPropagation();
      finishDrag(e);
    },
    [finishDrag],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      e.stopPropagation();
      cancelDrag(e);
    },
    [cancelDrag],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setY((prev) => {
          const next = clampRulerY(prev - 16);
          yRef.current = next;
          return next;
        });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setY((prev) => {
          const next = clampRulerY(prev + 16);
          yRef.current = next;
          return next;
        });
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        togglePin(e);
      }
    },
    [togglePin],
  );

  // Escuchar también teclas de flecha a nivel de ventana cuando la regla esté habilitada
  useEffect(() => {
    if (!enabled) return;
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      // Ya lo movió el tirador enfocado (sin esto, cada flecha movía 32 px).
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      // Las flechas de los controles (menús, segmentados, selects…) siguen
      // siendo suyas: la regla solo las toma sobre el texto.
      if (
        target &&
        (target.isContentEditable ||
          target.closest?.(
            'input, textarea, select, button, a[href], [role="slider"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="radiogroup"], [role="tablist"], [role="dialog"]',
          ))
      ) {
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setY((prev) => {
          const next = clampRulerY(prev - 16);
          yRef.current = next;
          return next;
        });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setY((prev) => {
          const next = clampRulerY(prev + 16);
          yRef.current = next;
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={rulerRef}
      className={`focus-ruler ${pinned ? 'is-pinned' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{
        top: 0,
        height: `${effectiveHeight}px`,
        transform: rulerTransformFor(y, effectiveHeight),
      }}
      data-testid="focus-ruler"
    >
      <div className="focus-ruler__band focus-ruler-band" aria-hidden="true" />
      <button
        ref={handleRef}
        type="button"
        className="focus-ruler__handle"
        aria-pressed={pinned}
        aria-label={
          pinned
            ? 'Regla de lectura fijada. Toca para soltar o arrastra para mover'
            : 'Fijar o arrastrar regla de lectura'
        }
        title={pinned ? 'Toca para soltar · Arrastra para mover' : 'Toca para fijar · Arrastra para mover'}
        onClick={togglePin}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
      >
        <span className="focus-ruler__grip" aria-hidden="true">
          {pinned ? <Icon name="pin" size={14} /> : '⋮'}
        </span>
      </button>
    </div>
  );
}
