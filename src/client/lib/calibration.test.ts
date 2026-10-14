import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveUserId,
  listKnowledge,
  saveCalibrationBatch,
  type KnownWord,
} from "./idb";
import {
  CALIBRATION_DONE_KEY,
  CALIBRATION_DRAFT_KEY,
  calibrationAnswerScore,
  calibrationDoneKey,
  calibrationDraftKey,
  calibrationRows,
  hasCalibrationEvidence,
  parseCalibrationDraft,
  recordCalibration,
  serializeCalibrationDraft,
  type CalibrationAnswers,
  type CalibrationWord,
} from "./calibration";
import { pushKnowledgeToServer } from "./reading-sync";
import { pushWordsToServer } from "./vocab";

// Las transformaciones usan los merges y claves reales; solo se
// sustituye lo que toca almacén o red.
vi.mock("./idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./idb")>();
  const getActiveUserId = vi.fn((): string | null => "u1");
  return {
    ...mod,
    getActiveUserId,
    captureDbScope: vi.fn(() => ({
      userId: getActiveUserId(),
      generation: 0,
    })),
    isDbScopeActive: vi.fn(
      (scope: { userId: string | null }) => scope.userId === getActiveUserId(),
    ),
    listKnowledge: vi.fn(async () => []),
    // El lote atómico se prueba contra el almacén simulado en
    // idb-scope.test.ts; aquí se simula su salida ya fusionada.
    saveCalibrationBatch: vi.fn(
      async (input: {
        knowledge: Record<string, unknown>[];
        words: Record<string, unknown>[];
      }) => ({
        knowledge: input.knowledge.map((row) => ({
          ...row,
          key: `es:${String(row.lemma)}`,
          updatedAt: 1,
        })),
        words: input.words.map((word) => ({
          ...word,
          key: `es:${String(word.form)}`,
          savedAt: 1,
          updatedAt: 1,
        })),
      }),
    ),
  };
});
vi.mock("./reading-sync", () => ({
  pushKnowledgeToServer: vi.fn(async () => true),
}));
vi.mock("./vocab", () => ({ pushWordsToServer: vi.fn(async () => true) }));

const userMock = vi.mocked(getActiveUserId);
const listKnowledgeMock = vi.mocked(listKnowledge);
const batchMock = vi.mocked(saveCalibrationBatch);
const pushKMock = vi.mocked(pushKnowledgeToServer);
const pushWMock = vi.mocked(pushWordsToServer);

const words: CalibrationWord[] = [
  { lemma: "perenne", definition: "que dura mucho" },
  { lemma: "Banco", definition: "asiento largo" },
  { lemma: "zafiro", definition: "gema azul" },
];

const answers = (pairs: Record<string, "known" | "unknown">): CalibrationAnswers =>
  pairs;

describe("calibrationRows", () => {
  it("solo lo respondido genera evidencia; lo pendiente no es conocido", () => {
    const rows = calibrationRows(words, answers({ perenne: "unknown" }));
    expect(rows).toEqual([
      { language: "es", lemma: "perenne", known: false, source: "calibration" },
    ]);
  });

  it("ambos valores y lemas en minúsculas para la clave del modelo", () => {
    const rows = calibrationRows(
      words,
      answers({ perenne: "unknown", Banco: "known" }),
    );
    expect(rows).toEqual([
      { language: "es", lemma: "perenne", known: false, source: "calibration" },
      { language: "es", lemma: "banco", known: true, source: "calibration" },
    ]);
  });

  it("sin respuestas no hay filas; con lista vacía tampoco", () => {
    expect(calibrationRows(words, {})).toEqual([]);
    expect(calibrationRows([], answers({ x: "known" }))).toEqual([]);
  });

  it("respeta el idioma de la muestra", () => {
    expect(calibrationRows(words, answers({ perenne: "known" }), "en")[0].language).toBe(
      "en",
    );
  });
});

