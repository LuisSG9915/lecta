// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderSelectionBar, type ReaderSelectionButton } from "./ReaderSelectionBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("ReaderSelectionBar", () => {
  let host: HTMLDivElement;
  let root: Root;

  const defaultProps = {
    setSelButton: vi.fn(),
    savePassageSelection: vi.fn(),
    openQuoteCardFromSelection: vi.fn(),
    askCatAboutSelection: vi.fn(),
    setDeepModal: vi.fn(),
  };

  const passageButton: ReaderSelectionButton = {
    x: 200,
    y: 300,
    placement: "bottom",
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

  describe("Barra de pasajes para frases (>1 palabra)", () => {
    it("renderiza la barra de pasajes con las acciones completas", async () => {
      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton: passageButton }));
      });

      expect(host.querySelector(".reader__passage-bar")).not.toBeNull();
      expect(host.querySelector(".selection-menu--word")).toBeNull();
      expect(host.textContent).toContain("Tinta");
      expect(host.textContent).toContain("Reflexión");
      expect(host.textContent).toContain("Postal");
      expect(host.textContent).toContain("Preguntar");
    });

    it("el botón Preguntar dispara askCatAboutSelection", async () => {
      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton: passageButton }));
      });

      const askBtn = host.querySelector<HTMLButtonElement>(".selection-ask-cat");
      expect(askBtn).not.toBeNull();
      await act(async () => {
        askBtn?.click();
      });

      expect(defaultProps.askCatAboutSelection).toHaveBeenCalled();
    });

    it("el botón Reflexión limpia la selección, cierra la barra y abre el modal profundo", async () => {
      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton: passageButton }));
      });

      const deepBtn = host.querySelector<HTMLButtonElement>(".selection-deep");
      expect(deepBtn).not.toBeNull();
      await act(async () => {
        deepBtn?.click();
      });

      expect(defaultProps.setSelButton).toHaveBeenCalledWith(null);
      expect(defaultProps.setDeepModal).toHaveBeenCalledWith(true);
    });

    it("se auto-descarta al hacer pointerdown fuera de la barra", async () => {
      const outside = document.createElement("div");
      outside.textContent = "Texto del libro";
      document.body.appendChild(outside);

      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton: passageButton }));
      });

      await act(async () => {
        const evt = new PointerEvent("pointerdown", { bubbles: true });
        outside.dispatchEvent(evt);
      });

      expect(defaultProps.setSelButton).toHaveBeenCalledWith(null);
      outside.remove();
    });

    it("los puntos de tono guardan el pasaje con su tinta", async () => {
      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton: passageButton }));
      });

      const salvia = host.querySelector<HTMLButtonElement>(".tone-dot--salvia");
      expect(salvia).not.toBeNull();
      await act(async () => {
        salvia?.click();
      });

      expect(defaultProps.savePassageSelection).toHaveBeenCalledWith("salvia");
    });
  });

  describe("Mini menú de una palabra (táctil)", () => {
    const hit = { word: "perenne" } as unknown as ReaderSelectionButton["word"];
    const wordButton: ReaderSelectionButton = {
      x: 200,
      y: 300,
      placement: "bottom",
      word: hit,
    };

    it("pinta solo Significado, Tinta y Copiar", async () => {
      await act(async () => {
        root.render(
          h(ReaderSelectionBar, {
            ...defaultProps,
            selButton: wordButton,
            onDefine: vi.fn(),
          }),
        );
      });

      expect(host.querySelector(".selection-menu--word")).not.toBeNull();
      expect(host.querySelectorAll(".selection-menu button")).toHaveLength(3);
      expect(host.querySelector(".selection-define")).not.toBeNull();
      expect(host.querySelector(".selection-save")).not.toBeNull();
      expect(host.querySelector(".selection-copy")).not.toBeNull();
      for (const sel of [".tone-dot", ".selection-deep", ".selection-card", ".selection-ask-cat"]) {
        expect(host.querySelector(sel)).toBeNull();
      }
    });

    it("Tinta guarda en ámbar", async () => {
      await act(async () => {
        root.render(
          h(ReaderSelectionBar, {
            ...defaultProps,
            selButton: wordButton,
            onDefine: vi.fn(),
          }),
        );
      });

      await act(async () => {
        host.querySelector<HTMLButtonElement>(".selection-save")?.click();
      });

      expect(defaultProps.savePassageSelection).toHaveBeenCalledWith("amber");
    });

    it("Significado cierra el menú y llama a onDefine con la palabra", async () => {
      const onDefine = vi.fn();
      await act(async () => {
        root.render(
          h(ReaderSelectionBar, { ...defaultProps, selButton: wordButton, onDefine }),
        );
      });

      await act(async () => {
        host.querySelector<HTMLButtonElement>(".selection-define")?.click();
      });

      expect(defaultProps.setSelButton).toHaveBeenCalledWith(null);
      expect(onDefine).toHaveBeenCalledWith(hit);
    });

    it("sin onDefine cae a la barra completa", async () => {
      await act(async () => {
        root.render(h(ReaderSelectionBar, { ...defaultProps, selButton: wordButton }));
      });

      expect(host.querySelector(".selection-menu--word")).toBeNull();
      expect(host.querySelector(".tone-dot--salvia")).not.toBeNull();
    });
  });
});
