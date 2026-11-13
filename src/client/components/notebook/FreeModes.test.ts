// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { FreeModes } from "./FreeModes";
import type { PracticeMode } from "../../lib/notebook-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const counts = new Proxy({}, { get: () => 3 }) as Record<PracticeMode, number>;

const render = (locked: boolean) => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onStartPractice = vi.fn();
  act(() =>
    root.render(
      h(FreeModes, {
        eligibleCount: counts,
        reviewWordCount: 4,
        learnableCount: 0,
        practiceNote: "",
        onStartPractice,
        onToggleWorkshop: vi.fn(),
        locked,
      }),
    ),
  );
  return { host, root, onStartPractice };
};

describe("FreeModes y Lecta+", () => {
  it("en free los modos se ven apagados con la nota de Lecta+", () => {
    const { host, root } = render(true);
    const buttons = host.querySelectorAll<HTMLButtonElement>(".nb-free-mode-card");
    expect(buttons.length).toBeGreaterThan(0);
    expect(Array.from(buttons).every((b) => b.disabled)).toBe(true);
    expect(host.querySelector(".plan-note")?.textContent).toContain("Lecta+");
    act(() => root.unmount());
  });

  it("con Lecta+ los modos están disponibles y sin nota", () => {
    const { host, root } = render(false);
    const buttons = host.querySelectorAll<HTMLButtonElement>(".nb-free-mode-card");
    expect(Array.from(buttons).some((b) => !b.disabled)).toBe(true);
    expect(host.querySelector(".plan-note")).toBeNull();
    act(() => root.unmount());
  });
});
