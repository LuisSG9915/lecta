// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Calibration from "./Calibration";
import {
  CALIBRATION_DRAFT_KEY,
  recordCalibration,
  serializeCalibrationDraft,
  type CalibrationWord,
} from "../lib/calibration";
import { loadSessionValue, saveSessionValue } from "../lib/idb";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// El componente solo toca el almacén de sesión para el borrador; el
// guardado real (recordCalibration) se cubre en calibration.test.ts.
vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...mod,
    loadSessionValue: vi.fn(async () => null),
    saveSessionValue: vi.fn(async () => undefined),
  };
});
vi.mock("../lib/calibration", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/calibration")>();
  return {
    ...mod,
    recordCalibration: vi.fn(async () => ({ knowledge: [], words: [] })),
    fetchCalibrationSample: vi.fn(async (_lang, profile) => ({
      ok: true,
      profile: profile ?? "native",
      words: sample,
    })),
  };
});
vi.mock("../lib/reading-sync", () => ({
  pushKnowledgeToServer: vi.fn(async () => true),
}));
vi.mock("../lib/vocab", () => ({ pushWordsToServer: vi.fn(async () => true) }));

const loadMock = vi.mocked(loadSessionValue);
const saveMock = vi.mocked(saveSessionValue);
const recordMock = vi.mocked(recordCalibration);

