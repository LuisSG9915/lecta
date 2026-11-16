import { describe, expect, it } from "vitest";
import {
  isValidSubtitleRef,
  normalizeWorkTitle,
  subtitleChapterId,
  subtitleChapterLabel,
  subtitleFileToGuide,
  subtitleWorkHash,
} from "./subtitle-works";
import { mergeChapterIntoGuide } from "./screen";
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

// Un subtítulo con 60 palabras distintas: pasa el mínimo de formas.
const word = (i: number) =>
  "wd" + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)) + "ing";
const bigSrt = () =>
  Array.from(
    { length: 60 },
    (_, i) => `${i + 1}\n00:00:01,000 --> 00:00:02,000\nThe lighthouse keeper ${word(i)} onward.\n`,
  ).join("\n");

const file = (text: string, name = "ep.srt") =>
  Object.assign(new Blob([text]), { name });

describe("normalizeWorkTitle y hash", () => {
  it("mismo título con otra grafía = misma obra", async () => {
    expect(normalizeWorkTitle("  DÁRK!! ")).toBe("dark");
    const a = await subtitleWorkHash({ type: "tv", title: "Dark", language: "en" });
    const b = await subtitleWorkHash({ type: "tv", title: " dárk ", language: "en" });
    expect(a).toBe(b);
    expect(a).toMatch(SHA256_HEX_RE);
  });

  it("tipo e idioma cambian la identidad", async () => {
    const base = { title: "Dark" } as const;
    const tvEn = await subtitleWorkHash({ ...base, type: "tv", language: "en" });
    expect(tvEn).not.toBe(await subtitleWorkHash({ ...base, type: "tv", language: "es" }));
    expect(tvEn).not.toBe(await subtitleWorkHash({ ...base, type: "movie", language: "en" }));
  });

  it("título vacío = sin identidad", async () => {
    expect(await subtitleWorkHash({ type: "movie", title: " ¡! ", language: "es" })).toBeNull();
  });
});

describe("isValidSubtitleRef y capítulos", () => {
  it("película sin temporada; serie con temporada y episodio", () => {
    expect(isValidSubtitleRef({ type: "movie", title: "Heat", language: "en" })).toBe(true);
    expect(isValidSubtitleRef({ type: "movie", title: "Heat", language: "en", season: 1 })).toBe(false);
    expect(isValidSubtitleRef({ type: "tv", title: "Dark", language: "en" })).toBe(false);
    expect(isValidSubtitleRef({ type: "tv", title: "Dark", language: "en", season: 1, episode: 2 })).toBe(true);
    expect(isValidSubtitleRef({ type: "tv", title: "Dark", language: "en", season: 1, episode: 0 })).toBe(false);
  });

  it("ids y etiquetas con el contrato de las obras de pantalla", () => {
    const ref = { type: "tv", title: "Dark", language: "en", season: 1, episode: 2 } as const;
    expect(subtitleChapterId(ref)).toBe("s01e02");
    expect(subtitleChapterLabel(ref)).toBe("T1 · E2");
    expect(subtitleChapterId({ type: "movie", title: "Heat", language: "en" })).toBe("movie");
  });
});

describe("subtitleFileToGuide", () => {
  it("un subtítulo real da formas, sin diálogo ni red", async () => {
    const result = await subtitleFileToGuide(file(bigSrt()), "en");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forms.length).toBeGreaterThanOrEqual(50);
    expect(result.forms).toContain("lighthouse");
    // «Solo palabras»: ninguna forma lleva espacios (no hay frases).
    expect(result.forms.every((f) => !/\s/.test(f))).toBe(true);
  });

  it("archivo vacío o con poco diálogo → too-few-forms", async () => {
    expect(await subtitleFileToGuide(file(""), "en")).toEqual({ ok: false, reason: "too-few-forms" });
    expect(await subtitleFileToGuide(file("1\n00:00:01,000 --> 00:00:02,000\nHello there.\n"), "en")).toEqual({
      ok: false,
      reason: "too-few-forms",
    });
  });

  it("más de 3 MB → too-big sin leerlo", async () => {
    const big = Object.assign(new Blob([new Uint8Array(3 * 1024 * 1024 + 1)]), { name: "x.srt" });
    expect(await subtitleFileToGuide(big, "en")).toEqual({ ok: false, reason: "too-big" });
  });
});

describe("mergeChapterIntoGuide", () => {
  it("junta episodios en orden numérico y reemplaza el repetido", () => {
    const meta = { bookHash: "a".repeat(64), title: "Dark" };
    const ch = (id: string, label: string, forms: string[]) => ({ id, label, forms, capitalOnly: [] });
    let guide = mergeChapterIntoGuide(null, ch("s01e10", "T1 · E10", ["zeta"]), "en", meta);
    guide = mergeChapterIntoGuide(guide, ch("s01e02", "T1 · E2", ["alfa"]), "en", meta);
    guide = mergeChapterIntoGuide(guide, ch("s01e10", "T1 · E10", ["omega"]), "en", meta);
    expect(guide?.chapters.map((c) => c.id)).toEqual(["s01e02", "s01e10"]);
    expect(guide?.chapters[1].forms).toEqual(["omega"]);
  });
});
