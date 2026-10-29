// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  activeFragmentAt,
  fragElements,
  invalidateFragments,
} from "./scroll-fragments";

function makeFrag(id: string, top: number, height = 40): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-frag-id", id);
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      height,
      width: 100,
      left: 0,
      right: 100,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

function makeContainer(tops: number[]): {
  root: HTMLDivElement;
  frags: HTMLDivElement[];
} {
  const root = document.createElement("div");
  const frags = tops.map((top, i) => makeFrag(`f${i}`, top));
  for (const el of frags) root.appendChild(el);
  document.body.appendChild(root);
  return { root, frags };
}

describe("scroll-fragments", () => {
  it("elige el último fragmento cuyo borde superior ya pasó el umbral", () => {
    const { frags } = makeContainer([-400, -100, 0, 120, 400]);
    expect(activeFragmentAt(frags, 180)).toBe("f3");
    expect(activeFragmentAt(frags, 0)).toBe("f2");
    expect(activeFragmentAt(frags, -500)).toBeNull();
    expect(activeFragmentAt(frags, 5000)).toBe("f4");
  });

  it("se queda vacío sin fragmentos", () => {
    expect(activeFragmentAt([], 100)).toBeNull();
  });

  it("resuelve con menos lecturas de layout que un recorrido completo", () => {
    const { frags } = makeContainer(
      Array.from({ length: 200 }, (_, i) => i * 60),
    );
    let total = 0;
    for (const el of frags) {
      const original = el.getBoundingClientRect.bind(el);
      el.getBoundingClientRect = () => {
        total += 1;
        return original();
      };
    }
    expect(activeFragmentAt(frags, 6000)).toBe("f100");
    // Bisección: ~log2(200) ≈ 8 lecturas, más la comprobación de monotonía.
    expect(total).toBeLessThan(20);
  });

  it("en modo paginado recorre la lista completa: las columnas rompen el orden vertical", () => {
    // Dos columnas: los fragmentos de la derecha vuelven a subir, así que
    // el último de la lista es el que manda (no el pivote de la bisección).
    const { frags } = makeContainer([0, 100, 200, 10, 110, 210]);
    expect(activeFragmentAt(frags, 150, true)).toBe("f4");
    // Sin la pista de paginado el pivote manda: comportamiento conocido.
    expect(activeFragmentAt(frags, 150)).toBe("f1");
  });

  it("cachea los nodos y se invalida cuando el contenedor cambia", () => {
    const { root, frags } = makeContainer([0, 100]);
    const first = fragElements(root);
    expect(first).toHaveLength(2);
    expect(fragElements(root)).toBe(first);

    // Otro capítulo: el contenedor cambia de hijos.
    root.replaceChildren(makeFrag("nuevo", 0));
    const second = fragElements(root);
    expect(second).toHaveLength(1);
    expect(second[0].getAttribute("data-frag-id")).toBe("nuevo");
    expect(second).not.toBe(first);
    expect(frags).toHaveLength(2);

    invalidateFragments(root);
    expect(fragElements(root)).not.toBe(second);
  });
});
