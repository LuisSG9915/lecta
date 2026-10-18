// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveUserId,
  loadSessionValue,
  savePreparationBatch,
  saveSessionValue,
  type KnownWord,
  type SavedWord,
} from "./idb";
import {
  acknowledgePreparationEntry,
  bookStartKey,
  buildPreparationEvidence,
  buildPreparationWords,
  confirmPreparation,
  decidePreparation,
  loadPreparationRecord,
  newPreparationRecord,
  parsePreparationRecord,
  preparationAnswerKey,
  preparationRecordKey,
  savePreparationRecord,
  type PreparationAnswers,
  type PreparationIntent,
  type PreparationRecord,
  type PreparationRow,
} from "./preparation";
import { pushKnowledgeToServer } from "./reading-sync";
import { pushWordsToServer } from "./vocab";

// Las funciones puras sí usan las funciones reales de clave; solo se
// sustituye lo que toca la base de datos o la sesión.
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
    loadSessionValue: vi.fn(async () => undefined as string | undefined),
    savePreparationBatch: vi.fn(),
    saveSessionValue: vi.fn(async () => undefined),
  };
});
vi.mock("./reading-sync", () => ({ pushKnowledgeToServer: vi.fn(async () => true) }));
vi.mock("./vocab", () => ({ pushWordsToServer: vi.fn(async () => true) }));

const batchMock = vi.mocked(savePreparationBatch);
const userMock = vi.mocked(getActiveUserId);
const loadSessionMock = vi.mocked(loadSessionValue);
const saveSessionMock = vi.mocked(saveSessionValue);
const pushKMock = vi.mocked(pushKnowledgeToServer);
const pushWMock = vi.mocked(pushWordsToServer);

const row = (form: string, extra: Partial<PreparationRow> = {}): PreparationRow => ({
  form,
  ...extra,
});

const answers = (pairs: Record<string, "known" | "unknown">): PreparationAnswers =>
  pairs;

describe("preparationRecordKey / bookStartKey", () => {
  it("la clave lleva versión y el destino codificado", () => {
    expect(preparationRecordKey("h1", "capitulo-1.xhtml#s2")).toBe(
      "preparation:v1:h1:capitulo-1.xhtml%23s2",
    );
    expect(bookStartKey("h1")).toBe("bookStart:v1:h1");
  });
});

describe("preparationAnswerKey", () => {
  it("usa lema normalizado y cae a la forma sin lema", () => {
    expect(preparationAnswerKey("es", row("Perennes", { lemma: "Perenne" }))).toBe(
      "es:perenne",
    );
    expect(preparationAnswerKey("es", row("Tilde"))).toBe("es:tilde");
  });
});

describe("parsePreparationRecord", () => {
  const valid = {
    version: 1,
    bookHash: "h1",
    targetId: "cap1",
    disposition: "pending",
    answers: { "es:casa": "unknown" },
    entryAcknowledged: false,
    updatedAt: 1728000000000,
  };

  it("lee un registro válido completo", () => {
    expect(parsePreparationRecord(JSON.stringify(valid))).toEqual(valid);
  });

  it("rechaza nulo, corrupto y versión desconocida", () => {
    expect(parsePreparationRecord(null)).toBeNull();
    expect(parsePreparationRecord("{no")).toBeNull();
    expect(
      parsePreparationRecord(JSON.stringify({ ...valid, version: 2 })),
    ).toBeNull();
  });

  it("rechaza campos con tipo distinto", () => {
    expect(
      parsePreparationRecord(JSON.stringify({ ...valid, disposition: "abierto" })),
    ).toBeNull();
    expect(
      parsePreparationRecord(JSON.stringify({ ...valid, entryAcknowledged: "sí" })),
    ).toBeNull();
    expect(
      parsePreparationRecord(JSON.stringify({ ...valid, updatedAt: "hoy" })),
    ).toBeNull();
  });

  it("rechaza respuestas fuera del conjunto o con forma distinta", () => {
    expect(
      parsePreparationRecord(
        JSON.stringify({ ...valid, answers: { "es:casa": "quizá" } }),
      ),
    ).toBeNull();
    expect(
      parsePreparationRecord(JSON.stringify({ ...valid, answers: ["es:casa"] })),
    ).toBeNull();
  });

  it("acepta registro sin respuestas todavía", () => {
    const rest = { ...valid } as Partial<typeof valid>;
    delete rest.answers;
    const parsed = parsePreparationRecord(JSON.stringify(rest));
    expect(parsed).toMatchObject({ disposition: "pending", answers: {} });
  });
});

