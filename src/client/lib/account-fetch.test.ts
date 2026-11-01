// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountFetch } from "./account-fetch";
import { getSyncState, updateSyncState } from "./sync-state";
import { StaleScopeError, type DbScope } from "./idb";

vi.mock("./idb", () => {
  class MockStaleScopeError extends Error {
    constructor() {
      super("El alcance de la base cambió");
      this.name = "StaleScopeError";
    }
  }
  return {
    isDbScopeActive: vi.fn(() => true),
    StaleScopeError: MockStaleScopeError,
  };
});

const accountScope: DbScope = { userId: "u-1", generation: 1 };
const anonScope: DbScope = { userId: null, generation: 1 };

describe("accountFetch", () => {
  beforeEach(() => {
    updateSyncState({ sessionExpired: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("declara la cuenta esperada con la cabecera x-lecta-user-id", async () => {
    await accountFetch("/api/vocab/pull", undefined, accountScope);
    const headers = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers);
    expect(headers.get("x-lecta-user-id")).toBe("u-1");
  });

  it("marca la sesión como vencida cuando la API responde 401 con cuenta", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("{}", { status: 401 }),
    );

    const res = await accountFetch("/api/vocab/pull", undefined, accountScope);

    expect(res.status).toBe(401);
    expect(getSyncState().sessionExpired).toBe(true);
  });

  it("no marca la sesión en un 401 del espacio anónimo", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("{}", { status: 401 }),
    );

    await accountFetch("/api/positions", undefined, anonScope);
    expect(getSyncState().sessionExpired).toBe(false);
  });

  it("un 200 limpio no marca la sesión", async () => {
    await accountFetch("/api/vocab/pull", undefined, accountScope);
    expect(getSyncState().sessionExpired).toBe(false);
  });

  it("aborta con StaleScopeError antes de llamar a la red si el scope venció", async () => {
    const { isDbScopeActive } = await import("./idb");
    vi.mocked(isDbScopeActive).mockReturnValueOnce(false);

    await expect(
      accountFetch("/api/vocab/pull", undefined, accountScope),
    ).rejects.toBeInstanceOf(StaleScopeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
