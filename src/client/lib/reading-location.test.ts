// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  anchorAtViewTop,
  normalizeBlockText,
  scrollToAnchor,
  scrollToFragment,
} from "./reading-location";

// jsdom no implementa scrollIntoView ni geometría real: se simulan.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

const block = (text: string, top: number, height = 40) => {
  const el = document.createElement("p");
  el.textContent = text;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
};

const container = (...els: HTMLElement[]) => {
  const c = document.createElement("div");
  c.append(...els);
  return c;
};

describe("normalizeBlockText", () => {
  it("colapsa espacios y recorta bordes", () => {
    expect(normalizeBlockText("  la   casa\n\n azul ")).toBe("la casa azul");
  });
});

describe("anchorAtViewTop", () => {
  it("ancla el primer bloque que cruza la zona de lectura", () => {
    const above = block("capítulo ya leído", -200, 100); // bottom -100: fuera
    const current = block("La casa   de los espíritus", -20, 60);
    const below = block("párrafo siguiente", 300);
    const c = container(above, current, below);

    const anchor = anchorAtViewTop(c);
    expect(anchor).toBe("La casa de los espíritus");
  });

  it("devuelve null sin bloques con texto", () => {
    expect(anchorAtViewTop(container(document.createElement("div")))).toBeNull();
  });
});

describe("scrollToAnchor", () => {
  it("encuentra el bloque por su inicio y lo desplaza", () => {
    const p1 = block("Era una mañana clara", 0);
    const p2 = block("El mar estaba en calma", 200);
    const c = container(p1, p2);
    const spy = vi.spyOn(p2, "scrollIntoView");

    expect(scrollToAnchor(c, "El mar estaba en calma y el cielo")).toBe(true);
    expect(spy).toHaveBeenCalledWith({ block: "start" });
  });

  it("devuelve false cuando el ancla no está en la sección", () => {
    const c = container(block("otro texto", 0));
    expect(scrollToAnchor(c, "un ancla que no existe")).toBe(false);
  });
});

describe("scrollToFragment", () => {
  it("desplaza al elemento con ese id", () => {
    const target = block("Segunda parte del capítulo", 200);
    target.setAttribute("data-frag-id", "s2");
    const c = container(block("primera parte", 0), target);
    const spy = vi.spyOn(target, "scrollIntoView");

    expect(scrollToFragment(c, "s2")).toBe(true);
    expect(spy).toHaveBeenCalledWith({ block: "start" });
  });

  it("devuelve false si el id no existe", () => {
    const c = container(block("texto", 0));
    expect(scrollToFragment(c, "inexistente")).toBe(false);
  });
});
