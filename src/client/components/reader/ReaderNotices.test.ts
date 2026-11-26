// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as accountPlan from "../../lib/account-plan";
import { ReaderNotices, type ReaderNoticesProps } from "./ReaderNotices";
import {
  isFocusSuggestionMuted,
  loadFocusTelemetryProfile,
} from "../../lib/focus-telemetry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const propsWithKeyWords = (keyWords: number): ReaderNoticesProps => ({
  resumeCard: null,
  rereadChapter: vi.fn(),
  setResumeCard: vi.fn(),
  previewSuggested: true,
  setPreviewSuggested: vi.fn(),
  showPreview: false,
  setShowPreview: vi.fn(),
  chapterAnalysis: { unknownKeyWords: Array.from({ length: keyWords }, () => ({})) },
  openPrepManual: vi.fn(),
  bookHash: "libro-1",
  sectionIndex: 0,
  dismissPrepNotice: vi.fn(),
  calNotice: false,
  prep: null,
  prepNotice: null,
  isDeepReading: false,
  acceptCalibrationNotice: vi.fn(),
  dismissCalibrationNotice: vi.fn(),
  helpNotice: false,
  helpIsCalibrated: false,
  acceptHelpNotice: vi.fn(),
  calibrateHelpNotice: vi.fn(),
  declineHelpNotice: vi.fn(),
  dismissHelpNotice: vi.fn(),
  fatigueNotice: false,
  setFatigueNotice: vi.fn(),
});

describe("ReaderNotices: aviso de capítulo rico en vocabulario", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const pillText = (keyWords: number) => {
    act(() => {
      root.render(h(ReaderNotices, propsWithKeyWords(keyWords)));
    });
    return container.querySelector(".reader-chapter-prep-pill")?.textContent ?? "";
  };

  it("avisa que el capítulo es rico desde 12 palabras clave", () => {
    expect(pillText(12)).toContain(
      "Capítulo rico en vocabulario · 12 palabras clave en este capítulo",
    );
  });

  it("no avisa con 11 palabras clave", () => {
    const text = pillText(11);
    expect(text).toContain("11 palabras clave en este capítulo");
    expect(text).not.toContain("Capítulo rico");
  });
});


describe("ReaderNotices: palabras previstas en plan free (Lecta+)", () => {
  it("muestra la nota de Lecta+ y se cierra sin bloquear la lectura", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const dismiss = vi.fn();
    act(() => {
      root.render(
        h(ReaderNotices, {
          ...propsWithKeyWords(0),
          previewSuggested: false,
          prepPlanNote: true,
          dismissPrepPlanNote: dismiss,
        }),
      );
    });
    expect(container.querySelector(".plan-note")?.textContent).toContain(
      "La lista completa de palabras previstas es de Lecta+.",
    );
    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='Cerrar aviso']")!.click();
    });
    expect(dismiss).toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });
});

describe("ReaderNotices: píldora de transición ante fatiga (Fase 3)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("muestra la píldora suave con los 2 caminos de 1 toque ante fatiga", () => {
    const onActivateFocusRule = vi.fn();
    const onStartAudio5Min = vi.fn();
    const setFatigueNotice = vi.fn();

    act(() => {
      root.render(
        h(ReaderNotices, {
          ...propsWithKeyWords(0),
          fatigueNotice: true,
          onActivateFocusRule,
          onStartAudio5Min,
          setFatigueNotice,
        }),
      );
    });

    const pill = container.querySelector(".reader-fatigue-action-pill");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain("Volviste atrás varias veces");
    expect(pill?.textContent).not.toMatch(/fatiga|cansad/i);

    const focusBtn = container.querySelector(".reader-fatigue-btn-focus") as HTMLButtonElement;
    expect(focusBtn).not.toBeNull();
    expect(focusBtn.textContent).toContain("Activar Regla de Foco");

    const audioBtn = container.querySelector(".reader-fatigue-btn-audio") as HTMLButtonElement;
    expect(audioBtn).not.toBeNull();
    expect(audioBtn.textContent).toContain("Escuchar los próximos 5 min 🎧");

    act(() => {
      focusBtn.click();
    });
    expect(onActivateFocusRule).toHaveBeenCalled();
    expect(setFatigueNotice).toHaveBeenCalledWith(false);

    act(() => {
      audioBtn.click();
    });
    expect(onStartAudio5Min).toHaveBeenCalled();
    expect(setFatigueNotice).toHaveBeenCalledWith(false);
  });

  it("«No volver a mostrar» apaga las sugerencias de foco y cierra", () => {
    localStorage.clear();
    const setFatigueNotice = vi.fn();
    act(() => {
      root.render(
        h(ReaderNotices, {
          ...propsWithKeyWords(0),
          fatigueNotice: true,
          setFatigueNotice,
        }),
      );
    });
    const muteBtn = container.querySelector(".reader-fatigue-btn-mute") as HTMLButtonElement;
    expect(muteBtn.textContent).toBe("No volver a mostrar");
    act(() => {
      muteBtn.click();
    });
    expect(setFatigueNotice).toHaveBeenCalledWith(false);
    expect(isFocusSuggestionMuted(loadFocusTelemetryProfile())).toBe(true);
  });
});

