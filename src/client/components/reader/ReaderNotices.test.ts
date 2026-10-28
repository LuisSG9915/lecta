// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderNotices, type ReaderNoticesProps } from "./ReaderNotices";

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
    expect(pill?.textContent).toContain("Notamos fatiga en la lectura");

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
});
