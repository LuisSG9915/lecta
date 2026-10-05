import { describe, expect, it } from "vitest";
import {
  cleanKnowledge,
  cleanPosition,
  cleanReview,
  KNOWLEDGE_LIMITS,
  POSITION_LIMITS,
  REVIEW_LIMITS,
} from "./reading-data";

const valid = {
  id: "r1",
  language: "es",
  form: "perenne",
  kind: "meaning",
  rating: "good",
  hints: 1,
  createdAt: 1_700_000_000_000,
};

describe("cleanReview", () => {
  it("acepta un repaso válido y conserva sus campos", () => {
    expect(cleanReview(valid)).toEqual({
      id: "r1",
      language: "es",
      form: "perenne",
      kind: "meaning",
      rating: "good",
      hints: 1,
      createdAt: 1_700_000_000_000,
    });
  });

  it("idioma por omisión es 'es' y hints por omisión es 0", () => {
    const cleaned = cleanReview({ ...valid, language: undefined, hints: undefined });
    expect(cleaned?.language).toBe("es");
    expect(cleaned?.hints).toBe(0);
  });

  it("rellena createdAt con la hora actual si falta o no es válida", () => {
    const before = Date.now();
    const cleaned = cleanReview({ ...valid, createdAt: undefined });
    expect(cleaned?.createdAt).toBeGreaterThanOrEqual(before);
    expect(cleanReview({ ...valid, createdAt: -5 })?.createdAt).toBeGreaterThanOrEqual(before);
  });

  it("rechaza si falta id o form", () => {
    expect(cleanReview({ ...valid, id: "" })).toBeNull();
    expect(cleanReview({ ...valid, id: undefined })).toBeNull();
    expect(cleanReview({ ...valid, form: "   " })).toBeNull();
    expect(cleanReview({ ...valid, form: 42 })).toBeNull();
  });

  it("rechaza kind fuera de la lista", () => {
    expect(cleanReview({ ...valid, kind: "quiz" })).toBeNull();
    expect(cleanReview({ ...valid, kind: undefined })).toBeNull();
  });

  it("rechaza rating fuera de la lista", () => {
    expect(cleanReview({ ...valid, rating: "perfect" })).toBeNull();
    expect(cleanReview({ ...valid, rating: 5 })).toBeNull();
  });

  it("rechaza hints fuera de 0..99 o no enteros", () => {
    expect(cleanReview({ ...valid, hints: 100 })).toBeNull();
    expect(cleanReview({ ...valid, hints: -1 })).toBeNull();
    expect(cleanReview({ ...valid, hints: 1.5 })).toBeNull();
    expect(cleanReview({ ...valid, hints: "2" })).toBeNull();
    expect(cleanReview({ ...valid, hints: 99 })?.hints).toBe(99);
  });

  it("recorta los strings largos a los límites", () => {
    const cleaned = cleanReview({
      ...valid,
      id: "x".repeat(REVIEW_LIMITS.id + 50),
      form: "f".repeat(REVIEW_LIMITS.form + 50),
      language: "l".repeat(30),
    });
    expect(cleaned?.id).toHaveLength(REVIEW_LIMITS.id);
    expect(cleaned?.form).toHaveLength(REVIEW_LIMITS.form);
    expect(cleaned?.language).toHaveLength(10);
  });
});

const validPosition = {
  bookHash: "b1",
  sectionIndex: 3,
  scrollTop: 120.5,
  ratio: 0.4,
  progress: 0.12,
  anchor: "capítulo tres",
  updatedAt: 1_700_000_000_000,
};

