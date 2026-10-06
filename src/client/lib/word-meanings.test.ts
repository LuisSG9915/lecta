import { describe, expect, it } from "vitest";
import { backfillWordMeanings, planMeaningBackfill } from "./word-meanings";
import type { LexiconEntry } from "./lexicon";
import type { SavedWord } from "./idb";

const entry = (over: Partial<LexiconEntry>): LexiconEntry => ({
  entryId: null,
  lemma: "lema",
  pos: null,
  freqRank: null,
  zipf: null,
  senses: [],
  ...over,
});

const word = (over: Partial<SavedWord> = {}): SavedWord => ({
  key: "es:forma",
  form: "forma",
  language: "es",
  savedAt: 1,
  ...over,
});

const sense = (definition: string, senseOrder = 1) => ({
  definition,
  example: null,
  senseOrder,
});

describe("planMeaningBackfill", () => {
  it("no toca una palabra que ya tiene significado", () => {
    const result = planMeaningBackfill(
      word({ meaning: "ya la tiene" }),
      [entry({ senses: [sense("otra")] })],
    );
    expect(result).toBeNull();
  });

  it("devuelve null sin fichas o sin acepciones útiles", () => {
    expect(planMeaningBackfill(word(), undefined)).toBeNull();
    expect(planMeaningBackfill(word(), [entry({})])).toBeNull();
    expect(
      planMeaningBackfill(word(), [entry({ senses: [sense("   ")] })]),
    ).toBeNull();
  });

  it("rellena significado y campos léxicos vacíos con la primera acepción", () => {
    const result = planMeaningBackfill(word(), [
      entry({ entryId: "9", lemma: "formar", pos: "verbo", senses: [sense("Definición.")] }),
    ]);
    expect(result).toEqual({
      meaning: "Definición.",
      lemma: "formar",
      pos: "verbo",
      senseEntryId: "9",
      senseOrder: 1,
    });
  });

  it("una ficha huérfana no se reasigna a otra entrada", () => {
    // La pareja entryId+senseOrder apunta a una ficha que ya no está
    // en el catálogo: mover el significado de otra entrada bajo esos
    // mismos IDs dejaría una definición que no corresponde a la
    // acepción guardada. Se devuelve null y queda para revisión.
    const result = planMeaningBackfill(
      word({ lemma: "mio", pos: "sustantivo", senseEntryId: "3", senseOrder: 2 }),
      [entry({ entryId: "9", senses: [sense("Otra.")] })],
    );
    expect(result).toBeNull();
  });

  it("la pareja entryId+senseOrder usa exactamente esa acepción", () => {
    const result = planMeaningBackfill(
      word({ senseEntryId: "9", senseOrder: 2 }),
      [
        entry({
          entryId: "9",
          senses: [sense("Primera acepción.", 1), sense("Segunda acepción.", 2)],
        }),
      ],
    );
    expect(result?.meaning).toBe("Segunda acepción.");
    expect(result?.senseOrder).toBe(2);
    expect(result?.senseEntryId).toBe("9");
  });

  it("una acepción guardada que ya no existe no toma la primera", () => {
    const result = planMeaningBackfill(
      word({ senseEntryId: "9", senseOrder: 7 }),
      [
        entry({
          entryId: "9",
          senses: [sense("Primera acepción.", 1)],
        }),
      ],
    );
    expect(result).toBeNull();
  });

  it("prefiere la ficha de la acepción guardada cuando sigue en el catálogo", () => {
    const result = planMeaningBackfill(word({ senseEntryId: "b" }), [
      entry({ entryId: "a", senses: [sense("Primera.")] }),
      entry({ entryId: "b", senses: [sense("La mía.", 4)] }),
    ]);
    expect(result?.meaning).toBe("La mía.");
    expect(result?.senseOrder).toBe(4); // rellena el orden de la ficha elegida
    expect(result?.senseEntryId).toBe("b");
  });

  it("salta fichas sin acepción aunque sean las primeras", () => {
    const result = planMeaningBackfill(word(), [
      entry({ entryId: "a" }),
      entry({ entryId: "b", senses: [sense("Útil.")] }),
    ]);
    expect(result?.meaning).toBe("Útil.");
    expect(result?.senseEntryId).toBe("b");
  });
});

