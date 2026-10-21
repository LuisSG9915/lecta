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

  it("muestra indicador honesto de sincronización con conexión o sin ella", () => {
    act(() => {
      root.render(
        h(AppNav, {
          active: "shelf",
          onNavigate: vi.fn(),
          syncState: {
            isOnline: false,
            lastSyncedAt: null,
            pendingChangesCount: 0,
            lastSyncError: null,
          },
        }),
      );
    });
    const offlineIndicator = host.querySelector(".app-nav-sync-indicator");
    expect(offlineIndicator).toBeTruthy();
    expect(offlineIndicator?.textContent).toContain("Sin conexión · guardado local");

    act(() => {
      root.render(
        h(AppNav, {
          active: "shelf",
          onNavigate: vi.fn(),
          hasAccount: true,
          syncState: {
            isOnline: true,
            lastSyncedAt: Date.now(),
            pendingChangesCount: 0,
            lastSyncError: null,
          },
        }),
      );
    });
    const syncedIndicator = host.querySelector(".app-nav-sync-indicator");
    expect(syncedIndicator?.textContent).toContain("Sincronizado");

    act(() => {
      root.render(
        h(AppNav, {
          active: "shelf",
          onNavigate: vi.fn(),
          hasAccount: true,
          syncState: {
            isOnline: true,
            lastSyncedAt: Date.now(),
            pendingChangesCount: 3,
            lastSyncError: null,
          },
        }),
      );
    });
    const pendingIndicator = host.querySelector(".app-nav-sync-indicator");
    expect(pendingIndicator?.textContent).toContain(
      "Guardado en este dispositivo · pendiente de sincronizar",
    );
  });
});

