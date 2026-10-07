import { describe, expect, it } from "vitest";
import {
  buildPhraseIndex,
  lemmaOfFromEntries,
  matchPhrase,
} from "./phrases";

const index = buildPhraseIndex({
  entries: [
    { p: "picar el anzuelo", pos: "locución", d: ["Caer en una trampa."] },
    { p: "morder el anzuelo", pos: "locución", d: ["Caer en una trampa."] },
    { p: "a lo mejor", pos: "locución", d: ["Quizá."] },
    { p: "a lo mejor amigo", pos: "locución", d: ["Al mejor amigo de uno."] },
    { p: "dar marcha atrás", pos: "locución", d: ["Retroceder."] },
  ],
});

const entries = (map: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(map).map(([form, lemmas]) => [
      form,
      lemmas.map((lemma) => ({ lemma })),
    ]),
  );

describe("matchPhrase", () => {
  it("formas flexionadas matchean por lema («mordido» → «morder el anzuelo»)", () => {
    const lemmaOf = lemmaOfFromEntries(
      entries({ mordido: ["morder"], había: ["haber"] }),
    );
    const hit = matchPhrase(
      index,
      "No había mordido el anzuelo esa vez.",
      "mordido",
      lemmaOf,
    );
    expect(hit?.lemma).toBe("morder el anzuelo");
    expect(hit?.definitions[0]).toBe("Caer en una trampa.");
  });

  it("superficie literal matchea sin análisis del capítulo", () => {
    const lemmaOf = lemmaOfFromEntries({});
    const hit = matchPhrase(
      index,
      "A lo mejor llueve mañana.",
      "mejor",
      lemmaOf,
    );
    expect(hit?.lemma).toBe("a lo mejor");
  });

  it("gana la coincidencia más larga", () => {
    const lemmaOf = lemmaOfFromEntries({});
    const hit = matchPhrase(
      index,
      "Fue a lo mejor amigo de mi hermano.",
      "mejor",
      lemmaOf,
    );
    expect(hit?.lemma).toBe("a lo mejor amigo");
  });

  it("la palabra tocada fuera de la frase no dispara", () => {
    const lemmaOf = lemmaOfFromEntries(entries({ mordido: ["morder"] }));
    // «trampa» no es token de «morder el anzuelo».
    const hit = matchPhrase(
      index,
      "No mordido el anzuelo; esquivó la trampa.",
      "trampa",
      lemmaOf,
    );
    expect(hit).toBeNull();
  });

  it("sin frase en la oración devuelve null", () => {
    const lemmaOf = lemmaOfFromEntries(entries({ mordido: ["morder"] }));
    expect(
      matchPhrase(index, "El pez nadó tranquilo toda la tarde.", "pez", lemmaOf),
    ).toBeNull();
  });

  it("puntuación y mayúsculas no rompen el match", () => {
    const lemmaOf = lemmaOfFromEntries(entries({ dio: ["dar"] }));
    const hit = matchPhrase(
      index,
      "El coche dio marcha atrás, sin mirar.",
      "dio",
      lemmaOf,
    );
    expect(hit?.lemma).toBe("dar marcha atrás");
  });

  it("la palabra tocada puede estar en cualquier posición de la frase", () => {
    const lemmaOf = lemmaOfFromEntries(entries({ mordido: ["morder"] }));
    const hit = matchPhrase(
      index,
      "No había mordido el anzuelo.",
      "anzuelo",
      lemmaOf,
    );
    expect(hit?.lemma).toBe("morder el anzuelo");
  });
});
