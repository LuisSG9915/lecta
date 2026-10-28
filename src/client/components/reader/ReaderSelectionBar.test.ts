// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderSelectionBar, type ReaderSelectionButton } from "./ReaderSelectionBar";
import type { WordHit } from "../../lib/words";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("../../lib/lexicon", () => ({
  lookupWordInMemory: vi.fn((form: string) => {
    if (form === "ataraxia") {
      return {
        ok: true,
        found: true,
        definitions: ["Estado de imperturbabilidad y serenidad."],
        entries: [
          {
            lemma: "ataraxia",
            senses: [{ definition: "Estado de imperturbabilidad y serenidad." }],
          },
        ],
      };
    }
    return null;
  }),
  lookupWord: vi.fn(async (form: string) => {
    if (form === "ataraxia") {
      return {
        ok: true,
        found: true,
        definitions: ["Estado de imperturbabilidad y serenidad."],
        entries: [
          {
            lemma: "ataraxia",
            senses: [{ definition: "Estado de imperturbabilidad y serenidad." }],
          },
        ],
      };
    }
    if (form === "efímero") {
      return {
        ok: true,
        found: true,
        definitions: ["Pasajero, de corta duración."],
        entries: [
          {
            lemma: "efímero",
            senses: [{ definition: "Pasajero, de corta duración." }],
          },
        ],
      };
    }
    return {
      ok: false,
      found: false,
      definitions: [],
      entries: [],
    };
  }),
}));

vi.mock("../../lib/idb", () => ({
  captureDbScope: vi.fn(() => ({})),
}));

describe("ReaderSelectionBar", () => {
  let host: HTMLDivElement;
  let root: Root;

  const baseHit: WordHit = {
    word: "ataraxia",
    context: "Buscaba la ataraxia del alma.",
  };

  const defaultProps = {
    setSelButton: vi.fn(),
    openSelection: vi.fn(),
    savePassageSelection: vi.fn(),
    openQuoteCardFromSelection: vi.fn(),
    askCatAboutSelection: vi.fn(),
    setDeepModal: vi.fn(),
    language: "es",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  it("no renderiza nada cuando selButton es null", async () => {
    await act(async () => {
      root.render(h(ReaderSelectionBar, { ...defaultProps, selButton: null }));
    });
    expect(host.innerHTML).toBe("");
  });

  describe("Etapa 1: Píldora compacta para 1 sola palabra (<50ms Offline First)", () => {
    it("renderiza la píldora anclada con lema y definición síncrona en memoria", async () => {
      const selButton: ReaderSelectionButton = {
        x: 150,
        y: 200,
        placement: "bottom",
        singleWordHit: baseHit,
      };

      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton }));
      });

      expect(host.querySelector(".reader__word-pill")).not.toBeNull();
      expect(host.textContent).toContain("ataraxia");
      expect(host.textContent).toContain("Estado de imperturbabilidad y serenidad.");
      expect(host.textContent).toContain("Ver matiz en la frase");
      expect(host.textContent).toContain("Ficha");
    });

    it("resuelve definición asíncrona local si no está en memoria", async () => {
      const efimeroHit: WordHit = {
        word: "efímero",
        context: "Un deleite efímero.",
      };
      const selButton: ReaderSelectionButton = {
        x: 100,
        y: 120,
        placement: "top",
        singleWordHit: efimeroHit,
      };

      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton }));
      });

      // Dar tiempo para que resuelva la promesa local
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(host.textContent).toContain("Pasajero, de corta duración.");
    });

    it("el botón 'Ver matiz en la frase' invoca askCatAboutSelection con el contexto y cierra la píldora", async () => {
      const selButton: ReaderSelectionButton = {
        x: 150,
        y: 200,
        placement: "bottom",
        singleWordHit: baseHit,
      };

      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton }));
      });

      const catBtn = host.querySelector<HTMLButtonElement>(".reader__word-pill-btn-cat");
      expect(catBtn).not.toBeNull();
      await act(async () => {
        catBtn?.click();
      });

      expect(defaultProps.setSelButton).toHaveBeenCalledWith(null);
      expect(defaultProps.askCatAboutSelection).toHaveBeenCalledWith({
        word: "ataraxia",
        passage: "Buscaba la ataraxia del alma.",
      });
    });

    it("el botón 'Ficha' invoca openSelection con el hit", async () => {
      const selButton: ReaderSelectionButton = {
        x: 150,
        y: 200,
        placement: "bottom",
        singleWordHit: baseHit,
      };

      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton }));
      });

      const fichaBtn = host.querySelector<HTMLButtonElement>(".reader__word-pill-btn-define");
      expect(fichaBtn).not.toBeNull();
      await act(async () => {
        fichaBtn?.click();
      });

      expect(defaultProps.setSelButton).toHaveBeenCalledWith(null);
      expect(defaultProps.openSelection).toHaveBeenCalledWith(baseHit);
    });

    it("se auto-descarta al hacer pointerdown fuera de la píldora", async () => {
      const selButton: ReaderSelectionButton = {
        x: 150,
        y: 200,
        placement: "bottom",
        singleWordHit: baseHit,
      };

      const outside = document.createElement("div");
      outside.textContent = "Texto del libro";
      document.body.appendChild(outside);

      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton }));
      });

      await act(async () => {
        const evt = new PointerEvent("pointerdown", { bubbles: true });
        outside.dispatchEvent(evt);
      });

      expect(defaultProps.setSelButton).toHaveBeenCalledWith(null);
      outside.remove();
    });
  });

  describe("Etapa 2: Barra de pasajes para frases (>1 palabra)", () => {
    it("renderiza la barra de pasajes con las acciones completas", async () => {
      const selButton: ReaderSelectionButton = {
        x: 200,
        y: 300,
        placement: "bottom",
        singleWordHit: null,
      };

      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton }));
      });

      expect(host.querySelector(".reader__passage-bar")).not.toBeNull();
      expect(host.textContent).toContain("Tinta");
      expect(host.textContent).toContain("Reflexión");
      expect(host.textContent).toContain("Postal");
      expect(host.textContent).toContain("Preguntar");
    });

    it("el botón Preguntar dispara askCatAboutSelection", async () => {
      const selButton: ReaderSelectionButton = {
        x: 200,
        y: 300,
        placement: "bottom",
        singleWordHit: null,
      };

      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton }));
      });

      const askBtn = host.querySelector<HTMLButtonElement>(".selection-ask-cat");
      expect(askBtn).not.toBeNull();
      await act(async () => {
        askBtn?.click();
      });

      expect(defaultProps.askCatAboutSelection).toHaveBeenCalled();
    });
  });
});
