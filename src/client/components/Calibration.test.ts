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

// Render + hidratación del borrador dentro de un solo act asíncrono:
// loadSessionValue resuelve en varias vueltas de la cola de
// microtareas y sus setState deben ocurrir dentro del mismo act.
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
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) =>
  act(() => {
    button(label).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
const choice = (lemma: string, label: "La conozco" | "No la conozco") => {
  const group = host.querySelector(`[aria-label="Respuesta para ${lemma}"]`)!;
  return [...group.querySelectorAll("button")].find((b) => b.textContent === label)!;
};

describe("Calibration", () => {
  it("muestra seis palabras por paso con su progreso", async () => {
    await render();
    expect(text()).toContain("Paso 1 de 3");
    expect(text()).toContain("palabra1");
    expect(text()).toContain("palabra6");
    expect(text()).not.toContain("palabra7");
  });

  it("Siguiente y Atrás recorren los pasos sin perder respuestas", async () => {
    await render();
    act(() => {
      choice("palabra1", "No la conozco").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    click("Siguiente");
    expect(text()).toContain("Paso 2 de 3");
    expect(text()).toContain("palabra7");
    expect(text()).toContain("1 respondida(s)");
    expect(text()).toContain("1 irán a tu Cuaderno");
    click("Atrás");
    expect(text()).toContain("Paso 1 de 3");
    expect(choice("palabra1", "No la conozco").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("cada cambio persiste el borrador v2 con muestra y paso", async () => {
    await render();
    act(() => {
      choice("palabra2", "La conozco").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const saved = saveMock.mock.calls.at(-1);
    expect(saved?.[0]).toBe(CALIBRATION_DRAFT_KEY);
    const draft = JSON.parse(String(saved?.[1]));
    expect(draft.v).toBe(2);
    expect(draft.answers).toEqual({ palabra2: "known" });
    expect(draft.words).toHaveLength(18);
  });

  it("un borrador v2 restaura la misma muestra y el paso", async () => {
    const draftWords = sample.slice(0, 12).map((word, i) => ({
      lemma: `borrador${i}`,
      definition: word.definition,
    }));
    loadMock.mockResolvedValueOnce(
      serializeCalibrationDraft({
        answers: { borrador0: "unknown" },
        step: 1,
        words: draftWords,
      }),
    );
    await render();
    // La muestra del borrador sustituye a la recién descargada.
    expect(text()).toContain("borrador6");
    expect(text()).not.toContain("palabra1");
    expect(text()).toContain("Paso 2 de 2");
    // La primera página (borrador0-5) todavía no está renderizada.
    expect(
      host.querySelector('[aria-label="Respuesta para borrador0"]'),
    ).toBeNull();
    click("Atrás");
    expect(choice("borrador0", "No la conozco").getAttribute("aria-pressed")).toBe(
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
    // El borrador tarda en llegar: el lector ya respondió cuando la
    // promesa del almacén resuelve — sus respuestas y la muestra nueva
    // quedan, no las del borrador.
    let resolveDraft: (raw: string | null) => void = () => {};
    loadMock.mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolveDraft = resolve;
      }),
    );
    await render();
    act(() => {
      choice("palabra1", "La conozco").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const draftWords = sample.map((word, i) => ({
      lemma: `tardia${i}`,
      definition: word.definition,
    }));
    await act(async () => {
      resolveDraft(
        serializeCalibrationDraft({
          answers: { tardia0: "unknown" },
          step: 1,
          words: draftWords,
        }),
      );
      await Promise.resolve();
    });
    // Sigue la muestra descargada y la respuesta del lector.
    expect(text()).toContain("palabra1");
    expect(text()).not.toContain("tardia0");
    expect(choice("palabra1", "La conozco").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("Listo con fallo de guardado avisa, no marca ni borra el borrador", async () => {
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
    // Nunca se limpió el borrador: sigue para el reintento.
    expect(
      saveMock.mock.calls.every((call) => call[1] !== ""),
    ).toBe(true);
    // Y puede reintentar: el botón vuelve a estar habilitado.
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

  it("elegir 'Español (lengua materna)' guarda confirmación y arranca calibración", async () => {
    localStorage.removeItem("lecta:nativeLanguageConfirmed");
    localStorage.removeItem("lecta:nativeLanguage");
    await render();
    expect(text()).toContain("¿Cuál es tu lengua materna?");
    const nativeBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Español (lengua materna)"),
    )!;
    await act(async () => {
      nativeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localStorage.getItem("lecta:nativeLanguageConfirmed")).toBe("1");
    expect(text()).toContain("Paso 1 de 3");
  });

  it("elegir 'Otro idioma' guarda la preferencia como no nativo y arranca calibración", async () => {
    localStorage.removeItem("lecta:nativeLanguageConfirmed");
    localStorage.removeItem("lecta:nativeLanguage");
    await render();
    const learnerBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Otro idioma"),
    )!;
    await act(async () => {
      learnerBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localStorage.getItem("lecta:nativeLanguageConfirmed")).toBe("1");
    expect(localStorage.getItem("lecta:nativeLanguage")).toBe("other");
    expect(text()).toContain("Paso 1 de 3");
  });

  it("saltar en la pregunta de lengua materna cierra la calibración", async () => {
    const onDone = vi.fn();
    localStorage.removeItem("lecta:nativeLanguageConfirmed");
    await render({ onDone });
    const skipBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Saltar prueba"),
    )!;
    await act(async () => {
      skipBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onDone).toHaveBeenCalled();
  });
});