describe("buildPreparationEvidence", () => {
  const rows = [
    row("casa", { lemma: "casa" }),
    row("perenne", { lemma: "perenne" }),
    row("tilde"),
  ];

  it("sin respuestas devuelve lista vacía", () => {
    expect(buildPreparationEvidence("es", rows, {})).toEqual([]);
    expect(buildPreparationEvidence("es", [], answers({ "es:casa": "known" }))).toEqual(
      [],
    );
  });

  it("convierte conocida y desconocida en evidencia explícita", () => {
    const out = buildPreparationEvidence(
      "es",
      rows,
      answers({ "es:casa": "known", "es:perenne": "unknown" }),
    );
    expect(out).toEqual([
      { language: "es", lemma: "casa", known: true, source: "preparation" },
      { language: "es", lemma: "perenne", known: false, source: "preparation" },
    ]);
  });

  it("normaliza mayúsculas y deduplica formas del mismo lema", () => {
    const mixed = [
      row("Perenne", { lemma: "Perenne" }),
      row("perennes", { lemma: "perenne" }),
    ];
    const out = buildPreparationEvidence(
      "es",
      mixed,
      answers({ "es:perenne": "unknown" }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].lemma).toBe("perenne");
  });

  it("conserva el orden visual, no el del mapa de respuestas", () => {
    const out = buildPreparationEvidence(
      "es",
      [rows[2], rows[0], rows[1]],
      answers({ "es:perenne": "known", "es:casa": "known", "es:tilde": "known" }),
    );
    expect(out.map((e) => e.lemma)).toEqual(["tilde", "casa", "perenne"]);
  });

  it("usa el idioma en la clave y la fila", () => {
    const out = buildPreparationEvidence(
      "en",
      [row("house", { lemma: "house" })],
      answers({ "en:house": "known" }),
    );
    expect(out).toEqual([
      { language: "en", lemma: "house", known: true, source: "preparation" },
    ]);
    // La misma forma en otro idioma no se responde por esta clave.
    expect(
      buildPreparationEvidence("en", [row("casa")], answers({ "es:casa": "known" })),
    ).toEqual([]);
  });

  it("ignora respuestas sin fila mostrada y filas sin respuesta", () => {
    const out = buildPreparationEvidence(
      "es",
      rows,
      answers({ "es:casa": "known", "es:fantasma": "unknown" }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].lemma).toBe("casa");
  });

  it("no selecciona por definición ni rareza", () => {
    const out = buildPreparationEvidence(
      "es",
      [row("casa", { meaning: "hogar" }), row("tilde")],
      answers({ "es:casa": "unknown", "es:tilde": "unknown" }),
    );
    expect(out).toHaveLength(2);
  });
});

