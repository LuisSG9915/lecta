import { beforeEach, describe, expect, it, vi } from "vitest";
import { courtesyBucketHour } from "../shared/plan";
import {
  consumeFreeAiCourtesy,
  readFreeAiRemaining,
  refundFreeAiCourtesy,
} from "./free-courtesy";

const withClientMock = vi.hoisted(() => vi.fn());
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  withClient: (...args: unknown[]) => withClientMock(...args),
}));

const NOW = Date.UTC(2026, 10, 17, 12);
const missingTable = Object.assign(new Error("no table"), { code: "42P01" });
const missingColumn = Object.assign(new Error("no col"), { code: "42703" });

function useQuery(impl: (sql: string, params: unknown[]) => unknown) {
  const query = vi.fn(async (sql: string, params: unknown[]) => impl(sql, params));
  withClientMock.mockImplementation(async (_env, run) => run({ query }));
  return query;
}

beforeEach(() => {
  withClientMock.mockReset();
});

describe("consumeFreeAiCourtesy", () => {
  it("hace el UPSERT atómico con scope free-courtesy, tope 3 y bucket diario", async () => {
    const query = useQuery(() => ({ rows: [{ units_used: 1 }] }));
    expect(await consumeFreeAiCourtesy({}, "u1", NOW)).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("units_used + EXCLUDED.units_used <= $6");
    // [userId, bucketHour, units, now, scope, limit]
    expect(params[0]).toBe("u1");
    expect(params[1]).toBe(courtesyBucketHour(NOW));
    expect(params[2]).toBe(1);
    expect(params[4]).toBe("free-courtesy");
    expect(params[5]).toBe(3);
  });

  it("RETURNING vacío = agotada", async () => {
    useQuery(() => ({ rows: [] }));
    expect(await consumeFreeAiCourtesy({}, "u1", NOW)).toBe(false);
  });

  it("sin base configurada falla cerrada", async () => {
    withClientMock.mockResolvedValue(undefined);
    expect(await consumeFreeAiCourtesy({}, "u1", NOW)).toBe(false);
  });

  it("tabla o columna ausente (42P01/42703) falla cerrada; otro error se propaga", async () => {
    useQuery(() => {
      throw missingTable;
    });
    expect(await consumeFreeAiCourtesy({}, "u1", NOW)).toBe(false);
    useQuery(() => {
      throw missingColumn;
    });
    expect(await consumeFreeAiCourtesy({}, "u1", NOW)).toBe(false);
    useQuery(() => {
      throw new Error("pg roto");
    });
    await expect(consumeFreeAiCourtesy({}, "u1", NOW)).rejects.toThrow("pg roto");
  });
});

describe("refundFreeAiCourtesy", () => {
  it("decrementa sin bajar de 0, en el mismo scope y bucket", async () => {
    const query = useQuery(() => ({ rows: [] }));
    await refundFreeAiCourtesy({}, "u1", NOW);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("GREATEST(units_used - 1, 0)");
    expect(params).toEqual(["u1", "free-courtesy", courtesyBucketHour(NOW), NOW]);
  });

  it("un fallo del reintegro no propaga", async () => {
    useQuery(() => {
      throw new Error("pg roto");
    });
    await expect(refundFreeAiCourtesy({}, "u1", NOW)).resolves.toBeUndefined();
  });
});

describe("readFreeAiRemaining", () => {
  const client = (impl: () => unknown) => ({ query: vi.fn(async () => impl()) });

  it("sin fila = 3; con uso resta; nunca negativo", async () => {
    expect(await readFreeAiRemaining(client(() => ({ rows: [] })), "u1", NOW)).toBe(3);
    expect(await readFreeAiRemaining(client(() => ({ rows: [{ units_used: "2" }] })), "u1", NOW)).toBe(1);
    expect(await readFreeAiRemaining(client(() => ({ rows: [{ units_used: 8 }] })), "u1", NOW)).toBe(0);
  });

  it("sin tabla/columna = 0 (cerrada); otro error se propaga", async () => {
    expect(
      await readFreeAiRemaining(client(() => { throw missingTable; }), "u1", NOW),
    ).toBe(0);
    expect(
      await readFreeAiRemaining(client(() => { throw missingColumn; }), "u1", NOW),
    ).toBe(0);
    await expect(
      readFreeAiRemaining(client(() => { throw new Error("x"); }), "u1", NOW),
    ).rejects.toThrow("x");
  });
});
