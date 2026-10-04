// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findPassageRange } from "./passage-marks";

const container = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
};

describe("findPassageRange", () => {
  it("encuentra un pasaje dentro de un párrafo", () => {
    const c = container("<p>La casa de los espíritus estaba quieta.</p>");
    const range = findPassageRange(c, { text: "de los espíritus" });
    expect(range).not.toBeNull();
    expect(range?.toString()).toBe("de los espíritus");
  });

  it("cruza elementos en línea (em/strong)", () => {
    const c = container("<p>Will <em>divisó un</em> movimiento claro.</p>");
    const range = findPassageRange(c, { text: "divisó un movimiento" });
    expect(range).not.toBeNull();
    expect(range?.toString().replace(/\s+/g, " ")).toBe("divisó un movimiento");
  });

  it("cruza párrafos como lo hace una selección", () => {
    const c = container("<p>final del primero.</p><p>Inicio del segundo.</p>");
    const range = findPassageRange(c, { text: "final del primero. Inicio" });
    expect(range).not.toBeNull();
    // Range.toString() concatena nodos sin separador entre párrafos.
    expect(range?.toString().replace(/\s+/g, "")).toBe(
      "finaldelprimero.Inicio",
    );
  });

  it("ignora acentos y mayúsculas al ubicar", () => {
    const c = container("<p>Corazón delator.</p>");
    expect(findPassageRange(c, { text: "corazon" })?.toString()).toBe("Corazón");
  });

  it("devuelve null cuando el texto no está", () => {
    const c = container("<p>otro contenido</p>");
    expect(findPassageRange(c, { text: "no existe" })).toBeNull();
  });
});
