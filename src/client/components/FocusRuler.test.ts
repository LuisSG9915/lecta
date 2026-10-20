// @vitest-environment jsdom
// Archivo: src/client/components/FocusRuler.test.ts
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampRulerY, FocusRuler, rulerBandPx, RULER_PARAGRAPH_LINES } from './FocusRuler';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('FocusRuler — Tirador lateral y límites de viewport', () => {
  it('restringe la posición Y dentro de los márgenes seguros del lector', () => {
    expect(clampRulerY(10, 667)).toBe(64);     // Respeta el tope superior (64px)
    expect(clampRulerY(300, 667)).toBe(300);   // Posición válida central
    expect(clampRulerY(640, 667)).toBe(571);   // Respeta el margen inferior del dock (667 - 96)
  });

  it('mantiene un mínimo seguro incluso en viewports muy reducidos', () => {
    expect(clampRulerY(200, 120)).toBe(64);
  });

  it('calcula rulerBandPx correctamente para números de línea y párrafo', () => {
    expect(RULER_PARAGRAPH_LINES).toBe(6);
    expect(rulerBandPx(1, 24)).toBe(24);
    expect(rulerBandPx(3, 20)).toBe(60);
    expect(rulerBandPx('paragraph', 25)).toBe(150);
  });
});

describe('FocusRuler — Componente y desambiguación de eventos', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renderiza la franja y el tirador lateral', () => {
    act(() => {
      root.render(h(FocusRuler, { heightPx: 56, initialY: 220 }));
    });

    const ruler = container.querySelector('.focus-ruler');
    const band = container.querySelector('.focus-ruler__band');
    const handle = container.querySelector('.focus-ruler__handle');

    expect(ruler).not.toBeNull();
    expect(band).not.toBeNull();
    expect(handle).not.toBeNull();
  });

  it('alterna fijado (is-pinned) y notifica con onPinnedChange al hacer click en el tirador', () => {
    const onPinnedChange = vi.fn();
    act(() => {
      root.render(h(FocusRuler, { heightPx: 56, initialY: 220, onPinnedChange }));
    });

    const ruler = container.querySelector('.focus-ruler') as HTMLElement;
    const handle = container.querySelector('.focus-ruler__handle') as HTMLButtonElement;
    const grip = container.querySelector('.focus-ruler__grip') as HTMLElement;

    expect(ruler.classList.contains('is-pinned')).toBe(false);
    expect(grip.textContent).toBe('⋮');

    act(() => {
      handle.click();
    });

    expect(ruler.classList.contains('is-pinned')).toBe(true);
    expect(grip.textContent).toBe('📌');
    expect(onPinnedChange).toHaveBeenCalledWith(true, 220);

    act(() => {
      handle.click();
    });

    expect(ruler.classList.contains('is-pinned')).toBe(false);
    expect(grip.textContent).toBe('⋮');
    expect(onPinnedChange).toHaveBeenCalledWith(false, 220);
  });

  it('permite arrastrar el tirador y fija la regla al soltar', () => {
    const onPinnedChange = vi.fn();
    act(() => {
      root.render(h(FocusRuler, { heightPx: 60, initialY: 200, onPinnedChange }));
    });

    const ruler = container.querySelector('.focus-ruler') as HTMLElement;
    const handle = container.querySelector('.focus-ruler__handle') as HTMLButtonElement;

    act(() => {
      handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 200 }));
    });
    expect(ruler.classList.contains('is-dragging')).toBe(true);

    act(() => {
      handle.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 350 }));
    });

    act(() => {
      handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 350 }));
    });

    expect(ruler.classList.contains('is-dragging')).toBe(false);
    expect(ruler.classList.contains('is-pinned')).toBe(true);
    expect(onPinnedChange).toHaveBeenCalledWith(true, 350);
  });

  it('no renderiza nada cuando enabled es false', () => {
    act(() => {
      root.render(h(FocusRuler, { enabled: false }));
    });

    expect(container.querySelector('.focus-ruler')).toBeNull();
  });
});
