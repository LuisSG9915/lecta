// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReaderSearchAndTocSheet,
  type ReaderSearchAndTocSheetProps,
  type TocRow,
} from "./ReaderSearchAndTocSheet";
import type { SavedAnnotation } from "../../lib/idb";
import type { SearchHit } from "../../lib/book-search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ReaderSearchAndTocSheet", () => {
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

  const mockTocRows: TocRow[] = [
    {
      label: "Prólogo",
      index: 0,
      depth: 0,
      target: {
        id: "prologue",
        label: "Prólogo",
        href: "prologue.xhtml",
        sectionIndex: 0,
        depth: 0,
        kind: "chapter",
      },
    },
    {
      label: "Capítulo I",
      index: 1,
      depth: 0,
      target: {
        id: "c1",
        label: "Capítulo I",
        href: "c1.xhtml",
        sectionIndex: 1,
        depth: 0,
        kind: "chapter",
      },
    },
  ];

  const mockHits: SearchHit[] = [
    {
      sectionIndex: 1,
      label: "Capítulo I",
      anchor: "hidalgo",
      before: "un ",
      match: "hidalgo",
      after: " de los de lanza en astillero",
    },
  ];

  const mockBookmark: SavedAnnotation = {
    key: "ann-bookmark-1",
    id: "b1",
    bookHash: "hash-1",
    kind: "bookmark",
    sectionIndex: 1,
    createdAt: 1000,
    updatedAt: 1000,
  };

  const defaultProps: ReaderSearchAndTocSheetProps = {
    sheet: "toc",
    closeSheet: vi.fn(),
    setSheet: vi.fn(),
    tocRows: mockTocRows,
    currentChapterTarget: mockTocRows[1].target,
    catalog: null,
    sectionIndex: 1,
    jumpTo: vi.fn(),
    annotations: [mockBookmark],
    setGlossaryOpen: vi.fn(),
    searchQ: "",
    setSearchQ: vi.fn(),
    searchDone: true,
    searchHits: [],
    sectionLabel: (idx) => `Sección ${idx}`,
    bookmark: mockBookmark,
    passages: [],
    saveBookmarkHere: vi.fn(),
    removeMark: vi.fn(),
    editingNote: null,
    noteDraft: "",
    setNoteDraft: vi.fn(),
    setEditingNote: vi.fn(),
    saveNote: vi.fn(),
    setQuoteCard: vi.fn(),
    bookHash: "hash-1",
    title: "Don Quijote",
    author: "Cervantes",
  };

  it("centra el capítulo actual al abrir el índice", () => {
    const spy = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      act(() => {
        root.render(h(ReaderSearchAndTocSheet, { ...defaultProps, sheet: "toc" }));
      });
      const current = container.querySelector("[data-current]");
      if (current) expect(spy).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
      else expect(spy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });

  it("muestra «Tu cinta» arriba del índice y «Ir» salta al ancla", () => {
    const jumpTo = vi.fn();
    const bookmark = {
      key: "k",
      id: "ribbon",
      bookHash: "hash-1",
      kind: "bookmark",
      sectionIndex: 1,
      anchor: "Texto ancla",
      createdAt: 1,
      updatedAt: 1,
    } as SavedAnnotation;
    act(() => {
      root.render(h(ReaderSearchAndTocSheet, { ...defaultProps, sheet: "toc", bookmark, jumpTo }));
    });
    const row = container.querySelector(".toc-ribbon");
    expect(row?.textContent).toContain("Tu cinta");
    act(() => {
      (row?.querySelector("button") as HTMLButtonElement).click();
    });
    expect(jumpTo).toHaveBeenCalledWith(1, { anchor: "Texto ancla" }, "resume");
  });

  it("renderiza la lámina de Índice (TOC) y llama a jumpTo al hacer clic en un capítulo", () => {
    act(() => {
      root.render(h(ReaderSearchAndTocSheet, { ...defaultProps, sheet: "toc" }));
    });

    const buttons = container.querySelectorAll<HTMLButtonElement>("button.toc-item");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain("Prólogo");
    expect(buttons[1].textContent).toContain("Capítulo I");

    act(() => {
      buttons[0].click();
    });

    expect(defaultProps.jumpTo).toHaveBeenCalledWith(
      0,
      { fragment: undefined },
      "chapter",
    );
  });

  it("renderiza la lámina de Búsqueda y permite buscar texto y seleccionar un resultado", () => {
    const setSearchQ = vi.fn();
    const jumpTo = vi.fn();

    act(() => {
      root.render(
        h(ReaderSearchAndTocSheet, {
          ...defaultProps,
          sheet: "search",
          searchQ: "hidalgo",
          searchHits: mockHits,
          setSearchQ,
          jumpTo,
        }),
      );
    });

    const input = container.querySelector<HTMLInputElement>("input.search-input");
    expect(input).toBeDefined();
    expect(input?.value).toBe("hidalgo");

    const hitButton = container.querySelector<HTMLButtonElement>("button.search-hit");
    expect(hitButton).toBeDefined();
    expect(hitButton?.textContent).toContain("hidalgo");

    act(() => {
      hitButton?.click();
    });

    expect(jumpTo).toHaveBeenCalledWith(1, { snippet: "hidalgo" });
  });

  it("renderiza la lámina de Notas y Marcadores mostrando los marcadores existentes", () => {
    act(() => {
      root.render(
        h(ReaderSearchAndTocSheet, {
          ...defaultProps,
          sheet: "marks",
        }),
      );
    });

    const markTitle = container.querySelector(".sheet-title");
    expect(markTitle?.textContent).toContain("Marcadores");

    const bookmarkSection = container.querySelector(".mark-bookmark");
    expect(bookmarkSection).not.toBeNull();
    expect(bookmarkSection?.textContent).toContain("Marcador");
  });
});
