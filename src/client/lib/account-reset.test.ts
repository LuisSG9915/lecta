import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { applyRemoteReset, checkRemoteReset, startFromScratch } from "./account-reset";
import { accountFetch } from "./account-fetch";
import { readLocalResetMarker } from "./account-cleanup";
import * as idbModule from "./idb";
import * as syncCursorsModule from "./sync-cursors";
import * as syncStateModule from "./sync-state";

describe("startFromScratch", () => {
  const USER_ID = "u_test_reset_123";

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("pausa sync, llama al backend, borra IndexedDB y cursores, limpia storage y reanuda sync", async () => {
    const pauseSpy = vi.spyOn(syncStateModule, "pauseSync");
    const resumeSpy = vi.spyOn(syncStateModule, "resumeSync");
    const deleteDbSpy = vi.spyOn(idbModule, "deleteAccountDb").mockResolvedValue(true);
    const clearCursorsSpy = vi.spyOn(syncCursorsModule, "clearSyncCursors");

    localStorage.setItem(`lecta:last-book:${USER_ID}`, "book-xyz");
    localStorage.setItem(`lecta:companion:${USER_ID}`, "cat-data");
    localStorage.setItem(`lecta:onboarding:${USER_ID}`, "1");
    localStorage.setItem("lecta:location:book-123", "loc");
    localStorage.setItem("lecta:reading-goal", "30");
    localStorage.setItem("lecta:theme", "sepia"); // Debería conservarse

    let pauseCalledBeforeFetch = false;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (pauseSpy.mock.calls.length > 0) {
        pauseCalledBeforeFetch = true;
      }
      expect(url).toBe("/api/account/reset");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-lecta-user-id"]).toBe(USER_ID);
      expect(headers["Authorization"]).toBe("Bearer custom-token");
      return new Response(JSON.stringify({ ok: true, resetAt: "2026-10-29T12:00:00Z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await startFromScratch(USER_ID, "custom-token");

    expect(pauseCalledBeforeFetch).toBe(true);
    expect(deleteDbSpy).toHaveBeenCalledWith(USER_ID);
    expect(clearCursorsSpy).toHaveBeenCalledWith(USER_ID);
    expect(resumeSpy).toHaveBeenCalledTimes(1);

    expect(localStorage.getItem(`lecta:last-book:${USER_ID}`)).toBeNull();
    expect(localStorage.getItem(`lecta:companion:${USER_ID}`)).toBeNull();
    expect(localStorage.getItem(`lecta:onboarding:${USER_ID}`)).toBeNull();
    expect(localStorage.getItem("lecta:location:book-123")).toBeNull();
    expect(localStorage.getItem("lecta:reading-goal")).toBeNull();
    expect(localStorage.getItem("lecta:theme")).toBe("sepia");
  });

  it("guarda el sello de reinicio que devuelve el servidor", async () => {
    vi.spyOn(idbModule, "deleteAccountDb").mockResolvedValue(true);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, resetAt: "2026-10-29T12:00:00Z", resetAtMs: 4_444 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await startFromScratch(USER_ID);

    expect(readLocalResetMarker(USER_ID)).toBe(4_444);
  });

  it("no borra IndexedDB ni cursores locales si el servidor responde con error, pero sí reanuda sync", async () => {
    const pauseSpy = vi.spyOn(syncStateModule, "pauseSync");
    const resumeSpy = vi.spyOn(syncStateModule, "resumeSync");
    const deleteDbSpy = vi.spyOn(idbModule, "deleteAccountDb");
    const clearCursorsSpy = vi.spyOn(syncCursorsModule, "clearSyncCursors");

    localStorage.setItem(`lecta:last-book:${USER_ID}`, "book-xyz");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "No se pudo completar el reinicio" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(startFromScratch(USER_ID)).rejects.toThrow("No se pudo completar el reinicio");

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(deleteDbSpy).not.toHaveBeenCalled();
    expect(clearCursorsSpy).not.toHaveBeenCalled();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`lecta:last-book:${USER_ID}`)).toBe("book-xyz");
  });
});

describe("reinicio aprendido del servidor (applyRemoteReset / checkRemoteReset)", () => {
  const USER_ID = "u_remote_reset";
  const scope = { userId: USER_ID, generation: 0 };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const stateResponse = (resetAt: number) =>
    new Response(JSON.stringify({ ok: true, resetAt }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  it("con sello remoto más nuevo vacía IndexedDB, cursores y claves, recuerda la marca y reactiva la cuenta", async () => {
    const deleteDbSpy = vi.spyOn(idbModule, "deleteAccountDb").mockResolvedValue(true);
    const setUserSpy = vi.spyOn(idbModule, "setDbUser").mockResolvedValue(undefined);
    vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
    const clearCursorsSpy = vi.spyOn(syncCursorsModule, "clearSyncCursors");
    localStorage.setItem(`lecta:last-book:${USER_ID}`, "book-xyz");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stateResponse(9_000)));

    const applied = await checkRemoteReset(scope, { force: true });

    expect(applied).toBe(true);
    expect(deleteDbSpy).toHaveBeenCalledWith(USER_ID);
    expect(clearCursorsSpy).toHaveBeenCalledWith(USER_ID);
    expect(setUserSpy).toHaveBeenCalledWith(USER_ID);
    expect(readLocalResetMarker(USER_ID)).toBe(9_000);
    expect(localStorage.getItem(`lecta:last-book:${USER_ID}`)).toBeNull();
  });

  it("no toca nada cuando el sello remoto ya estaba reconocido", async () => {
    const deleteDbSpy = vi.spyOn(idbModule, "deleteAccountDb").mockResolvedValue(true);
    vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stateResponse(9_000)));
    // Ya reconocimos ese mismo reinicio antes.
    localStorage.setItem(`lecta:account-reset:${USER_ID}`, "9000");

    const applied = await checkRemoteReset(scope, { force: true });

    expect(applied).toBe(false);
    expect(deleteDbSpy).not.toHaveBeenCalled();
  });

  it("sin respuesta válida del servidor no borra nada", async () => {
    const deleteDbSpy = vi.spyOn(idbModule, "deleteAccountDb").mockResolvedValue(true);
    vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 500 })));

    const applied = await checkRemoteReset(scope, { force: true });

    expect(applied).toBe(false);
    expect(deleteDbSpy).not.toHaveBeenCalled();
    expect(readLocalResetMarker(USER_ID)).toBe(0);
  });

  it("si IndexedDB queda bloqueado no escribe la marca: el próximo ciclo reintenta", async () => {
    const deleteDbSpy = vi.spyOn(idbModule, "deleteAccountDb").mockResolvedValue(false);
    const setUserSpy = vi.spyOn(idbModule, "setDbUser");

    const applied = await applyRemoteReset(USER_ID, 7_000);

    expect(applied).toBe(false);
    expect(deleteDbSpy).toHaveBeenCalledWith(USER_ID);
    expect(setUserSpy).not.toHaveBeenCalled();
    expect(readLocalResetMarker(USER_ID)).toBe(0);
  });

  it("la marca jamás retrocede: un sello viejo no pisa uno más nuevo", async () => {
    vi.spyOn(idbModule, "deleteAccountDb").mockResolvedValue(true);
    vi.spyOn(idbModule, "setDbUser").mockResolvedValue(undefined);
    localStorage.setItem(`lecta:account-reset:${USER_ID}`, "9000");

    await applyRemoteReset(USER_ID, 3_000);

    expect(readLocalResetMarker(USER_ID)).toBe(9_000);
  });

  it("accountFetch declara la marca en x-lecta-reset y un 409 account_reset dispara el vaciado", async () => {
    const deleteDbSpy = vi.spyOn(idbModule, "deleteAccountDb").mockResolvedValue(true);
    vi.spyOn(idbModule, "setDbUser").mockResolvedValue(undefined);
    vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
    localStorage.setItem(`lecta:account-reset:${USER_ID}`, "1000");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "account_reset", resetAt: 9_000 }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await accountFetch("/api/positions", { method: "PUT" }, scope);

    expect(res.status).toBe(409);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("x-lecta-reset")).toBe("1000");
    await vi.waitFor(() => expect(deleteDbSpy).toHaveBeenCalledWith(USER_ID));
    await vi.waitFor(() => expect(readLocalResetMarker(USER_ID)).toBe(9_000));
  });
});
