// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResumeSessionOverlay, {
  extractLastSentences,
  formatSceneRecapOneLine,
} from "./ResumeSessionOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ResumeSessionOverlay", () => {
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

  it("extrae las últimas N oraciones correctamente", () => {
    const text =
      "Había una vez en un bosque lejano. Los árboles cantaban con el viento. La luna brillaba con fuerza. Todo era calma y serenidad.";
    const lastTwo = extractLastSentences(text, 2);
    expect(lastTwo).toBe("La luna brillaba con fuerza. Todo era calma y serenidad.");

    expect(extractLastSentences("")).toBe("");
  });

  it("formatea el recap de 1 línea a partir de los personajes en escena", () => {
    const recapWithChars = {
      lastReadSnippet: "test",
      activeCharactersInScene: ["Dante", "Virgilio"],
      hoursSinceLastRead: 50,
      shouldShowAutomatically: true,
    };
    expect(formatSceneRecapOneLine(recapWithChars)).toBe(
      "En escena con Dante, Virgilio."
    );

    const recapEmpty = {
      lastReadSnippet: "test",
      activeCharactersInScene: [],
      hoursSinceLastRead: 50,
      shouldShowAutomatically: true,
    };
    expect(formatSceneRecapOneLine(recapEmpty)).toBe(
      "Retomando el hilo de la historia donde lo dejaste."
    );
  });

  it("renderiza el contenido básico: recap, extracto y botón primario 'Retomar lectura'", () => {
    const onResume = vi.fn();
    act(() => {
      root.render(
        h(ResumeSessionOverlay, {
          recapLine: "En escena con Alicia.",
          lastReadSentences: "El conejo blanco miró su reloj. Se hacía tarde.",
          hasPendingReviewsDosing: false,
          onResumeReading: onResume,
        })
      );
    });

    expect(container.textContent).toContain("En escena con Alicia.");
    expect(container.textContent).toContain(
      "«El conejo blanco miró su reloj. Se hacía tarde.»"
    );
    expect(container.textContent).toContain("Retomar lectura");
    expect(container.textContent).not.toContain("Dosificar repasos pendientes");

    const button = container.querySelector("button");
    act(() => {
      button?.click();
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("muestra el toggle pre-activado de dosificación cuando hasPendingReviewsDosing es true", () => {
    const onToggle = vi.fn();
    act(() => {
      root.render(
        h(ResumeSessionOverlay, {
          recapLine: "En escena con Alicia.",
          lastReadSentences: "El conejo blanco miró su reloj.",
          hasPendingReviewsDosing: true,
          onResumeReading: vi.fn(),
          onToggleDoseReviews: onToggle,
        })
      );
    });

    expect(container.textContent).toContain(
      "Dosificar repasos pendientes (3/día) para ir directo a la historia"
    );

    const checkbox = container.querySelector(
      "input[type='checkbox']"
    ) as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(true);

    act(() => {
      checkbox?.click();
    });
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});

describe("ResumeSessionOverlay «¿Quién era…?»", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.resetModules();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.doUnmock("../lib/lexicon");
    vi.resetModules();
  });

  async function mount(result: unknown) {
    const request = vi.fn().mockResolvedValue(result);
    vi.doMock("../lib/lexicon", () => ({ requestCharacterRecap: request }));
    const mod = await import("./ResumeSessionOverlay");
    act(() => {
      root.render(
        h(mod.default, {
          recapLine: "En escena con Dante.",
          lastReadSentences: "Dante miró a Virgilio.",
          onResumeReading: vi.fn(),
          characters: ["Dante", "Virgilio"],
          bookTitle: "Comedia",
        }),
      );
    });
    return request;
  }
  const nameBtn = () =>
    container.querySelector(".resume-session-who-name") as HTMLButtonElement;

  it("no llama a la red al montar; llama una vez al tocar", async () => {
    const request = await mount({ ok: true, summary: "Poeta." });
    expect(request).not.toHaveBeenCalled();
    await act(async () => {
      nameBtn().click();
      nameBtn().click();
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Poeta.");
  });

  it("402 pinta PlanNote", async () => {
    await mount({ ok: false, error: "x", code: "LECTA_PLUS_REQUIRED" });
    await act(async () => {
      nameBtn().click();
    });
    expect(container.querySelector(".plan-note")).not.toBeNull();
  });

  it("si la red falla: avisa, deja reintentar y no anota el nombre", async () => {
    const request = await mount({ ok: false, error: "net" });
    await act(async () => {
      nameBtn().click();
    });
    expect(container.textContent).toContain("No pudimos cargar a Dante");
    expect(container.querySelector("[aria-live='polite']")).not.toBeNull();
    await act(async () => {
      nameBtn().click();
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