describe("buildPreparationWords", () => {
  const rows = [
    row("Casa", { lemma: "casa", pos: "n", meaning: "hogar", context: "La casa." }),
    row("perenne", { lemma: "perenne" }),
    row("tilde"),
  ];

  it("solo las desconocidas van al cuaderno, con campos léxicos", () => {
    const out = buildPreparationWords(
      "es",
      rows,
      answers({ "es:casa": "unknown", "es:perenne": "known" }),
      "h1",
    );
    expect(out).toEqual([
      {
        form: "Casa",
        lemma: "casa",
        pos: "n",
        meaning: "hogar",
        language: "es",
        context: "La casa.",
        bookHash: "h1",
        senseEntryId: undefined,
        senseOrder: undefined,
      },
    ]);
  });

  it("sin desconocidas devuelve lista vacía", () => {
    expect(
      buildPreparationWords("es", rows, answers({ "es:casa": "known" })),
    ).toEqual([]);
  });

  it("no duplica formas repetidas en la lista", () => {
    const out = buildPreparationWords(
      "es",
      [row("casa"), row("Casa"), row("casa")],
      answers({ "es:casa": "unknown" }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].form).toBe("casa");
  });

  it("conserva contextSnippet si está presente en la fila", () => {
    const out = buildPreparationWords(
      "es",
      [row("vislumbrar", { lemma: "vislumbrar", contextSnippet: "A lo lejos vislumbró una luz." })],
      answers({ "es:vislumbrar": "unknown" }),
      "h1",
    );
    expect(out).toHaveLength(1);
    expect(out[0].contextSnippet).toBe("A lo lejos vislumbró una luz.");
  });
});

describe("filas funcionales", () => {
  // Numeral, pronombre, interjección… nunca generan evidencia ni
  // palabras del Cuaderno — incluidas respuestas de borradores
  // guardados antes del filtro de candidatos.
  it("numeral, pronombre e interjección se ignoran aunque tengan respuesta", () => {
    const rows = [
      row("diez", { pos: "numeral" }),
      row("quienquiera", { pos: "pronombre" }),
      row("hola", { pos: "interjección" }),
      row("perenne", { pos: "adjetivo" }),
      row("tilde"), // sin pos: vocabulario normal
    ];
    const given = answers({
      "es:diez": "unknown",
      "es:quienquiera": "unknown",
      "es:hola": "unknown",
      "es:perenne": "unknown",
      "es:tilde": "unknown",
    });
    expect(
      buildPreparationEvidence("es", rows, given).map((e) => e.lemma),
    ).toEqual(["perenne", "tilde"]);
    expect(
      buildPreparationWords("es", rows, given).map((w) => w.form),
    ).toEqual(["perenne", "tilde"]);
  });
});

describe("confirmPreparation", () => {
  const record = {
    version: 1 as const,
    bookHash: "h1",
    targetId: "cap1",
    disposition: "reviewed" as const,
    answers: { "es:perenne": "unknown" as const },
    entryAcknowledged: true,
    updatedAt: 1,
  };
  const input = {
    record,
    recordKey: "preparation:v1:h1:cap1",
    knowledge: [{ language: "es", lemma: "perenne", known: false, source: "preparation" }],
    words: [{ form: "perenne", language: "es" }],
  };
  const written = {
    knowledge: [
      { key: "es:perenne", language: "es", lemma: "perenne", known: false, source: "preparation", updatedAt: 5 },
    ] as KnownWord[],
    words: [
      { key: "es:perenne", form: "perenne", language: "es", savedAt: 5, updatedAt: 5 },
    ] as SavedWord[],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    userMock.mockReturnValue("u1");
    batchMock.mockResolvedValue(written);
    pushKMock.mockResolvedValue(true);
    pushWMock.mockResolvedValue(true);
  });

  it("guarda local primero y empuja solo las filas escritas", async () => {
    const order: string[] = [];
    batchMock.mockImplementation(async () => {
      order.push("save");
      return written;
    });
    pushKMock.mockImplementation(async () => {
      order.push("pushK");
      return true;
    });
    pushWMock.mockImplementation(async () => {
      order.push("pushW");
      return true;
    });
    const out = await confirmPreparation(input);
    expect(order).toEqual(["save", "pushK", "pushW"]);
    expect(pushKMock).toHaveBeenCalledWith(written.knowledge, expect.anything());
    expect(pushWMock).toHaveBeenCalledWith(written.words, expect.anything());
    expect(out).toMatchObject({ saved: true, synced: true });
    expect(out.knowledge).toEqual(written.knowledge);
    expect(out.words).toEqual(written.words);
  });

  it("guardado local falla → sin sync y resultado saved:false", async () => {
    batchMock.mockRejectedValue(new Error("quota"));
    const out = await confirmPreparation(input);
    expect(out).toMatchObject({ saved: false, synced: false, knowledge: [], words: [] });
    expect(pushKMock).not.toHaveBeenCalled();
    expect(pushWMock).not.toHaveBeenCalled();
  });

  it("sync falla → saved:true, synced:false, sin deshacer", async () => {
    pushKMock.mockResolvedValue(false);
    const out = await confirmPreparation(input);
    expect(out).toMatchObject({ saved: true, synced: false });
    expect(out.knowledge).toEqual(written.knowledge);
  });

  it("sin filas nuevas el sync reporta éxito sin enviar nada", async () => {
    batchMock.mockResolvedValue({ knowledge: [], words: [] });
    const out = await confirmPreparation(input);
    expect(out).toMatchObject({ saved: true, synced: true });
    expect(pushKMock).toHaveBeenCalledWith([], expect.anything());
    expect(pushWMock).toHaveBeenCalledWith([], expect.anything());
  });

  it("cuenta cambiada durante el guardado → no empuja con la sesión nueva", async () => {
    userMock.mockReturnValueOnce("u1").mockReturnValue("u2");
    const out = await confirmPreparation(input);
    expect(out).toMatchObject({ saved: true, synced: false });
    expect(pushKMock).not.toHaveBeenCalled();
    expect(pushWMock).not.toHaveBeenCalled();
  });
});

