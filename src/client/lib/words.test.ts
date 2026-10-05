// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractWordAtPoint } from "./words";

// jsdom no implementa caretRangeFromPoint: se stubbea en cada prueba
// y se restaura el valor original (undefined) al terminar.
const originalCaretRangeFromPoint = document.caretRangeFromPoint;

afterEach(() => {
  document.caretRangeFromPoint = originalCaretRangeFromPoint;
  vi.restoreAllMocks();
});

const render = (html: string) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

const textNode = (element: Element | null, index = 0) => {
  const node = element?.childNodes[index];
  if (!(node instanceof Text)) throw new Error("la prueba esperaba un nodo de texto");
  return node;
};

const pointCaretAt = (node: Text, offset: number) => {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  document.caretRangeFromPoint = vi.fn(() => range);
};

const secondOccurrence = (text: string, word: string) =>
  text.indexOf(word, text.indexOf(word) + 1);

describe("extractWordAtPoint", () => {
  it("devuelve la oración que cubre el toque cuando la palabra se repite", () => {
    const root = render("<p>La casa antigua. La casa nueva.</p>");
    const node = textNode(root.querySelector("p"));
    const offset = secondOccurrence(node.textContent ?? "", "casa");
    pointCaretAt(node, offset + 1);
    const hit = extractWordAtPoint(0, 0, root);
    expect(hit?.word).toBe("casa");
    expect(hit?.context).toBe("La casa nueva.");
  });

  it("funciona igual cuando la palabra está en un nodo anidado", () => {
    const root = render("<p>La casa antigua. La <em>casa</em> nueva.</p>");
    pointCaretAt(textNode(root.querySelector("em")), 1);
    const hit = extractWordAtPoint(0, 0, root);
    expect(hit?.word).toBe("casa");
    expect(hit?.context).toBe("La casa nueva.");
  });

  it("un toque en la primera oración devuelve la primera oración", () => {
    const root = render("<p>La casa antigua. La casa nueva.</p>");
    const node = textNode(root.querySelector("p"));
    const offset = (node.textContent ?? "").indexOf("casa");
    pointCaretAt(node, offset + 1);
    expect(extractWordAtPoint(0, 0, root)?.context).toBe("La casa antigua.");
  });

  it("la última oración se devuelve aunque no lleve punto final", () => {
    const root = render("<p>Primera casa aquí. Segunda casa</p>");
    const node = textNode(root.querySelector("p"));
    const offset = secondOccurrence(node.textContent ?? "", "casa");
    pointCaretAt(node, offset + 1);
    expect(extractWordAtPoint(0, 0, root)?.context).toBe("Segunda casa");
  });

  it("sin caret devuelve null", () => {
    const root = render("<p>Texto.</p>");
    document.caretRangeFromPoint = vi.fn(() => null);
    expect(extractWordAtPoint(0, 0, root)).toBeNull();
  });
});
