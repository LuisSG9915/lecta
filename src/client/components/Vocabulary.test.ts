// @vitest-environment jsdom
import { act, createElement, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import Vocabulary from "./Vocabulary";
import {
  fillSavedWordMeaning,
  listAnnotations,
  listKnowledge,
  listSavedWords,
  updateAnnotation,
  putSavedWord,
  saveKnowledge,
  updateSavedWord,
  type SavedWord,
} from "../lib/idb";
import { enrichWord, explainInContext } from "../lib/lexicon";
import { recordReview } from "../lib/reviews";
import { backfillWordMeanings } from "../lib/word-meanings";
import { loadUseAi } from "../lib/ai-pref";
import { loadSessionValue, saveSessionValue } from "../lib/idb";
import { LEARN_EXPOSURE_KEY } from "../lib/learn";
import { pushKnowledgeToServer } from "../lib/reading-sync";
import { pushWordsToServer } from "../lib/vocab";
import { RETENTION_HORIZON_KEY, setActiveRetentionHorizon } from "../lib/fsrs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...mod,
    listSavedWords: vi.fn(async () => []),
    listKnowledge: vi.fn(async () => []),
    listAnnotations: vi.fn(async () => []),
    updateAnnotation: vi.fn(async (a: Record<string, unknown>) => a),
    loadSessionValue: vi.fn(async () => null),
    saveSessionValue: vi.fn(async () => undefined),
    saveKnowledge: vi.fn(async (row: Record<string, unknown>) => ({
      key: `${row.language}:${row.lemma}`,
      updatedAt: 1,
      ...row,
    })),
    getActiveUserId: vi.fn(() => "u-test"),
    updateSavedWord: vi.fn(async (word: SavedWord) => word),
    fillSavedWordMeaning: vi.fn(async () => null),
    removeSavedWord: vi.fn(async () => undefined),
    putSavedWord: vi.fn(async (word: SavedWord) => word),
  };
});
vi.mock("../lib/lexicon", () => ({
  batchLookup: vi.fn(async () => ({ ok: true, entries: {} })),
  lookupWord: vi.fn(async () => ({ ok: true, found: false, entries: [] })),
  enrichWord: vi.fn(async () => ({ ok: true, found: true, entries: [] })),
  fetchItems: vi.fn(async () => ({ ok: true, items: [] })),
  answerItem: vi.fn(async () => true),
  verifySentence: vi.fn(async () => ({ ok: true, correct: true, feedback: "" })),
  explainInContext: vi.fn(async () => ({ ok: true, explanation: "una pista" })),
}));
vi.mock("../lib/reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/reviews")>()),
  recordReview: vi.fn(async () => undefined),
}));
const scrambleProps = vi.hoisted(() => ({
  current: null as { onWrong?: () => void; onSolve?: () => void } | null,
}));
vi.mock("./WordScrambleGame", () => ({
  WordScrambleGame: (props: { onWrong?: () => void; onSolve?: () => void }) => {
    scrambleProps.current = props;
    return null;
  },
}));
vi.mock("../lib/word-meanings", () => ({
  backfillWordMeanings: vi.fn(async (words: SavedWord[]) => words),
  planMeaningBackfill: vi.fn(() => null),
}));
vi.mock("../lib/ai-pref", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ai-pref")>()),
  loadUseAi: vi.fn(async () => true),
}));
vi.mock("../lib/reading-sync", () => ({
  pushKnowledgeToServer: vi.fn(async () => true),
}));
vi.mock("../lib/vocab", () => ({
  pushWordsToServer: vi.fn(async () => true),
  removeWord: vi.fn(async () => true),
}));
const gamePanelProps = vi.hoisted(() => ({
  current: null as { onChallengeComplete?: (key: string, score: number) => void } | null,
}));
vi.mock("./GamePanel", () => ({
  GamePanel: (props: { onChallengeComplete?: (key: string, score: number) => void }) => {
    gamePanelProps.current = props;
    return null;
  },
}));
vi.mock("./ReadingActivity", () => ({ default: () => null }));
// Compañero controlable: sin proveedor es null (compañero apagado).
const companionMock = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("./CompanionProvider", () => ({
  useCompanionSafe: () => companionMock.current,
}));
vi.mock("./Companion", () => ({
  Companion: () => createElement("span", { className: "fake-cat" }),
}));
// El encabezado real no pinta nada sin compañero; aquí solo importa el
// contrato: «💡 Pista» se ofrece si llega onAskHint y el reto aún no la usó,
// y el avatar llama a onCatTap. El texto de la pista lo pinta la tarjeta.
vi.mock("./PracticeCompanionHeader", () => ({
  PracticeCompanionHeader: (props: {
    onAskHint?: () => void;
    onCatTap?: () => void;
    hintBusy?: boolean;
    hintUsed?: boolean;
    combo?: number;
    pose?: string;
    speech?: string;
  }) =>
    createElement(
      "div",
      {
        "data-testid": "cat-state",
        "data-combo": props.combo,
        "data-pose": props.pose,
        "data-speech": props.speech,
      },
      props.onAskHint && !props.hintUsed
        ? createElement(
            "button",
            { type: "button", disabled: props.hintBusy, onClick: props.onAskHint },
            props.hintBusy ? "Pensando…" : "💡 Pista",
          )
        : null,
      props.onCatTap
        ? createElement(
            "button",
            { type: "button", "data-testid": "cat-tap", onClick: props.onCatTap },
            "gato",
          )
        : null,
    ),
}));

const listWordsMock = vi.mocked(listSavedWords);
const saveKnowledgeMock = vi.mocked(saveKnowledge);
const updateWordMock = vi.mocked(updateSavedWord);
const fillMock = vi.mocked(fillSavedWordMeaning);
const enrichMock = vi.mocked(enrichWord);
const useAiMock = vi.mocked(loadUseAi);
const saveSessionMock = vi.mocked(saveSessionValue);
const backfillMock = vi.mocked(backfillWordMeanings);
const explainMock = vi.mocked(explainInContext);
const recordReviewMock = vi.mocked(recordReview);
const loadSessionMock = vi.mocked(loadSessionValue);

const word = (over: Partial<SavedWord> = {}): SavedWord => {
  const form = over.form ?? "casa";
  return {
    key: `es:${form}`,
    language: "es",
    form,
    lemma: over.lemma ?? form,
    savedAt: 1,
    updatedAt: 1,
    ...over,
  };
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  companionMock.current = null;
  listWordsMock.mockResolvedValue([]);
  loadSessionMock.mockResolvedValue(null);
  backfillMock.mockImplementation(async (words: SavedWord[]) => words);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const render = () =>
  act(async () => {
    root.render(h(Vocabulary, { onClose: vi.fn(), books: [] }));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
const text = () => host.textContent ?? "";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label);
const click = (label: string) =>
  act(async () => {
    button(label)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });

describe("Aprender", () => {
  it("el botón principal abre la ficha guiada cuando hay palabras por aprender", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    expect(text()).toContain("1 por aprender");
    await click("Aprender 1 palabra nueva");
    expect(text()).toContain("qué crees que significa");
    expect(text()).toContain("casa");
    expect(button("Mostrar significado")).toBeTruthy();
    expect(text()).not.toContain("hogar");
  });

  it("sin palabras pendientes el botón no ofrece aprender", async () => {
    listWordsMock.mockResolvedValue([]);
    await render();
    expect(text()).not.toContain("Por aprender");
    expect(text()).toContain("Abrir un libro para guardar palabras");
  });

  it("«Ya la conozco» escribe evidencia declarada y la saca de la cola", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    await click("Aprender 1 palabra nueva");
    await click("Mostrar significado");
    await click("Ya la conozco");
    expect(saveKnowledgeMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ known: true, source: "declared", lemma: "casa" }),
    );
    expect(pushKnowledgeToServer).toHaveBeenCalled();
    expect(saveSessionMock).toHaveBeenCalled();
    expect(text()).toContain("Aprender terminado");
    // La palabra conocida ya no cuenta como pendiente.
    await click("Ver el cuaderno");
    expect(text()).toContain("1 guardadas · 0 para repasar");
  });

  it("«Quiero aprenderla» crea la card que la trae al repaso hoy", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    await click("Aprender 1 palabra nueva");
    await click("Mostrar significado");
    await click("Quiero aprenderla");
    expect(updateWordMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        key: "es:casa",
        card: expect.anything(),
        presentedAt: expect.any(Number),
      }),
    );
    expect(pushWordsToServer).toHaveBeenCalled();
    expect(text()).toContain("Aprender terminado");
  });

  it("sin significado ofrece «Definir con IA» y rellena por sello", async () => {
    listWordsMock.mockResolvedValue([word()]);
    enrichMock.mockResolvedValue({
      ok: true,
      found: true,
      entries: [
        {
          lemma: "casa",
          pos: "sustantivo",
          entryId: "7",
          freqRank: null,
          senses: [{ senseOrder: 1, definition: "hogar", example: null }],
          zipf: null,
        },
      ],
    });
    fillMock.mockResolvedValue(word({ meaning: "hogar" }));
    await render();
    await click("Aprender 1 palabra nueva");
    await click("Mostrar significado");
    expect(text()).toContain("Sin significado guardado");
    // Sin significado no puede entrar al repaso.
    expect(button("Quiero aprenderla")?.disabled).toBe(true);
    await click("Definir con IA");
    expect(enrichMock).toHaveBeenCalled();
    expect(fillMock.mock.calls[0].slice(0, 3)).toEqual([
      "es:casa",
      1,
      expect.objectContaining({ meaning: "hogar" }),
    ]);
  });

  it("sin significado y con la IA apagada se aprende escribiéndolo a mano", async () => {
    useAiMock.mockResolvedValue(false);
    listWordsMock.mockResolvedValue([word()]);
    fillMock.mockResolvedValue(word({ meaning: "hogar" }));
    await render();
    // Sin IA la palabra sigue siendo aprendible: el héroe la ofrece y la
    // ficha permite definirla a mano en vez de dejarla bloqueada.
    await click("Aprender 1 palabra nueva");
    await click("Mostrar significado");
    expect(button("Definir con IA")).toBeUndefined();
    expect(text()).toContain("Sin significado guardado");
    // «Ya la conozco» sigue disponible sin definición.
    expect(button("Ya la conozco")?.disabled).toBe(false);
    // Significado manual: al guardarlo, «Quiero aprenderla» se habilita.
    const input = host.querySelector(
      ".nb-learn-meaning-input",
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "hogar");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    await click("Guardar significado");
    expect(fillMock.mock.calls[0].slice(0, 3)).toEqual([
      "es:casa",
      1,
      expect.objectContaining({ meaning: "hogar" }),
    ]);
    expect(button("Quiero aprenderla")?.disabled).toBe(false);
  });

  it("un fallo al guardar muestra error y no avanza", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    saveKnowledgeMock.mockRejectedValueOnce(new Error("boom"));
    await render();
    await click("Aprender 1 palabra nueva");
    await click("Mostrar significado");
    await click("Ya la conozco");
    expect(text()).toContain("No se pudo guardar");
    expect(text()).toContain("qué crees que significa");
  });

  it("sirve tandas de 5 y al terminar ofrece seguir con las siguientes", async () => {
    listWordsMock.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) =>
        word({ form: `palabra${i}`, meaning: `sentido ${i}` }),
      ),
    );
    await render();
    await click("Aprender 5 de 7 palabras nuevas");
    // La tanda es de 5 aunque queden 7 pendientes por aprender.
    expect(text()).toContain("1 de 5");
    for (let i = 0; i < 3; i++) {
      await click("Mostrar significado");
      await click("Ya la conozco");
    }
    for (let i = 0; i < 2; i++) {
      await click("Mostrar significado");
      await click("Quiero aprenderla");
    }
    expect(text()).toContain("Aprender terminado");
    expect(text()).toContain("quedan 2 por aprender");
    expect(button("Seguir aprendiendo (2)")).toBeTruthy();
    expect(button("Repasar estas 2 palabras")).toBeTruthy();
  });

  it("la pantalla de cierre ya no marca sesión activa", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    await click("Aprender 1 palabra nueva");
    expect(
      host.querySelector(".notebook")?.getAttribute("data-session"),
    ).toBe("learn");
    await click("Mostrar significado");
    await click("Ya la conozco");
    expect(text()).toContain("Aprender terminado");
    // La barra de navegación debe volver: sin sesión activa el
    // atributo se retira aunque el estado de la tanda persista.
    expect(
      host.querySelector(".notebook")?.getAttribute("data-session"),
    ).toBeNull();
  });

  it("salir de Aprender sin ver ninguna ficha vuelve a la portada", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    await click("Aprender 1 palabra nueva");
    expect(button("Terminar por hoy")?.closest(".notebook-bar")).toBeTruthy();
    await click("Terminar por hoy");
    expect(text()).not.toContain("Aprender terminado");
    expect(host.querySelector(".nb-hero-card")).toBeTruthy();
  });

  it("«Terminar por hoy» conserva el puente a repaso de lo aprendido", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "casa", meaning: "hogar" }),
      word({ form: "perro", meaning: "can", savedAt: 2 }),
    ]);
    await render();
    await click("Aprender 2 palabras nuevas");
    await click("Mostrar significado");
    await click("Quiero aprenderla");
    // Sale a mitad de tanda habiendo aprendido una palabra.
    await click("Terminar por hoy");
    expect(text()).toContain("Aprender terminado");
    expect(button("Repasar esta palabra")).toBeTruthy();
  });

  it("el teclado guía la ficha: Espacio revela y 1 decide «Ya la conozco»", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    await click("Aprender 1 palabra nueva");
    expect(text()).not.toContain("hogar");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(text()).toContain("hogar");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(saveKnowledgeMock).toHaveBeenCalled();
    expect(text()).toContain("Aprender terminado");
  });

  it("una palabra ya repasada no entra a la cola", async () => {
    listWordsMock.mockResolvedValue([
      word({ meaning: "hogar", card: { reps: 2, stability: 3 } as never }),
    ]);
    await render();
    expect(text()).not.toContain("Por aprender");
  });
});