describe("decidePreparation", () => {
  const record = (extra: Partial<PreparationRecord> = {}): PreparationRecord => ({
    ...newPreparationRecord({ bookHash: "h1", targetId: "cap1", updatedAt: 1 }),
    ...extra,
  });

  const decide = (
    mode: "auto" | "notice" | "off",
    intent: PreparationIntent = "enter",
    rec: PreparationRecord | null = null,
    noticeDismissed?: boolean,
  ) => decidePreparation({ mode, intent, record: rec, noticeDismissed });

  it("entrar a capítulo nuevo: auto prepara, notice avisa, off no interpone", () => {
    expect(decide("auto").opening).toBe("prepare");
    expect(decide("notice").opening).toBe("notice");
    expect(decide("off").opening).toBe("none");
  });

  it("retomar posición guardada nunca interpone, ni con borrador", () => {
    for (const mode of ["auto", "notice", "off"] as const) {
      expect(decide(mode, "resume").opening).toBe("none");
      expect(
        decide(mode, "resume", record({ answers: { "es:x": "known" } })).opening,
      ).toBe("none");
    }
  });

  it("consultar un ancla (búsqueda/marcador) nunca interpone", () => {
    for (const mode of ["auto", "notice", "off"] as const)
      expect(decide(mode, "consult").opening).toBe("none");
  });

  it("entrada ya atendida: acceso manual en los tres modos", () => {
    const rec = record({ disposition: "reviewed", entryAcknowledged: true });
    for (const mode of ["auto", "notice", "off"] as const)
      expect(decide(mode, "enter", rec).opening).toBe("none");
  });

  it("preparado desde intro sin entrada atendida: resumen una vez", () => {
    const rec = record({ disposition: "reviewed", entryAcknowledged: false });
    expect(decide("auto", "enter", rec)).toMatchObject({
      opening: "summary",
      summaryAvailable: true,
    });
    expect(decide("notice", "enter", rec)).toMatchObject({
      opening: "notice",
      summaryAvailable: true,
    });
    expect(decide("off", "enter", rec).opening).toBe("none");
  });

  it("el resumen se muestra una sola vez: al reconocer la entrada queda manual", () => {
    const rec = record({ disposition: "reviewed", entryAcknowledged: false });
    const acknowledged = acknowledgePreparationEntry(rec, 2);
    expect(acknowledged.entryAcknowledged).toBe(true);
    expect(decide("auto", "enter", acknowledged).opening).toBe("none");
    expect(acknowledged.answers).toEqual(rec.answers);
  });

  it("preparación declinada (skipped) no vuelve a interponer", () => {
    const rec = record({ disposition: "skipped" });
    for (const mode of ["auto", "notice", "off"] as const)
      expect(decide(mode, "enter", rec).opening).toBe("none");
  });

  it("borrador pendiente reanuda en auto y avisa en notice", () => {
    const rec = record({ answers: { "es:perenne": "unknown" } });
    expect(decide("auto", "enter", rec)).toMatchObject({
      opening: "prepare",
      resumeDraft: true,
    });
    expect(decide("notice", "enter", rec)).toMatchObject({
      opening: "notice",
      resumeDraft: true,
    });
    expect(decide("off", "enter", rec).opening).toBe("none");
  });

  it("pendiente sin respuestas no cuenta como borrador reanudable", () => {
    expect(decide("auto", "enter", record()).resumeDraft).toBe(false);
  });

  it("análisis termina después de omitir: auto solo acceso, notice refresca si no descartado", () => {
    expect(decide("auto", "analysis-settled").opening).toBe("none");
    expect(decide("notice", "analysis-settled", null, false).opening).toBe("notice");
    expect(decide("notice", "analysis-settled", null, true).opening).toBe("none");
    expect(decide("off", "analysis-settled").opening).toBe("none");
  });

  it("cambiar el ajuste durante la lectura no abre de golpe", () => {
    for (const mode of ["auto", "notice", "off"] as const)
      expect(decide(mode, "settings-change").opening).toBe("none");
  });

  it("apagar y reactivar: el mismo pendiente vuelve a preparar en auto", () => {
    const rec = record({ answers: { "es:x": "known" } });
    expect(decide("off", "enter", rec).opening).toBe("none");
    expect(decide("auto", "enter", rec).opening).toBe("prepare");
  });
});

