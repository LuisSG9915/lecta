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

  it("permite tocar al gato directamente para solicitar pista y muestra la barra de progreso del reto", () => {
    vi.spyOn(CompanionProviderModule, "useCompanionSafe").mockReturnValue({
      enabled: true,
      state: {} as never,
      name: "Gato Literario",
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

    const onAskHint = vi.fn();
    render(
      h(PracticeCompanionHeader, {
        pose: "idle",
        speech: "¡Vamos a jugar!",
        instruction: "Toca las sílabas en orden para completar la palabra",
        combo: 0,
        mode: "animated",
        onModeChange: vi.fn(),
        onAskHint,
        progress: { current: 3, total: 5 },
      }),
    );

    // Barra de progreso de sesión
    expect(host.textContent).toContain("Reto 3 de 5");
    const progressFill = host.querySelector(".practice-progress-fill") as HTMLElement;
    expect(progressFill).not.toBeNull();
    expect(progressFill.style.inlineSize).toBe("60%");

    // Instrucción humana en la burbuja
    expect(host.textContent).toContain("Toca las sílabas en orden para completar la palabra");

    // Al tocar al gato en su avatar, dispara la petición de pista
    const catAvatar = host.querySelector(".practice-cat-avatar");
    expect(catAvatar).not.toBeNull();
    if (catAvatar) click(catAvatar);
    expect(onAskHint).toHaveBeenCalledTimes(1);
  });

  it("muestra mensaje literario cálido y dinámico según el progreso y píldora de libro de origen", () => {
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

    render(
      h(PracticeCompanionHeader, {
        pose: "idle",
        speech: "¡Vamos a repasar!",
        combo: 0,
        mode: "animated",
        onModeChange: vi.fn(),
        progress: { current: 1, total: 4 },
        bookTitle: "Cien años de soledad",
      }),
    );

    // Debe mostrar el mensaje dinámico cálido
    expect(host.textContent).toContain("Cada palabra que recuerdas hace tu próxima página más fluida");
    // Debe mostrar la píldora de eco literario
    expect(host.textContent).toContain("📖 Eco de: Cien años de soledad");
  });
});

