// @vitest-environment jsdom
// Render del gato: jerarquía SVG, accesibilidad y que etapas, poses y
// ropa producen markup distinto. La máquina de estados de lectura se
// prueba aparte en Companion.test.ts — este archivo no la toca.

import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Companion } from "./Companion";
import { CompanionButton } from "./CompanionButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
  document.body.innerHTML = "";
});

const render = (node: ReactNode) => act(() => root.render(node));
const svg = () => host.querySelector("svg") as SVGSVGElement;

const base = { stage: 2, mood: "awake" as const, accessories: [] as string[] };

describe("Companion render", () => {
  it("renderiza svg con role=img y rótulo en español", () => {
    render(h(Companion, base));
    expect(svg().getAttribute("role")).toBe("img");
    expect(svg().getAttribute("aria-label")).toContain("gato");
    expect(svg().querySelector("title")?.textContent).toContain("gato");
  });

  it("decorative quita role/título y marca aria-hidden", () => {
    render(h(Companion, { ...base, decorative: true }));
    expect(svg().getAttribute("aria-hidden")).toBe("true");
    expect(svg().getAttribute("role")).toBeNull();
    expect(svg().getAttribute("aria-label")).toBeNull();
    expect(svg().querySelector("title")).toBeNull();
  });

  it("CompanionButton etiqueta el botón, oculta el svg y dispara onClick", () => {
    const onClick = vi.fn();
    render(
      h(CompanionButton, { ...base, label: "Ver a Michi", onClick }),
    );
    const btn = host.querySelector("button") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe("Ver a Michi");
    expect(btn.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(btn.querySelector("svg")?.getAttribute("role")).toBeNull();
    act(() => {
      btn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("etapa 0 y etapa 3 producen dibujos distintos", () => {
    render(h(Companion, { ...base, stage: 0 }));
    expect(svg().getAttribute("class")).toContain("cat--s0");
    const baby = svg().innerHTML;
    render(h(Companion, { ...base, stage: 3 }));
    expect(svg().getAttribute("class")).toContain("cat--s3");
    expect(svg().innerHTML).not.toBe(baby);
  });

  it("el bebé despierto tiene los ojos abiertos, no entrecerrados", () => {
    render(h(Companion, { ...base, stage: 0, mood: "awake" }));
    expect(svg().querySelector(".cat-eyes--open")).toBeTruthy();
    expect(svg().querySelector(".cat-eyes--half")).toBeNull();
    expect(svg().querySelector(".cat-eyes--sleep")).toBeNull();
  });

  it("dormido usa los ojos cerrados y mantiene las «z» pixel", () => {
    render(h(Companion, { ...base, mood: "asleep" }));
    expect(svg().querySelector(".cat-eyes--sleep")).toBeTruthy();
    expect(svg().querySelectorAll(".cat-z")).toHaveLength(3);
  });

  it("las cinco etapas generan geometría distinta y completa", async () => {
    const { STAGES } = await import("./companion-sprites");
    expect(STAGES).toHaveLength(5);
    for (const st of STAGES) {
      expect(st.head).toContain("M ");
      expect(st.body).toContain("M ");
      expect(st.eyesOpen).toHaveLength(2);
      expect(st.tail.d).toBeTruthy();
      expect(st.tail.w).toBeGreaterThan(0);
      expect(Object.keys(st.wear)).toEqual(
        expect.arrayContaining(["bufanda", "collar", "moño", "anteojos", "chaleco"]),
      );
    }
    // Las proporciones cambian de verdad: cabezas distintas.
    expect(new Set(STAGES.map((s) => s.head)).size).toBe(5);
  });

  it('pose="celebrate" agrega la clase cat--p-celebrate', () => {
    render(h(Companion, { ...base, pose: "celebrate" }));
    expect(svg().getAttribute("class")).toContain("cat--p-celebrate");
  });

  it("bufanda y collar juntos: solo se dibuja la bufanda", () => {
    render(h(Companion, { ...base, accessories: ["bufanda", "collar"] }));
    expect(svg().querySelector(".cat-wear--bufanda")).toBeTruthy();
    expect(svg().querySelector(".cat-wear--collar")).toBeNull();
  });

  it("un pelaje puesto cambia la clase de paleta sin rayas", () => {
    render(h(Companion, { ...base, accessories: ["pelaje-gris"] }));
    expect(svg().getAttribute("class")).toContain("cat--coat-gris");
    expect(svg().querySelector(".cat-marks")).toBeNull();
  });

  it("el pelaje atigrado enciende sus rayas", () => {
    render(h(Companion, { ...base, accessories: ["pelaje-atigrado"] }));
    expect(svg().getAttribute("class")).toContain("cat--coat-atigrado");
    const marks = svg().querySelector(".cat-marks");
    expect(marks).toBeTruthy();
    expect(marks!.getAttribute("d")).toContain("M ");
  });

  it("las rayas atigradas existen en las cinco etapas", async () => {
    const { STAGES } = await import("./companion-sprites");
    for (const st of STAGES) expect(st.marks.length).toBeGreaterThanOrEqual(5);
  });

  it("renderiza boina, capa, corbatín y monóculo en sus clases", () => {
    render(
      h(Companion, {
        ...base,
        accessories: ["boina", "capa", "corbatin", "monoculo"],
      }),
    );
    expect(svg().querySelector(".cat-wear--boina")).toBeTruthy();
    expect(svg().querySelector(".cat-wear--capa")).toBeTruthy();
    expect(svg().querySelector(".cat-wear--corbatin")).toBeTruthy();
    expect(svg().querySelector(".cat-wear--monoculo")).toBeTruthy();
  });

  it("el pelaje calicó enciende la clase y sus manchas", () => {
    render(h(Companion, { ...base, accessories: ["pelaje-calico"] }));
    expect(svg().getAttribute("class")).toContain("cat--coat-calico");
    const marks = svg().querySelector(".cat-marks");
    expect(marks).toBeTruthy();
  });

  it("el pelaje negro aplica la clase coat-negro", () => {
    render(h(Companion, { ...base, accessories: ["pelaje-negro"] }));
    expect(svg().getAttribute("class")).toContain("cat--coat-negro");
  });

  it("todas las nuevas prendas están generadas en las cinco etapas", async () => {
    const { STAGES } = await import("./companion-sprites");
    for (const st of STAGES) {
      expect(st.wear.boina?.length).toBeGreaterThan(0);
      expect(st.wear.capa?.length).toBeGreaterThan(0);
      expect(st.wear.corbatin?.length).toBeGreaterThan(0);
      expect(st.wear.monoculo?.length).toBeGreaterThan(0);
    }
  });

  it("el nombre propio aparece en el rótulo", () => {
    render(h(Companion, { ...base, name: "Michi" }));
    expect(svg().getAttribute("aria-label")).toContain("Michi");
  });
});
