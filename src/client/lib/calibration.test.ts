import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveUserId,
  listAllSavedWords,
  listKnowledge,
  putSavedWord,
  saveKnowledge,
  type KnownWord,
  type SavedWord,
} from "./idb";
import {
  calibrationRows,
  hasCalibrationEvidence,
  parseCalibrationDraft,
  recordCalibration,
  type CalibrationAnswers,
  type CalibrationWord,
} from "./calibration";
import { vocabLevelLabel } from "./knowledge";
import { pushKnowledgeToServer } from "./reading-sync";
import { pushWordsToServer } from "./vocab";

// Las transformaciones usan los merges y claves reales; solo se
// sustituye lo que toca almacén o red.
vi.mock("./idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./idb")>();
  return {
    ...mod,
    getActiveUserId: vi.fn(() => "u1"),
    listAllSavedWords: vi.fn(async () => []),
    listKnowledge: vi.fn(async () => []),
    putSavedWord: vi.fn(async () => undefined),
    saveKnowledge: vi.fn(async (row: Record<string, unknown>) => ({
      ...row,
      key: `es:${String(row.lemma)}`,
      updatedAt: 1,
    })),
  };
});
vi.mock("./reading-sync", () => ({
  pushKnowledgeToServer: vi.fn(async () => true),
}));
vi.mock("./vocab", () => ({ pushWordsToServer: vi.fn(async () => true) }));

const userMock = vi.mocked(getActiveUserId);
const listKnowledgeMock = vi.mocked(listKnowledge);
const listWordsMock = vi.mocked(listAllSavedWords);
const putWordMock = vi.mocked(putSavedWord);
const saveKMock = vi.mocked(saveKnowledge);
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
  it("restaura solo respuestas válidas de lemas en la muestra", () => {
    const raw = JSON.stringify({
      answers: { perenne: "unknown", fantasma: "known", Banco: "raro" },
    });
    expect(parseCalibrationDraft(raw, words)).toEqual({ perenne: "unknown" });
  });

  it("corrupto, nulo o de otra forma devuelve vacío", () => {
    expect(parseCalibrationDraft(null, words)).toEqual({});
    expect(parseCalibrationDraft("{no", words)).toEqual({});
    expect(parseCalibrationDraft('{"answers":["x"]}', words)).toEqual({});
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
    listWordsMock.mockResolvedValue([]);
  });

  it("guarda solo respuestas explícitas y empuja las filas escritas", async () => {
    const out = await recordCalibration(
      words,
      answers({ perenne: "unknown", Banco: "known" }),
      "es",
    );
    expect(saveKMock).toHaveBeenCalledTimes(2);
    expect(out.knowledge).toHaveLength(2);
    expect(pushKMock).toHaveBeenCalledWith(out.knowledge);
  });

  it("desconocidas entran al Cuaderno con forma, lema, idioma y definición", async () => {
    await recordCalibration(words, answers({ perenne: "unknown" }), "es");
    expect(putWordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        form: "perenne",
        lemma: "perenne",
        language: "es",
        meaning: "que dura mucho",
      }),
    );
    expect(pushWMock).toHaveBeenCalled();
  });

  it("palabra activa del Cuaderno no se toca; lápida se restaura", async () => {
    const active = {
      key: "es:perenne",
      form: "perenne",
      language: "es",
      savedAt: 5,
      card: { reps: 3 } as SavedWord["card"],
    } as SavedWord;
    listWordsMock.mockResolvedValue([active]);
    const out = await recordCalibration(words, answers({ perenne: "unknown" }), "es");
    expect(putWordMock).not.toHaveBeenCalled();
    expect(out.words).toEqual([]);

    listWordsMock.mockResolvedValue([{ ...active, deleted: true }]);
    await recordCalibration(words, answers({ perenne: "unknown" }), "es");
    expect(putWordMock).toHaveBeenCalledWith(
      expect.objectContaining({ deleted: undefined, card: active.card }),
    );
  });

  it("sin respuestas no escribe ni empuja nada", async () => {
    const out = await recordCalibration(words, {}, "es");
    expect(out).toEqual({ knowledge: [], words: [] });
    expect(saveKMock).not.toHaveBeenCalled();
    expect(putWordMock).not.toHaveBeenCalled();
    expect(pushKMock).toHaveBeenCalledWith([]);
    expect(pushWMock).toHaveBeenCalledWith([]);
  });

  it("cambio de cuenta durante el guardado no empuja con la sesión nueva", async () => {
    saveKMock.mockImplementationOnce(async (row: Record<string, unknown>) => {
      userMock.mockReturnValue("u2");
      return { ...row, key: "es:x", updatedAt: 1 } as KnownWord;
    });
    const out = await recordCalibration(words, answers({ perenne: "known" }), "es");
    expect(out.knowledge).toHaveLength(1);
    expect(pushKMock).not.toHaveBeenCalled();
    expect(pushWMock).not.toHaveBeenCalled();
  });
});

describe("vocabLevelLabel", () => {
  it("umbrales: <2.5 amplio, <3.5 medio, el resto en desarrollo", () => {
    expect(vocabLevelLabel(1.5)).toBe("amplio");
    expect(vocabLevelLabel(2.4)).toBe("amplio");
    expect(vocabLevelLabel(2.5)).toBe("medio");
    expect(vocabLevelLabel(3.4)).toBe("medio");
    expect(vocabLevelLabel(3.5)).toBe("en desarrollo");
    expect(vocabLevelLabel(5.5)).toBe("en desarrollo");
  });
});
