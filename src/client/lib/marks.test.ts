// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { markWords } from "./marks";

const root = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
};

const NO_PREDICTED = new Set<string>();

describe("markWords con guardadas", () => {
  it("envuelve una palabra guardada en un mark", () => {
    const div = root("<p>La casa antigua.</p>");
    markWords(div, new Set(["casa"]), NO_PREDICTED);
    const mark = div.querySelector("mark.saved-word");
    expect(mark?.textContent).toBe("casa");
    expect(div.textContent).toBe("La casa antigua.");
  });

  it("marca todas las apariciones y respeta mayúsculas", () => {
    const div = root("<p>Casa por casa. La casa vieja.</p>");
    markWords(div, new Set(["casa"]), NO_PREDICTED);
    const marks = div.querySelectorAll("mark.saved-word");
    expect(marks.length).toBe(3);
    expect(marks[0]?.textContent).toBe("Casa");
  });

  it("no marca subcadenas dentro de otras palabras", () => {
    const div = root("<p>Encasaron la casa.</p>");
    markWords(div, new Set(["casa"]), NO_PREDICTED);
    const marks = div.querySelectorAll("mark.saved-word");
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe("casa");
    expect(div.textContent).toBe("Encasaron la casa.");
  });

  it("es idempotente: no duplica marcas al repetir", () => {
    const div = root("<p>La casa antigua.</p>");
    markWords(div, new Set(["casa"]), NO_PREDICTED);
    markWords(div, new Set(["casa"]), NO_PREDICTED);
    expect(div.querySelectorAll("mark.saved-word").length).toBe(1);
  });

  it("marca nuevas formas añadidas después", () => {
    const div = root("<p>La casa y la puerta.</p>");
    markWords(div, new Set(["casa"]), NO_PREDICTED);
    markWords(div, new Set(["casa", "puerta"]), NO_PREDICTED);
    expect(div.querySelectorAll("mark.saved-word").length).toBe(2);
  });

  it("sin formas no toca el DOM", () => {
    const div = root("<p>Texto.</p>");
    markWords(div, new Set(), new Set());
    expect(div.innerHTML).toBe("<p>Texto.</p>");
  });

  it("con Map pone data-level según el nivel", () => {
    const div = root("<p>La casa y la puerta y el tejado.</p>");
    markWords(
      div,
      new Map<string, "new" | "learning" | "settled">([
        ["casa", "new"],
        ["puerta", "learning"],
        ["tejado", "settled"],
      ]),
      NO_PREDICTED,
    );
    const marks = div.querySelectorAll("mark.saved-word");
    expect(marks[0]?.hasAttribute("data-level")).toBe(false);
    expect(marks[1]?.getAttribute("data-level")).toBe("learning");
    expect(marks[2]?.getAttribute("data-level")).toBe("settled");
  });

  it("al remarcar actualiza niveles y quita las que salieron del mapa", () => {
    const div = root("<p>La casa y la puerta.</p>");
    markWords(div, new Map([["casa", "learning" as const]]), NO_PREDICTED);
    markWords(div, new Map([["puerta", "settled" as const]]), NO_PREDICTED);
    const marks = div.querySelectorAll("mark.saved-word");
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe("puerta");
    expect(marks[0]?.getAttribute("data-level")).toBe("settled");
    expect(div.textContent).toBe("La casa y la puerta.");
  });
});

describe("markWords con predichas", () => {
  it("marca las formas predichas con la clase predicted-word", () => {
    const div = root("<p>La perenne discusión seguía.</p>");
    markWords(div, new Set<string>(), new Set(["perenne"]));
    const mark = div.querySelector("mark.predicted-word");
    expect(mark?.textContent).toBe("perenne");
    expect(div.querySelectorAll("mark.saved-word").length).toBe(0);
  });

  it("una forma en ambos conjuntos queda solo como guardada", () => {
    const div = root("<p>La casa y la perenne discusión.</p>");
    markWords(
      div,
      new Map([["casa", "learning" as const]]),
      new Set(["casa", "perenne"]),
    );
    const saved = div.querySelectorAll("mark.saved-word");
    const predicted = div.querySelectorAll("mark.predicted-word");
    expect(saved.length).toBe(1);
    expect(saved[0]?.textContent).toBe("casa");
    expect(saved[0]?.getAttribute("data-level")).toBe("learning");
    expect(predicted.length).toBe(1);
    expect(predicted[0]?.textContent).toBe("perenne");
  });

  it("al remarcar quita predichas que salieron y limpia ambas clases", () => {
    const div = root("<p>La casa y la perenne discusión.</p>");
    markWords(div, new Set<string>(), new Set(["casa", "perenne"]));
    // «Ya la conocía» casa; perenne sigue predicha.
    markWords(div, new Set<string>(), new Set(["perenne"]));
    expect(div.querySelectorAll("mark.predicted-word").length).toBe(1);
    // Al vaciar ambos conjuntos el texto queda sin marcas.
    markWords(div, new Set<string>(), new Set<string>());
    expect(div.querySelectorAll("mark.saved-word").length).toBe(0);
    expect(div.querySelectorAll("mark.predicted-word").length).toBe(0);
    expect(div.innerHTML).toBe("<p>La casa y la perenne discusión.</p>");
  });

  it("guardar una predicha la convierte en saved-word", () => {
    const div = root("<p>La perenne discusión seguía.</p>");
    markWords(div, new Set<string>(), new Set(["perenne"]));
    markWords(div, new Set(["perenne"]), new Set<string>());
    const mark = div.querySelector("mark.saved-word");
    expect(mark?.textContent).toBe("perenne");
    expect(div.querySelectorAll("mark.predicted-word").length).toBe(0);
  });

  it("no marca dentro de la tarjeta «Antes de leer»", () => {
    const div = root(
      '<aside class="section-preview-slot"><p>perenne</p></aside><p>La perenne sigue.</p>',
    );
    markWords(div, new Set<string>(), new Set(["perenne"]));
    const marks = div.querySelectorAll("mark.predicted-word");
    expect(marks.length).toBe(1);
    expect(marks[0]?.parentElement?.tagName).toBe("P");
    expect(div.querySelector(".section-preview-slot")?.textContent).toBe("perenne");
  });
});
