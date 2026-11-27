// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrialEndSheet, { trialFigures } from "./TrialEndSheet";
import * as accountFetchModule from "../lib/account-fetch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("trialFigures", () => {
  it("omite las cifras en 0", () => {
    expect(trialFigures({ aiUses: 0, wordsSaved: 4, cloudBooks: 0, kindleLinked: false })).toEqual(["Guardaste 4 palabras."]);
    expect(trialFigures({ aiUses: 0, wordsSaved: 0, cloudBooks: 0, kindleLinked: false })).toEqual([]);
    expect(trialFigures(null)).toEqual([]);
  });
  it("singulares y todas las cifras", () => {
    expect(trialFigures({ aiUses: 1, wordsSaved: 1, cloudBooks: 1, kindleLinked: true })).toEqual([
      "Usaste la IA 1 vez.",
      "Guardaste 1 palabra.",
      "1 libro vive en la nube.",
      "Vinculaste tu Kindle.",
    ]);
  });
});

describe("TrialEndSheet", () => {
  beforeEach(() => {
    vi.spyOn(accountFetchModule, "accountFetch").mockImplementation(async (path: string) =>
      path.includes("trial-summary")
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify({ url: "https://stripe.test/c" }), { status: 200 }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("sin cifras: título de fin de prueba, texto de Gratis y dos precios", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(h(TrialEndSheet, { endedAt: Date.UTC(2026, 11, 9, 12) })));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Terminó tu prueba de Lecta+");
    expect(text).not.toContain("Así usaste");
    expect(text).toContain("estás en Gratis: 3 explicaciones con IA al día");
    expect(text).toContain("Anual · $499 MXN al año (≈$42 MXN al mes)");
    expect(text).toContain("Mensual · $59 MXN al mes");
    expect(text).toContain("Seguir gratis");
    expect(document.activeElement?.tagName).toBe("H2");
    await act(async () => root.unmount());
  });

  it("elegir mensual manda period monthly", async () => {
    const navigate = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(h(TrialEndSheet, { navigate })));
    const monthly = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      b.textContent?.startsWith("Mensual"),
    )!;
    await act(async () => monthly.click());
    const call = (accountFetchModule.accountFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(
      (c) => c[0].includes("checkout"),
    )!;
    expect(JSON.parse(String(call[1].body))).toEqual({ period: "monthly" });
    expect(navigate).toHaveBeenCalledWith("https://stripe.test/c");
    await act(async () => root.unmount());
  });

  it("con oferta de bienvenida vigente muestra $399 MXN y la fecha límite real", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const deadline = Date.now() + 48 * 3_600_000;
    await act(async () =>
      root.render(
        h(TrialEndSheet, {
          endedAt: Date.now() - 24 * 3_600_000,
          welcomeOfferEndsAt: deadline,
        }),
      ),
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Anual · $399 MXN el primer año (≈$33 MXN al mes)");
    expect(text).toContain("Oferta de bienvenida por 72 h");
    expect(text).toContain("después $499 MXN al año");
    await act(async () => root.unmount());
  });
});
