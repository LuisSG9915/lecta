// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrialWarningNote from "./TrialWarningNote";
import { planStore, resetPlanStoreForTests } from "../lib/account-plan";
import { resetPlanEventsForTests } from "../lib/plan-events";
import * as idb from "../lib/idb";
import * as accountFetchModule from "../lib/account-fetch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.spyOn(idb, "getActiveUserId").mockReturnValue("u1");
  vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(new Response("{}", { status: 500 }));
  resetPlanEventsForTests();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  planStore.set("u1", {
    plan: "lecta_plus",
    starterCoat: null,
    expiresAt: null,
    trialEndsAt: Date.now() + 2 * DAY - 1000,
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetPlanStoreForTests();
  localStorage.clear();
  vi.restoreAllMocks();
});

const render = (props: Parameters<typeof TrialWarningNote>[0]) => act(() => root.render(h(TrialWarningNote, props)));

describe("TrialWarningNote en el lector", () => {
  it("libro retomado en el capítulo 5: no sale al abrir ni al restaurar", () => {
    render({ armAt: 0, ready: false });
    render({ armAt: 5, ready: true });
    expect(host.querySelector(".trial-note")).toBeNull();
  });

  it("sale tras un cambio real de capítulo", () => {
    render({ armAt: 5, ready: true });
    render({ armAt: 6, ready: true });
    expect(host.querySelector(".trial-note")?.textContent).toContain("estarás en Gratis: 3 explicaciones con IA al día");
  });

  it("no sale con otro aviso visible", () => {
    render({ armAt: 5, ready: true });
    render({ armAt: 6, ready: true, suppressed: true });
    expect(host.querySelector(".trial-note")).toBeNull();
  });

  it("descarte por cuenta: otra cuenta lo vuelve a ver", () => {
    render({});
    act(() => host.querySelector<HTMLButtonElement>(".trial-note__close")!.click());
    expect(host.querySelector(".trial-note")).toBeNull();
    expect(localStorage.getItem("lecta:trial-warning:u1:2")).not.toBeNull();
    vi.spyOn(idb, "getActiveUserId").mockReturnValue("u2");
    act(() => root.unmount());
    root = createRoot(host);
    planStore.set("u2", { plan: "lecta_plus", starterCoat: null, expiresAt: null, trialEndsAt: Date.now() + 2 * DAY - 1000 });
    render({});
    expect(host.querySelector(".trial-note")).not.toBeNull();
  });

  it("el botón registra el clic y abre el Carné", () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const onOpen = vi.fn();
    window.addEventListener("lecta:open-carne", onOpen);
    render({});
    act(() => host.querySelector<HTMLButtonElement>(".trial-note__cta")!.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls.some((c) => String((c as unknown[])[1]).includes("app:paywall"))).toBe(true);
    window.removeEventListener("lecta:open-carne", onOpen);
  });
});