describe("Chequeo de retención a 30 días", () => {
  it("ofrece el chequeo solo con palabras consolidadas y lo arranca al tocar", async () => {
    const consolidated = {
      ...createEmptyCard(new Date(0)),
      reps: 3,
      stability: 30,
      state: 2 as const,
      last_review: new Date(0),
    };
    listWordsMock.mockResolvedValue([
      word({ form: "casa", meaning: "hogar", card: consolidated }),
    ]);
    await render();

    expect(text()).toContain("Memoria a largo plazo · 1");
    await click("Chequeo 30 días");
    expect(text()).toContain("1 de 1");
    expect(text()).toContain("hogar");
  });

  it("no ofrece el chequeo a palabras revisadas hace menos de 30 días", async () => {
    const recent = {
      ...createEmptyCard(new Date(0)),
      reps: 3,
      stability: 30,
      state: 2 as const,
      last_review: new Date(Date.now() - 5 * 86_400_000),
    };
    listWordsMock.mockResolvedValue([word({ form: "casa", meaning: "hogar", card: recent })]);
    await render();
    expect(text()).not.toContain("Chequeo 30 días");
  });

  it("no aparece si ninguna palabra llegó a la etapa asentada", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "casa", meaning: "hogar" }),
    ]);
    await render();
    expect(text()).not.toContain("Chequeo 30 días");
  });
});

describe("Ritmo de repaso", () => {
  beforeEach(() => {
    setActiveRetentionHorizon("standard");
  });
  afterEach(() => {
    setActiveRetentionHorizon("standard");
  });

  const pressed = (label: string) =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === label)
      ?.getAttribute("aria-pressed");

  it("muestra el ritmo equilibrado por defecto y guarda el que elijas", async () => {
    listWordsMock.mockResolvedValue([word({ form: "casa", meaning: "hogar" })]);
    await render();
    expect(pressed("Equilibrado 90%")).toBe("true");
    expect(pressed("Fluido 85%")).toBe("false");

    await click("Fluido 85%");
    expect(saveSessionMock).toHaveBeenCalledWith(RETENTION_HORIZON_KEY, "relaxed", undefined);
    expect(pressed("Fluido 85%")).toBe("true");
    expect(pressed("Equilibrado 90%")).toBe("false");
  });
});

