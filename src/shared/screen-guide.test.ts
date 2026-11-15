import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  sanitizeScreenGuideObject,
  screenChapterId,
  screenChapterLabel,
  screenGuideKey,
  screenWorkHash,
  subtitleToForms,
  type ScreenWorkRef,
} from "./screen-guide";

const MOVIE: ScreenWorkRef = {
  type: "movie",
  imdbId: "tt0111161",
  language: "es",
};
const EP3: ScreenWorkRef = {
  type: "tv",
  imdbId: "tt11280740",
  language: "en",
  season: 1,
  episode: 3,
};

describe("screenGuideKey", () => {
  it("arma la clave de película sin episodio", () => {
    expect(screenGuideKey(MOVIE)).toBe(
      "screen-guides/v1/movie-tt0111161-es.json",
    );
  });

  it("arma la clave de episodio con temporada y episodio", () => {
    expect(screenGuideKey(EP3)).toBe(
      "screen-guides/v1/tv-tt11280740-s01e03-en.json",
    );
  });

  it("rechaza referencias inválidas", () => {
    expect(screenGuideKey({ ...MOVIE, type: "book" as never })).toBeNull();
    expect(screenGuideKey({ ...MOVIE, imdbId: "tt123" })).toBeNull();
    expect(screenGuideKey({ ...MOVIE, imdbId: "xt0111161" })).toBeNull();
    expect(screenGuideKey({ ...MOVIE, imdbId: "tt123456" })).toBeNull(); // 6 dígitos
    expect(screenGuideKey({ ...MOVIE, imdbId: "tt0111161001" })).toBeNull(); // 10 dígitos
    expect(screenGuideKey({ ...MOVIE, imdbId: "tt01111610" })).not.toBeNull(); // 8 dígitos: válido
    expect(screenGuideKey({ ...MOVIE, language: "fr" as never })).toBeNull();
    expect(
      screenGuideKey({ type: "tv", imdbId: "tt11280740", language: "en" }),
    ).toBeNull(); // tv sin season/episode
    expect(screenGuideKey({ ...EP3, episode: 0 })).toBeNull();
    expect(screenGuideKey({ ...EP3, season: 100 })).toBeNull();
    expect(screenGuideKey({ ...MOVIE, season: 1 })).toBeNull(); // movie con season
  });
});

describe("screenWorkHash", () => {
  it("produce el SHA-256 hex de la cadena canónica", async () => {
    await expect(screenWorkHash("movie", "tt0111161", "es")).resolves.toBe(
      "faddc7d57b2cddaa833bab815b3ab28731f74001b15531da7e498e39ee30f709",
    );
  });

  it("es estable y cambia con cualquier componente", async () => {
    const a = await screenWorkHash("tv", "tt11280740", "en");
    const b = await screenWorkHash("tv", "tt11280740", "en");
    const c = await screenWorkHash("tv", "tt11280740", "es");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(c);
    // La firma no admite episodio: la serie completa es una obra.
    expect(await screenWorkHash("movie", "tt9999999", "en")).not.toBe(a);
  });
});

describe("screenChapterId / screenChapterLabel", () => {
  it("película → capítulo único «movie» / «Película»", () => {
    expect(screenChapterId(MOVIE)).toBe("movie");
    expect(screenChapterLabel(MOVIE)).toBe("Película");
  });

  it("episodio → «sNN eNN» / «Tn · En» sin títulos", () => {
    expect(screenChapterId(EP3)).toBe("s01e03");
    expect(screenChapterLabel(EP3)).toBe("T1 · E3");
    expect(
      screenChapterId({ ...EP3, season: 12, episode: 100 }),
    ).toBe("s12e100");
    expect(screenChapterLabel({ ...EP3, season: 0, episode: 1 })).toBe(
      "T0 · E1",
    );
  });
});