describe("parseCalibrationDraft", () => {
  it("borrador v1 restaura solo respuestas válidas, sin paso", () => {
    const raw = JSON.stringify({
      answers: { perenne: "unknown", fantasma: "known", Banco: "raro" },
    });
    expect(parseCalibrationDraft(raw, words)).toEqual({
      answers: { perenne: "unknown" },
      step: 0,
    });
  });

  it("v2 restaura respuestas, paso y la muestra guardada", () => {
    const draftWords = Array.from({ length: 12 }, (_, i) => ({
      lemma: `palabra${i}`,
      definition: null,
    }));
    const raw = serializeCalibrationDraft({
      answers: { palabra0: "unknown", palabra6: "known", fantasma: "known" },
      step: 1,
      words: draftWords,
    });
    expect(parseCalibrationDraft(raw, words)).toEqual({
      answers: { palabra0: "unknown", palabra6: "known" },
      step: 1,
      words: draftWords,
    });
  });

  it("v2 sin muestra guardada usa la recién descargada", () => {
    const raw = JSON.stringify({ v: 2, answers: { perenne: "known" }, step: 0 });
    const draft = parseCalibrationDraft(raw, words);
    expect(draft.words).toEqual(words);
    expect(draft.answers).toEqual({ perenne: "known" });
  });

  it("el paso se acota al último de la muestra", () => {
    const raw = serializeCalibrationDraft({ answers: {}, step: 9, words });
    // Tres palabras → un solo paso; el 9 se acota a 0.
    expect(parseCalibrationDraft(raw, words).step).toBe(0);
    const big = Array.from({ length: 18 }, (_, i) => ({
      lemma: `w${i}`,
      definition: null,
    }));
    const two = serializeCalibrationDraft({ answers: {}, step: 9, words: big });
    expect(parseCalibrationDraft(two, big).step).toBe(2);
  });

  it("corrupto, nulo o de otra forma devuelve vacío", () => {
    const empty = { answers: {}, step: 0 };
    expect(parseCalibrationDraft(null, words)).toEqual(empty);
    expect(parseCalibrationDraft("{no", words)).toEqual(empty);
    expect(parseCalibrationDraft('{"answers":["x"]}', words)).toEqual(empty);
  });

  it("una versión desconocida no se interpreta como v1", () => {
    // Un borrador v3 futuro con respuestas: leerlo como v1 restauraría
    // respuestas escritas para otra muestra y otro formato.
    const raw = JSON.stringify({
      v: 3,
      answers: { perenne: "unknown" },
      step: 2,
      words,
    });
    expect(parseCalibrationDraft(raw, words)).toEqual({ answers: {}, step: 0 });
    // Lo mismo con `v` no numérica.
    const raro = JSON.stringify({ v: "2", answers: { perenne: "known" } });
    expect(parseCalibrationDraft(raro, words)).toEqual({ answers: {}, step: 0 });
  });
});

describe("hasCalibrationEvidence", () => {
  // Sin mockReset: en vitest 5 reinicia el mock de módulo de tal modo
  // que un lanzamiento de la implementación siguiente atraviesa el
  // try/catch del código bajo prueba. Cada prueba fija su impl.
  beforeEach(() => listKnowledgeMock.mockResolvedValue([]));

  it("verdadero con una fila de calibración, falso sin ella", async () => {
    listKnowledgeMock.mockResolvedValue([
      { key: "es:casa", language: "es", lemma: "casa", known: true, source: "declared", updatedAt: 1 },
    ] as KnownWord[]);
    expect(await hasCalibrationEvidence("es")).toBe(false);
    listKnowledgeMock.mockResolvedValue([
      { key: "es:casa", language: "es", lemma: "casa", known: true, source: "calibration", updatedAt: 1 },
    ] as KnownWord[]);
    expect(await hasCalibrationEvidence("es")).toBe(true);
  });

  it("almacén caído devuelve falso — no impide la oferta", async () => {
    // Vitest 5 reporta como fallo un rechazo/raise en el impl
    // persistente de un mock de módulo aunque el consumidor lo
    // capture; un impl «once» con rechazo en async anidada pasa
    // limpio y llega como rechazo real.
    listKnowledgeMock.mockImplementationOnce(async () => {
      const real = async () => {
        throw new Error("idb caído");
      };
      return real();
    });
    expect(await hasCalibrationEvidence("es")).toBe(false);
  });
});

