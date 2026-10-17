import { describe, expect, it, vi } from "vitest";
import {
  deterministicPageRecapFallback,
  requestPageRecap,
  requestLastPagesRecap,
} from "./page-recap";
import * as accountFetchModule from "./account-fetch";

describe("page-recap", () => {
  it("generates deterministic fallback from text sentences", () => {
    const text =
      "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo. Tenía en su casa una ama que pasaba de los cuarenta y una sobrina que no llegaba a los veinte.";
    const result = deterministicPageRecapFallback(text);
    expect(result.bullets).toHaveLength(2);
    expect(result.hookQuestion).toBe("¿Cómo continúa el hilo de este pasaje?");
    expect(result.fallback).toBe(true);
  });

  it("handles short/empty text in deterministic fallback", () => {
    const result = deterministicPageRecapFallback("");
    expect(result.bullets).toHaveLength(2);
    expect(result.bullets[0]).toContain("La lectura transcurre");
  });

  it("calls /api/ai/page-recap and returns structured response", async () => {
    vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        bullets: ["Don Quijote decide partir.", "Ensilla a Rocinante."],
        hookQuestion: "¿A quién buscará como escudero?",
      }),
    } as unknown as Response);

    const res = await requestPageRecap({
      text: "Texto de la página.",
      bookTitle: "Don Quijote",
      chapterTitle: "Capítulo I",
    });

    expect(res.bullets).toEqual([
      "Don Quijote decide partir.",
      "Ensilla a Rocinante.",
    ]);
    expect(res.hookQuestion).toBe("¿A quién buscará como escudero?");
  });

  it("falls back gracefully when API returns error", async () => {
    vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "AI gateway timeout" }),
    } as unknown as Response);

    const res = await requestPageRecap({
      text: "Una oración lo suficientemente larga para generar una viñeta clara. Otra oración que complementa el pasaje.",
    });

    expect(res.fallback).toBe(true);
    expect(res.bullets.length).toBeGreaterThanOrEqual(1);
    expect(res.hookQuestion).toBe("¿Cómo continúa el hilo de este pasaje?");
  });

  it("requestLastPagesRecap strictly limits analysis to the last 3 pages", async () => {
    let capturedBody = "";
    vi.spyOn(accountFetchModule, "accountFetch").mockImplementationOnce(async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return {
        ok: true,
        json: async () => ({
          bullets: ["Punto 1", "Punto 2", "Punto 3"],
          hookQuestion: "¿Qué pasará ahora?",
        }),
      } as unknown as Response;
    });

    const pages = [
      "Página 1: muy antigua que no debe incluirse.",
      "Página 2: también antigua que debe quedar excluida.",
      "Página 3: la antepenúltima página leída.",
      "Página 4: la penúltima página leída.",
      "Página 5: la última página leída.",
    ];

    const res = await requestLastPagesRecap({
      lastPagesText: pages,
      bookTitle: "Libro Mágico",
    });

    expect(capturedBody).toContain("Página 3");
    expect(capturedBody).toContain("Página 4");
    expect(capturedBody).toContain("Página 5");
    expect(capturedBody).not.toContain("Página 1");
    expect(capturedBody).not.toContain("Página 2");
    expect(res.bullets).toHaveLength(3);
  });
});