describe("backfillWordMeanings", () => {
  it("consulta el catálogo, guarda los cambios y conserva el orden", async () => {
    const saved: string[] = [];
    const pushed: SavedWord[][] = [];
    const result = await backfillWordMeanings(
      [
        word({ key: "es:con", form: "con", meaning: "ya" }),
        word({ key: "es:vacia", form: "vacia" }),
        word({ key: "es:llena", form: "llena" }),
      ],
      {
        lookup: async () => ({
          ok: true,
          entries: {
            vacia: [],
            llena: [entry({ senses: [sense("Llena de cosas.")] })],
          },
        }),
        save: async (w, patch) => {
          saved.push(w.key);
          return { ...w, ...patch, updatedAt: 42 };
        },
        push: async (ws) => {
          pushed.push(ws);
          return true;
        },
      },
    );
    expect(saved).toEqual(["es:llena"]);
    expect(result.map((w) => w.key)).toEqual(["es:con", "es:vacia", "es:llena"]);
    expect(result[2].meaning).toBe("Llena de cosas.");
    // Lo devuelto y lo empujado es la fila persistida, con su sello
    // nuevo — no el objeto previo al guardado. El body del PUT lleva
    // exactamente el updatedAt que quedó en la base local.
    expect(result[2].updatedAt).toBe(42);
    expect(pushed).toEqual([[result[2]]]);
  });

  it("un cambio de sesión durante el flujo aborta el push, no lo local", async () => {
    // El contexto capturado al iniciar ya no es el activo: las filas
    // guardadas en su base quedan, pero no se envían a la cuenta
    // equivocada.
    const pushed: SavedWord[][] = [];
    const stale = { userId: null, generation: -1 };
    const result = await backfillWordMeanings(
      [word({ key: "es:una", form: "una" })],
      {
        lookup: async () => ({
          ok: true,
          entries: { una: [entry({ senses: [sense("Indefinido.")] })] },
        }),
        save: async (w, patch) => ({ ...w, ...patch, updatedAt: 7 }),
        push: async (ws) => {
          pushed.push(ws);
          return true;
        },
      },
      stale,
    );
    expect(pushed).toEqual([]);
    expect(result[0].meaning).toBe("Indefinido.");
  });

  it("un guardado que decide no escribir no se empuja ni altera", async () => {
    // save → null = la fila cambió durante la consulta (repaso,
    // borrado, edición): no se empuja el objeto viejo al servidor.
    const pushed: SavedWord[][] = [];
    const result = await backfillWordMeanings(
      [word({ key: "es:una", form: "una" })],
      {
        lookup: async () => ({
          ok: true,
          entries: { una: [entry({ senses: [sense("Indefinido.")] })] },
        }),
        save: async () => null,
        push: async (ws) => {
          pushed.push(ws);
          return true;
        },
      },
    );
    expect(pushed).toEqual([]);
    expect(result[0].meaning).toBeUndefined();
  });

  it("un fallo del catálogo deja todo igual sin escribir nada", async () => {
    let saved = 0;
    const result = await backfillWordMeanings([word()], {
      lookup: async () => ({ ok: false, error: "sin red", entries: {} }),
      save: async () => {
        saved += 1;
        return null;
      },
    });
    expect(saved).toBe(0);
    expect(result[0].meaning).toBeUndefined();
  });

  it("agrupa las consultas por idioma", async () => {
    const calls: [string[], string][] = [];
    await backfillWordMeanings(
      [word({ form: "a" }), word({ form: "b", language: "en", key: "en:b" })],
      {
        lookup: async (forms, lang) => {
          calls.push([forms, lang]);
          return { ok: true, entries: {} };
        },
      },
    );
    expect(calls.sort()).toEqual([[["a"], "es"], [["b"], "en"]].sort());
  });
});
