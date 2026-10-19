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

  const render = (
    active: NavDestination,
    onNavigate = vi.fn(),
    dueCount = 0,
    hasJourneyAlert = false,
  ) => {
    act(() => {
      root.render(h(AppNav, { active, onNavigate, dueCount, hasJourneyAlert }));
    });
  };

  it("muestra los rótulos de los 4 destinos", () => {
    render("shelf");
    const buttons = host.querySelectorAll("button");
    expect(buttons).toHaveLength(4);
    expect(buttons[0].textContent).toContain("Biblioteca");
    expect(buttons[1].textContent).toContain("Cuaderno");
    expect(buttons[2].textContent).toContain("Camino");
    expect(buttons[3].textContent).toContain("Perfil");
  });

  it("coloca aria-current='page' en el destino activo", () => {
    render("shelf");
    let buttons = host.querySelectorAll("button");
    expect(buttons[0].getAttribute("aria-current")).toBe("page");
    expect(buttons[1].getAttribute("aria-current")).toBeNull();
    expect(buttons[2].getAttribute("aria-current")).toBeNull();
    expect(buttons[3].getAttribute("aria-current")).toBeNull();

    render("vocabulary");
    buttons = host.querySelectorAll("button");
    expect(buttons[0].getAttribute("aria-current")).toBeNull();
    expect(buttons[1].getAttribute("aria-current")).toBe("page");
    expect(buttons[2].getAttribute("aria-current")).toBeNull();
    expect(buttons[3].getAttribute("aria-current")).toBeNull();

    render("journey");
    buttons = host.querySelectorAll("button");
    expect(buttons[0].getAttribute("aria-current")).toBeNull();
    expect(buttons[1].getAttribute("aria-current")).toBeNull();
    expect(buttons[2].getAttribute("aria-current")).toBe("page");
    expect(buttons[3].getAttribute("aria-current")).toBeNull();

    render("account");
    buttons = host.querySelectorAll("button");
    expect(buttons[0].getAttribute("aria-current")).toBeNull();
    expect(buttons[1].getAttribute("aria-current")).toBeNull();
    expect(buttons[2].getAttribute("aria-current")).toBeNull();
    expect(buttons[3].getAttribute("aria-current")).toBe("page");
  });

  it("dispara onNavigate al hacer clic en un destino", () => {
    const onNavigate = vi.fn();
    render("shelf", onNavigate);
    const buttons = host.querySelectorAll("button");

    act(() => {
      buttons[1].click();
    });
    expect(onNavigate).toHaveBeenCalledWith("vocabulary");

    act(() => {
      buttons[2].click();
    });
    expect(onNavigate).toHaveBeenCalledWith("journey");

    act(() => {
      buttons[3].click();
    });
    expect(onNavigate).toHaveBeenCalledWith("account");

    act(() => {
      buttons[0].click();
    });
    expect(onNavigate).toHaveBeenCalledWith("shelf");
  });

  it("muestra el badge numérico únicamente si hay palabras pendientes para repasar", () => {
    render("shelf", vi.fn(), 0);
    expect(host.querySelector(".app-nav-badge")).toBeNull();

    render("shelf", vi.fn(), 4);
    const badge = host.querySelector(".app-nav-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("4");
  });

  it("muestra el destello de novedad en Camino cuando hay alerta de jornada", () => {
    render("shelf", vi.fn(), 0, false);
    expect(host.querySelector(".app-nav-sparkle")).toBeNull();

    render("shelf", vi.fn(), 0, true);
    expect(host.querySelector(".app-nav-sparkle")).not.toBeNull();
  });

  describe("Navegación Unificada (onSelect / NavTab)", () => {
    it("renderiza las 3 secciones principales y dispara onSelect", () => {
      const onSelect = vi.fn();
      act(() => {
        root.render(
          h(AppNav, {
            activeTab: "shelf",
            onSelect,
            dueReviewsCount: 5,
          }),
        );
      });

      const buttons = host.querySelectorAll("button");
      expect(buttons).toHaveLength(3);
      expect(buttons[0].textContent).toContain("Biblioteca");
      expect(buttons[0].getAttribute("aria-current")).toBe("page");
      expect(buttons[1].textContent).toContain("Mi vocabulario");
      expect(buttons[1].textContent).toContain("5");
      expect(buttons[2].textContent).toContain("Progreso");

      act(() => {
        buttons[1].click();
      });
      expect(onSelect).toHaveBeenCalledWith("vocab");

      act(() => {
        buttons[2].click();
      });
      expect(onSelect).toHaveBeenCalledWith("journey");
    });

    it("renderiza el botón del compañero cuando se provee onOpenCompanion", () => {
      const onSelect = vi.fn();
      const onOpenCompanion = vi.fn();
      act(() => {
        root.render(
          h(AppNav, {
            activeTab: "vocab",
            onSelect,
            companionName: "Búho",
            onOpenCompanion,
          }),
        );
      });

      const buttons = host.querySelectorAll("button");
      expect(buttons).toHaveLength(4);
      const companionBtn = host.querySelector(".app-nav-companion") as HTMLButtonElement;
      expect(companionBtn).not.toBeNull();
      expect(companionBtn.textContent).toContain("Búho");

      act(() => {
        companionBtn.click();
      });
      expect(onOpenCompanion).toHaveBeenCalledTimes(1);
    });
  });
});