describe("cleanPosition", () => {
  it("acepta una posición válida y conserva sus campos", () => {
    expect(cleanPosition(validPosition)).toEqual({
      bookHash: "b1",
      sectionIndex: 3,
      scrollTop: 120.5,
      ratio: 0.4,
      progress: 0.12,
      anchor: "capítulo tres",
      updatedAt: 1_700_000_000_000,
    });
  });

  it("rechaza si falta bookHash", () => {
    expect(cleanPosition({ ...validPosition, bookHash: undefined })).toBeNull();
    expect(cleanPosition({ ...validPosition, bookHash: "" })).toBeNull();
    expect(cleanPosition({ ...validPosition, bookHash: "   " })).toBeNull();
    expect(cleanPosition({ ...validPosition, bookHash: 42 })).toBeNull();
  });

  it("ratio/progress fuera de 0–1 se recortan al rango, no se descartan", () => {
    const cleaned = cleanPosition({ ...validPosition, ratio: 1.4, progress: -0.2 });
    expect(cleaned?.ratio).toBe(1);
    expect(cleaned?.progress).toBe(0);
  });

  it("ratio/progress que no son números quedan null", () => {
    const cleaned = cleanPosition({ ...validPosition, ratio: "x", progress: undefined });
    expect(cleaned?.ratio).toBeNull();
    expect(cleaned?.progress).toBeNull();
  });

  it("campos numéricos ausentes o inválidos caen a 0 y sectionIndex se redondea", () => {
    const cleaned = cleanPosition({ bookHash: "b1", sectionIndex: 2.9, scrollTop: -5 });
    expect(cleaned?.sectionIndex).toBe(2);
    expect(cleaned?.scrollTop).toBe(0);
    expect(cleanPosition({ bookHash: "b1" })?.sectionIndex).toBe(0);
    expect(cleanPosition({ bookHash: "b1" })?.scrollTop).toBe(0);
  });

  it("rellena updatedAt con la hora actual si falta o no es válida", () => {
    const before = Date.now();
    expect(
      cleanPosition({ ...validPosition, updatedAt: undefined })?.updatedAt,
    ).toBeGreaterThanOrEqual(before);
    expect(
      cleanPosition({ ...validPosition, updatedAt: -5 })?.updatedAt,
    ).toBeGreaterThanOrEqual(before);
  });

  it("recorta bookHash y anchor a los límites", () => {
    const cleaned = cleanPosition({
      ...validPosition,
      bookHash: "h".repeat(POSITION_LIMITS.bookHash + 50),
      anchor: "a".repeat(POSITION_LIMITS.anchor + 50),
    });
    expect(cleaned?.bookHash).toHaveLength(POSITION_LIMITS.bookHash);
    expect(cleaned?.anchor).toHaveLength(POSITION_LIMITS.anchor);
  });
});

const validKnowledge = {
  language: "es",
  lemma: "perenne",
  known: true,
  source: "calibration",
  updatedAt: 1_700_000_000_000,
};

describe("cleanKnowledge", () => {
  it("acepta una fila válida y conserva sus campos", () => {
    expect(cleanKnowledge(validKnowledge)).toEqual({
      language: "es",
      lemma: "perenne",
      known: true,
      source: "calibration",
      updatedAt: 1_700_000_000_000,
      deleted: false,
    });
  });

  it("normaliza idioma y lema a minúsculas", () => {
    const cleaned = cleanKnowledge({ ...validKnowledge, language: "ES", lemma: " Perenne " });
    expect(cleaned?.language).toBe("es");
    expect(cleaned?.lemma).toBe("perenne");
  });

  it("rechaza idioma que no sea alfabético de 2–3 letras", () => {
    for (const language of ["e", "espa", "e1", "es-MX", "", 7])
      expect(cleanKnowledge({ ...validKnowledge, language })).toBeNull();
    expect(cleanKnowledge({ ...validKnowledge, language: "por" })?.language).toBe("por");
  });

  it("rechaza si falta el lema o se pasa del límite queda recortado", () => {
    expect(cleanKnowledge({ ...validKnowledge, lemma: "" })).toBeNull();
    expect(cleanKnowledge({ ...validKnowledge, lemma: "   " })).toBeNull();
    expect(cleanKnowledge({ ...validKnowledge, lemma: 42 })).toBeNull();
    const cleaned = cleanKnowledge({
      ...validKnowledge,
      lemma: "l".repeat(KNOWLEDGE_LIMITS.lemma + 50),
    });
    expect(cleaned?.lemma).toHaveLength(KNOWLEDGE_LIMITS.lemma);
  });

  it("rechaza source fuera de la lista", () => {
    for (const source of ["adivinado", "CALIBRATION", "", 5, undefined])
      expect(cleanKnowledge({ ...validKnowledge, source })).toBeNull();
    for (const source of [
      "calibration",
      "declared",
      "inferred",
      "preparation",
      "saved",
    ] as const)
      expect(cleanKnowledge({ ...validKnowledge, source })?.source).toBe(source);
  });

  it("rechaza known que no sea booleano", () => {
    for (const known of ["true", 1, 0, undefined, null])
      expect(cleanKnowledge({ ...validKnowledge, known })).toBeNull();
    expect(cleanKnowledge({ ...validKnowledge, known: false })?.known).toBe(false);
  });

  it("rechaza updatedAt faltante, no entero o en el futuro lejano", () => {
    for (const updatedAt of [undefined, "ayer", 1.5, -5, 0])
      expect(cleanKnowledge({ ...validKnowledge, updatedAt })).toBeNull();
    const future = Date.now() + KNOWLEDGE_LIMITS.futureSkewMs + 60_000;
    expect(cleanKnowledge({ ...validKnowledge, updatedAt: future })).toBeNull();
    // Un reloj adelantado dentro de la tolerancia sí pasa.
    const skewed = Date.now() + 60_000;
    expect(cleanKnowledge({ ...validKnowledge, updatedAt: skewed })?.updatedAt).toBe(skewed);
  });

  it("las lápidas viajan con deleted en true", () => {
    expect(cleanKnowledge({ ...validKnowledge, deleted: true })?.deleted).toBe(true);
    expect(cleanKnowledge({ ...validKnowledge, deleted: "sí" })?.deleted).toBe(false);
  });
});
