// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  isBookScopedSessionKey,
  isMigratableSessionKey,
  mergePreparationKnowledge,
  mergePreparationWord,
  mergeSessionValue,
  type KnownWord,
  type SavedWord,
} from "./idb";

const NOW = 1728000000000;

const known = (extra: Partial<KnownWord> = {}): KnownWord => ({
  key: "es:casa",
  language: "es",
  lemma: "casa",
  known: true,
  source: "calibration",
  updatedAt: 1,
  ...extra,
});

const saved = (extra: Partial<SavedWord> = {}): SavedWord => ({
  key: "es:casa",
  form: "casa",
  lemma: "casa",
  language: "es",
  meaning: "hogar",
  context: "La casa.",
  savedAt: 1,
  updatedAt: 1,
  card: { reps: 3, stability: 40 } as SavedWord["card"],
  ...extra,
});

describe("mergePreparationKnowledge", () => {
  const row = { language: "es", lemma: "Casa", known: true, source: "preparation" };

  it("sin fila previa crea evidencia normalizada con fecha nueva", () => {
    expect(mergePreparationKnowledge(undefined, row, NOW)).toEqual({
      language: "es",
      lemma: "Casa",
      known: true,
      source: "preparation",
      key: "es:casa",
      updatedAt: NOW,
    });
  });

  it("misma respuesta ya activa no escribe nada", () => {
    expect(
      mergePreparationKnowledge(known({ source: "preparation" }), row, NOW),
    ).toBeNull();
    // Aunque la fuente sea distinta, el veredicto no cambió.
    expect(mergePreparationKnowledge(known(), row, NOW)).toBeNull();
  });

  it("respuesta distinta a la activa sí reescribe", () => {
    const out = mergePreparationKnowledge(
      known(),
      { ...row, known: false },
      NOW,
    );
    expect(out).toMatchObject({ known: false, updatedAt: NOW });
  });

  it("lápida con respuesta explícita se restaura como evidencia fresca", () => {
    const out = mergePreparationKnowledge(known({ deleted: true }), row, NOW);
    expect(out).toMatchObject({ known: true, updatedAt: NOW });
    expect(out).not.toHaveProperty("deleted");
  });
});

describe("mergeKnowledgeWrite (fuerza de fuente)", () => {
  it("una fuente más débil jamás cambia el veredicto de una fuerte", () => {
    // Un «inferred» no puede deshacer un «ya la conozco» declarado,
    // ni siquiera con veredicto distinto.
    const out = mergePreparationKnowledge(
      known({ source: "declared" }),
      { language: "es", lemma: "casa", known: false, source: "inferred" },
      NOW,
    );
    expect(out).toBeNull();
  });

  it("a fuerza igual gana lo último que escribió el lector", () => {
    // «Ya la conocía» tras una respuesta de preparación: misma fuerza,
    // veredicto distinto → se actualiza.
    const out = mergePreparationKnowledge(
      known({ source: "preparation", known: false }),
      { language: "es", lemma: "casa", known: true, source: "declared" },
      NOW,
    );
    expect(out).toMatchObject({ known: true, source: "declared" });
  });

  it("mismo veredicto con fuente más fuerte eleva la fila", () => {
    const out = mergePreparationKnowledge(
      known({ source: "inferred", known: false }),
      { language: "es", lemma: "casa", known: false, source: "saved" },
      NOW,
    );
    expect(out).toMatchObject({ known: false, source: "saved" });
  });
});