describe("Filtros por idioma y libro", () => {  it("muestra selector de idioma si hay palabras en más de un idioma y filtra la lista", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "casa", lemma: "casa", language: "es", key: "es:casa", meaning: "hogar" }),
      word({ form: "wander", lemma: "wander", language: "en", key: "en:wander", meaning: "vagar" }),
    ]);
    await render();
    await click("Palabras");
    expect(button("Todos (2)")).toBeTruthy();
    expect(button("Español (1)")).toBeTruthy();
    expect(button("Inglés (1)")).toBeTruthy();
    const wordsList = () => host.querySelector(".nb-words")?.textContent ?? "";
    expect(wordsList()).toContain("casa");
    expect(wordsList()).toContain("wander");

    await click("Inglés (1)");
    expect(wordsList()).toContain("wander");
    expect(wordsList()).not.toContain("casa");

    await click("Español (1)");
    expect(wordsList()).toContain("casa");
    expect(wordsList()).not.toContain("wander");
  });

  it("permite filtrar palabras por libro específico", async () => {
    const books = [
      { hash: "h-es", name: "libro-es.epub", title: "Libro Español", author: "Autor ES", language: "es" },
      { hash: "h-en", name: "book-en.epub", title: "Book English", author: "Author EN", language: "en" },
    ];
    listWordsMock.mockResolvedValue([
      word({ form: "reloj", lemma: "reloj", bookHash: "h-es", language: "es", meaning: "tiempo" }),
      word({ form: "clock", lemma: "clock", bookHash: "h-en", language: "en", meaning: "time" }),
    ]);
    await act(async () => {
      root.render(h(Vocabulary, { onClose: vi.fn(), books }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    await click("Palabras");
    const select = host.querySelector("#nb-book-select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    const wordsList = () => [...host.querySelectorAll(".nb-words")].map((el) => el.textContent).join(" ");
    expect(wordsList()).toContain("reloj");
    expect(wordsList()).toContain("clock");

    await act(async () => {
      select.value = "h-en";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    expect(wordsList()).toContain("clock");
    expect(wordsList()).not.toContain("reloj");
  });

  it("en overlay tiene role='dialog' y botón volver; en page no tiene role='dialog' ni botón volver", async () => {
    // 1. Overlay (default)
    await act(async () => {
      root.render(h(Vocabulary, { onClose: vi.fn(), books: [] }));
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    const overlayNotebook = host.querySelector(".notebook");
    expect(overlayNotebook?.getAttribute("role")).toBe("dialog");
    expect(overlayNotebook?.getAttribute("aria-modal")).toBe("true");
    const backBtn = host.querySelector("button[aria-label='Volver']");
    expect(backBtn).not.toBeNull();

    // 2. Page
    await act(async () => {
      root.render(h(Vocabulary, { onClose: vi.fn(), books: [], presentation: "page" }));
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    const pageNotebook = host.querySelector(".notebook");
    expect(pageNotebook?.getAttribute("role")).toBeNull();
    expect(pageNotebook?.getAttribute("aria-modal")).toBeNull();
    const pageBackBtn = host.querySelector("button[aria-label='Volver']");
    expect(pageBackBtn).toBeNull();
  });
});

describe("Reestructura del Cuaderno", () => {
  it("La Mesa de Estudio y el Herbario se muestran como vista inicial", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "cantar", lemma: "cantar", meaning: "entonar" }),
    ]);
    await render();
    const activeTab = host.querySelector(".nb-tabs button[aria-pressed='true']");
    expect(activeTab?.textContent).toBe("Mi Herbario de Palabras");
    expect(text()).toContain("La Mesa de Estudio");
    expect(button("Aprender 1 palabra nueva")).toBeTruthy();
    expect(text()).toContain("1 por aprender");
    expect(host.querySelector(".nb-words")).toBeTruthy();
  });

  it("El vacío «Estás al día.» aparece cuando no hay pendientes", async () => {
    const futureDue = new Date(Date.now() + 86_400_000 * 2).toISOString();
    listWordsMock.mockResolvedValue([
      word({
        form: "cantar",
        lemma: "cantar",
        meaning: "entonar",
        card: { reps: 2, stability: 30, due: futureDue } as never,
      }),
    ]);
    await render();
    expect(text()).toContain("Estás al día.");
    expect(text()).toContain("El próximo repaso: pasado mañana");
  });

  it("El aviso de alcance aparece con un filtro de libro y «Ver todas» lo reinicia", async () => {
    const books = [
      { hash: "h-es", name: "libro-es.epub", title: "Libro Español", author: "Autor ES", language: "es" },
    ];
    listWordsMock.mockResolvedValue([
      word({ form: "reloj", lemma: "reloj", bookHash: "h-es", meaning: "tiempo" }),
    ]);
    await act(async () => {
      root.render(h(Vocabulary, { onClose: vi.fn(), books }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    await click("Palabras");
    const select = host.querySelector("#nb-book-select") as HTMLSelectElement;
    await act(async () => {
      select.value = "h-es";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    expect(text()).toContain("Solo palabras de «Libro Español»");
    expect(button("Ver todas")).toBeTruthy();

    await click("Ver todas");
    expect(text()).not.toContain("Solo palabras de «Libro Español»");
  });

  it("Los números de la fila de estados coinciden con la lista filtrada", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "nueva", lemma: "nueva", meaning: "m1", card: { reps: 0, stability: 1 } as never }),
      word({ form: "aprendiendo", lemma: "aprendiendo", meaning: "m2", card: { reps: 1, stability: 5 } as never }),
      word({ form: "asentada", lemma: "asentada", meaning: "m3", card: { reps: 3, stability: 40 } as never }),
    ]);
    await render();

    expect(button("Todas (3)")).toBeTruthy();
    expect(button("Nuevas (1)")).toBeTruthy();
    expect(button("En Práctica (1)")).toBeTruthy();
    expect(button("Dominadas (1)")).toBeTruthy();

    await click("En Práctica (1)");
    const wordsList = () => host.querySelector(".nb-words")?.textContent ?? "";
    expect(wordsList()).toContain("aprendiendo");
    expect(wordsList()).not.toContain("nueva");
    expect(wordsList()).not.toContain("asentada");
  });

  it("El menú Exportar tiene 3 opciones y Palabras ya no ofrece «Pasajes CSV»", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    await click("Palabras");

    const exportDetails = host.querySelector("details.nb-export");
    expect(exportDetails).toBeTruthy();
    const exportButtons = exportDetails?.querySelectorAll("button");
    const exportLabels = [...(exportButtons ?? [])].map((b) => b.textContent?.trim());
    expect(exportLabels).toEqual(["CSV", "Para Anki", "Cuaderno (.md)"]);
    expect(exportLabels).not.toContain("Pasajes CSV");
  });

  it("Ordenar por Libro muestra grupos y por Fecha una lista sin grupos, de más reciente a más antigua", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "antigua", savedAt: 100, meaning: "m1", bookHash: "h1" }),
      word({ form: "reciente", savedAt: 500, meaning: "m2", bookHash: "h2" }),
    ]);
    await render();
    await click("Palabras");

    // Por defecto es fecha: no hay nb-group, y la lista está ordenada de más reciente a más antigua
    expect(host.querySelector(".nb-group")).toBeNull();
    const rows = [...host.querySelectorAll(".nb-word .nb-word-form")].map((el) => el.textContent);
    expect(rows).toEqual(["reciente", "antigua"]);

    // Ordenar por Libro: muestra secciones nb-group
    await click("Libro");
    expect(host.querySelectorAll(".nb-group").length).toBeGreaterThan(0);
  });

  it("La fila abre y cierra (aria-expanded) y muestra la oración y Quitar", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "espejo", meaning: "superficie que refleja", context: "El espejo de la sala", lemma: "espejo" }),
    ]);
    await render();
    await click("Palabras");

    const rowBtn = host.querySelector(".nb-word-row") as HTMLButtonElement;
    expect(rowBtn).toBeTruthy();
    expect(rowBtn.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".nb-word-detail")).toBeNull();
    expect(button("Quitar")).toBeUndefined();
    expect(text()).not.toContain("El espejo de la sala");

    // Abre al tocarla
    await act(async () => {
      rowBtn.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(rowBtn.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".nb-word-detail")).toBeTruthy();
    expect(button("Quitar")).toBeTruthy();
    expect(text()).toContain("El espejo de la sala");

    // Cierra al tocarla de nuevo
    await act(async () => {
      rowBtn.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(rowBtn.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".nb-word-detail")).toBeNull();
    expect(button("Quitar")).toBeUndefined();
  });

  it("resalta contextSentence con fallback morfológico ante formas flexionadas", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "correr", meaning: "desplazarse velozmente", context: "Ellos corrían por el sendero", lemma: "correr" }),
    ]);
    await render();
    await click("Palabras");

    const rowBtn = host.querySelector(".nb-word-row") as HTMLButtonElement;
    await act(async () => {
      rowBtn.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    const highlight = host.querySelector(".nb-word-quote-highlight");
    expect(highlight).toBeTruthy();
    expect(highlight?.textContent).toBe("corrían");
  });

  it("muestra en la cabecera píldoras de dominio interactivas (Nuevas, En Práctica, Dominadas)", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "nueva", lemma: "nueva", meaning: "m1", card: { reps: 0, stability: 1 } as never }),
      word({ form: "aprendiendo", lemma: "aprendiendo", meaning: "m2", card: { reps: 1, stability: 5 } as never }),
      word({ form: "asentada", lemma: "asentada", meaning: "m3", card: { reps: 3, stability: 40 } as never }),
    ]);
    await render();

    const pills = host.querySelectorAll(".vocab-progress-pill");
    expect(pills.length).toBe(3);
    const pillTexts = [...pills].map((p) => p.textContent?.trim());
    expect(pillTexts.some((t) => t?.includes("Nuevas"))).toBe(true);
    expect(pillTexts.some((t) => t?.includes("En Práctica"))).toBe(true);
    expect(pillTexts.some((t) => t?.includes("Dominadas"))).toBe(true);

    // Al tocar la píldora de "Nuevas", salta a la pestaña Palabras con filtro activo
    const nuevaPill = [...pills].find((p) => p.textContent?.includes("Nuevas")) as HTMLButtonElement;
    await act(async () => {
      nuevaPill.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    const wordsList = host.querySelector(".nb-words")?.textContent ?? "";
    expect(wordsList).toContain("nueva");
    expect(wordsList).not.toContain("aprendiendo");
  });

  it("la fila de palabra muestra barra de estabilidad FSRS, caja de cita y botón de partida rápida de 3 min", async () => {
    listWordsMock.mockResolvedValue([
      word({
        form: "espejo",
        meaning: "superficie que refleja",
        context: "El espejo de la sala",
        lemma: "espejo",
        card: {
          reps: 2,
          stability: 14,
          due: new Date(Date.now() - 86_400_000).toISOString(),
        } as never,
      }),
    ]);
    await render();
    await click("Palabras");

    const rowBtn = host.querySelector(".nb-word-row") as HTMLButtonElement;
    await act(async () => {
      rowBtn.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    // Barra de estabilidad FSRS
    const stabilityBar = host.querySelector(".word-memory-stability");
    expect(stabilityBar).toBeTruthy();
    expect(stabilityBar?.textContent).toContain("Estabilidad en memoria");
    expect(stabilityBar?.textContent).toContain("14 días");

    // Indicador visual de 4 segmentos
    const segments = host.querySelectorAll(".word-stability-segment");
    expect(segments.length).toBe(4);
    const filledSegments = host.querySelectorAll(".word-stability-segment.is-filled");
    // Con stability 14 días (>= 14), los 4 segmentos están llenos
    expect(filledSegments.length).toBe(4);

    // Caja de cita con palabra resaltada en ámbar suave
    const quoteBox = host.querySelector(".nb-word-quote-box");
    expect(quoteBox).toBeTruthy();
    expect(quoteBox?.textContent).toContain("El espejo de la sala");
    const highlighted = quoteBox?.querySelector(".nb-word-quote-highlight");
    expect(highlighted).toBeTruthy();
    expect(highlighted?.textContent).toBe("espejo");

    // Botón de partida rápida
    const quickGameBtn = host.querySelector(".btn--quick-game");
    expect(quickGameBtn).toBeTruthy();
    expect(quickGameBtn?.textContent).toContain("Partida rápida (3 min)");
  });

  it("Hero Card muestra La Mesa de Estudio con el Gato, CTA único y modos libres plegados", async () => {
    listWordsMock.mockResolvedValue([
      word({
        form: "murmullo",
        meaning: "sonido suave",
        context: "Un murmullo entre los árboles",
        card: { reps: 1, stability: 3 } as never,
      }),
    ]);
    await render();

    // 1. Hero Card "La Mesa de Estudio"
    const heroCard = host.querySelector(".nb-hero-card");
    expect(heroCard).toBeTruthy();
    expect(heroCard?.textContent).toContain("La Mesa de Estudio");

    // Sin compañero activo no se pinta el gato y el resumen ocupa todo el ancho.
    expect(host.querySelector(".nb-hero-cat-wrapper")).toBeNull();
    expect(host.querySelector(".nb-hero-study-desk--solo")).toBeTruthy();

    // Sin gamificación en el héroe: ni barra de energía ni combo.
    expect(host.querySelector(".nb-hero-energy")).toBeNull();
    expect(text()).not.toContain("Energía Léxica");

    // CTA principal único: una palabra con reps 1 y sin vencimiento no da
    // nada que aprender ni repasar, así que el botón invita a seguir leyendo.
    const flowBtn = host.querySelector(".nb-hero-btn-flow");
    expect(flowBtn).toBeTruthy();
    expect(flowBtn?.textContent).toContain("Seguir leyendo");
    expect(host.querySelectorAll(".nb-hero-cta .btn--primary")).toHaveLength(1);
    expect(host.querySelector(".notebook-quick-review-cta")).toBeNull();

    // Modos libres: un solo plegable cerrado; dentro, 4 juegos + taller IA
    // + los 8 ejercicios extra en una misma rejilla.
    const plegable = host.querySelector("details.nb-free-modes") as HTMLDetailsElement;
    expect(plegable).toBeTruthy();
    expect(plegable.open).toBe(false);
    expect(plegable.querySelector("summary")?.textContent).toBe("Más formas de practicar");
    expect(host.querySelectorAll(".nb-free-modes-grid")).toHaveLength(1);
    const freeCards = host.querySelectorAll(".nb-free-mode-card");
    expect(freeCards.length).toBe(13);
    const freeNames = [...freeCards].map((c) => c.querySelector(".nb-free-mode-name")?.textContent);
    expect(freeNames).toContain("Hueco en el Libro");
    expect(freeNames).toContain("Sílabas de Tinta");
    expect(freeNames).toContain("Telar de Frases");
    expect(freeNames).toContain("Parejas");
    expect(freeNames).toContain("Taller con el Gato IA");
    expect(freeNames).toContain("Escribir");
    expect(freeNames).not.toContain("Más ejercicios");
  });

  it("el control segmentado permite alternar entre Mi Herbario de Palabras y Citas y Hallazgos", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "relicario", meaning: "estuche" }),
    ]);
    await render();

    expect(button("Mi Herbario de Palabras")).toBeTruthy();
    expect(button("Citas y Hallazgos")).toBeTruthy();
    expect(host.querySelector(".nb-words")).toBeTruthy();

    // Cambiar a Citas y Hallazgos
    await click("Citas y Hallazgos");
    expect(host.querySelector(".nb-words")).toBeNull();
    expect(host.querySelector("section[aria-label='Citas guardadas']")).toBeTruthy();

    // Volver a Mi Herbario de Palabras
    await click("Mi Herbario de Palabras");
    expect(host.querySelector(".nb-words")).toBeTruthy();
  });

  it("al pulsar Iniciar Sesión Fluida activa el flujo de práctica adaptativa", async () => {
    listWordsMock.mockResolvedValue([
      word({
        form: "lucero",
        meaning: "estrella brillante",
        context: "El lucero brillaba al amanecer",
        card: {
          reps: 2,
          stability: 5,
          due: new Date(Date.now() - 86_400_000).toISOString(),
        } as never,
      }),
    ]);
    await render();

    const flowBtn = host.querySelector(".nb-hero-btn-flow") as HTMLButtonElement;
    expect(flowBtn).toBeTruthy();

    await act(async () => {
      flowBtn.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    // Se inicia el modo de práctica
    expect(host.querySelector(".nb-practice")).toBeTruthy();
    expect(text()).toContain("Repaso");
  });

  it("renderiza la tira de capturadas recientemente y abre la ficha al pulsar el chip", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "efímero", lemma: "efímero", savedAt: 100 }),
      word({ form: "resplandor", lemma: "resplandor", savedAt: 200 }),
    ]);
    await render();

    const rail = host.querySelector(".nb-recent-rail");
    expect(rail).toBeTruthy();
    const chips = host.querySelectorAll(".nb-recent-chip");
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain("resplandor");
    expect(chips[1].textContent).toContain("efímero");

    await act(async () => {
      (chips[0] as HTMLButtonElement).click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    expect(host.querySelector(".nb-word-detail")).toBeTruthy();
  });

  describe("Cuaderno Unificado y Repaso de 1 Minuto (Track 4)", () => {
    it("oculta los modos libres y el taller si featureFlags.vocabGames está desactivado", async () => {
      const { saveFeatureFlags } = await import("../lib/settings");
      saveFeatureFlags({ vocabGames: false });
      try {
        listWordsMock.mockResolvedValue([
          word({
            form: "solsticio",
            meaning: "Época en que el Sol se halla en uno de los trópicos.",
            card: { reps: 2, stability: 1, due: new Date(Date.now() - 1000).toISOString() } as never,
          }),
        ]);
        gamePanelProps.current = null;
        await render();

        expect(host.querySelector(".nb-hero-card")).toBeTruthy();
        expect(host.querySelector(".nb-free-modes")).toBeNull();
        expect(gamePanelProps.current).toBeNull();
      } finally {
        saveFeatureFlags({ vocabGames: true });
      }
    });

    it("Fase 4.3: muestra el aviso de Deshacer al quitar una palabra y restaura el registro íntegro al pulsarlo", async () => {
      const fsrsCard = createEmptyCard(new Date("2026-03-20"));
      fsrsCard.reps = 3;
      fsrsCard.stability = 15;
      const testWord = word({
        form: "efímero",
        meaning: "pasajero",
        card: fsrsCard,
      });
      listWordsMock.mockResolvedValue([testWord]);
      await render();

      expect(text()).toContain("efímero");

      // Abrir la fila de la palabra para ver acciones
      const wordRowBtn = host.querySelector<HTMLButtonElement>(".nb-word-row");
      expect(wordRowBtn).toBeTruthy();
      await act(async () => {
        wordRowBtn?.click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });

      const removeBtn = host.querySelector<HTMLButtonElement>(".nb-remove");
      expect(removeBtn).toBeTruthy();

      await act(async () => {
        removeBtn?.click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });

      // Aviso de eliminación con botón Deshacer
      const noticeText = host.querySelector(".app-notice-text");
      expect(noticeText?.textContent).toBe("«efímero» se quitó del cuaderno.");
      const undoBtn = host.querySelector<HTMLButtonElement>(".app-notice-action");
      expect(undoBtn?.textContent).toBe("Deshacer");

      // Pulsar Deshacer
      const putMock = vi.mocked(putSavedWord);
      const pushMock = vi.mocked(pushWordsToServer);

      await act(async () => {
        undoBtn?.click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });

      expect(putMock).toHaveBeenCalledWith(
        expect.objectContaining({
          form: "efímero",
          deleted: false,
          deletedAt: null,
          card: expect.objectContaining({ stability: 15 }),
        }),
        expect.anything(),
      );
      expect(pushMock).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            form: "efímero",
            deleted: false,
            deletedAt: null,
          }),
        ],
        expect.anything(),
      );
    });
  });
});



