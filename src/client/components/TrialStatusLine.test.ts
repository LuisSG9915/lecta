// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrialStatusLine from "./TrialStatusLine";
import { planStore, resetPlanStoreForTests } from "../lib/account-plan";
import * as idb from "../lib/idb";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.spyOn(idb, "getActiveUserId").mockReturnValue("u1");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetPlanStoreForTests();
  vi.restoreAllMocks();
});

const show = (plan: "free" | "lecta_plus" | "founder_lifetime", trialEndsAt?: number | null) => {
  planStore.set("u1", {
    plan,
    starterCoat: null,
    expiresAt: null,
    ...(trialEndsAt === undefined ? {} : { trialEndsAt }),
  });
  act(() => root.render(h(TrialStatusLine)));
};

describe("TrialStatusLine", () => {
  it("sale en prueba activa a más de 3 días y abre el Carné", () => {
    show("lecta_plus", Date.now() + 10 * DAY);
    expect(host.textContent).toContain("Estás probando Lecta+ hasta el");
    const open = vi.fn();
    window.addEventListener("lecta:open-carne", open);
    act(() => host.querySelector("button")!.click());
    expect(open).toHaveBeenCalledTimes(1);
    window.removeEventListener("lecta:open-carne", open);
  });
  it("no sale a 3 días o menos", () => {
    show("lecta_plus", Date.now() + 3 * DAY - 1000);
    expect(host.querySelector(".trial-status")).toBeNull();
  });
  it("no sale en free, founder ni plus de pago", () => {
    show("free", Date.now() + 10 * DAY);
    expect(host.querySelector(".trial-status")).toBeNull();
    show("founder_lifetime", null);
    expect(host.querySelector(".trial-status")).toBeNull();
    show("lecta_plus", null);
    expect(host.querySelector(".trial-status")).toBeNull();
  });
  it("no sale sin trialEndsAt", () => {
    show("lecta_plus");
    expect(host.querySelector(".trial-status")).toBeNull();
  });
});
