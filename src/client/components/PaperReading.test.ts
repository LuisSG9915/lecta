// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterRange, ChapterTarget } from "../lib/chapters";
import type { PreparationRecord } from "../lib/preparation";
import type {
  ManualSaveOutcome,
  PaperSheetState,
} from "../hooks/usePaperReading";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// La fila de respuesta se prueba en SectionPreview; aquí se reemplaza
// por un doble mínimo para aislar la hoja de la cadena de importación
// del pórtico del lector.
vi.mock("./SectionPreview", () => ({
  PreparationAnswerRow: ({
    row,
    onAnswer,
  }: {
    row: { key: string; form: string };
    onAnswer: (key: string, answer: "known" | "unknown") => void;
  }) =>
    h(
      "li",
      { "data-testid": `row-${row.key}` },
      h("strong", null, row.form),
      h(
        "button",
        { type: "button", onClick: () => onAnswer(row.key, "known") },
        "La conozco",
      ),
      h(
        "button",
        { type: "button", onClick: () => onAnswer(row.key, "unknown") },
        "No la conozco",
      ),
    ),
}));

import PaperChapterSheet, {
  type PaperChapterSheetProps,
} from "./PaperChapterSheet";
import PaperReading from "./PaperReading";
import { usePaperReading } from "../hooks/usePaperReading";

vi.mock("../hooks/usePaperReading", () => ({
  usePaperReading: vi.fn(),
}));

vi.mock("../lib/cover", () => ({
  displayTitle: (name: string, title?: string) => title || name,
}));

const target = (id: string, label: string, depth = 0) =>
  ({ id, label, depth }) as unknown as ChapterTarget;

const sheetTarget = target("t1", "Capítulo 1");

const baseSheet = (over: Partial<PaperSheetState> = {}): PaperSheetState =>
  ({
    target: sheetTarget,
    range: {} as unknown as ChapterRange,
    record: { answers: {} } as unknown as PreparationRecord,
    analysis: "ready",
    text: "texto",
    chapterForms: ["muro", "fatuo", "bálsamo"],
    main: [
      { key: "k1", form: "muro" },
      { key: "k2", form: "fatuo" },
    ] as PaperSheetState["main"],
    more: [] as PaperSheetState["more"],
    uncertain: [] as PaperSheetState["uncertain"],
    answers: {},
    dirty: false,
    saving: false,
    finished: false,
    ...over,
  }) as PaperSheetState;

const sheetProps = (
  over: Partial<PaperChapterSheetProps> = {},
): PaperChapterSheetProps => ({
  sheet: baseSheet(),
  read: false,
  language: "es",
  savedTerms: new Set<string>(),
  bookForms: ["muralla", "bálsamo", "efímero"],
  bookWordCount: 0,
  manualSaves: [],
  onAnswer: vi.fn(),
  onRetry: vi.fn(),
  onClose: vi.fn(),
  onFinish: vi.fn(),
  onToggleRead: vi.fn(),
  onAddWord: vi.fn(async () => ({ kind: "saved", form: "x", wordKey: "w1" }) as ManualSaveOutcome),
  onUndoWord: vi.fn(),
  ...over,
});

let container: HTMLDivElement;
let root: Root;

const render = async (node: ReturnType<typeof h>) => {
  await act(async () => {
    root.render(node);
  });
};

