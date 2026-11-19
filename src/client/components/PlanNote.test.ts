// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import PlanNote from "./PlanNote";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PlanNote", () => {
  it("pinta dos líneas y enlaza al Carné, sin modal", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(PlanNote, { title: "Es de Lecta+.", detail: "Lo tuyo sigue aquí." })));
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
    act(() => root.render(h(PlanNote, { title: "t", detail: "d" })));
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
});
