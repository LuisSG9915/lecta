// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CoatChoice, { needsCoatChoice } from "./CoatChoice";
import * as accountPlan from "../lib/account-plan";
import * as idb from "../lib/idb";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("needsCoatChoice", () => {
  it("solo free sin pelaje inicial ni pendiente", () => {
    expect(needsCoatChoice({ plan: "free", starterCoat: null, expiresAt: null })).toBe(true);
    expect(needsCoatChoice({ plan: "free", starterCoat: "mist", expiresAt: null })).toBe(false);
    expect(needsCoatChoice({ plan: "founder_lifetime", starterCoat: null, expiresAt: null })).toBe(false);
    expect(needsCoatChoice({ plan: "lecta_plus", starterCoat: null, expiresAt: null })).toBe(false);
    expect(needsCoatChoice(null)).toBe(false);
    localStorage.setItem("lecta:gato", "calico");
    expect(needsCoatChoice({ plan: "free", starterCoat: null, expiresAt: null })).toBe(false);
  });
});

describe("CoatChoice", () => {
  it("ofrece 5 pelajes y elegir uno lo reclama", async () => {
    vi.spyOn(idb, "getActiveUserId").mockReturnValue("u1");
    const claim = vi.spyOn(accountPlan, "claimStarterCoat").mockResolvedValue("mist");
    act(() => root.render(h(CoatChoice)));
    const buttons = host.querySelectorAll<HTMLButtonElement>(".coat-choice__option");
    expect(buttons.length).toBe(5);
    const mist = Array.from(buttons).find((b) => b.textContent?.includes("Gris Neblina"))!;
    await act(async () => mist.click());
    expect(claim).toHaveBeenCalledWith("u1", expect.anything(), "mist");
    expect(mist.getAttribute("aria-pressed")).toBe("true");
  });
});