describe("mergePreparationWord", () => {
  const word = {
    form: "casa",
    lemma: "casa",
    language: "es",
    meaning: "hogar",
    context: "Otra casa.",
  };

  it("palabra activa no se toca: conserva tarjeta, contexto y fechas", () => {
    const existing = saved();
    expect(mergePreparationWord(existing, word, NOW)).toBeNull();
  });

  it("palabra nueva se crea con clave y fechas del lote", () => {
    const out = mergePreparationWord(undefined, word, NOW);
    expect(out).toEqual({ ...word, key: "es:casa", savedAt: NOW, updatedAt: NOW });
  });

  it("lápida se restaura conservando tarjeta, acepción y fecha original", () => {
    const existing = saved({
      deleted: true,
      senseEntryId: "42",
      senseOrder: 2,
      savedAt: 5,
    });
    const out = mergePreparationWord(existing, word, NOW);
    expect(out).toMatchObject({
      key: "es:casa",
      deleted: undefined,
      card: existing.card,
      senseEntryId: "42",
      senseOrder: 2,
      savedAt: 5,
      updatedAt: NOW,
    });
  });

  it("lápida con campos vacíos rellena con la respuesta nueva", () => {
    const existing = saved({
      deleted: true,
      meaning: undefined,
      context: undefined,
      lemma: undefined,
    });
    const out = mergePreparationWord(existing, word, NOW);
    expect(out).toMatchObject({
      meaning: "hogar",
      context: "Otra casa.",
      lemma: "casa",
    });
  });
});

describe("isMigratableSessionKey", () => {
  it("migra calibración, inicio y preparación por libro", () => {
    expect(isMigratableSessionKey("calibrationDone")).toBe(true);
    expect(isMigratableSessionKey("bookStart:v1:abc")).toBe(true);
    expect(isMigratableSessionKey("preparation:v1:abc:cap1")).toBe(true);
  });

  it("no migra sellos de sync ni claves arbitrarias", () => {
    for (const key of [
      "vocabLastSyncAt",
      "knowledgeLastSyncAt",
      "latestBookHash",
      "readingWpm",
      "suggestionLevel",
      "auth-token",
      "cualquierCosa",
    ])
      expect(isMigratableSessionKey(key)).toBe(false);
  });
});

describe("mergeSessionValue", () => {
  const record = (updatedAt: number) => JSON.stringify({ updatedAt });

  it("sin registro en la cuenta entra el anónimo", () => {
    expect(mergeSessionValue(undefined, record(5))).toBe(record(5));
    expect(mergeSessionValue(null, "1")).toBe("1");
  });

  it("un registro anónimo más reciente gana al de la cuenta", () => {
    expect(mergeSessionValue(record(3), record(9))).toBe(record(9));
  });

  it("la cuenta conserva lo suyo con sello igual o mayor", () => {
    expect(mergeSessionValue(record(9), record(9))).toBe(record(9));
    expect(mergeSessionValue(record(9), record(3))).toBe(record(9));
  });

  it("contenido sin sello o corrupto jamás pisa lo de la cuenta", () => {
    expect(mergeSessionValue("1", record(9))).toBe("1");
    expect(mergeSessionValue("{roto", record(9))).toBe("{roto");
    expect(mergeSessionValue(record(9), "{roto")).toBe(record(9));
  });
});

describe("isBookScopedSessionKey", () => {
  it("reconoce el inicio y las preparaciones del libro", () => {
    expect(isBookScopedSessionKey("abc", "bookStart:v1:abc")).toBe(true);
    expect(isBookScopedSessionKey("abc", "preparation:v1:abc:cap1")).toBe(
      true,
    );
    expect(
      isBookScopedSessionKey("abc", "preparation:v1:abc:OEBPS%2Fcap%231"),
    ).toBe(true);
  });

  it("un prefijo parecido de otro libro no borra", () => {
    expect(isBookScopedSessionKey("abc", "bookStart:v1:abc2")).toBe(false);
    expect(isBookScopedSessionKey("abc", "preparation:v1:abc2:cap1")).toBe(
      false,
    );
    expect(isBookScopedSessionKey("abc2", "bookStart:v1:abc")).toBe(false);
  });

  it("claves ajenas al ciclo quedan intactas", () => {
    for (const key of [
      "latestBookHash",
      "calibrationDone",
      "readingWpm",
      "preparation:v2:abc:cap1",
    ])
      expect(isBookScopedSessionKey("abc", key)).toBe(false);
  });
});
