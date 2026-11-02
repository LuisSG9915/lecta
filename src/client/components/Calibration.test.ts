// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Calibration, { type CalibrationProps } from "./Calibration";
import {
  needsLanguageCalibration,
} from "../lib/calibration";
import { loadUserLanguageProfile } from "../lib/profile-models";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
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

const render = (props: Partial<CalibrationProps> = {}) =>
  act(async () => {
    root.render(
      h(Calibration, {
        onDone: props.onDone ?? vi.fn(),
        onClose: props.onClose,
        onComplete: props.onComplete,
        language: props.language ?? "es",
        words: props.words,
        hasPendingBook: props.hasPendingBook,
      }),
    );
    await Promise.resolve();
  });

// Responde «Sí la conozco» hasta que la sesión adaptativa termine
// (el botón desaparece al entrar la pantalla de resultado).
const answerAll = () => {
  for (let i = 0; i < 12; i++) {
    const yesBtn = button("Sí la conozco");
    if (!yesBtn) break;
    act(() => {
      yesBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  }
};

const text = () => host.textContent ?? "";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().includes(label),
  );

const click = (label: string) =>
  act(() => {
    const btn = button(label);
    if (!btn) throw new Error(`Button with label "${label}" not found`);
    btn.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });

describe("Calibration (CAT 15-Segundos Zero-Friction)", () => {
  it("muestra una sola palabra a la vez con tipografía destacada y su pregunta contextual", async () => {
    await render();

    // Cabecera ligera y badge de contexto
    expect(text()).toContain("Ajuste rápido · Español (15 s)");
    expect(button("Saltar e ir al libro →")).toBeTruthy();

    // Tarjeta central de palabra única (en theta = 0 es 'aflicción')
    const wordTitle = host.querySelector(".cat-word-title");
    expect(wordTitle).toBeTruthy();
    expect(wordTitle?.textContent?.trim()).toBe("aflicción");
    expect(text()).toContain("¿Reconoces qué significa esta palabra al leer?");

    // Dos botones táctiles grandes
    expect(button("No estoy seguro")).toBeTruthy();
    expect(button("Sí la conozco")).toBeTruthy();

    // Puntos de progreso presentes (8 puntos)
    const dots = host.querySelectorAll(".cat-progress-dot");
    expect(dots.length).toBe(8);
    expect(dots[0].classList.contains("is-active")).toBe(true);
  });

  it("hacer clic en «Sí la conozco» avanza a la siguiente palabra vía CAT", async () => {
    await render();

    const firstWord = host.querySelector(".cat-word-title")?.textContent;
    expect(firstWord).toBe("aflicción");

    click("Sí la conozco");

    const secondWord = host.querySelector(".cat-word-title")?.textContent;
    expect(secondWord).toBeTruthy();
    expect(secondWord).not.toBe(firstWord);

    // El primer punto ahora está completado y el segundo activo
    const dots = host.querySelectorAll(".cat-progress-dot");
    expect(dots[0].classList.contains("is-completed")).toBe(true);
    expect(dots[1].classList.contains("is-active")).toBe(true);
  });

  it("hacer clic en «No estoy seguro» avanza a una palabra de menor dificultad", async () => {
    await render();

    click("No estoy seguro");

    const secondWord = host.querySelector(".cat-word-title")?.textContent;
    expect(secondWord).toBeTruthy();
    expect(secondWord).not.toBe("aflicción");

    const dots = host.querySelectorAll(".cat-progress-dot");
    expect(dots[0].classList.contains("is-completed")).toBe(true);
    expect(dots[1].classList.contains("is-active")).toBe(true);
  });

  it("al terminar muestra la pantalla de resultado y espera el toque en «Listo»", async () => {
    const onDone = vi.fn();
    const onComplete = vi.fn();

    await render({ onDone, onComplete });
    answerAll();

    // Pantalla de resultado con nivel entendible, sin jerga técnica
    expect(text()).toContain("Español listo · Nivel estimado:");
    expect(text()).toContain(
      "Lecta ajustará las ayudas de cada capítulo a tu nivel.",
    );

    // onComplete se dispara al terminar; la hoja NO se cierra sola
    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0] as {
      theta: number;
      history: { word: string; known: boolean }[];
    };
    expect(typeof result.theta).toBe("number");
    expect(result.history.length).toBeGreaterThanOrEqual(6);
    expect(result.history.every((r) => typeof r.known === "boolean")).toBe(true);
    expect(onDone).not.toHaveBeenCalled();

    click("Listo");
    expect(onDone).toHaveBeenCalledTimes(1);

    // El perfil de idioma fue actualizado
    const profile = loadUserLanguageProfile();
    expect(profile.thetaByLang?.es).toBeDefined();
  });

  it("con un libro esperando el botón dice «Continuar al libro →» y Escape cierra igual", async () => {
    const onDone = vi.fn();

    await render({ onDone, hasPendingBook: true });
    answerAll();

    expect(text()).toContain("Nivel estimado:");
    expect(button("Continuar al libro →")).toBeTruthy();
    expect(button("Listo")).toBeFalsy();
    expect(onDone).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("el botón «Saltar e ir al libro →» cierra la prueba en 1 toque y respeta Zero-Friction", async () => {
    const onDone = vi.fn();
    const onClose = vi.fn();

    await render({ onDone, onClose, language: "es" });

    click("Saltar e ir al libro →");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(needsLanguageCalibration("es")).toBe(false);
  });

  it("responde a los atajos de teclado ArrowLeft/1, ArrowRight/2 y Escape", async () => {
    const onClose = vi.fn();
    await render({ onClose });

    const firstWord = host.querySelector(".cat-word-title")?.textContent;

    // Tecla 2 -> 'Sí la conozco'
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    });
    const secondWord = host.querySelector(".cat-word-title")?.textContent;
    expect(secondWord).not.toBe(firstWord);

    // Tecla ArrowLeft -> 'No estoy seguro'
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    const thirdWord = host.querySelector(".cat-word-title")?.textContent;
    expect(thirdWord).not.toBe(secondWord);

    // Tecla Escape -> Saltar
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("soporta calibración para idioma inglés (en) con banco en inglés", async () => {
    await render({ language: "en" });

    expect(text()).toContain("Ajuste rápido · Inglés (15 s)");
    // En inglés, el primer ítem en theta = 0 es 'bargain'
    const wordTitle = host.querySelector(".cat-word-title");
    expect(wordTitle?.textContent?.trim()).toBe("bargain");

    click("Sí la conozco");
    const nextWord = host.querySelector(".cat-word-title")?.textContent;
    expect(nextWord).toBeTruthy();
    expect(nextWord).not.toBe("bargain");
  });
});
