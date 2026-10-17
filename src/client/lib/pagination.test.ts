// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  anchorAtPage,
  buildFragmentPageMap,
  columnOfOffset,
  pageAdvance,
  pageForFragment,
  pageForText,
  pageLayout,
  pageOfElement,
  totalPages,
  type PageLayout,
} from "./pagination";

const GAP = 48;

function block(text: string, left: number) {
  const el = document.createElement("p");
  el.textContent = text;
  // jsdom no maqueta: simulamos la columna asignando offsetLeft.
  Object.defineProperty(el, "offsetLeft", { value: left });
  return el;
}

function containerWith(...els: HTMLElement[]) {
  const container = document.createElement("div");
  container.append(...els);
  return container;
}

describe("pageLayout", () => {
  it("reparte el ancho en dos columnas cuando caben", () => {
    const l = pageLayout(1400, 624, GAP);
    expect(l.numCols).toBe(2);
    expect(l.colW).toBeCloseTo((1400 + GAP) / 2 - GAP, 5);
    expect(l.boxW).toBe(1400);
  });

  it("degrada a una columna en caja angosta", () => {
    const l = pageLayout(390, 624, GAP);
    expect(l.numCols).toBe(1);
    expect(l.colW).toBe(390);
  });
});

describe("matemática de páginas", () => {
  const l: PageLayout = { numCols: 2, colW: 676, gap: GAP, boxW: 1400 };

  it("cada página avanza la caja completa más el hueco", () => {
    expect(pageAdvance(1400, GAP)).toBe(1448);
  });

  it("totalPages sube por página parcial", () => {
    // 2 columnas visibles de 676+48 → 4 columnas = 2 páginas
    expect(totalPages(676 * 4 + GAP * 3, l)).toBe(2);
    // 5 columnas → 3 páginas
    expect(totalPages(676 * 5 + GAP * 4, l)).toBe(3);
  });

  it("columnOfOffset localiza la columna de un punto", () => {
    expect(columnOfOffset(0, l)).toBe(0);
    expect(columnOfOffset(800, l)).toBe(1);
    expect(columnOfOffset(1500, l)).toBe(2);
  });

  it("pageOfElement baja la columna a página", () => {
    const el = block("texto", 800);
    expect(pageOfElement(el, l)).toBe(0);
    const far = block("texto", 1500);
    expect(pageOfElement(far, l)).toBe(1);
  });
});

describe("anchorAtPage", () => {
  it("devuelve el texto del primer bloque de la página", () => {
    const container = containerWith(
      block("Primer párrafo del capítulo", 0),
      block("Segundo párrafo en columna uno", 800),
      block("Tercer bloque en la página dos", 1500),
    );
    expect(anchorAtPage(container, { numCols: 2, colW: 676, gap: GAP, boxW: 1400 }, 0))
      .toBe("Primer párrafo del capítulo");
    expect(anchorAtPage(container, { numCols: 2, colW: 676, gap: GAP, boxW: 1400 }, 1))
      .toBe("Tercer bloque en la página dos");
  });

  it("devuelve null en una página vacía", () => {
    const container = containerWith(block("solo uno", 0));
    expect(anchorAtPage(container, { numCols: 2, colW: 676, gap: GAP, boxW: 1400 }, 3))
      .toBeNull();
  });
});

describe("pageForText", () => {
  const layout: PageLayout = { numCols: 2, colW: 676, gap: GAP, boxW: 1400 };

  it("modo ancla encuentra el bloque que empieza con el texto", () => {
    const container = containerWith(
      block("El invierno llegaba al Norte", 0),
      block("Will lo notaba al instante", 1500),
    );
    expect(pageForText(container, "Will lo notaba al instante, sí.", layout, "anchor")).toBe(1);
    expect(pageForText(container, "El invierno llegaba", layout, "anchor")).toBe(0);
  });

  it("modo fragmento encuentra texto en medio del bloque", () => {
    const container = containerWith(
      block("Llevaba cuatro años en Guardiaoriente cuando lo encontró", 2200),
    );
    expect(pageForText(container, "años en Guardiaoriente", layout, "snippet")).toBe(1);
  });

  it("devuelve null cuando el texto no aparece", () => {
    const container = containerWith(block("texto cualquiera", 0));
    expect(pageForText(container, "no existe", layout, "anchor")).toBeNull();
    expect(pageForText(container, "no existe", layout, "snippet")).toBeNull();
  });
});

describe("pageForFragment", () => {
  const layout: PageLayout = { numCols: 2, colW: 676, gap: GAP, boxW: 1400 };

  it("devuelve la página del elemento con ese id", () => {
    const el = block("Segunda parte del capítulo", 2200);
    el.setAttribute("data-frag-id", "s2");
    const container = containerWith(block("primera parte", 0), el);
    expect(pageForFragment(container, "s2", layout)).toBe(1);
  });

  it("ubica anclas anidadas dentro de un párrafo o elemento con imagen", () => {
    const p = block("", 2200);
    const span = document.createElement("span");
    span.setAttribute("data-frag-id", "p7");
    const img = document.createElement("img");
    img.src = "test.jpg";
    p.append(span, img);

    const container = containerWith(block("primera parte", 0), p);
    expect(pageForFragment(container, "p7", layout)).toBe(1);
  });

  it("devuelve null si el id no existe en la sección", () => {
    const container = containerWith(block("texto", 0));
    expect(pageForFragment(container, "inexistente", layout)).toBeNull();
  });
});

describe("buildFragmentPageMap", () => {
  const layout: PageLayout = { numCols: 2, colW: 676, gap: GAP, boxW: 1400 };

  it("construye un mapa de fragmento a página para un contenedor DOM", () => {
    const b0 = block("Epígrafe", 0);
    b0.setAttribute("data-frag-id", "p3");

    const b1 = block("Capítulo Uno", 1500);
    b1.setAttribute("data-frag-id", "p7");

    const b2 = block("Capítulo Dos", 3000);
    b2.setAttribute("data-frag-id", "p17");

    const container = containerWith(b0, b1, b2);
    const map = buildFragmentPageMap(container, layout, ["p3", "p7", "p17", "inexistente"]);

    expect(map.get("p3")).toBe(0);
    expect(map.get("p7")).toBe(1);
    expect(map.get("p17")).toBe(2);
    expect(map.has("inexistente")).toBe(false);
  });

  it("construye un mapa de fragmento a página desde un arreglo de páginas HTML", () => {
    const pages = [
      '<div data-frag-id="p3">Epígrafe</div>',
      '<div><span data-frag-id="p7"></span>Capítulo 1</div>',
      '<div><span data-frag-id="p17"></span>Capítulo 2</div>',
    ];
    const map = buildFragmentPageMap(pages, ["p3", "p7", "p17", "p99"]);
    expect(map.get("p3")).toBe(0);
    expect(map.get("p7")).toBe(1);
    expect(map.get("p17")).toBe(2);
    expect(map.has("p99")).toBe(false);
  });
});

