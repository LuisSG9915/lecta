// @vitest-environment jsdom
// Pruebas del componente Seal: accesibilidad (role="img", aria-label),
// glifos vectoriales de las 8 familias, números romanos por rango y estados
// (locked, earned, max).

import { createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAMILY_TO_SEAL_CATEGORY,
  SEAL_CATEGORY_LABELS,
  Seal,
  toRoman,
} from "./Seal";
import {
  ACHIEVEMENT_FAMILY_ORDER,
  type AchievementFamily,
} from "../../shared/gamification";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("toRoman", () => {
  it("convierte números arábigos a números romanos clásicos", () => {
    expect(toRoman(0)).toBe("");
    expect(toRoman(1)).toBe("I");
    expect(toRoman(2)).toBe("II");
    expect(toRoman(3)).toBe("III");
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(5)).toBe("V");
    expect(toRoman(6)).toBe("VI");
    expect(toRoman(7)).toBe("VII");
    expect(toRoman(8)).toBe("VIII");
    expect(toRoman(9)).toBe("IX");
    expect(toRoman(10)).toBe("X");
  });
});

describe("Seal component", () => {
  it("renderiza con role='img' y etiqueta accesible para estado bloqueado (rango 0)", () => {
    act(() => {
      root.render(
        h(Seal, {
          family: "palabras",
          rank: 0,
          maxRank: 5,
        }),
      );
    });

    const el = host.querySelector(".seal") as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute("role")).toBe("img");
    expect(el.getAttribute("aria-label")).toBe("Sello palabras: Bloqueado");
    expect(el.classList.contains("seal--locked")).toBe(true);
    expect(el.classList.contains("seal--palabras")).toBe(true);
    expect(host.querySelector(".seal-dot-locked")).toBeTruthy();
    expect(host.querySelector(".seal-roman")).toBeNull();
  });

  it("renderiza etiqueta y clase para estado ganado intermedio (rango > 0, < maxRank)", () => {
    act(() => {
      root.render(
        h(Seal, {
          family: "lectura",
          rank: 2,
          maxRank: 5,
        }),
      );
    });

    const el = host.querySelector(".seal") as HTMLElement;
    expect(el.getAttribute("aria-label")).toBe("Sello lectura: Rango II de V");
    expect(el.classList.contains("seal--earned")).toBe(true);
    const roman = host.querySelector(".seal-roman");
    expect(roman?.textContent).toBe("II");
  });

  it("renderiza etiqueta y clase para estado máximo alcanzado (rank >= maxRank)", () => {
    act(() => {
      root.render(
        h(Seal, {
          family: "racha",
          rank: 5,
          maxRank: 5,
        }),
      );
    });

    const el = host.querySelector(".seal") as HTMLElement;
    expect(el.getAttribute("aria-label")).toBe(
      "Sello racha: Rango máximo (V de V)",
    );
    expect(el.classList.contains("seal--max")).toBe(true);
    const roman = host.querySelector(".seal-roman");
    expect(roman?.textContent).toBe("V");
  });

  it("acepta un label personalizado", () => {
    act(() => {
      root.render(
        h(Seal, {
          family: "consultas",
          rank: 1,
          maxRank: 4,
          label: "Etiqueta propia de prueba",
        }),
      );
    });

    const el = host.querySelector(".seal") as HTMLElement;
    expect(el.getAttribute("aria-label")).toBe("Etiqueta propia de prueba");
  });

  it("renderiza sin errores los glifos de cada una de las 8 familias", () => {
    for (const family of ACHIEVEMENT_FAMILY_ORDER) {
      act(() => {
        root.render(
          h(Seal, {
            family: family as AchievementFamily,
            rank: 1,
            maxRank: 5,
          }),
        );
      });
      const el = host.querySelector(`.seal--${family}`);
      expect(el).toBeTruthy();
    }
  });

  it("asigna la categoría correspondiente según la familia (estrategias, palabras, compañero)", () => {
    expect(FAMILY_TO_SEAL_CATEGORY.sesion).toBe("strategies");
    expect(FAMILY_TO_SEAL_CATEGORY.palabras).toBe("words");
    expect(FAMILY_TO_SEAL_CATEGORY.racha).toBe("companion");

    expect(SEAL_CATEGORY_LABELS.strategies).toBe("Estrategias de Lectura");
    expect(SEAL_CATEGORY_LABELS.words).toBe("Dominio de Palabras");
    expect(SEAL_CATEGORY_LABELS.companion).toBe("Vínculo con el Gato");
  });

  it("muestra barra/texto de progreso y rewardIcon en sellos bloqueados", () => {
    act(() => {
      root.render(
        h(Seal, {
          family: "sesion",
          rank: 0,
          maxRank: 5,
          progressText: "3 / 5 sesiones",
          rewardIcon: "👓",
        }),
      );
    });

    expect(host.textContent).toContain("3 / 5 sesiones");
    expect(host.textContent).toContain("👓");
    const progressBadge = host.querySelector(".seal-progress-badge");
    expect(progressBadge).toBeTruthy();
    const rewardBadge = host.querySelector(".seal-reward-icon");
    expect(rewardBadge).toBeTruthy();
  });

  it("activa micro-animación de brillo al tocar un sello obtenido y muestra fecha", () => {
    const onClick = vi.fn();
    act(() => {
      root.render(
        h(Seal, {
          family: "racha",
          rank: 3,
          maxRank: 5,
          earnedDate: "2026-03-10",
          onClick,
        }),
      );
    });

    const sealEl = host.querySelector(".seal") as HTMLElement;
    expect(sealEl).toBeTruthy();

    act(() => {
      sealEl.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(sealEl.classList.contains("seal--shining")).toBe(true);
    expect(host.textContent).toContain("2026-03-10");
  });
});
