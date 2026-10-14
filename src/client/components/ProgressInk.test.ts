// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProgressInk } from "./ProgressInk";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProgressInk", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("renderiza con role progressbar y atributos aria legibles", () => {
    act(() => {
      root.render(
        h(ProgressInk, {
          value: 120,
          max: 180,
          floor: 90,
          level: 3,
          label: "Progreso al nivel 4",
        }),
      );
    });

    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute("aria-valuenow")).toBe("120");
    expect(bar?.getAttribute("aria-valuemin")).toBe("90");
    expect(bar?.getAttribute("aria-valuemax")).toBe("180");
    expect(bar?.getAttribute("aria-valuetext")).toBe("120 de 180 para el nivel 4");

    const fill = container.querySelector(".progress-ink-fill") as HTMLElement;
    expect(fill).toBeTruthy();
    // ratio = (120 - 90) / (180 - 90) = 30 / 90 = 0.3333
    expect(fill.style.transform).toContain("scaleX(0.3333");
  });

  it("actualiza suavemente el scaleX al cambiar el valor dentro del mismo nivel", () => {
    act(() => {
      root.render(
        h(ProgressInk, {
          value: 100,
          max: 200,
          floor: 0,
          level: 1,
        }),
      );
    });

    let fill = container.querySelector(".progress-ink-fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0.5)");

    act(() => {
      root.render(
        h(ProgressInk, {
          value: 150,
          max: 200,
          floor: 0,
          level: 1,
        }),
      );
    });

    fill = container.querySelector(".progress-ink-fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0.75)");
  });

  it("ejecuta la secuencia de subida de nivel: llena a 100%, pausa, resetea a 0% y llena al nuevo valor", () => {
    act(() => {
      root.render(
        h(ProgressInk, {
          value: 90,
          max: 90,
          floor: 30,
          level: 1,
        }),
      );
    });

    let fill = container.querySelector(".progress-ink-fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(1)");

    // Sube a nivel 2 con nuevo valor (110 de 180, floor 90)
    act(() => {
      root.render(
        h(ProgressInk, {
          value: 110,
          max: 180,
          floor: 90,
          level: 2,
        }),
      );
    });

    // Paso 1: Llena a 100%
    fill = container.querySelector(".progress-ink-fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(1)");

    // Paso 2: Tras 400ms cae a 0%
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fill = container.querySelector(".progress-ink-fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0)");

    // Paso 3: Tras 80ms más llena al nuevo valor: (110 - 90) / (180 - 90) = 20 / 90 ≈ 0.2222
    act(() => {
      vi.advanceTimersByTime(80);
    });
    fill = container.querySelector(".progress-ink-fill") as HTMLElement;
    expect(fill.style.transform).toContain("scaleX(0.2222");
  });

  it("con movimiento reducido salta directo al valor final sin animación intermedia", () => {
    act(() => {
      root.render(
        h(ProgressInk, {
          value: 80,
          max: 100,
          floor: 0,
          level: 1,
          reducedMotion: true,
        }),
      );
    });

    let fill = container.querySelector(".progress-ink-fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0.8)");
    expect(fill.style.transition).toBe("none");

    // Sube de nivel con movimiento reducido
    act(() => {
      root.render(
        h(ProgressInk, {
          value: 20,
          max: 100,
          floor: 0,
          level: 2,
          reducedMotion: true,
        }),
      );
    });

    // Salto inmediato a 0.2 sin pasar por 1 ni timers
    fill = container.querySelector(".progress-ink-fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0.2)");
    expect(fill.style.transition).toBe("none");
  });

  it("activa la animación de onda con pulseWave y con el evento de bloque concentrado", () => {
    act(() => {
      root.render(
        h(ProgressInk, {
          value: 50,
          max: 100,
          pulseWave: true,
        }),
      );
    });

    expect(container.querySelector(".progress-ink-wave-overlay")).toBeTruthy();

    // Después de 1200ms se apaga
    act(() => {
      vi.advanceTimersByTime(1250);
    });
    expect(container.querySelector(".progress-ink-wave-overlay")).toBeNull();

    // Se dispara vía evento global
    act(() => {
      window.dispatchEvent(new CustomEvent("lecta:focus-block-completed"));
    });
    expect(container.querySelector(".progress-ink-wave-overlay")).toBeTruthy();
  });
});
