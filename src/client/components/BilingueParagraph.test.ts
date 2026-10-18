// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BilingueParagraph } from "./BilingueParagraph";

// @ts-expect-error test act environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("BilingueParagraph", () => {
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
  });

  it("despliega la traducción al hacer doble toque en un libro en inglés", async () => {
    const fetchMock = vi.fn().mockResolvedValue("El sol salía sobre el horizonte.");

    await act(async () => {
      root.render(
        h(BilingueParagraph, {
          originalText: "The sun was rising over the horizon.",
          bookLanguage: "en",
          fetchParagraphTranslation: fetchMock,
        }),
      );
    });

    const p = host.querySelector<HTMLParagraphElement>(".reader-text-paragraph");
    expect(p).not.toBeNull();
    expect(host.textContent).toContain("The sun was rising over the horizon.");
    expect(host.querySelector(".paragraph-inline-translation")).toBeNull();

    // Disparar doble clic (doble toque)
    await act(async () => {
      p?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledWith("The sun was rising over the horizon.");
    expect(host.querySelector(".paragraph-inline-translation")).not.toBeNull();
    expect(host.textContent).toContain("El sol salía sobre el horizonte.");

    // Segundo doble clic oculta la traducción
    await act(async () => {
      p?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(host.querySelector(".paragraph-inline-translation")).toBeNull();
  });

  it("no traduce si el libro ya está en español (bookLanguage === 'es')", async () => {
    const fetchMock = vi.fn();

    await act(async () => {
      root.render(
        h(BilingueParagraph, {
          originalText: "El sol salía sobre el horizonte.",
          bookLanguage: "es",
          fetchParagraphTranslation: fetchMock,
        }),
      );
    });

    const p = host.querySelector<HTMLParagraphElement>(".reader-text-paragraph");
    await act(async () => {
      p?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("Fase 2: escalado progresivo en 3 niveles y controles cero fricción", () => {
    it("renderiza Nivel 1 con micro-glosas y botón para destrabe de cláusula", async () => {
      await act(async () => {
        root.render(
          h(BilingueParagraph, {
            originalText: "They took it for granted that peace was at stake.",
            inlineGlosses: [
              { surface: "took it for granted", gloss: "dar por sentado" },
              { surface: "at stake", gloss: "en juego" },
            ],
            difficultClauseOriginal: "that peace was at stake",
            difficultClauseTranslation: "que la paz estaba en juego",
            translatedText: "Dieron por sentado que la paz estaba en juego.",
            initialTier: 1,
          }),
        );
      });

      const rootDiv = host.querySelector<HTMLDivElement>(".lecta-bilingue");
      expect(rootDiv?.getAttribute("data-tier")).toBe("1");

      const chips = host.querySelectorAll(".lecta-bilingue__gloss-chip");
      expect(chips.length).toBe(2);
      expect(chips[0].textContent).toContain("took it for granted: dar por sentado");
      expect(chips[1].textContent).toContain("at stake: en juego");

      // Botón de Nivel 2 disponible
      const stepBtn = host.querySelector<HTMLButtonElement>(".lecta-bilingue__step-btn");
      expect(stepBtn?.textContent).toBe("Destrabar frase clave");
    });

    it("escala a Nivel 2 al pulsar 'Destrabar frase clave' y notifica onTierEscalated", async () => {
      const onEscalate = vi.fn();

      await act(async () => {
        root.render(
          h(BilingueParagraph, {
            originalText: "They took it for granted that peace was at stake.",
            difficultClauseOriginal: "that peace was at stake",
            difficultClauseTranslation: "que la paz estaba en juego",
            translatedText: "Dieron por sentado que la paz estaba en juego.",
            initialTier: 1,
            onTierEscalated: onEscalate,
          }),
        );
      });

      const stepBtn = Array.from(
        host.querySelectorAll<HTMLButtonElement>(".lecta-bilingue__step-btn"),
      ).find((b) => b.textContent?.includes("Destrabar frase clave"));
      expect(stepBtn).not.toBeUndefined();

      await act(async () => {
        stepBtn?.click();
      });

      expect(onEscalate).toHaveBeenCalledTimes(1);

      const clauseBox = host.querySelector(".lecta-bilingue__clause-box");
      expect(clauseBox).not.toBeNull();
      expect(clauseBox?.textContent).toContain("«that peace was at stake» → ");
      expect(clauseBox?.textContent).toContain("que la paz estaba en juego");
    });

    it("escala a Nivel 3 para desplegar la traducción completa del párrafo", async () => {
      const onEscalate = vi.fn();

      await act(async () => {
        root.render(
          h(BilingueParagraph, {
            originalText: "The winter night was dark and quiet.",
            translatedText: "La noche de invierno era oscura y tranquila.",
            initialTier: 1,
            onTierEscalated: onEscalate,
          }),
        );
      });

      const fullTransBtn = Array.from(
        host.querySelectorAll<HTMLButtonElement>(".lecta-bilingue__step-btn"),
      ).find((b) => b.textContent?.includes("Ver párrafo traducido"));
      expect(fullTransBtn).not.toBeUndefined();

      await act(async () => {
        fullTransBtn?.click();
      });

      expect(onEscalate).toHaveBeenCalledTimes(1);
      const transP = host.querySelector(".lecta-bilingue__translation");
      expect(transP?.textContent).toContain("La noche de invierno era oscura y tranquila.");

      // Botón cambia a "Ocultar traducción" y al pulsarlo vuelve a Nivel 1
      const hideBtn = host.querySelector<HTMLButtonElement>(".lecta-bilingue__step-btn");
      expect(hideBtn?.textContent).toBe("Ocultar traducción");

      await act(async () => {
        hideBtn?.click();
      });

      expect(host.querySelector(".lecta-bilingue__translation")).toBeNull();
    });

    it("menú de opciones ⋯ permite silenciar por libro o desactivar modo bilingüe en 1 clic", async () => {
      const onMuteBook = vi.fn();
      const onDisable = vi.fn();

      await act(async () => {
        root.render(
          h(BilingueParagraph, {
            bookId: "book-abc",
            originalText: "Some text to test preferences menu.",
            translatedText: "Texto de prueba para menú de preferencias.",
            onMuteForBook: onMuteBook,
            onDisableBilingual: onDisable,
          }),
        );
      });

      const trigger = host.querySelector<HTMLButtonElement>(".lecta-bilingue__prefs-trigger");
      expect(trigger).not.toBeNull();
      expect(host.querySelector(".lecta-bilingue__prefs-menu")).toBeNull();

      // Abrir menú
      await act(async () => {
        trigger?.click();
      });

      const menu = host.querySelector(".lecta-bilingue__prefs-menu");
      expect(menu).not.toBeNull();

      const menuButtons = host.querySelectorAll<HTMLButtonElement>(
        ".lecta-bilingue__prefs-menu button",
      );
      expect(menuButtons.length).toBe(2);
      expect(menuButtons[0].textContent).toBe("Desactivar ayuda bilingüe en este libro");
      expect(menuButtons[1].textContent).toBe("Desactivar modo bilingüe siempre");

      // Pulsar silenciar para este libro
      await act(async () => {
        menuButtons[0].click();
      });

      expect(onMuteBook).toHaveBeenCalledWith("book-abc");
      // Al desactivarse, queda solo el párrafo original plano sin toolbar
      expect(host.querySelector(".lecta-bilingue__toolbar")).toBeNull();
      expect(host.querySelector(".lecta-bilingue__original")?.textContent).toBe(
        "Some text to test preferences menu.",
      );
    });

    it("cuando initialTier === 'off' se renderiza inmediatamente sin barras ni botones", async () => {
      await act(async () => {
        root.render(
          h(BilingueParagraph, {
            originalText: "Completely raw text without scaffolding.",
            initialTier: "off",
          }),
        );
      });

      expect(host.querySelector(".lecta-bilingue")).toBeNull();
      expect(host.querySelector(".lecta-bilingue__toolbar")).toBeNull();
      expect(host.textContent).toBe("Completely raw text without scaffolding.");
    });
  });
});

