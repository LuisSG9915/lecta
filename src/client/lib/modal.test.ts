// @vitest-environment jsdom
import {
  StrictMode,
  act,
  createElement as h,
  useRef,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalBehavior } from "./modal";

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

function Modal({
  onClose,
  children,
  tabIndex,
}: {
  onClose: () => void;
  children?: ReactNode;
  tabIndex?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);
  // createElement (sin JSX) dispara un falso positivo de react-hooks/refs:
  // la regla no distingue el prop `ref` estándar de una función cualquiera.
  // eslint-disable-next-line react-hooks/refs
  return h("div", { ref, className: "test-modal", tabIndex }, children);
}

const render = (node: ReactNode) => act(() => root.render(node));
const key = (k: string, shift = false) =>
  act(() => {
    const target = document.activeElement ?? document;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: k,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
const button = (label: string, props: Record<string, unknown> = {}) =>
  h("button", props, label);

describe("useModalBehavior", () => {
  it("enfoca el primer control al abrir y lo devuelve al cerrar", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    render(
      h(Modal, { onClose }, button("primero"), button("segundo")),
    );
    expect(document.activeElement?.textContent).toBe("primero");
    act(() => root.render(null));
    expect(document.activeElement).toBe(trigger);
  });

  it("prefiere [data-autofocus] sobre el primer control", () => {
    render(
      h(
        Modal,
        { onClose: () => {} },
        button("primero"),
        h("input", { "data-autofocus": true }),
      ),
    );
    expect(document.activeElement?.tagName).toBe("INPUT");
  });

  it("atrapa Tab en el último control y Shift+Tab en el primero", () => {
    render(
      h(Modal, { onClose: () => {} }, button("uno"), button("dos")),
    );
    const buttons = [...host.querySelectorAll("button")];
    buttons[1].focus();
    key("Tab");
    expect(document.activeElement).toBe(buttons[0]);
    key("Tab", true);
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("enfoca el contenedor cuando no hay controles", () => {
    render(h(Modal, { onClose: () => {}, tabIndex: -1 }));
    expect(document.activeElement).toBe(host.querySelector(".test-modal"));
    key("Tab");
    expect(document.activeElement).toBe(host.querySelector(".test-modal"));
  });

  it("omite controles deshabilitados u ocultos", () => {
    render(
      h(
        Modal,
        { onClose: () => {} },
        h("span", { hidden: true }, button("oculto")),
        button("apagado", { disabled: true }),
        button("visible"),
      ),
    );
    expect(document.activeElement?.textContent).toBe("visible");
  });

  it("no falla si el disparador ya no existe al cerrar", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    render(h(Modal, { onClose: () => {} }));
    trigger.remove();
    expect(() => act(() => root.render(null))).not.toThrow();
  });

  it("Escape cierra solo la capa superior", () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    render(
      h(StrictMode, null, [
        h(Modal, { key: "a", onClose: closeA }, button("A")),
        h(Modal, { key: "b", onClose: closeB }, button("B")),
      ]),
    );
    key("Escape");
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
  });

  it("la capa de abajo recupera el teclado cuando la superior se va", () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    const tree = (showB: boolean) =>
      h("div", null, [
        h(Modal, { key: "a", onClose: closeA }),
        showB ? h(Modal, { key: "b", onClose: closeB }) : null,
      ]);
    render(tree(true));
    act(() => root.render(tree(false)));
    key("Escape");
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
  });

  it("no deja escuchas tras desmontar, ni duplicadas en StrictMode", () => {
    const onClose = vi.fn();
    render(h(StrictMode, null, h(Modal, { onClose }, button("x"))));
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saca el fondo del árbol con inert y lo restaura al cerrar", () => {
    const sibling = document.createElement("div");
    sibling.innerHTML = "<button>fondo</button>";
    document.body.insertBefore(sibling, host);
    render(h(Modal, { onClose: () => {} }));
    expect(sibling.inert).toBe(true);
    act(() => root.render(null));
    expect(sibling.inert).toBe(false);
    sibling.remove();
  });

  it("bloquea el scroll del documento al abrir y lo restaura al cerrar", () => {
    const de = document.documentElement;
    render(h(Modal, { onClose: () => {} }));
    expect(de.style.overflow).toBe("hidden");
    act(() => root.render(null));
    expect(de.style.overflow).toBe("");
  });

  it("mantiene el bloqueo hasta cerrar la última capa", () => {
    const de = document.documentElement;
    const tree = (showB: boolean) =>
      h("div", null, [
        h(Modal, { key: "a", onClose: () => {} }),
        showB ? h(Modal, { key: "b", onClose: () => {} }) : null,
      ]);
    render(tree(true));
    expect(de.style.overflow).toBe("hidden");
    // Cierra solo la capa de arriba: el fondo sigue bloqueado.
    act(() => root.render(tree(false)));
    expect(de.style.overflow).toBe("hidden");
    act(() => root.render(null));
    expect(de.style.overflow).toBe("");
  });

  it("restaura un overflow previo que no viniera del modal", () => {
    const de = document.documentElement;
    de.style.overflow = "scroll";
    render(h(Modal, { onClose: () => {} }));
    expect(de.style.overflow).toBe("hidden");
    act(() => root.render(null));
    expect(de.style.overflow).toBe("scroll");
    de.style.overflow = "";
  });

  it("compensa la barra clásica solo cuando existe", () => {
    const de = document.documentElement;
    const innerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(de, "clientWidth", {
      configurable: true,
      value: 984,
    });
    render(h(Modal, { onClose: () => {} }));
    expect(de.style.paddingRight).toBe("16px");
    act(() => root.render(null));
    expect(de.style.paddingRight).toBe("");
    Object.defineProperty(window, "innerWidth", innerWidth!);
    // Borra la propia: vuelve a leerse del prototipo.
    delete (de as { clientWidth?: number }).clientWidth;
  });

  it("no cierra si Escape se pulsa dentro de un elemento [data-escape='local']", () => {
    const onClose = vi.fn();
    render(
      h(
        Modal,
        { onClose },
        h(
          "form",
          { "data-escape": "local" },
          h("input", { "data-autofocus": true, placeholder: "editar" }),
        ),
      ),
    );
    const input = host.querySelector("input")!;
    input.focus();
    key("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("no bloquea ni atrapa foco si enabled es false", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    function DisabledModal({ onClose }: { onClose: () => void }) {
      const ref = useRef<HTMLDivElement>(null);
      useModalBehavior(ref, onClose, { enabled: false });
      // eslint-disable-next-line react-hooks/refs
      return h("div", { ref, className: "disabled-modal" }, button("interior"));
    }

    const onClose = vi.fn();
    render(h(DisabledModal, { onClose }));
    // El foco no se roba al primer control
    expect(document.activeElement).toBe(trigger);
    // Escape no dispara onClose
    key("Escape");
    expect(onClose).not.toHaveBeenCalled();
    trigger.remove();
  });
});

