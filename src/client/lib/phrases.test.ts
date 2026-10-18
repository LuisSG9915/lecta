import { describe, expect, it } from "vitest";
import {
  buildPhraseIndex,
  lemmaOfFromEntries,
  matchPhrase,
  detectMultiwordPhrases,
  matchForeignIdiom,
  selectOptimalScaffoldingTier,
  updateBilingualAutonomyProfile,
  calculateLexicalFrictionDensity,
  type BilingualScaffoldingProfile,
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

describe("detectMultiwordPhrases (multilingüe)", () => {
  it("detecta locuciones en inglés y sus formas flexionadas", () => {
    const text =
      "He took it for granted that they would make up their mind, but they were caught off guard out of the blue.";
    const hits = detectMultiwordPhrases(text, "en");

    expect(hits.length).toBeGreaterThanOrEqual(3);
    const phrases = hits.map((h) => h.normalizedId);
    expect(phrases).toContain("take for granted");
    expect(phrases).toContain("make up mind");
    expect(phrases).toContain("catch off guard");
    expect(phrases).toContain("out of the blue");

    const taken = hits.find((h) => h.normalizedId === "take for granted");
    expect(taken?.gloss).toBe("dar por sentado");
    expect(taken?.startIndex).toBe(3);
  });

  it("permite glosas en inglés cuando targetGlossLang === 'en'", () => {
    const text = "Everything is at stake in the long run.";
    const hits = detectMultiwordPhrases(text, "en", "en");
    const atStake = hits.find((h) => h.normalizedId === "at stake");
    expect(atStake?.gloss).toBe("at risk");
  });

  it("detecta expresiones idiomáticas en francés", () => {
    const text = "Il avait beau essayer, elle continuait à lui en vouloir à mort.";
    const hits = detectMultiwordPhrases(text, "fr");
    const phrases = hits.map((h) => h.normalizedId);
    expect(phrases).toContain("avoir beau");
    expect(phrases).toContain("en vouloir à");
  });

  it("detecta locuciones en español", () => {
    const text = "A duras penas logró escapar, aunque dieron por sentado su derrota.";
    const hits = detectMultiwordPhrases(text, "es");
    const phrases = hits.map((h) => h.normalizedId);
    expect(phrases).toContain("a duras penas");
    expect(phrases).toContain("dar por sentado");
  });

  it("no se solapa y resuelve colisiones ordenadamente", () => {
    const text = "We should bear in mind that peace is at stake.";
    const hits = detectMultiwordPhrases(text, "en");
    expect(hits.length).toBe(2);
    expect(hits[0].startIndex).toBeLessThan(hits[1].startIndex);
  });
});

describe("matchForeignIdiom", () => {
  it("identifica la locución correspondiente a la palabra tocada", () => {
    const sent = "They decided to bear in mind his warning.";
    const hit = matchForeignIdiom(sent, "mind", "en");
    expect(hit?.normalizedId).toBe("bear in mind");
    expect(hit?.gloss).toBe("tener en cuenta");
  });

  it("devuelve null si la palabra tocada no forma parte de ninguna locución", () => {
    const sent = "They decided to bear in mind his warning.";
    const hit = matchForeignIdiom(sent, "warning", "en");
    expect(hit).toBeNull();
  });
});

describe("selectOptimalScaffoldingTier", () => {
  const baseProfile: BilingualScaffoldingProfile = {
    mode: "auto",
    mutedBookIds: ["muted-123"],
    autonomyBiasByLang: {},
  };

  it("devuelve 'off' si el modo es 'off' o el libro está silenciado", () => {
    expect(
      selectOptimalScaffoldingTier("Some paragraph text", 0.1, "en", {
        ...baseProfile,
        mode: "off",
      }),
    ).toBe("off");

    expect(
      selectOptimalScaffoldingTier(
        "Some paragraph text",
        0.1,
        "en",
        baseProfile,
        "muted-123",
      ),
    ).toBe("off");
  });

  it("fuerza Nivel 1 o Nivel 3 si el perfil lo exige", () => {
    expect(
      selectOptimalScaffoldingTier("Very difficult complex paragraph text", 0.5, "en", {
        ...baseProfile,
        mode: "tier-1-only",
      }),
    ).toBe(1);

    expect(
      selectOptimalScaffoldingTier("Very easy text", 0.0, "en", {
        ...baseProfile,
        mode: "tier-3-always",
      }),
    ).toBe(3);
  });

  it("selecciona dinámicamente según la fricción léxica y la longitud de cláusulas", () => {
    const shortText = "The cat sat on the mat. The sun was warm.";
    // fricción baja (< 0.28) -> Nivel 1
    const tierLow = selectOptimalScaffoldingTier(shortText, 0.02, "en", baseProfile);
    expect(tierLow).toBe(1);

    // fricción media (0.28 <= f < 0.52) -> Nivel 2
    const tierMed = selectOptimalScaffoldingTier(shortText, 0.08, "en", baseProfile);
    expect(tierMed).toBe(2);

    // fricción alta (>= 0.52) -> Nivel 3
    const tierHigh = selectOptimalScaffoldingTier(shortText, 0.15, "en", baseProfile);
    expect(tierHigh).toBe(3);
  });

  it("el sesgo de autonomía aprendido por idioma desplaza el umbral", () => {
    const text = "A normal sentence with moderate difficulty.";
    const profileWithAutonomousBias: BilingualScaffoldingProfile = {
      ...baseProfile,
      autonomyBiasByLang: { en: -0.2 },
    };
    const profileWithSupportBias: BilingualScaffoldingProfile = {
      ...baseProfile,
      autonomyBiasByLang: { en: 0.2 },
    };

    // Con ratio 0.07:
    // Base: 0.07 * 4.5 = 0.315 -> Tier 2
    // Autónomo (-0.2): 0.315 - 0.2 = 0.115 -> Tier 1
    // Con apoyo (+0.2): 0.315 + 0.2 = 0.515 (o con cláusulas >= 0.52) -> Tier 2 o 3
    expect(
      selectOptimalScaffoldingTier(text, 0.07, "en", profileWithAutonomousBias),
    ).toBe(1);
    expect(
      selectOptimalScaffoldingTier(text, 0.07, "en", profileWithSupportBias),
    ).toBe(2);
  });
});

describe("updateBilingualAutonomyProfile", () => {
  const initial: BilingualScaffoldingProfile = {
    mode: "auto",
    mutedBookIds: [],
    autonomyBiasByLang: { en: 0.0 },
  };

  it("desvanece el andamiaje al leer autónomamente (-0.015)", () => {
    const updated = updateBilingualAutonomyProfile(initial, "en", "read-autonomously");
    expect(updated.autonomyBiasByLang.en).toBe(-0.015);

    const updated2 = updateBilingualAutonomyProfile(updated, "en", "read-autonomously");
    expect(updated2.autonomyBiasByLang.en).toBe(-0.03);
  });

  it("aumenta el soporte cuando el usuario escala la traducción (+0.055)", () => {
    const updated = updateBilingualAutonomyProfile(initial, "en", "escalated");
    expect(updated.autonomyBiasByLang.en).toBe(0.055);
  });

  it("respeta los límites acotados [-0.35, +0.35]", () => {
    let prof: BilingualScaffoldingProfile = {
      ...initial,
      autonomyBiasByLang: { en: 0.33 },
    };
    prof = updateBilingualAutonomyProfile(prof, "en", "escalated");
    expect(prof.autonomyBiasByLang.en).toBe(0.35);

    prof = { ...initial, autonomyBiasByLang: { en: -0.34 } };
    prof = updateBilingualAutonomyProfile(prof, "en", "read-autonomously");
    expect(prof.autonomyBiasByLang.en).toBe(-0.35);
  });
});

describe("calculateLexicalFrictionDensity", () => {
  it("calcula D_p correctamente según la dificultad de palabras y longitud de cláusula", () => {
    // Si no hay palabras, densidad es 0
    expect(calculateLexicalFrictionDensity([], 0, 10)).toBe(0);

    // Theta = 0, una palabra con beta = 0: pKnow = 1/(1+1)=0.5, 1-pKnow = 0.5
    // Cláusula <= 18 palabras -> sin penalización sintáctica
    const d1 = calculateLexicalFrictionDensity([0], 0, 15);
    expect(d1).toBeCloseTo(0.5, 3);

    // Cláusula larga (38 palabras): (38-18)/20 * 0.15 = 0.15
    const d2 = calculateLexicalFrictionDensity([0], 0, 38);
    expect(d2).toBeCloseTo(0.65, 3);
  });
});

