import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { startFromScratch } from "./account-reset";
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