describe("recordCalibration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userMock.mockReturnValue("u1");
  });

  it("guarda solo respuestas explícitas y empuja las filas escritas", async () => {
    const out = await recordCalibration(
      words,
      answers({ perenne: "unknown", Banco: "known" }),
      "es",
    );
    const input = batchMock.mock.calls[0][0];
    expect(input.knowledge).toHaveLength(2);
    expect(input.words).toEqual([
      expect.objectContaining({ form: "perenne" }),
    ]);
    expect(out.knowledge).toHaveLength(2);
    expect(pushKMock).toHaveBeenCalledWith(out.knowledge, expect.anything());
  });

  it("desconocidas entran al Cuaderno con forma, lema, idioma y definición", async () => {
    await recordCalibration(words, answers({ perenne: "unknown" }), "es");
    expect(batchMock.mock.calls[0][0].words).toEqual([
      {
        form: "perenne",
        lemma: "perenne",
        language: "es",
        meaning: "que dura mucho",
      },
    ]);
    expect(pushWMock).toHaveBeenCalled();
  });

  it("sin respuestas no escribe nada; el lote vacío igual se confirma", async () => {
    const out = await recordCalibration(words, {}, "es");
    expect(out).toEqual({ knowledge: [], words: [] });
    expect(batchMock).toHaveBeenCalledWith(
      { knowledge: [], words: [] },
      expect.anything(),
    );
    expect(pushKMock).toHaveBeenCalledWith([], expect.anything());
    expect(pushWMock).toHaveBeenCalledWith([], expect.anything());
  });

  it("cambio de cuenta durante el guardado no empuja con la sesión nueva", async () => {
    batchMock.mockImplementationOnce(async () => {
      userMock.mockReturnValue("u2");
      return { knowledge: [], words: [] };
    });
    await recordCalibration(words, answers({ perenne: "known" }), "es");
    expect(pushKMock).not.toHaveBeenCalled();
    expect(pushWMock).not.toHaveBeenCalled();
  });

  it("un fallo del lote se propaga — quien llama decide no marcar", async () => {
    batchMock.mockRejectedValueOnce(new Error("tx abortada"));
    await expect(
      recordCalibration(words, answers({ perenne: "known" }), "es"),
    ).rejects.toThrow("tx abortada");
    expect(pushKMock).not.toHaveBeenCalled();
    expect(pushWMock).not.toHaveBeenCalled();
  });
});

describe("calibrationDoneKey and calibrationDraftKey", () => {
  it("usa la clave base para español por compatibilidad y añade sufijo para otros idiomas", () => {
    expect(calibrationDoneKey("es")).toBe(CALIBRATION_DONE_KEY);
    expect(calibrationDoneKey()).toBe(CALIBRATION_DONE_KEY);
    expect(calibrationDoneKey("en")).toBe(`${CALIBRATION_DONE_KEY}:en`);

    expect(calibrationDraftKey("es")).toBe(CALIBRATION_DRAFT_KEY);
    expect(calibrationDraftKey()).toBe(CALIBRATION_DRAFT_KEY);
    expect(calibrationDraftKey("en")).toBe(`${CALIBRATION_DRAFT_KEY}:en`);
  });
});

