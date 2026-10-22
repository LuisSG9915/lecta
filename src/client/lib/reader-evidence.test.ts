// Pruebas de la evidencia del lector (extraída de Reader.tsx): refresco del
// perfil y exposición pasiva. Sin jsdom: son funciones sobre refs y módulos.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LexiconEntry } from "../../shared/lexicon";
import { checkPassiveExposure, refreshProfile } from "./reader-evidence";
import { DEFAULT_THRESHOLD_NATIVE } from "./knowledge";

const mocks = vi.hoisted(() => ({
  listKnowledge: vi.fn(),
  listSavedWords: vi.fn(),
  recordPassiveExposure: vi.fn(),
  captureDbScope: vi.fn(() => ({})),
  batchLookup: vi.fn(),
  loadUserLanguageProfile: vi.fn(),
  updateLanguageTheta: vi.fn(),
  betaFromZipf: vi.fn(),
}));

vi.mock("./idb", async (orig) => ({
  ...(await orig<typeof import("./idb")>()),
  listKnowledge: mocks.listKnowledge,
  listSavedWords: mocks.listSavedWords,
  recordPassiveExposure: mocks.recordPassiveExposure,
  captureDbScope: mocks.captureDbScope,
}));

vi.mock("./lexicon", async (orig) => ({
  ...(await orig<typeof import("./lexicon")>()),
  batchLookup: mocks.batchLookup,
}));

vi.mock("./profile-models", async (orig) => ({
  ...(await orig<typeof import("./profile-models")>()),
  loadUserLanguageProfile: mocks.loadUserLanguageProfile,
  updateLanguageTheta: mocks.updateLanguageTheta,
  betaFromZipf: mocks.betaFromZipf,
}));

const ref = <T>(current: T) => ({ current });

const entry = (lemma: string, zipf: number): LexiconEntry => ({
  entryId: "1",
  lemma,
  pos: "n",
  freqRank: null,
  zipf,
  senses: [{ definition: "definición", example: null, senseOrder: 0 }],
});

const profileRefs = () => ({
  savedForms: ref(new Map<string, never>()),
  evidenceRef: ref(new Map()),
  pendingKnowledgeRef: ref(new Set<string>()),
  knowledgeMapRef: ref(new Map()),
  adjustRef: ref(0),
  baseThresholdRef: ref(DEFAULT_THRESHOLD_NATIVE),
  profileRef: ref(null),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listKnowledge.mockResolvedValue([]);
  mocks.listSavedWords.mockResolvedValue([]);
  mocks.batchLookup.mockResolvedValue({ ok: true, entries: {} });
  mocks.captureDbScope.mockReturnValue({});
});

describe("refreshProfile", () => {
  it("sin evidencia no consulta el catálogo y deja el perfil estimado", async () => {
    const refs = profileRefs();
    await refreshProfile(refs, "es");
    expect(mocks.batchLookup).not.toHaveBeenCalled();
    expect(refs.evidenceRef.current.size).toBe(0);
    expect(refs.knowledgeMapRef.current.size).toBe(0);
    expect(refs.profileRef.current).not.toBeNull();
  });

  it("descarta la evidencia «inferred: no la conozco» sin palabra que la respalde", async () => {
    const refs = profileRefs();
    mocks.listKnowledge.mockResolvedValue([
      { key: "es:zorra", language: "es", lemma: "zorra", known: false, source: "inferred", updatedAt: 1 },
    ]);
    await refreshProfile(refs, "es");
    expect(mocks.batchLookup).not.toHaveBeenCalled();
    expect(refs.knowledgeMapRef.current.size).toBe(0);
  });

  it("acepta esa misma fila cuando la palabra está en el cuaderno", async () => {
    const refs = profileRefs();
    mocks.listKnowledge.mockResolvedValue([
      { key: "es:zorra", language: "es", lemma: "zorra", known: false, source: "inferred", updatedAt: 1 },
    ]);
    mocks.listSavedWords.mockResolvedValue([
      { key: "es:zorra", form: "zorras", lemma: "zorra", language: "es", savedAt: 1 },
    ]);
    mocks.batchLookup.mockResolvedValue({ ok: true, entries: { zorra: [entry("zorra", 3.2)] } });
    await refreshProfile(refs, "es");
    expect(mocks.batchLookup).toHaveBeenCalledTimes(1);
    expect(mocks.batchLookup.mock.calls[0][0]).toEqual(["zorra"]);
    expect(refs.evidenceRef.current.get("zorra")?.zipf).toBeCloseTo(3.2);
  });

  it("recupera lo escrito en la sesión desde el mapa local aunque el catálogo no lo traiga", async () => {
    const refs = profileRefs();
    refs.pendingKnowledgeRef.current.add("nueva");
    refs.knowledgeMapRef.current.set("nueva", { lemma: "nueva", known: true });
    await refreshProfile(refs, "es");
    expect(refs.knowledgeMapRef.current.get("nueva")?.known).toBe(true);
    expect(refs.evidenceRef.current.get("nueva")).toEqual({ known: true, zipf: null });
  });

  it("pide las bases clíticas en una segunda pasada cuando no hay ficha de la forma", async () => {
    const refs = profileRefs();
    mocks.listKnowledge.mockResolvedValue([
      { key: "es:abrirlo", language: "es", lemma: "abrirlo", known: true, source: "declared", updatedAt: 1 },
    ]);
    await refreshProfile(refs, "es");
    expect(mocks.batchLookup.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.batchLookup.mock.calls[1][0]).toContain("abrir");
  });
});

