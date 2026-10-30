// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { keepAnchorStable } from "./reading-location";
import {
  findEpisodicHighlightRange,
  getStabilitySegments,
  safeStability,
} from "../components/Vocabulary";
import { cleanPosition } from "../../shared/reading-data";

describe("Hueco 2.1 — keepAnchorStable ante imágenes asíncronas > 2.500 ms", () => {
  it("re-estabiliza el ancla cuando una imagen carga en el segundo 3.5 si el usuario no tocó la pantalla", () => {
    vi.useFakeTimers();
    let scrollY = 100;
    const scrollTo = vi.fn((_x: number, y: number) => {
      scrollY = y;
    });
    const origScrollTo = window.scrollTo;
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 4000,
    });

    const container = document.createElement("div");
    const img = document.createElement("img");
    const p = document.createElement("p");
    p.textContent = "Ancla del párrafo principal de prueba";
    let currentTop = 0;
    vi.spyOn(p, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          top: currentTop,
          bottom: currentTop + 100,
          left: 0,
          right: 0,
          width: 600,
          height: 100,
          x: 0,
          y: currentTop,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    container.append(img, p);
    document.body.append(container);

    try {
      const stop = keepAnchorStable(container, "Ancla del párrafo principal de prueba", 0);
      // Pasan 3.500 ms (más allá de los 2.500 ms del bucle RAF)
      vi.advanceTimersByTime(3500);
      expect(scrollTo).not.toHaveBeenCalled();

      // La imagen termina de cargar en el segundo 3.5 y empuja el párrafo 320px hacia abajo
      currentTop = 320;
      img.dispatchEvent(new Event("load", { bubbles: false }));

      expect(scrollTo).toHaveBeenCalledWith(0, 420);
      stop();
    } finally {
      vi.useRealTimers();
      window.scrollTo = origScrollTo;
      container.remove();
    }
  });
});

describe("Hueco 2.2 — cleanPosition preserva y acota anchorOffset", () => {
  it("conserva anchorOffset válido en [0, 1] y recorta valores fuera de rango", () => {
    expect(cleanPosition({ bookHash: "h1", anchor: "Texto", anchorOffset: 0.45 })?.anchorOffset).toBe(0.45);
    expect(cleanPosition({ bookHash: "h1", anchor: "Texto", anchorOffset: 1.8 })?.anchorOffset).toBe(1);
    expect(cleanPosition({ bookHash: "h1", anchor: "Texto", anchorOffset: -0.3 })?.anchorOffset).toBe(0);
    expect(cleanPosition({ bookHash: "h1", anchor: "Texto", anchorOffset: "invalido" })?.anchorOffset).toBeNull();
  });
});

describe("Hueco 3.1 — findEpisodicHighlightRange con flexión morfológica y signos", () => {
  it("encuentra formas conjugadas cuando el objetivo es el infinitivo/lema", () => {
    const passage = "Aquella noche los caballos corrían sin descanso por la llanura.";
    const range = findEpisodicHighlightRange(passage, "correr", "correr");
    expect(range).not.toBeNull();
    expect(passage.slice(range!.start, range!.end)).toBe("corrían");
  });

  it("resuelve verbos con diptongación española (dormir -> duermen, pensar -> piensa)", () => {
    const passage = "Todos duermen mientras ella piensa en el viaje.";
    const r1 = findEpisodicHighlightRange(passage, "dormir", "dormir");
    const r2 = findEpisodicHighlightRange(passage, "pensar", "pensar");
    expect(passage.slice(r1!.start, r1!.end)).toBe("duermen");
    expect(passage.slice(r2!.start, r2!.end)).toBe("piensa");
  });

  it("ignora signos de puntuación adyacentes en la forma guardada", () => {
    const passage = "El silencio —aquel silencio sepulcral— lo inundó todo.";
    const range = findEpisodicHighlightRange(passage, "«sepulcral»", "sepulcral");
    expect(range).not.toBeNull();
    expect(passage.slice(range!.start, range!.end)).toBe("sepulcral");
  });

  it("no produce falsos positivos dentro de palabras más largas", () => {
    const passage = "Marcharon temprano hacia el mar abierto.";
    const range = findEpisodicHighlightRange(passage, "mar", "mar");
    expect(range).not.toBeNull();
    expect(passage.slice(range!.start, range!.end)).toBe("mar");
    expect(range!.start).toBeGreaterThan(15);
  });
});

describe("Hueco 3.2 — getStabilitySegments defensivo", () => {
  it("devuelve 0 ante NaN, negativos, null, undefined o tipos no numéricos", () => {
    expect(getStabilitySegments(Number.NaN)).toBe(0);
    expect(getStabilitySegments(-10)).toBe(0);
    expect(getStabilitySegments(0)).toBe(0);
    expect(getStabilitySegments(0.5)).toBe(0);
    expect(getStabilitySegments(null)).toBe(0);
    expect(getStabilitySegments(undefined)).toBe(0);
    expect(getStabilitySegments("14")).toBe(0);
    expect(getStabilitySegments(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeStability(Number.NaN)).toBe(0);
  });

  it("calcula correctamente los 4 segmentos para valores válidos", () => {
    expect(getStabilitySegments(0.6)).toBe(1);
    expect(getStabilitySegments(2)).toBe(2);
    expect(getStabilitySegments(7)).toBe(3);
    expect(getStabilitySegments(14)).toBe(4);
    expect(getStabilitySegments(90)).toBe(4);
  });
});
