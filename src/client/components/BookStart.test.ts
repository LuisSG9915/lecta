// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookStart, { type BookStartProps } from "./BookStart";
import type { ChapterTarget } from "../lib/chapters";

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

const target = (
  id: string,
  label: string,
  kind: ChapterTarget["kind"],
  depth = 0,
): ChapterTarget & { depth: number } => ({
  id,
  label,
  href: id,
  sectionIndex: 0,
  kind,
  depth,
});

const CHAPTERS = [
  target("cover.xhtml", "Portada", "preliminary"),
  target("intro.xhtml", "Introducción", "preliminary"),
  target("c1.xhtml", "Capítulo 1", "chapter"),
  target("c2.xhtml", "Capítulo 2", "chapter"),
];

const base = (over: Partial<BookStartProps> = {}): BookStartProps => ({
  targets: CHAPTERS,
  suggestedStartId: "c1.xhtml",
  firstChapterId: "c1.xhtml",
  onConfirm: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

const render = (props: BookStartProps) =>
  act(() => root.render(h(BookStart, props)));

const text = () => host.textContent ?? "";
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const radio = (labelText: string) =>
  [...host.querySelectorAll(".bookstart-option")].find((l) =>
    l.textContent?.includes(labelText),
  )!;
const selectValue = (el: HTMLSelectElement, value: string) =>
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

describe("BookStart", () => {
  it("iniciar con la sugerencia confirma ese destino para leer y preparar", () => {
    const props = base();
    render(props);
    click(button("Abrir"));
    expect(props.onConfirm).toHaveBeenCalledWith({
      readingTargetId: "c1.xhtml",
      preparationTargetId: "c1.xhtml",
    });
  });

  it("elegir un capítulo del índice cambia lectura y preparación", () => {
    const props = base();
    render(props);
    click(radio("Elegir otro lugar"));
    const select = host.querySelector("select") as HTMLSelectElement;
    selectValue(select, "c2.xhtml");
    click(button("Abrir"));
    expect(props.onConfirm).toHaveBeenCalledWith({
      readingTargetId: "c2.xhtml",
      preparationTargetId: "c2.xhtml",
    });
  });

  it("preliminar + primer capítulo confiable explica el destino a preparar", () => {
    const props = base();
    render(props);
    click(radio("Elegir otro lugar"));
    selectValue(host.querySelector("select") as HTMLSelectElement, "intro.xhtml");
    expect(text()).toContain("prepararemos las palabras de «Capítulo 1»");
    click(button("Abrir"));
    expect(props.onConfirm).toHaveBeenCalledWith({
      readingTargetId: "intro.xhtml",
      preparationTargetId: "c1.xhtml",
    });
  });

  it("preliminar sin capítulo confiable pide elegir qué preparar", () => {
    const props = base({ firstChapterId: null });
    render(props);
    click(radio("Elegir otro lugar"));
    const readingSel = host.querySelector("select") as HTMLSelectElement;
    selectValue(readingSel, "intro.xhtml");
    expect(text()).toContain("no marca cuál es el primero");
    // Sin elegir, no se puede avanzar con destino inexistente.
    expect((button("Abrir") as HTMLButtonElement).disabled).toBe(true);
    const prepSel = host.querySelectorAll("select")[1] as HTMLSelectElement;
    selectValue(prepSel, "c2.xhtml");
    click(button("Abrir"));
    expect(props.onConfirm).toHaveBeenCalledWith({
      readingTargetId: "intro.xhtml",
      preparationTargetId: "c2.xhtml",
    });
  });

  it("índice ambiguo (todo uncertain) permite elegir y confirmar igual", () => {
    const props = base({
      targets: [
        target("s1.xhtml", "I", "uncertain"),
        target("s2.xhtml", "II", "uncertain"),
        target("s3.xhtml", "III", "uncertain"),
      ],
      suggestedStartId: "s2.xhtml",
      firstChapterId: null,
    });
    render(props);
    click(button("Abrir"));
    expect(props.onConfirm).toHaveBeenCalledWith({
      readingTargetId: "s2.xhtml",
      preparationTargetId: "s2.xhtml",
    });
  });

  it("cerrar no confirma nada", () => {
    const props = base();
    render(props);
    click(button("Cerrar"));
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("etiquetas largas y profundidad del índice se conservan en el selector", () => {
    const long = "Capítulo veintitrés — un título innecesariamente largo que no debe cortarse";
    const props = base({
      targets: [
        target("p1.xhtml", "Parte I", "chapter"),
        target("c23.xhtml", long, "chapter", 2),
      ],
      suggestedStartId: "p1.xhtml",
      firstChapterId: "p1.xhtml",
    });
    render(props);
    click(radio("Elegir otro lugar"));
    const options = host.querySelectorAll("option");
    const deep = options[options.length - 1];
    expect(deep.textContent).toContain(long);
    expect(deep.textContent?.startsWith("    ")).toBe(true);
  });

  it("teclado: radio y select operables; Abrir sigue la selección", () => {
    const props = base();
    render(props);
    // El selector aparece al elegir «otro lugar» y queda operable.
    click(radio("Elegir otro lugar"));
    const select = host.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.disabled).toBe(false);
    expect((button("Abrir") as HTMLButtonElement).disabled).toBe(false);
  });
});
