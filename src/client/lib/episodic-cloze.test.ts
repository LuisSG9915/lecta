import { describe, expect, it } from "vitest";
import type { SavedWord } from "./idb";
import type { EpisodicWordItem } from "./practice";
import {
  attachClozeOptions,
  episodicClozeOptions,
  removeSavedWord,
  upsertSavedWord,
} from "./episodic-cloze";

const saved = (form: string, over: Partial<SavedWord> = {}): SavedWord => ({
  key: `${over.language ?? "es"}:${form.toLowerCase()}`,
  form,
  language: "es",
  savedAt: 1,
  ...over,
});

const item = (surfaceForm: string, over: Partial<EpisodicWordItem> = {}): EpisodicWordItem => ({
  lemma: surfaceForm.toLowerCase(),
  surfaceForm,
  lang: "es",
  shortGloss: "",
  chapterSentence: `Nos rodean los equipos, que farfullan piropos apenas ${surfaceForm}.`,
  chapterTitle: "",
  source: "in-chapter-lookup",
  ...over,
});

const POOL = ["quimera", "montaña", "linterna", "amanecer", "sombra"].map((f) => saved(f));

describe("episodicClozeOptions", () => {
  it("objetivo + 3 palabras reales del cuaderno, nunca variantes inventadas", () => {
    const options = episodicClozeOptions(item("inteligibles"), POOL)!;
    expect(options).toHaveLength(4);
    expect(options).toContain("inteligibles");
    expect(options.filter((o) => o.startsWith("inteligib"))).toEqual(["inteligibles"]);
    for (const o of options) if (o !== "inteligibles") expect(POOL.map((w) => w.form)).toContain(o);
  });

  it("es determinista por palabra y no siempre pone el objetivo primero", () => {
    const a = episodicClozeOptions(item("inteligibles"), POOL);
    expect(episodicClozeOptions(item("inteligibles"), POOL)).toEqual(a);
    const firsts = ["farol", "gaviota", "relámpago", "cántaro", "bruma", "ancla"].map(
      (form) => episodicClozeOptions(item(form), POOL)![0],
    );
    expect(firsts.some((first, i) => first !== ["farol", "gaviota", "relámpago", "cántaro", "bruma", "ancla"][i])).toBe(true);
  });

  it("dos lemas distintos no reciben los mismos distractores", () => {
    const pool = ["quimera", "montaña", "linterna", "amanecer", "sombra", "brújula", "pantano", "ceniza"].map((f) => saved(f));
    const rest = (form: string) => new Set(episodicClozeOptions(item(form), pool)!.filter((o) => o !== form));
    const sets = ["farol", "gaviota", "relámpago", "cántaro"].map(rest);
    expect(sets.some((s) => [...s].join() !== [...sets[0]].join())).toBe(true);
  });

  it("filtra por idioma y devuelve null si no alcanzan 2 distractores", () => {
    const pool = POOL.map((w) => ({ ...w, language: "en" }));
    expect(episodicClozeOptions(item("inteligibles"), pool)).toBeNull();
    expect(episodicClozeOptions(item("inteligibles"), [saved("quimera")])).toBeNull();
  });

  it("excluye otras formas de la misma palabra aunque el lema sea la forma (producción)", () => {
    // Consulta sin análisis: lemma === forma («susurró»). «susurraba» comparte
    // prefijo de ≥5 letras y no debe aparecer.
    const pool = [saved("susurraba"), saved("susurrar"), ...POOL];
    const options = episodicClozeOptions(item("susurró", { lemma: "susurró" }), pool)!;
    expect(options).not.toContain("susurraba");
    expect(options).not.toContain("susurrar");
  });

  it("excluye flexiones inglesas sin lema", () => {
    const pool = [saved("whispering", { language: "en" }), ...["lantern", "harbor", "meadow"].map((f) => saved(f, { language: "en" }))];
    const options = episodicClozeOptions(
      item("whispered", { lemma: "whispered", lang: "en", chapterSentence: "She whispered his name." }),
      pool,
    )!;
    expect(options).not.toContain("whispering");
    expect(options).toHaveLength(4);
  });

  it("iguala la mayúscula del objetivo y descarta nombres propios", () => {
    const pool = [saved("Madrid"), ...POOL];
    const lower = episodicClozeOptions(item("inteligibles"), pool)!;
    expect(lower.map((o) => o.toLowerCase())).not.toContain("madrid");
    const upper = episodicClozeOptions(
      item("Susurró", { lemma: "susurró", chapterSentence: "Susurró algo al oído." }),
      POOL,
    )!;
    for (const o of upper) expect(o[0]).toBe(o[0].toUpperCase());
  });

  it("sin hueco en la frase (la frase es la palabra sola) no ofrece cloze", () => {
    expect(episodicClozeOptions(item("quimérico", { chapterSentence: "quimérico" }), POOL)).toBeNull();
    expect(episodicClozeOptions(item("quimérico", { chapterSentence: "¡Quimérico!" }), POOL)).toBeNull();
    expect(episodicClozeOptions(item("quimérico", { chapterSentence: "Otra frase sin ella." }), POOL)).toBeNull();
  });
});

describe("attachClozeOptions", () => {
  it("añade opciones sobre copias sin mutar los ítems de entrada", () => {
    const original = item("inteligibles");
    const [entry] = attachClozeOptions([{ item: original, modality: "sentence-cloze" }], POOL);
    expect(entry.modality).toBe("sentence-cloze");
    expect(entry.item.options).toHaveLength(4);
    expect(original.options).toBeUndefined();
  });

  it("sin opciones pasa a word-scramble (≤10 letras) o saca la entrada", () => {
    const queue = attachClozeOptions(
      [
        { item: item("quimera"), modality: "sentence-cloze" },
        { item: item("inteligibles"), modality: "grammar-nuance" },
        { item: item("dragón"), modality: "word-scramble" },
      ],
      [],
    );
    expect(queue.map((e) => [e.item.surfaceForm, e.modality])).toEqual([
      ["quimera", "word-scramble"],
      ["dragón", "word-scramble"],
    ]);
  });

  it("tolera ítems sin surfaceForm", () => {
    const queue = attachClozeOptions([{ item: { lemma: "casa" } as EpisodicWordItem, modality: "sentence-cloze" }], []);
    expect(queue).toEqual([{ item: { lemma: "casa" }, modality: "word-scramble" }]);
  });
});

describe("upsertSavedWord / removeSavedWord", () => {
  it("inserta, reemplaza y borra por key", () => {
    const a = saved("quimera");
    let words = upsertSavedWord([], a);
    words = upsertSavedWord(words, { ...a, meaning: "ilusión" });
    expect(words).toEqual([{ ...a, meaning: "ilusión" }]);
    words = upsertSavedWord(words, saved("sombra"));
    expect(removeSavedWord(words, a.key).map((w) => w.form)).toEqual(["sombra"]);
  });
});