describe("ReaderNotices: franja de ayuda de vocabulario al abrir libro nuevo", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderStrip = (over: Partial<ReaderNoticesProps> = {}) => {
    act(() => {
      root.render(
        h(ReaderNotices, {
          ...propsWithKeyWords(0),
          previewSuggested: false,
          chapterAnalysis: null,
          helpNotice: true,
          ...over,
        }),
      );
    });
    return container.querySelector(".reader-help-strip");
  };

  it("sin calibrar ofrece medir el nivel en 15 s y activar ayudas", () => {
    const strip = renderStrip({ helpIsCalibrated: false });
    expect(strip).not.toBeNull();
    expect(strip?.textContent).toContain(
      "¿Te preparo las palabras clave antes de cada capítulo?",
    );
    const texts = [...(strip?.querySelectorAll("button") ?? [])].map((b) =>
      b.textContent?.trim(),
    );
    expect(texts).toContain("Medir mi nivel en 15 s");
    expect(texts).toContain("Activar ayudas");
    expect(texts).toContain("No, gracias");
  });

  it("calibrado explica la ayuda y ofrece una sola acción afirmativa", () => {
    const strip = renderStrip({ helpIsCalibrated: true });
    expect(strip?.textContent).toContain("ajustadas a tu nivel");
    const texts = [...(strip?.querySelectorAll("button") ?? [])].map((b) =>
      b.textContent?.trim(),
    );
    expect(texts).toContain("Sí, prepárame");
    expect(texts).not.toContain("Medir mi nivel en 15 s");
  });

  it("cada salida llama su callback: aceptar, medir, declinar y descartar", () => {
    const acceptHelpNotice = vi.fn();
    const calibrateHelpNotice = vi.fn();
    const declineHelpNotice = vi.fn();
    const dismissHelpNotice = vi.fn();
    const strip = renderStrip({
      helpIsCalibrated: false,
      acceptHelpNotice,
      calibrateHelpNotice,
      declineHelpNotice,
      dismissHelpNotice,
    })!;

    const byText = (t: string) =>
      [...strip!.querySelectorAll("button")].find((b) =>
        b.textContent?.trim().includes(t),
      )!;

    act(() => byText("Medir mi nivel en 15 s").click());
    expect(calibrateHelpNotice).toHaveBeenCalledTimes(1);
    act(() => byText("Activar ayudas").click());
    expect(acceptHelpNotice).toHaveBeenCalledTimes(1);
    act(() => byText("No, gracias").click());
    expect(declineHelpNotice).toHaveBeenCalledTimes(1);
    act(() => strip!.querySelector(".reader-return-dismiss")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    ));
    expect(dismissHelpNotice).toHaveBeenCalledTimes(1);
  });

  it("cede a los avisos de mayor prioridad (retomar, preparación, calibración)", () => {
    const strip = renderStrip({
      helpIsCalibrated: false,
      calNotice: true,
    });
    expect(strip).toBeNull();
  });
});

describe("ReaderNotices: aviso del fin de la prueba", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(accountPlan.planStore, "get").mockReturnValue({
      plan: "lecta_plus",
      starterCoat: null,
      expiresAt: null,
      trialEndsAt: Date.now() + 36 * 3_600_000,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const render = (sectionIndex: number, extra: Record<string, unknown> = {}) =>
    act(() =>
      root.render(
        h(ReaderNotices, {
          ...propsWithKeyWords(0),
          previewSuggested: false,
          chapterAnalysis: null,
          ready: true,
          sectionIndex,
          ...extra,
        }),
      ),
    );

  it("libro retomado en el capítulo 5 (0 al montar, 5 al restaurar): no sale", () => {
    render(0, { ready: false });
    render(5);
    expect(container.querySelector(".trial-note")).toBeNull();
  });

  it("con la tarjeta de retomar a la vista no sale aunque cambie de capítulo", () => {
    render(2);
    render(3, { resumeCard: { label: "Cap. 3", lastReadText: "ayer", daysSince: 1, savedInRange: 0, rereadTo: null } });
    expect(container.querySelector(".trial-note")).toBeNull();
  });

  it("no aparece al abrir el libro; sí al cambiar de sección y se oculta al descartarlo", () => {
    render(2);
    expect(container.querySelector(".trial-note")).toBeNull();
    render(3);
    expect(container.querySelector(".trial-note")?.textContent).toContain("Seguir con Lecta+");
    act(() => (container.querySelector(".trial-note__close") as HTMLButtonElement).click());
    expect(container.querySelector(".trial-note")).toBeNull();
    expect(localStorage.getItem("lecta:trial-warning:anon:2")).not.toBeNull();
  });

  it("sin trialEndsAt no pinta nada", () => {
    vi.spyOn(accountPlan.planStore, "get").mockReturnValue({ plan: "free", starterCoat: null, expiresAt: null });
    render(2);
    render(3);
    expect(container.querySelector(".trial-note")).toBeNull();
  });
});
