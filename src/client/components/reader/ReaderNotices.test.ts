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
