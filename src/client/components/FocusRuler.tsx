// Archivo: src/client/components/FocusRuler.tsx
import React, { useState, useEffect, useCallback } from 'react';
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

  // En escritorio, seguir suavemente el cursor sólo si NO está fijada ni arrastrándose
  useEffect(() => {
    if (!enabled || pinned || dragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      setY(clampRulerY(e.clientY));
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [enabled, pinned, dragging]);

  const togglePin = useCallback(
    (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setPinned((prev) => {
        const next = !prev;
        onPinnedChange?.(next, y);
        return next;
      });
    },
    [y, onPinnedChange],
  );

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignorar fallo de pointer capture en entornos sin soporte (p.ej. jsdom)
    }
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!dragging) return;
      e.stopPropagation();
      const nextY = clampRulerY(e.clientY);
      setY(nextY);
    },
    [dragging],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!dragging) return;
      e.stopPropagation();
      try {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }
      } catch {
        // Ignorar fallo de pointer capture en entornos sin soporte
      }
      setDragging(false);
      // Al terminar de arrastrar en móvil, dejarla fijada en esa posición
      setPinned(true);
      onPinnedChange?.(true, y);
    },
    [dragging, y, onPinnedChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setY((prev) => clampRulerY(prev - 16));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setY((prev) => clampRulerY(prev + 16));
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
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setY((prev) => clampRulerY(prev - 16));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setY((prev) => clampRulerY(prev + 16));
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      className={`focus-ruler ${pinned ? 'is-pinned' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{
        top: `${Math.max(48, y - effectiveHeight / 2)}px`,
        height: `${effectiveHeight}px`,
      }}
      data-testid="focus-ruler"
    >
      <div className="focus-ruler__band focus-ruler-band" aria-hidden="true" />
      <button
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
        onKeyDown={handleKeyDown}
      >
        <span className="focus-ruler__grip" aria-hidden="true">
          {pinned ? '📌' : '⋮'}
        </span>
      </button>
    </div>
  );
}