describe("Sesión de repaso: solo lo que ya se presentó", () => {
  const past = () => new Date(Date.now() - 86_400_000).toISOString();

  const exposureFor = (key: string) =>
    loadSessionMock.mockImplementation(async (clave) =>
      clave === LEARN_EXPOSURE_KEY
        ? JSON.stringify({
            version: 1,
            seen: { [key]: { at: 1, verdict: "learn" } },
            updatedAt: 1,
          })
        : null,
    );

  it("separa «por aprender» de «para repasar» y no cuenta lo nunca presentado", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "alondra", meaning: "ave", context: "Cantó la alondra." }),
      word({
        form: "brisa",
        meaning: "viento suave",
        context: "Sopló la brisa.",
        card: { reps: 2, stability: 5, due: past() } as never,
      }),
      word({
        form: "cedro",
        meaning: "árbol",
        context: "El cedro creció.",
        card: { reps: 0, stability: 0, due: past() } as never,
      }),
    ]);
    exposureFor("es:cedro");
    await render();

    // Alondra nunca se presentó: no está lista para repasar.
    expect(text()).toContain("3 guardadas · 1 por aprender · 2 para repasar");
    expect(button("Aprender 1 palabra nueva")).toBeTruthy();
  });

  it("la sesión solo sirve lo ya presentado y vencido", async () => {
    listWordsMock.mockResolvedValue([
      word({
        form: "brisa",
        meaning: "viento suave",
        context: "Sopló la brisa.",
        card: { reps: 2, stability: 5, due: past() } as never,
      }),
      word({
        form: "cedro",
        meaning: "árbol",
        context: "El cedro creció.",
        card: { reps: 0, stability: 0, due: past() } as never,
      }),
    ]);
    exposureFor("es:cedro");
    await render();

    await click("Repasar 2 palabras");
    expect(host.querySelector(".nb-practice")).toBeTruthy();
    expect(text()).toContain("1 de 2");
  });

  it("sin repasos pendientes no se practica por adelantado", async () => {
    const future = new Date(Date.now() + 86_400_000 * 2).toISOString();
    listWordsMock.mockResolvedValue([
      word({
        form: "brisa",
        meaning: "viento suave",
        card: { reps: 2, stability: 5, due: future } as never,
      }),
    ]);
    await render();
    const onClose = vi.fn();
    await act(async () => {
      root.render(h(Vocabulary, { onClose, books: [] }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(text()).toContain("Estás al día");
    await click("Seguir leyendo");
    expect(onClose).toHaveBeenCalled();
    expect(host.querySelector(".nb-practice")).toBeNull();
  });

  it("una palabra sin oración se repasa por su significado, no adivinando el hueco", async () => {
    listWordsMock.mockResolvedValue([
      word({
        form: "lucero",
        meaning: "estrella brillante",
        card: { reps: 0, stability: 0, due: past() } as never,
      }),
    ]);
    loadSessionMock.mockImplementation(async (key) =>
      key === LEARN_EXPOSURE_KEY
        ? JSON.stringify({
            version: 1,
            seen: { "es:lucero": { at: 1, verdict: "learn" } },
            updatedAt: 1,
          })
        : null,
    );
    await render();

    await act(async () => {
      (host.querySelector(".nb-hero-btn-flow") as HTMLButtonElement).click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    expect(text()).toContain("1 de 1");
    expect(text()).not.toContain("Toca la palabra que falta.");
    expect(text()).toContain("lucero");
    // Modo significado: se revela la respuesta y se autocalifica.
    expect(button("Mostrar respuesta")).toBeTruthy();
  });
});

describe("Puente aprender → repasar", () => {
  it("al terminar la ficha ofrece repasar las palabras que se quisieron aprender", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "casa", meaning: "hogar" }),
      word({ form: "lucero", meaning: "estrella brillante" }),
    ]);
    await render();

    await click("Aprender 2 palabras nuevas");
    for (const label of ["Mostrar significado", "Quiero aprenderla"]) {
      await click(label);
      await click("Mostrar significado");
      await click("Quiero aprenderla");
    }
    expect(text()).toContain("Aprender terminado");

    await click("Repasar estas 2 palabras");
    expect(host.querySelector(".nb-practice")).toBeTruthy();
    expect(text()).toContain("1 de 2");
  });

  it("sin palabras guardadas no aparece el puente", async () => {
    listWordsMock.mockResolvedValue([word({ form: "casa", meaning: "hogar" })]);
    await render();
    await click("Aprender 1 palabra nueva");
    await click("Mostrar significado");
    await click("Ya la conozco");
    expect(text()).toContain("Aprender terminado");
    expect(text()).not.toContain("Repasar esta palabra");
  });

  it("«Pasar por ahora» avanza una ficha sin significado sin escribir exposición", async () => {
    useAiMock.mockResolvedValue(false);
    listWordsMock.mockResolvedValue([word()]);
    await render();
    await act(async () => {
      (host.querySelector(".nb-word-row") as HTMLButtonElement).click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    await act(async () => {
      (host.querySelector('button[aria-label="Aprender casa"]') as HTMLButtonElement).click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    await click("Mostrar significado");
    await click("Pasar por ahora");

    expect(text()).toContain("Aprender terminado");
    const exposureWrites = saveSessionMock.mock.calls.filter(
      ([key]) => key === LEARN_EXPOSURE_KEY,
    );
    expect(exposureWrites).toHaveLength(0);
  });
});

describe("Elegir palabra corrige con significado", () => {
  const past = () => new Date(Date.now() - 86_400_000).toISOString();
  const exposureFor = (keys: string[]) =>
    loadSessionMock.mockImplementation(async (clave) =>
      clave === LEARN_EXPOSURE_KEY
        ? JSON.stringify({
            version: 1,
            seen: Object.fromEntries(keys.map((key) => [key, { at: 1, verdict: "learn" }])),
            updatedAt: 1,
          })
        : null,
    );

  it("no muestra el significado antes de responder y lo muestra después", async () => {
    listWordsMock.mockResolvedValue([
      word({
        form: "lucero",
        meaning: "estrella brillante",
        context: "El lucero brillaba al amanecer",
        card: { reps: 0, stability: 0, due: past() } as never,
      }),
      word({
        form: "brisa",
        meaning: "viento suave",
        card: {
          reps: 2,
          stability: 5,
          due: new Date(Date.now() + 86_400_000).toISOString(),
        } as never,
      }),
    ]);
    exposureFor(["es:lucero"]);
    await render();
    await click("Repasar 1 palabra");

    expect(text()).toContain("Toca la palabra que falta.");
    expect(text()).not.toContain("estrella brillante");

    const opciones = [...host.querySelectorAll(".choice-option")] as HTMLButtonElement[];
    const incorrecta = opciones.find((b) => b.textContent !== "lucero");
    expect(incorrecta).toBeTruthy();
    await act(async () => {
      incorrecta!.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    expect(text()).toContain("estrella brillante");
    expect(text()).toContain("lucero");
  });

  it("las opciones son del idioma de la palabra", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const away = { reps: 2, stability: 5, due: future } as never;
    const es = ["lucero", "brisa", "cedro", "alba"].map((form) =>
      word({ form, meaning: `definición de ${form}`, card: away }),
    );
    const en = ["whisper", "shadow", "meadow"].map((form) =>
      word({ form, language: "en", meaning: `meaning of ${form}`, card: away }),
    );
    listWordsMock.mockResolvedValue([
      word({
        form: "lucero",
        meaning: "estrella brillante",
        context: "El lucero brillaba al amanecer",
        card: { reps: 0, stability: 0, due: past() } as never,
      }),
      ...es.slice(1),
      ...en,
    ]);
    exposureFor(["es:lucero"]);
    await render();
    await click("Repasar 1 palabra");

    const opciones = [...host.querySelectorAll(".choice-option")].map((b) => b.textContent);
    expect(opciones).toHaveLength(4);
    for (const opcion of opciones) {
      expect(["lucero", "brisa", "cedro", "alba"]).toContain(opcion);
    }
  });
});

describe("Modos libres: tampoco examinan lo nunca presentado", () => {
  const past = () => new Date(Date.now() - 86_400_000).toISOString();

  it("«Hueco en el Libro» solo sirve palabras ya presentadas y vencidas", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "alondra", meaning: "ave canora", context: "Cantó la alondra al alba." }),
      word({
        form: "brisa",
        meaning: "viento suave",
        context: "Sopló la brisa fresca.",
        card: { reps: 2, stability: 5, due: past() } as never,
      }),
    ]);
    await render();
    await act(async () => {
      (host.querySelector(".nb-free-mode-card") as HTMLButtonElement).click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    expect(host.querySelector(".nb-practice")).toBeTruthy();
    expect(text()).toContain("1 de 1");
    expect(text()).toContain("fresca");
    expect(text()).not.toContain("alba");
  });

  it("sin palabras presentadas los modos quedan deshabilitados y se explica por qué", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "alondra", meaning: "ave canora", context: "Cantó la alondra al alba." }),
    ]);
    await render();

    const tarjetas = [...host.querySelectorAll(".nb-free-mode-card")] as HTMLButtonElement[];
    const deshabilitadas = tarjetas.filter((b) => b.disabled);
    // Sin palabras presentadas todos los modos quedan apagados (5 de la
    // fila principal + 8 extra); ya no hay botón «Más ejercicios».
    expect(deshabilitadas.length).toBe(tarjetas.length);
    expect(tarjetas.length).toBe(13);
    expect(text()).toContain("Aprende primero las nuevas");
    expect(host.querySelector(".nb-practice")).toBeNull();
  });

  it("los demás modos viven en la misma rejilla plegable, sin «Más ejercicios»", async () => {
    listWordsMock.mockResolvedValue([
      word({
        form: "brisa",
        meaning: "viento suave",
        context: "Sopló la brisa fresca.",
        card: { reps: 2, stability: 5, due: past() } as never,
      }),
    ]);
    await render();
    const plegable = host.querySelector("details.nb-free-modes") as HTMLDetailsElement;
    expect(plegable.open).toBe(false);
    expect(host.querySelector(".nb-free-modes-grid--extra")).toBeNull();
    const nombres = [...plegable.querySelectorAll(".nb-free-mode-name")].map(
      (n) => n.textContent,
    );
    expect(nombres).toContain("Significado");
    expect(nombres).toContain("Escribir");
    expect(nombres).toContain("Parejas");
    expect(nombres).not.toContain("Más ejercicios");
  });

  it("el Reto del Escritor acredita FSRS una sola vez por palabra", async () => {
    listWordsMock.mockResolvedValue([
      word({
        form: "brisa",
        meaning: "viento suave",
        context: "Sopló la brisa fresca.",
        card: { reps: 2, stability: 5, due: past() } as never,
      }),
    ]);
    await render();
    const complete = async (key: string, score: number) => {
      await act(async () => {
        gamePanelProps.current?.onChallengeComplete?.(key, score);
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });
    };
    await complete("es:brisa", 90);
    expect(updateWordMock).toHaveBeenCalledTimes(1);
    // Reenviar el reto superado con la misma palabra no vuelve a
    // calificar la tarjeta: serían repasos artificiales sin espacio.
    await complete("es:brisa", 92);
    expect(updateWordMock).toHaveBeenCalledTimes(1);
  });
});

