// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectionPreview, {
  type SectionPreviewProps,
  type SectionPreviewRow,
} from "./SectionPreview";
import type { PreparationAnswers } from "../lib/preparation";

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

const row = (
  key: string,
  extra: Partial<SectionPreviewRow> = {},
): SectionPreviewRow => ({ key, form: `forma-${key}`, meaning: "def", ...extra });

const base = (over: Partial<SectionPreviewProps> = {}): SectionPreviewProps => ({
  title: "Capítulo 1",
  analysis: "ready",
  rows: [row("es:casa"), row("es:perenne")],
  answers: {},
  saving: false,
  onAnswer: vi.fn(),
  onConfirm: vi.fn(),
  onSkip: vi.fn(),
  onRetry: vi.fn(),
  onClose: vi.fn(),
  onDiscard: vi.fn(),
  ...over,
});

const render = (props: SectionPreviewProps) =>
  act(() => root.render(h(SectionPreview, props)));

const text = () => host.textContent ?? "";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) =>
  act(() => {
    button(label).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });

describe("SectionPreview", () => {
  it("tres estados: conocer, desconocer y pendiente se reportan explícitos", () => {
    const props = base();
    render(props);
    click("La conozco");
    expect(props.onAnswer).toHaveBeenCalledWith("es:casa", "known");
    click("No la conozco");
    expect(props.onAnswer).toHaveBeenCalledWith("es:casa", "unknown");
    // Sin respuesta la fila queda pendiente: nada marcado.
    const group = host.querySelector("[role='group']")!;
    for (const btn of group.querySelectorAll("button"))
      expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("dos filas del mismo lema mantienen claves y respuestas independientes", () => {
    const props = base({
      rows: [
        row("es:banco", { form: "banco" }),
        row("es:banco#2", { form: "banco" }),
      ],
      answers: { "es:banco": "known" },
    });
    render(props);
    const groups = host.querySelectorAll("[role='group']");
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector("[aria-pressed='true']")).not.toBeNull();
    expect(groups[1].querySelector("[aria-pressed='true']")).toBeNull();
  });

  it("muestra 8 primero y «Ver más» revela el resto sin perder respuestas", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`es:w${i}`));
    const answers: PreparationAnswers = { "es:w0": "unknown" };
    const props = base({ rows, answers });
    render(props);
    expect(host.querySelectorAll(".section-preview-item")).toHaveLength(8);
    click("Ver 2 más");
    expect(host.querySelectorAll(".section-preview-item")).toHaveLength(10);
    expect(
      host.querySelector(".section-preview-item [aria-pressed='true']"),
    ).not.toBeNull();
  });

  it("agrupa nuevas, por aprender y sin definición", () => {
    render(
      base({
        rows: [
          row("es:nueva"),
          row("es:aprendiendo", { learning: true }),
          row("es:sindef", { meaning: undefined }),
        ],
      }),
    );
    expect(text()).toContain("Palabras nuevas");
    expect(text()).toContain("Que estás aprendiendo");
    expect(text()).toContain("Sin definición todavía");
  });

  it("carga muestra aviso y conserva la salida «Leer sin preparar»", () => {
    const props = base({ analysis: "loading", rows: [] });
    render(props);
    expect(text()).toContain("Preparando vocabulario");
    click("Leer sin preparar");
    expect(props.onSkip).toHaveBeenCalled();
  });

  it("error ofrece reintentar y leer sin preparar", () => {
    const props = base({ analysis: "error", rows: [] });
    render(props);
    expect(host.querySelector("[role='alert']")).not.toBeNull();
    click("Reintentar");
    expect(props.onRetry).toHaveBeenCalled();
    click("Leer sin preparar");
    expect(props.onSkip).toHaveBeenCalled();
  });

  it("vacío explica que no hay nada que preparar y sale a leer", () => {
    const props = base({ rows: [] });
    render(props);
    expect(text()).toContain("Nada que preparar");
    click("Leer");
    expect(props.onSkip).toHaveBeenCalled();
  });

  it("saving bloquea un segundo envío y las respuestas", () => {
    const props = base({ saving: true, answers: { "es:casa": "known" } });
    render(props);
    const confirm = button("Guardando…") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    click("Guardando…");
    expect(props.onConfirm).not.toHaveBeenCalled();
    const choice = host.querySelector(
      ".cal-choice",
    ) as HTMLButtonElement;
    expect(choice.disabled).toBe(true);
  });

  it("consultar definición dentro de la hoja no toca las respuestas", () => {
    const props = base({ answers: { "es:casa": "known" } });
    render(props);
    const open = host.querySelector(".section-preview-open") as HTMLElement;
    act(() => {
      open.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(host.querySelector(".section-preview-def")).not.toBeNull();
    // Sigue sin abrir otra ficha ni alterar respuestas controladas.
    expect(props.onAnswer).not.toHaveBeenCalled();
    expect(
      host.querySelector(".cal-choice[aria-pressed='true']"),
    ).not.toBeNull();
  });

  it("una definición que llega tarde se actualiza en su lugar (misma clave)", () => {
    // Mismo grupo, misma clave: React reutiliza el nodo y solo cambia el texto.
    const props = base({ rows: [row("es:tardia", { meaning: "def vieja" })] });
    render(props);
    const open = host.querySelector(".section-preview-open") as HTMLElement;
    act(() => {
      open.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const item = host.querySelector(".section-preview-item")!;
    expect(item.textContent).toContain("def vieja");
    render(
      base({ ...props, rows: [row("es:tardia", { meaning: "def tardía" })] }),
    );
    const updated = host.querySelector(".section-preview-item")!;
    expect(updated).toBe(item);
    expect(updated.textContent).toContain("def tardía");
  });

  it("descartar pide confirmación en la misma hoja, sin diálogo apilado", () => {
    const props = base({ answers: { "es:casa": "unknown" } });
    render(props);
    click("Descartar respuestas");
    expect(text()).toContain("¿Descartar las respuestas marcadas?");
    click("Conservar");
    expect(props.onDiscard).not.toHaveBeenCalled();
    click("Descartar respuestas");
    click("Sí, descartar");
    expect(props.onDiscard).toHaveBeenCalled();
  });

  it("cerrar avisa al controlador (el borrador lo conserva él)", () => {
    const props = base();
    render(props);
    click("Cerrar");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("las diferidas quedan colapsadas, paginadas por 8 y respondibles", () => {
    const deferred = Array.from({ length: 10 }, (_, i) =>
      row(`es:d${i}`, { form: `dif${i}` }),
    );
    const props = base({ deferredRows: deferred, answers: {} });
    render(props);
    // Colapsadas: no estorban a la selección principal.
    expect(text()).toContain("más palabras de esta parte (10)");
    expect(host.querySelectorAll(".section-preview-item")).toHaveLength(2);

    click("Ver más palabras de esta parte (10)");
    // Paginadas por 8 como la lista principal.
    expect(host.querySelectorAll(".section-preview-item")).toHaveLength(10);
    click("Ver 2 más");
    expect(host.querySelectorAll(".section-preview-item")).toHaveLength(12);
    // Respondibles: siguen siendo filas con evidencia, no consulta
    // pasiva — una marcada desconocida entra al mismo lote.
    const groups = host.querySelectorAll("[role='group']");
    const last = groups[groups.length - 1];
    const unknownBtn = [...last.querySelectorAll("button")].find(
      (b) => b.textContent === "No la conozco",
    )!;
    act(() => {
      unknownBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(props.onAnswer).toHaveBeenCalledWith("es:d9", "unknown");
  });

  it("las diferidas solo registran presentación cuando se hacen visibles", () => {
    const presented: SectionPreviewRow[][] = [];
    const deferred = Array.from({ length: 10 }, (_, i) =>
      row(`es:d${i}`, { form: `dif${i}` }),
    );
    render(
      base({
        deferredRows: deferred,
        onRowsPresented: (rows) => presented.push(rows),
      }),
    );
    // Sin abrir la consulta no hubo presentación de diferidas.
    expect(presented.flat().map((row) => row.key)).not.toContain("es:d0");
    click("Ver más palabras de esta parte (10)");
    const last = presented[presented.length - 1].map((row) => row.key);
    // Solo las 8 visibles, no las que siguen paginadas.
    expect(last).toContain("es:d0");
    expect(last).toContain("es:d7");
    expect(last).not.toContain("es:d8");
  });
});
