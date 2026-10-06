// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { batchLookup, fetchItems, reportSense, BATCH_LOOKUP_LIMIT } from "./lexicon";

afterEach(() => {
  vi.unstubAllGlobals();
});

const mockFetch = (impl: (forms: string[]) => unknown) =>
  vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const forms = JSON.parse(init?.body ?? "{}").forms ?? [];
    return new Response(JSON.stringify(impl(forms)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

describe("batchLookup", () => {
  it("lista vacía devuelve éxito sin petición", async () => {
    const spy = mockFetch(() => ({ entries: {} }));
    vi.stubGlobal("fetch", spy);
    const result = await batchLookup([]);
    expect(result).toEqual({ ok: true, entries: {} });
    expect(spy).not.toHaveBeenCalled();
  });

  it("formas duplicadas se envían una sola vez", async () => {
    const bodies: string[][] = [];
    const spy = mockFetch((forms) => {
      bodies.push(forms);
      return { entries: {} };
    });
    vi.stubGlobal("fetch", spy);
    await batchLookup(["casa", "casa", "perro"]);
    expect(bodies[0]).toEqual(["casa", "perro"]);
  });

  it(`hasta ${BATCH_LOOKUP_LIMIT} formas van en un lote`, async () => {
    const spy = mockFetch(() => ({ entries: {} }));
    vi.stubGlobal("fetch", spy);
    await batchLookup(Array.from({ length: BATCH_LOOKUP_LIMIT }, (_, i) => `f${i}`));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it(`${BATCH_LOOKUP_LIMIT + 1} formas se reparten en dos lotes`, async () => {
    const sizes: number[] = [];
    const spy = mockFetch((forms) => {
      sizes.push(forms.length);
      return { entries: Object.fromEntries(forms.map((f) => [f, []])) };
    });
    vi.stubGlobal("fetch", spy);
    const forms = Array.from({ length: BATCH_LOOKUP_LIMIT + 1 }, (_, i) => `f${i}`);
    const result = await batchLookup(forms);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(sizes).toEqual([BATCH_LOOKUP_LIMIT, 1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.entries)).toHaveLength(BATCH_LOOKUP_LIMIT + 1);
  });

  it("un lote fallido invalida el análisis completo", async () => {
    let call = 0;
    const spy = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      call += 1;
      if (call === 2)
        return new Response(JSON.stringify({ error: "lote caído" }), { status: 500 });
      const forms = JSON.parse(init?.body ?? "{}").forms ?? [];
      return new Response(
        JSON.stringify({ entries: Object.fromEntries(forms.map((f: string) => [f, []])) }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", spy);
    const forms = Array.from({ length: BATCH_LOOKUP_LIMIT + 5 }, (_, i) => `f${i}`);
    const result = await batchLookup(forms);
    expect(result.ok).toBe(false);
    // Las formas servidas por el primer lote no se clasifican a medias.
    expect(result.entries).toEqual({});
  });

  it("sin conexión devuelve fallo explícito", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    const result = await batchLookup(["casa"]);
    expect(result).toEqual({
      ok: false,
      error: "Sin conexión con el catálogo.",
      entries: {},
    });
  });
});

describe("referencias de acepción", () => {
  // entryId es int8 > 2^53: debe llegar al servidor como string de
  // dígitos intacto, nunca truncado por un Number intermedio.
  it("reportSense envía el entryId como string de dígitos", async () => {
    const spy = vi.fn<(url: unknown, init?: { body?: string }) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);
    const result = await reportSense("1234567890123456789", 2);
    expect(result.ok).toBe(true);
    const body = JSON.parse(String(spy.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ entryId: "1234567890123456789", senseOrder: 2 });
  });

  it("fetchItems conserva el entryId string en los refs", async () => {
    const spy = vi.fn<(url: unknown, init?: { body?: string }) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", spy);
    await fetchItems([{ entryId: "1234567890123456789", senseOrder: 3 }]);
    const body = JSON.parse(String(spy.mock.calls[0]?.[1]?.body));
    expect(body.refs).toEqual([{ entryId: "1234567890123456789", senseOrder: 3 }]);
  });
});
