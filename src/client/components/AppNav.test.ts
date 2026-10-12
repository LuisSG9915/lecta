// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppNav, { type NavDestination } from "./AppNav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AppNav", () => {
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

  const render = (active: NavDestination, onNavigate = vi.fn()) => {
    act(() => {
      root.render(h(AppNav, { active, onNavigate }));
    });
  };

  it("muestra los rótulos de los 3 destinos", () => {
    render("shelf");
    const buttons = host.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toContain("Estantería");
    expect(buttons[1].textContent).toContain("Cuaderno");
    expect(buttons[2].textContent).toContain("Tú");
  });

  it("coloca aria-current='page' en el destino activo", () => {
    render("shelf");
    const buttons = host.querySelectorAll("button");
    expect(buttons[0].getAttribute("aria-current")).toBe("page");
    expect(buttons[1].getAttribute("aria-current")).toBeNull();
    expect(buttons[2].getAttribute("aria-current")).toBeNull();

    render("vocab");
    expect(buttons[0].getAttribute("aria-current")).toBeNull();
    expect(buttons[1].getAttribute("aria-current")).toBe("page");
    expect(buttons[2].getAttribute("aria-current")).toBeNull();

    render("account");
    expect(buttons[0].getAttribute("aria-current")).toBeNull();
    expect(buttons[1].getAttribute("aria-current")).toBeNull();
    expect(buttons[2].getAttribute("aria-current")).toBe("page");
  });

  it("dispara onNavigate al hacer clic en un destino", () => {
    const onNavigate = vi.fn();
    render("shelf", onNavigate);
    const buttons = host.querySelectorAll("button");

    act(() => {
      buttons[1].click();
    });
    expect(onNavigate).toHaveBeenCalledWith("vocab");

    act(() => {
      buttons[2].click();
    });
    expect(onNavigate).toHaveBeenCalledWith("account");

    act(() => {
      buttons[0].click();
    });
    expect(onNavigate).toHaveBeenCalledWith("shelf");
  });
});
