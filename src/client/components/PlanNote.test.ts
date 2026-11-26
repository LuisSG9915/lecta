// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlanNote from "./PlanNote";
import { resetPlanEventsForTests } from "../lib/plan-events";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PlanNote", () => {
  beforeEach(() => resetPlanEventsForTests());

  it("pinta dos líneas y enlaza al Carné, sin modal", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(PlanNote, { feature: "kindle", title: "Es de Lecta+.", detail: "Lo tuyo sigue aquí." })));
    expect(host.querySelector(".plan-note")?.getAttribute("role")).toBe("note");
    expect(host.textContent).toContain("Es de Lecta+.");
    expect(host.textContent).toContain("Lo tuyo sigue aquí.");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/?carne=1");
    expect(host.querySelector("[role='dialog']")).toBeNull();
    act(() => root.unmount());
  });

  it("al pulsar «Ver Lecta+» emite lecta:open-carne sin navegar", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(h(PlanNote, { feature: "kindle", title: "t", detail: "d" })));
    const onOpen = vi.fn();
    window.addEventListener("lecta:open-carne", onOpen);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      host.querySelector("a")!.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    window.removeEventListener("lecta:open-carne", onOpen);
    act(() => root.unmount());
    host.remove();
  });

  it("emite plannote una vez al montar y paywall al pulsar", () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(PlanNote, { feature: "kindle", title: "t", detail: "d" })));
    act(() => root.render(h(PlanNote, { feature: "kindle", title: "t2", detail: "d" })));
    const events = () => beacon.mock.calls.map((c) => JSON.parse((c as unknown as [string, string])[1]).event);
    expect(events()).toEqual(["app:plannote:kindle"]);
    act(() => {
      host.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(events()).toEqual(["app:plannote:kindle", "app:paywall:kindle"]);
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });
});
