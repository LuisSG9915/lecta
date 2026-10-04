// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { markSavedWords } from "./marks";

const root = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
};

describe("markSavedWords", () => {
  it("envuelve una palabra guardada en un mark", () => {
    const div = root("<p>La casa antigua.</p>");
    markSavedWords(div, new Set(["casa"]));
    const mark = div.querySelector("mark.saved-word");
    expect(mark?.textContent).toBe("casa");
    expect(div.textContent).toBe("La casa antigua.");
  });

  it("marca todas las apariciones y respeta mayúsculas", () => {
    const div = root("<p>Casa por casa. La casa vieja.</p>");
    markSavedWords(div, new Set(["casa"]));
    const marks = div.querySelectorAll("mark.saved-word");
    expect(marks.length).toBe(3);
    expect(marks[0]?.textContent).toBe("Casa");
  });

  it("no marca subcadenas dentro de otras palabras", () => {
    const div = root("<p>Encasaron la casa.</p>");
    markSavedWords(div, new Set(["casa"]));
    const marks = div.querySelectorAll("mark.saved-word");
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe("casa");
    expect(div.textContent).toBe("Encasaron la casa.");
  });

  it("es idempotente: no duplica marcas al repetir", () => {
    const div = root("<p>La casa antigua.</p>");
    markSavedWords(div, new Set(["casa"]));
    markSavedWords(div, new Set(["casa"]));
    expect(div.querySelectorAll("mark.saved-word").length).toBe(1);
  });

  it("marca nuevas formas añadidas después", () => {
    const div = root("<p>La casa y la puerta.</p>");
    markSavedWords(div, new Set(["casa"]));
    markSavedWords(div, new Set(["casa", "puerta"]));
    expect(div.querySelectorAll("mark.saved-word").length).toBe(2);
  });

  it("sin formas no toca el DOM", () => {
    const div = root("<p>Texto.</p>");
    markSavedWords(div, new Set());
    expect(div.innerHTML).toBe("<p>Texto.</p>");
  });

  it("con Map pone data-level según el nivel", () => {
    const div = root("<p>La casa y la puerta y el tejado.</p>");
    markSavedWords(
      div,
      new Map<string, "new" | "learning" | "settled">([
        ["casa", "new"],
        ["puerta", "learning"],
        ["tejado", "settled"],
      ]),
    );
    const marks = div.querySelectorAll("mark.saved-word");
    expect(marks[0]?.hasAttribute("data-level")).toBe(false);
    expect(marks[1]?.getAttribute("data-level")).toBe("learning");
    expect(marks[2]?.getAttribute("data-level")).toBe("settled");
  });

  it("al remarcar actualiza niveles y quita las que salieron del mapa", () => {
    const div = root("<p>La casa y la puerta.</p>");
    markSavedWords(div, new Map([["casa", "learning" as const]]));
    markSavedWords(div, new Map([["puerta", "settled" as const]]));
    const marks = div.querySelectorAll("mark.saved-word");
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe("puerta");
    expect(marks[0]?.getAttribute("data-level")).toBe("settled");
    expect(div.textContent).toBe("La casa y la puerta.");
  });
});