describe("calibrationAnswerScore and IRT adaptive engine", () => {
  it("asigna ponderaciones cognitivas precisas: known=1.0, unsure=0.35, unknown=0.0", () => {
    expect(calibrationAnswerScore("known")).toBe(1.0);
    expect(calibrationAnswerScore("unsure")).toBe(0.35);
    expect(calibrationAnswerScore("unknown")).toBe(0.0);
  });

  it("probKnown2PL y fisherInformation se comportan según el modelo 2PL", async () => {
    const { probKnown2PL, fisherInformation } = await import("./profile-models");
    // En el punto theta == b_i, la probabilidad es exactamente 0.5
    expect(probKnown2PL(4.0, 4.0)).toBeCloseTo(0.5, 4);
    // Para theta superior a la dificultad, la probabilidad es > 0.5
    expect(probKnown2PL(5.0, 4.0)).toBeGreaterThan(0.5);
    // Para theta inferior a la dificultad, la probabilidad es < 0.5
    expect(probKnown2PL(3.0, 4.0)).toBeLessThan(0.5);

    // La información de Fisher alcanza su máximo cuando theta == b_i
    const peakInfo = fisherInformation(4.0, 4.0);
    const offsetInfo = fisherInformation(4.0, 3.0);
    expect(peakInfo).toBeGreaterThan(offsetInfo);
  });

  it("selectNextAdaptiveItem elige el ítem que maximiza la información de Fisher y descarta respondidos", async () => {
    const { selectNextAdaptiveItem } = await import("./profile-models");
    const candidates = [
      { lemma: "facil", difficulty: 2.0 },
      { lemma: "media", difficulty: 4.0 },
      { lemma: "dificil", difficulty: 5.5 },
    ];
    // Para theta=3.9, la palabra más cercana es "media" (b_i=4.0)
    const next1 = selectNextAdaptiveItem(candidates, new Set(), 3.9);
    expect(next1?.lemma).toBe("media");

    // Si "media" ya se respondió, debe elegir la siguiente más informativa (dificil con dist 1.6 vs facil con dist 1.9)
    const next2 = selectNextAdaptiveItem(candidates, new Set(["media"]), 3.9);
    expect(next2?.lemma).toBe("dificil");
  });

  it("estimateThetaMAP actualiza la habilidad según las respuestas Bayesianas", async () => {
    const { estimateThetaMAP } = await import("./profile-models");
    // Lector que acierta todas las palabras difíciles (score=1.0)
    const highResponses = [
      { b_i: 4.0, score: 1.0 },
      { b_i: 4.5, score: 1.0 },
      { b_i: 5.0, score: 1.0 },
      { b_i: 5.5, score: 1.0 },
    ];
    const highTheta = estimateThetaMAP(highResponses);
    expect(highTheta).toBeGreaterThan(4.5);

    // Lector que desconoce la mayoría (score=0.0)
    const lowResponses = [
      { b_i: 4.0, score: 0.0 },
      { b_i: 3.5, score: 0.0 },
      { b_i: 3.0, score: 0.0 },
    ];
    const lowTheta = estimateThetaMAP(lowResponses);
    expect(lowTheta).toBeLessThan(3.5);

    // Respuesta "unsure" (0.35) pondera entre unknown y known
    const unsureResponses = [
      { b_i: 4.0, score: 0.35 },
      { b_i: 4.5, score: 0.35 },
    ];
    const unsureTheta = estimateThetaMAP(unsureResponses);
    expect(unsureTheta).toBeLessThan(highTheta);
  });

  it("applyOverconfidenceCorrection penaliza proporcionalmente según fallos en verificación", async () => {
    const { applyOverconfidenceCorrection } = await import("./profile-models");
    const thetaInitial = 4.8;
    // Si aprueba todas (0 fallos de 2), no hay penalización
    expect(applyOverconfidenceCorrection(thetaInitial, 0, 2)).toBe(4.8);

    // Si falla 1 de 2 verificaciones: penalización = 0.35 * (1/2) = 0.175 -> 4.8 - 0.175 = 4.625 ~ 4.63
    const penalized1 = applyOverconfidenceCorrection(thetaInitial, 1, 2);
    expect(penalized1).toBeCloseTo(4.63, 1);

    // Si falla 2 de 2 verificaciones: penalización = 0.35 * (2/2) = 0.35 -> 4.8 - 0.35 = 4.45
    const penalized2 = applyOverconfidenceCorrection(thetaInitial, 2, 2);
    expect(penalized2).toBeCloseTo(4.45, 1);
  });

  it("recupera frases de contexto natural para palabras del banco", async () => {
    const { calibrationSampleContext } = await import("../../shared/calibration-bank");
    const ctx = calibrationSampleContext("diletante");
    expect(ctx).toContain("diletante");
    expect(ctx).toContain("salones literarios");

    const ctxEn = calibrationSampleContext("clandestine", "en");
    expect(ctxEn).toContain("clandestine");
  });
});


