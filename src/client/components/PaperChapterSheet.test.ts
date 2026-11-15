// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PaperChapterSheet from "./PaperChapterSheet";
import { newPreparationRecord } from "../lib/preparation";
import type { PaperSheetState } from "../hooks/usePaperReading";
import type { ChapterTarget } from "../lib/chapters";
import type { ScreenPhraseItem } from "../lib/screen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const target: ChapterTarget = {
  id: "s01e02",
  label: "T1 · E2",
  href: "s01e02",
  sectionIndex: 0,
  depth: 0,
  kind: "chapter",
};

const sheetState = (over: Partial<PaperSheetState> = {}): PaperSheetState => ({
  target,
  range: { target, startSection: 0, endSection: 1 },
  record: newPreparationRecord({
    bookHash: "h1",
    targetId: "s01e02",
    updatedAt: 1,
  }),
  analysis: "ready",
  text: "",
  chapterForms: ["neo", "matrix"],
  main: [
    {
      key: "en:neo",
      form: "neo",
      reason: "rarity",
    },
    {
      key: "en:matrix",
      form: "matrix",
      reason: "rarity",
    },
  ],
  more: [],
  uncertain: [],
  answers: {},
  dirty: false,
  saving: false,
  finished: false,
  ...over,
});

const phrases: ScreenPhraseItem[] = [
  { key: "at stake", text: "at stake", meaning: "en juego / en riesgo" },
  { key: "bear in mind", text: "bear in mind", meaning: "tener en cuenta" },
];

type Props = Parameters<typeof PaperChapterSheet>[0];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = (props: Partial<Props> = {}) =>
  act(async () => {
    root.render(
      h(PaperChapterSheet, {
        sheet: sheetState(),
        read: false,
        language: "en",
        savedTerms: new Set<string>(),
        bookForms: [],
        bookWordCount: 0,
        manualSaves: [],
        onAnswer: vi.fn(),
        onRetry: vi.fn(),
        onClose: vi.fn(),
        onFinish: vi.fn(),
        onToggleRead: vi.fn(),
        onAddWord: vi.fn(async () => ({ kind: "error" as const, form: "x" })),
        onUndoWord: vi.fn(),
        ...props,
      }),
    );
  });

const buttons = (label: string) =>
  [...host.querySelectorAll("button")].filter((b) =>
    b.getAttribute("aria-label") === label ||
    b.textContent?.trim() === label,
  );

describe("PaperChapterSheet — adaptación audiovisual", () => {
  it("sin mediaKind no hay frases ni botones de audio", async () => {
    await render({ phrases, speechAvailable: true });
    expect(host.textContent).not.toContain("Frases que vas a oír");
    expect(buttons("Escuchar todas")).toHaveLength(0);
    expect(host.querySelector('[aria-label^="Escuchar"]')).toBeNull();
  });

  it("sin speech disponible las frases se ven pero no hay audio", async () => {
    await render({
      mediaKind: "tv",
      phrases,
      speechAvailable: false,
    });
    expect(host.textContent).toContain("Frases que vas a oír");
    expect(host.textContent).toContain("at stake");
    expect(host.textContent).toContain("en juego / en riesgo");
    expect(host.querySelector('[aria-label^="Escuchar"]')).toBeNull();
  });

  it("con mediaKind y voz: frases primero, «Escuchar» por frase y por fila", async () => {
    const speakWordFn = vi.fn(async () => undefined);
    await render({
      mediaKind: "tv",
      phrases,
      speechAvailable: true,
      speakWordFn,
    });
    // La sección de frases va antes de la lista de palabras.
    const html = host.innerHTML;
    expect(html.indexOf("Frases que vas a oír")).toBeLessThan(
      html.indexOf("Palabras que podrían costarte"),
    );
    // «Escuchar todas» + una por frase + una por cada fila principal.
    expect(buttons("Escuchar todas")).toHaveLength(1);
    const listenButtons = host.querySelectorAll(
      'button[aria-label^="Escuchar"]',
    );
    // 2 frases + 2 filas = 4 botones «Escuchar …»
    expect(listenButtons).toHaveLength(4);

    // Escuchar una frase pronuncia su patrón en el idioma del libro.
    const phraseBtn = [...listenButtons].find((b) =>
      b.getAttribute("aria-label") === "Escuchar «at stake»",
    ) as HTMLButtonElement;
    await act(async () => {
      phraseBtn.click();
    });
    expect(speakWordFn).toHaveBeenCalledWith("at stake", "en");

    // Escuchar una fila pronuncia la forma.
    const rowBtn = [...listenButtons].find((b) =>
      b.getAttribute("aria-label") === "Escuchar «neo»",
    ) as HTMLButtonElement;
    await act(async () => {
      rowBtn.click();
    });
    expect(speakWordFn).toHaveBeenCalledWith("neo", "en");
  });

  it("«Escuchar todas» encadena las filas y «Detener» corta", async () => {
    const threeRows = sheetState({
      main: [
        { key: "en:neo", form: "neo", reason: "rarity" },
        { key: "en:matrix", form: "matrix", reason: "rarity" },
        { key: "en:agent", form: "agent", reason: "rarity" },
      ],
    });
    const calls: string[] = [];
    let releaseSecond: (() => void) | null = null;
    const speakWordFn = vi.fn((word: string) => {
      calls.push(word);
      if (calls.length === 2)
        return new Promise<void>((resolve) => (releaseSecond = resolve));
      return Promise.resolve();
    });
    const stopSpeakFn = vi.fn();
    await render({
      sheet: threeRows,
      mediaKind: "movie",
      phrases: [],
      speechAvailable: true,
      speakWordFn,
      stopSpeakFn,
    });

    const all = buttons("Escuchar todas")[0]!;
    await act(async () => {
      all.click();
    });
    // «neo» y «matrix» ya se pidieron; la segunda quedó pendiente.
    expect(calls).toEqual(["neo", "matrix"]);
    expect(buttons("Detener")).toHaveLength(1);

    await act(async () => {
      buttons("Detener")[0]!.click();
      releaseSecond!();
    });
    expect(stopSpeakFn).toHaveBeenCalled();
    // Al soltar la palabra en curso el bucle se detuvo: «agent» nunca
    // llegó a pedirse.
    expect(calls).toEqual(["neo", "matrix"]);
  });
});
