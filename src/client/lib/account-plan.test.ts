import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as idbModule from "./idb";
import {
  claimStarterCoat,
  loadPlan,
  pendingStarterCoat,
  planFromAccountState,
  planStore,
  pollPlanUntilPlus,
  refreshPlan,
  rememberLandingSource,
  rememberStarterCoat,
  resetPlanStoreForTests,
  savePlan,
  setFreeAiRemaining,
} from "./account-plan";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("account-plan", () => {
  let kv: Map<string, string>;

  beforeEach(() => {
    resetPlanStoreForTests();
    localStorage.clear();
    kv = new Map();
    vi.spyOn(idbModule, "getActiveUserId").mockReturnValue("u1");
    vi.spyOn(idbModule, "saveSessionValue").mockImplementation(async (key, value) => {
      kv.set(key, value);
      return key;
    });
    vi.spyOn(idbModule, "loadSessionValue").mockImplementation(async (key) => kv.get(key));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("arranca desconocido (null)", () => {
    expect(planStore.get()).toBeNull();
  });

  it("planFromAccountState conserva trialEndedAt", () => {
    const snap = planFromAccountState({ ok: true, plan: "free", starterCoat: null, planExpiresAt: null, trialEndedAt: 1234 });
    expect(snap?.trialEndedAt).toBe(1234);
    expect(planFromAccountState({ ok: true, plan: "free", trialEndedAt: null })?.trialEndedAt).toBeUndefined();
  });

  it("planFromAccountState: sin plan conserva la caché (null)", () => {
    expect(planFromAccountState({ ok: true, resetAt: 1 })).toBeNull();
    expect(planFromAccountState(null)).toBeNull();
    expect(
      planFromAccountState({ plan: "lecta_plus", starterCoat: "nope", planExpiresAt: 9 }),
    ).toEqual({ plan: "lecta_plus", starterCoat: null, expiresAt: 9 });
  });

  it("lee freeAiRemaining y trialEndsAt del estado y los descuenta/agota", async () => {
    expect(
      planFromAccountState({ plan: "free", freeAiRemaining: 3, trialEndsAt: null }),
    ).toEqual({ plan: "free", starterCoat: null, expiresAt: null, freeAiRemaining: 3, trialEndsAt: null });
    expect(planFromAccountState({ plan: "free", freeAiRemaining: "x" })?.freeAiRemaining).toBeUndefined();
    await savePlan("u1", { plan: "free", freeAiRemaining: 2, trialEndsAt: null });
    setFreeAiRemaining(null);
    expect(planStore.get()?.freeAiRemaining).toBe(1);
    setFreeAiRemaining(0);
    expect(planStore.get()?.freeAiRemaining).toBe(0);
    setFreeAiRemaining(null);
    expect(planStore.get()?.freeAiRemaining).toBe(0);
  });

  it("savePlan publica, avisa a los suscriptores y persiste por cuenta", async () => {
    const listener = vi.fn();
    planStore.subscribe(listener);
    await savePlan("u1", { plan: "free", starterCoat: "mist", planExpiresAt: null });
    expect(planStore.get()).toEqual({ plan: "free", starterCoat: "mist", expiresAt: null });
    expect(listener).toHaveBeenCalled();
    expect(kv.has("account:plan:v1:u1")).toBe(true);
  });

  it("no muestra el plan de otra cuenta tras cambiar de cuenta", async () => {
    await savePlan("u1", { plan: "founder_lifetime" });
    vi.mocked(idbModule.getActiveUserId).mockReturnValue("u2");
    expect(planStore.get()).toBeNull();
  });

  it("loadPlan lee la caché cuando aún no hay plan", async () => {
    kv.set("account:plan:v1:u1", JSON.stringify({ plan: "lecta_plus", planExpiresAt: 5 }));
    await loadPlan("u1");
    expect(planStore.get()?.plan).toBe("lecta_plus");
  });

  it("refreshPlan: un fallo de red conserva la caché", async () => {
    await savePlan("u1", { plan: "founder_lifetime" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await refreshPlan("u1")).toBeNull();
    expect(planStore.get()?.plan).toBe("founder_lifetime");
  });

  it("rememberStarterCoat solo guarda pelajes válidos", () => {
    rememberStarterCoat("pelaje-calico");
    expect(pendingStarterCoat()).toBeNull();
    rememberStarterCoat("calico");
    expect(pendingStarterCoat()).toBe("calico");
  });

  it("claimStarterCoat reclama una sola vez y borra lecta:gato", async () => {
    await savePlan("u1", { plan: "free" });
    rememberStarterCoat("calico");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ starterCoat: "calico" }));
    const [a, b] = await Promise.all([claimStarterCoat("u1", undefined), claimStarterCoat("u1", undefined)]);
    expect(a).toBe("calico");
    expect(b).toBe("calico");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pendingStarterCoat()).toBeNull();
    expect(planStore.get()?.starterCoat).toBe("calico");
  });

  it("claimStarterCoat manda la fuente de la landing y la borra al confirmarse", async () => {
    await savePlan("u1", { plan: "free" });
    rememberStarterCoat("mist");
    rememberLandingSource("google.com");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ starterCoat: "mist" }));
    expect(await claimStarterCoat("u1", undefined)).toBe("mist");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ coat: "mist", src: "google.com" });
    expect(localStorage.getItem("lecta:src")).toBeNull();
  });

  it("claimStarterCoat sin fuente no manda src", async () => {
    await savePlan("u1", { plan: "free" });
    rememberStarterCoat("mist");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ starterCoat: "mist" }));
    await claimStarterCoat("u1", undefined);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ coat: "mist" });
  });

  it("claimStarterCoat sin pelaje pendiente no llama a la red", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await claimStarterCoat("u1", undefined)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("una prueba inversa ya terminada (p. ej. en la caché sin red) cuenta como free", () => {
    const now = Date.UTC(2026, 11, 20);
    expect(planFromAccountState({ plan: "lecta_plus", trialEndsAt: now - 1 }, now)).toMatchObject({
      plan: "free",
      trialEndsAt: null,
    });
    expect(planFromAccountState({ plan: "lecta_plus", trialEndsAt: now + 1 }, now)).toMatchObject({
      plan: "lecta_plus",
      trialEndsAt: now + 1,
    });
  });

  it("pollPlanUntilPlus no se detiene por la prueba inversa: espera la suscripción", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ plan: "lecta_plus", trialEndsAt: Date.now() + 86_400_000 }))
      .mockResolvedValueOnce(jsonResponse({ plan: "lecta_plus", trialEndsAt: null }));
    const sleep = vi.fn(async () => undefined);
    expect(await pollPlanUntilPlus("u1", undefined, { sleep })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pollPlanUntilPlus se detiene al ver lecta_plus", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ plan: "free" }))
      .mockResolvedValueOnce(jsonResponse({ plan: "lecta_plus" }));
    const sleep = vi.fn(async () => undefined);
    expect(await pollPlanUntilPlus("u1", undefined, { sleep })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("pollPlanUntilPlus se rinde al agotar el tiempo", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ plan: "free" }));
    const sleep = vi.fn(async () => undefined);
    expect(
      await pollPlanUntilPlus("u1", undefined, { sleep, intervalMs: 2000, timeoutMs: 6000 }),
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