describe("borrador de preparación", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cerrar y reabrir conserva respuestas sin crear evidencia", async () => {
    const store = new Map<string, string>();
    saveSessionMock.mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
      return key;
    });
    loadSessionMock.mockImplementation(async (key: string) => store.get(key));

    const draft = newPreparationRecord({
      bookHash: "h1",
      targetId: "cap1",
      updatedAt: 7,
      answers: { "es:perenne": "unknown" },
    });
    await savePreparationRecord(draft);
    const loaded = await loadPreparationRecord("h1", "cap1");

    expect(loaded).toEqual(draft);
    // El borrador cargado no genera evidencia hasta confirmar.
    expect(loadSessionMock).toHaveBeenCalledWith(
      preparationRecordKey("h1", "cap1"),
      undefined,
    );
  });

  it("sesión corrupta o de otro destino se ignora con respaldo seguro", async () => {
    loadSessionMock.mockResolvedValue("no-es-json{");
    expect(await loadPreparationRecord("h1", "cap1")).toBeNull();

    const other = newPreparationRecord({
      bookHash: "h2",
      targetId: "cap9",
      updatedAt: 1,
    });
    loadSessionMock.mockResolvedValue(JSON.stringify(other));
    // Contenido válido pero guardado bajo una clave que no le corresponde.
    expect(await loadPreparationRecord("h1", "cap1")).toBeNull();
  });

  it("almacén caído devuelve null — la entrada decide sin registro", async () => {
    loadSessionMock.mockRejectedValue(new Error("idb caído"));
    expect(await loadPreparationRecord("h1", "cap1")).toBeNull();
  });

  it("las claves separan libro y destino (y la cuenta va en la base)", () => {
    expect(preparationRecordKey("h1", "capítulo 1")).toBe(
      "preparation:v1:h1:cap%C3%ADtulo%201",
    );
    expect(preparationRecordKey("h1", "cap1")).not.toBe(
      preparationRecordKey("h2", "cap1"),
    );
    expect(bookStartKey("h1")).toBe("bookStart:v1:h1");
  });
});