const sample: CalibrationWord[] = Array.from({ length: 18 }, (_, i) => ({
  lemma: `palabra${i + 1}`,
  definition: `def ${i + 1}`,
  sampleContext: `Contexto ilustrativo para palabra${i + 1}`,
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("lecta:nativeLanguageConfirmed", "1");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  localStorage.clear();
});

// Render + hidratación del borrador dentro de un solo act asíncrono
const render = (over: { onDone?: () => void; onClose?: () => void } = {}) =>
  act(async () => {
    root.render(
      h(Calibration, {
        words: sample,
        onDone: over.onDone ?? vi.fn(),
        onClose: over.onClose ?? vi.fn(),
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const text = () => host.textContent ?? "";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label || b.textContent?.includes(label),
  )!;

const click = (label: string) =>
  act(() => {
    button(label).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });

const choice = (
  lemma: string,
  kind: "known" | "unknown" | "unsure" | "La conozco" | "No la conozco" | "No me suena" | "Me suena dudosa" | "La conozco bien",
) => {
  const group = host.querySelector(`[aria-label="Respuesta para ${lemma}"]`);
  if (!group) return null;
  const buttons = [...group.querySelectorAll("button")];
  if (kind === "known" || kind === "La conozco" || kind === "La conozco bien") {
    return buttons.find(
      (b) =>
        b.textContent?.includes("La conozco bien") ||
        b.textContent?.includes("La conozco") ||
        b.textContent?.includes("[3]"),
    )!;
  }
  if (kind === "unsure" || kind === "Me suena dudosa") {
    return buttons.find(
      (b) =>
        b.textContent?.includes("Me suena dudosa") ||
        b.textContent?.includes("dudosa") ||
        b.textContent?.includes("[2]"),
    )!;
  }
  if (kind === "unknown" || kind === "No la conozco" || kind === "No me suena") {
    return buttons.find(
      (b) =>
        b.textContent?.includes("No me suena") ||
        b.textContent?.includes("No la conozco") ||
        b.textContent?.includes("[1]"),
    )!;
  }
  return buttons.find((b) => b.textContent?.includes(kind))!;
};

describe("Calibration", () => {
  it("muestra una carta de tinta a la vez con su progreso adaptativo y contexto", async () => {
    await render();
    expect(text()).toContain("Etapa 1 de 3: Cartas de Tinta");
    expect(text()).toContain("Palabra 1 de 10");
    expect(text()).toContain("palabra1");
    expect(text()).toContain("Contexto ilustrativo para palabra1");
    expect(text()).toContain("[1]");
    expect(text()).toContain("No me suena");
    expect(text()).toContain("[2]");
    expect(text()).toContain("Me suena dudosa");
    expect(text()).toContain("[3]");
    expect(text()).toContain("La conozco bien");
    expect(text()).toContain("No es un examen");
  });

  it("responder avanza al siguiente ítem adaptativo y Atrás permite retroceder sin perder respuestas", async () => {
    await render();
    act(() => {
      choice("palabra1", "No me suena")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    // Avanzó a la palabra 2
    expect(text()).toContain("Palabra 2 de 10");
    expect(text()).toContain("1 palabra(s) respondida(s)");

    // Retroceder con Atrás
    click("Atrás");
    expect(text()).toContain("Palabra 1 de 10");
    expect(choice("palabra1", "No me suena")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("atajos de teclado 1, 2 y 3 registran respuestas de inmediato", async () => {
    await render();
    expect(text()).toContain("Palabra 1 de 10");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "3" }));
    });

    // Registró conocida y avanzó a la palabra 2
    expect(text()).toContain("Palabra 2 de 10");
    expect(text()).toContain("1 palabra(s) respondida(s)");
  });

  it("cada cambio persiste el borrador v2 con respuestas y muestra", async () => {
    await render();
    act(() => {
      choice("palabra1", "La conozco bien")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const saved = saveMock.mock.calls.at(-1);
    expect(saved?.[0]).toBe(CALIBRATION_DRAFT_KEY);
    const draft = JSON.parse(String(saved?.[1]));
    expect(draft.v).toBe(2);
    expect(draft.answers).toEqual({ palabra1: "known" });
    expect(draft.words).toHaveLength(18);
  });

  it("un borrador v2 restaura las respuestas y el paso guardado", async () => {
    const draftWords = sample.slice(0, 12).map((word, i) => ({
      lemma: `borrador${i}`,
      definition: word.definition,
      sampleContext: word.sampleContext,
    }));
    loadMock.mockResolvedValueOnce(
      serializeCalibrationDraft({
        answers: { borrador0: "unknown" },
        step: 0,
        words: draftWords,
      }),
    );
    await render();
    // La muestra del borrador sustituye a la descargada
    expect(text()).toContain("borrador0");
    expect(text()).toContain("1 palabra(s) respondida(s)");
    expect(choice("borrador0", "No me suena")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("Saltar limpia el borrador y termina el flujo", async () => {
    const onDone = vi.fn();
    await render({ onDone });
    click("Saltar");
    expect(saveMock).toHaveBeenLastCalledWith(
      CALIBRATION_DRAFT_KEY,
      "",
      expect.anything(),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("una hidratación tardía no pisa una respuesta ni cambia la muestra", async () => {
    let resolveDraft: (raw: string | null) => void = () => {};
    loadMock.mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolveDraft = resolve;
      }),
    );
    await render();
    act(() => {
      choice("palabra1", "La conozco bien")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const draftWords = sample.map((word, i) => ({
      lemma: `tardia${i}`,
      definition: word.definition,
      sampleContext: word.sampleContext,
    }));
    await act(async () => {
      resolveDraft(
        serializeCalibrationDraft({
          answers: { tardia0: "unknown" },
          step: 0,
          words: draftWords,
        }),
      );
      await Promise.resolve();
    });
    // Se mantiene la muestra descargada y la respuesta del lector
    expect(text()).toContain("palabra");
    expect(text()).not.toContain("tardia0");
  });

  it("Listo con fallo de guardado avisa con alerta y no pierde el borrador", async () => {
    const onDone = vi.fn();
    recordMock.mockRejectedValueOnce(new Error("sin almacén"));
    await render({ onDone });
    await act(async () => {
      button("Listo").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(text()).toContain("No se pudieron guardar tus respuestas");
    expect(onDone).not.toHaveBeenCalled();
    // No se borró el borrador: sigue para el reintento
    expect(saveMock.mock.calls.every((call) => call[1] !== "")).toBe(true);
    // Y el botón vuelve a estar habilitado
    expect(button("Listo").disabled).toBe(false);
  });

  it("Cerrar sale sin escribir ni limpiar el borrador", async () => {
    const onClose = vi.fn();
    const onDone = vi.fn();
    await render({ onClose, onDone });
    click("Cerrar");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
    expect(saveMock.mock.calls.every((call) => call[1] !== "")).toBe(true);
  });

  it("muestra la pregunta de lengua materna cuando no está confirmada", async () => {
    localStorage.removeItem("lecta:nativeLanguageConfirmed");
    localStorage.removeItem("lecta:nativeLanguage");
    await render();
    expect(text()).toContain("¿Cuál es tu lengua materna?");
    expect(text()).toContain("Español (lengua materna)");
    expect(text()).toContain("Otro idioma (estudiante de español)");
  });

  it("elegir 'Español (lengua materna)' guarda confirmación y arranca calibración en Etapa 1", async () => {
    localStorage.removeItem("lecta:nativeLanguageConfirmed");
    localStorage.removeItem("lecta:nativeLanguage");
    await render();
    expect(text()).toContain("¿Cuál es tu lengua materna?");
    const nativeBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Español (lengua materna)"),
    )!;
    await act(async () => {
      nativeBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localStorage.getItem("lecta:nativeLanguageConfirmed")).toBe("1");
    expect(text()).toContain("Etapa 1 de 3: Cartas de Tinta");
    expect(text()).toContain("Palabra 1 de 10");
  });

  it("elegir 'Otro idioma' guarda la preferencia como no nativo y arranca calibración en Etapa 1", async () => {
    localStorage.removeItem("lecta:nativeLanguageConfirmed");
    localStorage.removeItem("lecta:nativeLanguage");
    await render();
    const learnerBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Otro idioma"),
    )!;
    await act(async () => {
      learnerBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localStorage.getItem("lecta:nativeLanguageConfirmed")).toBe("1");
    expect(localStorage.getItem("lecta:nativeLanguage")).toBe("other");
    expect(text()).toContain("Etapa 1 de 3: Cartas de Tinta");
    expect(text()).toContain("Palabra 1 de 10");
  });

  it("saltar en la pregunta de lengua materna cierra la calibración", async () => {
    const onDone = vi.fn();
    localStorage.removeItem("lecta:nativeLanguageConfirmed");
    await render({ onDone });
    const skipBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Saltar prueba"),
    )!;
    await act(async () => {
      skipBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onDone).toHaveBeenCalled();
  });

  it("flujo completo a través de las 3 etapas: Cartas de Tinta -> Verificación -> Lente de lectura y perfil", async () => {
    const onDone = vi.fn();
    await render({ onDone });

    // Responder 10 palabras (algunas known para activar verificación)
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: i % 2 === 0 ? "3" : "2" }),
        );
        await Promise.resolve();
      });
    }

    // Debe haber avanzado a Etapa 2 (Verificación de precisión)
    expect(text()).toContain("Etapa 2 de 3: Verificación");
    expect(text()).toContain("Micro-reto anti-sobreconfianza");

    // Resolver las opciones de verificación
    const optionTiles = () => [...host.querySelectorAll(".cal-option-tile")];
    while (optionTiles().length > 0) {
      await act(async () => {
        optionTiles()[0].dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await Promise.resolve();
      });
    }

    // Debe haber avanzado a Etapa 3 (Tu Lente de Lectura)
    expect(text()).toContain("Etapa 3 de 3: Tu Lente de Lectura");
    expect(text()).toContain("Ajusta tu lente de lectura");
    expect(text()).toContain("Lectura Limpia");
    expect(text()).toContain("Enfoque de Párrafo");
    expect(text()).toContain("Líneas Sintácticas");

    // Seleccionar estrategia Líneas Sintácticas
    click("Líneas Sintácticas");
    expect(host.querySelector(".syn-line")).not.toBeNull();

    // Finalizar afinación y ver perfil
    click("Finalizar afinación y ver mi perfil");
    expect(text()).toContain("¡Perfil de Lector Listo!");
    expect(text()).toContain("Nivel de Vocabulario");
    expect(text()).toContain("Lente Inicial");
    expect(text()).toContain("Ritmo de Lectura");

    // Guardar definitivamente con Listo
    await act(async () => {
      button("Listo").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(recordMock).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
