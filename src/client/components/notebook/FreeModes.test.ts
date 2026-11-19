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
  it("en free solo Acepción, Contexto, Oración nueva y el Taller se apagan, con nota de Lecta+", () => {
    const { host, root } = render(true);
    const byName = (name: string) =>
      Array.from(host.querySelectorAll<HTMLButtonElement>(".nb-free-mode-card")).find((b) =>
        b.querySelector(".nb-free-mode-name")?.textContent === name,
      )!;
    for (const name of ["Hueco en el Libro", "Sílabas de Tinta", "Telar de Frases", "Parejas"])
      expect(byName(name).disabled).toBe(false);
    for (const name of ["Acepción", "Contexto", "Oración nueva", "Taller con el Gato IA"])
      expect(byName(name).disabled).toBe(true);
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