describe("checkPassiveExposure", () => {
  const exposure = (over: Partial<Parameters<typeof checkPassiveExposure>[0]> = {}) => ({
    bookRef: ref(null),
    consultedInPageRef: ref(new Set<string>()),
    pageCountRef: ref(1),
    pageEnteredAtRef: ref(Date.now() - 60_000),
    sectionIndexRef: ref(0),
    savedForms: ref(new Map<string, never>()),
    ...over,
  });

  const input = (over: Partial<Parameters<typeof checkPassiveExposure>[1]> = {}) => ({
    language: "es",
    sectionWords: 10,
    analysisFor: vi.fn(() => ({
      state: "ready" as const,
      forms: ["casa", "perro"],
      entries: {},
      capitalOnly: new Set<string>(),
      text: "casa perro",
    })),
    applyKnowledgeRow: vi.fn(),
    ...over,
  });

  it("la primera comprobación solo sella el instante de la página", () => {
    const refs = exposure({ pageEnteredAtRef: ref(0) });
    const data = input();
    checkPassiveExposure(refs, data);
    expect(mocks.recordPassiveExposure).not.toHaveBeenCalled();
    expect(refs.pageEnteredAtRef.current).toBeGreaterThan(0);
    expect(data.analysisFor).not.toHaveBeenCalled();
  });

  it("no registra si la permanencia no llega al mínimo", () => {
    const refs = exposure({ pageEnteredAtRef: ref(Date.now() - 100) });
    checkPassiveExposure(refs, input());
    expect(mocks.recordPassiveExposure).not.toHaveBeenCalled();
  });

  it("no registra por encima de 450 ppm", () => {
    const refs = exposure({ pageEnteredAtRef: ref(Date.now() - 13_000) });
    checkPassiveExposure(refs, input({ sectionWords: 100 }));
    expect(mocks.recordPassiveExposure).not.toHaveBeenCalled();
  });

  it("no registra sin análisis del destino", () => {
    const refs = exposure();
    const data = input({ analysisFor: vi.fn(() => undefined) });
    checkPassiveExposure(refs, data);
    expect(mocks.recordPassiveExposure).not.toHaveBeenCalled();
  });

  it("registra hasta 8 lemas sin consultar ni guardar y limpia las consultas", async () => {
    mocks.recordPassiveExposure.mockResolvedValue({
      key: "es:casa",
      language: "es",
      lemma: "casa",
      known: false,
      source: "passive",
      updatedAt: 1,
    });
    const forms = ["casa", "perro", "gato", "mesa", "silla", "luna", "sol", "mar", "río", "pan", "uno", "dos"];
    const refs = exposure();
    refs.consultedInPageRef.current.add("perro");
    refs.savedForms.current.set("gato", "learning" as never);
    const data = input({
      analysisFor: vi.fn(() => ({
        state: "ready" as const,
        forms,
        entries: {},
        capitalOnly: new Set<string>(),
        text: forms.join(" "),
      })),
    });
    checkPassiveExposure(refs, data);
    const registered = mocks.recordPassiveExposure.mock.calls.map((call) => call[1]);
    expect(registered).toHaveLength(8);
    expect(registered).not.toContain("perro");
    expect(registered).not.toContain("gato");
    expect(new Set(registered).size).toBe(8);
    expect(refs.consultedInPageRef.current.size).toBe(0);
    await vi.waitFor(() => expect(data.applyKnowledgeRow).toHaveBeenCalled());
  });

  it("refuerza el theta cuando una palabra cae en la frontera", () => {
    mocks.loadUserLanguageProfile.mockReturnValue({ thetaByLang: { es: 4 } });
    mocks.betaFromZipf.mockReturnValue(4);
    const refs = exposure();
    const forms = ["casa"];
    const data = input({
      analysisFor: vi.fn(() => ({
        state: "ready" as const,
        forms,
        entries: { casa: [entry("casa", 4)] },
        capitalOnly: new Set<string>(),
        text: "casa",
      })),
    });
    checkPassiveExposure(refs, data);
    expect(mocks.updateLanguageTheta).toHaveBeenCalledWith("es", 4, 1, 0.25);
  });
});
