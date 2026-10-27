// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MidChapterRecallCard } from "./MidChapterRecallCard";
import type { EpisodicWordItem } from "../../lib/practice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item: EpisodicWordItem = {
  lemma: "quimera",
  surfaceForm: "quimera",
  lang: "es",
  shortGloss: "Ilusión o sueño",
  chapterSentence: "La quimera desapareció al amanecer.",
  chapterTitle: "Capítulo 2",
  source: "notebook-reencounter",
};

describe("MidChapterRecallCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("aparece como repaso antes de leer y «Saltar» no responde por la palabra", () => {
    const onSolve = vi.fn();
    const onSkip = vi.fn();
    act(() => {
      root.render(h(MidChapterRecallCard, { item, onSolve, onSkip }));
    });

    expect(host.querySelector("section[aria-label='Repaso antes de leer']")).toBeTruthy();
    const skip = [...host.querySelectorAll("button")].find((b) => b.textContent === "Saltar");
    expect(skip).toBeTruthy();

    act(() => {
      skip!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSolve).not.toHaveBeenCalled();
  });
});