describe("Partida rápida: misma regla que la sesión", () => {
  const past = () => new Date(Date.now() - 86_400_000).toISOString();
  const future = () => new Date(Date.now() + 86_400_000).toISOString();

  const abrirFila = async (form: string) => {
    const fila = [...host.querySelectorAll(".nb-word-row")].find((b) =>
      (b.textContent ?? "").includes(form),
    ) as HTMLButtonElement;
    await act(async () => {
      fila.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  };

  it("no se ofrece en una palabra que nunca se presentó", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "alondra", meaning: "ave canora", context: "Cantó la alondra." }),
    ]);
    await render();
    await abrirFila("alondra");

    expect(host.querySelector(".btn--quick-game")).toBeNull();
  });

  it("con una palabra vencida arma la partida solo con palabras repasables", async () => {
    listWordsMock.mockResolvedValue([
      word({
        form: "brisa",
        meaning: "viento suave",
        context: "Sopló la brisa fresca.",
        savedAt: 2,
        card: { reps: 2, stability: 5, due: past() } as never,
      }),
      word({
        form: "cedro",
        meaning: "árbol aromático",
        context: "El cedro creció.",
        savedAt: 1,
        card: { reps: 2, stability: 5, due: future() } as never,
      }),
    ]);
    await render();
    await abrirFila("brisa");

    const boton = host.querySelector(".btn--quick-game") as HTMLButtonElement;
    expect(boton).toBeTruthy();
    await act(async () => {
      boton.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    expect(host.querySelector(".nb-practice")).toBeTruthy();
    expect(text()).toContain("1 de 1");
    expect(text()).toContain("fresca");
    expect(text()).not.toContain("creció");
  });
});