describe("subtitleToForms", () => {
  const srt = readFileSync(
    resolve(__dirname, "../../fixtures/screen-sample.srt"),
    "utf8",
  );

  it("devuelve solo formas sueltas: sin frases, sin tiempos, sin créditos", () => {
    const { forms, capitalOnly } = subtitleToForms(srt, "en");
    // Formas esperadas del diálogo inventado.
    for (const form of [
      "elara",
      "meridian",
      "express",
      "kael",
      "lighthouse",
      "keeper",
      "pier",
      "dawn",
      "northern",
      "fog",
    ]) {
      expect(forms).toContain(form);
    }
    // Stopwords, tiempos, etiquetas, acotaciones y créditos fuera.
    for (const gone of [
      "the",
      "and",
      "for",
      "00",
      "-->" ,
      "synced",
      "fansubs",
      "example",
      "subs",
      "car",
      "horns",
      "softly",
      "la",
    ]) {
      expect(forms).not.toContain(gone);
    }
    // Solo formas sueltas: ninguna entrada es una frase.
    for (const form of forms) {
      expect(form).not.toContain(" ");
      expect(form).toMatch(/^[a-záéíóúüñ]+$/);
    }
    // capitalOnly: nombres que solo aparecen capitalizados.
    for (const name of ["elara", "meridian", "express", "kael"]) {
      expect(capitalOnly).toContain(name);
    }
    // «wait» aparece como «Wait» y «wait»: no es capitalOnly.
    expect(capitalOnly).not.toContain("wait");
    expect(capitalOnly).not.toContain("the");
    // Y capitalOnly también son formas sueltas.
    for (const form of capitalOnly) {
      expect(forms).toContain(form);
      expect(form).not.toContain(" ");
    }
  });

  it("en español filtra sus stopwords", () => {
    const { forms } = subtitleToForms(
      "1\n00:00:01,000 --> 00:00:02,000\nEl faro de la ciudad ya no gira.\n",
      "es",
    );
    expect(forms).toContain("faro");
    expect(forms).toContain("ciudad");
    expect(forms).toContain("gira");
    expect(forms).not.toContain("el");
    expect(forms).not.toContain("la");
    expect(forms).not.toContain("de");
    expect(forms).not.toContain("ya");
  });

  it("un subtítulo vacío o solo créditos devuelve listas vacías", () => {
    const { forms, capitalOnly } = subtitleToForms(
      "1\n00:00:01,000 --> 00:00:02,000\nSubtitles by X · http://a.b\n",
      "en",
    );
    expect(forms).toEqual([]);
    expect(capitalOnly).toEqual([]);
  });
});

describe("sanitizeScreenGuideObject", () => {
  const VALID = {
    v: 1,
    type: "tv",
    imdbId: "tt11280740",
    season: 1,
    episode: 3,
    language: "en",
    forms: ["alpha", "Beta", "the"],
    capitalOnly: ["kael", "the"],
    phrases: ["take for granted", "frase inventada del guion", "dar por sentado"],
    createdAt: 1700000000000,
    // Propiedades extra que deben desaparecer:
    text: "diálogo confidencial del episodio",
    quote: "I knew it",
    timings: [{ start: 0, end: 1 }],
  };

  it("conserva la forma canónica y descarta todo lo demás", () => {
    const out = sanitizeScreenGuideObject(VALID, EP3);
    expect(out).not.toBeNull();
    expect(out!.v).toBe(1);
    expect(out!.type).toBe("tv");
    expect(out!.season).toBe(1);
    expect(out!.episode).toBe(3);
    // forms: minúsculas, sin stopwords («the» fuera), ordenadas.
    expect(out!.forms).toEqual(["alpha", "beta"]);
    expect(out!.capitalOnly).toEqual(["kael"]);
    // phrases: solo claves del banco — la «frase inventada» se va.
    expect(out!.phrases).toEqual(
      expect.arrayContaining(["take for granted", "dar por sentado"]),
    );
    expect(out!.phrases).toHaveLength(2);
    expect(out!.createdAt).toBe(1700000000000);
    // Nada del contenido prohibido sobrevive.
    expect(JSON.stringify(out)).not.toContain("confidencial");
    expect(JSON.stringify(out)).not.toContain("knew it");
    expect(Object.keys(out!).sort()).toEqual(
      ["v", "type", "imdbId", "season", "episode", "language", "forms", "capitalOnly", "phrases", "createdAt"].sort(),
    );
  });

  it("rechaza versión distinta, identidad distinta o entrada inválida", () => {
    expect(sanitizeScreenGuideObject({ ...VALID, v: 2 }, EP3)).toBeNull();
    expect(
      sanitizeScreenGuideObject({ ...VALID, episode: 4 }, EP3),
    ).toBeNull();
    expect(
      sanitizeScreenGuideObject({ ...VALID, imdbId: "tt9999999" }, EP3),
    ).toBeNull();
    expect(sanitizeScreenGuideObject(null, EP3)).toBeNull();
    expect(sanitizeScreenGuideObject("x", EP3)).toBeNull();
    expect(sanitizeScreenGuideObject(VALID, { ...EP3, season: 100 })).toBeNull();
  });

  it("una película no puede declarar season/episode", () => {
    const movieGuide = {
      v: 1,
      type: "movie",
      imdbId: "tt0111161",
      language: "es",
      forms: ["casa"],
      capitalOnly: [],
      phrases: [],
      createdAt: 1,
      season: 1, // prohibidos para movie
      episode: 1,
    };
    expect(sanitizeScreenGuideObject(movieGuide, MOVIE)).toBeNull();
    const { season: _s, episode: _e, ...clean } = movieGuide;
    expect(sanitizeScreenGuideObject(clean, MOVIE)).not.toBeNull();
  });
});
