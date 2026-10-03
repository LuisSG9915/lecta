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
});