describe("Plan de simplificación — Fase 1 (comportamiento)", () => {
  const past = () => new Date(Date.now() - 86_400_000).toISOString();
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  const exposureFor = (keys: string[]) =>
    loadSessionMock.mockImplementation(async (clave) =>
      clave === LEARN_EXPOSURE_KEY
        ? JSON.stringify({
            version: 1,
            seen: Object.fromEntries(keys.map((key) => [key, { at: 1, verdict: "learn" }])),
            updatedAt: 1,
          })
        : null,
    );
  const dueWord = (over: Partial<SavedWord> = {}) =>
    word({
      meaning: "viento suave",
      context: "Sopló la brisa fresca.",
      card: { reps: 2, stability: 1, due: past() } as never,
      ...over,
    });
  const cardFront = () => host.querySelector(".nb-card-front strong")?.textContent;
  const startReview = async (label: string) => {
    await click(label);
    expect(host.querySelector(".nb-practice")).toBeTruthy();
  };

  describe("B1 · repasar primero", () => {
    it("con vencidas el botón principal es «Repasar» y «Aprender» queda secundario", async () => {
      listWordsMock.mockResolvedValue([
        dueWord({ form: "brisa" }),
        word({ form: "alondra", meaning: "ave" }),
      ]);
      await render();
      const botones = [...host.querySelectorAll(".nb-hero-btn-flow")] as HTMLButtonElement[];
      expect(botones.map((b) => b.textContent)).toEqual([
        "Repasar 1 palabra",
        "Aprender 1 palabra nueva",
      ]);
      expect(botones[0].classList.contains("btn--primary")).toBe(true);
      expect(botones[1].classList.contains("btn--primary")).toBe(false);
      expect(text()).toContain("para repasar hoy");
    });

    it("sin vencidas «Aprender» vuelve a ser el principal", async () => {
      listWordsMock.mockResolvedValue([word({ form: "alondra", meaning: "ave" })]);
      await render();
      const botones = [...host.querySelectorAll(".nb-hero-btn-flow")] as HTMLButtonElement[];
      expect(botones).toHaveLength(1);
      expect(botones[0].textContent).toBe("Aprender 1 palabra nueva");
      expect(botones[0].classList.contains("btn--primary")).toBe(true);
    });
  });

  describe("B2 · la tanda real", () => {
    it("dice cuántas abre de cuántas hay pendientes", async () => {
      listWordsMock.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => word({ form: `p${i}`, meaning: `m${i}` })),
      );
      await render();
      expect(button("Aprender 5 de 7 palabras nuevas")).toBeTruthy();
      expect(button("Aprender 7 palabras nuevas")).toBeUndefined();
    });
  });

  describe("B3 · pista del gato", () => {
    beforeEach(() => {
      // clearAllMocks no restaura implementaciones: otras pruebas apagan la IA.
      useAiMock.mockResolvedValue(true);
      listWordsMock.mockResolvedValue([
        dueWord({ form: "brisa", savedAt: 2 }),
        dueWord({ form: "cedro", meaning: "árbol", context: "El cedro creció.", savedAt: 1 }),
      ]);
      exposureFor(["es:brisa", "es:cedro"]);
    });

    it("sin «Usar IA» no se ofrece la pista", async () => {
      useAiMock.mockResolvedValue(false);
      await render();
      await startReview("Repasar 2 palabras");
      expect(button("💡 Pista")).toBeUndefined();
    });

    it("con IA se ofrece y el repaso registra cuántas pistas se pidieron", async () => {
      await render();
      await startReview("Repasar 2 palabras");
      await click("💡 Pista");
      await settle();
      expect(explainMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        (host.querySelector(".choice-option") as HTMLButtonElement).click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      await click("Continuar");
      expect(recordReviewMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({ hints: 1 }),
      );
    });

    it("una pista que llega tarde no se pinta sobre la tarjeta siguiente", async () => {
      let resolveHint: (value: { ok: true; explanation: string }) => void = () => {};
      explainMock.mockImplementationOnce(
        () => new Promise((resolve) => (resolveHint = resolve)) as never,
      );
      await render();
      await startReview("Repasar 2 palabras");
      await click("💡 Pista");
      await act(async () => {
        (host.querySelector(".choice-option") as HTMLButtonElement).click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      await click("Continuar");
      expect(text()).toContain("2 de 2");
      await act(async () => {
        resolveHint({ ok: true, explanation: "pista tardía de la tarjeta anterior" });
        for (let i = 0; i < 6; i++) await Promise.resolve();
      });
      expect(text()).not.toContain("pista tardía");
      // La tarjeta nueva puede pedir la suya: no quedó «Pensando…» colgado.
      expect(button("💡 Pista")).toBeTruthy();
    });

    it("una pista por reto: tocar al gato dos veces pide la pista una sola vez", async () => {
      await render();
      await startReview("Repasar 2 palabras");
      const cat = host.querySelector('[data-testid="cat-tap"]') as HTMLElement;
      await act(async () => {
        cat.click();
        for (let i = 0; i < 6; i++) await Promise.resolve();
      });
      await act(async () => {
        cat.click();
        for (let i = 0; i < 6; i++) await Promise.resolve();
      });
      expect(explainMock).toHaveBeenCalledTimes(1);
      // Ya pedida: el botón se oculta y la pista se ve dentro de la tarjeta.
      expect(button("💡 Pista")).toBeUndefined();
      expect(host.querySelector(".nb-card .scramble-hint-box")).toBeTruthy();
    });

    it("tocar al gato después de responder no pide pista: es una caricia", async () => {
      await render();
      await startReview("Repasar 2 palabras");
      await act(async () => {
        (host.querySelector(".choice-option") as HTMLButtonElement).click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      await act(async () => {
        (host.querySelector('[data-testid="cat-tap"]') as HTMLElement).click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      expect(explainMock).not.toHaveBeenCalled();
      expect(
        (host.querySelector('[data-testid="cat-state"]') as HTMLElement).dataset.pose,
      ).toBe("pet");
    });
  });

  describe("B4 · rescate con sentido", () => {
    const level2 = (over: Partial<SavedWord>) =>
      dueWord({ card: { reps: 3, stability: 5, due: past() } as never, ...over });

    it("con oración rescata a «elegir palabra»", async () => {
      listWordsMock.mockResolvedValue([level2({ form: "brisa" })]);
      exposureFor(["es:brisa"]);
      await render();
      await startReview("Repasar 1 palabra");
      expect(scrambleProps.current).toBeTruthy();
      await act(async () => {
        scrambleProps.current?.onWrong?.();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      expect(text()).toContain("Toca la palabra que falta.");
    });

    it("el acierto tras el rescate no cuenta como recuperación: se califica Again", async () => {
      listWordsMock.mockResolvedValue([level2({ form: "brisa" })]);
      exposureFor(["es:brisa"]);
      await render();
      await startReview("Repasar 1 palabra");
      await act(async () => {
        scrambleProps.current?.onWrong?.();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      const right = [...host.querySelectorAll<HTMLButtonElement>(".choice-option")].find(
        (b) => b.textContent?.trim() === "brisa",
      );
      expect(right).toBeTruthy();
      await act(async () => {
        right!.click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      await click("Continuar");
      expect(recordReviewMock.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ form: "brisa", rating: "again" }),
      );
    });

    it("sin oración rescata al significado y no a adivinar entre cuatro", async () => {
      listWordsMock.mockResolvedValue([level2({ form: "brisa", context: undefined })]);
      exposureFor(["es:brisa"]);
      await render();
      await startReview("Repasar 1 palabra");
      await act(async () => {
        scrambleProps.current?.onWrong?.();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      expect(text()).not.toContain("Toca la palabra que falta.");
      expect(host.querySelector(".choice-option")).toBeNull();
      expect(button("Mostrar respuesta")).toBeTruthy();
    });
  });

  describe("B5 · calificar no pisa un significado recién rellenado", () => {
    it("guarda sobre la palabra vigente y no sobre la copia de la cola", async () => {
      let releaseBackfill: () => void = () => {};
      backfillMock.mockImplementation(
        async (words: SavedWord[]) =>
          new Promise((resolve) => {
            releaseBackfill = () =>
              resolve(
                words.map((w) => ({ ...w, meaning: "viento suave", updatedAt: (w.updatedAt ?? 0) + 1 })),
              );
          }),
      );
      listWordsMock.mockResolvedValue([dueWord({ form: "brisa", meaning: undefined })]);
      exposureFor(["es:brisa"]);
      await render();
      await startReview("Repasar 1 palabra");
      // El relleno termina con la sesión ya armada.
      await act(async () => {
        releaseBackfill();
        for (let i = 0; i < 6; i++) await Promise.resolve();
      });
      await act(async () => {
        (host.querySelector(".choice-option") as HTMLButtonElement).click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      await click("Continuar");
      expect(updateWordMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({ key: "es:brisa", meaning: "viento suave" }),
      );
    });
  });

  describe("B6 · sin tarjeta en blanco", () => {
    it("«Partida rápida» no arma nada con una palabra sin significado ni oración", async () => {
      listWordsMock.mockResolvedValue([
        word({ form: "vacía", card: { reps: 2, stability: 1, due: past() } as never }),
      ]);
      exposureFor(["es:vacía"]);
      await render();
      await act(async () => {
        (host.querySelector(".nb-word-row") as HTMLButtonElement).click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      await act(async () => {
        (host.querySelector(".btn--quick-game") as HTMLButtonElement).click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      expect(host.querySelector(".nb-practice")).toBeNull();
      expect(text()).toContain("necesita un significado o una oración");
    });

    it("el chequeo de 30 días omite las que no tienen nada que mostrar", async () => {
      const consolidated = {
        ...createEmptyCard(new Date(0)),
        reps: 3,
        stability: 30,
        state: 2 as const,
        last_review: new Date(0),
      };
      listWordsMock.mockResolvedValue([
        word({ form: "vacía", card: consolidated }),
        word({ form: "casa", meaning: "hogar", card: consolidated }),
      ]);
      await render();
      await click("Chequeo 30 días");
      expect(text()).toContain("1 de 1");
      expect(text()).toContain("hogar");
    });
  });

  describe("B7 · Parejas pide al menos dos", () => {
    const parejas = () =>
      [...host.querySelectorAll(".nb-free-mode-card")].find(
        (b) => b.querySelector(".nb-free-mode-name")?.textContent === "Parejas",
      ) as HTMLButtonElement;

    it("con una sola palabra no arma la tanda y lo explica", async () => {
      listWordsMock.mockResolvedValue([dueWord({ form: "brisa" })]);
      exposureFor(["es:brisa"]);
      await render();
      await act(async () => {
        parejas().click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      expect(host.querySelector(".nb-practice")).toBeNull();
      expect(text()).toContain("Parejas necesita al menos dos palabras");
    });

    it("no deja una palabra suelta como tanda de una", async () => {
      const palabras = ["a1", "b2", "c3", "d4", "e5"].map((form, i) =>
        dueWord({ form, meaning: `sentido ${i}`, savedAt: 10 - i }),
      );
      listWordsMock.mockResolvedValue(palabras);
      exposureFor(palabras.map((w) => w.key));
      await render();
      await act(async () => {
        parejas().click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      // 5 elegibles: una tanda de 4; la quinta queda para otra ronda.
      expect(text()).toContain("de 4");
    });
  });

  describe("B9 · «Pasar por ahora» no vuelve al frente", () => {
    it("las fichas sin significado van detrás de las que sí lo tienen", async () => {
      listWordsMock.mockResolvedValue([
        word({ form: "sin", savedAt: 9 }),
        word({ form: "con", meaning: "algo", savedAt: 1 }),
      ]);
      await render();
      await click("Aprender 2 palabras nuevas");
      expect(cardFront()).toBe("con");
    });

    it("una ficha pasada no encabeza la siguiente tanda", async () => {
      useAiMock.mockResolvedValue(false);
      listWordsMock.mockResolvedValue([
        word({ form: "sinuno", savedAt: 9 }),
        word({ form: "sindos", savedAt: 8 }),
        word({ form: "con", meaning: "algo", savedAt: 1 }),
      ]);
      await render();
      await click("Aprender 3 palabras nuevas");
      await click("Mostrar significado");
      await click("Quiero aprenderla");
      expect(cardFront()).toBe("sinuno");
      await click("Mostrar significado");
      await click("Pasar por ahora");
      expect(cardFront()).toBe("sindos");
      await click("Terminar por hoy");
      await click("Seguir aprendiendo (2)");
      expect(cardFront()).toBe("sindos");
    });
  });
});

describe("Plan de simplificación — Fase 2 (superficie)", () => {
  const past = () => new Date(Date.now() - 86_400_000).toISOString();
  const exposureFor = (keys: string[]) =>
    loadSessionMock.mockImplementation(async (clave) =>
      clave === LEARN_EXPOSURE_KEY
        ? JSON.stringify({
            version: 1,
            seen: Object.fromEntries(keys.map((key) => [key, { at: 1, verdict: "learn" }])),
            updatedAt: 1,
          })
        : null,
    );
  const dueWord = (form: string, savedAt: number) =>
    word({
      form,
      savedAt,
      meaning: "sentido",
      context: `Una ${form} cualquiera.`,
      card: { reps: 2, stability: 1, due: past() } as never,
    });
  const responder = async () => {
    await act(async () => {
      (host.querySelector(".choice-option") as HTMLButtonElement).click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    await click("Continuar");
  };

  it("vaciar la cola cierra con «Terminado por hoy.» y la próxima fecha", async () => {
    listWordsMock.mockResolvedValue([dueWord("brisa", 1)]);
    exposureFor(["es:brisa"]);
    await render();
    await click("Repasar 1 palabra");
    await responder();
    expect(text()).toContain("Terminado por hoy.");
    expect(text()).not.toContain("Repaso terminado.");
    expect(text()).toContain("1 palabra repasada");
    expect(text()).toMatch(/vuelve en|Nada pendiente|Te queda/);
    expect(text()).not.toContain("XP");
    expect(button("Volver a mi lectura")).toBeTruthy();
  });

  it("«Terminar por hoy» a mitad de sesión pasa por el mismo cierre", async () => {
    listWordsMock.mockResolvedValue([dueWord("brisa", 2), dueWord("cedro", 1)]);
    exposureFor(["es:brisa", "es:cedro"]);
    await render();
    await click("Repasar 2 palabras");
    await responder();
    expect(text()).toContain("2 de 2");
    await click("Terminar por hoy");
    expect(text()).toContain("Terminado por hoy.");
    expect(text()).toContain("1 palabra repasada");
    expect(host.querySelector(".nb-practice")).toBeNull();
  });

  it("«Terminar por hoy» sin haber repasado nada vuelve al cuaderno sin cierre", async () => {
    listWordsMock.mockResolvedValue([dueWord("brisa", 1)]);
    exposureFor(["es:brisa"]);
    await render();
    await click("Repasar 1 palabra");
    await click("Terminar por hoy");
    expect(text()).not.toContain("Terminado por hoy.");
    expect(host.querySelector(".nb-hero-card")).toBeTruthy();
  });

  // ---- Repaso del Cuaderno (docs/designs/2026-11-13-cuaderno-repaso.md) ----
  // Cuaderno con dos vencidas de oración propia y tres distractores no
  // vencidos: la tarjeta tiene cuatro opciones y la oración dice cuál toca.
  const CONTEXTS: Record<string, string> = {
    brisa: "Sopló la brisa del mar.",
    cedro: "El cedro del jardín creció.",
  };
  const seed = () => {
    listWordsMock.mockResolvedValue([
      word({ ...dueWord("brisa", 2), context: CONTEXTS.brisa }),
      word({ ...dueWord("cedro", 1), context: CONTEXTS.cedro }),
      word({ form: "duna", meaning: "arena", savedAt: 0 }),
      word({ form: "roca", meaning: "piedra", savedAt: 0 }),
      word({ form: "nube", meaning: "vapor", savedAt: 0 }),
    ]);
    exposureFor(["es:brisa", "es:cedro"]);
  };
  const catState = () => host.querySelector('[data-testid="cat-state"]') as HTMLElement;
  const options = () => [...host.querySelectorAll(".choice-option")] as HTMLButtonElement[];
  // La forma del reto actual sale de su oración (el hueco no la muestra).
  const currentForm = () =>
    (host.querySelector(".nb-card")?.textContent ?? "").includes("mar") ? "brisa" : "cedro";
  const pick = (correct: boolean) =>
    options().find((b) => (b.textContent === currentForm()) === correct)!;
  const tap = async (el: HTMLElement) =>
    act(async () => {
      el.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  const key = async (k: string) =>
    act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

  it("D1: «Terminar por hoy» vive en la cabecera, no al final de la tarjeta", async () => {
    seed();
    await render();
    await click("Repasar 2 palabras");
    expect(button("Terminar por hoy")?.closest(".notebook-bar")).toBeTruthy();
    expect(host.querySelector(".nb-practice")?.textContent).not.toContain("Terminar por hoy");
  });

  it("D1: salir con una respuesta sin confirmar la califica y la cuenta", async () => {
    seed();
    await render();
    await click("Repasar 2 palabras");
    await tap(pick(true));
    await click("Terminar por hoy");
    expect(updateWordMock).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Terminado por hoy.");
    expect(text()).toContain("1 palabra repasada");
  });

  it("D1: si el guardado falla al salir, la sesión sigue", async () => {
    seed();
    updateWordMock.mockRejectedValueOnce(new Error("idb"));
    await render();
    await click("Repasar 2 palabras");
    await tap(pick(true));
    await click("Terminar por hoy");
    expect(host.querySelector(".nb-practice")).toBeTruthy();
    expect(text()).not.toContain("Terminado por hoy.");
  });

  it("D2: el resultado va en un único role=status debajo de las opciones", async () => {
    seed();
    await render();
    await click("Repasar 2 palabras");
    await tap(pick(false));
    const statuses = host.querySelectorAll('.nb-practice [role="status"]');
    expect(statuses).toHaveLength(1);
    const foot = host.querySelector(".nb-answer-foot")!;
    expect(foot.getAttribute("role")).toBe("status");
    expect(foot.textContent).toContain(`Incorrecto: era “${currentForm()}”`);
    expect(host.querySelector(".nb-card .nb-card-back")).toBeNull();
    expect(
      host.querySelector(".choice-list")!.compareDocumentPosition(foot) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("D2: enfocar «Continuar» no desplaza la página", async () => {
    seed();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    await render();
    await click("Repasar 2 palabras");
    focus.mockClear();
    await tap(pick(true));
    const continuar = button("Continuar")!;
    expect(continuar.classList.contains("nb-continue")).toBe(true);
    const index = focus.mock.contexts.indexOf(continuar);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(focus.mock.calls[index][0]).toEqual({ preventScroll: true });
    focus.mockRestore();
  });

  it("D4: las opciones respondidas siguen deshabilitadas y marcadas", async () => {
    seed();
    await render();
    await click("Repasar 2 palabras");
    await tap(pick(false));
    expect(options().every((b) => b.disabled)).toBe(true);
    expect(host.querySelectorAll(".choice-option.is-correct")).toHaveLength(1);
    expect(host.querySelectorAll(".choice-option.is-wrong")).toHaveLength(1);
  });

  it("A4: dos aciertos seguidos dejan la racha en 2, no en 4", async () => {
    seed();
    await render();
    await click("Repasar 2 palabras");
    await tap(pick(true));
    expect(catState().dataset.combo).toBe("1");
    await click("Continuar");
    await tap(pick(true));
    expect(catState().dataset.combo).toBe("2");
    await click("Continuar");
    expect(catState().dataset.combo).toBe("2");
  });

  it("D5: al fallar el gato acaricia y nombra la palabra; al avanzar vuelve a idle", async () => {
    seed();
    await render();
    await click("Repasar 2 palabras");
    const form = currentForm();
    await tap(pick(false));
    expect(catState().dataset.pose).toBe("pet");
    expect(catState().dataset.speech).toBe(`Era «${form}». La próxima la tienes.`);
    await click("Continuar");
    expect(catState().dataset.pose).toBe("idle");
  });

  it("una sesión nueva empieza arriba y sin la frase ni la racha de la anterior", async () => {
    seed();
    // Presentación overlay (la de render): se desplaza el propio cuaderno.
    const scrollTo = vi.fn();
    const original = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = scrollTo as never;
    await render();
    await click("Repasar 2 palabras");
    await tap(pick(true));
    await click("Terminar por hoy");
    expect(catState().dataset.combo).toBe("1");
    await click("Ver el cuaderno");
    scrollTo.mockClear();
    await click("Aprender 3 palabras nuevas");
    expect(catState().dataset.combo).toBe("0");
    expect(catState().dataset.speech).toBe("");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    HTMLElement.prototype.scrollTo = original;
  });

  it("D6: la tecla 2 elige la segunda opción y otra tecla después no cambia nada", async () => {
    seed();
    await render();
    await click("Repasar 2 palabras");
    await key("2");
    const second = options()[1];
    expect(second.classList.contains("is-correct") || second.classList.contains("is-wrong")).toBe(true);
    const before = options().map((b) => b.className).join("|");
    await key("3");
    expect(options().map((b) => b.className).join("|")).toBe(before);
  });
});

describe("Plan de simplificación — Fase 3 (cifras, texto y accesibilidad)", () => {
  const past = () => new Date(Date.now() - 86_400_000).toISOString();
  const future = () => new Date(Date.now() + 20 * 86_400_000).toISOString();
  const listKnowledgeMock = vi.mocked(listKnowledge);
  const listAnnotationsMock = vi.mocked(listAnnotations);
  const updateAnnotationMock = vi.mocked(updateAnnotation);
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  const pill = (stage: "new" | "learning" | "settled") =>
    host.querySelector(`.vocab-progress-item--${stage} .vocab-progress-count`)?.textContent;
  const exposureFor = (keys: string[]) =>
    loadSessionMock.mockImplementation(async (clave) =>
      clave === LEARN_EXPOSURE_KEY
        ? JSON.stringify({
            version: 1,
            seen: Object.fromEntries(keys.map((key) => [key, { at: 1, verdict: "learn" }])),
            updatedAt: 1,
          })
        : null,
    );
  const rowStates = () =>
    [...host.querySelectorAll(".nb-word")].map((li) => [
      li.querySelector(".nb-word-lemma")?.textContent,
      li.querySelector(".nb-state")?.textContent,
    ]);

  beforeEach(() => {
    listKnowledgeMock.mockResolvedValue([]);
    listAnnotationsMock.mockResolvedValue([]);
  });

  describe("U1–U2 · una sola cuenta y las mismas etiquetas", () => {
    const palabras = () => [
      // nunca presentada: «por aprender»
      word({ form: "alondra", savedAt: 5 }),
      // presentada (ficha) pero sin repasos todavía: en práctica, ya no «nueva»
      word({ form: "cedro", savedAt: 4, card: { reps: 0, stability: 0, due: past() } as never }),
      // repasada con poca estabilidad: en práctica
      word({ form: "brisa", savedAt: 3, card: { reps: 2, stability: 1, due: future() } as never }),
      // estable: dominada
      word({ form: "roble", savedAt: 2, card: { reps: 6, stability: 20, due: future() } as never }),
    ];

    it("«Nuevas» es exactamente lo que el encabezado llama «por aprender»", async () => {
      listWordsMock.mockResolvedValue(palabras());
      exposureFor(["es:cedro"]);
      await render();
      expect(text()).toContain("1 por aprender");
      expect(pill("new")).toBe("1");
      expect(pill("learning")).toBe("2");
      expect(pill("settled")).toBe("1");
    });

    it("la fila lleva la misma etiqueta que la píldora, en singular", async () => {
      listWordsMock.mockResolvedValue(palabras());
      exposureFor(["es:cedro"]);
      await render();
      expect(Object.fromEntries(rowStates() as [string, string][])).toEqual({
        alondra: "Nueva",
        // Presentada y vencida: «Para hoy» se superpone a su etapa (en práctica).
        cedro: "Para hoy",
        brisa: "En Práctica",
        roble: "Dominada",
      });
    });

    it("una palabra declarada conocida cuenta como dominada, no como «Nueva»", async () => {
      listWordsMock.mockResolvedValue([word({ form: "sol", savedAt: 1 })]);
      listKnowledgeMock.mockResolvedValue([
        { key: "es:sol", language: "es", lemma: "sol", known: true, source: "declared", updatedAt: 1 },
      ]);
      await render();
      expect(pill("new")).toBe("0");
      expect(pill("settled")).toBe("1");
      expect(text()).not.toContain("por aprender");
    });

    it("el filtro «Nuevas» lista las mismas palabras que cuenta la píldora", async () => {
      listWordsMock.mockResolvedValue(palabras());
      exposureFor(["es:cedro"]);
      await render();
      await click("Nuevas (1)");
      expect(rowStates()).toEqual([["alondra", "Nueva"]]);
    });

    it("la barra de progreso usa los mismos nombres que las píldoras", async () => {
      listWordsMock.mockResolvedValue(palabras());
      exposureFor(["es:cedro"]);
      await render();
      const titulos = [...host.querySelectorAll(".vocab-progress-seg")].map((n) =>
        n.getAttribute("title"),
      );
      expect(titulos).toEqual(["1 dominadas", "2 en práctica", "1 nuevas"]);
    });
  });

  describe("Revisión en navegador · el significado no se repite", () => {
    it("al abrir una fila el significado se lee una sola vez", async () => {
      listWordsMock.mockResolvedValue([word({ form: "casa", meaning: "Edificio donde vive una familia." })]);
      await render();
      expect(host.querySelectorAll(".nb-word-preview")).toHaveLength(1);
      await act(async () => {
        (host.querySelector(".nb-word-row") as HTMLButtonElement).click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      const apariciones = (host.querySelector(".nb-word")?.textContent ?? "").split(
        "Edificio donde vive una familia.",
      ).length - 1;
      expect(apariciones).toBe(1);
    });
  });

  describe("U3 · un solo aviso de deshacer", () => {
    it("al quitar una palabra solo hay un «Deshacer»", async () => {
      listWordsMock.mockResolvedValue([word({ form: "casa", meaning: "hogar" })]);
      await render();
      await act(async () => {
        (host.querySelector(".nb-word-row") as HTMLButtonElement).click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      await click("Quitar");
      const deshacer = [...host.querySelectorAll("button")].filter(
        (b) => b.textContent === "Deshacer",
      );
      expect(deshacer).toHaveLength(1);
    });
  });

  describe("U4 · citas: deshacer y error visible", () => {
    const cita = {
      key: "q1",
      kind: "passage",
      text: "Una frase memorable",
      createdAt: 1,
      updatedAt: 1,
      bookHash: "h1",
    } as never;
    const abrirCitas = async () => {
      listWordsMock.mockResolvedValue([word({ form: "casa", meaning: "hogar" })]);
      listAnnotationsMock.mockResolvedValue([cita]);
      await render();
      await click("Citas y Hallazgos");
      await settle();
    };

    it("quitar una cita ofrece recuperarla", async () => {
      await abrirCitas();
      expect(text()).toContain("Una frase memorable");
      await click("Eliminar");
      expect(updateAnnotationMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({ key: "q1", deleted: true }),
      );
      expect(text()).not.toContain("Una frase memorable");
      expect(text()).toContain("La cita se quitó del cuaderno.");
      await click("Deshacer");
      expect(updateAnnotationMock.mock.calls[1][0]).toEqual(
        expect.objectContaining({ key: "q1", deleted: false }),
      );
      expect(text()).toContain("Una frase memorable");
    });

    it("si no se pudo guardar, la cita se queda y se avisa", async () => {
      await abrirCitas();
      updateAnnotationMock.mockRejectedValueOnce(new Error("boom"));
      await click("Eliminar");
      expect(text()).toContain("Una frase memorable");
      expect(text()).toContain("No se pudo quitar la cita");
      expect(text()).not.toContain("La cita se quitó del cuaderno.");
    });
  });

  describe("U5 · chips recientes", () => {
    it("son una lista real de botones, sin roles que pisen el del botón", async () => {
      listWordsMock.mockResolvedValue([
        word({ form: "efímero", savedAt: 1 }),
        word({ form: "resplandor", savedAt: 2 }),
      ]);
      await render();
      const lista = host.querySelector("ul.nb-recent-track");
      expect(lista).toBeTruthy();
      const items = lista!.querySelectorAll(":scope > li > button.nb-recent-chip");
      expect(items).toHaveLength(2);
      expect(lista!.querySelector("[role=listitem]")).toBeNull();
      expect(lista!.querySelector(".nb-recent-chip-star svg")).toBeTruthy();
      expect(host.querySelector(".nb-recent-chip-star")?.textContent).not.toContain("★");
    });
  });

  describe("U6 · gato de la portada", () => {
    const companion = () => ({
      enabled: true,
      state: { xp: 0 },
      name: "Misi",
      stage: 1,
      mood: "awake",
      accessories: [],
    });

    it("sin compañero activo no se pinta", async () => {
      listWordsMock.mockResolvedValue([word({ form: "casa" })]);
      companionMock.current = { ...companion(), enabled: false };
      await render();
      expect(host.querySelector(".nb-hero-cat-wrapper")).toBeNull();
      expect(host.querySelector(".nb-hero-study-desk--solo")).toBeTruthy();
    });

    it("clic y teclado hacen lo mismo", async () => {
      listWordsMock.mockResolvedValue([word({ form: "casa" })]);
      companionMock.current = companion();
      await render();
      const gato = () => host.querySelector(".nb-hero-cat-wrapper") as HTMLElement;
      expect(gato()).toBeTruthy();
      expect(host.querySelector(".nb-hero-study-desk--solo")).toBeNull();
      await act(async () => {
        gato().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      // El teclado también cambia la frase, no solo la pose.
      expect(host.querySelector(".nb-hero-cat-bubble")?.textContent).toContain(
        "¡A leer y repasar con ganas!",
      );
    });
  });

  describe("U7 · el chip lleva a la palabra aunque haya filtros", () => {
    it("quita el filtro que la escondía y abre la ficha", async () => {
      listWordsMock.mockResolvedValue([
        word({
          form: "brisa",
          meaning: "viento suave",
          savedAt: 9,
          card: { reps: 2, stability: 1, due: future() } as never,
        }),
        word({
          form: "roble",
          meaning: "árbol",
          savedAt: 1,
          card: { reps: 6, stability: 20, due: future() } as never,
        }),
      ]);
      await render();
      await click("Dominadas (1)");
      expect(rowStates()).toEqual([["roble", "Dominada"]]);
      const chip = [...host.querySelectorAll(".nb-recent-chip")].find((c) =>
        (c.textContent ?? "").includes("brisa"),
      ) as HTMLButtonElement;
      await act(async () => {
        chip.click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      expect(rowStates().map(([form]) => form)).toContain("brisa");
      expect(host.querySelector(".nb-word-detail")?.textContent).toContain("viento suave");
    });

    it("también vence una búsqueda que no la incluía", async () => {
      listWordsMock.mockResolvedValue([
        word({ form: "brisa", meaning: "viento suave", savedAt: 9 }),
        word({ form: "roble", meaning: "árbol", savedAt: 1 }),
      ]);
      await render();
      const input = host.querySelector(".nb-search input") as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          "roble",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      expect(rowStates().map(([form]) => form)).toEqual(["roble"]);
      const chip = [...host.querySelectorAll(".nb-recent-chip")].find((c) =>
        (c.textContent ?? "").includes("brisa"),
      ) as HTMLButtonElement;
      await act(async () => {
        chip.click();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      expect(rowStates().map(([form]) => form)).toContain("brisa");
    });
  });
});

describe("Plan de simplificación — Fase 4 (limpieza y rendimiento)", () => {
  it("la cola de repaso se relee con la hora: una palabra que vence con el cuaderno abierto aparece", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      listWordsMock.mockResolvedValue([
        word({
          form: "brisa",
          meaning: "viento suave",
          context: "Sopló la brisa fresca.",
          card: {
            reps: 2,
            stability: 1,
            due: new Date(Date.now() + 30_000).toISOString(),
          } as never,
        }),
      ]);
      await render();
      expect(button("Repasar 1 palabra")).toBeUndefined();
      await act(async () => {
        vi.advanceTimersByTime(61_000);
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      expect(button("Repasar 1 palabra")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("buscar sigue filtrando con el índice precalculado (sin acentos ni mayúsculas)", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "murciélago", meaning: "mamífero volador", savedAt: 2 }),
      word({ form: "roble", meaning: "árbol", savedAt: 1 }),
    ]);
    await render();
    const input = host.querySelector(".nb-search input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "MURCIELAGO",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    const filas = [...host.querySelectorAll(".nb-word-lemma")].map((n) => n.textContent);
    expect(filas).toEqual(["murciélago"]);
  });

  it("el conteo de cada filtro sale de un solo recorrido y coincide con la lista", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "a1", savedAt: 3 }),
      word({ form: "b2", savedAt: 2, card: { reps: 2, stability: 1, due: new Date(Date.now() + 86_400_000).toISOString() } as never }),
      word({ form: "c3", savedAt: 1, card: { reps: 6, stability: 20, due: new Date(Date.now() + 86_400_000).toISOString() } as never }),
    ]);
    await render();
    for (const [label, esperadas] of [
      ["Todas (3)", 3],
      ["Nuevas (1)", 1],
      ["En Práctica (1)", 1],
      ["Dominadas (1)", 1],
    ] as const) {
      await click(label);
      expect(host.querySelectorAll(".nb-word")).toHaveLength(esperadas);
    }
  });
});

describe("Hueco 3.1 & 3.2 — Estabilidad y Resalte Morfológico", () => {
  it("safeStability y getStabilitySegments manejan valores corruptos", async () => {
    const { safeStability, getStabilitySegments } = await import("./Vocabulary");
    expect(safeStability(undefined)).toBe(0);
    expect(safeStability(NaN)).toBe(0);
    expect(safeStability(-5)).toBe(0);
    expect(safeStability("10")).toBe(0);
    expect(safeStability(15)).toBe(15);

    expect(getStabilitySegments(undefined)).toBe(0);
    expect(getStabilitySegments(NaN)).toBe(0);
    expect(getStabilitySegments(0.4)).toBe(0);
    expect(getStabilitySegments(1)).toBe(1);
    expect(getStabilitySegments(3)).toBe(2);
    expect(getStabilitySegments(8)).toBe(3);
    expect(getStabilitySegments(20)).toBe(4);
  });

  it("findEpisodicHighlightRange encuentra formas flexionadas y alternancias vocálicas", async () => {
    const { findEpisodicHighlightRange } = await import("./Vocabulary");
    const ctx = "Él pensó en ella mientras caminaba.";
    const range = findEpisodicHighlightRange(ctx, "pensar");
    expect(range).not.toBeNull();
    expect(ctx.slice(range!.start, range!.end)).toBe("pensó");

    const ctx2 = "Siempre duerme profundamente.";
    const range2 = findEpisodicHighlightRange(ctx2, "dormir");
    expect(range2).not.toBeNull();
    expect(ctx2.slice(range2!.start, range2!.end)).toBe("duerme");
  });

  it("H3.2: findEpisodicHighlightRange conserva los índices exactos en contexto NFD para locuciones", async () => {
    const { findEpisodicHighlightRange } = await import("./Vocabulary");
    const rawContext = "La canción caminó a través de la niebla espesa.".normalize("NFD");
    const range = findEpisodicHighlightRange(rawContext, "a través de");
    expect(range).not.toBeNull();
    expect(rawContext.slice(range!.start, range!.end).normalize("NFC")).toBe("a través de");
  });
});

describe("E13 — Postal de palabra en su frase desde el Herbario", () => {
  it("muestra el botón Postal en palabras con contexto, oculta en palabras sin contexto y abre QuoteCardModal", async () => {
    listWordsMock.mockResolvedValue([
      word({
        form: "efímero",
        lemma: "efímero",
        meaning: "de corta duración",
        context: "Un efímero destello cruzó el cielo.",
      }),
      word({
        key: "es:sincontexto",
        form: "solaz",
        lemma: "solaz",
        meaning: "alivio",
        context: "",
      }),
    ]);
    await render();

    // Expandir palabra con contexto
    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>(".nb-word-row"));
    await act(async () => {
      rows[0].click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    const postalBtn = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Crear postal de efímero"]',
    );
    expect(postalBtn).toBeTruthy();

    // Expandir palabra sin contexto -> no ofrece Postal
    await act(async () => {
      rows[1].click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(host.querySelector('button[aria-label="Crear postal de solaz"]')).toBeNull();

    // Abrir QuoteCardModal lazy desde Postal
    await act(async () => {
      postalBtn!.click();
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[aria-label="Postal de palabra"]')).toBeTruthy(),
    );
    const modal = document.querySelector('[aria-label="Postal de palabra"]')!;
    expect(modal.textContent).toContain("Postal de palabra");
    expect(modal.textContent).toContain("Significado");
  });
});
