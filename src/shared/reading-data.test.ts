import { describe, expect, it } from "vitest";
import {
  cleanKnowledge,
  cleanPosition,
  cleanReview,
  isFsrsCardShape,
  KNOWLEDGE_LIMITS,
  KNOWLEDGE_SOURCE_STRENGTH,
  KNOWLEDGE_SOURCES,
  knowledgeArbKey,
  knowledgeArbSql,
  knowledgeArbWins,
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

describe("isFsrsCardShape", () => {
  const validCard = {
    due: "2025-01-02T00:00:00.000Z",
    stability: 3.5,
    difficulty: 5.1,
    elapsed_days: 2,
    scheduled_days: 3,
    learning_steps: 0,
    reps: 4,
    lapses: 1,
    state: 2,
    last_review: "2025-01-01T00:00:00.000Z",
  };

  it("acepta una tarjeta serializada por ts-fsrs", () => {
    expect(isFsrsCardShape(validCard)).toBe(true);
    // Fechas como número u objeto Date también son DateInput válido.
    expect(isFsrsCardShape({ ...validCard, due: 1_700_000_000_000 })).toBe(true);
    expect(isFsrsCardShape({ ...validCard, due: new Date() })).toBe(true);
    // last_review es opcional (una tarjeta nunca repasada).
    const sinReview = { ...validCard };
    delete (sinReview as Record<string, unknown>).last_review;
    expect(isFsrsCardShape(sinReview)).toBe(true);
  });

  it("rechaza tarjetas que no son objetos o son nulos", () => {
    for (const card of [null, undefined, "tarjeta", 5, []])
      expect(isFsrsCardShape(card)).toBe(false);
  });

  it("rechaza fechas inválidas en due o last_review", () => {
    for (const due of ["no-es-fecha", NaN, null, {}, Infinity])
      expect(isFsrsCardShape({ ...validCard, due })).toBe(false);
    expect(
      isFsrsCardShape({ ...validCard, last_review: "ayer" }),
    ).toBe(false);
  });

  it("rechaza métricas no finitas y contadores negativos o fraccionarios", () => {
    expect(isFsrsCardShape({ ...validCard, stability: NaN })).toBe(false);
    expect(isFsrsCardShape({ ...validCard, difficulty: Infinity })).toBe(false);
    expect(isFsrsCardShape({ ...validCard, reps: -1 })).toBe(false);
    expect(isFsrsCardShape({ ...validCard, lapses: 1.5 })).toBe(false);
    expect(isFsrsCardShape({ ...validCard, elapsed_days: -3 })).toBe(false);
  });

  it("rechaza un state fuera del enum de ts-fsrs", () => {
    for (const state of [-1, 4, 99, "Review", null])
      expect(isFsrsCardShape({ ...validCard, state })).toBe(false);
    for (const state of [0, 1, 2, 3])
      expect(isFsrsCardShape({ ...validCard, state })).toBe(true);
  });

  it("tolera campos extra: se conservan, no pelean el validador", () => {
    expect(
      isFsrsCardShape({ ...validCard, custom: "dato", otra: [1, 2] }),
    ).toBe(true);
  });
});

describe("knowledgeArbWins", () => {
  const row = (over: Partial<Parameters<typeof knowledgeArbKey>[0]> = {}) => ({
    source: "inferred",
    updatedAt: 100,
    known: true,
    ...over,
  });

  it("la fuente fuerte gana aunque la débil tenga sello más nuevo", () => {
    const declared = row({ source: "declared", updatedAt: 100 });
    const inferred = row({ source: "inferred", known: false, updatedAt: 999 });
    expect(knowledgeArbWins(declared, inferred)).toBe(true);
    expect(knowledgeArbWins(inferred, declared)).toBe(false);
  });

  it("a fuerza igual gana el sello más reciente", () => {
    const vieja = row({ source: "declared", updatedAt: 100 });
    const nueva = row({ source: "preparation", known: false, updatedAt: 200 });
    expect(knowledgeArbWins(nueva, vieja)).toBe(true);
    expect(knowledgeArbWins(vieja, nueva)).toBe(false);
  });

  it("una lápida compite como explícita: una inferencia nueva no resucita", () => {
    const lapida = row({ source: "declared", deleted: true, updatedAt: 100 });
    const inferred = row({ source: "inferred", updatedAt: 500 });
    expect(knowledgeArbWins(lapida, inferred)).toBe(true);
    expect(knowledgeArbWins(inferred, lapida)).toBe(false);
  });

  it("una respuesta explícita posterior sí revive una lápida", () => {
    const lapida = row({ source: "inferred", deleted: true, updatedAt: 300 });
    const declared = row({ source: "declared", updatedAt: 400 });
    expect(knowledgeArbWins(declared, lapida)).toBe(true);
    expect(knowledgeArbWins(lapida, declared)).toBe(false);
  });

  it("a llave empatada gana la lápida y luego la desconocida", () => {
    const viva = row({ source: "declared", updatedAt: 100 });
    const lapida = row({ source: "declared", updatedAt: 100, deleted: true });
    expect(knowledgeArbWins(lapida, viva)).toBe(true);
    expect(knowledgeArbWins(viva, lapida)).toBe(false);
    const desconocida = row({ source: "declared", updatedAt: 100, known: false });
    expect(knowledgeArbWins(desconocida, viva)).toBe(true);
  });

  it("el orden de llegada no cambia el ganador", () => {
    const variants = [
      row({ source: "inferred", updatedAt: 100 }),
      row({ source: "declared", updatedAt: 50, known: false }),
      row({ source: "saved", updatedAt: 200, deleted: true }),
      row({ source: "declared", updatedAt: 150 }),
      row({ source: "preparation", updatedAt: 150, known: false }),
    ];
    for (const a of variants) {
      for (const b of variants) {
        if (a === b) continue;
        const ka = knowledgeArbKey(a);
        const kb = knowledgeArbKey(b);
        const sameKey = ka.every((v, i) => v === kb[i]);
        expect(knowledgeArbWins(a, b)).toBe(sameKey ? false : !knowledgeArbWins(b, a));
      }
    }
  });
});

describe("knowledgeArbSql", () => {
  it("genera la tupla (peso, sello, lápida, veredicto) desde el mapa de fuentes", () => {
    const sql = knowledgeArbSql("t");
    expect(sql).toContain("CASE WHEN t.deleted THEN 2");
    for (const source of KNOWLEDGE_SOURCES)
      expect(sql).toContain(
        `WHEN '${source}' THEN ${KNOWLEDGE_SOURCE_STRENGTH[source]}`,
      );
    // Misma tupla que knowledgeArbKey: peso, updatedAt, lápida, veredicto.
    expect(sql).toMatch(/\(CASE.*, t\.updated_at, t\.deleted, NOT t\.known\)/s);
  });
});