const click = async (el: Element | null) => {
  await act(async () => {
    (el as HTMLElement)?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
};

const text = () => container.textContent ?? "";
const query = (sel: string) => container.querySelector(sel);
const queryAll = (sel: string) => [...container.querySelectorAll(sel)];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("PaperChapterSheet", () => {
  it("muestra el título del capítulo, la instrucción y las filas", async () => {
    await render(h(PaperChapterSheet, sheetProps()));
    expect(text()).toContain("Capítulo 1");
    expect(text()).toContain("Palabras que podrían costarte");
    expect(query('[data-testid="row-k1"]')?.textContent).toContain("muro");
    expect(query('[data-testid="row-k2"]')?.textContent).toContain("fatuo");
    // Jamás el vocabulario del lector digital.
    expect(text()).not.toContain("Entrar al capítulo");
    expect(text()).not.toContain("Estrategia");
  });

  it("responder una fila avisa al controlador", async () => {
    const props = sheetProps();
    await render(h(PaperChapterSheet, props));
    const row = query('[data-testid="row-k1"]')!;
    await click(row.querySelectorAll("button")[0]);
    expect(props.onAnswer).toHaveBeenCalledWith("k1", "known");
  });

  it("estado de carga y de error con Reintentar", async () => {
    const props = sheetProps({ sheet: baseSheet({ analysis: "loading" }) });
    await render(h(PaperChapterSheet, props));
    expect(text()).toContain("Buscando palabras de este capítulo…");

    const err = sheetProps({ sheet: baseSheet({ analysis: "error" }) });
    await render(h(PaperChapterSheet, err));
    expect(text()).toContain("No se pudo preparar este capítulo");
    await click(
      queryAll("button").find((b) => b.textContent === "Reintentar") ?? null,
    );
    expect(err.onRetry).toHaveBeenCalled();
  });

  it("capítulo sin palabras nuevas avisa sin romperse", async () => {
    await render(
      h(
        PaperChapterSheet,
        sheetProps({
          sheet: baseSheet({ main: [], more: [], uncertain: [] }),
        }),
      ),
    );
    expect(text()).toContain("Este capítulo no trae palabras nuevas para ti");
  });

  it("sugiere primero formas del capítulo, luego del libro y el diccionario", async () => {
    const props = sheetProps();
    await render(h(PaperChapterSheet, props));
    const input = query("#paper-add-input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "mu");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const labels = queryAll(".paper-suggestion").map((b) => b.textContent);
    // «muro» es del capítulo y sale antes que «muralla» (del libro);
    // la opción libre siempre queda al final.
    expect(labels[0]).toContain("muro");
    expect(labels[1]).toContain("muralla");
    expect(labels.at(-1)).toContain("Buscar «mu» en el diccionario");

    await click(queryAll(".paper-suggestion")[0]);
    expect(props.onAddWord).toHaveBeenCalledWith("muro");
  });

  it("alta guardada muestra la nota con Deshacer", async () => {
    const props = sheetProps({
      manualSaves: [
        { kind: "saved", form: "muralla", wordKey: "w9", meaning: "muro" },
      ],
    });
    await render(h(PaperChapterSheet, props));
    expect(text()).toContain("«muralla» guardada en tu Herbario");
    await click(
      queryAll("button").find((b) => b.textContent === "Deshacer") ?? null,
    );
    expect(props.onUndoWord).toHaveBeenCalledWith("w9");
  });

  it("sin leer ofrece «Terminé este capítulo»; leído, «Marcar como no leído»", async () => {
    const unread = sheetProps();
    await render(h(PaperChapterSheet, unread));
    await click(
      queryAll("button").find(
        (b) => b.textContent === "Terminé este capítulo",
      ) ?? null,
    );
    expect(unread.onFinish).toHaveBeenCalled();

    const done = sheetProps({ read: true });
    await render(h(PaperChapterSheet, done));
    await click(
      queryAll("button").find(
        (b) => b.textContent === "Marcar como no leído",
      ) ?? null,
    );
    expect(done.onToggleRead).toHaveBeenCalled();
  });

  it("al terminar muestra el panel y, con palabras del libro, el repaso", async () => {
    const props = sheetProps({
      sheet: baseSheet({ finished: true }),
      bookWordCount: 3,
      onReviewBook: vi.fn(),
    });
    await render(h(PaperChapterSheet, props));
    expect(text()).toContain("Capítulo marcado como leído");
    expect(text()).toContain("Volver a los capítulos");
    await click(
      queryAll("button").find(
        (b) => b.textContent === "Repasar palabras de este libro",
      ) ?? null,
    );
    expect(props.onReviewBook).toHaveBeenCalled();
  });

  it("al terminar sin palabras del libro no ofrece repaso", async () => {
    await render(
      h(
        PaperChapterSheet,
        sheetProps({
          sheet: baseSheet({ finished: true }),
          bookWordCount: 0,
          onReviewBook: vi.fn(),
        }),
      ),
    );
    expect(text()).not.toContain("Repasar palabras de este libro");
  });
});

describe("PaperReading", () => {
  const hookReturn = (over: Record<string, unknown> = {}) => ({
    phase: "ready" as const,
    title: "La casa de los espíritus",
    author: "Isabel Allende",
    language: "es",
    entries: [
      { target: target("t1", "Capítulo 1"), status: "read", unknownCount: 0 },
      {
        target: target("t2", "Capítulo 2"),
        status: "prepared",
        unknownCount: 2,
      },
      { target: target("t3", "Capítulo 3"), status: "new", unknownCount: 0 },
    ] as const,
    extras: [
      { target: target("x1", "Página legal"), status: "new", unknownCount: 0 },
    ] as const,
    lastTargetId: "t2",
    retryOpen: vi.fn(),
    sheet: null,
    manualSaves: [],
    savedTerms: new Set<string>(),
    bookWordCount: 2,
    bookForms: [],
    openChapter: vi.fn(),
    closeChapter: vi.fn(async () => {}),
    retryAnalysis: vi.fn(),
    answerWord: vi.fn(),
    finishChapter: vi.fn(async () => {}),
    toggleRead: vi.fn(),
    addManualWord: vi.fn(async () => ({ kind: "saved" }) as ManualSaveOutcome),
    undoManualWord: vi.fn(async () => {}),
    ...over,
  });

  it("encabezado: etiqueta del modo, título del libro y Cerrar", async () => {
    vi.mocked(usePaperReading).mockReturnValue(
      hookReturn() as unknown as ReturnType<typeof usePaperReading>,
    );
    await render(
      h(PaperReading, {
        book: { hash: "h1", name: "casa.epub" },
        onClose: vi.fn(),
      }),
    );
    expect(text()).toContain("Leo este libro en papel");
    expect(text()).toContain("La casa de los espíritus");
    expect(text()).toContain("Isabel Allende");
    expect(text()).toContain(
      "Elige el capítulo que vas a leer. Te mostramos las palabras que podrían costarte.",
    );
    expect(query("button[data-autofocus]")?.textContent).toBe("Cerrar");
  });

  it("cada capítulo muestra su estado en texto y «Aquí te quedaste»", async () => {
    vi.mocked(usePaperReading).mockReturnValue(
      hookReturn() as unknown as ReturnType<typeof usePaperReading>,
    );
    await render(
      h(PaperReading, {
        book: { hash: "h1", name: "casa.epub" },
        onClose: vi.fn(),
      }),
    );
    expect(text()).toContain("Leído");
    expect(text()).toContain("Preparado · 2 en tu Herbario");
    expect(text()).toContain("Sin revisar");
    expect(text()).toContain("Aquí te quedaste");
    // «Aquí te quedaste» solo en el capítulo marcado.
    const badges = queryAll(".paper-chapter-status").filter((s) =>
      s.textContent?.includes("Aquí te quedaste"),
    );
    expect(badges).toHaveLength(1);
  });

  it("preliminares quedan plegados bajo «Preliminares y anexos»", async () => {
    vi.mocked(usePaperReading).mockReturnValue(
      hookReturn() as unknown as ReturnType<typeof usePaperReading>,
    );
    await render(
      h(PaperReading, {
        book: { hash: "h1", name: "casa.epub" },
        onClose: vi.fn(),
      }),
    );
    const details = query("details.paper-extras");
    expect(details?.querySelector("summary")?.textContent).toContain(
      "Preliminares y anexos (1)",
    );
    expect(details?.textContent).toContain("Página legal");
  });

  it("tocar un capítulo lo abre; apertura muestra «Abriendo el libro…»", async () => {
    const hook = hookReturn();
    vi.mocked(usePaperReading).mockReturnValue(
      hook as unknown as ReturnType<typeof usePaperReading>,
    );
    await render(
      h(PaperReading, {
        book: { hash: "h1", name: "casa.epub" },
        onClose: vi.fn(),
      }),
    );
    await click(query('[data-target-id="t3"]'));
    expect(hook.openChapter).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ id: "t3" }) }),
    );

    vi.mocked(usePaperReading).mockReturnValue(
      hookReturn({
        phase: "opening",
        entries: [],
        extras: [],
      }) as unknown as ReturnType<typeof usePaperReading>,
    );
    await render(
      h(PaperReading, {
        book: { hash: "h1", name: "casa.epub" },
        onClose: vi.fn(),
      }),
    );
    expect(text()).toContain("Abriendo el libro…");
  });

  it("sin hoja ni capítulos raros: no se renderiza vocabulario del lector", async () => {
    vi.mocked(usePaperReading).mockReturnValue(
      hookReturn() as unknown as ReturnType<typeof usePaperReading>,
    );
    await render(
      h(PaperReading, {
        book: { hash: "h1", name: "casa.epub" },
        onClose: vi.fn(),
      }),
    );
    expect(text()).not.toContain("Entrar al capítulo");
    expect(text()).not.toContain("Estrategia");
    expect(text()).not.toContain("h1"); // el hash interno jamás se muestra
  });
});
