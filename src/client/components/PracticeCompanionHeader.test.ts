// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PracticeCompanionHeader } from "./PracticeCompanionHeader";
import * as CompanionProviderModule from "./CompanionProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const render = (node: ReactNode) => act(() => root.render(node));
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

describe("PracticeCompanionHeader", () => {
  it("renders nothing when companion is disabled", () => {
    vi.spyOn(CompanionProviderModule, "useCompanionSafe").mockReturnValue({
      enabled: false,
      state: null,
      name: "Michi",
      equipped: { body: null, neck: null, head: null, face: null, coat: null },
      accessories: [],
      mood: "awake",
      stage: 1,
      presence: "visits",
      modalOpen: false,
      reducedMotion: false,
      activeCare: null,
      open: false,
      openPanel: vi.fn(),
      closePanel: vi.fn(),
      setCelebrationBlocked: vi.fn(),
      care: vi.fn(),
    });

    render(
      h(PracticeCompanionHeader, {
        pose: "idle",
        speech: "¡Hola!",
        combo: 0,
        mode: "animated",
        onModeChange: vi.fn(),
      }),
    );

    expect(host.innerHTML).toBe("");
  });

  it("renders collapsed bar when mode is off and allows reopening", () => {
    vi.spyOn(CompanionProviderModule, "useCompanionSafe").mockReturnValue({
      enabled: true,
      state: {} as never,
      name: "Michi",
      equipped: { body: null, neck: null, head: null, face: null, coat: null },
      accessories: [],
      mood: "awake",
      stage: 1,
      presence: "visits",
      modalOpen: false,
      reducedMotion: false,
      activeCare: null,
      open: false,
      openPanel: vi.fn(),
      closePanel: vi.fn(),
      setCelebrationBlocked: vi.fn(),
      care: vi.fn(),
    });

    const onModeChange = vi.fn();
    render(
      h(PracticeCompanionHeader, {
        pose: "idle",
        speech: "¡Hola!",
        combo: 0,
        mode: "off",
        onModeChange,
      }),
    );

    const reopen = host.querySelector(".practice-cat-reopen");
    expect(reopen).not.toBeNull();
    if (reopen) click(reopen);
    expect(onModeChange).toHaveBeenCalledWith("animated");
  });

  it("renders avatar, speech, and combo badge when animated", () => {
    vi.spyOn(CompanionProviderModule, "useCompanionSafe").mockReturnValue({
      enabled: true,
      state: {} as never,
      name: "Michi",
      equipped: { body: null, neck: null, head: null, face: null, coat: null },
      accessories: [],
      mood: "awake",
      stage: 1,
      presence: "visits",
      modalOpen: false,
      reducedMotion: false,
      activeCare: null,
      open: false,
      openPanel: vi.fn(),
      closePanel: vi.fn(),
      setCelebrationBlocked: vi.fn(),
      care: vi.fn(),
    });

    const onModeChange = vi.fn();
    const onAskHint = vi.fn();

    render(
      h(PracticeCompanionHeader, {
        pose: "celebrate",
        speech: "¡Excelente!",
        combo: 3,
        mode: "animated",
        onModeChange,
        onAskHint,
      }),
    );

    expect(host.textContent).toContain("Michi");
    expect(host.textContent).toContain("¡Excelente!");
    expect(host.textContent).toContain("x3 racha");

    const hintBtn = host.querySelector(".practice-cat-hint-btn");
    expect(hintBtn).not.toBeNull();
    if (hintBtn) click(hintBtn);
    expect(onAskHint).toHaveBeenCalledTimes(1);

    const modeBtn = host.querySelector(".practice-cat-mode-btn");
    expect(modeBtn?.textContent).toBe("Animado");
    if (modeBtn) click(modeBtn);
    expect(onModeChange).toHaveBeenCalledWith("calm");
  });
});
