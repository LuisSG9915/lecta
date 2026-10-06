// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { stripSoftHyphens } from "./epub";

const div = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("stripSoftHyphens", () => {
  it("quita los guiones blandos de los nodos de texto", () => {
    const root = div("<p>pa\u00ADla\u00ADbras</p><p>otro p\u00ADarrafo</p>");
    stripSoftHyphens(root);
    expect(root.textContent).toBe("palabrasotro parrafo");
  });

  it("cubre texto anidado en cualquier profundidad", () => {
    const root = div(
      '<p>ante<em>ri\u00ADor</em>mente <span><strong>des\u00ADecho</strong></span></p>',
    );
    stripSoftHyphens(root);
    expect(root.textContent).toBe("anteriormente desecho");
  });

  it("conserva guiones normales, espacios y entidades", () => {
    const root = div("<p>corre–ve–y–dile y boomerang</p>");
    stripSoftHyphens(root);
    expect(root.textContent).toBe("corre–ve–y–dile y boomerang");
  });

  it("no toca nada cuando no hay guiones blandos", () => {
    const root = div("<p>texto limpio</p>");
    const before = root.innerHTML;
    stripSoftHyphens(root);
    expect(root.innerHTML).toBe(before);
  });
});
